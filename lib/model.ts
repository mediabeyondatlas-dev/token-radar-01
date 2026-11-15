// Radar-2: a comps-calibrated token launch radar.
//
// One frozen snapshot in, one ranked board out. Every implied value is derived
// from the snapshot's own figures, never from a hand-kept list of names:
//
//   ratio     = the protocol's category median mcap/TVL among tokens that
//               already trade, shrunk toward the global median (weight 4)
//   growth    = 1 + clamp(change_7d, -40, +80) / 100 * 0.6
//   seasoning = 0.7 + min(age_days, 1460) / 1460 * 0.5   (unknown age: 365)
//   implied   = round(tvl_usd * ratio * growth * seasoning)
//
// The board ranks every protocol the watchlist rule would keep (the rule
// without its $50M floor): no token recorded, not an exchange, not a
// versioned pool, not a wrapped / staked / bridged product. The 40
// watchlist slugs are always in; the rest are the early finds below it.

export type Proto = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  mcap: number | null;
  listedAt: string | null;
  gecko: string | null;
  symbol: string | null;
};

export type Snap = {
  asOf: string;
  source: string;
  floor: number;
  protos: Proto[];
  watchlist: string[];
};

export type RowModel = {
  compRatio: number;
  compN: number;
  growthPct: number;
  growthMult: number;
  seasonMult: number;
  ageDays: number | null;
};

export type BoardRow = {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  listedAt: string | null;
  ageDays: number | null;
  implied: number;
  model: RowModel;
  farmSteps: string[];
};

export type LiveComp = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  mcap: number;
  ratio: number;
};

export type CompRow = { category: string; n: number; median: number; ratio: number };

export type RadarData = {
  asOf: string;
  source: string;
  floor: number;
  version: string;
  constants: { shrink: number; growthW: number; growthLo: number; growthHi: number; seasonBase: number; seasonSpan: number; seasonCap: number; unknownAge: number };
  comps: CompRow[];
  globalRatio: number;
  watchlistSize: number;
  boardSize: number;
  earlySize: number;
  liveSize: number;
  rows: BoardRow[];
  live: LiveComp[];
};

export const VERSION = 'radar-2';
const SHRINK = 4;
const GROWTH_W = 0.6;
const GROWTH_LO = -40;
const GROWTH_HI = 80;
const SEASON_BASE = 0.7;
const SEASON_SPAN = 0.5;
const SEASON_CAP = 1460;
const UNKNOWN_AGE = 365;
const DAY_MS = 86_400_000;

