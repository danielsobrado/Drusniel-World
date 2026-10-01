# Wall construction: Tiny Glade appearance and interaction handoff

Date: 2026-09-28  
Status: **Partially implemented; see the current review below for completed fixes**  
Reviewed source: `fd4a5f5a` (`migration WIP`)  
Scope: live walls, shared masonry generation, openings, connected walls, and the building controls

## 1. Assignment for the implementing AI

Make wall construction substantially closer to the user's Tiny Glade references in both appearance and use. Deliver visible improvements to masonry, curves, exposed ends, tops, arches, grounding, and direct manipulation. A material recolor alone does not meet this assignment.

Start with the reproducible geometry and LOD defects in section 4. Then finish one complete visual slice: **a warm stone courtyard with a curved wall, an open circular tower, and a tall arched passage**. The user must be able to draw, reshape, raise, recolor, and undo this scene through normal controls.

This document gives the implementation order for the remaining work in [Phase 11](phase-11-look-feel-and-usability.md). Its September 28 findings supplement that document's September 27 status. Preserve the fixes already shipped. Recheck the current checkout before changing code; later commits may have addressed individual findings.

### Read first

- Repository `AGENTS.md` and `CLAUDE.md`, including the referenced RTK instructions. Prefix shell commands with `rtk`.
- [Workshop geometry framework](../../architecture/workshop-geometry-framework.md).
- [Workshop implementation plan](../workshop-geometry-framework-plan-2026-08-19.md).
- [Tiny Glade public-behavior review](../../research/tiny-glade-workshop-behavior-review-2026-08-19.md).
- [Player movement performance QA](../../perf-qa.md).
- [Phase 10: rounded fieldstone](phase-10-rounded-fieldstone.md) and [Phase 11](phase-11-look-feel-and-usability.md).

### Working rules

1. Store curves, dimensions, styles, opening intent, and explicit relationships as semantic state. Derive individual stones, clipping products, mortar, vegetation, collision, and render batches.
2. Resolve automatic connections and building reactions deterministically. Persist an explicit override when the user promotes or changes an automatic result.
3. Use the existing semantic/registry framework. First inspect which workshop capabilities already exist and adapt the live wall tools to them; avoid a second wall model or editor.
4. Keep random choices attached to stable semantic identities. A local edit must preserve unrelated stone shapes, colors, and decoration.
5. Keep local edits local. Preserve dirty-segment/module invalidation, material-only updates, worker boundaries, and floating-origin transforms.
6. Batch geometry. Do not add a scene object or material per stone, leaf, or mortar joint.
7. Keep `stoneJitter` responsible for unit variation and preserve category-scaled dressings. Use bevel lighting and bounded vertex occlusion for separation.
8. Keep world and workshop tone mapping/exposure consistent. The current contract is ACESFilmic at exposure 1.12. Change shared lighting only with evidence from both views.
9. Edit YAML sources and run their generators. Do not manually patch generated profile files.
10. Keep modules focused. `EditorController` and `ConstructionView` already have many responsibilities; extract interaction or geometry responsibilities as they become necessary for this work.

## 2. What the references require

The user supplied low curved walls, crenellations, hollow circular enclosures, and a taller curved arcade around a tower. Treat those screenshots as the visual target, including their ordinary editing views.

