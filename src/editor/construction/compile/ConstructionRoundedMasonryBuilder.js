import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beveledBox, beveledQuadPrism } from '../../workshop/ProceduralWorkshopGeometry.js';
import { stoneJitter } from '../../workshop/ProceduralWorkshopIrregularity.js';
import {
  applyUnitShading,
  stoneUnitAlbedo,
  stoneUnitWeathering,
} from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStoneRoundingProfile } from '../config/ConstructionStoneRoundingProfiles.generated.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { sampleStonePillow } from '../masonry/StonePillowField.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../render/ConstructionMaterialSlots.js';
import { mortarConfigForStyle } from '../render/ConstructionMortarConfig.js';
import { createArcBendTable, createStoneBend } from './ConstructionArcBend.js';
import { createArcGroundTable, createStoneDrape } from './ConstructionArcGround.js';
import { buildMortarCoreGeometry } from './ConstructionMortarCoreBuilder.js';
import { estimatePillowStone, writePillowStone } from './ConstructionPillowStoneMesher.js';
import {
  applyConstructionStoneColorGrade,
  constructionStoneColorMultipliers,
} from './ConstructionStoneColorGrade.js';
import {
  constructionRecipe,
  createMortarDescriptor,
  resolveStoneShape,
} from './ConstructionStoneShape.js';
import { MasonryVertexWriter } from './MasonryVertexWriter.js';
import { createRoundedStoneShader } from './RoundedStoneShading.js';
import { constructionStoneExposure } from './ConstructionStoneExposure.js';
import { writeContourStone } from './ConstructionContourStone.js';

/**
 * Module masonry for styles whose `geometry` is `rounded`.
 *
 * Same contract as the soft path in `ConstructionMasonryBuilder` — a mortar
 * mesh then a stone mesh, module-origin-local, material slots and user data the
 * view already understands — so LOD, picking, selection and stats work
 * unchanged. What differs is how stones are made: each one is a pillow stone
 * written straight into one set of typed arrays (`ConstructionPillowStoneMesher`)
 * with its colour and crevice occlusion baked per vertex, and the whole module
 * is draped over the ground along the wall rather than lifted stone by stone.
 *
 * Footprint, orientation and protrusion still come from `stoneJitter` and
 * `resolveStoneShape`, exactly as for soft stones; only the protrusion is
 * damped to the profile's `protrusionScale`, the way the soft path damps a
 * lattice stone's in-plane jitter.
 */

/** Metres of wall sampled for draping beyond the module's outermost stones. */
const GROUND_MARGIN = 2.5;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createStats() {
  return {
    stones: 0,
    stoneTriangles: 0,
    mortarPrisms: 0,
    mortarTriangles: 0,
    totalTriangles: 0,
    triangles: 0,
    stoneBuildMs: 0,
    mortarBuildMs: 0,
    roundedStones: 0,
    roundedTriangles: 0,
    roundedFallbacks: 0,
    roundedShrunk: 0,
    roundedBuildMs: 0,
    footingStones: 0,
  };
}

/**
 * Keep only `scale` of `stoneJitter`'s push out of (or into) the face plane.
 * The offset is linear in the protrusion, so scaling the displacement from the
 * nominal position scales the protrusion itself.
 */
export function dampProtrusion(shaped, nominalPosition, scale) {
  if (scale === 1) return shaped;
  return {
    ...shaped,
    position: nominalPosition.map((value, axis) => value + (shaped.position[axis] - value) * scale),
    protrusion: shaped.protrusion * scale,
  };
}

/** A box stone's face ring, sheared exactly as `beveledBox` shears its shape. */
export function skewedBoxCorners(width, height, skew = [0, 0]) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    [-halfWidth + skew[1], -halfHeight],
    [halfWidth + skew[1], -halfHeight],
    [halfWidth + skew[0], halfHeight],
    [-halfWidth + skew[0], halfHeight],
  ];
}

/** Lower a face ring's two bottom corners (ring order is bottom-left first). */
export function lowerBottomCorners(corners, distance) {
  return corners.map(([x, y], index) => (index < 2 ? [x, y - distance] : [x, y]));
}

