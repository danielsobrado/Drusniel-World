# Handover: the grass-test → SimCity-DnD merge

Date: 2026-09-28 (second pass). Written to be picked up cold, without the conversation that
produced it. The *reasoning* for every decision is in
[the merge plan's implementation log](grass-test-merge-plan-2026-09-24.md) §9 — including the
2026-09-28 entries for the three bump, the Hi-Z occlusion port and the interaction fold. This file
is the entry point: what is done, what is open, and the exact next call for each.

**Donor:** `F:\Development\grass-test` (three 0.186.0, WebGPU, a static world). **Policy:** this
project keeps the Azgaar world, construction/workshop and streaming; the *look and feel* comes from
the donor, ported as close to verbatim as the host allows, keeping this host's streaming form where
the donor assumes a static world. Nothing comes from FluffyGrass or Codex-and-Blender — see the
provenance note at the top of `docs/fluffygrass-migration.md`.

## Verify the current state first

```
set "NODE_ENV=" && npm install --include=dev   # (1) see the trap below
set "NODE_ENV=" && node --test                 # 2836 tests, expect 0 failures
set "NODE_ENV=" && npm run build               # expect "✓ built", two known warnings
npm run verify                                 # check:natural-ui + validate:assets:production + test + build
```

**(1) Environment trap.** `NODE_ENV=production` and npm's `omit=dev` are set on this machine, so
**any `npm install` silently strips devDependencies** (it reports "removed 43 packages, audited 9"):
vite, playwright, sharp and @gltf-transform disappear and `npm run build` then fails. Clear
`NODE_ENV` and pass `--include=dev`, as above.

The two known build warnings, both pre-existing and not caused by the three bump: `WebGLRenderer`
is not exported by `three/webgpu`, which `vite.config.js:12`'s `^three$` → `three/webgpu` alias
turns into an unresolved import in `src/editor/ui/NaturalObjectThumbnails.js:20` (that thumbnail
path would throw if it ever ran — see open item 7); and the >500 kB chunk notice.

## Done and wired

| Area | Where | Notes |
|---|---|---|
| **Meadow grass** — blades + far cards, two-band to four-band LOD, resumable build | `stylized/meadow/*` (17 modules) | Live by default: `editor.config.yaml` `grass.system: meadow`; built in `StylizedSurfaceViewBase.js:224`, updated `:634`, disposed `:860` |
| **Rock flattening in the meadow** | `MeadowGroundSampler.js`, `chunkRockSignature.js` | Rocks reach the grass two ways: a signature inside `revisionAt` (forces recompaction) and per-stem flattening; the tile layer passes its own tile size |
| **The player's body folding the grass** | `MeadowInteractionMap.js`, `meadowBladeShape.js`, `meadowUniforms.js`, `meadowGrassConfig.js` | The donor's `#sampleInteractionBlade`, hashed per-blade direction, folded last; body point plumbed from `main.js`; rebase-safe. **The look is reasoned, not yet seen** |
| **Hi-Z occlusion culling** | `src/render/occlusion/*`, wired in `InfiniteTerrainView.render()` | Ported near-verbatim with the r186 pin dropped, the diagnostic readback opt-in, and an explicit occluder opt-in |
| **three 0.186.1** | `package.json`, lock | Verified by tests + build; browser QA outstanding |
| Grass: two-band LOD, resumable build, density coverage | `StylizedGrassSlot.js`, `StylizedGrassMaterial.js`, `grassLodMath.js`, `grassScatterBuild.js` | `nearRadius: 0`; `grass.lod.coverage.*` config |
| Grass silhouette families + biome sets | `grassBladeProfiles.js`, `GrassBladeProfilePool.js` | slender/reed/broadleaf; `bladeProfiles.biomeSets` |
| Beach and water life | `seabedRocks.js`, `shoreLifePrototypes.js`, `proceduralFlora.js`, `aquaticFloraPrototypes.js`, `plantSway.js`, `strandPlacement.js` | seabed boulders, starfish/shells/driftwood/leaves, seven water species |
| Surface detail | `rockWeathering.js`, `barkWeathering.js`, `contactShade.js` | moss, wet waterline + algae, bark, contact patches, straw path fringe |
| Deep water | `stylized/SeaSurfaceShading.js`, `water/underwaterState.js` | crest transmission; land streaming suspends under water |
| Blown streaks, frost | `stylized/ambient/BlownStreaks.js`, `FrostShading.js` | wired into the terrain material |
| Jungle mist, heat shimmer | `stylized/ambient/JungleMist.js`, `HeatShimmer.js` | fully wired: uniforms driven from the region weights, mist over the ground colour, shimmer warping the sky ray. Only `heatShimmerUniforms.temperature` is never animated — it holds its default |
| Day/night, stars, moon | `stylized/sky/dayNightCycle.js`, `starField.js` | the cycle drives the existing `SkyLookController` |
| Valley fog | `stylized/mist/*` | `ValleyFogController`, owned by the terrain view |
| Couloirs, crest notches | `world/MountainRidges.js` | **terrain change — the world must be re-imported** |
| Alpine tree preparation | `scripts/prepare-alpine-tree-assets.mjs` | runs; output in `assets/runtime-sources/trees/alpine/` (not yet in `treeVariants` — item 5) |
| Tropical kit preparation | `scripts/prepare-tropical-assets.mjs` | runs; ten members in `assets/runtime-sources/ground/tropical/` (not yet a layer — item 4) |

## Open, in the order I would take them

**1. The occlusion pass has almost nothing to occlude yet.** It is wired and runs, but the donor
classifies occluders and candidates by reading materials, and this host's materials mostly displace
their vertices in a `positionNode` (terrain, water, grass, trees), so the default arms reject them.
The decisive piece is **terrain chunks as occluders** — mountains hiding meadow and trees — and it
is designed but not written:
- add a `depthOnly` path to `createTerrainMaterial` (`src/editor/terrainMaterial.js`) returning a
  material with only the `positionNode` displacement and `colorWrite: false`, built from the same
  slot data so `TerrainSlotBindings` resolves the per-slot height identically;
- hand it to each slot mesh in `createSlot` (`InfiniteTerrainView.js:124-196`) as
  `userData.occlusionProxyMaterial`, set `userData.occlusionOccluder = true`, and give each resident
  slot a render-space `userData.occlusionBounds` covering its height range (the flat geometry's own
  bounds cannot: `#bounds` reads `geometry.boundingBox`);
- then check `gpuOcclusionOccluders` / `gpuOcclusionCandidates` in `PerfCounters` while flying into
  a mountain: `occluders` must go non-zero and `gpuOcclusionCulledDraws` needs
  `renderer.gpuOcclusion.diagnostics: true` to move at all.
Other views can join the same way (`userData.occlusionBounds` with `occlusionPadding` is enough for
a candidate).

**2. No browser QA has ever run for any of this, because no GPU was available.** Everything
perf/visual in §9 is reasoned from counts and timings, not measured in frames. Run
`npm run qa:perf -- --headed`, `npm run qa:perf:matrix`, `npm run qa:postprocessing:browser`,
`npm run qa:water:acceptance` against unmodified `main` at the same `--warmup`. Highest-value
checks: the fold's visual weight (its transfer factor is the one reasoned number in the port — see
§9), the r186 bump against the framebuffer-copy patch and water refraction, and occlusion on/off.