The [linked article](https://opgamemarketing.substack.com/p/tiny-glade-an-indie-game-by-2-devs) provides product context about relaxed creative building and consistent presentation. It is not a specification of Tiny Glade's renderer or private geometry algorithms. The architecture proposals below are recommendations for this repository.

| Feature visible in the references | Required result here |
| --- | --- |
| Broad, fairly flat stone faces with worn edges | Smaller edge rolls, restrained face bulge, uneven corner softness; retain a clear block shape |
| Mixed stone sizes within a coherent bond | Staggered joints, occasional subdivisions, gently wandering beds; no repeated rows of identical capsules |
| Cream, ochre, dusty pink, and muted grey/green stones | Related colors with restrained variation, visible under neutral light as well as sunset |
| Narrow recessed joints | Stones feel packed together; joint depth reads through shading without a black grid |
| Continuous curved masonry | Courses follow both wall faces; closed loops remain hollow and have no visible starting seam |
| Rounded, irregular wall silhouette | Real capstones and terminal stones; no continuous flat slab exposed at the top or end |
| Tall arches and slim supporting piers | A clean shared opening contour, believable dressing, continuous masonry through the opening reveal |
| Grass, moss, ivy, and flowers at selected contacts | Sparse, context-driven growth that respects passages and visible stonework |
| Small controls close to the structure | Easy drawing and height changes, understandable snapping, compact appearance choices |
| Calm construction feedback | Stable previews, quick response, reversible edits, no unrelated masonry reshuffling |

### Art direction hierarchy

Evaluate changes in this order:

1. Overall proportion and silhouette.
2. Stone scale, layout, and fitting at openings/ends.
3. Face shape, bevels, joints, and contact shading.
4. Color families and broad weathering.
5. Vegetation and small decorative details.
6. Animation, sound, and control polish.

Show every visual milestone without vegetation first. Extra detail must not conceal unfinished stone geometry.

## 3. Current status and review evidence

### Latest implementation: fitted openings and growth, September 30

The [latest review](../../qa/wall-openings-growth-review-2026-09-30.md) records fitted arch shoulders, full-depth reveals, more varied sandstone blocks and sparse rooted ivy. **Ground growth: Natural / None** is persisted, reversible and copied by **Draw matching wall**; toggles retain existing masonry geometry. The full suite passed 2,908 tests and the production build passed. Use the [independent testing prompt](../../qa/wall-openings-growth-test-prompt-2026-09-30.md) to verify fresh visuals, interactions and performance. Semantic joins, dedicated shape tools and the complete courtyard workflow remain open. Earlier review sections below are historical.

### Follow-up implementation review, September 30

New drawings now use the existing `glade-sandstone` preset. **Draw matching wall** copies a selected wall's appearance and dimensions into the brush from either its nearby actions or properties. Exposed battlement surfaces show stone, raised blocks sit on the wall, terminal blocks fit the path, and complete body courses reach the crown. Saved wall styles and the schema fallback retain their meaning.

Read the [September 30 changes, visual comparisons, interaction checks and performance results](../../qa/wall-construction-followup-2026-09-30.md). The full suite passed 2,874 tests. Exact arch-shoulder fitting, more varied stone proportions, semantic joins and the full courtyard interaction slice remain open. Earlier findings below are historical and must be checked against this status before implementation.

### Follow-up implementation review, September 28

The working tree now includes fixes for dense-circle coverage, LOD band transitions and their counters, and fitting courses around opening height bands. This review additionally fixed short-wall course fitting, mortar covering flat caps, terminal stones and displaced stone faces, and inward-facing side triangles in the standard stone mesher. The full test suite and production build pass. Fresh isolated WebGPU captures show the cap/end improvement; movement-performance verification is blocked by harness startup timeouts.

Read the [follow-up review, verification, and remaining priorities](../../qa/wall-construction-review-2026-09-28.md) before implementing the findings below. Sections 3–4 otherwise preserve the original observations and reproductions; completed defects should be kept as regression cases. Exact arch-shoulder fitting, broader art direction, and the complete interaction slice remain open.

### Already working; retain regression coverage

The September 28 run passed **77 construction test files** from `test/` and `tests/`. This was a focused run, not a new full-repository test result.

- Drawing remains active after committing a wall.
- Stroke acceptance uses accumulated length, including closed loops.
- Cutting has a carved-shell preview.
- Reshaping retains unaffected masonry and reuses preview buffers.
- Valid drafts use wall appearance, with tool color reserved for invalid drafts.
- Ctrl suppresses snapping; Shift provides fine movement.
- Grid snapping is opt-in; nearest-target selection and screen-space snap hysteresis exist.
- The inspector exposes the full wall material list.
- Material edits preserve pending structural compilation and resident geometry.
- Tested upstream edits preserve distant module geometry and identity.
- Shell, mortar, collision, and decoration exclusion share `OpeningLayout`.
- Deleting a node from the reviewed closed loop preserved all surviving segment endpoints in a fresh probe.

Relevant tests include `ConstructionStrokeClosure`, `ConstructionAppearanceCompilation`, `ConstructionPlannerSeedStability`, `ConstructionCurveEditing`, `ConstructionOpeningCollisionSpan`, `ConstructionShellOpenings`, `ConstructionDraftContinuity`, `ConstructionSnapHysteresis`, and `ConstructionWallMaterials`.

### Fresh visual evidence

Review captures are available locally:

- [Actual world, overview on WebGPU](../../../tmp/wall-status-webgpu-2026-09-28.png).
- [Actual world, near masonry](../../../tmp/wall-status-near-2026-09-28.png).
- [Straight wall under controlled neutral light](../../../tmp/wall-look-before/straight-neutral.png).
- [Arches under controlled warm light](../../../tmp/wall-look-before/arches-warm.png).
- [Dense circle showing a planning defect](../../../tmp/wall-look-before/tower-neutral.png).

These files are in ignored `tmp/` and may be absent in another checkout. Recreate the fixtures in section 6; this plan does not depend on retaining those files.

The world capture used `WebGPUBackend` with an NVIDIA Lovelace adapter. The earlier headless capture used WebGL and is not the comparison baseline. The controlled captures use the production planner, material factory, and masonry builder in a simple test scene. They isolate geometry; they do not validate terrain, streaming, controls, or the complete world lighting setup.

Observed problems:

- Broad, rounded face rims make many stones look padded.
- Tops form a long, visually flat strip; exposed ends read as plain posts.
- The large footing course dominates a short wall.
- The masonry remains quite uniform in color and course rhythm.
- Some neighboring walls show radically different detail levels at the same overview scale.
- Tall arches are recognizable, but their surrounds and piers read as regular stacked units rather than integrated, worn masonry.

### Performance baseline

Local report: `tmp/wall-look-baseline-2026-09-28.json`.

| Measurement | September 28 baseline |
| --- | --- |
| Backend | Hardware WebGPU, NVIDIA / Lovelace |
| Scenario | `construction-ring`, rounded fieldstone |
| Camera route | x=0, z=-100, yaw=180; 12-second approach |
| Warmup / settle | 40 seconds; settled=true; no remaining blockers |
| Average FPS | 76.25 |
| Frame time p95 / p99 | 29.2 ms / 54.33 ms |
| Hitch rate above 33.3 ms | 2.74% |
| Resident construction modules | 96 |
| Collision readiness / timing gate | Passed |

The baseline already exceeds the guide's 2% hitch-rate target. Record this as an existing failure; do not label the baseline a complete performance pass. One run is comparison evidence, not a stable hardware budget. Collect matched repeats when deciding whether a change causes a regression.

Startup also warned that the tree-impostor manifest did not match the current source assets and would use runtime baking. Keep asset state consistent across comparisons and resolve that environment issue before claiming a release performance pass. The WebGL attempt logged a texture-unit shader limit; use the successful hardware WebGPU captures for this wall review.

## 4. Confirmed defects to address first

### A. Short curve segments disappear from the masonry plan

**Reproduction:** fit a closed circle of radius 3.6 m from 32 points, with `simplifyTolerance: 0.02`. The sampled path is approximately 22.583 m long with 32 semantic segments. `planConstruction` emitted only one module and 12 stones in this review. The rendered result is a small wall fragment.

```js
const points = Array.from({ length: 32 }, (_, i) => [
  Math.cos(i * Math.PI / 16) * 3.6,
  Math.sin(i * Math.PI / 16) * 3.6,
]);
const path = createCubicBezierPathFromStroke(points, {
  closed: true,
  simplifyTolerance: 0.02,
});
// Normalize a rounded-fieldstone wall, height 3.2, thickness 0.8,
// flat top, seed 3141; then sample and plan it.
```

**Code to inspect:** `construction/planning/ConstructionPlanner.js`, its `segmentPoints.length < 2` early continue, and the sampler's ownership of shared endpoints. The sampler removes duplicate segment-start samples; a valid short segment can therefore own only one retained sample.

**Implementation requirements:**

- Obtain both segment boundaries from the semantic segment/arc interval even when only one sampled point carries that segment ID.
- Reject true zero-length spans using the curve tolerance policy.
- Cover the entire closed path once, preserving stable segment identities and local module hashes.
- Test dense and sparse circles, short open segments, shallow curves, and a node inserted into a short segment.
- Verify shell, masonry, collision, and selection agree about the complete loop.

Do not work around this by forcing a circle tool to emit fewer anchors.

### B. LOD hysteresis can retain a flat shell at close range

**Reproduction:** `selectConstructionLod({ pixels, previous: 'shell' })` currently returns:

| Projected wall height | Result |
| --- | --- |
| 100 px | coarse |
| 139 px | coarse |
| 140–161 px | shell |
| 162 px | near |

This is a history-dependent failure when a wall enters view or a zoom skips an intermediate band. A larger wall can keep its shell while a smaller neighbor receives stone geometry.

**Code to inspect:** `construction/render/ConstructionLod.js` and `stylized/lod/projectedLod.js`. The shared selector retains the previous band when the candidate near threshold is within hysteresis, even if the intermediate coarse threshold has already been crossed.

**Implementation requirements:**

- Resolve hysteresis across the intervening bands. If near detail is held back, choose an eligible coarse band rather than retaining a distant shell.
- Cover zoom jumps, streaming arrivals, selected-wall pinning, normal threshold oscillation, and transitions in both directions.
- Prefer a correction to the existing selector with regression coverage. If the shared selector changes, run its vegetation and object consumers' tests and the required performance comparisons.
- Check transition diagnostics too: `ConstructionView.updateLod` currently increments starts on repeated frames while waiting for the same queued build. Count actual transition requests, separately from suppressed duplicate enqueues.

### C. Near stones still intrude into opening contours

**Reproduction:** a 12 m straight wall, height 3.5 m, thickness 0.8 m, rounded fieldstone, seed 5, with a centered round window: width 2 m, height 2 m, sill 0.7 m, undressed.

A ray grid through the authored void, inset at least 5 cm from its horizontal boundary, found **11 near-masonry hits out of 1,337 samples** and **zero shell hits**. One example was x=6.765 m, y=2.25 m. `CurvedCoursePacker` subtracts opening intervals at the course center, allowing the rest of a stone to cross the curved contour.

**Implementation requirements:** section 9. This must be fixed before the reference arcade is accepted.

## 5. Delivery order

Use small, reviewable changes. Each stage must include evidence before it is marked complete.

| Stage | Deliverable | Depends on | Exit evidence |
| --- | --- | --- | --- |
| 0 | Repeatable visual and interaction fixtures | Existing checkout | Captures, source revision, renderer identity, current failures |
| 1 | Complete curve coverage and correct LOD promotion | 0 | Dense circle renders fully; zoom cannot strand a close wall as a shell |
| 2 | New masonry shape/layout/color profile | 1 | Neutral and warm comparisons of straight, curved, and circular walls |
| 3 | Finished tops, terminal stones, reveals, and corner treatment | 2 | All exposed surfaces read as stone from both sides and above |
| 4 | Accurate opening clipping and integrated arcade | 1–3 | Clean near/coarse/shell contours and matching collision |
| 5 | Persistent joins and stable local editing | 1, existing semantic framework | Connected edit, undo, and save/load demonstrations |
| 6 | Easier shape tools and appearance controls | 5 | Courtyard workflow through ordinary controls |
| 7 | Grounding, weathering, and sparse vegetation | 3–5 | Masked detail that stays stable through edits |
| 8 | World/workshop parity and release verification | All above | Fixture matrix, interaction checks, performance report |

**First visible delivery:** stages 0–4. Make the plain wall, hollow tower, and arcade look convincing before expanding decorative detail. Continue through stages 5–8 for the full building experience requested by the user.

## 6. Stage 0: establish a reusable comparison scene

Add a tracked construction appearance QA runner using the existing Playwright/WebGPU patterns. Temporary review helpers are in `tmp/run-construction-appearance-qa.mjs` and `tmp/ConstructionAppearanceFixture.js` if still present; review and promote their useful parts rather than depending on ignored files.

### Fixture definitions

Use deterministic seeds and semantic records. Include:

1. **Straight wall:** 14 m long, 3.2 m high, 0.8 m thick, flat top, seed 3141.
2. **Low garden wall:** 8 m long, 1.2 m high, 0.45 m thick; plain and irregular tops.
3. **Open curve:** points `[-5,3], [-5,0], [-3,-3], [0,-4], [3,-3], [5,0], [5,3]`; plain and crenellated tops.
4. **Hollow tower:** the radius-3.6 m dense circle from section 4; an additional four-cubic circle checks curve representations.
5. **Arcade:** a 14 m straight wall, 5.5 m high, thickness 0.8 m, with round arches at arc fractions 0.18, 0.5, 0.82; width 3 m, height 4.4 m, sill 0. Repeat on a broad curve.
6. **Opening matrix:** round, pointed, segmental, and flat profiles; raised sill; a cut crossing a segment/module seam; adjacent openings.
7. **Connections:** L, T, and unequal-height connections; an intentional detached endpoint nearby.
8. **Terrain:** shallow slope, stronger slope, uneven contact, and a chunk boundary.
9. **Editing:** a drawing preview, a cut preview, and an anchor-drag preview beside unchanged masonry.
10. **Workshop parity:** the same semantic wall/style displayed in the workshop and placed in the world.

Capture front, back, oblique, top, and end views. Use overview and player cameras, plus near/coarse/shell distance sweeps.

### Lighting discipline

- Fix viewport, camera, seed, tone mapping, exposure, material choice, and sun direction across comparisons.
- Include a neutral material scene and warm low-angle light, then the actual world.
- Show white/grey material swatches to distinguish albedo changes from lighting changes.
- Wait for textures, shaders, and geometry queues to finish; reject capture errors and unintended backend fallback.
- Record geometry counts and build time along with images.
- Keep controls visible in interaction captures and hide them in material comparisons.

The review's controlled scene used 1200×800, an orthographic camera at `(11,10,16)` looking at `(0,2,0)`, bounds ±10.5 horizontally and ±7 vertically, ACESFilmic/exposure 1.12, and a sun at `(-5,12,8)`. Those values reproduce the local comparison, not a proposed replacement for production lighting.

## 7. Stage 2: make the masonry read as worn blocks

### 7.1 Style and layout

Keep art controls in named profiles. Build swatches for these initial ranges, then choose from actual captures; these are hypotheses, not measured Tiny Glade settings.

| Parameter | Current rounded default | Initial swatch range |
| --- | --- | --- |
| Course height | 0.50 m | 0.32–0.42 m |
| Target stone width | 0.95 m | 0.55–0.80 m |
| Corner radius / short face side | 0.20–0.30 | 0.09–0.19, with bounded corner variation |
| Face-rim radius / short face side | 0.13–0.20 | 0.07–0.13 |
| Face bulge / short face side | 0.03–0.06 | 0.01–0.025 |
| Mortar face recess | 0.07 m | 0.025–0.045 m, coordinated with rim depth |
| Coping oversail | 1.20× thickness | 1.04–1.12× thickness |
| Footing height ratio | 1.50× course | 1.05–1.25× course |

Requirements:

- Preserve larger stones among smaller infill stones. Avoid subdividing every cell.
- Keep bed lines coherent across module boundaries while varying them gently along the wall.
- Stagger vertical joints, including at module boundaries and under coping.
- Bound lean/rotation by joint clearance so visible holes do not open.
- Avoid thin horizontal fragments whose rounded edges produce a sausage shape.
- Evaluate short walls separately: their foundation should not consume most of the silhouette.
- Preserve the existing styles as intentional choices. Tune the rounded default into the reference family and expose clearer user-facing material/style names where needed.

### 7.2 Face shape

Current `ConstructionPillowStoneMesher` uses a radial `(1 − ρ²)²` dome. Prototype a broad, flatter center transitioning into the edge roll. A smooth plateau profile is one option: height and slope must meet the rim continuously, with a bounded face tilt and modest irregularity.

- Maintain convex, finite geometry and correct outward normals.
- Calculate normals from the actual new profile, including tilt/twist derivatives if those terms affect the surface.
- Preserve a rounded edge highlight without turning the entire block into an inflated cushion.
- Give corners different but bounded radii derived from stable stone identity. `PillowStoneOutline` currently uses one inset radius for the entire quad; extend its construction deliberately if per-corner radii are needed.
- Validate that unequal corner radii fit short/sloped cells, retain winding, and do not intersect neighboring faces.
- Keep near and coarse versions recognizably the same stone. Reduce tessellation before altering layout or silhouette.
- Avoid multiplying triangle counts by applying a dense rounded cube to every stone. Reserve additional geometry for exposed faces that need it.

### 7.3 Palette, joints, and weathering

- Create a related limestone ramp: warm cream, sand, dusty pink, muted grey, and a small amount of sage. Give most stones modest value differences; use dark outliers sparingly.
- Keep material overrides authoritative. Do not multiply a user's colored material by a strong baked tint intended only for the default stone.
- Reduce the appearance of black seams by coordinating gap width, rim radius, mortar depth, and vertex occlusion. Changing only mortar color will not fix wide rounded gaps.
- Give upward, exposed surfaces their natural stone color. A surface exposed to the sky should not receive the same crevice darkening as a buried joint.
- Use broad weathering variation tied to wall coordinates and exposure. Surface noise must remain subordinate to shape.
- Preserve the existing color-space handling; compare swatches in neutral light before changing lighting settings.

### Main files

Paths below are relative to `src/editor/`:

- `construction/masonry/ConstructionStyleCatalog.js`
- `construction/masonry/CurvedCoursePacker.js`
- `construction/masonry/StonePillowField.js`
- `construction/compile/ConstructionPillowStoneMesher.js`
- `construction/compile/PillowStoneOutline.js`
- `construction/compile/RoundedStoneShading.js`
- `construction/config/stone-rounding.yml`
- `construction/config/masonry-joints.yml`
- `construction/config/construction-stone-color.yml`
- `construction/render/ConstructionMortarConfig.js`
- `workshop/ProceduralWorkshopMaterials.js`
- `workshop/ProceduralWorkshopStoneSurfaceConfig.js`

**Exit gate:** the plain wall reads as closely fitted, worn stone under neutral light. Front and back remain convincing. The change is visibly substantial at the normal editing camera, not only in a magnified close-up.

## 8. Stage 3: finish every exposed surface

### 8.1 Use semantic exposure

Derive which stone faces are exposed from the wall's topology, top envelope, openings, and packing boundaries. Distinguish a real endpoint from a module boundary. A closed loop has no exposed endpoint at its parameter seam.

Suggested derived information, adapted to existing types:

```text
stone identity + surface frame + footprint
  -> exposure: wall front/back, terminal face, top, opening reveal
  -> category-scaled shape, mortar setback, shading, decoration eligibility
```

Do not recover these classifications by scanning finished triangles.

### 8.2 Top stones

- Build separate capstones with rounded upper arrises and visible shallow joints.
- Vary their widths and upper heights slightly while retaining the intended top profile.
- Keep coping proportional to the body; avoid a thick shelf above a low wall.
- Ensure upper faces have correct normals and exposure-aware occlusion.
- The current pillow mesher reuses the two face-outline rings for its straight side band. Review whether those vertices' crevice shading is appropriate for an exposed top.
- Recess backing mortar beneath the visible cap so it cannot form a continuous top strip.
- Treat flat, irregular, crenellated, and ruined tops as distinct profiles using the same shared geometry rules.

### 8.3 Ends and opening reveals

- Wrap terminal courses around the wall thickness; alternating bond or bounded quoin treatment can make the end read as stacked blocks.
- Round exposed end arrises and retain course joints across the end face.
- Set backing mortar inside the terminal stones. Its full cell footprint must not emerge as a plain post.
- Use the same exposure system for door jambs and arch reveals.
- Test thickness changes, reversed path direction, close curves, closed loops, and endpoint deletion.

### 8.4 Inner and outer curves

- Fit stone width/depth to curvature so the inner face does not collide while the outer face develops gaps.
- Preserve a continuous top and coherent bond at segment/module boundaries.
- Keep tiny corners and joints readable without adding detached filler meshes for every gap.
- Test the loop seam from above and inside; rotate the semantic start point and verify the appearance is equivalent within the documented identity policy.

**Exit gate:** viewing a wall from its end, inside a ring, or above it reveals finished masonry. No plain backing slab is exposed in those views.

## 9. Stage 4: make openings precise and integrated

### Shared contour contract

Use `OpeningLayout` as the shared definition of the void. Shell, near stone, coarse stone, mortar, collision, and vegetation masks must consume that contour and its declared clearance.

### Implementation approach

1. Work in the wall's semantic surface coordinates `(arc length, height)`.
2. Intersect each affected cell with the surviving wall domain before producing its visible stone geometry.
3. Clip or split only cells near the opening boundary. Preserve unaffected cells and their random identities.
4. Generate the clipped face, reveal surfaces, and bounded bevel treatment. Handle resulting polygons explicitly; do not force every clipped shape back into an invalid quad.
5. Derive mortar from the same trimmed footprint, with the intended recess.
6. Fit dressings to the contour with controlled joints and category-scaled irregularity. Keep their proportions compatible with the surrounding stone sizes.
7. Derive collision from semantic openings. Decorative bevels must not narrow usable passage clearance.

Use a small, testable clipping/meshing module. Avoid putting polygon operations inside the controller or duplicating arch equations in builders. Sampling the widest opening interval over an entire course can provide a conservative preview, but it leaves stepped edges and is not the final curved stone solution.

### Difficult cases

- A sill crossing the middle of a course.
- Arch shoulders and crown crossing a stone.
- An opening across a segment, module, or closed-loop seam.
- A door crossing an uneven ground contact.
- Adjacent/overlapping cuts, narrow piers, and an opening reaching through the crown.
- Moving or resizing an opening without rerolling distant masonry.
- Undressed as well as dressed openings: trim must not conceal a broken void.

### Acceptance

- The section 4C ray grid reports no stone inside the reserved void, at near and coarse LOD.
- Geometry remains closed where required; no inverted triangles, floating fragments, or unbounded bevels.
- The shell and detailed wall have matching opening silhouettes within the documented sampling tolerance.
- A player can walk through the same passage that the renderer shows.
- The curved arcade fixture has consistent piers, clean crowns, and finished reveals under neutral and warm light.

## 10. Stage 5: connected walls and stable edits

Snapping currently establishes placement, but the reviewed plan still lists durable joins as open. Complete the semantic relationship before promising automatic connected editing.

- Represent endpoint-to-endpoint and endpoint-to-span attachment using existing semantic identities and host parameters.
- Keep inferred contact in the resolved layer. Persist an explicit relationship/override when the interaction creates authored attachment intent according to the framework.
- Resolve L/T junctions, unequal heights, thickness, top continuity, and style inheritance in the neighborhood of the connection.
- Define precedence: explicit user choices win; inherited style has a traceable source; incompatible dimensions adapt predictably or expose a clear control.
- Ctrl-suppressed drawing remains detached, including after save/load.
- Moving one joined endpoint updates the connected neighborhood without a whole-world or whole-asset rebuild.
- Undo, split, delete, reopen, and reload preserve valid references and repeatable results.
- Remove redundant interior terminal caps at a join while retaining them when the user detaches it.

**Exit gate:** connect two walls, raise one, move their junction, undo twice, save/reload, and detach. The visible result and semantic relationships agree at every step.

## 11. Stage 6: make the first minute effortless

Keep the recently simplified editor chrome. Complete the wall tool's direct workflow within it.

### Normal workflow

1. Choose **Wall**; **Draw** is ready.
2. Drag a curve and release. The wall remains visible and drawing stays active.
3. Close the curve to form a hollow courtyard, with a clear closure cue.
4. Hover/select the top and drag a height handle. Existing stones retain their identity where possible.
5. Choose **Opening**, drag across the wall, inspect the live cut, and release.
6. Choose **Look**, preview a stone family and top treatment, then commit.
7. Undo reverses one completed gesture in one step.

### Controls to finish

- A compact strip for Draw, Shape, Opening, and Look.
- Shape options: line, circle, and rounded rectangle, producing the same canonical curve representation as drawing.
- Contextual controls for height, thickness, opening width/height, and curvature; show only controls relevant to the current target.
- Trim, Duplicate, and Match look implemented as normal semantic commands.
- A small initial palette with readable swatches; retain the complete browser for all materials.
- Hover previews of appearance and top profile that revert on cancel, without rebuilding geometry for color-only changes.
- Tooltips and modifier hints consistent with Ctrl suppressing snap and Shift providing fine motion.
- A visible, persistent active tool state and sufficiently large hit areas at normal UI scale.

### Snap and preview quality

- Preserve the current 12 px acquisition / 20 px release hypothesis until measured; calibrate against both overview and player cameras, different viewport sizes, and display scaling.
- Show the snapped host/continuation clearly. Position changes should explain the snap, rather than appearing to jump unpredictably.
- Keep grid snapping explicitly selectable.
- During edits, retain unchanged detailed masonry. Replace only the affected region with a coherent preview.
- Refine the preview when the pointer pauses, within the measured frame budget. Commit should not expose an empty strip or reroll unrelated stones.
- Provide a short construction response on commit. Limit animation and sound to the changed region; honor reduced-motion and sound settings.
- Keep camera input, Escape, and undo ownership consistent with existing editor/player modes.

**Usability targets to test:** a first-time user makes an enclosure and an arch without opening an advanced inspector; identifies the active tool; understands a snap cue; cancels and undoes successfully. Record observed problems and iteration results instead of declaring usability from unit tests.

## 12. Stage 7: grounding and restrained vegetation

### Ground contact

- Retain terrain draping and bounded burial.
- Adapt lower stones to grade without oversized uniform foundation blocks.
- Make contact shadow and damp color strongest at actual contacts; avoid a dark stripe at a fixed global height.
- Prevent grass from emerging through the solid wall or filling a doorway.

### Weathering and planting

- Use wall-local fields for broad damp/moss patches and sun-exposed color variation.
- Place small ivy clusters where exposure and contact allow, including selected corners and sheltered areas.
- Use the shared opening/reveal/walkable masks for all decoration.
- Batch leaves and small plants; use appropriate lower detail at distance.
- Keep density sparse enough that the new masonry remains visible.
- Give users simple Clean / Aged / Overgrown controls over a shared style profile, with deterministic results.
- Preserve derivation identities so moving a nearby window does not reshuffle plants across the whole wall.
- Support pin/suppress/promotion through the existing resolved-detail framework when users edit generated details.

**Exit gate:** removing vegetation still leaves a convincing wall; enabling it strengthens ground contact without covering the arcade or changing passage clearance.

## 13. Stage 8: integration and verification

### World/workshop parity

Share the resolved stone surface plan, shape profile, palettes, and material response between workshop and live construction. Keep definition-local geometry separate from world instance transforms. Verify the same wall from the same view under matched lighting before accepting export/placement parity.

### Focused tests

Add meaningful regressions for:

- Dense-loop coverage and short segment ownership.
- LOD promotion across skipped bands; repeated queued transition accounting.
- Face normals/winding, valid unequal radii, bounds, and stable shape identity.
- Exposed top/end treatment and recessed mortar.
- Opening clipping at sill, shoulders, crown, and module/loop seams.
- Local edit identity, hashes, invalidation, and material-only build preservation.
- Join topology, inheritance, detach, undo/redo, and save/load.
- Decoration exclusions and world/workshop equivalence.

Retain and extend the existing suites, including `ConstructionPillowStoneMesher`, `ConstructionRoundedMasonryBuilder`, `ConstructionStoneRoundingProfiles`, `ConstructionLod`, `ConstructionLodState`, `ConstructionViewBuildQueue`, `ConstructionShellOpenings`, `ConstructionOpeningCollisionSpan`, `ConstructionEditIdentity`, and `projectedLod`.

Do not replace a meaningful invariant with a looser assertion just because a new visual profile fails it. Explain deliberate budget/tolerance changes and preserve the underlying guarantee.

### Commands

Confirm the development port serves this project. Port 5173 served a different app during this review; the reviewed Vite instance used 5180.

```powershell
rtk proxy npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

In a separate terminal, use the guide's approach route:

```powershell
rtk proxy npm run qa:perf -- --url http://127.0.0.1:5180 --headed --qa construction-ring --x 0 --z -100 --yaw 180 --warmup 40 --duration 12 --settle --constructionStyle rounded-fieldstone --out tmp/wall-look-after.json --timeoutMs 240000
```

Run relevant profile generators/checks, the focused suites, then the full suite and build before final delivery:

```powershell
rtk proxy node tools/generate-construction-stone-rounding.mjs --check
rtk proxy npm run qa:construction:rounded
rtk proxy npm test
rtk proxy npm run build
```

Run the additional geometry/asset generators and checks applicable to files actually changed. Follow the performance guide's matrix when changes affect shared rendering, residency, or streaming consumers.

### Performance acceptance

- Use hardware WebGPU, a settled scenario, and one QA GPU workload at a time. Do not close the user's tabs automatically.
- Record viewport, device, renderer, fixture, source revision, wall visibility, and queue state.
- Compare matched baseline/after runs. Flag the existing 2.74% hitch rate separately from new regressions.
- Preserve the guide's targets: frame-time p95 ≤33.3 ms and hitch rate ≤2%; report any unresolved failure honestly.
- Report stones, triangles, draw batches, geometry bytes, generation time, and LOD state. Smaller stone scale may increase stone count substantially.
- Keep appearance/material changes out of structural compilation when they do not affect shape.
- Verify bounded local rebuilding. A whole scene recompile is not an acceptable response to one moved anchor or opening.
- Retain the existing preview CPU contract from Phase 11 and measure pointer-to-visible response in the application.
- Do not add a whole-scene depth/color-copy effect to make walls look better without profiling its cost across the full scene.

## 14. Completion checklist

- [ ] Dense and sparse circular walls render completely, including the interior and seam.
- [ ] LOD promotion cannot leave a nearby wall as a flat shell.
- [ ] Default stone scale, faces, corners, joints, and color visibly approach the supplied references.
- [ ] Tops and exposed ends are finished masonry with restrained coping and foundation proportions.
- [ ] Arched and flat openings agree across near/coarse/shell, mortar, collision, and vegetation.
- [ ] The curved arcade and open tower form a convincing complete example scene.
- [ ] Connected edits, detached placement, local identity, undo, and persistence work together.
- [ ] Draw/Shape/Opening/Look are usable without an advanced inspector for the basic workflow.
- [ ] Grounding and optional vegetation support the stonework and preserve all openings.
- [ ] World/workshop results agree under matched conditions.
- [ ] Before/after captures include neutral light, warm light, and actual world views.
- [ ] Relevant tests, generated-file checks, and build pass; performance results and limitations are recorded.

### Required final handoff from the implementing AI

Provide the changed file list, a concise explanation of the visual and interaction changes, paired before/after images, commands and measured results, and any remaining issues. State which checklist items are complete. Do not claim Tiny Glade parity based only on tests, an isolated stone render, or a carefully chosen sunset view.
