import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  beveledBox,
  beveledQuadPrism,
  createBeveledQuadProfile,
  harmonizeVertexColors,
} from '../../workshop/ProceduralWorkshopGeometry.js';
import { stoneJitter } from '../../workshop/ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStoneReliefProfile } from '../config/ConstructionStoneReliefProfiles.generated.js';
import { constructionStoneEdgeWearProfile } from '../config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneLodProfile } from '../config/ConstructionStoneLodProfiles.generated.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import {
  createStoneAppearanceDescriptor,
  topologyInputsFromAppearance,
} from '../masonry/StoneAppearanceDescriptor.js';
import { sampleStoneFaceRelief } from '../masonry/StoneFaceReliefField.js';
import { sampleStoneEdgeWear } from '../masonry/StoneEdgeWearField.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../render/ConstructionMaterialSlots.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../render/ConstructionMortarConfig.js';
import { buildMortarCoreGeometry } from './ConstructionMortarCoreBuilder.js';
import { reliefQuadPrism } from './ConstructionReliefQuadPrism.js';
import { reduceStoneAppearanceForLod } from './ConstructionStoneLodReducer.js';
import { applyConstructionStoneColorGrade } from './ConstructionStoneColorGrade.js';
import { resolveStoneTopology } from './ConstructionStoneTopologyResolver.js';
import { buildSoftStoneGeometry } from './ConstructionSoftStoneGeometry.js';
import { buildRoundedModuleMasonry } from './ConstructionRoundedMasonryBuilder.js';

/**
 * Turn module-local stone placements into merged geometry.
 *
 * Runs on the main thread: the packer produces plain data in a worker, and this
 * is where Three.js enters (doc 18 invariant 6). Geometry is emitted in
 * **module-origin-local** space so a floating-origin rebase stays a transform
 * update, and so bevels and mortar insets sit in a well-conditioned float32
 * range instead of being quantised away 3 km from the origin.
 *
 * Each module returns a mortar mesh (recessed core) then a stone mesh. The
 * authoritative construction record is unchanged; mortar is derived geometry.
 */

import {
  constructionRecipe,
  createMortarDescriptor,
  resolveStoneShape,
} from './ConstructionStoneShape.js';

export {
  constructionRecipe,
  createMortarDescriptor,
  rectangleCorners,
  resolveStoneShape,
  shouldBuildMortarBacking,
} from './ConstructionStoneShape.js';

