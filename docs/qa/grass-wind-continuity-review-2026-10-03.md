# Meadow wind and LOD continuity review

The shipped `grass.system: meadow` reused tile-local wind phase and variation
from the blade/card template. Every 8 m blade tile and 64 m card tile therefore
restarted the same pattern. A blade and a card placed at the same canonical
point could differ by about 2.7 radians in phase.

Compaction now samples phase and variation from canonical world coordinates.
All blade LODs keep their existing stable stem sequence; surviving stems retain
their motion as detail and density change. Near blades and far cards use the
same variation field. The small noise lattice is cached per compaction, keeping
gradient hashing and trigonometry out of the per-stem loop. There are no added
vertex attributes or shader noise evaluations.

The blade/card handoff also used `noise < coverage` for both layers. At its
midpoint both drew the same half of the pixels and left the other half empty.
The incoming cards now keep pixels released by the outgoing blades. The final
card fade still removes the field completely at its configured outer distance.

The marked seam at the origin exposed a third issue in the shared world wind
field. Noise coordinates wrapped at 1,024 cells, but the gradients on the last
cell's outer corners hashed cell 1,024 instead of cell 0. Crossing x = 0 at
time zero therefore jumped from roughly 0.50 to 0.21 wind strength over just
2 mm. Each layer's advection moved these sharp boundaries through the world.
CPU and GPU field evaluation now wrap the lattice corners as well as the
sample coordinates. The reusable, non-periodic noise remains available for
meadow instance variation.

## Regression checks

- Actual compaction at the same world point in blade and card tiles.
- Non-repeating variation across neighboring tiles and continuity at positive,
  negative, and planet-scale tile boundaries.
- Stable motion for surviving stems after an LOD prefix rebuild.
- Cached noise agrees with the world noise throughout blade and card tiles.
- Evaluation of the actual material mask graph over the full handoff: no gaps
  or overlap, plus the ordinary standalone and far-edge dissolves.
- Periodic noise continuity on both axes, positive/negative wrap boundaries,
  and gust-vector continuity at advected boundaries in the complete field.

Run `node --test test/meadow-wind-continuity.test.js test/meadow-lod-handoff.test.js
test/world-wind-field.test.js tests/meadowGrass.test.js` and `npm run verify`.

A hardware WebGPU readback probe sampled 72 positions in paired points 2 mm
apart at times 0, 8, and 60 seconds. The largest wind-vector jump fell from
0.37270 to 0.000224. The corrected shader agreed with the CPU evaluator within
0.000093 per component, with no browser or GPU errors. Results are in
`tmp/wind-gpu-continuity.json`.

The settled origin view was captured with both grass and wind clocks frozen at
zero, then with only the world-wind fragment node switched between the old and
corrected evaluators. Images are `tmp/grass-seam-periodic-before.png` and
`tmp/grass-seam-periodic-after.png`. The abrupt gust change across the origin is
smoothed; local, continuous waves and biome-driven coverage remain visible.

`npm run verify` passed all 2,992 tests, asset validations, the natural UI check,
and the production build after the complete change.

## Hardware performance comparison

Used the deterministic movement harness described in `docs/perf-qa.md` on the
NVIDIA Lovelace WebGPU adapter, 1280 × 720, with identical spawn and settings:

```text
node scripts/run-perf-qa.mjs --url http://127.0.0.1:5189 --headed
  --qa chunk-cross --density high-grass --warmup 8 --duration 8 --settle
  --timeoutMs 220000 --out tmp/grass-wind-optimized.json
  --screenshot tmp/grass-wind-optimized.png
```

| Metric | Before | Tile variation + LOD fix | Plus periodic field fix |
| --- | ---: | ---: | ---: |
| Settled before measurement | yes | yes | yes |
| Average FPS | 96.22 | 100.11 | 93.34 |
| Frame dt p95 | 17.60 ms | 15.03 ms | 15.86 ms |
| Frame dt p99 | 29.57 ms | 30.01 ms | 31.40 ms |
| Hitches over 33.3 ms | 2 | 3 | 4 |
| Compacted stems | 2,808,886 | 2,808,886 | 2,808,886 |
| Accumulated meadow update time | 662.3 ms | 758.6 ms | 798.2 ms |

The uncached first implementation took 1,435.4 ms of accumulated meadow update
time; caching removed most of that additional cost. The final implementation
adds about 136 ms across the captured run while keeping the same stem workload.
These are single-run comparisons and do not establish an overall FPS gain or
the cause of its run-to-run variation. The complete change retained p95 below
33.3 ms and hitch rate below 2%; its movement capture is
`tmp/grass-wind-periodic.json` with screenshot `tmp/grass-wind-periodic.png`.

The full movement acceptance gate remains **failed**: collision readiness stops
and streaming hitches occurred both before and after the grass changes. This
comparison verifies grass rendering on hardware; it does not certify the whole
streaming path. Raw reports and screenshots are under `tmp/grass-wind-*`.
