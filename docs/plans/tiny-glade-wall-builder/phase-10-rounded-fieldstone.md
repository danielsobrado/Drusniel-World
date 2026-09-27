# Phase 10 — Rounded fieldstone: the reference game's stone look

Status: **landed 2026-09-24**; follow-up fixes (coarse-band holes, blue shade, frame-rate A/B) 2026-09-26. Depends on Phases 2, 3 and 9.

Phases 2–9 gave the wall builder the reference game's *workflow*. The *look* was
still "flat tilted slabs": lattice quad prisms with a narrow chamfer, a 1–2 cm
face pillow, square corners in the face plane, no footing and, for new walls, an
irregular broken top with no cap. This phase adds a new default style,
`rounded-fieldstone`, that reads like the reference: chunky rounded stones, dark
crevices where the rims roll into the joints, a warm light palette, big footing
stones that sit in the ground, and a neat course of capstones.

Scope was deliberately narrow: **in-world walls, stone look only, new walls
default to it, and all cost stays inside the wall's own geometry and materials**
— no new full-screen passes. Wall chemistry (towers, junctions, arcades, ivy),
build animation, scene lighting and workshop buildings are out of scope.

## Why a new mesher rather than tuning YAML

The soft-stone path cannot get there by tuning. Its topology resolver's
safeguards (`maximumInsetEdgeRatio 0.28`, `minimumFaceAreaRatio 0.58`), its
linear chamfer rings and its four-corner face ring all cap the rounding. So the
style selects `geometry: 'rounded'` and `buildModuleMasonry` hands it to a
dedicated, Three-free pillow-stone mesher; every existing style is untouched.
That was verified bit for bit: packer placements, stats, and near and coarse
geometry for coursed, soft-limestone, ashlar, random and dry-stone walls on flat,
irregular, crenellated and ruined tops are identical to the previous commit.

## What shipped

| Piece | Where |
| --- | --- |
| Style `rounded-fieldstone` (new default), palette `warm-fieldstone` | `masonry/ConstructionStyleCatalog.js`, `workshop/ProceduralWorkshopMaterials.js`, `workshop/ProceduralWorkshopStoneSurfaceConfig.js` |
| Style fields `geometry`, `defaultTop`, `footing`, `coping`, `splitMinHeight` — defaults reproduce the old behaviour | `masonry/ConstructionStyleCatalog.js` |
| Rounding profile (radii, bulge, protrusion damping, category scales, LOD tessellation, baked occlusion, shell shade) | `config/stone-rounding.yml` → `tools/generate-construction-stone-rounding.mjs` |
| Per-stone pillow sampler | `masonry/StonePillowField.js` |
| Rounded face outlines | `compile/PillowStoneOutline.js` |
| Pillow-stone mesher (rim rings, domed faces, side band, analytic normals, draping) | `compile/ConstructionPillowStoneMesher.js` |
| Typed-array writer (no per-stone `BufferGeometry`, no merge) | `compile/MasonryVertexWriter.js` |
| Baked colour and crevice occlusion | `compile/RoundedStoneShading.js` |
| Module builder: fallback prisms, footing burial, draped mortar | `compile/ConstructionRoundedMasonryBuilder.js` |
| Shared stone-shape helpers, moved out of the soft builder | `compile/ConstructionStoneShape.js` |
| Along-wall ground table for draping | `compile/ConstructionArcGround.js` |
| Wall-wide course table with a taller footing course | `masonry/WallCourseTable.js`, `masonry/CourseLattice.js`, `masonry/CurvedCoursePacker.js` |
| Style-sized coping (capstones) | `masonry/CurvedCoursePacker.js` |
| Per-style shell (far band) colour | `render/ConstructionShellMaterials.js` |
| New walls start rounded and capped | `EditorController.constructionDraftRecord` |
| Headless QA with gates | `scripts/run-construction-rounded-stone-qa.mjs`, `npm run qa:construction:rounded` |

Saved walls keep their style and top: every saved record carries `style.key`,
and the schema's `irregular` fallback for walls without an explicit top is
unchanged. Only newly drawn walls change.

## Corrections made during implementation

Found by rendering the castle-ring fixture in a headed browser. The first
tuning looked wrong in ways no headless metric showed.

1. **The first radii made pills, not stones.** Rims at a quarter to a third of
   the short side and corners near a half turned every stone into a stadium,
   and the rolled rims plus a near-black mortar read as wide black bands. The
   shipped profile uses rims of 13–20% and corners of 20–30% of the short side,
   a 3–6% dome, crevice darkening 0.30, and a warm mid-dark mortar
   (`#6b655b`) 7 cm back.
