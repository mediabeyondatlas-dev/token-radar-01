// token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>),
// scores every launch candidate with the comps model in lib/model.ts, writes
// the ranked board to /output/board.json, the dashboard's data to
// /output/data.js, copies dashboard/ and screenshots/ into /output, and
// writes /output/dossier.json with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, checkBoard, dataJs, parseSnap } from './lib/model.ts';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;

const flags: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq > 2) {
    flags[a.slice(2, eq)] = a.slice(eq + 1);
  } else if (i + 1 < argv.length) {
    flags[a.slice(2)] = argv[i + 1]!;
    i++;
  }
}

const inputGiven = flags['input'] ?? '/input';
const snapPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapPath)) {
  process.stderr.write(`token radar: no snapshot at ${snapPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flags['output'] ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snap = parseSnap(readFileSync(snapPath, 'utf8'));
const { board, data } = buildRadar(snap);
const problem = checkBoard(board, snap);
if (problem !== null) {
  process.stderr.write(`token radar: the board fails the gate: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// board.json carries the gate's field names; data.js carries the radar's own rows.
const gateRows = board.map((r) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  category: r.category,
  chains: r.chains,
  tvl_usd: r.tvl,
  change_7d: r.change7d,
  listed_at: r.listedAt,
  age_days: r.ageDays,
  implied_value_usd: r.implied,
  model: r.model,
  farm_steps: r.farmSteps,
}));
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: gateRows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataJs(data));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
const shotName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) {
  if (!shotName.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: TEXT_CAP,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snap.protos.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')}, ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