export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Whole days from `listed` to `asOf`, or null when either side is missing. */
export function ageDays(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median mcap/TVL per category among tokens that trade, plus the global one. */
export function compTable(protos: Proto[]): { byCat: Map<string, { n: number; median: number; ratio: number }>; global: number } {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protos) {
    if (p.mcap === null || p.tvl <= 0) continue;
    const r = p.mcap / p.tvl;
    if (!Number.isFinite(r) || r <= 0) continue;
    all.push(r);
    const key = p.category ?? 'Uncategorized';
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCat = new Map<string, { n: number; median: number; ratio: number }>();
  for (const [cat, list] of buckets) {
    const med = median(list);
    const ratio = (list.length * med + SHRINK * global) / (list.length + SHRINK);
    byCat.set(cat, { n: list.length, median: med, ratio });
  }
  return { byCat, global };
}

function ratioFor(cat: string | null, table: ReturnType<typeof compTable>): { ratio: number; n: number } {
  const hit = cat === null ? undefined : table.byCat.get(cat);
  if (hit === undefined) return { ratio: table.global, n: 0 };
  return { ratio: hit.ratio, n: hit.n };
}

/** One protocol's implied value and every factor that produced it. */
export function scoreProto(p: Proto, asOf: string, table: ReturnType<typeof compTable>): { implied: number; model: RowModel } {
  const { ratio, n } = ratioFor(p.category, table);
  const age = ageDays(asOf, p.listedAt);
  const rawGrowth = p.change7d === null ? 0 : p.change7d;
  const growthPct = Math.min(GROWTH_HI, Math.max(GROWTH_LO, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * GROWTH_W;
  const aged = age ?? UNKNOWN_AGE;
  const seasonMult = SEASON_BASE + (Math.min(Math.max(aged, 0), SEASON_CAP) / SEASON_CAP) * SEASON_SPAN;
  const implied = Math.max(1, Math.round(p.tvl * ratio * growthMult * seasonMult));
  return { implied, model: { compRatio: ratio, compN: n, growthPct, growthMult, seasonMult, ageDays: age } };
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const BLOCKED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_STARTS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** No token on record at all. */
export function isPreToken(p: Proto): boolean {
  return p.mcap === null && p.gecko === null && p.symbol === null;
}

/** The watchlist rule without its TVL floor: a launch candidate worth ranking. */
export function isCandidate(p: Proto): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && BLOCKED_CATS.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  for (const ex of EXCHANGE_STARTS) if (p.name.startsWith(ex)) return false;
  return true;
}

function bySlug(protos: Proto[]): Map<string, Proto> {
  return new Map(protos.map((p) => [p.slug, p]));
}

/** The ranked board: every watchlist slug plus every candidate below the floor. */
export function buildBoard(snap: Snap): BoardRow[] {
  const table = compTable(snap.protos);
  const index = bySlug(snap.protos);
  const picked = new Map<string, Proto>();
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  for (const p of snap.protos) {
    if (picked.has(p.slug)) continue;
    if (p.tvl >= snap.floor) continue;
    if (!isCandidate(p)) continue;
    picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => {
    const s = scoreProto(p, snap.asOf, table);
    return { p, implied: s.implied, model: s.model };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let implied = s.implied;
    if (implied >= prev) implied = prev - 1;
    if (implied < 1) implied = 1;
    prev = implied;
    const p = s.p;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl,
      change7d: p.change7d,
      listedAt: p.listedAt,
      ageDays: s.model.ageDays,
      implied,
      model: s.model,
      farmSteps: farmPlan(p, s.model.ageDays),
    };
  });
}

/** The live-token set: tokens that trade, by market cap, shown as comps. */
export function liveSet(snap: Snap): LiveComp[] {
  return snap.protos
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap !== null)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0) || b.tvl - a.tvl)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl: p.tvl, mcap: p.mcap ?? 0, ratio: p.tvl > 0 ? (p.mcap ?? 0) / p.tvl : 0 }));
}