function createStoneGeometry(stoneShape, {
  mortarConfig = CONSTRUCTION_MORTAR_CONFIG,
  geometryTier = 'near',
  bevelRings = 2,
  allowCornerFlattening = true,
} = {}) {
  if (
    stoneShape.relief?.enabled
    && stoneShape.edgeWear?.front?.enabled
    && stoneShape.edgeWear?.back?.enabled
  ) {
    const topology = resolveStoneTopology({
      stoneShape,
      faceRelief: stoneShape.relief,
      edgeWear: stoneShape.edgeWear,
      mortarConfig,
      bevelRings,
      allowCornerFlattening,
    });
    if (topology.valid) {
      return buildSoftStoneGeometry({
        topology,
        stoneShape,
        geometryTier,
        position: stoneShape.position,
        rotation: stoneShape.rotation,
      });
    }
    // Topology failed progressive clamp — fall through to relief-only / flat.
    // Coarse skips the reliefQuadPrism branch below, so flag the soft failure
    // here or stats / warn paths under-report it.
    if (geometryTier === 'coarse') {
      const geometry = stoneShape.lattice
        ? beveledQuadPrism({
          corners: stoneShape.corners,
          depth: stoneShape.depth,
          position: stoneShape.position,
          rotation: stoneShape.rotation,
          bevelRatio: stoneShape.bevelRatio,
          detail: stoneShape.detail,
        })
        : beveledBox({
          width: stoneShape.width,
          height: stoneShape.height,
          depth: stoneShape.depth,
          position: stoneShape.position,
          rotation: stoneShape.rotation,
          bevelRatio: stoneShape.bevelRatio,
          skew: stoneShape.skew,
          detail: stoneShape.detail,
        });
      return {
        geometry,
        reliefApplied: false,
        reliefFallback: Boolean(stoneShape.relief?.enabled),
        edgeWearApplied: false,
        edgeWearFallback: Boolean(stoneShape.edgeWear?.front?.enabled),
        geometryTier: 'legacy',
      };
    }
  }

  if (stoneShape.lattice && stoneShape.relief?.enabled && geometryTier !== 'coarse') {
    const built = reliefQuadPrism({
      corners: stoneShape.corners,
      depth: stoneShape.depth,
      position: stoneShape.position,
      rotation: stoneShape.rotation,
      bevelRatio: stoneShape.bevelRatio,
      detail: stoneShape.detail,
      frontRelief: stoneShape.relief.front,
      backRelief: stoneShape.relief.back,
    });
    return {
      ...built,
      edgeWearApplied: false,
      edgeWearFallback: Boolean(stoneShape.edgeWear?.front?.enabled),
      geometryTier: 'legacy',
    };
  }

  const geometry = stoneShape.lattice
    ? beveledQuadPrism({
      corners: stoneShape.corners,
      depth: stoneShape.depth,
      position: stoneShape.position,
      rotation: stoneShape.rotation,
      bevelRatio: stoneShape.bevelRatio,
      detail: stoneShape.detail,
    })
    : beveledBox({
      width: stoneShape.width,
      height: stoneShape.height,
      depth: stoneShape.depth,
      position: stoneShape.position,
      rotation: stoneShape.rotation,
      bevelRatio: stoneShape.bevelRatio,
      skew: stoneShape.skew,
      detail: stoneShape.detail,
    });

  return {
    geometry,
    reliefApplied: false,
    reliefFallback: false,
    edgeWearApplied: false,
    edgeWearFallback: false,
    geometryTier: 'legacy',
  };
}

function emptyStats() {
  return {
    stones: 0,
    stoneTriangles: 0,
    reliefStones: 0,
    reliefFallbacks: 0,
    reliefClamped: 0,
    reliefTriangles: 0,
    reliefBuildMs: 0,
    edgeWearEligible: 0,
    edgeWearStones: 0,
    edgeWearClamped: 0,
    edgeWearFallbacks: 0,
    flattenedCorners: 0,
    edgeWearTriangles: 0,
    edgeWearBuildMs: 0,
    nearSoftStones: 0,
    coarseSoftStones: 0,
    nearSoftTriangles: 0,
    coarseSoftTriangles: 0,
    appearanceDescriptors: 0,
    appearanceDescriptorMs: 0,
    lodReductionMs: 0,
    mortarPrisms: 0,
    mortarTriangles: 0,
    totalTriangles: 0,
    stoneBuildMs: 0,
    mortarBuildMs: 0,
    // Legacy alias used by older call sites / counters.
    triangles: 0,
  };
}

function softAppearanceAllowed({
  lodProfile,
  lodBand,
  placement,
  shaped,
  reliefProfile,
  edgeWearProfile,
}) {
  const category = placement.category ?? 'field';
  if (category === 'recess') return false;
  const band = lodBand === 'coarse' ? lodProfile.coarse : lodProfile.near;
  if (lodBand === 'near' && band.mode !== 'soft') return false;
  if (lodBand === 'coarse' && band.mode !== 'soft-coarse') return false;
  if (!reliefProfile.enabled || !edgeWearProfile.enabled) return false;
  if (!(reliefProfile.categories?.[category] > 0)) return false;
  if (!(edgeWearProfile.categories?.[category] > 0)) return false;
  if (
    shaped.width < edgeWearProfile.minimumStone.width
    || shaped.height < edgeWearProfile.minimumStone.height
    || shaped.depth < edgeWearProfile.minimumStone.depth
  ) {
    return false;
  }
  if (
    shaped.width < reliefProfile.minimumStone.width
    || shaped.height < reliefProfile.minimumStone.height
  ) {
    return false;
  }
  return true;
}

