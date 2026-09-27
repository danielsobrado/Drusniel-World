# Merge plan: grass-test → SimCity DnD

Date: 2026-09-24

Status: approved; P1 in progress

Source project: `F:\Development\grass-test` (three 0.186, WebGPU/TSL, ~44 k LOC in `src/`)
Target project: this repository (three 0.185.1, WebGPU/TSL, streamed Azgaar world)

## 1. Goal

Take what grass-test does well (water, coast, waterfalls, snow, weather, vegetation,
characters, audio, atmosphere) and bring it into SimCity DnD. The game keeps its
foundations:

- unbounded logical world, `64 × 64` pages (2 m cells, so 128 m pages), 49 resident slots,
  macro-far terrain, floating origin;
- Azgaar biome IDs `0–12` as terrain IDs, custom biomes allocated from `32–254`;
- the W0–W4 water domain (`WaterTerrainModel`, streamed `RGBA16F` water field with shore
  distance in A, `RG8` flow field, carved river beds, ocean bathymetry);
- CPU-authoritative heightfield, worker-generated pages, deterministic regeneration;
- `StylizedVariantResidency` for authored assets, and no viewport-texture nodes in
  materials that don't need them;
- SOLID, reasonably small files.

grass-test is a **fixed 2,400 × 1,600 map**: river control points, lake footprint, the cirque
centre, routes, teleports and tree placements are all hand-authored. The main job of this
merge is **turning each authored-coordinate system into one driven by fields**: Azgaar
guidance (biome, elevation, `featureId`, rivers), the streamed water field, and
deterministic per-page hashing in the chunk worker.

## 2. Porting rules (apply to every phase)

1. **Only move code and assets with clear rights.** The README describes grass-test as a *clean-room
   reconstruction of a reference demo* that uses copied reference assets. Do **not** merge
   anything in the "recovered" lineage: `RecoveredGrassMaterial.js`, `LegacyWaterMaterial.js`,
   recovered sky/cloud plane, `terrain2.glb`/`Landscape002`/`Landscape046`, `Samurai-v1.glb`,
   recovered Stone/Lantern props, `tree-world.json`, `world-props.json`, the
   `docs/reference/*` package. Anything we can merge must be one of these:
   - code written in grass-test itself (post-"cinematic" systems): OK;
   - `Noniv/snowflow_demo` ports (MIT, copyright Maksymilian Dendura): OK, and they must be added to
     `THIRD_PARTY_NOTICES.md` with the header credits kept;
   - `coastal-jungle` pack (MIT, Codex-and-Blender, own repo): OK;
   - `fantasy`/`fantasy-textures` (user-supplied ChatGPT artwork + repo geometry): OK, but
     `tree1–9` are *derivatives* of reference trees. Treat those as blocked until their
     provenance is confirmed;
   - `Audio/` bank (CC0, OpenGameArt): OK, copy `CATALOG.md` into our licenses;
   - character GLBs (Meshy rigs, user-generated): OK, and ownership was confirmed on 2026-09-24 (§7).
2. **No global rasters.** grass-test bakes a 1536² CPU raster and 2048² GPU height texture for
   the whole map. Here, every field is per page (worker) or camera-local (ring texture),
   never whole-world.
3. **Coordinates.** Shader noise, wave clocks and flow phases use canonical world coordinates
   with the same floating-origin offset contract as `sky.cloudWorldScale`. Anything periodic
   is wrapped (`mod` of tile size) so precision holds at planet scale (Eldara ≈ 16,600 km).
4. **Regional effects are weights, not bounds.** grass-test gates snow country, jungle and coast
   by map regions. Here, those weights come from a camera-local sample of biome ID,
   elevation and shore distance, smoothed over time (e.g. `SnowRegionTracker`).
5. **Authored GLBs stream through `StylizedVariantResidency` and declare `tileIds`.** Never add
   them to a `Promise.all` in `bootstrapLayers`. Scatter views append prototypes and bump
   `prototypeRevision`.
6. **Perf-gate every phase.** Run an A/B `qa:perf` against unmodified `main` at the same
   `--warmup` (see `docs/perf-qa.md`). Do not port grass-test's planar reflections or
   cube-probe re-renders. Our SSR/TAA/post graph stays authoritative.
7. **Three version.** grass-test targets 0.186, and we pin 0.185.1. Check TSL imports while porting
   (`hash`, `screenCoordinate`, `cameraViewMatrix` exist in both). Don't bump three as part of
   the merge.

## 3. Inventory and verdicts

Legend: **Port** = move code with light adaptation · **Adapt** = keep the algorithm, rewrite its
data source for streaming · **Ideas** = reuse the technique or tuning, write new code · **Skip**.

### Water, coast, deep sea

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| `RiverCourse.findRiverFalls`, cascade flow coords, travel-time speedup | Rivers carved, flow field, no falls | **Adapt** | Run on `RiverSurfaceProfile` segment levels (steep ones already exist at 48× relief) |
| `waterfallTexture.js` (strands/sheets whitewater tile) | none | **Port** | Pure procedural texture, generated once |
| Fall/plunge shading branch in `WaterMaterial.js` | `StylizedWaterMaterial` | **Adapt** | Add a "fall" branch gated by a new per-vertex/field fall weight |
| `WaterfallMist.js` (GPU puffs, scene-lit, near collapse) | none | **Port** | Instanced per page from fall list; no depth texture used ✔ |
| `RiverDetails.js` bank/fall/plunge rocks | Rocks scatter (`StylizedRockView`) | **Adapt** | New rock placement *mode* driven by water field + fall list |
| Mouth handover (ribbon → sea, shoal remap) | Separate river/ocean kinds | **Ideas** | Blend water kind across `MOUTH_HANDOVER_HEIGHT` in `WaterTerrainModel` |
| Lake (`LakeShape`, lake-level clamp, river ownership mask) | Lakes deferred in W4 | **Adapt** | Needs water-domain v3 using Azgaar lake features (see §5.3) |
| `LakeFlora.js` (eelgrass, waterweed, pondweed, lily pads) | `AquaticPlacement` (rooted/floating) | **Port** | Plug species geometry into the existing placement |
| `CoastField.js` swash / wet sand / foam front / wash memory | Shore foam from shore distance | **Adapt** | Drive from field channel A instead of the analytic curve |
| `seaWaves.js` geometric swell + slope-variance normal texture | FBM/Voronoi water surface | **Adapt** | Displacement bounded by bathymetry depth; near ring only |
| Offshore whitecaps, crest transmission | none | **Port** | Shader math only |
| Sky-gradient reflection sample (no sun disk) + explicit sun specular | SSR + sky | **Ideas** | Use as SSR fallback colour; don't double-count the sun |
| Rain ripple normal (cell rings) | none | **Port** | Pure TSL, gated by rain intensity uniform |
| `UnderwaterPerformanceController` | `UnderwaterViewController` | **Ideas** | Drop expensive layers while submerged |
| Planar reflection, cube probe, `ReflectionBudget` | SSR | **Skip** | Scene re-render, violates perf direction |
| `BeachScatter`, `BeachStarfish`, `CoastalGroundcover` | none | **Adapt** | Scatter layers keyed on shore distance + biome |

### Snow and alpine

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| `SnowSurface.js` accumulation (altitude, slope, wind exposure, slope patches, ice, packed trail) | Snow = colour class (`snowLine`, `snowSlopeMax`) | **Adapt** | Into `TerrainMaterial*Nodes` + CPU twin for vegetation gating |
| `snowNoiseNodes`/`snowShadingNodes` (sastrugi, backscatter, glints) | none | **Port** | MIT snowflow lineage, keep credits |
| `SnowDeformationField` (player-centred footprints, berms, gradients) | none | **Port** | Camera/player-local ring texture; also used by sand |
| `SnowPowderSystem` (kicked powder, spindrift) | none | **Port** | Instanced GPU particles |
| `SnowSurfWake` / `snowWakeSpine` (deep-snow wake) | none | **Port** (later) | Nice-to-have after footprints |
| `SnowfallSystem` (hash-driven flakes, wind coupled) | `snow_system.js` (fixed flakes) | **Adapt** | Replace/merge flake material; keep `weather_controller` API |
| `SnowAtmosphere` (regional light blend toward low warm sun) | none | **Port** | Weight from camera-local elevation/biome |
| `valleyFog.js` (height-marched mist in gorges) | fog in `StylizedSkyView` | **Adapt** | Marches heightfield per pixel. Quality-gated, region-weighted, A/B required |
| `MountainNoise.js` (domain-warped ridged multifractal, damped octaves) | Azgaar relief + exaggeration | **Adapt** | Local relief in `AzgaarMacroWorldGenerator`; changes terrain ⇒ re-import + perf QA |
| `AlpineRegion` cirque, couloirs, crest notches | none | **Ideas** | Per high-relief cell, not a single authored cirque |
| Alpine trees `tree10/11` (snow spruce, windswept pine) | Conifers from GLB + generated broadleaf | **Port** | Taiga/tundra variants via residency |

