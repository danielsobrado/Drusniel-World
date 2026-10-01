# AI testing prompt: fitted wall openings and natural growth

Use the assignment below as the prompt for a fresh testing AI.

## Assignment

Review and test the current wall builder in `F:\Development\SimCity-DnD`. Focus on the September 30 fitted-opening, sandstone and ivy changes. Decide whether they visibly improve the user's Tiny Glade references and preserve simple, reliable editing. Run the app and inspect fresh renders as well as the code. Deliver a report with reproducible findings and evidence.

Start by reading:

- `AGENTS.md`, `CLAUDE.md` and their referenced RTK instructions. Prefix shell commands with `rtk`.
- `docs/architecture/workshop-geometry-framework.md`.
- `docs/plans/workshop-geometry-framework-plan-2026-08-19.md`.
- `docs/research/tiny-glade-workshop-behavior-review-2026-08-19.md`.
- `docs/perf-qa.md`.
- `docs/qa/wall-openings-growth-review-2026-09-30.md`.
- `docs/plans/tiny-glade-wall-builder/implementation-handoff-2026-09-28.md` and the latest status in Phase 11.

The working tree contains substantial unrelated work. Record its initial status, preserve existing changes, and scope any edits to a reproduced wall defect. Do not reset the tree, commit changes, read `.env_dev`, or publish anything. This assignment is testing and review; report proposed fixes with enough detail for implementation. Add a focused regression test when needed to demonstrate a defect.

## Product target

The user's references show warm stone walls with broad flat faces, varied block sizes, worn corners, narrow recessed joints, smooth curves, hollow towers, finished battlements and tall arched passages. Vegetation should be sparse and rooted. A simple gesture should produce a pleasing wall, with obvious edits and dependable undo.

