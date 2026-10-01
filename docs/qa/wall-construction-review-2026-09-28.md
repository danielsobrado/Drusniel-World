# Wall construction review and improvements

Date: 2026-09-28. Scope: current working tree, including the pending Tiny Glade wall improvements.

## Findings fixed in this review

### P1 — Standard stone side faces pointed inward

`ConstructionSoftStoneGeometry.writeSideWalls` emitted the opposite winding to its counterclockwise face loops. Rays from outside the left, right, top, and bottom could miss the nearest stone surface. With front-face rendering, mortar remained visible where the stone should have covered it. Existing checks only verified the front and back winding.

Reversed the side triangles for both near and coarse geometry. Added rays from all six directions, using a front-sided material. The regression failed before the fix and passes afterward. Vertex and triangle counts are unchanged.

Source: [ConstructionSoftStoneGeometry.js](../../src/editor/construction/compile/ConstructionSoftStoneGeometry.js). Test: [ConstructionSoftStoneGeometry.test.js](../../tests/ConstructionSoftStoneGeometry.test.js).

### P1 — Stone displacement could put broad faces behind the mortar

Standard rubble retained the full procedural face displacement, but its backing depth only accounted for the nominal face recess. Moving a stone toward one side of the wall moved its opposite face behind the fixed backing. In the seed-3141 straight-wall probe, 20 of 117 field-stone centers on one face hit mortar first; a WebGPU capture showed large gray patches.

The shared descriptor now reserves the actual displacement inside the mortar depth while keeping the backing centered on the nominal wall plane. Rays from both sides of straight and reversed walls now hit stone at every tested field-stone center. The final standard-masonry capture confirms that the broad gray patches are gone. Stone variation and geometry counts are preserved.

Source: [ConstructionStoneShape.js](../../src/editor/construction/compile/ConstructionStoneShape.js). Test: [ConstructionExposedSurfaces.test.js](../../tests/ConstructionExposedSurfaces.test.js).

### P2 — Mortar covered capstones and exposed wall ends

The backing was recessed through the wall thickness, but expanded beyond the top and terminal edges. On a straight 14 m rounded-fieldstone wall, all 11 cap-center rays and all 12 terminal field-stone rays hit mortar first. This produced the gray top strip and plain end post visible in the earlier capture.

Added a shared, Three.js-free exposure helper derived from placement spans and path closure. Both masonry builders now recess backing at cap tops and real wall endpoints. Interior module joints and closed-loop seams retain their backing footprint. Rounded stones also lose contact occlusion on exposed surfaces, with a smooth blend around the rim. This shading change leaves positions, normals, UVs, and topology unchanged.

Coverage includes near/coarse geometry, reversed paths, multiple seeds, both masonry builders, and preservation of interior/closed-seam backing. This change covers flat coping and wall endpoints; opening reveals, ruined edges, and the full crenellation silhouette still need their own resolved exposure treatment.

Source: [ConstructionStoneExposure.js](../../src/editor/construction/compile/ConstructionStoneExposure.js), [ConstructionStoneShape.js](../../src/editor/construction/compile/ConstructionStoneShape.js), [ConstructionPillowStoneMesher.js](../../src/editor/construction/compile/ConstructionPillowStoneMesher.js). Test: [ConstructionExposedSurfaces.test.js](../../tests/ConstructionExposedSurfaces.test.js).

### P2 — Short walls still left a bare band below their caps

The new course-height solver repeatedly subtracted a height-dependent footing. That iteration oscillated for some low walls, then fell back to the nominal course height. It also required at least one ordinary course above the footing. The 0.8 m and 1.4 m fixtures left approximately 9 cm and 13 cm bare bands.

Replaced the iteration with bounded bisection over the adjacent feasible course counts, including a footing-only wall. The solution remains deterministic and within the existing 80–125% style-height bounds. The two fixtures now fit 0.62 m and 0.61 m courses. Tests check coverage under every cap and sweep wall heights through footing transitions.