2. **Pushed-back stones went flat.** `stoneJitter`'s protrusion scales with
   `min(width, depth)`, which for a through-stone is the wall thickness, so it
   reached about ±7 cm — nearly the mortar recess. A stone that far back hides
   its rims and reads as a flat slab. The rounded builder keeps 40% of it
   (`protrusionScale`), the way the soft path damps a lattice stone's in-plane
   jitter.
3. **Horizontal splits made sausages.** Two stacked 0.2 m slabs with rolled rims
   look like sausages. `splitMinHeight: 0.24` keeps both halves of a split
   chunky; `targetWidth` came down to 0.95 m to keep the stone count.
4. **The `rubble` normal map drew crack lines.** The surface uses a faint
   `granite` speckle at normal scale 0.1 instead.
5. **Two pre-existing LOD bugs left walls on their ribbons.** Builds drain one
   per frame and `updateLod` runs in between, so:
   - a module queued as `near` and reclassified `coarse` before its turn had its
     build discarded as stale and never re-queued;
   - a module in the far band was built, the result thrown away, and when the
     camera came close nothing queued it again.

   `ConstructionView` now re-queues a stale build for the band wanted now,
   skips building in the far band, and queues a build whenever a module enters
   a masonry band without masonry of that band. Both affected every style;
   `tests/ConstructionViewBuildQueue.test.js` pins them.
6. **No `stone-geometry-lod.yml` entry.** Its transition defaults suit the
   rounded style, so the planned entry was not needed.

## Measurements

`npm run qa:construction:rounded` (report:
`docs/qa/construction-rounded-fieldstone-2026-09-26.md`), relief QA wall, six
planner modules, against the old default for new walls:

| Metric | Coursed rubble | Rounded fieldstone |
| --- | ---: | ---: |
| Triangles per stone, near | 79 | 256 |
| Triangles per stone, coarse | 30 | 64 |
| Module build p50, near | 5.6 ms | 2.1 ms |
| Module build p95, near | 9.5 ms | 3.8 ms |
| Module build p95, coarse | 3.3 ms | 1.1 ms |
| Meshes per module | 2 | 2 |
| Vertex buffers | — | 4 |
| Fallback prisms | — | 0 |

Stones cost about three times the triangles and build two and a half to three
times faster: writing straight into typed arrays removes the per-stone
`BufferGeometry`, `computeVertexNormals` and `mergeGeometries` work that
dominated the soft path. Absolute timings move by a millisecond or two between
runs on the same machine; the ratio holds.

## Follow-up fixes (2026-09-26)

The first report left three items open. All three are fixed.

### Coarse-band holes

At medium range, walls showed mortar through part of their face. The problem
predated this phase and affected every style. It had five causes:

1. **Merged split cells reported one leaf's span.** The coarse reduction merges
   a split cell's leaves into one stone but kept the dominant leaf's
   `support.span`. The course below then saw a half-covered stone above it and
   refused to stretch.
2. **Module seams.** Module boundaries wander per course, so a stone at a
   module's edge reaches past the stones of the course above in its own module,
   and the coverage test refused it. `coarsePlacementsForModule` now passes
   each course's owned arc range (`moduleCourseRange`, exported from the
   packer), and coverage is judged only on the part the module owns. Ruined
   walls keep the strict rule, because a gap across the seam there may be a real
   void.
3. **Uniform stretch against wavy beds.** A kept stone grew by the course's
   mean step. That missed the next kept course by up to twice the bed
   amplitude. `stretchToCourseAbove` puts the stone's two top corners on the
   dropped course's own top bed line instead.
4. **Merged corners were picked by arc position first.** With leaning joints
   the lower leaf's top-right corner won, sloping the merged stone's top down to
   mid-course. Each corner is now the leaves' extreme along that corner's
   diagonal.
5. **Dropped stones that nothing replaces.** Over an arch crown or beside a
   jamb, the course below is dressings or the opening, so no stone stretches up
   into the gap. The module-aware reduction keeps such a dropped stone. On the
   test walls that adds at most four stones per wall, and none on flat tops.

The stretch logic moved into `render/ConstructionCoarseStretch.js`.
`scripts/lib/constructionFaceCoverage.mjs` measures coverage over the whole
wall, pooling every module's stones. It uses exact quads rather than bounding
boxes, masks the openings, and counts dressings as cover. The QA script now
gates on it, and `tests/ConstructionCoarseCoverage.test.js` pins it: coarse
may uncover at most 0.3 points more of the face than near.

Here is how much of the wall face no stone covers, with the same planned walls
reduced by HEAD's coarse reduction and by the current one. "Castle ring" is the
twelve 96 m walls of the `construction-ring` fixture. "QA wall" is the curved
QA wall with its door and window.