function resolveStoneRelief({
  reliefProfile,
  coarse,
  placement,
  shaped,
  bevelRadius,
  mortarFaceRecess,
  seed,
}) {
  // Category gating lives in the sampler (`profile.categories`); keep the
  // builder gate to near-LOD lattice stones with a solved face ring only.
  const reliefAllowed = (
    !coarse
    && reliefProfile.enabled
    && placement.corners
    && shaped.width >= reliefProfile.minimumStone.width
    && shaped.height >= reliefProfile.minimumStone.height
  );
  if (!reliefAllowed) return null;

  const front = sampleStoneFaceRelief({
    profile: reliefProfile,
    seed,
    stableIndex: placement.stableIndex,
    category: placement.category ?? 'field',
    side: 'front',
    width: shaped.width,
    height: shaped.height,
    bevelRadius,
    mortarFaceRecess,
  });
  const back = sampleStoneFaceRelief({
    profile: reliefProfile,
    seed,
    stableIndex: placement.stableIndex,
    category: placement.category ?? 'field',
    side: 'back',
    width: shaped.width,
    height: shaped.height,
    bevelRadius,
    mortarFaceRecess,
  });
  if (!front.enabled || !back.enabled) return null;
  return {
    enabled: true,
    front,
    back,
    clamped: Boolean(front.clampedByBevel || front.clampedByMortar
      || back.clampedByBevel || back.clampedByMortar),
  };
}

function resolveStoneEdgeWear({
  edgeWearProfile,
  coarse,
  placement,
  shaped,
  mortarFaceRecess,
  seed,
}) {
  // Legacy fallback path remains lattice field-only; the soft appearance path
  // above owns worked dressings when their category profiles enable it.
  const edgeWearAllowed = (
    !coarse
    && edgeWearProfile.enabled
    && placement.corners
    && (placement.category ?? 'field') === 'field'
    && shaped.width >= edgeWearProfile.minimumStone.width
    && shaped.height >= edgeWearProfile.minimumStone.height
    && shaped.depth >= edgeWearProfile.minimumStone.depth
  );
  if (!edgeWearAllowed) return null;

  const front = sampleStoneEdgeWear({
    profile: edgeWearProfile,
    seed,
    stableIndex: placement.stableIndex,
    category: placement.category ?? 'field',
    side: 'front',
    width: shaped.width,
    height: shaped.height,
    depth: shaped.depth,
    mortarFaceRecess,
  });
  const back = sampleStoneEdgeWear({
    profile: edgeWearProfile,
    seed,
    stableIndex: placement.stableIndex,
    category: placement.category ?? 'field',
    side: 'back',
    width: shaped.width,
    height: shaped.height,
    depth: shaped.depth,
    mortarFaceRecess,
  });
  if (!front.enabled || !back.enabled) return null;
  return {
    enabled: true,
    front,
    back,
    clamped: Boolean(front.clamped || back.clamped),
  };
}

/**
 * @param placements from `packCurvedWall`, module-local.
 * @param options.moduleOrigin canonical XZ the emitted vertices are relative to.
 * @param options.groundHeightAt `(canonicalX, canonicalZ) => number`. Courses are
 *   solved relative to grade, so the packer never needs terrain and none has to
 *   cross into the worker; ground is resolved here, on the main thread.
 */
