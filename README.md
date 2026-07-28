# vitai-lens

**The stats deck for [vitai](https://github.com/Wombat164/vitai).** A
local-first dashboard that reads a vitai read model (`derived/health.db`)
and shows the athlete their numbers: trends, weekly loads, calendar
heatmaps, and the engine's goal-attainment verdicts. Built for two
audiences at once: outcome-optimizers (verdict first) and stats-junkies
(everything else).

![vitai-lens](demo/screenshot-light.png)

## Run it

```bash
git clone https://github.com/Wombat164/vitai-lens.git
cd vitai-lens
python -m http.server 8765     # any static server works
# open http://localhost:8765 - loads the synthetic demo athlete
```

Then click **Open your health.db** and pick the `derived/health.db` from
your own vitai content repo. Everything runs in your browser via
sql.js/WebAssembly - **no server-side anything, your data never leaves the
machine**.

## What it shows (v0.1)

- Stat tiles: 7-day weight average, week-over-week rate, verdict adherence,
  4-week run volume
- Weight: 7-day rolling average over raw weigh-ins, crosshair + tooltip
- Weekly running distance and stacked sessions-per-week (runs + gym)
- Daily-steps calendar heatmap (12 weeks, sequential teal ramp)
- The engine's weekly **goal-attainment verdicts** per metric - glyph +
  color cells (= on target, - behind, + ahead), never color alone
- A table view for accessibility and copy-paste

Light and dark mode follow the system; the chart palette is validated for
color-vision deficiency and surface contrast in both modes (teal/amber
categorical pair, one-hue sequential ramp, status colors reserved for
verdicts).

## Relationship to vitai

vitai-lens is deliberately a SEPARATE repo: it is the first consumer of
vitai's platform contract (the `health.db` tables + `verdicts` +
`meta.contract`), which keeps the engine honest - if the lens needs a
schema change, so would any game or third-party dashboard, and that
conversation happens in the contract, not in private coupling. The lens
never writes: the record and its derivations belong to the engine.

`meta.contract` compatibility: built against contract `1`.

## Roadmap (increments, mirroring vitai's discipline)

- L1: session drilldown (per-run pace/HR), month/quarter time-range filter,
  nutrition panel (kcal in/out, protein) from `daily`
- L2: cross-correlation explorer (any metric vs any metric, with lag) -
  exploratory analytics live HERE, not in the engine; the engine owns only
  canonical derivations
- L3: baselines/streaks panels when vitai v0.6.0 ships them; inference
  panel reading the third data tier
- L4: goal progress views when `goals.jsonl` lands (vitai v0.3.0)

## Demo data

`demo/health.db` is generated through the real vitai engine from a seeded
synthetic athlete (`tools/make_demo.py`). No real person's data is in this
repository, ever.

## License

MIT.