### Vegetation and biomes

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| Coastal-jungle kit (palms, broadleaf, ferns, vines, climbers, split-leaf, banana) | Generated `tropical_tall` only | **Port** | Biomes 5 & 7 (and 3 savanna edges); v2 kit with Meshopt |
| `CoastalJungleCulling/Visibility` distance keep-curves | `StylizedLodRuntime`, impostors | **Ideas** | Keep ours; take the keep-curve tuning |
| Grass silhouettes (slender/reed/broadleaf/tufted) atlases | `GrassBladeProfilePool` | **Adapt** | New blade profile sets per biome (reed → wetland 12, tufted → tundra 10) |
| `InteractionMap` (persistent trampling, recovery) | Rock trampling only | **Port** | Player + NPC feet paint a scrolling ring texture |
| `UnderstorySystem` + billboards, `MeadowDetails`, `WildGrassSystem` | Bushes, flowers, ground detail | **Ideas** | Cherry-pick species/tuning; our streaming stays |
| `LeafSystem` (falling leaves, zone variants, wind advected) | none | **Adapt** | Emit near deciduous canopy (biome 6/8) from tree manifest |
| `BirdSystem` flocks | `StylizedAuthoredBirdTier` (crow/gull) | **Skip** | Ours is already streamed |
| `vegetationEcology`, `ProceduralVegetationField` | `ForestHabitatField`, `ScatterClusterField` | **Ideas** | Compare rules; don't replace |
| `GrassPainter` | Terrain brushes | **Skip** | Editor has its own tools |
| Recovered grass/tree materials | — | **Skip** | Licensing (§2.1) |

### Weather, wind, atmosphere, look

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| `WindField.js` advected multi-scale gusts + per-class response | Per-system wind uniforms | **Port** | One shared world wind field for grass, trees, leaves, rain, snow, cloth, character wind |
| Rain wetness (ground darkening/roughness, water ripples, persistent beach moisture) | Rain particles only | **Adapt** | `EnvironmentState` accumulators, frame-rate-independent |
| Environment presets (Highfield, Emberfall, Greyrain, Galewind, Stillmeadow, Lowsway, Moonrise) | Weather modes; single day palette | **Adapt** | Becomes time-of-day × weather presets feeding `StylizedSkyView` |
| `IrisTransition` | none | **Port** (optional) | UI flourish for preset hard cuts |
| `cloudShadow.js` (2 value-noise taps) | none | **Port** | Multiply into terrain/grass sun term; world-anchored offset |
| `sceneLight.js` (shared frame light for spray/foam) | Sky is lighting authority | **Adapt** | Read from `StylizedSkyView`, don't add lights |
| Look-and-feel grade (lift/gain, highlight desat, grain) | `ToneMappingNode`, presets | **Ideas** | Tuning only; the workshop preview must match |
| `CinematicPipeline`, `GpuOcclusion`, `DepthNormals` | Full post graph, Hi-Z | **Skip** | Ours is more complete |

### Characters, NPCs, player

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| 8 rigged GLBs (Drusniel, Enanillo dwarf, Paladin, Cleric, Wizard, Serpent Master, Goblin, Villager) | Procedural drow + cloth | **Port** | Roster becomes player choices + NPC archetypes |
| `characterRoster.js` + `characters.yaml` (targetHeight rescale, per-rig clip names, two rig generations) | none | **Port** | |
| `CharacterMotion.js` (mean-upper-body idle from walk, ankle measurement, foot placement, in-place root motion) | `gait.js` for procedural rig | **Port** | Makes stock Meshy walk/run look authored |
| `LocomotionCalibration` (`clipSpeedInHeights`) | none | **Port** | Kills foot sliding |
| `FootstepContacts` | none | **Port** | Drives audio, trampling, snow/sand prints, water ripples |
| `ContactShadow` (body blob + per-foot occlusion on terrain normal) | none | **Port** | Big grounding win at low cost |
| `CharacterOcclusion` (screen-space dither of foliage in front of player) | none | **Port** | Needs `maskNode` hook in tree/bush/grass materials |
| `NpcSystem` (villager ambles, goblin roams, clip fades, turn rate) | Sim has population, nothing rendered | **Adapt** | Presentation layer for `sim/population`, with crowd LOD (§5.6) |
| `PlayerController` / Rapier | Own `PlayerPhysics`, collision stack | **Skip** | Keep ours; port only the camera boom obstacle idea |
| `ExplorationSpeedMode`, `FreeFlyController`, `MobileControls` | View modes | **Ideas** | Free-fly is already covered by orbit; mobile later |

### Audio, UI, tooling

| grass-test | Ours today | Verdict | Notes |
|---|---|---|---|
| CC0 sound bank (61 sounds, 1.8 MB) | `procedural_audio.js` + event bus | **Port** | Sample-backed events with procedural fallback |
| `FootstepAudioSystem` (surface classification, water) | none | **Adapt** | Surface = biome + snow/sand/path/water sample |
| `AmbientAudioSystem`, `RandomAudioEmitters` | none | **Adapt** | Beds by biome weight × weather × time |
| `LoadingUi` character picker, `LoadingArt` | none | **Adapt** | Character select before the first frame |
| `ScenicTour` | Perf QA routes | **Ideas** | Scripted camera tour through biomes for QA and trailers |
| `FrameSlack` / movement-stutter scheduler | `StylizedBuildQueue` | **Ideas** | Compare budgets while fixing hitch counts |
| `Minimap` bake | World map + `minimapBurgs` | **Skip** | |
| `ExpandedLandscape`, `BakedLandscape` (19 MB bin), `BoundaryBarrier`, `ZoneIndex`, `TerrainRenderChunks`, `LandscapePaths` authored routes | Streamed world | **Skip** (take the path-grading ideas, §5.8) | Fixed-map machinery |
| Medieval house GLBs (7–10 MB each) | Procedural workshop masonry | **Skip** | Conflicts with the workshop art direction and budget. Reference only |

## 4. Shared foundations (Phase 0, blocks everything else)

These four modules are small, and every later phase reads them. Build them first so the ported
systems don't each invent their own copy.

### 4.1 `WorldWindField` (from `weather/WindField.js`)

- New `src/editor/weather/WorldWindField.js` (CPU sampler + uniform bundle) and
  `worldWindNodes.js` (TSL sampler).
- Advect along the **prevailing** direction only. Meander goes in the warp (grass-test's
  documented bug: advecting by local direction makes wind accelerate over time).
- Canonical-world coordinates with floating-origin offset uniform; wrap the time term.
- Response profiles per class: blade, flower, bush, tree canopy, falling leaf, rain, snow,
  cloth (`CharacterWind`).
- Wire `weather_controller` wind X/Z and intensity into it; then migrate
  `StylizedGrassMaterial`, `StylizedTreeMaterials`, rain/snow materials one at a time.
- Acceptance: one gust visibly crosses grass → trees → rain; no drift at t > 30 min;
  `qa:perf` A/B within noise.

### 4.2 `EnvironmentState` (weather accumulators + light snapshot)

- `src/editor/weather/EnvironmentState.js`: rain intensity, surface wetness (exponential
  wet/dry integration), snow cover bias, cloud coverage, time-of-day, moon phase.
- Owned by `weather_controller`; read-only for materials through one uniform group.
- Serialise wetness and wave clock with the session, as grass-test does on recovery.

### 4.3 `RegionalWeights` (camera-local region tracker)

- Samples biome ID / elevation / shore distance / water kind under and around the camera
  (from resident pages, macro atlas fallback) and exposes smoothed weights:
  `snowCountry`, `coast`, `jungle`, `wetland`, `desert`, `underwater`.
- Replaces grass-test's map-bounds gates (`SnowRegionBounds`, `CoastalJungleRegion`).

### 4.4 Licensing and asset intake

- `docs/licenses/grass-test-imports.md`: per-file source, author, licence, date. Update
  `THIRD_PARTY_NOTICES.md` (snowflow MIT; Codex-and-Blender MIT; OpenGameArt CC0).
- `scripts/import-grass-test-assets.mjs`: copy only allow-listed files, re-encode
  (Meshopt/KTX2/WebP) with the existing `optimize:runtime-assets`, and write manifests.
- Extend `validate:assets` to fail on any unlisted grass-test file.

## 5. Phases

Ordered by **impact on playability and look ÷ risk**. Each phase is independently shippable.
Effort is a rough guide in focused agent-days.

### 5.1 Phase 1: Characters that feel alive (≈5–7 days)

Why first: the player is on screen 100 % of the time, and the sim already has populations,
adventuring parties and monsters with no bodies.

