# Wall construction: sandstone defaults and finished battlements

Date: 2026-09-30  
Scope: live wall appearance and repeatable drawing  
Status: implemented; broader reference-matching work remains in Phase 11

Later in the same session, [fitted openings, sandstone variation and ivy](wall-openings-growth-review-2026-09-30.md) completed the next visual slice. Use that review and its [AI testing prompt](wall-openings-growth-test-prompt-2026-09-30.md) for the latest status; the next-work list below records the priorities before that implementation.

## Review and changes

The working tree already contained the `glade-sandstone` preset and curved stone deformation. Its smaller, flatter blocks are closer to the supplied references than the chunky fieldstone preset. This pass fixes the remaining exposed crown surfaces and makes that appearance easier to use.

| Finding | Change |
| --- | --- |
| Fresh drawings still used chunky fieldstone | New strokes and their previews use `glade-sandstone`, including its flat capstones. Saved records retain their style; the schema fallback is unchanged. |
| Repeating an edited wall's appearance required another round of adjustments | **Draw matching wall** copies its style, materials, top type, nominal height and thickness into the drawing brush. |
| Mortar covered exposed battlement tops and sides | Resolve exposed edges from each small ornament layout before meshing. Recess mortar and remove contact shading only along exposed edges, including arrow-loop soffits. |
| Raised battlement blocks floated above the body | Seat their bottom course directly on the wall. Keep variation at the crown. |
| Bare backing appeared below the battlements at some heights | Fit complete body courses to the crown using the existing bounded course-height solver. Keep exposed crown cells intact in coarse geometry. |
| The last battlement could extend beyond an open wall | Clip its resolved footprint to the path endpoint before generating its units. |
| Matching changed brush dimensions without updating their fields | Synchronize height and thickness controls while preserving active input editing. |

Matching is session brush state. It does not clone the source path, openings, damage or local height profile. Each new wall gets its own seed and normal undo entry. Choosing the brush look itself does not change the source wall or add history.

### Using it

1. Draw a wall: new sessions now start with sandstone.
2. Select an existing wall and choose **Draw matching wall** from its nearby action buttons, or open its properties and use the labeled button.
3. Drag another curve. Continue drawing additional walls with the same look.
4. Undo/redo operates on each new wall independently.

## Visual evidence

Fresh captures use the production planner, meshes and materials in a fixed WebGPU scene, under neutral and warm light at ACES exposure 1.12. Vegetation is absent so it cannot conceal geometry defects.

- Curved battlements: [before](../../tmp/wall-sep30-before/curve-warm.png), [after](../../tmp/wall-sep30-after/curve-warm.png).
- [Straight capped sandstone](../../tmp/wall-sep30-after/straight-neutral.png).
- [Closed tower](../../tmp/wall-sep30-after/tower-neutral.png).
- [Low wall](../../tmp/wall-sep30-after/low-neutral.png).
- [Arched wall](../../tmp/wall-sep30-after/arches-warm.png).
- [Matching controls in the editor](../../tmp/wall-sep30-after/matching-controls.png).
- [Capture report](../../tmp/wall-sep30-after/report.json).

These are local, ignored QA artifacts. Reproduce with the local helper:

```powershell
rtk proxy node tmp/run-construction-appearance-qa.mjs --headed --url http://127.0.0.1:5180 --style glade-sandstone --out tmp/wall-sep30-after
```

The curved fixture grows from 712 stones / 54,112 triangles to 771 / 58,596 because its body now reaches the battlements with complete courses. Straight, tower, arch and low-wall fixture counts are unchanged. No per-stone scene objects were added.

## Verification

- Full repository suite: **2,874 passed**, no failures or skips.
- After the final numeric-field synchronization: **11 relevant editor/drawing tests passed**.
- New regression coverage checks both matching actions, independent seeds/material state, source preservation, and preview/commit defaults.
- Surface ray tests cover sandstone and rounded fieldstone, near/coarse geometry, and wall heights 1.4, 3.2 and 3.5 m. They verify stone rather than mortar is visible at exposed crown surfaces. Ornament tests cover base contact and arrow-loop exposure.
- Headed browser: clicked the properties matching button, drew a curved wall with the pointer, clicked the nearby matching action, and used Ctrl+Z / Ctrl+Shift+Z. Drawing remained active, counts changed 12 → 13 → 12 → 13, the source revision stayed at 1, dimensions matched the controls, and there were no page errors.
- Production build passes. Existing warnings remain for two inventory images, the `WebGLRenderer` import in `NaturalObjectThumbnails`, and large bundles.
- `git diff --check` passes.

### Movement performance

Before and after use frozen production builds and the same headed NVIDIA hardware-WebGPU corridor scenario: x=0, z=-100, yaw=180, warmup=40 s, duration=12 s, settled, `glade-sandstone`. No second QA browser runs during measurement.

Reports: [before](../../tmp/wall-sep30-perf-before.json), [after](../../tmp/wall-sep30-perf-after.json).

| Metric | Before | After |
| --- | ---: | ---: |
| Average FPS | 55.79 | 56.22 |
| Frame time p50 | 13.90 ms | 13.90 ms |
| Frame time p95 | 34.96 ms | 34.40 ms |
| Frame time p99 | 76.23 ms | 80.46 ms |
| Hitch rate (>33.3 ms) | 7.52% | 6.72% |
| Planned resident stones | 25,768 | 27,620 |
| Resident modules | 96 | 96 |
| Near / coarse / shell modules at end | 0 / 38 / 58 | 0 / 38 / 58 |
| Construction queue at end | 0 | 0 |
| Collision p95 | 0.10 ms | 0.10 ms |

Both runs settled after 0.7 s, retained complete frame samples, and passed collision readiness. This pair shows similar overall frame time with increased crown geometry; it does not establish a speed improvement. The p99 tail worsened slightly. Both runs exceed the 33.3 ms p95 / 2% hitch targets, so performance acceptance remains open. This approach scenario also finishes in coarse/shell tiers and does not replace sustained near-wall measurements.

## Next work, in order

1. **Arch shoulders and reveals:** fit stones to the exact shared opening contour. Preserve matching collision, shell and masonry masks at every LOD.
2. **Stone proportions and edge wear:** increase the variety of block heights and widths, with restrained chipped corners and broad flat faces. The current curved fixture still reads as orderly brickwork compared with the references. Judge under both lighting setups before changing color again.
3. **Simple shape creation and joins:** complete the courtyard interaction slice with obvious straight/curve/loop creation and persistent semantic connections. Keep live previews stable and edits local.
4. **Ground contact and growth:** add sparse moss/ivy/flowers from deterministic resolved contact rules; keep paths and openings clear.
5. **Performance acceptance:** complete the longer near-wall and streaming matrix before calling the visual pass release-ready.

Follow the [implementation handoff](../plans/tiny-glade-wall-builder/implementation-handoff-2026-09-28.md) and [Phase 11](../plans/tiny-glade-wall-builder/phase-11-look-feel-and-usability.md). The supplied references remain the target; this pass completes another slice rather than the full courtyard/tower/arcade experience.
