import './styles.css';
import './render/installViewportFramebufferSourcePatch.js';
import './editor/performance/frameRateDisplay.css';
import './editor/performance/qa/perfQa.css';
import './editor/player/playerMode.css';
import './editor/map/worldMap.css';
import './editor/ui/radialPalette.css';
import './editor/ui/compactMenus.css';
import './editor/inventory/inventory.css';
import { loadEditorConfig } from './config/loadEditorConfig.js';
import './editor/audio/index.js';
import { LoadingOverlay } from './editor/ui/LoadingOverlay.js';
import { LoadingTracker } from './editor/ui/LoadingTracker.js';
import { ESCAPE_PRIORITY, EscapeStack } from './editor/ui/EscapeStack.js';
import { assetFileName, bindAssetProgress, watchWalkModeEntry } from './editor/ui/loadingSources.js';
import { EditorCamera } from './editor/EditorCamera.js';
import { EditorUi } from './editor/EditorUi.js';
import { InfiniteTerrainView } from './editor/InfiniteTerrainView.js';
import { MacroFarTerrainView } from './editor/world/MacroFarTerrainView.js';
import { WorldMapController } from './editor/map/WorldMapController.js';
import { WorldMapUi } from './editor/map/WorldMapUi.js';
import { GameplayOverlayController } from './editor/ui/GameplayOverlayController.js';
import { InventoryController } from './editor/inventory/InventoryController.js';
import { InventoryStore } from './editor/inventory/InventoryStore.js';
import { InventoryUi } from './editor/inventory/InventoryUi.js';
import { ITEM_CATALOG, PLAYER_STARTING_LOADOUT } from './editor/inventory/itemCatalogRuntime.js';
import { ProceduralAssetManager } from './editor/workshop/ProceduralAssetManager.js';
import { ProceduralWorkshopUi } from './editor/workshop/ProceduralWorkshopUi.js';
import { ObjectMap } from './editor/ObjectMap.js';
import { ObjectView } from './editor/ObjectView.js';
import { OBJECT_CATALOG } from './editor/objectCatalog.js';
import { FrameRateDisplay } from './editor/performance/FrameRateDisplay.js';
import { FrameRateMeter } from './editor/performance/FrameRateMeter.js';
import { FRAME_RATE_DISPLAY_INTERVAL_MS } from './editor/performance/frameRateConstants.js';
import { assetStartupTelemetry } from './editor/performance/AssetStartupTelemetry.js';
import { PerfCounters } from './editor/performance/qa/PerfCounters.js';
import { PerfQaHarness } from './editor/performance/qa/PerfQaHarness.js';
import { createObjectTownQaScene } from './editor/performance/qa/ObjectTownQaScene.js';
import { applyPerfQaDensityProfile } from './editor/performance/qa/PerfQaDensityProfiles.js';
import { parseQaParams } from './editor/performance/qa/parseQaParams.js';
import { PlayerController } from './editor/player/PlayerController.js';
import { ViewModeController } from './editor/player/ViewModeController.js';
import { ViewModeUi } from './editor/player/ViewModeUi.js';
import { createHudMinimapSource } from './editor/player/hud/createHudMinimapSource.js';
import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK } from './editor/player/playerConstants.js';
import { isTreeImpostorBakeMode } from './editor/stylized/impostorBakeMode.js';
import { StylizedSurfaceView } from './editor/stylized/StylizedSurfaceView.js';
import { BiomeAssetPalette } from './editor/stylized/BiomeAssetPalette.js';
import { createWeatherController } from './editor/weather/weather_controller.js';
import { createWeatherUi } from './editor/weather/weather_ui.js';
import {
  createWeatherTerrainSamplers,
  raycastTerrainHeightfield,
} from './editor/weather/weather_terrain_adapters.js';
import { attachSpellHotkeys, createSpellRuntime } from './editor/spells/spell_runtime.js';
import { attachCaptureHotkey } from './editor/input/attachCaptureHotkey.js';
import { ThirdPersonCamera } from './editor/player/ThirdPersonCamera.js';
import { createCharacterView } from './editor/character/createCharacterView.js';
import { audioBus, emitAudio } from './editor/audio/index.js';
import { WorldSoundscape } from './editor/audio/world_soundscape.js';
import { SurfaceWetness } from './editor/weather/surfaceWetness.js';
import { SkyLookController } from './editor/stylized/sky/SkyLookController.js';
import { DEFAULT_SKY_PRESET, SKY_PRESETS } from './editor/stylized/sky/SkyPresets.js';
import { DayNightCycle } from './editor/stylized/sky/dayNightCycle.js';
import { SnowCountryWeight } from './editor/stylized/sky/SnowCountryWeight.js';
import { FallingLeaves } from './editor/stylized/leaves/FallingLeaves.js';
import { SnowPowderKicks } from './editor/stylized/powder/SnowPowderKicks.js';
import { WorldAmbience } from './editor/stylized/ambient/WorldAmbience.js';
import { HeroSelectUi } from './editor/character/HeroSelectUi.js';
import { updateCharacterOcclusion } from './editor/character/CharacterOcclusion.js';
import { WorldWindPass } from './editor/weather/wind/WorldWindPass.js';
import { WaterfallMist } from './editor/stylized/mist/WaterfallMist.js';
import { createRiverFallSiteSource } from './editor/water/RiverFallSites.js';
import { resolveWaterQualityFeatures } from './editor/water/WaterQuality.js';
import { configureSea, updateSeaState } from './editor/water/seaState.js';
import { classifyFootstepSurface } from './editor/audio/footstep_surface.js';
import { snowAtPoint } from './editor/materials/SnowAccumulation.js';
import { terrainBakeMacroSeed } from './editor/materials/TerrainBakeNoise.js';
import {
  stampFootprint,
  updateGroundDeformation,
} from './editor/stylized/deformation/groundDeformationState.js';
import { snowWakeRecorder } from './editor/stylized/deformation/SnowWakeRecorder.js';
import { PLAYER_WATER_DRY } from './editor/player/PlayerWaterState.js';
import { SwitchableCharacterView } from './editor/character/SwitchableCharacterView.js';
import {
  resolveHeroPreference,
  storeHeroPreference,
} from './editor/character/heroPreference.js';
import { PROCEDURAL_HERO_ID } from './config/validateCharacterConfig.js';

/** How long the drow holds the casting stance after a spell fires. */
const SPELL_CAST_POSE_MS = 520;
import './editor/weather/weather.css';
import './editor/spells/spell_menu.css';
import { applySceneAssetSettings } from './editor/settings/SceneSettings.js';
import {
  loadBootSceneSettings,
  resolveLocalGlb,
  SceneSettingsRuntime,
} from './editor/settings/SceneSettingsRuntime.js';
import { createPostProcessingSettings } from './render/postprocessing/PostProcessingSettings.js';
import { PostProcessingController } from './render/postprocessing/PostProcessingController.js';
import { PostProcessingFocusResolver } from './render/postprocessing/PostProcessingFocusResolver.js';
import {
  POST_PROCESSING_REACTIVE_EVENTS,
  POST_PROCESSING_RESET_REASONS,
} from './render/postprocessing/PostProcessingInvalidation.js';
import { TerrainAwareEditorController } from './editor/TerrainAwareEditorController.js';
import { ConstructionStore } from './editor/construction/ConstructionStore.js';
import { ConstructionMaterialStore } from './editor/construction/ConstructionMaterialStore.js';
import { ConstructionGizmoController } from './editor/construction/ui/ConstructionGizmoController.js';
import { ConstructionPaletteController } from './editor/construction/ui/ConstructionPaletteController.js';
import { ConstructionSpatialIndex } from './editor/construction/ConstructionSpatialIndex.js';
import { ConstructionCompilerClient } from './editor/construction/compile/ConstructionCompilerClient.js';
import { ConstructionView } from './editor/construction/render/ConstructionView.js';
import { ConstructionGroundProvider } from './editor/construction/simulation/ConstructionGroundProvider.js';
import { TILE_BY_KEY, TILE_CATALOG } from './editor/tileCatalog.js';
import { GpuVoxelWorld } from './editor/voxel/GpuVoxelWorld.js';
import { VoxelPrototypeUi } from './editor/voxel/VoxelPrototypeUi.js';
import { VoxelStampStore } from './editor/voxel/VoxelStampStore.js';
import { createVoxelWorldLayout } from './editor/voxel/VoxelWorldLayout.js';
import { ChunkedHeightField } from './editor/world/ChunkedHeightField.js';
import { ChunkedTileMap } from './editor/world/ChunkedTileMap.js';
import { FloatingOrigin } from './editor/world/FloatingOrigin.js';
import { ProceduralWorldGenerator } from './editor/world/ProceduralWorldGenerator.js';
import { createSurfaceMaskConfig } from './editor/world/ChunkRenderPixels.js';
import { createVegetationScatterConfig } from './editor/stylized/vegetationScatter.js';
import { WorkerBackedWorldStore } from './editor/world/WorkerBackedWorldStore.js';
import { WorldChunkWorkerClient } from './editor/world/WorldChunkWorkerClient.js';
import {
  IndexedDbWorldContentProvider,
  LocalFirstWorldContentProvider,
  UrlWorldContentProvider,
} from './editor/world/WorldContentProvider.js';

