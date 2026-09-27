# Construction stone edge wear — evidence (2026-07-28)

Headless QA for worn arrises on `soft-limestone-rubble` (seed 3141).

## Metrics

| Metric | Flat | Relief only | Relief + edge wear |
| --- | ---: | ---: | ---: |
| Near stone triangles | 7840 | 10760 | 13096 |
| Mortar triangles | 3360 | 3360 | 3360 |
| Edge-wear stones | 0 | 0 | 146 |
| Edge-wear fallbacks | 0 | 0 | 0 |
| Edge-wear clamped | 0 | 0 | 5 |
| Flattened corners | 0 | 0 | 90 |
| Build p50 (ms) | 8.95 | 9.60 | 12.27 |
| Build p95 (ms) | 10.51 | 10.39 | 13.47 |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | PASS |
| Mortar unchanged | yes | PASS |
| Coarse soft wear | yes | PASS |
| Near triangle multiplier | ≤ 2.0× | 1.670× PASS |
| Build p95 over Part 1 | ≤ 35% | 29.7% PASS |
| Fallback rate | < 0.5% | 0.000% PASS |
| Clamped rate | < 5% | 3.425% PASS |
| Wear applied | > 0 | PASS |

Overall: **PASS**

## Visual checklist (manual)

- [ ] Neutral material (white / roughness 1 / no normal)
- [ ] Top-left / top-right / bottom-left lighting
- [ ] Front and rear grazing light
- [ ] Door / window / quoin / coping
- [ ] Curve + module seam
- [ ] Moving-camera pass
- [ ] Silhouette mask vs uniform bevel

## Supersession note (added 2026-09-27)

The tables above were produced by the 2026-07-28 geometry pipeline, before the
"procedural wall stone character" work. They are stale. Re-running
`npm run qa:construction:edge-wear` on current `main` gives:

| Metric | This report (2026-07-28) | Current (2026-09-27) |
| --- | ---: | ---: |
| Near stone triangles, flat | 7840 | 7840 (unchanged) |
| Near stone triangles, relief only | 10760 | 11240 |
| Near stone triangles, relief + edge wear | 13096 | 20600 |
| Near triangle multiplier | 1.670x | 2.6276x |
| Edge-wear stones | 146 | 170 |
| Edge-wear clamped | 5 | 4 |
| Flattened corners | 90 | 100 |

**Why the numbers moved.** Commit `942e8d55` "Sculpt procedural wall stone
edges" changed `ConstructionStoneTopologyResolver.buildLoops` to insert an
inward midpoint on every arris whenever the sampled `edgeMidpointScale` varies
(it always varies: `1 +/- edgeVariation.amount`). The bevel ring therefore
carries eight vertices instead of four, taking one worn near soft stone from 64
to 104 triangles (face grid 3x2 = 24 face tris; bevel + side bands 40 -> 80).
The change is intended and pinned by
`tests/ConstructionStoneTopologyResolver.test.js` ("soft stone topology adds
inward-only hand-cut edge midpoints", `faceLoop.length === 8`). Commit `5fe0d989`
added the relief / edge-wear / LOD profile coverage behind this QA wall, and
`3eb72e6c` integrated the rounded-fieldstone mesher and the rest of the phase-10
look work. This QA wall is the `soft-limestone-rubble` style, so the rounded
mesher itself does not touch it; the soft-path edge sculpting above does.

**Superseded figures.** The "Near stone triangles" row, the "Near triangle
multiplier" row (1.670x PASS), the "Build p50/p95 (ms)" rows and the "Build p95
over Part 1" gate row no longer describe the shipped code. The edge-wear stone,
flattened-corner and clamped counts are superseded too; they scale with the now
larger eligible-stone set (146 -> 170) while per-stone wear is unchanged in
character and clamp rate actually improved (3.4% -> 2.35%).

**Current gates (2026-09-27).** The triangle figures are deterministic
(identical across repeated runs). `nearMultiplier` budget is now 2.8x, and the
wall-clock gate is the median of 15 interleaved worn/relief build pairs (~2.03x,
i.e. ~103% over Part 1) instead of a p95 over 11 samples, which swung 40 points
run-to-run on unchanged code. A deterministic worn/relief triangle gate (1.83x)
sits alongside it. See the gate comments in
`scripts/run-construction-stone-edge-wear-qa.mjs`.

**Ratification.** The recalibrated budgets are a judgement call and should be
ratified by a human: the higher cost is the accepted, intended result of the
edge-sculpting work, but it is a ~57% increase in worn near triangles over the
figures in this report.
