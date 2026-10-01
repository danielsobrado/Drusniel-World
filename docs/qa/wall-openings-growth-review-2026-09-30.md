# Wall construction: fitted openings, sandstone variation and ivy

Date: 2026-09-30  
Status: implemented; Phase 11 and release performance acceptance remain open.

## Changes

| Review finding | Implemented improvement |
| --- | --- |
| Flat stone undersides left stepped gaps above arches | Clip shoulder stones to a polygon sampled from the shared opening contour. Keep fitted pieces intact in near/coarse geometry. |
| Separate face dressings left unfinished interior reveals | Jambs and arch wedges span the wall thickness; their backing retreats from the reveal. The center wedge is the keystone. |
| Overlapping opening columns depended on input order | Sort and union columns before packing their remaining material. |
| Coarse merging lost exposed ends and jambs, showing brown backing patches | Derive path-end exposure from the actual cell boundary and carry exposed edges from all merged leaves. |
| Sandstone looked too repetitive | Raise nominal courses from 0.30 to 0.34 m and target block width from 0.36 to 0.43 m; add more within-course splits, bed variation and corner-radius variation while retaining flat faces. |
| Walls lacked small ground-contact details | Add deterministic, sparse ivy with connected stems. Root stems on the terrain at each wall face, including slopes. |
| Growth needed a simple reversible control | Add **Ground growth: Natural / None** to sandstone properties. Persist the optional mode, support undo/redo and copy it with **Draw matching wall**. |
| Undo restored the ivy but left the inspector showing None | Refresh open properties after history changes; close them when the inspected wall disappears. |

Fitted polygons are compiled into the existing stone/mortar batches. Ivy adds one mesh per occupied detailed module with a shared material, capped at 192 leaves. No per-stone or per-leaf scene objects are added. Growth-only commands preserve resident masonry geometry, pending structural work and active collision revision. Generated stones and vegetation remain derived data.

The new `wall-growth.yml` profile has a generator and freshness check. The renderer uses no new textures or per-frame vegetation update loop.

## Verification

- Full repository suite at final code validation: **2,908 passed**, zero failures/skips. The shared checkout also contains unrelated work; this is the observed suite count, not a count of tests added by this pass.
- Production build passed. Existing inventory-image, thumbnail `WebGLRenderer` import and bundle-size warnings remain.
- Growth and rounding generator freshness checks passed. `git diff --check` passed.
- Geometry regressions inspect actual meshes for all four opening profiles, three masonry styles and near/coarse tiers. They verify open passages, finite vertices and stone surfaces across the arch thickness.
- A fresh coarse render exposed two additional faults at the ends and jambs. A failing ray regression reproduced both before their fixes; the full suite and recaptured coarse arcade now pass.
- Growth checks cover determinism, module ownership, opening clearance, terrain contact on both faces of a slope, saved state, history, matching, and toggling during an in-flight compile.
- Headed editor check: Natural -> None -> undo -> redo produced 192 -> 0 -> 192 -> 0 resident leaves for the inspected module. The original stone/mortar geometries remained resident. The dropdown followed undo/redo after the fix. Matching entered Draw mode with `growth: none`. No page errors. [Interaction report](../../tmp/wall-next-growth-ui.json).

### Visual evidence

The tracked harness `scripts/run-construction-appearance-qa.mjs` uses production planning, meshes and materials with a fixed camera, neutral/warm light and ACES exposure 1.12. It captures nine semantic scenes and verifies WebGPU.

- [All four opening profiles](../../tmp/wall-next-near/arch-profiles-warm.png).
- [Curved wall with sparse ivy](../../tmp/wall-next-near/growth-warm.png).
- [Crenellated curve](../../tmp/wall-next-near/curve-neutral.png).
- [Coarse openings](../../tmp/wall-next-coarse/arch-profiles-warm.png).
- [Reverse face, growth disabled](../../tmp/wall-next-reverse/arches-neutral.png).
- [Ground growth control](../../tmp/wall-next-near/growth-controls.png).
- Capture reports: [near](../../tmp/wall-next-near/report.json), [coarse](../../tmp/wall-next-coarse/report.json), [reverse](../../tmp/wall-next-reverse/report.json).

These are ignored local artifacts. Reproduce them with the commands in the [independent testing prompt](wall-openings-growth-test-prompt-2026-09-30.md). The isolated fixture makes masonry defects visible; it does not demonstrate the complete landscaped courtyard experience.

## Performance

All runs used frozen production builds, headed NVIDIA hardware WebGPU, the sandstone corridor, x=0/z=-100/yaw=180, 40 s warmup, 12 s measurement and `--settle`. QA browsers ran sequentially. The final build includes the coarse end/jamb fixes.

| Metric | Initial baseline | Final candidate |
| --- | ---: | ---: |
| Average FPS | 54.57 | 54.21 |
| Frame p50 | 14.20 ms | 14.30 ms |
| Frame p95 | 34.35 ms | 37.00 ms |
| Frame p99 | 77.85 ms | 79.84 ms |
| Hitch rate (>33.3 ms) | 8.29% | 8.98% |
| Resident planned stones | 27,620 | 21,245 |
| Resident modules | 96 | 96 |
| Final near / coarse / shell modules | 0 / 38 / 58 | 0 / 38 / 58 |
| Final construction queue | 0 | 0 |
| Collision p95 | 0.10 ms | 0.10 ms |

Both rows settled after 0.7 s, retained complete frame samples and passed collision readiness. Neither meets the p95 <=33.3 ms / hitch <=2% targets.

**Comparison limit:** this is not an isolated wall-code A/B. Other work changed world contact shading, river surface settings and ground assets during the session. An intermediate candidate ran at 13.46 FPS; a recheck of the identical frozen baseline also slowed to 14.80 FPS, before the final candidate returned to 54.21 FPS. That variation prevents attributing the overall timing difference to these wall changes. The final run demonstrates working rendering and collision under the harness, with performance acceptance still open. It does not establish a speed improvement.

Reports: [initial baseline](../../tmp/wall-next-perf-before.json), [intermediate candidate](../../tmp/wall-next-perf-after.json), [baseline recheck](../../tmp/wall-next-perf-baseline-recheck.json), [final candidate](../../tmp/wall-next-perf-final.json), [configuration differences and comparison](../../tmp/wall-next-perf-comparison.json).

The final build is `tmp/wall-next-final-dist`; the prior candidate and baseline directories remain available for review. The approach route ends in coarse/shell geometry and does not replace sustained near-wall, arcade-heavy and full streaming-matrix acceptance.

## Remaining priorities

1. Complete simple straight/curve/loop creation and persistent semantic joins as one courtyard interaction slice. Keep previews immediate and local edits stable.
2. Continue sandstone art tuning against the actual reference screenshots. The bond remains more regular than the references; per-corner wear and broader size families need further work.
3. Extend ground contact beyond this sparse ivy pass: context-sensitive moss/flowers, path clearances and local suppression areas.
4. Test overlapping dressed openings, tight curves, module seams, player passage and longer near-wall workloads independently. The new ray tests and fixed fixtures cover representative cases, not every valid authored shape.

**Testing handoff:** [Prompt for another AI](wall-openings-growth-test-prompt-2026-09-30.md).