Source: [WallCourseTable.js](../../src/editor/construction/masonry/WallCourseTable.js). Test: [ConstructionWallCourseTable.test.js](../../tests/ConstructionWallCourseTable.test.js).

## Current status

The checkout also contains circle-coverage, shared LOD hysteresis, transition-accounting, and opening-band fitting changes. These were preserved. Their construction regression tests pass. Exact curved cuts around arch shoulders remain unfinished; the current band fitting must not be described as the full opening treatment in the handoff.

Semantic authoring and persistence are unchanged. These fixes affect derived geometry and shading, reuse the existing batches/materials, and introduce no per-stone scene objects.

## Verification

- Full repository test run — 2,855 tests passed, zero failures or skips (`tmp/wall-review-tests.tap`).
- `npm run build` — passed. Existing warnings remain for two inventory images, the `WebGLRenderer` import in `NaturalObjectThumbnails.js`, and large bundles.
- Construction and shared-LOD regression run — 82 test files passed, including regressions observed failing before their fixes.
- Additional style edits arrived during the review, including a `worn-limestone` candidate and a flatter face profile. They were preserved. The subsequent focused run passed all 31 geometry tests; the full-suite count above describes the earlier verified snapshot.
- `git diff --check` — passed.
- Twelve isolated WebGPU captures: straight wall, crenellated curve, dense circular tower, arcade, 0.8 m wall, and standard masonry, each in neutral and warm light. No page errors. These use the production planner/builders/materials at ACES exposure 1.12.
- The straight rounded fixture remains 113 stones / 30,284 triangles, and the tower remains 448 stones / 120,064 triangles. These are geometry counts, not evidence of frame-time performance.

Local visual artifacts (ignored `tmp/`, recreate if absent):

- [Before: straight wall](../../tmp/wall-review-appearance-before/straight-neutral.png).
- [After: straight wall](../../tmp/wall-review-appearance-after/straight-neutral.png).
- [After: circular tower](../../tmp/wall-review-appearance-after/tower-warm.png).
- [After: short wall](../../tmp/wall-review-appearance-after/low-neutral.png).
- [After: standard masonry](../../tmp/wall-review-appearance-after/standard-neutral.png).
- [Capture report](../../tmp/wall-review-appearance-after/report.json).

The required headed `construction-ring` movement harness was attempted at x=0, z=-100, yaw=180, warmup=40, duration=12, with settling enabled. It timed out waiting for `window.__perfQa` at 240 seconds, and again at 360 seconds. A separate startup inspection showed “Compiling render pipeline” with no page exception. There is **no fresh valid movement-performance comparison** from this review. The older baseline in the handoff is historical evidence only. Isolated captures do not validate terrain streaming, world lighting, or controls.

## Next improvements, in order

1. **Stone proportions and palette.** The default circular wall still shows a regular grid of padded blocks; the low wall is dominated by its footing. Evaluate the newly added `worn-limestone` candidate alongside it, then tune the YAML profiles toward broader faces, smaller edge rolls, a less dominant footing, and restrained cream/ochre/pink variation. Compare identical neutral-light fixtures before adding vegetation. The candidate's art direction is outside the captures in this report.
2. **Complete exposed masonry.** Extend resolved exposure to arch reveals, crenellations, and ruined edges. Fit stones to arch shoulders so the opening reads as continuous masonry through its thickness. Keep one shared void contour for stone, mortar, shell, collision, and decoration.
3. **Finish the building interaction slice.** Implement the handoff's courtyard/tower/arcade workflow through normal controls: readable snapping, persistent semantic joins, nearby height controls and appearance choices, and predictable undo. Validate local edits without rebuilding unrelated modules.
4. **Restore the movement QA baseline.** Resolve the startup stall and collect matched, settled hardware-WebGPU runs before accepting a rendering-performance claim.

Implementation details and acceptance scenes remain in the [wall handoff](../plans/tiny-glade-wall-builder/implementation-handoff-2026-09-28.md).