| Walls | Near | Coarse at HEAD | Coarse now |
| --- | ---: | ---: | ---: |
| Castle ring, rounded fieldstone | 0.00% | 14.41% | 0.01% |
| Castle ring, coursed rubble | 0.00% | 23.43% | 0.06% |
| Castle ring, soft limestone | 1.98% | 19.15% | 1.99% |
| QA wall, rounded fieldstone | 0.02% | 7.47% | 0.02% |
| QA wall, coursed rubble | 0.04% | 17.15% | 0.16% |
| QA wall, soft limestone | 5.65% | 19.71% | 5.65% |

Soft limestone's near figure is its own joint width, since its wide joints
exceed the scan's 2 cm tolerance. Its coarse band now matches near.

### Shaded faces read blue

The scene's hemisphere light used the sky dome's zenith colour (`#3f83c2`) as
its sky light. With the configured low sun (10°), every face turned away from
the sun was lit almost only by that saturated blue. Light, warm stone read as
cold slate, and it no longer looked the way the workshop, lit by a pale
`#d9edff` sky light, had shown it.

The light a surface gets from the sky integrates the whole dome: the pale
horizon, the sun's aureole and the clouds. It is much less saturated than the
zenith. `stylized/sky/skyAmbient.js` now gives the hemisphere a sky colour
that keeps `stylizedSurface.sky.ambientSaturation` (0.45) of the zenith
colour's saturation at the same luminance. Shaded surfaces keep their tuned
brightness, and only the hue moves. The dome itself is unchanged.

This is a scene-wide change with no frame cost, so grass, terrain and trees in
shade lose their teal cast too. Looks can override the value, and 1 restores
the old light. A wall-only fix would have needed a fake light term, which doc
05 §14 rules out, and would have left workshop buildings in the world blue.

### Frame rate

The first A/B attempt did not measure walls, for two reasons, both fixed in
the harness:

- The `construction-ring` spawn (0, -24) faces -z, but the walls run from
  z = -48 to 48. The player left the corridor in about two seconds, and the rest
  of the run measured terrain with every wall behind the camera. Runs now spawn
  at (0, -100) facing +z, so a 12 s run approaches the corridor through every
  LOD band and ends inside it.
- The warmup was time-based, and the cold first frame compiles for 25–30 s, so
  some runs began measuring with streaming and collision still in flight. One
  recorded 29 frames at 3 FPS with the player waiting for collision.
  `--settle` (`PerfQaSettleGate`) now holds the warmup until collision is
  ready, terrain has stopped loading and the wall build queue is empty, for 60
  frames running.

`--constructionStyle` switches the fixture's walls without editing the
default. Protocol: `npm run qa:perf -- --headed --qa construction-ring --x 0
--z -100 --yaw 180 --warmup 40 --duration 12 --settle --constructionStyle <key>`,
three runs per style, alternating, each in a fresh browser. All six runs
settled.

| Median of 3 runs | Coursed rubble | Rounded fieldstone |
| --- | ---: | ---: |
| Average FPS | 43.8 | 49.0 |
| Frame time p50 | 10.7 ms | 10.5 ms |
| Frame time p95 | 45.6 ms | 33.7 ms |
| Frame time p99 | 77.6 ms | 78.2 ms |
| Hitches (> 33 ms) | 42 | 31 |
| Mean frame time among the walls (z > -70) | 22.9 ms | 19.7 ms |
| Render phase (CPU) | 12.6 ms | 12.4 ms |
| Wall module builds, total | 1,492 ms | 472 ms |
| Stones resident | 8,138 | 9,471 |

**The new default is not slower.** The rounded stones cost about three times
the triangles but render in the same time. Their builds are about three times
cheaper, so fewer frames carry a build spike. The runs shared the machine with
another agent's browser workload, and per-run averages spread from 25 to 61 FPS
(rounded) and 36 to 44 FPS (coursed). Read the frame-rate columns as "no
regression", not as a speed-up. The build totals are deterministic and hold.

Both styles show one 1.6–1.7 s stall at z ≈ 3. That is water chunks turning
wet and the water refraction pipeline compiling (`waterRefractionSlotsPrewarmed`),
not walls.

## Known limits

- **Workshop parity.** The workshop can use the `warm-fieldstone` palette, but
  its walls are still prisms; rounding workshop stones would reuse the same
  mesher.
- **Openings cut courses at their centre height.** The packer splits a course
  around an opening where the opening is at the course's centre height. A course
  whose centre lies below a window sill, or above an arch crown, is not cut, and
  its near stones reach into the opening. This affects every style and predates
  this phase. It was found while measuring the coarse band, and the coverage
  scan masks it.

## Tuning knobs

`src/editor/construction/config/stone-rounding.yml` — `edgeRadius`,
`cornerRadius`, `bulge`, `protrusionScale`, `occlusion.crevice`, per-category
scales and LOD tessellation; the `warm-fieldstone` ramp in
`ProceduralWorkshopMaterials.js`; joint widths in `masonry-joints.yml`;
`footing` and `coping` on the style.