export function buildModuleMasonry(placements, {
  record,
  materials,
  arcTable,
  moduleOrigin,
  groundHeightAt,
  lodBand = 'near',
  mortarConfig = CONSTRUCTION_MORTAR_CONFIG,
  disableRelief = false,
  disableEdgeWear = false,
}) {
  const stats = emptyStats();
  if (!placements || placements.length === 0) return { meshes: [], stats };

  const style = constructionStyle(record.style.key);
  if (style.geometry === 'rounded') {
    return buildRoundedModuleMasonry(placements, {
      record, materials, arcTable, moduleOrigin, groundHeightAt, lodBand,
    });
  }
  const lodProfile = constructionStoneLodProfile(record.style.key);
  const reliefProfile = disableRelief
    ? Object.freeze({
      ...constructionStoneReliefProfile(record.style.key),
      enabled: false,
    })
    : constructionStoneReliefProfile(record.style.key);
  const edgeWearProfile = disableEdgeWear
    ? Object.freeze({
      ...constructionStoneEdgeWearProfile(record.style.key),
      enabled: false,
    })
    : constructionStoneEdgeWearProfile(record.style.key);
  const coarse = lodBand === 'coarse';
  const softCoarse = coarse && lodProfile.coarse.mode === 'soft-coarse';
  // Coarse: detail 1. Soft-coarse keeps full irregularity so identity matches
  // the near descriptor; legacy coarse still halves jitter.
  const detail = coarse ? 1 : style.detail;
  const recipe = Object.freeze({
    ...constructionRecipe(record),
    detail,
    irregularity: (coarse && !softCoarse) ? style.irregularity * 0.5 : style.irregularity,
  });

  const stoneGeometries = [];
  const mortarDescriptors = [];
  const stoneStarted = performance.now();
  let reliefBuildMs = 0;
  let edgeWearBuildMs = 0;
  let appearanceDescriptorMs = 0;
  let lodReductionMs = 0;
  let reliefFallbackCount = 0;
  let edgeWearFallbackCount = 0;
  let geometryTierLabel = 'legacy';

  for (const placement of placements) {
    const frame = arcTable.frameAt(placement.s);
    const canonicalX = frame.x + frame.normalX * placement.offsetNormal;
    const canonicalZ = frame.z + frame.normalZ * placement.offsetNormal;
    const params = {
      width: placement.width,
      height: placement.height,
      depth: placement.depth,
      position: [
        canonicalX - moduleOrigin.x,
        groundHeightAt(canonicalX, canonicalZ) + placement.y,
        canonicalZ - moduleOrigin.z,
      ],
      // `[0, yaw, roll]` and no other order. `transformGeometry` builds
      // `new THREE.Euler(...rotation)` with the default 'XYZ' order, composing
      // R = Rx*Ry*Rz — so the Z roll applies first in the block's own frame and
      // the Y yaw then swings it onto the path. Swapping these tilts every
      // coping stone sideways in a way that looks almost right.
      rotation: [0, frame.yaw, placement.roll],
    };
    const shaped = stoneJitter(recipe, params, placement.stableIndex, placement.category);
    // Resolve once without sculpting to obtain the damped lattice ring, then
    // attach sampled relief / edge-wear.
    const provisional = resolveStoneShape({ placement, params, shaped, detail });

    let relief = null;
    let edgeWear = null;
    let geometryTier = 'near';
    let bevelRings = 2;
    let allowCornerFlattening = true;

    const useSoftAppearance = softAppearanceAllowed({
      lodProfile,
      lodBand: coarse ? 'coarse' : 'near',
      placement,
      shaped,
      reliefProfile,
      edgeWearProfile,
    });

    if (useSoftAppearance) {
      const appearanceStarted = performance.now();
      const appearance = createStoneAppearanceDescriptor({
        faceReliefProfile: reliefProfile,
        edgeWearProfile,
        seed: record.seed,
        stableIndex: placement.stableIndex,
        category: placement.category ?? 'field',
        width: shaped.width,
        height: shaped.height,
        depth: shaped.depth,
        mortarFaceRecess: mortarConfig.faceRecess,
      });
      appearanceDescriptorMs += performance.now() - appearanceStarted;
      if (appearance.enabled) {
        stats.appearanceDescriptors += 1;
        if (coarse) {
          const reduceStarted = performance.now();
          const reduced = reduceStoneAppearanceForLod({
            appearance,
            lodProfile,
            lodBand: 'coarse',
          });
          lodReductionMs += performance.now() - reduceStarted;
          const inputs = topologyInputsFromAppearance(reduced);
          relief = inputs.relief;
          edgeWear = inputs.edgeWear;
          const gridColumns = reduced.faceGrid.columns;
          const gridRows = reduced.faceGrid.rows;
          if (relief?.enabled && gridColumns > 0 && gridRows > 0) {
            relief = Object.freeze({
              ...relief,
              front: Object.freeze({
                ...relief.front,
                columns: gridColumns,
                rows: gridRows,
              }),
              back: Object.freeze({
                ...relief.back,
                columns: gridColumns,
                rows: gridRows,
              }),
            });
          }
          geometryTier = 'coarse';
          bevelRings = reduced.bevelRings;
          allowCornerFlattening = false;
        } else {
          // Near consumes the same authoritative descriptor without amplitude
          // reduction so Parts 1–2 shading stay pixel-stable.
          relief = appearance.raw.relief;
          edgeWear = appearance.raw.edgeWear;
          const grid = lodProfile.near.faceGrid;
          if (relief?.enabled && grid.columns > 0 && grid.rows > 0) {
            relief = Object.freeze({
              ...relief,
              front: Object.freeze({
                ...relief.front,
                columns: grid.columns,
                rows: grid.rows,
              }),
              back: Object.freeze({
                ...relief.back,
                columns: grid.columns,
                rows: grid.rows,
              }),
            });
          }
          geometryTier = 'near';
          bevelRings = lodProfile.near.bevelRings;
          allowCornerFlattening = lodProfile.near.cornerFlattening;
        }
      }
    } else {
      edgeWear = resolveStoneEdgeWear({
        edgeWearProfile,
        coarse,
        placement,
        shaped,
        mortarFaceRecess: mortarConfig.faceRecess,
        seed: record.seed,
      });
      const bevelRadius = edgeWear
        ? Math.max(edgeWear.front.baseWidth, edgeWear.front.baseDepth, 1e-4)
        : provisional.lattice
          ? createBeveledQuadProfile({
            corners: provisional.corners,
            depth: provisional.depth,
            bevelRatio: provisional.bevelRatio,
          }).radius
          : 0;
      relief = resolveStoneRelief({
        reliefProfile,
        coarse,
        placement,
        shaped,
        bevelRadius,
        mortarFaceRecess: mortarConfig.faceRecess,
        seed: record.seed,
      });
    }

    if (edgeWear) stats.edgeWearEligible += 1;
    const stoneShape = {
      ...provisional,
      ...(relief ? { relief } : {}),
      ...(edgeWear ? { edgeWear } : {}),
    };
    const sculptStarted = (relief?.enabled || edgeWear?.enabled) ? performance.now() : 0;
    const builtStone = createStoneGeometry(stoneShape, {
      mortarConfig,
      geometryTier: useSoftAppearance && relief?.enabled && edgeWear?.enabled
        ? geometryTier
        : 'near',
      bevelRings,
      allowCornerFlattening,
    });
    if (relief?.enabled || edgeWear?.enabled) {
      const elapsed = performance.now() - sculptStarted;
      if (edgeWear?.enabled) edgeWearBuildMs += elapsed;
      else reliefBuildMs += elapsed;
    }
    if (relief?.enabled) {
      if (builtStone.reliefApplied) {
        stats.reliefStones += 1;
        const tris = (
          builtStone.geometry.index?.count
          ?? builtStone.geometry.attributes.position.count
        ) / 3;
        stats.reliefTriangles += tris;
        if (relief.clamped) stats.reliefClamped += 1;
        if (builtStone.geometryTier === 'near') {
          stats.nearSoftStones += 1;
          stats.nearSoftTriangles += tris;
          geometryTierLabel = 'near-soft';
        } else if (builtStone.geometryTier === 'coarse') {
          stats.coarseSoftStones += 1;
          stats.coarseSoftTriangles += tris;
          geometryTierLabel = 'coarse-soft';
        }
      }
      if (builtStone.reliefFallback) {
        stats.reliefFallbacks += 1;
        reliefFallbackCount += 1;
      }
    }
    if (edgeWear?.enabled) {
      if (builtStone.edgeWearApplied) {
        stats.edgeWearStones += 1;
        stats.edgeWearTriangles += (
          builtStone.geometry.index?.count
          ?? builtStone.geometry.attributes.position.count
        ) / 3;
        stats.flattenedCorners += builtStone.stats?.flattenedCorners ?? 0;
        if (builtStone.stats?.variableInsetClamped) {
          stats.edgeWearClamped += 1;
        }
      }
      if (builtStone.edgeWearFallback) {
        stats.edgeWearFallbacks += 1;
        edgeWearFallbackCount += 1;
      }
    }
    const shadedStone = applyUnitShading(
      builtStone.geometry,
      recipe,
      {
        stableIndex: placement.stableIndex,
        heightRatio: placement.heightRatio,
        protrusion: stoneShape.protrusion,
        depth: stoneShape.depth,
      },
    );
    stoneGeometries.push(applyConstructionStoneColorGrade(shadedStone, {
      styleKey: record.style.key,
      seed: record.seed,
      stableIndex: placement.stableIndex,
      category: placement.category ?? 'field',
      hasCustomStoneMaterial: Boolean(record.style?.materials?.stone),
    }));
    const mortarDescriptor = createMortarDescriptor({
      placement,
      stoneShape,
      nominalPosition: params.position,
      nominalRotation: params.rotation,
      config: mortarConfig,
    });
    if (mortarDescriptor) mortarDescriptors.push(mortarDescriptor);
  }
  stats.stoneBuildMs = performance.now() - stoneStarted;
  stats.reliefBuildMs = reliefBuildMs;
  stats.edgeWearBuildMs = edgeWearBuildMs;
  stats.appearanceDescriptorMs = appearanceDescriptorMs;
  stats.lodReductionMs = lodReductionMs;

  if (reliefFallbackCount > 0) {
    console.warn(
      `Module ${record.id} used flat-face fallback for ${reliefFallbackCount} of ${placements.length} stones.`,
    );
  }
  if (edgeWearFallbackCount > 0) {
    console.warn(
      `Module ${record.id} used edge-wear fallback for ${edgeWearFallbackCount} of ${placements.length} stones.`,
    );
  }

  // The stone material declares `vertexColors`, and a material that reads
  // vertex colours from a geometry that has none renders black. `required`
  // covers the case where nothing in this module happened to be shaded.
  harmonizeVertexColors(stoneGeometries, { required: true });

  let mergedStone = null;
  let mortarCore = null;
  let mortarMesh = null;
  let stoneMesh = null;
  try {
    mergedStone = mergeGeometries(stoneGeometries);
    if (!mergedStone) {
      return { meshes: [], stats };
    }
    mergedStone.computeBoundingBox();
    mergedStone.computeBoundingSphere();

    const mortarStarted = performance.now();
    mortarCore = buildMortarCoreGeometry(mortarDescriptors);
    stats.mortarBuildMs = performance.now() - mortarStarted;

    stats.stones = placements.length;
    stats.stoneTriangles = (mergedStone.index?.count ?? mergedStone.attributes.position.count) / 3;
    stats.mortarPrisms = mortarDescriptors.length;
    stats.mortarTriangles = mortarCore
      ? (mortarCore.index?.count ?? mortarCore.attributes.position.count) / 3
      : 0;
    stats.totalTriangles = stats.stoneTriangles + stats.mortarTriangles;
    stats.triangles = stats.totalTriangles;

    const meshes = [];
    if (mortarCore) {
      mortarMesh = new THREE.Mesh(mortarCore, materials.mortar);
      mortarMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
      mortarMesh.castShadow = false;
      mortarMesh.receiveShadow = true;
      meshes.push(mortarMesh);
      mortarCore = null;
    }

    stoneMesh = new THREE.Mesh(mergedStone, materials.stone);
    stoneMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;
    stoneMesh.userData.constructionGeometryTier = geometryTierLabel;
    stoneMesh.userData.constructionStyleKey = record.style.key;
    stoneMesh.userData.constructionLodBand = lodBand;
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    meshes.push(stoneMesh);
    mergedStone = null;
    mortarMesh = null;
    stoneMesh = null;

    return { meshes, stats };
  } catch (error) {
    mergedStone?.dispose();
    mortarCore?.dispose();
    mortarMesh?.geometry?.dispose();
    stoneMesh?.geometry?.dispose();
    throw error;
  } finally {
    for (const geometry of stoneGeometries) {
      geometry.dispose();
    }
  }
}