const TERRAIN_PREFETCH_REFRESH_MS = 200;

const BOOT_STEPS = Object.freeze([
  { id: 'settings', label: 'Scene settings' },
  { id: 'terrain', label: 'Terrain view and GPU device' },
  { id: 'assets', label: 'World assets' },
  { id: 'blades', label: 'Grass blade profiles' },
  { id: 'map', label: 'Initial map' },
  { id: 'prewarm', label: 'Compiling render pipelines' },
]);

async function startEditor() {
  let sceneReloadPending = false;
  const loading = new LoadingTracker();
  const loadingOverlay = new LoadingOverlay(document.body);
  loadingOverlay.attach(loading);
  const boot = loading.begin({ title: 'Starting Drusniel World', steps: BOOT_STEPS });
  boot.start('settings');
  let bootSceneSettings = null;
  let bootSceneSettingsError = null;
  try {
    bootSceneSettings = await loadBootSceneSettings();
  } catch (error) {
    bootSceneSettingsError = error;
  }
  const config = loadEditorConfig();
  const postProcessingStore = createPostProcessingSettings(
    config.stylizedSurface.postProcessing,
  );
  const perfQaConfig = parseQaParams(window.location.search);
  if (perfQaConfig) {
    applyPerfQaDensityProfile(config, perfQaConfig.densityProfile);
  }
  const localAssetObjectUrls = [];
  if (bootSceneSettings) {
    try {
      await applySceneAssetSettings(config, bootSceneSettings.document, {
        baseUrl: bootSceneSettings.sourceUrl,
        resolveLocalAsset: async (assetId) => {
          const url = await resolveLocalGlb(assetId);
          localAssetObjectUrls.push(url);
          return url;
        },
      });
    } catch (error) {
      bootSceneSettings = null;
      bootSceneSettingsError = error;
    }
  }
  const impostorBakeMode = isTreeImpostorBakeMode();
  const defaultTile = TILE_BY_KEY.get(config.map.defaultTile);
  if (!defaultTile) {
    throw new Error(`Unknown default tile: ${config.map.defaultTile}.`);
  }

  const NEAR_FAR_PLANE = 5000;
  const farTerrainRadius = config.world.farTerrain?.enabled !== false
    ? (config.world.farTerrain?.radiusMeters ?? 0)
    : 0;
  const nearView = {
    farPlane: NEAR_FAR_PLANE,
    skyRadius: config.stylizedSurface?.sky?.radius ?? NEAR_FAR_PLANE,
    fogDensity: config.stylizedSurface?.sky?.fogDensity ?? 0,
  };
  const farView = farTerrainRadius > 0
    ? (() => {
      const skyRadius = farTerrainRadius + config.world.floatingOriginThreshold + 8000;
      const densityScale = config.stylizedSurface?.sky?.aerial?.farDensityScale ?? 1.5;
      return { farPlane: skyRadius + 4000, skyRadius, fogDensity: densityScale / farTerrainRadius };
    })()
    : null;

  const root = document.querySelector('#app');
  const generator = new ProceduralWorldGenerator({
    seed: config.world.seed,
    version: config.world.generatorVersion,
    heightScale: config.world.heightScale,
    seaLevel: config.world.seaLevel,
  });
  const surfaceMaskConfig = createSurfaceMaskConfig(config.stylizedSurface, {
    tileSize: config.map.tileSize,
  });
  const vegetationScatterConfig = createVegetationScatterConfig(
    config.stylizedSurface,
    config.map.tileSize,
  );
  const chunkWorker = new WorldChunkWorkerClient({
    chunkSize: config.world.chunkSize,
    generator,
    surfaceMaskConfig,
    vegetationScatterConfig,
    workerCount: config.world.workerCount ?? null,
  });
  const localContent = new IndexedDbWorldContentProvider();
  const remoteContent = config.world.contentBaseUrl
    ? new UrlWorldContentProvider({ baseUrl: config.world.contentBaseUrl })
    : null;
  const contentProvider = new LocalFirstWorldContentProvider({
    local: localContent,
    remote: remoteContent,
  });
  const worldStore = new WorkerBackedWorldStore({
    chunkWorker,
    chunkSize: config.world.chunkSize,
    tileSize: config.map.tileSize,
    cacheLimit: config.world.maxCpuChunks,
    generator,
    surfaceMaskConfig,
    contentProvider,
  });
  const tileMap = new ChunkedTileMap({ worldStore, defaultTileId: defaultTile.id });
  const heightField = new ChunkedHeightField({ worldStore });
  const objectMap = new ObjectMap({ tileMap, objectCatalog: OBJECT_CATALOG });
  let biomeAssetPalette;
  try {
    biomeAssetPalette = new BiomeAssetPalette({
      stylizedConfig: config.stylizedSurface,
      document: bootSceneSettings?.document.biomeAssets ?? null,
    });
  } catch (error) {
    bootSceneSettingsError = error;
    biomeAssetPalette = new BiomeAssetPalette({ stylizedConfig: config.stylizedSurface });
  }
  const floatingOrigin = new FloatingOrigin({
    threshold: config.world.floatingOriginThreshold,
    snapSize: config.world.chunkSize * config.map.tileSize,
  });

  const voxelWorldLayout = createVoxelWorldLayout(config.voxelPrototype, config.map);
  const voxelStampStore = new VoxelStampStore({
    cells: [0, voxelWorldLayout.totalCellsY, 0],
    maxStamps: config.voxelPrototype.maxStamps,
    unboundedXZ: true,
  });

  const ui = new EditorUi({
    root,
    config,
    tileCatalog: TILE_CATALOG,
    tileMap,
    heightField,
    objectCatalog: OBJECT_CATALOG,
    objectMap,
  });
  ui.attachBiomeAssetPalette(biomeAssetPalette);
  const frameRateDisplay = new FrameRateDisplay({ root });
  const frameRateMeter = new FrameRateMeter();

  const terrainView = new InfiniteTerrainView({
    container: ui.viewport,
    tileMap,
    heightField,
    worldStore,
    floatingOrigin,
    streamingConfig: config.world,
    rendererConfig: config.renderer,
    stylizedConfig: config.stylizedSurface,
  });

  boot.start('terrain');
  try {
    await terrainView.initialize();
  } catch (error) {
    boot.fail(error);
    terrainView.dispose();
    worldStore.dispose();
    throw error;
  }
  const postProcessingController = new PostProcessingController({
    renderer: terrainView.renderer,
    scene: terrainView.scene,
    postProcessingStore,
    sunDirection: terrainView.godRays.sunDirection,
    sunColor: config.stylizedSurface.sky.sunColor,
    bypassProvider: () => (
      terrainView.godRays.enabled
      && terrainView.godRays.technique === 'volumetric'
    ),
  });
  terrainView.setPostProcessingController(postProcessingController);
  const temporalUnsubscribers = [];
  temporalUnsubscribers.push(
    floatingOrigin.subscribe(() => {
      postProcessingController.invalidate(
        POST_PROCESSING_RESET_REASONS.FLOATING_ORIGIN_REBASE,
      );
    }),
    worldStore.subscribe((change) => {
      if (change.kind === 'reset') {
        postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.WORLD_LOADED);
      } else if (change.kind === 'tile' || change.kind === 'height') {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.TERRAIN_EDIT,
        );
      }
    }),
    voxelStampStore.subscribe(() => {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.VOXEL_EDIT,
      );
    }),
    terrainView.subscribeStreaming((event) => {
      if (event.kind === 'mass-chunk-reassignment') {
        postProcessingController.invalidate(
          POST_PROCESSING_RESET_REASONS.MASS_CHUNK_REASSIGNMENT,
        );
      } else if (event.kind === 'chunk-streamed-in') {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.CHUNK_STREAMED_IN,
        );
      }
    }),
  );

  const objectView = new ObjectView({
    terrainView,
    tileMap,
    heightField,
    objectMap,
    objectCatalog: OBJECT_CATALOG,
  });
  const constructionStore = new ConstructionStore();
  const constructionSpatialIndex = new ConstructionSpatialIndex({
    chunkWorldSize: config.world.chunkSize * config.map.tileSize,
  });
  constructionStore.subscribe((change) => {
    if (change.kind === 'add' || change.kind === 'restore') {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_PLACEMENT,
      );
    } else if (change.kind === 'remove' || change.kind === 'clear') {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_REMOVAL,
      );
    } else if (change.kind === 'update' || change.kind === 'history') {
      postProcessingController.notifyReactive(
        change.after
          ? POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_PLACEMENT
          : POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_REMOVAL,
      );
    }
    if (change.kind === 'clear' || change.kind === 'replace') {
      constructionSpatialIndex.clear();
      for (const record of constructionStore.list()) constructionSpatialIndex.update(record);
      return;
    }
    if (change.hint?.decorationOnly) return;
    if (change.after) constructionSpatialIndex.update(change.after);
    else if (change.id) constructionSpatialIndex.remove(change.id);
  });
  const constructionCompiler = new ConstructionCompilerClient();
  const constructionMaterialStore = new ConstructionMaterialStore();
  const constructionView = new ConstructionView({
    terrainView,
    store: constructionStore,
    compilerClient: constructionCompiler,
    materialStore: constructionMaterialStore,
  });
  const proceduralAssetManager = new ProceduralAssetManager({
    tileSize: tileMap.tileSize,
    objectMap,
    objectView,
    ui,
    lodConfig: config.objects?.lod,
  });
  const stylizedSurface = new StylizedSurfaceView({
    terrainView,
    objectMap,
    config: config.stylizedSurface,
    baseUrl: import.meta.env.BASE_URL,
    biomeAssetPalette,
    // The snow band lives in the world's own configuration, so it is handed down
    // here rather than guessed at in the surface config: bark and ground have to
    // whiten at the same altitude, and this is the only place that can see both.
    snowBand: config.world?.farTerrain,
  });
  boot.start('assets');
  const releaseAssetProgress = bindAssetProgress(boot);
  ui.attachPostProcessing(postProcessingStore);
  ui.attachGodRays(terrainView.godRays);
  ui.attachGrassTuning(stylizedSurface.grassTuning);
  ui.attachLoading(loading);
  ui.attachGrassBladeProfiles(stylizedSurface.bladeProfiles);
  stylizedSurface.bladeProfiles.ready.then(() => ui.renderGrassBladeProfiles());
  boot.start('blades');
  await stylizedSurface.bladeProfiles.ready;

  if (impostorBakeMode) {
    await stylizedSurface.bakeRequest;
    return;
  }

  const SKY_PRESET_STORAGE_KEY = 'drusniel_sky_preset';
  const storedSkyPreset = (() => {
    try {
      return window.localStorage.getItem(SKY_PRESET_STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const macroFarTerrain = new MacroFarTerrainView({
    scene: terrainView.scene,
    worldStore,
    floatingOrigin,
    config,
    forestFieldProvider: () => stylizedSurface.treeView?.manifestStore?.forestField ?? null,
  });

  const editorCamera = new EditorCamera({
    canvas: terrainView.renderer.domElement,
    viewSize: config.camera.viewSize,
    minZoom: config.camera.minZoom,
    maxZoom: config.camera.maxZoom,
    damping: config.camera.damping,
    farPlane: nearView.farPlane,
  });

  let playerController;
  let viewModeController;
  let controller;
  const gameplayOverlayController = new GameplayOverlayController({
    getPlayerController: () => playerController,
  });
  let spellKeyHandler = null;
  const detachSpellHotkeys = attachSpellHotkeys(() => spellKeyHandler);
  const inventoryStore = new InventoryStore(ITEM_CATALOG, null, {
    capacity: PLAYER_STARTING_LOADOUT.capacity,
  });
  inventoryStore.applyStartingLoadout(PLAYER_STARTING_LOADOUT);
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inventoryDemo') === '1') {
    // Starting loadout already applied; demo flag keeps the same seeded bag for screenshots.
  }
  const inventoryController = new InventoryController({
    store: inventoryStore,
    overlayController: gameplayOverlayController,
    catalog: ITEM_CATALOG,
  });
  const inventoryUi = new InventoryUi({ root, controller: inventoryController });
  const worldMapController = new WorldMapController({
    worldStore,
    floatingOrigin,
    tileSize: config.map.tileSize,
    getViewModeController: () => viewModeController,
    getPlayerController: () => playerController,
    getCampaign: () => controller?.campaign ?? null,
    overlayController: gameplayOverlayController,
  });
  const worldMapUi = new WorldMapUi({ root, controller: worldMapController });

  let cameraViewKeyHandler = null;
  const detachCameraViewHotkey = attachCaptureHotkey(() => cameraViewKeyHandler);

  playerController = new PlayerController({
    canvas: terrainView.renderer.domElement,
    terrainView,
    config: config.player,
    farPlane: nearView.farPlane,
  });
  const characterGround = {
    heightAt: (x, z) => playerController.getGroundHeight(x, z),
  };
  const characterEnabled = config.character?.enabled !== false;
  const thirdPersonCamera = characterEnabled
    ? new ThirdPersonCamera({
      terrain: characterGround,
      fovDegrees: config.player.fovDegrees,
      farPlane: nearView.farPlane,
      config: config.character?.thirdPerson,
    })
    : null;
  viewModeController = new ViewModeController({
    editorCamera,
    playerController,
    terrainView,
    thirdPersonCamera,
    objectView,
  });
  cameraViewKeyHandler = (event) => viewModeController.handleCameraViewKey(event);
  let previousViewMode = viewModeController.mode;
  let previousActiveCamera = viewModeController.camera;
  temporalUnsubscribers.push(
    viewModeController.subscribe((state) => {
      const activeCamera = viewModeController.camera;
      if (state.mode !== previousViewMode) {
        postProcessingController.invalidate(
          state.mode === PLAYER_MODE_WALK
            ? POST_PROCESSING_RESET_REASONS.PLAYER_SPAWNED
            : POST_PROCESSING_RESET_REASONS.CAMERA_MODE_CHANGED,
        );
        previousViewMode = state.mode;
      } else if (activeCamera !== previousActiveCamera) {
        postProcessingController.invalidate(
          POST_PROCESSING_RESET_REASONS.ACTIVE_CAMERA_REPLACED,
        );
      }
      previousActiveCamera = activeCamera;
    }),
    playerController.subscribeTeleports(() => {
      postProcessingController.invalidate(
        POST_PROCESSING_RESET_REASONS.CAMERA_TELEPORT,
      );
    }),
  );

  const streamingFrameListeners = new Set();
  const streamingProbe = {
    getStatus: () => terrainView.getStreamingStatus(),
    onFrame: (listener) => {
      streamingFrameListeners.add(listener);
      return () => streamingFrameListeners.delete(listener);
    },
  };
  ui.attachStreamingProbe(streamingProbe);
  watchWalkModeEntry({
    viewModeController,
    loading,
    walkMode: PLAYER_MODE_WALK,
    ...streamingProbe,
  });

  controller = new TerrainAwareEditorController({
    tileMap,
    heightField,
    worldStore,
    objectMap,
    terrainView,
    objectView,
    editorCamera,
    objectCatalog: OBJECT_CATALOG,
    brushSizes: config.brush.sizes,
    defaultBrushSize: config.brush.defaultSize,
    terrainConfig: config.terrain,
    voxelStampStore,
    proceduralAssetManager,
    constructionStore,
    constructionMaterialStore,
    constructionView,
    biomeAssetPalette,
    inventoryStore,
    worldInputBlockedProvider: () => gameplayOverlayController.isWorldInputBlocked(),
  });
  const postProcessingFocus = new PostProcessingFocusResolver({
    terrainView,
    playerController,
    editorController: controller,
    objectView,
    constructionView,
  });
  postProcessingController.focusDistanceProvider = (mode, camera, previousFocus) => (
    postProcessingFocus.resolve(mode, camera, previousFocus)
  );
  controller.onDocumentLoaded = (reason) => {
    const resetReason = POST_PROCESSING_RESET_REASONS[reason]
      ?? POST_PROCESSING_RESET_REASONS.WORLD_LOADED;
    postProcessingController.invalidate(resetReason);
  };
  controller.focusProvider = () => {
    const renderFocus = viewModeController.getFocusWorld();
    return floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
  };
  controller.cameraProvider = () => viewModeController.camera;
  controller.playerEditingProvider = () => viewModeController.paused;
  controller.editPreviewsAllowedProvider = () => (
    viewModeController.mode === PLAYER_MODE_EDIT && !viewModeController.awaitingSpawn
  );
  viewModeController.onPausedEditing = () => controller.selectTool('construction');
  viewModeController.onLeaveOrbitEditing = () => controller.clearHoverPreviews();
  playerController.constructionGround = new ConstructionGroundProvider({
    store: constructionStore,
    spatialIndex: constructionSpatialIndex,
    terrainView,
  });
  controller.constructionPalette = new ConstructionPaletteController({
    host: ui.viewport,
    controller,
    materialStore: constructionMaterialStore,
    onStatus: (message) => controller.emitNotice(message),
  });
  controller.constructionGizmo = new ConstructionGizmoController({
    host: ui.viewport,
    controller,
    palette: controller.constructionPalette,
    onStatus: (message) => controller.emitNotice(message),
  });

  const escapeStack = new EscapeStack();
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionGizmo?.isGridOpen) return false;
    controller.constructionGizmo.closeGrid();
    return true;
  }, { label: 'openings grid' });
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionPalette?.isOpen) return false;
    controller.constructionPalette.close();
    return true;
  }, { label: 'construction palette' });
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionGizmo?.isOpen) return false;
    controller.constructionGizmo.close();
    return true;
  }, { label: 'construction gizmo' });
  escapeStack.register(ESCAPE_PRIORITY.inspector, () => {
    if (!controller.constructionPalette?.isInspectorOpen) return false;
    controller.constructionPalette.closeInspector();
    return true;
  }, { label: 'construction inspector' });
  escapeStack.register(ESCAPE_PRIORITY.activeDrag, () => {
    if (!controller.constructionDrawing && !controller.constructionAnchorDrag
      && !controller.constructionGizmo?.directDrag) return false;
    controller.cancelConstructionGesture();
    controller.emitState();
    return true;
  }, { label: 'construction gesture' });
  escapeStack.register(ESCAPE_PRIORITY.selection, () => {
    if (!controller.selectedConstructionId && !controller.selectedObjectId) return false;
    controller.setSelectedConstruction(null);
    controller.setSelectedObject(null);
    controller.selectedAnchorId = null;
    controller.emitState();
    return true;
  }, { label: 'selection' });
  escapeStack.register(ESCAPE_PRIORITY.playerPaused, () => {
    if (!viewModeController.paused) return false;
    viewModeController.setMode(PLAYER_MODE_EDIT);
    return true;
  }, { label: 'leave paused editing' });
  escapeStack.register(ESCAPE_PRIORITY.playerWalking, () => viewModeController.pause(), {
    label: 'pause into editing',
  });
  gameplayOverlayController.subscribe((state) => {
    if (state.activeOverlay != null) {
      controller.cancelBlockedWorldInteraction();
    }
  });

  const sceneSettingsRuntime = new SceneSettingsRuntime({
    controller,
    biomeAssetPalette,
    godRays: terrainView.godRays,
    postProcessingStore,
    config,
    boot: bootSceneSettings,
    resolveAzgaarOptions: (summary) => ui.resolveAzgaarImportOptions(summary),
    afterMapLoad: async (worldDocument) => {
      ui.syncImportedBiomeTiles(worldDocument);
      ui.minimapCenter = controller.getFocusCell?.() ?? ui.minimapCenter;
      ui.updateMinimap();
    },
  });
  sceneSettingsRuntime.onSceneReload = (document, url) => {
    sceneReloadPending = true;
    ui.showSceneReload(
      'Reloading for the world look',
      document?.name ?? (url ? assetFileName(url) : ''),
    );
  };
  controller.sceneSettingsProvider = () => sceneSettingsRuntime.capture();
  controller.sceneSettingsConsumer = (document) => {
    sceneSettingsRuntime.applyVisualSettings(document);
    ui.syncGodRaysSettings(terrainView.godRays.getSettings());
  };
  ui.bind(controller);
  ui.attachSceneSettings(sceneSettingsRuntime).catch((error) => {
    ui.showToast(`Settings library unavailable: ${error.message}`, true);
  });
  if (bootSceneSettingsError) {
    ui.showToast(
      `Requested world look ignored: ${bootSceneSettingsError.message}`,
      true,
    );
  }
  boot.start('map');
  try {
    await sceneSettingsRuntime.applyInitialRuntime();
  } catch (error) {
    boot.fail(error);
    ui.showToast(`Preset map not loaded: ${error.message}`, true);
  }
  if (sceneReloadPending) {
    stylizedSurface.ready?.catch?.(() => {});
    stylizedSurface.bakeRequest?.catch?.(() => {});
    return;
  }
  ui.syncGodRaysSettings(terrainView.godRays.getSettings());
  const proceduralWorkshop = new ProceduralWorkshopUi({
    root,
    manager: proceduralAssetManager,
    onBaked: (record) => {
      controller.selectObjectDefinition(record.key);
      ui.showToast(`${record.label} is ready to place from Objects.`);
    },
  });
  ui.attachWorkshop(proceduralWorkshop);
  const sceneLabel = (preset) => {
    const label = SKY_PRESETS[preset]?.label ?? '';
    return preset === 'configured' || preset === DEFAULT_SKY_PRESET
      ? 'Drusniel World'
      : label.replace(/\s*\(.*\)\s*$/, '');
  };
  const viewModeUi = new ViewModeUi({
    root,
    controller: viewModeController,
    hud: {
      minimap: createHudMinimapSource({ ui, controller, tileMap }),
      getRenderer: () => terrainView.renderer,
      // The time of day titles the legend, as the donor's scene preset did:
      // "Emberfall (golden hour)" reads as "Emberfall". Read lazily — the sky
      // looks are built after the HUD.
      getSceneLabel: () => sceneLabel(skyLooks?.preset),
    },
  });

  let farViewActive = false;
  const applyViewDistance = (active) => {
    const view = active && farView ? farView : nearView;
    for (const camera of [editorCamera.camera, playerController.camera]) {
      camera.far = view.farPlane;
      camera.updateProjectionMatrix();
    }
    stylizedSurface.setViewDistance({ skyRadius: view.skyRadius, fogDensity: view.fogDensity });
  };
  applyViewDistance(false);

  const voxelPrototype = new GpuVoxelWorld({
    terrainView,
    layout: voxelWorldLayout,
    stampStore: voxelStampStore,
  });
  const voxelPrototypeUi = new VoxelPrototypeUi({
    root,
    prototype: voxelPrototype,
    controller,
    stampStore: voxelStampStore,
  });
  const voxelStatus = await voxelPrototype.initialize({ x: 0, z: 0 });
  voxelPrototypeUi.render();
  if (voxelStatus.code === 'failed') {
    console.error('GPU voxel world failed to initialize.', voxelStatus.error);
  }

  await stylizedSurface.ready;
  assetStartupTelemetry.markAssetsReady();

  const weatherSettings = {
    weatherMode: config.weather?.mode ?? 'off',
    weatherIntensity: config.weather?.intensity ?? 0.7,
    weatherWindX: config.weather?.windX ?? -0.42,
    weatherWindZ: config.weather?.windZ ?? 0.18,
  };
  const weatherEnabled = config.weather?.enabled !== false;
  // One advected gust field for everything that sways, rendered once per frame
  // into a small camera-centred texture (docs/plans/grass-test-merge-plan-2026-09-24.md §4.1).
  const worldWind = new WorldWindPass({
    config: config.weather?.windField ?? {},
    defaultDirection: config.stylizedSurface?.wind?.direction ?? [1, 0],
  });
  let lastWindTimestamp = null;
  const waterVisual = config.stylizedSurface.water;
  configureSea(waterVisual.enabled !== false && resolveWaterQualityFeatures(waterVisual).flow
    ? waterVisual.sea
    : null);
  // How stormy the sea is: rain roughens it, a storm fully.
  const seaStormForWeather = () => {
    if (!weatherEnabled) return 0;
    const intensity = Math.max(0, Math.min(1, weatherSettings.weatherIntensity ?? 0));
    if (weatherSettings.weatherMode === 'storm') return intensity;
    if (weatherSettings.weatherMode === 'rain' || weatherSettings.weatherMode === 'wind') {
      return intensity * 0.5;
    }
    return 0;
  };
  const fallSites = createRiverFallSiteSource(() => worldStore.generator);
  const waterfallMist = new WaterfallMist({
    scene: terrainView.scene,
    floatingOrigin: terrainView.floatingOrigin,
    getSites: fallSites,
    getSkyView: () => stylizedSurface.skyView ?? null,
    config: waterVisual.waterfall,
    enabled: waterVisual.enabled !== false && waterVisual.foam.enabled
      && resolveWaterQualityFeatures(waterVisual).foam,
  });
  // Rain on the ground and wind in the open, for the ambient beds; the sea
  // reads the same rain.
  const weatherAudioLevels = () => {
    const active = weatherEnabled && weatherSettings.weatherMode !== 'off';
    const intensity = active ? Math.max(0, Math.min(1, weatherSettings.weatherIntensity ?? 0)) : 0;
    const mode = weatherSettings.weatherMode;
    return {
      rain: mode === 'rain' || mode === 'storm' ? intensity : 0,
      wind: mode === 'wind' || mode === 'storm' ? intensity : 0.25,
    };
  };
  const surfaceWetness = new SurfaceWetness(config.stylizedSurface.wetness);
  let lastWetnessSeconds = null;
  // Time of day, greyed by the weather; the far haze follows the fog colour.
  const skyLooks = stylizedSurface.skyView
    ? new SkyLookController({
      skyView: stylizedSurface.skyView,
      preset: storedSkyPreset ?? undefined,
      onLook: (look) => macroFarTerrain.setFogColor(look.fogColor),
    })
    : null;
  // The animated clock, when a world turns it on: it only chooses a time preset,
  // which the sky eases in, so the sky stays the one lighting authority. Disabled
  // or paused it is a no-op, and the manual Time selector and capture tools that
  // set the lights directly keep their look.
  const skyCycleConfig = config.stylizedSurface?.sky?.cycle;
  const dayNightCycle = skyLooks && skyCycleConfig?.enabled
    ? new DayNightCycle({
      hour: skyCycleConfig.hour,
      dayLengthSeconds: skyCycleConfig.dayLengthSeconds,
      latitudeDegrees: skyCycleConfig.latitudeDegrees,
      paused: skyCycleConfig.paused,
    })
    : null;
  const fallingLeaves = new FallingLeaves({
    scene: terrainView.scene,
    config: config.stylizedSurface.fallingLeaves,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getOrigin: () => terrainView.floatingOrigin.getState(),
  });
  const snowCountry = new SnowCountryWeight({
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getOrigin: () => terrainView.floatingOrigin.getState(),
    getGroundHeight: (x, z) => terrainView.getCanonicalHeight(x, z),
    snowLine: config.stylizedSurface.materialBake.classification.snowLine,
    snowFade: config.stylizedSurface.materialBake.classification.snowFade,
  });
  const worldAmbience = new WorldAmbience({
    settings: config.stylizedSurface.ambientEffects,
    terrainView,
    getGenerator: () => worldStore.generator,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    tileSize: config.map.tileSize,
    skyView: stylizedSurface.skyView ?? null,
    defaultWindDirection: config.stylizedSurface?.wind?.direction ?? [1, 0],
    snowLine: config.stylizedSurface.materialBake.classification.snowLine,
  });
  const snowPowder = new SnowPowderKicks({
    scene: terrainView.scene,
    config: config.stylizedSurface.snowPowder,
  });
  const weatherOvercast = () => {
    if (!weatherEnabled) return 0;
    const intensity = Math.max(0, Math.min(1, weatherSettings.weatherIntensity ?? 0));
    const share = { rain: 0.8, storm: 1, snow: 0.6, sandstorm: 0.4 }[weatherSettings.weatherMode] ?? 0;
    return share * intensity;
  };
  const worldSoundscape = new WorldSoundscape({
    audioBus,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getSeaLevel: () => worldStore.generator?.seaLevel ?? 0,
    getOrigin: () => terrainView.floatingOrigin.getState(),
    getWeather: weatherAudioLevels,
    isNight: () => Boolean(skyLooks?.night),
    getWaterKind: (x, z) => worldStore.generator?.sampleWater?.(x / config.map.tileSize, -z / config.map.tileSize)?.kind ?? 0,
    getSnowCountry: () => snowCountry.value,
    isUnderwater: () => viewModeController.mode === PLAYER_MODE_WALK
      && Boolean(playerController.getStatus().headSubmerged),
    getFallSites: fallSites,
  });
  const weatherController = weatherEnabled
    ? createWeatherController({
      scene: terrainView.scene,
      camera: viewModeController.camera,
      isWebGpu: true,
      worldCells: 1e9,
      samplers: createWeatherTerrainSamplers(terrainView),
      getSettings: () => weatherSettings,
      getCamera: () => viewModeController.camera,
      getSunDirection: () => stylizedSurface.skyView?.sunDirectionValue ?? undefined,
    })
    : null;
  if (weatherController && weatherSettings.weatherMode !== 'off') {
    postProcessingController.notifyReactive(
      POST_PROCESSING_REACTIVE_EVENTS.WEATHER_STARTED,
    );
  }

  const heroStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const createHeroView = (heroId) => createCharacterView({
    scene: terrainView.scene,
    terrain: characterGround,
    sunDirection: terrainView.godRays.sunDirection,
    config: {
      ...(config.character ?? {}),
      hero: heroId,
      runSpeed: config.player.walkSpeed * config.player.runMultiplier,
    },
    getWeatherSettings: () => ({
      enabled: weatherEnabled && weatherSettings.weatherMode !== 'off',
      intensity: weatherSettings.weatherIntensity,
      windX: weatherSettings.weatherWindX,
      windZ: weatherSettings.weatherWindZ,
    }),
    loader: stylizedSurface.sceneAssets?.loader ?? null,
    renderer: terrainView.renderer,
    baseUrl: import.meta.env.BASE_URL,
  });
  const characterView = characterEnabled
    ? new SwitchableCharacterView({
      createView: createHeroView,
      heroId: resolveHeroPreference(config.character, {
        search: window.location.search,
        storage: heroStorage,
      }),
    })
    : null;
  // Footfalls sound once the hero's stride lands them; the variant alternates
  // by foot and cycles so a run of steps never repeats one sound exactly.
  let footstepCount = 0;
  // What a foot lands on, for its sound: the same snow the terrain draws, the
  // tile's biome, and the beach band above the sea.
  const footstepSurface = (footstep, canonicalX, canonicalZ) => {
    const tileSize = config.map.tileSize;
    const generator = worldStore.generator;
    const bake = config.stylizedSurface.materialBake;
    const tileId = worldStore.getTile(Math.floor(canonicalX / tileSize), Math.floor(-canonicalZ / tileSize));
    const snow = snowAtPoint({
      height: footstep.y,
      slope: 0,
      dx: 0,
      dz: 0,
      curvature: 0,
      tileId,
      worldX: canonicalX,
      worldZ: canonicalZ,
    }, bake.classification, terrainBakeMacroSeed(bake.macro.seedOffset, generator?.toMetadata?.().seed));
    return classifyFootstepSurface({
      inWater: footstep.surface === 'water',
      tileId,
      heightAboveSea: footstep.y - (generator?.seaLevel ?? 0),
      snow,
    });
  };
  // The walking body in canonical metres, for the deep-snow wake; null when the
  // wake is off or nobody is walking, which only ages the trail already laid.
  const snowWakeEnabled = config.stylizedSurface?.snowWake?.enabled === true;
  // Read every frame, so both objects are reused rather than rebuilt.
  const snowWakeFooting = { x: 0, z: 0, footY: 0, grounded: false, waterState: PLAYER_WATER_DRY };
  const snowWakeBodyScratch = { x: 0, y: 0, z: 0, grounded: false, inWater: false };
  const snowWakeBody = () => {
    if (!snowWakeEnabled || viewModeController.mode !== PLAYER_MODE_WALK) return null;
    const footing = playerController.readFooting(snowWakeFooting);
    const origin = terrainView.floatingOrigin.getState();
    snowWakeBodyScratch.x = footing.x + origin.x;
    snowWakeBodyScratch.y = footing.footY;
    snowWakeBodyScratch.z = footing.z + origin.z;
    snowWakeBodyScratch.grounded = footing.grounded;
    snowWakeBodyScratch.inWater = footing.waterState !== PLAYER_WATER_DRY;
    return snowWakeBodyScratch;
  };
  const detachFootsteps = characterView?.onFootstep((footstep) => {
    footstepCount += 1;
    const origin = terrainView.floatingOrigin.getState();
    const canonicalX = footstep.x + origin.x;
    const canonicalZ = footstep.z + origin.z;
    if (footstep.surface !== 'water') {
      stampFootprint(canonicalX, canonicalZ, footstep.facing ?? 0);
    }
    const surface = footstepSurface(footstep, canonicalX, canonicalZ);
    if (surface === 'snow') snowPowder.kick(footstep);
    emitAudio(`player.footstep.${surface}`, {
      variant: (footstepCount % 3) + (footstep.foot === 'left' ? 0 : 0.5),
    });
  }) ?? null;
  const heroSelectUi = characterView
    ? new HeroSelectUi({
      root,
      heroes: [
        ...Object.entries(config.character?.roster ?? {}).map(([id, entry]) => ({
          id,
          name: entry.name ?? id,
          title: entry.title,
        })),
        { id: PROCEDURAL_HERO_ID, name: 'Drow', title: 'Procedural, cloth-simulated' },
      ],
      heroId: characterView.heroId,
      onSelect: async (heroId) => {
        const swapped = await characterView.setHero(heroId);
        if (swapped) storeHeroPreference(heroId, heroStorage);
        return swapped;
      },
    })
    : null;
  characterView?.setVisible(false);
  const characterInFirstPerson = config.character?.visibleInFirstPerson !== false;
  const weatherUi = weatherEnabled
    ? createWeatherUi({
      root,
      settings: weatherSettings,
      timePresets: skyLooks
        ? Object.entries(SKY_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))
        : null,
      timePreset: skyLooks?.preset,
      onTimeChange: (preset) => {
        skyLooks?.setPreset(preset);
        try {
          window.localStorage.setItem(SKY_PRESET_STORAGE_KEY, preset);
        } catch {
          // Private windows keep the choice for this session only.
        }
      },
      onChange: (next) => {
        const previousMode = weatherSettings.weatherMode;
        Object.assign(weatherSettings, next);
        weatherController?.applySettings();
        if (weatherSettings.weatherMode !== 'off'
            && weatherSettings.weatherMode !== previousMode) {
          postProcessingController.notifyReactive(
            POST_PROCESSING_REACTIVE_EVENTS.WEATHER_STARTED,
          );
        }
      },
    })
    : null;

  const spellsEnabled = config.spells?.enabled !== false;
  const spellRuntime = spellsEnabled
    ? createSpellRuntime({
      scene: terrainView.scene,
      getCamera: () => viewModeController.camera,
      isWalkMode: () => viewModeController.mode === PLAYER_MODE_WALK,
      subscribeViewMode: (listener) => viewModeController.subscribe(listener),
      isInputBlocked: () => gameplayOverlayController.isWorldInputBlocked(),
      raycastTerrain: (ray, maxRange) => raycastTerrainHeightfield(terrainView, ray, maxRange),
      onCast: () => {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.SPELL_STARTED,
        );
        characterView?.beginCastAlongCamera(
          SPELL_CAST_POSE_MS,
          viewModeController.camera,
          performance.now(),
        );
      },
      registerKeys: false,
    })
    : null;
  spellKeyHandler = spellRuntime
    ? (event) => spellRuntime.handleKeyDown(event)
    : null;
  if (import.meta.env.DEV) {
    window.__editor = {
      controller,
      worldMapController,
      gameplayOverlayController,
      inventoryController,
      inventoryStore,
      inventoryUi,
      config,
      ui,
      proceduralWorkshop,
      constructionStore,
      constructionView,
      constructionSpatialIndex,
      godRays: terrainView.godRays,
      stylizedSurface,
      sceneSettingsRuntime,
      terrainView,
      viewModeController,
      playerController,
      thirdPersonCamera,
      characterView,
      worldWind,
      waterfallMist,
      worldSoundscape,
      surfaceWetness,
      skyLooks,
      fallingLeaves,
      snowPowder,
      worldAmbience,
      groundDeformation: { stampFootprint },
      weatherSettings,
      weatherController,
      spellRuntime,
      postProcessingStore,
      applyPostProcessingCaptureMode(mode = {}) {
        if (mode.weather && weatherSettings && weatherController) {
          weatherSettings.weatherMode = mode.weather;
          weatherSettings.weatherIntensity = Math.max(
            weatherSettings.weatherIntensity,
            1.1,
          );
          weatherController.applySettings();
        }
        if (mode.night && stylizedSurface?.skyView?.directional) {
          stylizedSurface.skyView.directional.intensity = Math.min(
            stylizedSurface.skyView.directional.intensity,
            0.08,
          );
          if (stylizedSurface.skyView.hemisphere) {
            stylizedSurface.skyView.hemisphere.intensity = Math.min(
              stylizedSurface.skyView.hemisphere.intensity,
              0.12,
            );
          }
        }
        if (mode.spell && spellRuntime?.cast) {
          spellRuntime.cast('fire');
          spellRuntime.cast('water');
        }
      },
    };
  }
  if (perfQaConfig?.scenarioId === 'object-town') {
    createObjectTownQaScene({
      target: perfQaConfig.buildingCount,
      proceduralAssetManager,
      objectMap,
      objectView,
    });
  }

  releaseAssetProgress();
  boot.start('prewarm', 'Compiling shaders — this is the long one');
  let finishWaterPrewarm = null;
  try {
    await spellRuntime?.precompile?.(terrainView.renderer);
    stylizedSurface.prewarmStreamingResources(terrainView.renderer);
    finishWaterPrewarm = stylizedSurface.beginWaterRefractionPrewarm();
    await terrainView.renderer.compileAsync(terrainView.scene, editorCamera.camera);
    if (finishWaterPrewarm) {
      terrainView.renderer.render(terrainView.scene, editorCamera.camera);
    }
    worldWind.update(0, editorCamera.camera.position, terrainView.floatingOrigin.getState(), null);
    worldWind.render(terrainView.renderer);
    await characterView?.prewarm(terrainView.renderer, playerController.camera);
    await postProcessingController.precompile(playerController.camera);
    terrainView.prewarmPostProcessing(playerController.camera);
  } catch (error) {
    console.warn('Render pipeline pre-warm failed; pipelines will compile on demand.', error);
  } finally {
    finishWaterPrewarm?.();
  }
  boot.finish();

  const perfQa = PerfQaHarness.fromLocation({
    viewModeController,
    playerController,
    terrainView,
    objectView,
    stylizedSurface,
    voxelPrototype,
    editorConfig: config,
  });
  if (perfQa) {
    perfQa.mount(root);
    perfQa.publishApi();
    if (perfQa.config.autostart) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => perfQa.start());
      });
    }
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    terrainView.resize(width, height);
    viewModeController.resize(width, height);
  });
  resizeObserver.observe(ui.viewport);

  let active = true;
  let nextFrameRateDisplayAt = 0;
  let nextStreamingStatusAt = 0;
  let nextPredictiveRefreshAt = 0;
  const onVisibilityChange = () => {
    if (!document.hidden) return;
    frameRateMeter.reset();
    frameRateDisplay.update(null);
    nextFrameRateDisplayAt = 0;
    nextPredictiveRefreshAt = 0;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  let lastWeatherTimestamp = null;
  let lastCharacterTimestamp = null;
  const characterCentre = { x: 0, y: 0, z: 0 };
  terrainView.setAnimationLoop((timestamp) => {
    if (!active) return;

    const frameTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    stylizedSurface.beginFrame(frameTimestamp);
    const profiling = perfQa?.beginFrame(frameTimestamp) ?? false;
    const averageFps = frameRateMeter.record(frameTimestamp);
    if (frameTimestamp >= nextFrameRateDisplayAt) {
      frameRateDisplay.update(averageFps);
      ui.updateGrassBladeReadout({
        clumps: PerfCounters.get('grassLastChunkClumps'),
        blades: PerfCounters.get('grassLastChunkEffectiveBlades'),
        triangles: PerfCounters.get('grassLastChunkTriangles'),
        fps: averageFps,
      });
      nextFrameRateDisplayAt = frameTimestamp + FRAME_RATE_DISPLAY_INTERVAL_MS;
    }

    terrainView.flushUploadQueue();
    constructionView.update(frameTimestamp);
    constructionView.updateLod(viewModeController.camera, terrainView.renderer.domElement.clientHeight);
    PerfCounters.set('constructionModulesResident', constructionView.stats.modulesResident);
    PerfCounters.set('constructionModulesRebuilt', constructionView.stats.modulesRebuilt);
    PerfCounters.set('constructionModulesSkippedByHash', constructionView.stats.modulesSkippedByHash);
    PerfCounters.set('constructionQueueDepth', constructionView.stats.queueDepth);
    PerfCounters.set('constructionStones', constructionView.stats.stones);
    PerfCounters.set('constructionBuildMs', Math.round(constructionView.stats.buildMs));
    PerfCounters.set('constructionModulesNear', constructionView.stats.modulesNear);
    PerfCounters.set('constructionModulesCoarse', constructionView.stats.modulesCoarse);
    PerfCounters.set('constructionModulesShell', constructionView.stats.modulesShell);
    PerfCounters.set('constructionLodTransitions', constructionView.stats.lodTransitions);
    if (profiling) perfQa.mark('terrainCommit');

    viewModeController.update(frameTimestamp);
    ui.setMinimapHeading(viewModeController.getHeading());
    viewModeUi.update();
    if (profiling) perfQa.mark('player');

    let renderFocus = viewModeController.getFocusWorld();
    const rebase = terrainView.updateFloatingOrigin(renderFocus);
    if (rebase) {
      PerfCounters.inc('floatingOriginSnaps');
      viewModeController.shiftWorld(rebase.shiftX, rebase.shiftZ);
      controller.refreshObjects();
      constructionView.rebase();
      characterView?.shiftWorld(rebase.shiftX, rebase.shiftZ);
      snowPowder.shiftWorld(rebase.shiftX, rebase.shiftZ);
      worldAmbience.shiftWorld(rebase.shiftX, rebase.shiftZ);
      stylizedSurface.shiftOrigin(rebase.shiftX, rebase.shiftZ);
      renderFocus = viewModeController.getFocusWorld();
    }
    if (profiling) perfQa.mark('floatingOrigin');

    if (characterView) {
      const walking = viewModeController.mode === PLAYER_MODE_WALK
        && !viewModeController.paused;
      const wantVisible = walking
        && (viewModeController.isThirdPerson || characterInFirstPerson);
      if (characterView.visible !== wantVisible) characterView.setVisible(wantVisible);
      if (wantVisible) {
        const deltaSeconds = lastCharacterTimestamp === null
          ? 0
          : (frameTimestamp - lastCharacterTimestamp) / 1000;
        characterView.update(
          deltaSeconds,
          playerController.getStatus(),
          frameTimestamp,
        );
      }
      lastCharacterTimestamp = wantVisible ? frameTimestamp : null;
      const occluding = wantVisible && viewModeController.isThirdPerson;
      if (occluding) {
        const status = playerController.getStatus();
        const footY = Number.isFinite(status.footY) ? status.footY : status.position.y;
        characterCentre.x = status.position.x;
        characterCentre.y = footY + characterView.height * 0.55;
        characterCentre.z = status.position.z;
      }
      updateCharacterOcclusion({
        renderer: terrainView.renderer,
        camera: viewModeController.camera,
        target: occluding ? characterCentre : null,
        height: characterView.height,
        pixelScale: postProcessingController.graph?.sceneResolutionScale ?? 1,
        enabled: occluding,
      });
      if (profiling) perfQa.mark('character');
    }

    macroFarTerrain.update();
    const backdropActive = macroFarTerrain.isActive();
    if (backdropActive !== farViewActive) {
      farViewActive = backdropActive;
      applyViewDistance(backdropActive);
    }

    const canonicalFocus = floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
    const forcePredictiveRefresh = frameTimestamp >= nextPredictiveRefreshAt;
    if (forcePredictiveRefresh) {
      nextPredictiveRefreshAt = frameTimestamp + TERRAIN_PREFETCH_REFRESH_MS;
    }
    terrainView.updateStreaming(
      canonicalFocus,
      frameTimestamp,
      forcePredictiveRefresh,
    ).catch((error) => {
      console.error('Terrain streaming update failed.', error);
    });
    if (profiling) perfQa.mark('streaming');

    // The player's feet, in render space like the layers' own state, for the layers
    // that react to the body standing in them. A paused or non-walking view passes
    // null, which lets what the body pressed stand back up rather than freezing it.
    const bodyStatus = viewModeController.mode === PLAYER_MODE_WALK && !viewModeController.paused
      ? playerController.getStatus()
      : null;
    const playerBody = bodyStatus
      ? {
        x: bodyStatus.position.x,
        y: Number.isFinite(bodyStatus.footY) ? bodyStatus.footY : bodyStatus.position.y,
        z: bodyStatus.position.z,
      }
      : null;
    stylizedSurface.update(frameTimestamp, viewModeController.camera, playerBody);
    if (profiling) perfQa.mark('stylized');

    if (weatherController) {
      const camera = viewModeController.camera;
      const effectCenter = camera.position;
      const deltaSeconds = lastWeatherTimestamp == null
        ? 0
        : Math.min(0.05, Math.max(0, (frameTimestamp - lastWeatherTimestamp) / 1000));
      lastWeatherTimestamp = frameTimestamp;
      weatherController.update(
        deltaSeconds,
        frameTimestamp * 0.001,
        camera.position,
        effectCenter,
      );
    }
    spellRuntime?.update(frameTimestamp);

    objectView.update(frameTimestamp, viewModeController.camera);
    if (profiling) perfQa.mark('objects');

    voxelPrototype.update(canonicalFocus);
    if (profiling) perfQa.mark('voxel');

    if (frameTimestamp >= nextStreamingStatusAt) {
      ui.renderStreamingStatus(terrainView.getStreamingStatus());
      nextStreamingStatusAt = frameTimestamp + 250;
    }
    for (const listener of streamingFrameListeners) listener();
    const windCamera = viewModeController.camera.position;
    worldWind.update(
      lastWindTimestamp === null ? 0 : (frameTimestamp - lastWindTimestamp) / 1000,
      windCamera,
      terrainView.floatingOrigin.getState(),
      {
        enabled: weatherEnabled && weatherSettings.weatherMode !== 'off',
        windX: weatherSettings.weatherWindX,
        windZ: weatherSettings.weatherWindZ,
        intensity: weatherSettings.weatherIntensity,
      },
    );
    lastWindTimestamp = frameTimestamp;
    worldWind.render(terrainView.renderer);
    waterfallMist.update(frameTimestamp / 1000, viewModeController.camera);
    updateGroundDeformation(frameTimestamp / 1000);
    snowWakeRecorder.update(frameTimestamp / 1000, snowWakeBody());
    updateSeaState({
      timeSeconds: frameTimestamp / 1000,
      storm: seaStormForWeather(),
      rain: weatherAudioLevels().rain,
      seaLevel: worldStore.generator?.seaLevel,
    });
    worldSoundscape.update(frameTimestamp / 1000, viewModeController.camera);
    const frameSeconds = frameTimestamp / 1000;
    const frameDelta = lastWetnessSeconds === null ? 0 : Math.min(1, frameSeconds - lastWetnessSeconds);
    lastWetnessSeconds = frameSeconds;
    surfaceWetness.update(frameDelta, weatherAudioLevels().rain);
    skyLooks?.setOvercast(weatherOvercast());
    const snowCountryWeight = snowCountry.update(frameDelta, viewModeController.camera);
    skyLooks?.setSnowCountry(snowCountryWeight);
    weatherController?.setRegionalSnow(snowCountryWeight);
    if (dayNightCycle) {
      // A paused cycle reports the same preset every frame and `setPreset` ignores
      // a repeat, so this is a genuine no-op. The moon follows the clock's own
      // astronomy; the sky still writes the light.
      skyLooks?.setPreset(dayNightCycle.update(frameDelta));
      stylizedSurface.skyView?.setCelestial(dayNightCycle.evaluate());
    }
    skyLooks?.update(frameDelta);
    // The gorge mist's local height patch and colours, from the sky the look just
    // wrote. Weighted by the snow country the sky is also tinted by, so it appears
    // in the gorges and fades out of the lowlands.
    terrainView.updateValleyFog({
      focus: viewModeController.camera.position,
      origin: terrainView.floatingOrigin.getState(),
      timeSeconds: frameSeconds,
      weight: snowCountryWeight,
      sunDirection: stylizedSurface.skyView?.sunDirectionValue,
      sunColor: skyLooks?.current?.directionalColor,
      fogColor: skyLooks?.current?.fogColor,
    });
    snowPowder.update(frameSeconds);
    worldAmbience.update(frameDelta, {
      camera: viewModeController.camera,
      walking: viewModeController.mode === PLAYER_MODE_WALK,
      orbitFocus: renderFocus,
      weather: {
        enabled: weatherEnabled,
        mode: weatherSettings.weatherMode,
        intensity: weatherSettings.weatherIntensity,
        windX: weatherSettings.weatherWindX,
        windZ: weatherSettings.weatherWindZ,
      },
      skyPreset: skyLooks?.preset ?? 'configured',
      night: Boolean(skyLooks?.night),
      snowCountry: snowCountryWeight,
      player: characterView,
    });
    fallingLeaves.update(
      frameSeconds,
      frameDelta,
      viewModeController.camera,
      weatherEnabled && weatherSettings.weatherMode !== 'off'
        ? { x: weatherSettings.weatherWindX, z: weatherSettings.weatherWindZ }
        : { x: 0.3, z: 0.1 },
      viewModeController.mode === PLAYER_MODE_WALK,
    );
    terrainView.render(viewModeController.camera);
    assetStartupTelemetry.markFirstFrame();
    if (profiling) {
      perfQa.mark('render');
      const voxelStatusLive = voxelPrototype.getStatus?.() ?? null;
      perfQa.endFrame({
        streaming: terrainView.getStreamingStatus(),
        voxel: voxelStatusLive
          ? {
            ready: voxelStatusLive.ready,
            rebuilding: voxelStatusLive.rebuilding,
            residentChunkCount: voxelStatusLive.residentChunkCount,
            focusChunk: voxelStatusLive.focusChunk,
          }
          : null,
        originSnap: Boolean(rebase),
        forcePredictiveRefresh,
      });
    } else if (perfQa) {
      perfQa.endFrame();
    }
  });

  window.addEventListener('pagehide', () => {
    active = false;
    for (const unsubscribe of temporalUnsubscribers) unsubscribe();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resizeObserver.disconnect();
    perfQa?.dispose();
    voxelPrototypeUi.dispose();
    voxelPrototype.dispose();
    stylizedSurface.dispose();
    weatherController?.dispose();
    weatherUi?.dispose();
    spellKeyHandler = null;
    detachSpellHotkeys();
    detachCameraViewHotkey();
    detachFootsteps?.();
    worldWind.dispose();
    waterfallMist.dispose();
    worldSoundscape.dispose();
    fallingLeaves.dispose();
    snowPowder.dispose();
    worldAmbience.dispose();
    heroSelectUi?.dispose();
    characterView?.dispose();
    spellRuntime?.dispose();
    worldMapUi.dispose();
    worldMapController.dispose();
    inventoryUi.dispose();
    inventoryController.dispose();
    gameplayOverlayController.dispose();
    macroFarTerrain.dispose();
    proceduralWorkshop.dispose();
    viewModeUi.dispose();
    viewModeController.dispose();
    controller.dispose();
    editorCamera.dispose();
    objectView.dispose();
    constructionView.dispose();
    constructionCompiler.dispose();
    frameRateDisplay.dispose();
    postProcessingController.dispose();
    terrainView.dispose();
    worldStore.dispose();
    localAssetObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }, { once: true });
}

function showStartupError(error) {
  console.error('Failed to start the Drusniel World editor.', error);
  document.querySelectorAll('.loading-overlay').forEach((element) => element.remove());
  const root = document.querySelector('#app');
  if (!root) return;

  const container = document.createElement('main');
  Object.assign(container.style, {
    padding: '24px',
    fontFamily: 'system-ui',
    color: '#f4e6e6',
    background: '#211414',
    minHeight: '100vh',
  });
  const title = document.createElement('h1');
  title.textContent = 'Editor failed to start';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  container.append(title, message);
  root.replaceChildren(container);
}

startEditor().catch(showStartupError);