1. **GLB character runtime** under `src/editor/character/glb/`:
   - `CharacterRoster.js` + `config/characters.yaml` (port the schema: `targetHeight`,
     per-rig clip names, `rootMotion.inPlace`, `clipSpeedInHeights`, `footPlacement`).
   - `GlbCharacterView.js` implementing the same interface as `CharacterView` (`update`,
     `setMotion`, `dispose`), so `PlayerController` picks one or the other. The procedural drow
     stays as a roster entry ("Drow (procedural)").
   - Port `CharacterMotion.js` (mean upper-body idle, ankle measurement), `LocomotionCalibration`,
     `FootstepContacts`.
   - Rescale from posed skinned bounds to `targetHeight` (handles the cm/0.01 vs m rigs).
   - Load through residency: only the chosen player model blocks gameplay, not the first frame.
2. **Grounding:** port `ContactShadow` (terrain-normal blob + per-foot occlusion; uses our
   `getWorldHeight`) and `CharacterOcclusion` (add `characterOcclusionKeep()` to the
   `maskNode` of tree leaves, bushes, tall grass; colour passes only).
3. **Character select:** a loading-screen picker (from `LoadingUi`), `?character=` override
   for QA, and persistence in settings.
4. **Footstep event bus:** `FootstepContacts` emits `{foot, position, speed, surface}` that
   audio, trampling, snow/sand prints and water ripples subscribe to (§5.4, §5.5, §5.7).

Acceptance: no foot sliding at walk/run in QA capture; idle arms hang naturally; the player stays
visible through canopy; `CharacterView` perf unchanged when the drow is selected.

### 5.2 Phase 2: Rivers with waterfalls (≈5–6 days)

1. **Fall detection:** `water/RiverFalls.js` runs `findRiverFalls` over each river's
   segment levels in `createRiverSurfaceSegments`: slope > 0.35, drop ≥ 3 m, peak > 0.6.
   Relief is exaggerated 48×, so add a `maxFallsPerRiver` cap and a minimum spacing, and tune the
   thresholds in `editor.config.yaml` (`water.falls.*`). Falls are deterministic from the import,
   so no persistence change is needed.
2. **Field encoding:** extend the worker water field with a fall/cascade weight and travel
   time. Prefer packing into the existing flow texture (RG8 → RGBA8: B = fall weight,
   A = travel-time phase) over adding a new texture/vertex attribute (see the 9-attribute
   ceiling memory).
3. **Shading:** port `waterfallTexture.js` and the fall/plunge branch into
   `StylizedWaterMaterial`: strands stretched along the fall, speed rising 1.4 → 6.5 m/s, bank
   fraying, impact churn decaying downstream, reflections reduced on cascades. The branch
   only runs where fall weight > 0.
4. **Geometry:** a river-segment surface already follows the slope. Check that steep
   segments get enough vertices, or add a cascade ribbon mesh per fall generated in the worker.
5. **Mist:** port `WaterfallMist` as a pooled instanced system. Each resident page contributes
   its falls, and the pool is capped with a 650 m draw distance and quality shares 0.35/0.6/0.85/1.
   Lighting reads the sky's sun/hemisphere (no new lights).
6. **Rocks:** add a `riverbank` placement mode to `StylizedRockView`: bank stones clustered
   with bare gaps, lip boulders, tumbled plunge-pool blocks, settling toward the low side.
   Stones skip fall zones but keep their random draws (stable placement).
7. **Mouth handover:** blend river → ocean kind over the last 2.5 m of fall and sink
   near-sea apron ground 0.35 m (shoal) in `WaterTerrainModel`, so estuaries don't end in a sand bar.

Acceptance: the tallest fall in Eldara reads as falling water from 300 m; mist ≤ 0.1 ms GPU
up close; no chunk-border seams in fall shading; hitch count A/B unchanged.

### 5.3 Phase 3: Lakes (≈4–6 days; requires a decision)

W4 deliberately deferred lakes, because stable lakes change geography and persistence.
Azgaar exports lakes as features (`pack.features[type=lake]` with height and a cell list),
and we already persist a `featureId` guidance field.

- Decision needed: **water-domain version 3**, which adds lake body IDs and per-body surface
  elevation from Azgaar lake features. Per CLAUDE.md there's no legacy migration, so worlds are
  re-imported.