The [user's article](https://opgamemarketing.substack.com/p/tiny-glade-an-indie-game-by-2-devs) supplies product context. Use the supplied screenshots and the repository's public-behavior review to judge appearance. Do not claim access to Tiny Glade's internal algorithms. Judge the wall without growth first, then with it enabled.

## What changed

1. `OpeningContour.js` samples the shared opening contour and clips fitted shoulder stones, retaining concavities and holes.
2. `OpeningDressings.js` creates arch wedges and jambs that span the wall thickness. The middle wedge is the keystone. Backing retreats from the opening reveal.
3. `ConstructionContourStone.js` writes those polygons into existing module batches. Near and coarse tiers preserve the fitted pieces.
4. `ConstructionStyleCatalog.js` and `stone-rounding.yml` increase sandstone size variation and corner variation while retaining broad flat faces.
5. `WallGrowth.js` plans deterministic ivy from segment/cell identity. `ConstructionGrowthBuilder.js` batches stems and leaves. The budget is 192 leaves per occupied module, with one added mesh and a pooled material. Roots touch the terrain at the wall face.
6. `style.growth` is optional semantic state: `auto` or `none`. Sandstone properties show **Ground growth: Natural / None**. Changing this refreshes decoration while keeping masonry and pending structural compilation intact. Undo/redo refreshes the inspector, and **Draw matching wall** carries the setting into the brush.
7. Coarse cell merges retain exposed jamb edges from every leaf. Path-end exposure uses actual cell boundaries to avoid a shifted merged center letting mortar cover the terminal stone.

Related integration files: `ConstructionCommands.js`, `ConstructionSchema.js`, `ConstructionStore.js`, `ConstructionView.js`, `ConstructionGrowthResidency.js`, `ConstructionMaterials.js`, `ConstructionMaterialSlots.js`, `ConstructionCoarsePlacements.js`, `ConstructionInspector.js`, and the construction store subscription in `src/main.js`.

Generated masonry and vegetation must remain derived data. The only new saved setting is the growth mode. Automatic growth must not change stone seeds, alter collision, or create one scene object per leaf.

## 1. Automated checks

Run these from the repository root. Save exact commands, exit codes and logs.

```powershell
rtk proxy node tools/generate-construction-growth.mjs --check
rtk proxy node tools/generate-construction-stone-rounding.mjs --check
rtk proxy node --test tests/ConstructionOpeningContours.test.js tests/ConstructionOpenings.test.js tests/ConstructionExposedSurfaces.test.js tests/ConstructionWallGrowth.test.js tests/ConstructionAppearanceCompilation.test.js tests/ConstructionEditIdentity.test.js tests/ConstructionMasonryBuilder.test.js tests/ConstructionMortarVoidWiring.test.js tests/ConstructionStructuralMasks.test.js tests/ConstructionDrawingLook.test.js
rtk proxy npm test
rtk proxy npm run build
rtk proxy git diff --check
```

Expected regression coverage includes actual geometry ray checks across round, segmental, pointed and flat openings, in both near and coarse tiers, across sandstone, rounded fieldstone and coursed rubble. Reveals must show stone through the thickness. The suite also checks overlapping opening columns, deterministic growth, opening clearance, slope contact, persistence, undo and in-flight compilation.

Inspect assertions as well as pass counts. `corners` is a bounding cell for fitted stones; `contourPolygons` and `mortarPolygons` describe their actual material. A test that inspects only the old four corners cannot establish clearance or coverage. Prefer actual mesh intersection checks for rendering defects. Preserve strict assertions rather than loosening tolerances to hide a failure.

## 2. Reproduce the visual fixtures

Start a Vite development server in a separate terminal. The capture harness imports source modules, so use the dev server for these commands.

```powershell
rtk proxy npm run dev -- --host 127.0.0.1 --port 5183 --strictPort
```

Run each capture sequentially:

```powershell
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --lod near --growth none --out tmp/wall-review-near-bare
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --lod near --growth auto --out tmp/wall-review-near-growth
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --lod coarse --growth auto --out tmp/wall-review-coarse
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --view back --growth none --scenes arches,arch-profiles,curved-arch --out tmp/wall-review-reverse
```

The harness captures straight, curved, closed-tower, arcade, four-profile, curved-arch, low-wall, growth and standard-style fixtures under neutral and warm light. Inspect the PNGs at full size and read each `report.json`. Require WebGPU and no page errors. The fixed scene uses ACES exposure 1.12.

Check:

- Shoulders meet the arch without stair-shaped holes. No stone or backing crosses a passage. The inner arch surface remains stone on both faces and at the wall center.
- The pointed crown has one coherent keystone. Jambs and flat lintels do not acquire stray bevel fragments, large overlaps or a brown mortar coating.
- Curves remain smooth on both faces. Closed towers are hollow. Ends, capstones and battlements stay seated and show stone at exposed surfaces.
- Blocks have a coherent bond with varied proportions. Avoid excessive horizontal striping, capsule shapes, repeated corner wear and noisy color speckles.
- Growth is sparse, attached to visible stems and rooted. It does not conceal unresolved masonry gaps, block an opening, float above a slope, or move when changing only material.
- Coarse geometry retains the same void and visible boundary. Check far shell transitions interactively; the isolated harness captures near/coarse only.

Add targeted fixtures if needed: an undressed arch, two intersecting dressed openings, a window sill crossing a course, an opening centered on a module seam, minimum wall thickness, tight curvature, and a transverse slope. Separate pre-existing defects from regressions with a controlled reproduction.

## 3. Test normal editor interactions

Use a fresh disposable browser context. Do not overwrite a user's saved world. Capture steps and screenshots using the normal controls; development APIs may set up deterministic fixtures and inspect state.

1. Draw a short wall, then a curve, then a closed enclosure. Verify sandstone defaults, continuous drawing, sensible scale and a hollow interior.
2. Select a sandstone wall and open **Wall properties**. Change **Ground growth** from **Natural** to **None**. Only the ivy should disappear.
3. Blur the control, press Ctrl+Z, then Ctrl+Shift+Z. Verify both the ivy and dropdown follow history. Repeat after a dimension edit and after switching styles.
4. Keep references to resident stone/mortar geometries before step 2. Verify the same objects remain after toggling and undoing growth. Repeat while the structural worker has a pending job. The latest growth setting must win without rejecting the valid structural result.
5. Use **Draw matching wall** with growth disabled, then draw a wall through the pointer. Verify style, dimensions and growth setting match, the source remains unchanged, and the new wall has its own seed and history entry.
6. Save/export and reload through the existing document flow. Verify growth suppression, paths, materials, dimensions and openings survive. Persist semantic fields only. Reload an older record without `style.growth`: it should remain valid and use automatic growth where the style supports it.
7. Create round, segmental, pointed and flat openings through normal controls. Resize and move them; move one across a module seam. Inspect both sides and walk through a suitable door in player mode. Restore each state with undo/redo.
8. Change wall height, thickness, top type, material and curvature with growth visible. Check the preview, opening clearance and stable distant stones/patches. Selection must not tint the ivy as though it were stone.
9. Move the camera through near/coarse/shell bands. Rebase the world using the existing test mechanism or a distant fixture. Check disposal and rebuilding: no duplicate patches, lost settings or decoration left behind.
10. Delete the inspected wall, then undo. Confirm there is no stale properties panel pointing at a deleted record.

A convenient disposable starting scene is:

```text
http://127.0.0.1:5183/?fixture=construction-ring&constructionStyle=glade-sandstone
```

In development, `window.__editor` exposes `controller`, `constructionStore`, `constructionView` and `terrainView`. The inspector can be opened with `controller.constructionPalette.openInspector(id)` for deterministic setup. Zoom close enough to get resident masonry; shell-only walls do not have ivy. These setup calls do not replace testing actual pointer gestures and controls.

## 4. Performance and resource checks

Follow `docs/perf-qa.md`. Close other app-rendering browser tabs before measuring. Use headed hardware WebGPU, frozen production builds, the same settings and the same world/assets for comparisons. Never reset the shared checkout to manufacture a baseline.

Implementation evidence, when still present locally:

- `tmp/wall-next-baseline-dist` and `tmp/wall-next-perf-before.json`.
- `tmp/wall-next-after-dist` and `tmp/wall-next-perf-after.json`.
- `tmp/wall-next-final-dist` and `tmp/wall-next-perf-final.json`, including the final coarse-exposure fix.
- `tmp/wall-next-perf-baseline-recheck.json`, a later run of the original frozen baseline.
- `tmp/wall-next-perf-comparison.json` describes comparability and metric deltas.

The implementation's runs did not establish performance acceptance. World settings changed elsewhere during the session, and the frozen baseline itself slowed considerably on recheck. Use the comparison report to understand this confounding; do not attribute the full timing difference to wall changes.

For a fresh candidate:

```powershell
rtk proxy npm run build -- --outDir tmp/wall-review-dist
rtk proxy npm run preview -- --host 127.0.0.1 --port 5182 --strictPort --outDir tmp/wall-review-dist
```

In another terminal, after closing visual/interactive QA browsers:

```powershell
rtk proxy npm run qa:perf -- --url http://127.0.0.1:5182 --headed --qa construction-ring --x 0 --z -100 --yaw 180 --warmup 40 --duration 12 --settle --constructionStyle glade-sandstone --out tmp/wall-review-perf.json --timeoutMs 240000
```

Require `scenario.settle.settled`, a hardware adapter, WebGPU=1/WebGL=0, complete frame samples, collision readiness, at least 12 resident modules, nonzero masonry and a drained construction queue. Report FPS, p50/p95/p99, hitch rate, construction build time, resident stone/module counts, collision p95 and draw calls. Compare config snapshots before attributing a change to wall code.

The release thresholds remain p95 <=33.3 ms and hitch rate <=2%. A small improvement over a failing baseline is still a failed gate. The approach route ends outside the near tier and does not replace a sustained near-wall run, an arcade-heavy route or the full matrix. For release acceptance also run the appropriate longer scenarios and `qa:perf:matrix` from the guide.

Inspect growth budgets and resource lifetime separately: at most one growth mesh per occupied module, pooled material ownership, no per-leaf objects, no per-frame regeneration, bounded triangle counts, stable geometry on toggle, and disposed geometry after repeated clear/restore/delete/LOD transitions.

## 5. Report format

Write `docs/qa/wall-openings-growth-independent-review-YYYY-MM-DD.md` containing:

1. Verdict for geometry, appearance, usability, persistence and performance separately.
2. Findings ordered by severity. For each: file/line, exact reproduction, expected/actual result, screenshot or test evidence, affected styles/LODs, and proposed fix.
3. Commands and exit codes; distinguish executed checks from untested scenarios.
4. Fresh visual comparisons and performance tables. Link local artifacts and state when they are ignored/untracked.
5. The three most useful next improvements toward the reference images.

Current scope limits: this pass adds sparse ivy to sandstone. Flowers, broader moss/contact rules, persistent semantic joins, dedicated shape tools and the complete courtyard workflow remain future work. Report how much they affect the reference match without mistaking them for features delivered by this pass. A green unit suite alone is insufficient evidence of visual or interaction quality.