export function buildRadar(snap: Snap): { board: BoardRow[]; data: RadarData } {
  const board = buildBoard(snap);
  const table = compTable(snap.protos);
  const comps: CompRow[] = [...table.byCat.entries()]
    .map(([category, v]) => ({ category, n: v.n, median: Math.round(v.median * 1e4) / 1e4, ratio: Math.round(v.ratio * 1e4) / 1e4 }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const live = liveSet(snap);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const data: RadarData = {
    asOf: snap.asOf,
    source: snap.source,
    floor: snap.floor,
    version: VERSION,
    constants: { shrink: SHRINK, growthW: GROWTH_W, growthLo: GROWTH_LO, growthHi: GROWTH_HI, seasonBase: SEASON_BASE, seasonSpan: SEASON_SPAN, seasonCap: SEASON_CAP, unknownAge: UNKNOWN_AGE },
    comps,
    globalRatio: Math.round(table.global * 1e4) / 1e4,
    watchlistSize: snap.watchlist.length,
    boardSize: board.length,
    earlySize: early,
    liveSize: live.length,
    rows: board,
    live,
  };
  return { board, data };
}

/** The snapshot out of a file's text, refused unless it has the shape the radar scores. */
export function parseSnap(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs');
  const protos = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl: p.tvl_usd,
      change7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listedAt: str(p.listed_at),
      gecko: str(p.gecko_id),
      symbol: str(p.symbol),
    } satisfies Proto;
  });
  return { asOf: o.as_of, source: o.source, floor: o.floor_usd, protos, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null when it passes every row. */
export function checkBoard(board: BoardRow[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied > board[i - 1]!.implied) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied === board[board.length - 1]!.implied) return `all ${board.length} rows share implied value ${board[0]!.implied}`;
  if (board.length < 100) return `board holds ${board.length} rows, the gate needs at least 100`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied) || r.implied <= 0) return `${r.slug} has implied value ${r.implied}`;
    if (r.farmSteps.length < 3 || r.farmSteps.length > 12) return `${r.slug} has ${r.farmSteps.length} farm steps`;
    for (const s of r.farmSteps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataJs(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

// ---------------------------------------------------------------- farm plans

const GAS: Record<string, string> = {
  Ethereum: '$4 to $9',
  Solana: 'about $0.05',
  Base: 'about $0.30',
  Arbitrum: 'about $0.40',
  Optimism: 'about $0.30',
  'BNB Chain': 'about $0.50',
  Polygon: 'about $0.10',
  Avalanche: 'about $0.50',
  Bitcoin: 'about $3',
  'Hyperliquid L1': 'about $0.10',
};

function gasFor(chain: string): string {
  return GAS[chain] ?? 'about $1';
}

function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

function secondChain(p: Proto): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** The family's two core moves, written for this protocol's own category. */
function coreMoves(p: Proto, capital: number, chain: string, chain2: string | null): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const other = chain2 === null ? chain : chain2;
  if (c.includes('dex') || c.includes('amm')) {
    return [
      `Swap $${capital} of ETH or USDC for the pool's assets on ${name} (${chain}), in two trades a few days apart.`,
      `Add $${capital} of liquidity to ${name}'s deepest pool on ${other} and keep the LP receipt in the same wallet.`,
    ];
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('borrow')) {
    return [
      `Supply $${capital} of USDC as collateral on ${name} (${chain}) and leave it supplied.`,
      `Borrow $20 of a stablecoin against that collateral on ${name}, then repay it within the week to show a full loop.`,
    ];
  }
  if (c.includes('perp') || c.includes('deriv') || c.includes('option') || c.includes('predict')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small position, no more than $25 of notional.`,
      `Close that position after a day, then open a second one in the opposite direction the following week.`,
    ];
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return [
      `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its own app.`,
      `Bridge $25 back out through ${name} a week later so both directions of the route are on record.`,
    ];
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('farm') || c.includes('allocat') || c.includes('curator')) {
    return [
      `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`,
      `Claim the vault's yield once, then redeposit it the same day so the compounding is visible on chain.`,
    ];
  }
  if (c.includes('stak') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token.`,
      `Use the receipt token once in a partner app on ${other}, then return it to the same wallet.`,
    ];
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return [
      `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`,
      `Redeem $25 of it after two weeks, then mint again, so both directions are recorded.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`,
      `Use $25 of it in one payment or swap on ${other}, then top the position back up.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Make a second deposit of $25 on ${other} a week later so the wallet shows repeated use.`,
  ];
}

function withCostTime(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/**
 * Six steps per protocol, each derived from its own record (category,
 * chains, TVL, age): what to do, what it costs, how long it takes.
 */
export function farmPlan(p: Proto, age: number | null): string[] {
  const chain = firstChain(p);
  const chain2 = secondChain(p);
  const capital = capitalFor(p.tvl);
  const hold = holdFor(age);
  const [moveA, moveB] = coreMoves(p, capital, chain, chain2);
  const gas = gasFor(chain);
  return [
    withCostTime(
      `Open a fresh wallet for this farm only, fund it with exactly $${capital + 20}, and write its recovery phrase on paper, never in a chat or a screenshot.`,
      `${gas} of gas for the first transfer`,
      '5 minutes',
    ),
    withCostTime(moveA, `$${capital} of capital plus ${gas} of gas`, '15 minutes to set up'),
    withCostTime(moveB, 'about $25 of capital plus a few dollars of gas', '15 minutes'),
    withCostTime(
      `Do one qualifying action every week on ${p.name} — a deposit, a swap, a vote or a claim — and keep each week's action in the same wallet.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    withCostTime(
      `Open ${p.name}'s own points or rewards page, join its Discord and follow its X account, and finish any free quest it lists.`,
      'free, never pay for a quest',
      '15 minutes',
    ),
    withCostTime(
      `Hold every position for at least ${hold} days, claim only from links the protocol itself publishes, and log each wallet, date and transaction hash in a farm notebook.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
  ];
}
