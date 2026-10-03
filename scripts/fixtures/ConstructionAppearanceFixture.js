import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '/src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '/src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '/src/editor/construction/masonry/CurveArcTable.js';
import { planConstruction } from '/src/editor/construction/planning/ConstructionPlanner.js';
import { buildModuleMasonry } from '/src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createConstructionMaterials, disposeConstructionMaterials } from '/src/editor/construction/render/ConstructionMaterials.js';
import { coarsePlacementsForModule } from '/src/editor/construction/render/ConstructionLod.js';
import { SKY_PRESETS } from '/src/editor/stylized/sky/SkyPresets.js';
import { skyAmbientColor } from '/src/editor/stylized/sky/skyAmbient.js';
import { directionFromAngles } from '/src/editor/stylized/StylizedGodRaysPostProcess.js';
import { constructionGardenScene } from './ConstructionGardenScenes.js';
import { addConstructionGardenEnvironment, gardenHeightAt } from './ConstructionGardenEnvironment.js';

/** Fixed semantic scenes, camera and lighting for comparing masonry changes. */
export async function createConstructionAppearanceFixture({ styleKey = 'glade-sandstone', lodBand = 'near', growth = 'auto', view = 'front', closeup = false, zoom = null } = {}) {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(1200, 800);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-10.5, 10.5, 7, -7, 0.1, 100);
  camera.position.set(11, 10, view === 'back' ? -16 : 16);
  camera.lookAt(0, 2, 0);
  if (closeup) {
    camera.zoom = 3;
    camera.position.set(2, 3.8, view === 'back' ? -12 : 12);
    camera.lookAt(0, 1.8, 0);
    camera.updateProjectionMatrix();
  }
  if (Number.isFinite(zoom) && zoom > 0 && zoom <= 10) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  const baseCamera = camera.clone();

  async function capture(id, light = 'neutral') {
    camera.copy(baseCamera);
    const garden = constructionGardenScene(id, { styleKey, growth });
    if (garden) {
      camera.position.fromArray(garden.camera.position);
      if (view === 'back') camera.position.z *= -1;
      camera.lookAt(...garden.camera.target);
      camera.zoom = Number.isFinite(zoom) && zoom > 0 && zoom <= 10 ? zoom : garden.camera.zoom;
      camera.updateProjectionMatrix();
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c3c6b5');
    const look = light === 'warm' ? SKY_PRESETS.glade : null;
    const hemisphere = new THREE.HemisphereLight(look ? skyAmbientColor(look) : '#fffaf0',
      look?.groundLightColor ?? '#7c8264', look?.ambientIntensity ?? 1.7);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(look?.directionalColor ?? '#ffffff', look?.directionalIntensity ?? 3);
    if (look) sun.position.copy(directionFromAngles(look.sunElevation, look.sunAzimuth).multiplyScalar(20));
    else sun.position.set(-5, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13 });
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = look?.shadowRadius ?? 1;
    scene.add(sun);
    const ground = garden ? null : new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardNodeMaterial({ color: '#89916d', roughness: 1 }));
    if (ground) {
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.04;
      ground.receiveShadow = true;
      scene.add(ground);
    }

    const points = id === 'tower'
      ? Array.from({ length: 32 }, (_, i) => [Math.cos(i * Math.PI / 16) * 3.6, Math.sin(i * Math.PI / 16) * 3.6])
      : ['curve', 'curved-arch', 'growth'].includes(id)
        ? [[-5, 3], [-5, 0], [-3, -3], [0, -4], [3, -3], [5, 0], [5, 3]]
        : [[-7, 0], [7, 0]];
    const path = createCubicBezierPathFromStroke(points, { closed: id === 'tower', simplifyTolerance: 0.02 });
    const arcTable = createCurveArcTable(sampleCubicBezierPath(path));
    const record = normalizeConstructionRecord({
      version: 1, id: `appearance-${id}`, revision: 1, seed: 3141, kind: 'wall',
      style: { key: id === 'standard' ? 'coursed-rubble' : styleKey, version: 1, growth },
      dimensions: { height: ['arches', 'arch-profiles', 'curved-arch'].includes(id) ? 5.5 : id === 'low' ? 0.8 : 3.2, thickness: 0.8 },
      top: { style: id === 'curve' ? 'crenellated' : 'flat' },
      path,
      features: ['arches', 'arch-profiles', 'curved-arch'].includes(id) ? (id === 'arch-profiles' ? [0.12, 0.37, 0.63, 0.88]
        : id === 'curved-arch' ? [0.6] : [0.18, 0.5, 0.82]).map((arcFraction, i) => ({
        id: `arch-${i}`, kind: 'arch', ...arcTable.fromArc(arcFraction * arcTable.totalLength),
        width: id === 'arch-profiles' ? 2.4 : 3, height: 4.4, sill: 0,
        profile: id === 'arch-profiles' ? ['round', 'segmental', 'pointed', 'flat'][i] : 'round', dressed: true,
      })) : [],
    });
    const walls = garden?.walls ?? [{ record, arcTable }];
    const environment = garden ? await addConstructionGardenEnvironment(scene,
      { ...garden, sun, hemisphere, renderer, showTrees: view !== 'back' }) : null;
    let stones = 0;
    let triangles = 0;
    let growthLeaves = 0;
    let groundDetails = 0;
    for (const { record, arcTable } of walls) {
      const plan = planConstruction(record);
      const materials = createConstructionMaterials(record);
      for (const module of plan.modules) {
        const placements = lodBand === 'coarse' ? coarsePlacementsForModule({ record, module, totalLength: plan.totalLength }) : module.placements;
        const built = buildModuleMasonry(placements, {
          record, materials, arcTable, moduleOrigin: { x: 0, z: 0 }, groundHeightAt: garden ? gardenHeightAt : () => 0,
          pathInterval: module.pathInterval, lodBand,
        });
        for (const mesh of built.meshes) scene.add(mesh);
        stones += built.stats.stones;
        triangles += built.stats.totalTriangles;
        growthLeaves += built.stats.growthLeaves ?? 0;
        groundDetails += built.stats.groundDetails ?? 0;
      }
    }
    await renderer.compileAsync(scene, camera);
    await renderer.renderAsync(scene, camera);
    // GPU completion makes the screenshot independent of shader compile timing.
    await renderer.backend.device?.queue.onSubmittedWorkDone();
    return {
      id, light, lodBand, growth, view, closeup: closeup || id === 'meadow-closeup', zoom: camera.zoom, stones, triangles, growthLeaves, groundDetails,
      lightingPreset: look ? 'glade' : 'neutral',
      wallCount: walls.length, environment: environment?.stats ?? null,
      camera: { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), zoom: camera.zoom },
      openingArcs: walls.flatMap(({ record, arcTable }) => record.features.map(feature => arcTable.toArc(feature.segmentId, feature.arcFraction))),
      backend: renderer.backend.constructor.name,
      dispose() {
        const geometries = new Set();
        scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
        for (const geometry of geometries) geometry.dispose();
        ground?.material.dispose();
        environment?.dispose();
        sun.shadow.dispose();
        disposeConstructionMaterials();
      },
    };
  }
  return { capture, dispose: () => renderer.dispose() };
}