**3. Snow wake and trampling are ported but nothing imports them.**
`stylized/deformation/snowWakeMath.js` + `SnowWakeShading.js`, and `stylized/trample/*`
(33 tests between them). Both want the **same** per-frame player point this pass plumbed for the
meadow: `GrassTrampleField.update(renderer, focus, seconds)` wants `{canonicalX, canonicalZ,
renderX, renderZ}` (derive canonical with `floatingOrigin.toCanonical`), and
`createSnowWakeState(...).record(clock, x, y, z, motion)` wants canonical XZ + feet Y + right axis +
speed — the same input `snowPowder` already gets in `main.js`. Each needs a state object owned by a
view, a per-frame update, a `shiftWorld` in the rebase block, and a blend in the terrain or grass
material. Each module's own doc comment states its contract; §9 has the wiring table.

**4. The tropical kit needs a layer of its own.** Five of ten members publish
(`jungle-grass-short/tall/broad`, `jungle-groundcover`, `elephant-ear`, 57–73 % smaller). They
cannot go in `groundDetailVariants`: `tests/authoredAssetExtraction.test.js` asserts every entry
there is a *published extraction output* streaming **at most 350 triangles**, and these are
1 540–1 960. They cannot go in `bushVariants` either, which has no per-variant biome gate and would
scatter tropical grass through temperate meadow. So: add a seventh key to the scanned list in
`scripts/lib/runtime-asset-sources.mjs` (with its own scatter tier), a `stylizedSurface.tropicalKit`
block with `tileIds: [5, 7]` and its own budget, and a `StylizedGroundDetailView` instance beside
the ground-detail and aquatic ones. The config file says this where the entries would have gone.