/**
 * How far a footing stone reaches below grade: enough to cover the ground
 * falling away under either face of the plinth, never less than the margin.
 */
export function footingBurial({ footing, frame, placement, depth, groundHeightAt }) {
  if (!footing || !placement.footing) return 0;
  const reach = depth / 2;
  const centerX = frame.x + frame.normalX * placement.offsetNormal;
  const centerZ = frame.z + frame.normalZ * placement.offsetNormal;
  const grade = groundHeightAt(frame.x, frame.z);
  const lowest = Math.min(
    groundHeightAt(centerX + frame.normalX * reach, centerZ + frame.normalZ * reach),
    groundHeightAt(centerX - frame.normalX * reach, centerZ - frame.normalZ * reach),
  );
  const drop = Math.max(0, grade - lowest);
  return Math.min(footing.burialMax, Math.max(footing.burialMargin, drop + footing.burialMargin));
}

/**
 * A prism stone for the rare quad the pillow mesher cannot round, shaded and
 * graded the way the soft path shades it, then draped and appended.
 */
function appendFallbackStone(writer, {
  shape,
  corners,
  recipe,
  placement,
  styleKey,
  seed,
  hasCustomStoneMaterial,
  drape,
}) {
  const geometry = shape.lattice
    ? beveledQuadPrism({
      corners,
      depth: shape.depth,
      position: shape.position,
      rotation: shape.rotation,
      bevelRatio: shape.bevelRatio,
      detail: shape.detail,
    })
    : beveledBox({
      width: shape.width,
      height: shape.height,
      depth: shape.depth,
      position: shape.position,
      rotation: shape.rotation,
      bevelRatio: shape.bevelRatio,
      skew: shape.skew,
      detail: shape.detail,
    });
  applyUnitShading(geometry, recipe, {
    stableIndex: placement.stableIndex,
    heightRatio: placement.heightRatio,
    protrusion: shape.protrusion,
    depth: shape.depth,
  });
  applyConstructionStoneColorGrade(geometry, {
    styleKey,
    seed,
    stableIndex: placement.stableIndex,
    category: shape.category,
    hasCustomStoneMaterial,
  });
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const ground = [0, 0];
  const bent = [0, 0, 0, 0];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    drape.sample(x, z, ground);
    position.setY(index, position.getY(index) + ground[0]);
    if (drape.bend) {
      drape.bend(x, z, normal.getX(index), normal.getZ(index), bent);
      position.setX(index, bent[0]);
      position.setZ(index, bent[1]);
      normal.setX(index, bent[2]);
      normal.setZ(index, bent[3]);
    }
  }
  writer.append({
    positions: position.array,
    normals: geometry.getAttribute('normal').array,
    colors: geometry.getAttribute('color').array,
    uvs: geometry.getAttribute('uv').array,
    indices: geometry.index?.array ?? null,
  });
  geometry.dispose();
}

function stoneGeometryFromArrays(arrays) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param placements module-local placements from `packCurvedWall` (or their
 *   `coarsePlacements` reduction for the coarse band)
 * @param options as `buildModuleMasonry`
 */
