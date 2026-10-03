**Critical path code review — 2026-10-03**

The review covered startup and scene reloads, editor history, world persistence
and import transactions, Azgaar terrain boundaries, chunk and worker lifecycles,
movement and collision readiness, vegetation rendering, workshop planning and
commands, and simulation dispatch. Direct inspection focused on failures that
can prevent startup, lose authored changes, or stall interaction. Automated
verification covered the repository's complete test suite and production assets.

**Fixed findings**

| Priority | Failure and fix | Evidence |
| --- | --- | --- |
| P1 | A rejected scene reload during initial map loading left `sceneReloadPending` set and returned before starting the editor loop. The failure now clears that flag and releases the reload overlay. | `src/main.js`; browser test injects a storage quota failure during the initial handoff and verifies both the editor and movement harness start. |
| P1 | World-look activation promises were discarded, so asynchronous failures escaped the UI handler and could leave a blocking reload notice. Activation is awaited, and failed reload sessions expire without closing a newer loading session. | `src/editor/EditorUi.js`; four regression tests in `test/editor-ui-reload-failure.test.js`, plus a live browser recovery check. |
| P1 | A failed workshop worker remained selected, leaving later planning requests pending forever; worker creation errors also prevented initialization. Failed workers are terminated, pending requests reject, and subsequent plans use the deterministic main-thread planner. Cancellation and disposal now also apply to fallback requests. | `src/editor/workshop/ProceduralWorkshopPlannerClient.js`; worker error, message error, creation, posting, stale result, cancellation, and disposal tests. |
| P1 | Undo and redo removed a history entry before applying it. An application error lost the entry. Stack transfer now occurs after successful application, preserving failed entries for retry. | `src/editor/EditorController.js`; retry tests for both directions in `test/editor-history-failure.test.js`. |
| P2 | Optional construction audio could throw before recording a committed edit, or interrupt history transfer. History is recorded first and audio notification errors are contained. | `src/editor/EditorController.js`; failed-audio commit/undo/redo round trip. |
| P2 | Clear World ignored felled, planted, and cleared/regrowing forest records. Forest edits now participate in the empty-world check and are cleared with terrain overrides; snapshots preserve undo/redo. | `ForestEditDocument.js`, `InfiniteWorldStore.js`, and `TerrainAwareEditorController.js`; three tests exercise each forest record kind through clear/undo/redo. |
| P2 | Unchanged vegetation appearance values were compared as doubles against stored float32 values, repeatedly dirtying GPU buffers. Dither, tint, and morphology values are rounded to float32 before comparison. | `src/editor/stylized/lod/StylizedLodRuntime.js`; two tests reproduced the dirty-buffer failure before the fix and now verify unchanged buffers and a single-instance update range. Hardware comparison below. |
| P2 | The pre-baked tree atlas manifest had a stale source signature. Runtime rejected it and used fallback geometry because gameplay disables runtime baking, although production file validation passed. The offline bake refreshed the signature; startup QA now also requires every expected pre-baked atlas to load. | `public/assets/impostors/trees/manifest.json` and `scripts/run-asset-startup-qa.mjs`; hardware startup QA accepted all 29 atlases from assets. The regenerated PNGs were identical to the existing files. |
| P2 | Empty tree atlas batches remained in render traversal, submitting unnecessary draw work. GPU batches now leave traversal when their record count reaches zero; CPU batches also leave when all records are culled. Both become visible again when populated. | `GpuTreeImpostorBatch.js` and `CpuTreeImpostorBatch.js`; two tests reproduced the failure before the fix and verify traversal, indirect draw reset, and reactivation. |
| P2 | The performance runner's default timeout omitted the browser's settle window: an 8-second warmup and 12-second capture timed out at 110 seconds even though settling could take 120 seconds. Timeout calculation now uses the browser's normalized parameters and includes settling. | `scripts/lib/perf-qa-timeout.mjs`; default, custom, disabled, and malformed timing parameter tests. |
| P3 | Inventory CSS referenced two absent images, producing failed requests and build warnings. The existing color and shadow styles now render without those requests. | `src/editor/inventory/inventory.css`; neither `slot-well.webp` nor `gold-coin.webp` exists in either local checkout. |

