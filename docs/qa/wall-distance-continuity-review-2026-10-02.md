# Wall distance continuity review — October 2

This follows the [crown and close-up pass](wall-crown-detail-review-2026-10-02.md).
It addresses the sandstone wall changing its block arrangement when switching
between near and coarse geometry.

## Result

Sandstone now keeps every resolved stone in the coarse band: split inserts,
course spacing, cap variation, opening contours, ruin voids, stable indices and
module boundaries all retain their near placements. Distance simplification
happens inside each stone's geometry.

The style catalog declares `coarseLayout: preserve` for sandstone, with `merge`
as the default for existing styles. The renderer reads this policy rather than
adding a sandstone-specific construction branch. It returns the authoritative
placement array without mutation. Semantic authoring and edit locality remain
unchanged.

Ordinary coarse sandstone stones now have **32 triangles**, compared with
64 before and 96 near. The rounded-outline sampler can take one sample on
each corner's bisector instead of subdividing its arc. It retains the sampled
corner wear and stays inside the solved footprint. Near geometry retains its
arc endpoints and edge midpoints. The rounding YAML and generated profile are
updated together; zero arc subdivisions are allowed only in the coarse config.

The distant outline is an approximation. Small bevel and silhouette differences
remain; this pass removes block rearrangement rather than making every vertex
identical between tiers. Contour-fitted opening pieces retain their polygon
geometry and do not have the ordinary 32-triangle count.

## Geometry tradeoff

The fixture reports below include stone, mortar and growth triangles.

| Fixture | Near stones / triangles | Previous coarse stones / triangles | New coarse stones / triangles |
| --- | ---: | ---: | ---: |
| Straight | 313 / 34,476 | 145 / 11,692 | 313 / 14,444 |
| Tower | 651 / 70,308 | 328 / 24,928 | 651 / 28,644 |
| Low wall | 91 / 10,500 | 85 / 7,132 | 91 / 4,676 |

Keeping stones raises total distant geometry on the straight wall by about 24%
and tower by about 15%, even though each ordinary unit costs half as much. The
low wall becomes cheaper. Mortar detail and polygon-fitted pieces contribute to
the total. Stones remain batched: the normal stone-and-mortar build contract
uses two meshes, without per-stone scene objects.

Previous captures: `tmp/wall-oct2-final-coarse/`.
Current matching near/coarse views: `tmp/wall-layout-{near,coarse}/`.
The straight wall's split inserts and course pattern now agree between captures.

## Checks

- **2,944 tests passed**, zero failures. Production build passed and generated
  rounding output passed `--check`. Existing build warnings about inventory
  images, the thumbnail renderer import and large chunks remain.
- Planned sandstone modules retain exact placement identity and immutable plans
  across flat, irregular, crenellated and ruined walls, low and standard heights,
  curved paths, openings and module seams. Existing merge behavior tests for
  other styles still pass.
- The 120-seed small/thin/leaning stone sweep checks finite geometry, unit normals,
  packed bounds, outward winding and closed surfaces at the new coarse topology.
  A separate outline test checks stable corner wear indices and bounded distance
  approximation. The builder regression checks identical stone counts, unchanged
  mortar triangle counts, one-third ordinary stone triangles and two batched meshes.
- Headed hardware WebGPU appearance checks passed under neutral and warm light,
  with no page errors: near and coarse straight/curve/tower/arch-profile/low
  walls, coarse back views of straight/tower/low, and rounded-fieldstone coarse
  straight/low walls. The actual straight, curve and low-wall captures were inspected.

Artifacts:

- `tmp/wall-layout-near/`, `tmp/wall-layout-coarse/` — identical camera poses in
  the two bands; `straight-warm.png` makes the layout continuity visible.
- `tmp/wall-layout-back/`, `tmp/wall-layout-rounded/` — reverse and other-style checks.
- `tmp/wall-layout-tests.log`, `tmp/wall-layout-build.log`.

## Performance comparison

The frozen before build includes all changes from the preceding crown pass.
The frozen after build adds this distance-layout policy and topology reduction.
Both used NVIDIA hardware WebGPU, the settled construction ring route at
`x=0,z=-100,yaw=180`, 40 s warmup and 12 s measurement. GPU browsers ran
sequentially; full tests were run outside the measured performance intervals.

| Metric | Before | After |
| --- | ---: | ---: |
| Average FPS | 61.24 | 61.56 |
| Frame p95 | 34.06 ms | 33.30 ms |
| Hitch rate | 6.16% | 5.18% |
| Cumulative construction build time | 1,209 ms | 1,427 ms |

Both settled, kept complete frame buffers, ended with 96 resident modules and
an empty construction queue, and passed collision readiness/timing with p95
0.1 ms. End residency was identical: 0 near, 38 coarse, 58 shell.

Frame performance was similar in this pair, while cumulative construction build
time increased **about 18%**. More pieces must be sampled and compiled, despite
their cheaper geometry. This is a visual-continuity improvement with a measured
build-cost tradeoff, not a proven frame-rate gain. **Release acceptance remains
open:** hitch rate is above the 2% target. The route does not establish sustained
close-up performance. Raw evidence: `tmp/wall-layout-perf-{before,after}.json`.

## Remaining priorities

The sandstone near/coarse arrangement issue is addressed. Other styles still
use their existing cell/course merging. The shell tier still omits masonry, and
bevel/shadow changes can remain visible at tier boundaries. Warm scene lighting,
softer shadows, richer ivy branching and ground contact decoration remain the
next visual gaps against the supplied references.

Use the [independent testing prompt](wall-distance-continuity-test-prompt-2026-10-02.md)
for fresh appearance, transition and performance verification.
