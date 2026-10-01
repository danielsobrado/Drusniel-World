import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '/src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '/src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '/src/editor/construction/masonry/CurveArcTable.js';
import { planConstruction } from '/src/editor/construction/planning/ConstructionPlanner.js';
import { buildModuleMasonry } from '/src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createConstructionMaterials, disposeConstructionMaterials } from '/src/editor/construction/render/ConstructionMaterials.js';
import { coarsePlacementsForModule } from '/src/editor/construction/render/ConstructionLod.js';

/** Fixed semantic scenes, camera and lighting for comparing masonry changes. */
export async function createConstructionAppearanceFixture({ styleKey = 'glade-sandstone', lodBand = 'near', growth = 'auto', view = 'front' } = {}) {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(1200, 800);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-10.5, 10.5, 7, -7, 0.1, 100);
  camera.position.set(11, 10, view === 'back' ? -16 : 16);
  camera.lookAt(0, 2, 0);

  async function capture(id, light = 'neutral') {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c3c6b5');
    scene.add(new THREE.HemisphereLight('#fffaf0', '#7c8264', 1.7));
    const sun = new THREE.DirectionalLight(light === 'warm' ? '#ffe2af' : '#ffffff', 3);
    sun.position.set(-5, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13 });
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardNodeMaterial({ color: '#89916d', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    scene.add(ground);

    const points = id === 'tower'
      ? Array.from({ length: 32 }, (_, i) => [Math.cos(i * Math.PI / 16) * 3.6, Math.sin(i * Math.PI / 16) * 3.6])
      : ['curve', 'curved-arch', 'growth'].includes(id)
        ? [[-5, 3], [-5, 0], [-3, -3], [0, -4], [3, -3], [5, 0], [5, 3]]
        : [[-7, 0], [7, 0]];
    const path = createCubicBezierPathFromStroke(points, { closed: id === 'tower', simplifyTolerance: 0.02 });
    const record = normalizeConstructionRecord({
      version: 1, id: `appearance-${id}`, revision: 1, seed: 3141, kind: 'wall',
      style: { key: id === 'standard' ? 'coursed-rubble' : styleKey, version: 1, growth },
      dimensions: { height: ['arches', 'arch-profiles', 'curved-arch'].includes(id) ? 5.5 : id === 'low' ? 0.8 : 3.2, thickness: 0.8 },
      top: { style: id === 'curve' ? 'crenellated' : 'flat' },
      path,
      features: ['arches', 'arch-profiles', 'curved-arch'].includes(id) ? (id === 'arch-profiles' ? [0.12, 0.37, 0.63, 0.88]
        : id === 'curved-arch' ? [0.6] : [0.18, 0.5, 0.82]).map((arcFraction, i) => ({
        id: `arch-${i}`, kind: 'arch', segmentId: path.segments[0].id,
        arcFraction, width: id === 'arch-profiles' ? 2.4 : 3, height: 4.4, sill: 0,
        profile: id === 'arch-profiles' ? ['round', 'segmental', 'pointed', 'flat'][i] : 'round', dressed: true,
      })) : [],
    });
    const plan = planConstruction(record);
    const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
    const materials = createConstructionMaterials(record);
    let stones = 0;
    let triangles = 0;
    let growthLeaves = 0;
    for (const module of plan.modules) {
      const placements = lodBand === 'coarse' ? coarsePlacementsForModule({ record, module, totalLength: plan.totalLength }) : module.placements;
      const built = buildModuleMasonry(placements, {
        record, materials, arcTable, moduleOrigin: { x: 0, z: 0 }, groundHeightAt: () => 0,
        pathInterval: module.pathInterval, lodBand,
      });
      for (const mesh of built.meshes) scene.add(mesh);
      stones += built.stats.stones;
      triangles += built.stats.totalTriangles;
      growthLeaves += built.stats.growthLeaves ?? 0;
    }
    await renderer.compileAsync(scene, camera);
    await renderer.renderAsync(scene, camera);
    // GPU completion makes the screenshot independent of shader compile timing.
    await renderer.backend.device?.queue.onSubmittedWorkDone();
    return {
      id, light, lodBand, growth, view, stones, triangles, growthLeaves, backend: renderer.backend.constructor.name,
      dispose() {
        scene.traverse(object => object.geometry?.dispose());
        ground.material.dispose();
        sun.shadow.dispose();
        disposeConstructionMaterials();
      },
    };
  }
  return { capture, dispose: () => renderer.dispose() };
}