**Verification**

`npm run verify` passed: generated natural UI validation, production asset
validation, all 3,017 tests (zero failures or skips), and the production build.
The build still reports large JavaScript chunks; the missing inventory image
warnings are resolved. The verification log is
`/tmp/drusniel-review-verify-final.log`.

The native Windows Chromium smoke checks passed with no uncaught browser errors:
IndexedDB world save/load, forest clear/undo/redo, reload notice recovery, and
startup after a rejected scene reload handoff. The report is
`tmp/critical-review-browser-smoke.json`; its script is
`tmp/critical-review-browser-smoke.cjs`.

Initial asset checks found missing ignored GLBs in this checkout. Missing files
were restored from `/mnt/f/Development/SimCity-DnD`, whose HEAD and asset manifests
matched this checkout. This restored 240 GLBs without replacing existing files.
These local assets are required for production verification and hardware QA.

Hardware asset startup QA passed with zero failed assets or KTX2 transcodes.
It loaded all 29 tree atlases from assets with the expected source signature
`tree-impostor-v4-855b7394`. The report is
`tmp/critical-review-asset-startup.json`.

**Hardware performance evidence**

The movement harness ran sequentially in native Windows Chromium on the NVIDIA
Lovelace WebGPU adapter, with no software fallback. Both comparison runs used
`chunk-cross`, standard density, an 8-second warmup, a 12-second measurement,
and settling. The matched baseline temporarily used the original LOD writer;
reload, worker, history, and forest fixes were present in both runs. This
comparison preceded the tree atlas manifest refresh and empty atlas batch fix.

| Measurement | Original LOD writer | Fixed LOD writer |
| --- | ---: | ---: |
| Measured frames | 983 | 979 |
| Frame dt p95 | 27.15 ms | 16.00 ms |
| Frame dt p99 | 45.568 ms | 44.886 ms |
| Hitches over 33.3 ms | 22 (2.24%) | 15 (1.53%) |
| General instance attribute bytes (`attributeBytesUploaded`) | 11,372,172 | 1,522,516 |
| Attribute bytes per measured frame | 11,569 | 1,555 |
| Terrain upload pages / bytes | 7 / 702,576 | 7 / 702,576 |
| Collision p95 / readiness | 0.1 ms / 9 of 9 chunks ready | 0.1 ms / 9 of 9 chunks ready |

The LOD writer comparison reduced the general instance attribute upload counter
by approximately 87%. Tree atlas buffers use a separate upload counter. Reports are
`tmp/critical-review-perf-paired-before.json` and
`tmp/critical-review-perf-paired-after.json`.

The final code capture, including accepted tree atlases and empty batch handling,
has 1,044 measured frames, 26.785 ms p95, 44.427 ms p99, and 18 hitches (1.72%).
Collision p95 is 0.1 ms and all 9 desired chunks are ready. Terrain still uploads
7 pages / 702,576 bytes. It meets the matrix's 33.3 ms p95 and 2% hitch thresholds
for this scenario. The report is `tmp/critical-review-perf-final.json`.
The complete density, construction, and water matrix was not run.

Frame pacing still warrants performance work. Captures after the atlas refresh
varied from 18.28–32.805 ms p95 and 1.30–4.14% hitches before the empty batch fix.
The final code's stylized-update p95 is 16.8 ms, above the guide's stricter 4 ms
target, and tree rebuilds remain frequent (359 in the final measurement).
The final run has 1,256,120 general instance attribute bytes and 8,401,776 tree
atlas attribute bytes. These fixes do not demonstrate stable frame pacing across
all workloads or resolve the wider vegetation rebuild budget.