**5. Alpine trees need their `treeVariants` entries.** Prepared output reads
`nodes: Alpine10_0, Alpine10_1, Tree10_High` and `mats: Alpine bark, Evergreen needles` — so
`trunkMaterial: Alpine bark`, `leafMaterial: Evergreen needles`. Add for taiga (9) and tundra (10),
then `npm run optimize:runtime-assets` and `npm run verify`. Check what `species` and `barkProfile`
values the tree view accepts before writing them; a wrong one throws when the variant is appended.

**6. The grass gust sheen is done for the meadow, not for the clump path.**
`meadowBladeMaterial.js:18,74-78` has it; `StylizedGrassMaterial.js` has neither `grassGustSheen`
nor `writeGrassGust`. The clump path is the non-default A/B (`grass.system: clumps`), so this is
parity work, not a default-path gap: port `writeGrassGust` + its shear term there reading the shared
world wind, reusing `ambient/GrassGustSheen.js` and the already-forwarded config key.

**7. Pre-existing, found while bumping.** `src/editor/ui/NaturalObjectThumbnails.js:20` constructs
`THREE.WebGLRenderer` from an alias that resolves to `three/webgpu`, which does not export it — the
import is `undefined` and that path would throw if it ran. Untouched by this pass and not a bump
regression (r186.0 lacks the export too). Either import from `three` explicitly for that file or
give it a WebGPU renderer.

## Constraints that must not be broken

- **The performance filter** (§11): take it if it costs a shader or a bounded per-frame update.
  Leave out anything that re-renders the scene, reads the viewport depth buffer or the scene colour
  texture, uses a planar reflection or a cube probe, or iterates the whole map. Two ports were
  reformulated to obey this (jungle mist, heat shimmer) and two were declined outright (the
  far-grass billboard cards and their atlas, and the donor's shader pebbles/scree, which this
  project already has as instances). The Hi-Z pass was one of the declined ones; it was revisited
  on 2026-09-28 because it renders its **own** proxy depth rather than reading the viewport's.
- **The editor runtime performs no GPU-to-CPU readback.**
  `tests/webGpuRuntimeContract.test.js` scans `src/editor` and fails on `mapAsync(`,
  `getMappedRange`, `GPUMapMode.READ` and friends. That is why the occlusion culler lives in
  `src/render/` and its diagnostic readback is opt-in and off by default.
- **Nothing is hidden without a reason.** The submerged policy suspends *work* rather than hiding
  layers, because the measured cost here is rebuilding, not drawing.
- **Assets:** the pipeline is hash-based and strict. Sources live in `assets/runtime-sources/<scene>`,
  outputs in `public/<scene>`, the manifest in `assets/runtime-asset-manifest.json`, generated by
  `npm run optimize:runtime-assets` and checked by `npm run validate:runtime-assets`. gltfpack 1.2 is
  **cached** at `tmp/tools/gltfpack/v1.2/win32-x64/gltfpack.exe`, so this runs offline. The optimizer
  refuses any asset whose authored triangle count changes — clean a source in a
  `scripts/prepare-*.mjs` step first if it carries degenerate geometry, which both donor kits did
  (954 degenerate triangles across the tropical kit alone).
- **Config traps found the hard way:** `resolveAmbientEffectsConfig` returns an explicit object and
  silently *drops* any effect key it does not name; water kinds are numeric constants
  (`WATER_KIND_OCEAN`), not strings; and a scene listed in the config without a manifest entry fails
  `validate:runtime-assets`. `renderer.gpuOcclusion` is validated in `validateEditorConfig.js` and
  accepts only the keys an operator would set — omitting the block leaves occlusion off.

## Working practices that paid off here

- **Verify after every step, and check the tree after an agent stops.** Agents that hit a turn limit
  stop mid-sentence and leave artifacts that pass a glance: one prepare script looked finished and
  did not run, one integration agent's last message said it was *starting* a port it had already
  finished. Grep the shared files for what a port claims to have wired rather than believing the
  summary.
- **Fan out only on disjoint files.** Agents told exactly which files they may not touch respected
  it. Every integration pass into the shared files (`editor.config.yaml`, the two view bases,
  `terrainMaterial.js`, `main.js`, the grass material) was done by one owner at a time.
- **A module's own doc comment is its contract.** Every port here documents why it exists and what it
  needs; that is what made the wiring table in §9 possible after the agents that wrote them were gone.
- **Run the thing you wrote before you believe it.** Two counts in this project were wrong until
  they were run: the suite is 2836 tests (not the 2804 once recorded here), and `npm test` prints
  nothing at all when its output is redirected through a pipe that buffers until exit — read the
  file, or the counts, not the empty log.