- `WaterTerrainModel`: carve the lake basin below the body level, clamp inflow/outflow river
  levels to the lake level (grass-test's `outletStartIndex` logic), and add a river-ownership
  mask so lake and river don't double-draw.
- Port `LakeFlora` species into `AquaticPlacement` (rooted: eelgrass, waterweed, pondweed;
  floating: lily pads riding the broad wave).
- Lake audio bed and shoreline footsteps come from Phase 7.

### 5.4 Phase 4: Coast, beach and deep sea (≈6–8 days)

1. **CoastField adapter** (`water/CoastSurfaceNodes.js` + CPU twin): signed shore distance
   (field A) plus a wave phase give run-up front, thin-water coverage, foam front, wash
   memory and permanent moisture. The shared `seaCoverage` ramp (0.015–0.15 m mean depth)
   hands off between the sea and ground materials.
2. **Wet sand in the terrain material** for sand-bearing cells (shore band of any biome,
   desert 1/2 coasts): film, reflective wet → damp → dry. Rain raises moisture from
   `EnvironmentState`.
3. **Sea swell:** apply five zero-mean directional components (λ 56/38/28/20/16 m,
   amp 1.6, storm × 1.65) as vertex displacement on ocean water slots only. Scale by
   `smoothstep` of bathymetry depth so the waterline stays put, and inflate slot bounds by the max
   displacement. Normals come from a mipmapped slope texture with a second moment (specular
   broadens with distance instead of aliasing).
4. **Whitecaps and crest transmission** in the ocean branch.
5. **Deep sea:** depth-driven absorption and colour from bathymetry (already 24 m max; allow a
   deeper `abyss` band for open ocean); swell amplitude grows with depth. Port the
   `UnderwaterPerformanceController` idea: drop grass, ground detail and far scatter while
   submerged.
6. **Rain ripples** on all water (cell-ring normal) gated by rain intensity.
7. **Beach scatter:** `BeachScatter` (pebbles, shells, twigs) and starfish in the swash band,
   `CoastalGroundcover` creeping leaves 55–145 m inland. Both are scatter layers keyed on shore
   distance and biome, with no collision and no shadows.
8. **Sand footprints and kicked sand** reuse the Phase 5 deformation field and powder pool.

Acceptance: sea meets the beach with moving swash and a drying wet band; no T-junction seams
between slots; the sea draw is ≤ its current cost +10 % at "high"; the stated
viewport-texture rule holds (medium keeps no copied depth).

### 5.5 Phase 5: Snow country (≈7–9 days)

1. **Accumulation model** (CPU + TSL twins, like grass-test's `snowSlopePatchCpu`):
   elevation band, slope start/full with slope-patch noise, wind-exposure/lee
   (`snowAccumulationShift` from aspect × prevailing wind from `WorldWindField`),
   concavity, and glacier (11) / tundra (10) biome bias. Replaces the `snowLine`/`snowSlopeMax`
   classification in `TerrainMaterialBake*`. The CPU twin gates grass, flowers and broadleaf trees
   (nothing grows through lying snow).
2. **Snow shading nodes** (snowflow port): sastrugi, multi-scale detail, blue
   backscatter, grazing glints, rock tint under the band, water-ice on steep faces, packed
   snow on paths.
3. **Deformation:** `SnowDeformationField` as a player-centred scrolling RGBA8 texture
   (depression, berm, gradient XZ). Painted from footstep events, read through
   `createDeformationNodes` by snow and sand. NPCs near the camera paint too.
4. **Powder:** `SnowPowderSystem` for footfall kicks and ambient spindrift (snow only).
5. **Snowfall:** replace `snow_system.js` flakes with the `SnowfallSystem` material (hash
   phases, wind-coupled), keeping `weather_controller`'s API and the WebGL fallback.
6. **Snow atmosphere:** `SnowAtmosphere` blends the active sky toward a low warm sun, cool
   sky and haze by the `snowCountry` weight, relative to the preset (a moonlit summit stays
   moonlit).
7. **Valley fog** (quality ≥ high, `snowCountry` > 0.001): height-marched mist sampling the
   macro/near height. **Perf risk:** A/B it alone; if it costs more than 0.5 ms, move it to
   a half-res post node.
8. **Mountain relief (optional, terrain change):** `MountainNoise` ridged multifractal (3
   octaves; drop octaves finer than 2 cells) in `AzgaarMacroWorldGenerator` local relief for
   high cells. Adds couloirs and crest notches where slope and elevation qualify. This changes
   terrain generation, so follow `docs/perf-qa.md`. The world must be re-imported.
9. **Alpine trees:** snow spruce and windswept pine (`tree10/11`, repo geometry + user bark) as
   residency variants for taiga (9) and tundra (10) edges.
10. **Deep-snow wake** (`SnowSurfWake`), later, after footprints ship.

### 5.6 Phase 6: NPCs and crowds (≈6–8 days, after Phase 1)

The sim has settlements, population, factions, combat and adventuring parties with no
visual presentation. `NpcSystem` shows the pattern: wander targets, clip cross-fades,
turn rate.

- `src/sim/presentation` → `NpcPresentationView`: pulls agents near the camera from
  sim queries and assigns archetypes (villager, goblin, paladin, cleric, wizard, dwarf,
  serpent master) by settlement culture, faction and role.
- **Crowd LOD** (NpcSystem has none, so this is required):
  - ≤ 30 m: full skinned mesh, per-character mixer, foot contacts, contact shadow;
  - 30–120 m: shared mixer per archetype × clip with phase offsets. Mixer updates are
    throttled (every 2nd–4th frame), with no contacts;
  - 120–300 m: baked vertex-animation texture (VAT) instanced mesh per archetype (bake
    script from the GLB clips), one draw per archetype;
  - > 300 m: none, or an impostor dot on the map.
- Behaviours: villagers amble between buildings, work spots and the tavern; guards patrol
  roads; goblins roam wilds/shores and alternate walk/run. Driven by sim state, not random.
- Culling: frustum + distance; register in perf counters.

### 5.7 Phase 7: Weather, time of day, atmosphere (≈4–5 days)

- **Presets as time × weather:** port the seven environment presets into
  `StylizedSkyView` palette sets (Highfield day, Emberfall golden hour, Greyrain overcast
  rain, Galewind windy, Stillmeadow calm, Lowsway low-sun, Moonrise night). Weather modes
  stay orthogonal: `weather_controller` picks the sky preset and wind/rain from mode + time.
- **Wetness:** ground darkening and roughness drop from `EnvironmentState.wetness` in the terrain,
  rock, building and character materials (grass-test tags meshes with rain-roughness metadata).
  Buildings get it through the workshop materials. Check that the workshop preview and world
  still agree.
- **Cloud shadows:** port `cloudShadow.js`, with offset from the sky cloud drift in world space
  (floating-origin safe).
- **Falling leaves:** `LeafSystem` near deciduous canopies (biomes 6/8, autumn tint in
  golden hour).
- **Grade tuning:** apply the look-pass ideas (lift/gain, highlight desaturation, grain)
  as `PostProcessingPresets` values, not a new pass.
- **Iris transition** (optional) for preset/teleport hard cuts.

### 5.8 Phase 8: Vegetation and biome kits (≈6–8 days)

- **Tropical kit:** the coastal-jungle v2 objects (palms, broadleaf, ferns, vines, climbers,
  split-leaf, banana understory, background trees + LOD) become residency layers with
  `tileIds` for tropical seasonal forest (5) and tropical rainforest (7), plus palm-only
  coastal edges for savanna (3) and hot desert (1) oases. Meshopt decoding is required. Species go
  into `ForestSpeciesRegistry` so impostor baking covers them (`bake:impostors`).
- **Grass silhouettes per biome:** add reed / broadleaf / tufted / slender profile sets to
  `grassBladeProfiles` (wetland → reed, grassland → slender + broadleaf, tundra → tufted,
  savanna → tall slender, dry tint).
- **Trampling:** port `InteractionMap` as a player-centred scrolling texture read by
  `StylizedGrassMaterial` (bend + slow recovery), painted by footstep events.
- **Trails:** take `LandscapePaths`' walkable grading (forward/backward max-grade
  profile, blend within `terrainWidth`, terraced `cut` gorges) and apply it to Azgaar routes
  (roads/trails) in the chunk worker. Walkable roads over the exaggerated relief matter for
  playability. This is a terrain-generation change, so it goes through the perf QA protocol.

### 5.9 Phase 9: Audio (≈3–4 days)

- Import the CC0 bank (≈1.8 MB, mp3). Map files to `audio_events_defaults.json` IDs. The
  procedural synth stays as fallback and for events without samples.
- Surface-classified footsteps (grass, dirt, sand, snow, stone, wood, shallow/deep water)
  from `FootstepContacts` + terrain/water sample + snow/sand coverage.
- Ambient beds weighted by `RegionalWeights` (forest, wetland, lake, coast, highfield
  wind) × weather (rain light/medium/heavy) × time (crickets at night, birds by day).
- Random 3D emitters (birds, crows, frogs, insects) around the listener, gated by biome/time.
- Waterfall roar positioned at falls from Phase 2.

## 6. Recommended order and milestones

```text
P0 foundations ──► P1 characters ──► P6 NPC crowds
       │
       ├──► P2 waterfalls ──► P3 lakes (decision)
\n       ├──► P4 coast & sea
       ├──► P5 snow ──► (P8 trails/relief share the terrain-change QA window)
       ├──► P7 weather/time/atmosphere
       └──► P9 audio (can start any time after P1's footstep bus)
```

- **Milestone A, "walk the world":** P0 + P1 + P9 footsteps. You pick a hero, they're grounded
  and audible.
- **Milestone B, "water you remember":** P2 + P4 (+ P3 if approved).
- **Milestone C, "seasons of Eldara":** P5 + P7 + P8.
- **Milestone D, "living towns":** P6.

## 7. Decisions (resolved 2026-09-24)

1. **Lakes (P3): approved.** Water-domain v3 carries lake body IDs and per-body surface
   elevation from Azgaar lake features. Worlds are re-imported. No legacy migration.
2. **Terrain-shape changes: approved as one window.** P5.8 (ridged relief) and P8 (graded
   trails) ship together behind a single generator-version bump and one re-import.
3. **Asset rights:** the user confirms that all eight character GLBs are theirs, generated with
   Meshy. They are cleared for import. Open point: grass-test's own records
   (`docs/tree-system.md`, `fantasy/manifest.json`) describe `fantasy/tree1–9` as derived
   from the reference demo's `terrain2.glb` (`Tree1_High`…), not from Meshy. Those nine stay
   out until that provenance is reconciled. `tree10/11` are original procedural geometry with
   user bark and are cleared.
4. **Hero character: Drusniel.** The default player is `Drusniel_Dark_Elf.glb`. The
   procedural drow stays selectable (`character.hero: drow`). Started 2026-09-24. See §9.
5. **Medieval houses:** skipped in favour of the workshop system.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Waterfall count explodes with 48× relief | Thresholds + per-river cap + min spacing in config; count reported in perf counters |
| Skinned crowds CPU-bound | VAT tier + throttled shared mixers; hard cap on full-rig NPCs |
| Valley fog / snow shading GPU cost | Quality-gated, region-weighted; A/B each piece alone |
| Vertex attribute ceiling (9th attribute makes mesh vanish) | Pack into vec4s / existing flow texture |
| Float precision at planet scale in waves and noise | Canonical coords + floating-origin offset uniforms + wrapped phases |
| three 0.185.1 vs 0.186 TSL differences | Compile-check each ported node file; no version bump |
| Licensing contamination from recovered lineage | Allow-list import script + `validate:assets` gate |
| Workshop/world tone mismatch after grade and wetness | Shared tone-mapping settings; verify in both views |

## 10. Addendum: grass-test commits of 2026-09-22 to 2026-09-25

grass-test kept moving after this plan was written. Reviewed through `05ba54c`, the
same rules apply (§2): clear rights only, and the recovered-reference lineage stays
out.

| Area (grass-test) | What it adds | Verdict | Target here |
|---|---|---|---|
| Audio bank v2 (`3f8c12a`, `93ed089`, `scripts/build-audio.mjs`) | The bank is rebuilt from CC0 and public-domain recordings, with `CATALOG.md` giving every source and licence. New: snow and sand footsteps, alpine and meadow wind, sea surf, stream, jungle day and night, night crickets, and one-shots (meadow birds, crows, seagulls, waves, frogs, cicadas, parrots, screaming piha). The old bank is deleted | **Port, replacing our copy of v1** | `public/audio/cc0`, the audio events, `AmbientSoundscape` regions (snow, sand, surf, jungle, water) |
| Ambient effects (`5a02d7b`, `d6e9d6b`) | Per-region GPU particle fields: diamond dust, spindrift, pollen, dandelion seeds, fireflies at night, blowing sand, surf spray, jungle spores, midges. Also the player's breath, spindrift plumes off crests, and blown streaks on snow and sand. Frost, heat shimmer and jungle mist in the post pass | **Port** particles, breath, plumes and streaks. Frost is ported in the grade. Heat shimmer and jungle mist read the scene or depth, so they need an A/B first (CLAUDE.md viewport-texture rule) | new `stylized/ambient/`, regions from `sampleTilesAround`, `SnowCountryWeight` and water queries |
| Surface detail (`83cdfa3`, `d6e9d6b`, `3ff00ed`) | Rock streaks, strata, curvature crevices, ledge snow; height-blend transitions; scree; beach strand stones; wet waterline and algae; bark weathering (moss, streaks, snow); straw fringe at path edges; tree and rock contact shade | **Adapt** bark weathering to the tree materials and rock weathering to the rock view. Terrain terms have to fit the baked material and its texture budget | tree and rock materials; `TerrainMaterialBakedNodes` |
| Beach and water life (`833a420`, `624b36a`, `3f8c12a`) | Starfish, seabed rocks, sea algae, lake flora, river details, beach palms, a strand-line scatter | **Port** the procedural pieces as stone-sink and scatter layers. Palms follow the tropical kit (P8) | `coastStones` pattern, water slots |
| Giant serpents (`b755559`, `05ba54c`) | Procedural giant snakes: species, a worker-baked skin, and a body that follows its path | **Port** as wildlife in jungle and wetland | new `stylized/wildlife/serpents/` |
| NPCs (`7cd863f`, `9c56206`, `09a07d2`, `41507c7`, `e502ff2`) | NPC kinds (villager, goblin), village farmers, per-camera culling, minimap markers | **Fold into P6** with its crowd LOD | `NpcPresentationView` |
| Assisted camera follow (`f149f95`, `d06e528`) | Camera follows the heading unless you look around (touch only) | **Skip**: desktop input | — |
| Loading and draw-call work (`e502ff2`, `1b08080`, `2ec9162`, `93fd222`, `2193353`) | Scene preprocessing, asset load context, one grass batch per LOD, per-variant low-LOD tree shadows, resolution-independent tree LOD | **Ideas only**: our streaming and residency differ. Revisit tree shadow casters under perf QA | — |
| Grass density and blinking-strip fix (`a42791c`) | Lives in `RecoveredGrassMaterial` | **Excluded** (recovered lineage) | — |
| Character occlusion smoothstep fix (`5501d02`) | Reversed smoothstep | **Already fixed here** | — |

Order: audio v2, ambient effects, serpents, beach and water life, surface detail,
then NPCs with P6.

## 9. Implementation log

- **2026-09-24, Drusniel hero (P1 core).** Meshy source decoded from Draco into
  `assets/characters/`, prepared by `scripts/prepare-character-assets.mjs`, and published
  through the gltfpack pipeline. The runtime is `src/editor/character/glb/`: roster
  resolution, in-place root-motion calibration, distance-driven walk/run phase (the drow's
  no-slide rule), a generated standing pose, foot placement on slopes, a procedural cast
  pose, and it relies on the 0.5 m first-person near plane (as the drow did) to
  clip the head. It is chosen by `character.hero` in `editor.config.yaml`.
  - Asset: 31,077 triangles and 28 joints. Walking and Running are kept and `restpose` is
    dropped. Published at 859 KiB (Meshopt + KTX2), passing `validate:runtime-assets` and
    `validate:character-assets`.
  - Verified in the running app (WebGPU): it loads after the first frame and compiles
    before its first draw. The 9 m/s walk plays the run clip at 2.03×, the 16.2 m/s sprint
    caps at 3.2×, and the body faces its direction of travel. Feet sit at ground +
    measured ankle height, including on a 14° slope. The cast raises the leading arm.
    Frames were captured standing, running side-on and casting.
  - Cost: the `character` perf phase averages 0.09–0.11 ms of CPU per frame (p95 0.2 ms).
    A whole-frame A/B against `hero: drow` could not be completed on the
    2026-09-24 machine state: the drow side timed out at boot, because its prewarm
    recompiles the whole scene. Repeat it with `--warmup 20` on a quiet machine.
  - Still open in P1: the character-select screen, contact shadow, foliage dither around
    the player and the footstep event bus.
- **2026-09-24, swimming.** No roster rig ships a swim clip, so the swim is posed
  procedurally over the standing pose. `SwimMotion` computes the swim weight, the
  tread↔stroke blend, body pitch along the direction of travel (capped at 1.3 rad at the
  surface so the head stays out, up to 2.6 rad head-down when diving) and the stroke
  phases. `SwimStroke` solves the hands and feet onto front-crawl, flutter-kick,
  sculling and eggbeater paths in the body's own frame, using the shared two-bone reach.
  The body pitches about a chest-height pivot, which sits just below the surface at the
  float depth. Verified in the running app on open sea: treading shows head and shoulders
  out, the crawl lies flat along the surface, and the dive runs head-down.
- **2026-09-24, rest of the characters phase.**
  - *Roster:* all eight Meshy characters were imported (Drusniel, Enanillo, Paladin,
    Cleric, Wizard, Serpent Master, Villager, Goblin). The rig contract ignores the
    `mixamorig:` prefix, so the Villager and Goblin rigs work too. Older exports without
    a metal/roughness map are made dielectric at prepare time, because glTF's default
    factors are fully metallic and render black without an environment map. Swimming
    lifts every body to the same chest depth, so short heroes keep their heads out.
  - *Character select:* a topbar picker (`HeroSelectUi`) drives `SwitchableCharacterView`.
    The current hero stays on screen until the new one has loaded and compiled, a failed
    load keeps the current hero, and a newer pick supersedes a pending one. The choice is
    saved per viewer, and `?hero=` overrides it.
  - *Contact shadow:* a soft blob under the body and a patch under each sole lie on the
    terrain slope and fade as the body or a foot leaves the ground. It is hidden while
    swimming. `character.contactShadow` switches it off.
  - *Footsteps:* `FootstepTracker` fires when the shared stride phase crosses each foot's
    measured landing. Footfalls reach listeners across hero swaps, and play the
    procedural `player.footstep` sound, or `player.footstep.water` when wading.
  - *Canopy cut:* tree-leaf materials dither open in a window around the third-person
    hero (`CharacterOcclusion`), for leaves only, because the shadow pass falls back to
    `maskNode`. The uniforms were verified live. A pixel capture of the cut was not
    obtained.
  - *Verified in the app:* the goblin with its contact shadow, and a live swap to the
    Paladin.
  - *Open:* one capture right after the first Paladin swap showed a red wedge where his
    shield should be. It did not reproduce in a second swap, and CPU skinning of that
    asset is clean. Watch for it.
- **2026-09-24, shared wind field (P0, §4.1).** `WorldWindPass` evaluates the gust field
  once per frame into a camera-centred 128² half-float target (384 m, texel-snapped in
  canonical space, lattice wrapped mod 1024, integer hash so CPU and GPU agree to ~3e-5).
  Grass and flowers sample it for sway direction and gust strength. Trees are not wired
  yet: their `positionNode` has no per-tree world position to sample with.
- **2026-09-24, water domain v3: falls and lakes (P2 + P3).** Worlds must be re-imported.
  - *River levels and falls:* Azgaar river points sit about 100 km apart. A straight
    surface between them floated over the valleys in between: 21 % of Eldara's river
    length was more than 2 m above the ground, and up to 411 m. Levels are now traced
    along the terrain every `river.profileStepMeters` (100 m) as a running minimum, and
    a lake a river runs through caps its level (`RiverReachProfile`). Now 1.2 % floats,
    by at most 5 m. Where the trace drops at least `falls.minimumHeight` within one step,
    that drop becomes a waterfall, split into a cascade above `maximumHeight`. The
    carved bed follows the falls, so each face is a real cliff. On Eldara that gives 721
    falls on 57 reaches, median 5 m and at most 22 m. Building the traced profile adds
    no measurable time. `RiverChannel` now indexes only the blocks its channel crosses.
    The old bounding-box enumeration overflowed a `Map` on Eldara.
  - *Gorges (2026-09-25):* where an Azgaar path crosses a ridge, the river used to cut a
    slot only as wide as its channel. 11 % of river length ran more than 50 m below the
    ground. `RiverValley` now holds the ground beside every channel under a slope ceiling
    (`river.valleySlope`, 0.7). Its reach follows the cut on the centre line (up to
    `valleyReachMeters`), so walls climb all the way out before the terrain takes over. A
    levee (`leveeHeight`, `leveeWidthMeters`) keeps low ground beside the channel above the
    water. Lakes and valleys share `BankProfile`. On Eldara the deepest gorges (≈630 m)
    now have walls of exactly 0.7, where the worst slope used to be 3.7. The coarse 512 m
    valley index holds 495 k keys, and model build time is unchanged.
  - *Lakes:* Azgaar stores lakes as low marine cells, which rasterized as sea-level pits.
    The import now rasterizes lake cells as land at the lake's level, in the biome around
    them (`AzgaarLakes`), and keeps each lake's height and outline. `LakeBodies`:
    - fills each lake at the level its Azgaar height maps to (Eldara: 0.3–54 m), with
      noise applied to the shoreline;
    - carves a bed up to 18 m deep and raises a 1.5 m bank so a lake cannot spill;
    - holds nearby hills to `shoreSlope` (0.3). Azgaar outlines follow cells, not the
      terrain's dip, so without this the shores were cliffs up to 300 m high.

    Rivers entering a lake run at its level. Lake cells report the water tile, so
    tile-driven water and far terrain show them.
  - *Look:* the flow texture is now RGBA: current, fall weight, plunge weight.
    `WaterfallShading` streaks a strand texture ported from grass-test down each face and
    churns the plunge pool. `WaterfallMist` gives grass-test's GPU spray puffs to the six
    nearest falls within 650 m, in floating-origin space.
    `stylizedSurface.water.waterfall` tunes both, and neither is drawn at water qualities
    without foam.
  - *Import fix:* a fresh Azgaar import never recorded its water domain, so the loader
    refused it ("version 0 requires migration"). This happened before this work too. The
    importer now stamps the active domain.
  - *Lake inflow:* where a river still stands above a lake's level, the river owns the
    water, so a fall at the shore runs down into the lake unbroken.
  - *Verified in the app* (a private Chromium on Eldara, re-imported):
    - A 15.5 m fall on open river shows its whitewater face across the channel, with
      spray at its foot. Six mist slots were live, four of them in view.
    - The flow textures around it carry the fall and plunge weights: 1,159 fall texels
      and 7,090 plunge texels.
    - Albromer lake shows from its bank.
    - No scene geometry had non-finite positions.
  - *Found in passing:* the flower cross geometry was missing one position value
    (23 instead of 24). That skewed every flower's second plane and made three.js log
    NaN bounding spheres. Fixed.
- **2026-09-25, trees: morphology and world wind.** The compiled WGSL showed that three
  r185 applies the instance matrix before a material's `positionNode`. So the per-tree
  crown and trunk scale, written for prototype space, acted in mesh space, and pulled
  crowns up to 156 m away from their trunks. On screen, near trees stood as bare
  branches. `setPreInstancePosition` now runs the morphology before instancing. The leaf
  wind and canopy colour gradient read the prototype height (`positionGeometry`), where
  they had read world height and saturated. Trees and tree proxies now take sway
  direction and gusts from the shared world wind field, with no extra vertex buffer.
  Verified in the app: identity against real morphology on the same tree, and a stand
  with crowns in place. A young or dead tree legitimately shows a small crown under bare
  branch tips; that is `treeMorphology`'s design, visible for the first time.
- **2026-09-25, P2/P3 closed out.**
  - *Riverbank rocks:* `buildRiverbankRocks` adds stones to the rock view's manifests
    (`rocks.riverbank`). Bank runs are clustered with bare gaps and skip fall faces;
    boulders sit across each fall's lip and tumbled blocks in its plunge pool. They
    draw, fade, collide and block trees like any boulder. Each stone is owned by the
    chunk its own position lies in, because collision refuses a collider outside its
    owner chunk (the first cut tripped that, and it is fixed). At the 15.5 m test fall:
    141 bank stones, 42 lip boulders and 73 plunge blocks nearby, with no collision
    errors.
  - *Mouth handover:* not needed. A river reaches the sea at sea level, and river
    samples win inside the channel, so the river sheet meets the ocean sheet at the
    same height. The levee is off where the level is at sea level.
  - *Lake flora:* already covered. `AquaticPlacement`'s rooted and floating rules
    include the lake kind, so lakes get aquatic plants now that they exist.
- **2026-09-25, P4 coast and sea.**
  - *Swell (`SeaSwell`, `SeaSurfaceShading`):* five directional components of
    grass-test's sharpened sine drive ocean water only. The water field has no kind
    channel, so the sea is water standing at sea level with no current. The swell
    fades out in the shallows so the waterline holds. A planet-sized sea cannot take
    canonical coordinates in float32, so each chunk gets its components' phases at
    its centre in double precision (`seaSwellPhaseOrigin`). Tests prove this matches
    the absolute swell 4,000 km out and across chunk borders. The unlit sheet reads the
    waves through slope shading, a crest lift, and a fresnel tilted by the swell normal.
    Whitecaps break into streaks built from the swell's own phases. Rain and storm
    raise the sea (`seaStateUniforms.storm`). Gameplay water queries ride the same
    swell (`seaSurfaceOffset`). Config: `stylizedSurface.water.sea`.
  - *Beach berm (terrain, water domain v3):* Azgaar coasts met the sea flat at the
    water line; within 128 m of the test beach nothing rose above sea level. Land
    vertices within `ocean.beachWidthMeters` (30) of the sea now rise to
    `ocean.beachHeight` (1.8 m) when lower; shoreline vertices keep their height.
    It costs nothing measurable per chunk, and inland ground never builds the
    distance field.
  - *Swash (`CoastSwashShading`, terrain material):* as a height above still
    water, after grass-test. It draws a film behind the front, a broken foam line on
    it, and wet sand from wash memory plus a damp band. Lakes and rivers get none.
    Config: `stylizedSurface.water.coast`.
  - *Rain rings (`RainRippleShading`):* on all water, as dense and bright as the
    rain is heavy. The lattice is hashed as integers from each chunk's whole-metre
    origin, so it is exact anywhere. Verified in the app: irregular rings, no lattice.
  - *Beach pebbles (`coastStones`):* rock placements on ground up to 1.8 m above
    the sea, clustered. They share `stonePlacementSink` with the river stones. 466
    of them near the test beach, with no collision errors.
  - *Not needed / deferred:* an abyss band is not needed, because the domain caps
    depth at 24 m and colour saturates by 6 m. Culling scatter while the camera is
    underwater is a performance-only change, deferred to a perf-QA pass. Sand
    footprints and kicked sand wait for P5's deformation field.
  - *Found:* the water material's noise, voronoi and caustic patterns hash canonical
    coordinates and degrade into a regular lattice at planet scale. That was already
    the case with the swell off. It is flagged as its own task.
- **2026-09-25, P5 snow: accumulation, grass gate, and a culling bug.**
  - *Snow cover (`SnowAccumulation`):* replaces the 26 m snow line, which whitened
    most of Eldara (land median 74 m). Snow now follows altitude (from 700 m, full by
    950 m), biome (glacier full, tundra 0.7 by tile id, which is the Azgaar biome id),
    slope, and wind (windward faces scoured, lee faces loaded). Hollows hold more, and
    noise breaks the edge into drifts. The near bake and the far terrain use the same
    band and biome cover, and a test keeps them in step.
  - *Grass gate:* the surface mask evaluates the same snow per cell (`snowAtPoint`,
    shared noise and seed), so grass stops at the drawn snow edge.
  - *Culling bug:* terrain slots shared one flat plane displaced in the shader and
    were culled against the flat plane's bounds. From high ground looking out, every
    chunk was culled and the sky dome's pale underside showed instead. That was the
    white I had taken for snow at the waterfall. It was isolated by hiding layers one
    at a time: near terrain, far terrain, fog, post-processing. Each slot now has its
    own geometry over the shared buffers, with bounds fitted to its page's heights
    (`TerrainSlotBounds`). Verified: a 965 m glacier shows snow relief, and 496 m
    taiga shows green ground.
  - *Snow shading (`SnowSurfaceShading`):* on the baked snow weight. Faces turned
    from the sun take a cool blue backscatter. Sparse facet glints show when you look
    across the snow into the sun, and fade rather than alias once cells fall below a
    few pixels. Glint cells are hashed as integers from each chunk's whole-metre
    origin, so they are exact anywhere, and they sit behind a branch that only snow
    pays for.
  - *Footprints (`groundDeformationState`, `FootprintShading`):* every footfall stamps
    an oriented heel-and-toe print into a toroidal 256² texture over a 16 m window
    around the player (6.25 cm texels). The terrain darkens and cools prints in snow,
    and darkens them on the beach band. They fade over 90 s. Each texel records the
    window it was stamped in, so aliased prints one window away are rejected, and a
    one-texel margin keeps linear filtering from blending that ID away. The shader
    addressing is exact at planet scale, and a test replays it in JS against the CPU
    stamp 7,000 km out. Verified: a soft, alternating trail on a glacier.

- **2026-09-25, P9 audio.** The CC0 bank (61 mp3s, checked against its `CATALOG.md`;
  the uncatalogued root files were left out) is in `public/audio/cc0/`. `SampleBank`
  fetches and decodes on first use. A sound that isn't decoded yet doesn't queue: the
  synth plays that event instead, so nothing arrives late and out of step.
  - *Footsteps:* each footfall's surface comes from `classifyFootstepSurface`:
    - wading → water;
    - snow ≥ 0.5 → snow (the same `snowAtPoint` the terrain draws);
    - wetland → mud;
    - desert, road or the 0–1.8 m beach band → gravel;
    - forest biomes → leaves;
    - anything else → grass.

\n    Each surface has its own event with recorded variants, picked by stride with a
    small rate jitter. Snow stays a lower synth crunch because the bank has no snow
    recording.
  - *Ambient (`WorldSoundscape` → `AmbientSoundscape`):* 25 tiles on three rings
    (10/35/80 m) around the camera, plus height above the sea, rain, wind, sun and
    swimming, are resampled every 0.4 s into weights (`soundscapeWeights`).
    - Beds (forest, wetland, shore, open-ground wind, rain light/medium/heavy) ease
      toward their weights.
    - Wildlife calls fire at random intervals and stereo positions: birds and crows
      by day, crickets at night, frogs in wetland. Rain thins them out.
    - The nearest river fall within 400 m roars, louder for bigger drops. The roar is
      a slowed-down water loop, panned by the fall's bearing from the camera.
    - Going under water silences it all, and muting audio fades the ambient bus out.

\n    This stands in for `RegionalWeights` (§4.3). Tile sampling is synchronous on
    cached generator blocks.
  - Verified in the app (Eldara, own Chromium):
    - forest bed at 0.35; heavy rain at 0.9 intensity, with the birds cut to 0.1;
    - 72 m from a 22 m fall: roar 0.41, shore bed 0.25, pan −0.77 after turning
      around;
    - muting brings the bus from 0.6 to 0.05 in 4 s;
    - every sample request returned 200.

\n    Not done: true 3D (HRTF) emitters. Stereo pan is enough for an ambient layer.
- **2026-09-25, P7 cloud shadows and a sky precision fix.**
  - *Sky (pre-existing bug):* the dome sampled its cloud noise at canonical camera
    metres ÷ 180. On Eldara that is around 90,000 units, where the noise hash
    (`fract(p × 127.1)`) has no float32 bits left, so clouds collapsed into radial
    streaks or vanished. The camera coordinate is now wrapped in double precision
    every 512 cloud units (92 km; crossing a wrap shifts the field once), and the
    clouds are soft cumulus again anywhere on the map.
  - *Cloud shadows (`CloudShadow`):* each surface samples the cloud the dome draws
    in front of the sun, as seen from that surface, using the same motion and
    coordinates, so a shadow falls where the sky shows the sun behind a cloud. It
    enters through three's `receivedShadowNode`, which scales only the sun's shadow
    term, so ambient light is untouched and it keeps working past the 120 m shadow
    map.
    - Applied to terrain, grass, the tree prototypes (their LOD clones inherit it)
      and the impostors. It is idempotent per material.
    - Buildings (construction materials, other sessions' files) don't take it yet.
    - It uses two fbm octaves of the dome's four.
    - `sky.cloudShadows` {enabled, strength 0.45}; disabled compiles no nodes.
      `skyView.setCloudShadowStrength` lets weather deepen it later.
  - Perf A/B (headed `chunk-cross`, warmup 8, duration 10, dev-alt): 39.5 FPS and 30
    hitches with shadows, 37.7 FPS and 29 hitches without, which is noise.
- **2026-09-25, P7 rain wetness.** `SurfaceWetness` accumulates rain into one shared
  uniform. Full rain soaks dry ground in 40 s, drizzle holds the ground at its own
  level, and it dries over 240 s after the rain stops. This is the wetness part of
  `EnvironmentState` (§4.2).
  - `RainWetnessShading` applies it to the terrain after the coast swash. Exposed
    ground darkens by up to 30%, and its roughness falls toward 0.55, never above
    what was baked, so shores keep their sheen. Snow is left dry, and the baked
    canopy (now exposed by the baked surface) keeps 70% of the rain off the forest
    floor.
  - Settings live in `stylizedSurface.wetness` and are resolved by the config loader.
    The accumulator runs in the frame loop from the weather's rain.
  - Verified facing a 10° sun over a meadow: soaked ground picks up a soft sheen
    through the grass and darkens elsewhere. 0.22 and 0.4 read as standing water.
  - Not yet: grass, rocks, buildings and characters don't change when wet. The
    building side has to keep the workshop preview in agreement, so it waits for
    those files' owners.
- **2026-09-25, P7 time of day × weather.** The seven grass-test presets are ported
  as partial overrides of `stylizedSurface.sky` (`sky/SkyPresets.js`): Highfield,
  Emberfall, Stillmeadow, Galewind, Lowsway and Moonrise, plus `configured`, the sky
  exactly as tuned, which stays the default.
  - `SkyLook` resolves, blends and greys looks. `SkyLookController` eases a change
    of time over 2.5 s. Weather adds an overcast (rain 0.8, storm 1, snow 0.6,
    sandstorm 0.4 × intensity) that drains colour, weakens the sun, closes the
    clouds, softens cloud shadows and thickens fog. It greys any time, so a rainy
    night stays night.
  - The sky is written only while a look is changing, so capture tools that set the
    lights directly keep them.
  - A *Time* selector heads the weather panel; the choice is remembered per browser.
  - What follows a look:
    - the sky dome's colours, sun and cloud density, now uniforms;
    - the sun vector, turned in place, which carries grass, water, the character and
      post-processing with it;
    - the god rays' shared vector, their tint, and a new light scale on both god-ray
      outputs;
    - the hemisphere and directional lights;
    - fog colour and density;
    - cloud-shadow sun geometry and strength;
    - the far terrain's horizon haze;
    - the water, which is unlit, through a brightness and reflection tint
      (`sky/skyLight.js`) relative to the configured look, so that look renders
      unchanged;
    - the soundscape's night (crickets instead of birds).
  - Verified: Emberfall golden hour and Moonrise night on a meadow, and a daytime
    storm overcast. A pale band on the moonrise horizon turned out to be volumetric
    height-fog scattering at daytime strength; the god rays' light scale fixed it.
    No console errors in normal use.
  - Not yet: an animated day/night cycle, stars, and a moon disc distinct from the
    sun.
- **2026-09-25, P7 falling leaves.** `FallingLeaves` puts 400 procedural leaves in a
  36 m box that wraps around the walking camera. Each leaf's fall, wind drift, swing
  and tumble are a function of its seed and time on the GPU, so the CPU never
  touches an instance.
  - grass-test's `LeafSystem` wasn't ported. It rewrites every instance matrix each
    frame, and its leaf textures have no recorded provenance. Our leaves draw a
    procedural leaf with a midrib in autumn tones, unlit and dimmed by the sky light
    (darker at night).
  - Density follows the share of temperate deciduous forest and temperate
    rainforest (6, 8) sampled around the camera, eased as you walk in or out. None
    fall around an orbit camera.
  - Verified: golden leaves drifting through a temperate deciduous meadow. Settings
    are in `stylizedSurface.fallingLeaves`, defaulting to `DEFAULT_FALLING_LEAVES`.
- **2026-09-25, P5 alpine trees: blocked on asset work.** `tree10/11` are cleared,
  but three things block importing them:
  1. Each GLB still carries a `Tree1_Billboard`/`TreeLOD0` billboard from the
     reference lineage, which must be stripped.
  2. The needles and snow caps are separate vertex-coloured materials
     ("Evergreen needles", "Settled snow"), which our trunk-plus-leaf extraction
     does not take.
  3. tree10 is about 23k triangles against about 630 for our forest conifers.

\n  Tree variants load before the first frame and feed the forest field, so they
  can't just stream in through residency. Next step: an offline extract that strips
  the billboard, merges needles and snow into the leaf part (vertex colours kept),
  decimates to about 2k triangles, and publishes through the runtime asset pipeline.
  Then add the trees as `treeVariants` with `tileIds: [9, 10]`.
- **2026-09-25, P5 powder kicks.** `SnowPowderKicks`: every footfall on snow (the
  footstep classifier's `snow`) throws powder forward and up from the boot.
  - Twelve kick slots live in a uniform array, reused oldest first; each has nine
    camera-facing puffs animated on the GPU. A footfall writes one slot, so an idle
    walker costs nothing, and the mesh hides once the last kick settles.
  - Kicks are stronger at a run. Puffs are born scattered around the boot, and sit
    on the snow rather than cutting into it.
  - Kicks in flight ride floating-origin snaps. The puffs dim with the sky light.
  - Verified running on a 965 m glacier: one kick per footfall, about every
    0.25 s, soft puffs at each boot.
  - Where a puff overlaps the moving legs, TRAA reprojection leaves some hatching.
    It is exaggerated by the harness's irregular frames and applies to every
    transparent effect over moving geometry.
  - Ambient spindrift is not included.
- **2026-09-25, P5 snow-country air.** `SnowCountryWeight` measures how deep in snow
  country the ground under the camera is. It samples 17 tiles out to 180 m (glacier
  1, tundra 0.6) and compares ground height with the terrain's own snow line
  (700 ± 250 m), taking the larger. Measuring the ground, not the camera, means an
  orbit camera over a meadow stays over a meadow.
  - `SkyLookController` eases toward it at 0.15 per second and applies
    `snowCountryLook` after the time of day and the overcast. The horizon and fog
    pale with a cool cast, the zenith cools, the sun warms slightly, and snow
    bounce lifts the ambient light by 15%. Haze thickens by 35%.
  - Every change is a relative tint or scale, so a moonlit summit stays moonlit.
    That stands in for grass-test's absolute low-warm-sun blend.
  - Tile sampling for the leaves, the soundscape and snow country now shares
    `world/sampleTilesAround.js`.
  - Verified on a 965 m glacier: weight 1, fog `91bfd9` → `9dbdd4`, ambient
    2.0 → 2.3. A paler, hazier horizon than the same view forced to lowland air.
- **2026-09-25, P5 ridged mountain relief (terrain change, re-import).**
  `world/MountainRidges.js` is a three-octave ridged multifractal. Wavelengths are
  768, 320 and 128 m, none near the 2 m cell, and a crest in one octave strengthens
  the next, so detail gathers on ridgelines.
  - It is centred so crests rise and gullies sink around Azgaar's height. Strength
    runs from relief fraction 0.3 to 0.65, so lowland pays nothing, and it is scaled
    by mountainness guidance where a world has it.
  - Settings: `import.azgaarRidges` {heightMeters 90, startRelief 0.3,
    fullRelief 0.65}. They are validated at config load and stamped into the world's
    terrain metadata at import, like the vertical exaggeration.
  - Saved worlds keep smooth mountains until they are re-imported (the agreed
    re-import window, shared with water domain v3). The far backdrop's column
    sampler carries the same crests, so near and far terrain agree.
  - The generator's value noise moved to `world/valueNoise2d.js` unchanged; all 62
    generator, water and import tests are identical.
  - Cost: chunk workers only. On high ground a height sample goes from 0.15 to
    0.25 µs, about 0.4 ms more per 65×65-vertex chunk off the main thread; lowland
    is unchanged. `qa:perf` scenarios don't use an imported world, so a direct
    benchmark stood in for the A/B.
  - Verified by importing Eldara with and without ridges and standing at the same
    1,240 m spot: a crest now cuts the skyline where the smooth import is a
    plateau.
  - Not done: couloirs and crest notches.
- **2026-09-25, P5 snowfall.** WebGPU snow is now `weather/snowfall/SnowfallField`, in
  three populations: 2,600 fine flakes over a 42 m column, 900 medium flakes over
  14 m, and 48 soft out-of-focus discs near the lens.
  - Every flake is a function of its seed and time. Flakes wrap in world space, so a
    walker moves through the snow instead of carrying it.
  - The drift is the integral of the wind and its gusts, taken on the CPU each
    frame, so a gust never jumps the field. Each flake swirls on its own phase, and
    flakes collapse at the lens.
  - Flakes face the camera fully: the old crossed quads turned edge-on from above
    and drew as lines. They dim with the sky light.
  - It implements the same handle as before, so `weather_controller` and the WebGL
    fallback (the old crossed-quad shader) are untouched.
  - **Regional snow** (after grass-test): snow country snows lightly (0.3) with the
    weather off, and snow weather only makes it heavier. It is suppressed under
    rain, storm and sandstorm. It is driven by the same `SnowCountryWeight` as the
    snow-country air.
  - Verified on the glacier: light regional snow with the weather off, no line grid
    looking down, and heavy snow at 1.2.
- **2026-09-25, P8 graded trails (terrain change, re-import).** Azgaar's land routes
  (Eldara: 310 trails and 4 roads, points about 70 km apart; sea routes left out)
  are imported into the macro source (`import/AzgaarRoutes.js`) and graded into
  the ground by `world/TrailGrading.js`.
  - Each route is smoothed with a Catmull-Rom spline, then split into 1 km arcs,
    each traced lazily on first use with its ends pinned to the ground.
    Forward and backward passes cap the grade at 0.14; an arc whose pins demand
    more takes just the grade it needs, spread evenly. Cut is capped at 10 m and
    fill at 4 m, with banks that widen with the cut.
  - The result doesn't depend on which arc is traced first (tested), and
    neighbouring arcs meet exactly.
  - Settings: `import.azgaarTrails`, stamped at import like the ridges.
  - The generator's `sampleHeight` is now the graded view of `sampleTerrainHeight`,
    so rivers still carve across trails. Cells the path covers report the editor's
    Road tile, so the existing path shading (tread, verge, ruts, cleared grass)
    draws them.
  - Cost: a height sample away from routes is +0.02 µs; inside a route's 16 km
    bucket it is +0.25 µs, about 1 ms per chunk in the workers.
  - Verified: a 6 m road through temperate forest meadow, grass cleared with a
    verge, and a road band across a glacier.
  - Follow-ups:
    - The Road tile's outline is per cell, so diagonal routes show a stair-stepped
      edge. Driving the path mask from the route distance instead would fix it.
    - Roads through glaciers paint as bare dirt.
- **2026-09-25, §10 audio bank v2.** grass-test's rebuilt bank (85 files, every source
  and licence in its catalog) is merged into `public/audio/cc0`: 114 files, 3.3 MB,
  with one `CATALOG.md` covering both generations.
  - v2 replaces the footsteps. Snow is now recorded rather than synthesized, and
    there is a new sand surface for beaches and hot desert; cold desert and road
    stay gravel.
  - v1's forest, wetland and lake beds, three-level rain and wildlife calls stay.
  - The soundscape gains beds for open-ground meadow wind, alpine wind (from the
    snow-country weight), jungle day and night (biomes 5 and 7), sea surf, river
    stream, lake shore and night crickets.
  - New calls: v2 meadow birds, crows, seagulls, single waves, jungle piha and
    parrots, cicadas, frogs and mosquitoes.
  - Water kinds are sampled on rings out to 200 m. Waves and gulls come in on low
    ground by the sea and pan toward the sea's bearing.
  - Verified on an Eldara beach: surf bed at 0.39, waves and gulls calling from the
    sea side, and 24 sample requests, all 200.
- **2026-09-27, entering player mode: 17 s → 1 s.** The first walk-mode frame took
  about 17 s, and the terrain policy made every later orbit/walk switch cost the same.
  There were two causes:
  1. `ViewModeSurfacePolicy` flipped terrain `side` per mode (DoubleSide orbit,
     FrontSide walk). `side` is part of the render-object key, so every switch
     rebuilt all 49 terrain node graphs at about 650 ms each. Terrain is now
     DoubleSide at creation in every mode. Front faces saved nothing measurable
     (uncapped 1920×1080 walk: 157–179 fps front, 165–171 fps double).
  2. Walking renders through the god-rays scene pass (its own render target) while
     orbiting renders to the screen, so the first walk frame built every resident
     material for that path. Each of the 49 terrain slots had its own copy of the
     graph, and three keys builds by node id.
  - Fix: one terrain material shared by all slots (`materials/TerrainSlotBindings.js`).
    Each slot mesh carries its own tile, height, surface-mask and forest-floor
    textures, `chunkCenter` and bake GPU state, and the shared nodes read them per
    drawn object. The bake bridge now finds the state on `slot.mesh`.
  - Pitfall hit on the way: `TextureNode.setup` resets `updateType`, which silently
    drops `onObjectUpdate`. The per-object textures therefore use
    `setUpdateMatrix(true)`. Before that, several slots drew another slot's flat
    data as a grey sheet.
  - A background prewarm of the walk path was tried and removed. It froze orbit for
    about 20 s and saved nothing.
  - Measured on Eldara: first walk frame 16.5 s → 0.8–1.1 s (one terrain build,
    ~0.6 s; other slots 0 ms). Verified all 49 slots bind their own data by swapping
    every slot's height texture and seeing every chunk move.
  - Follow-up: after an import, the far-terrain ring job samples forest habitat and
    water distance over thousands of chunks, about 14 s of CPU spread over frames;
    the lake and trail tile lookups add to it.
- **2026-09-27, §10 ambient layer (particles, breath, plumes).** Ported to
  `stylized/ambient/` from grass-test's ambient effects.
  - Config: `config/ambient-effects.yaml`, converted from grass-test's ~2.8 units
    per metre; plumes are re-tuned for this world's crest spacing.
  - Eleven GPU particle fields (`AmbientParticleField`): diamond dust, spindrift,
    blowing sand, surf spray, pollen, dandelion seeds, night fireflies, jungle
    spores, canopy shafts, midges and lake mist.
    - They hug the ground through `LocalGroundHeight`, a 64² half-float patch
      around the focus stored relative to its centre.
    - Per-particle masks read the ground against the sea and lake levels, so spray
      stays over the sea and beach sand stays on the beach.
    - Region weights (`ambientRegions`) come from ring samples of tiles and water
      plus `SnowCountryWeight`. grass-test's presets are mapped from this world's
      times of day and weather (`ambientPresets`).
  - Extras driven by the same weights:
    - `BreathPuffs`: 16 CPU puffs from the hero's `Head` bone in snow country,
      through a new `breathSource()` on the character views.
    - `RidgePlumes`: crests found around the focus above the snow line, rescanned
      every 350 m, stored relative to the scan centre.
  - `main.js` holds one `WorldAmbience` adapter.
  - Verified in the app:
    - glacier: diamond dust, gusting spindrift, breath (up to 4 puffs, visible in
      64% of frames), 2 plume crests;
    - beach: surf spray over the sea only, blowing sand;
    - no shader errors.
  - Not yet: blown snow and sand streaks in the terrain, grass gust sheen, frost.
    Heat shimmer and jungle mist read the scene or depth and need an A/B first.