export function buildRoundedModuleMasonry(placements, {
  record,
  materials,
  arcTable,
  moduleOrigin,
  groundHeightAt,
  lodBand = 'near',
}) {
  const stats = createStats();
  if (!placements || placements.length === 0) return { meshes: [], stats };
  const started = now();

  const styleKey = record.style.key;
  const style = constructionStyle(styleKey);
  const profile = constructionStoneRoundingProfile(styleKey);
  const mortarConfig = mortarConfigForStyle(styleKey);
  const coarse = lodBand === 'coarse';
  const lod = coarse ? profile.lod.coarse : profile.lod.near;
  // Full irregularity in both bands: a stone keeps its identity near and far.
  const recipe = constructionRecipe(record);
  const hasCustomStoneMaterial = Boolean(record.style?.materials?.stone);
  // The record's openings in the wall's own arc domain, the form the shared
  // contour takes. Derived with the arc table exactly as the planner and the
  // shell derive them, so the mortar core clips to the same void the courses and
  // the shell publish (phase 11 §7.3).
  const openings = (record.features ?? []).map((feature) => ({
    ...feature,
    s: arcTable.toArc(feature.segmentId, feature.arcFraction),
  }));

  let minS = Infinity;
  let maxS = -Infinity;
  for (const placement of placements) {
    minS = Math.min(minS, placement.s);
    maxS = Math.max(maxS, placement.s);
  }
  const ground = createArcGroundTable({
    arcTable,
    groundHeightAt,
    from: minS - GROUND_MARGIN,
    to: maxS + GROUND_MARGIN,
  });
  const bendTable = createArcBendTable({
    arcTable,
    moduleOrigin,
    from: minS - GROUND_MARGIN,
    to: maxS + GROUND_MARGIN,
  });

  const estimate = estimatePillowStone(lod);
  const writer = new MasonryVertexWriter({
    vertices: estimate.vertices * placements.length,
    indices: estimate.triangles * 3 * placements.length,
  });
  const mortarDescriptors = [];
  const contourMortar = new MasonryVertexWriter();
  const albedo = new Float32Array(3);

  for (const placement of placements) {
    const frame = arcTable.frameAt(placement.s);
    const center = [
      frame.x + frame.normalX * placement.offsetNormal - moduleOrigin.x,
      placement.y,
      frame.z + frame.normalZ * placement.offsetNormal - moduleOrigin.z,
    ];
    const params = {
      width: placement.width,
      height: placement.height,
      depth: placement.depth,
      position: center,
      // `[0, yaw, roll]` for the same Euler-order reason the soft path gives.
      rotation: [0, frame.yaw, placement.roll],
    };
    const category = placement.category ?? 'field';
    const exposure = constructionStoneExposure(placement, {
      totalLength: arcTable.totalLength, closed: record.path.closed,
    });
    const shaped = dampProtrusion(
      stoneJitter(recipe, params, placement.stableIndex, category),
      params.position,
      profile.protrusionScale,
    );
    const shape = resolveStoneShape({
      placement,
      params,
      shaped,
      detail: style.detail,
      exactFit: Boolean(style.exactFit),
    });
    const burial = footingBurial({
      footing: style.footing,
      frame,
      placement,
      depth: shape.depth,
      groundHeightAt,
    });
    const faceCorners = shape.lattice
      ? shape.corners
      : skewedBoxCorners(shape.width, shape.height, shape.skew);
    const corners = burial > 0 ? lowerBottomCorners(faceCorners, burial) : faceCorners;
    if (placement.footing) stats.footingStones += 1;

    const drapeFrame = {
      s: placement.s,
      x: center[0],
      z: center[2],
      tangentX: frame.tangentX,
      tangentZ: frame.tangentZ,
    };
    const drape = createStoneDrape(ground, {
      s: placement.s,
      centerX: center[0],
      centerZ: center[2],
      tangentX: frame.tangentX,
      tangentZ: frame.tangentZ,
      bend: createStoneBend(bendTable, {
        s: placement.s,
        x: frame.x - moduleOrigin.x,
        z: frame.z - moduleOrigin.z,
        tangentX: frame.tangentX,
        tangentZ: frame.tangentZ,
      }),
    });
    const pillow = sampleStonePillow({
      profile,
      seed: record.seed,
      stableIndex: placement.stableIndex,
      category,
      footing: Boolean(placement.footing),
      width: shape.width,
      height: shape.height,
      depth: shape.depth,
    });
    const shade = createRoundedStoneShader({
      albedo: stoneUnitAlbedo(recipe, placement.stableIndex, { out: albedo }),
      grade: constructionStoneColorMultipliers({
        styleKey,
        seed: record.seed,
        stableIndex: placement.stableIndex,
        category,
        hasCustomStoneMaterial,
      }),
      weather: stoneUnitWeathering(recipe, placement.heightRatio),
      occlusion: profile.occlusion,
    });

    const written = placement.contourPolygons ? writeContourStone(writer, {
      polygons: placement.contourPolygons,
      depth: placement.depth,
      position: center,
      rotation: params.rotation,
    }, { shade, drape, exposure }) : writePillowStone(writer, {
      corners,
      depth: shape.depth,
      position: shape.position,
      rotation: shape.rotation,
      pillow,
    }, {
      lod,
      shade,
      creviceReach: profile.occlusion.creviceReach,
      drape,
      exposure,
    });
    if (written) {
      stats.roundedStones += 1;
      stats.roundedTriangles += written.triangles;
      if (written.shrunk) stats.roundedShrunk += 1;
    } else {
      stats.roundedFallbacks += 1;
      appendFallbackStone(writer, {
        shape,
        corners,
        recipe,
        placement,
        styleKey,
        seed: record.seed,
        hasCustomStoneMaterial,
        drape,
      });
    }

    if (placement.contourPolygons) {
      writeContourStone(contourMortar, {
        polygons: placement.mortarPolygons ?? [],
        depth: Math.max(0.05, placement.depth - mortarConfig.faceRecess * 2),
        position: center, rotation: params.rotation, bevel: 0,
      }, { drape, shade: out => { out[0] = 1; out[1] = 1; out[2] = 1; } });
      continue;
    }
    const mortarPlacement = burial > 0 && placement.mortarCorners
      ? { ...placement, mortarCorners: lowerBottomCorners(placement.mortarCorners, burial) }
      : placement;
    const descriptor = createMortarDescriptor({
      placement: mortarPlacement,
      stoneShape: burial > 0 ? { ...shape, corners } : shape,
      nominalPosition: params.position,
      nominalRotation: params.rotation,
      config: mortarConfig,
      exposure,
    });
    if (descriptor) {
      mortarDescriptors.push({
        ...descriptor,
        drapeFrame,
        bend: drape.bend,
      });
    }
  }
  stats.stoneBuildMs = now() - started;

  const arrays = writer.toArrays();
  if (arrays.vertexCount === 0) return { meshes: [], stats };
  const stoneGeometry = stoneGeometryFromArrays(arrays);

  const mortarStarted = now();
  const bentMortar = [0, 0, 0, 0];
  let mortarGeometry = null;
  try {
    mortarGeometry = buildMortarCoreGeometry(mortarDescriptors, {
      drape: ({ drapeFrame }, x, z) => ground.heightAt(
        drapeFrame.s
          + (x - drapeFrame.x) * drapeFrame.tangentX
          + (z - drapeFrame.z) * drapeFrame.tangentZ,
      ),
      bend: (descriptor, point) => {
        descriptor.bend(point.x, point.z, 0, 0, bentMortar);
        point.x = bentMortar[0];
        point.z = bentMortar[1];
      },
      openings,
    });
  } catch (error) {
    stoneGeometry.dispose();
    throw error;
  }
  if (contourMortar.vertexCount) {
    const fitted = stoneGeometryFromArrays(contourMortar.toArrays());
    if (mortarGeometry) {
      // Prism mortar has no colour attribute; both batches use the same material.
      fitted.deleteAttribute('color');
      const combined = mergeGeometries([mortarGeometry, fitted]);
      mortarGeometry.dispose(); fitted.dispose();
      mortarGeometry = combined;
    } else mortarGeometry = fitted;
  }
  stats.mortarBuildMs = now() - mortarStarted;

  stats.stones = placements.length;
  stats.stoneTriangles = arrays.triangleCount;
  stats.mortarPrisms = mortarDescriptors.length;
  stats.mortarTriangles = mortarGeometry
    ? (mortarGeometry.index?.count ?? mortarGeometry.attributes.position.count) / 3
    : 0;
  stats.totalTriangles = stats.stoneTriangles + stats.mortarTriangles;
  stats.triangles = stats.totalTriangles;
  stats.roundedBuildMs = now() - started;

  const meshes = [];
  if (mortarGeometry) {
    const mortarMesh = new THREE.Mesh(mortarGeometry, materials.mortar);
    mortarMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
    mortarMesh.castShadow = false;
    mortarMesh.receiveShadow = true;
    meshes.push(mortarMesh);
  }
  const stoneMesh = new THREE.Mesh(stoneGeometry, materials.stone);
  stoneMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;
  stoneMesh.userData.constructionGeometryTier = coarse ? 'rounded-coarse' : 'rounded-near';
  stoneMesh.userData.constructionStyleKey = styleKey;
  stoneMesh.userData.constructionLodBand = lodBand;
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  meshes.push(stoneMesh);
  return { meshes, stats };
}
