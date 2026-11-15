# Token Launch Radar — token-radar-01

A program that ranks pre-token protocols by an implied token value, and the
dashboard that shows the ranking.

## The model (radar-2)

Every implied value is derived from the frozen snapshot's own figures:

```
implied = TVL × compRatio × growth × seasoning
compRatio = category median mcap/TVL among tokens that trade,
            shrunk toward the global median (weight 4)
growth    = 1 + clamp(7d change, -40%, +80%) × 0.6
seasoning = 0.7 + min(age, 1460 days) / 1460 × 0.5
```

No protocol name is special-cased. The board covers all 40 watchlist
protocols plus every other launch candidate below the $50M floor (pre-token,
not an exchange, not a versioned pool, not a wrapped/staked/bridged product):
178 rows in this snapshot. Each row carries a six-step farm plan derived from
its category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`,
copies `dashboard/` and `screenshots/` into the output directory, and writes
`dossier.json` with the vendored make.fun library.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the comps model, the board builder, the farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte.
- `dashboard/` — the page: sortable/filterable board, per-protocol detail
  with the model's arithmetic, the comps table, live-token comps.
- `screenshots/` — board, detail and filtered views of the page.
