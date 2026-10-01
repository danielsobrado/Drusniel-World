import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { evaluateAquaticPlacement } from '../water/AquaticPlacement.js';
import { instanceCapacity } from './scatterMath.js';
import { buildStableChunkManifest } from './StableScatterManifest.js';
import {
  createInstancedRenderers,
  disposeInstancedRenderers,
  writeInstances,
} from './lod/StylizedLodRuntime.js';
import { InstanceAnchor } from './lod/InstanceAnchor.js';
import { extractAuthoredGroupedPrototypes } from './StylizedPrototypeBake.js';
import { acceptsStrategicDetailPlacement } from './StrategicDetailPlacement.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { createBiomePrototypeSelector } from './BiomePrototypeSelector.js';
import { evaluateStrandPlacement } from './strandPlacement.js';
import { groundDetailWindPosition } from './groundDetailWind.js';

const DETAIL_UP = new THREE.Vector3(0, 1, 0);
const DETAIL_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

function cloneDetailMaterial(source, { wind = null, height = 0 } = {}) {
  const material = source.clone();
  // Swayed with the meadow's own wave, so a tuft is not a rigid patch in a moving
  // sward (groundDetailWind.js).
  if (wind && height > 0) material.positionNode = groundDetailWindPosition(wind, height);
  if ('roughness' in material) material.roughness = Math.max(0.72, material.roughness ?? 1);
  if ('metalness' in material) material.metalness = 0;
  if (material.map?.colorSpace !== undefined) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (material.map || material.alphaMap || material.transparent) {
    material.alphaTest = Math.max(0.32, material.alphaTest ?? 0);
    material.transparent = false;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
  }
  material.needsUpdate = true;
  return material;
}

/**
 * Sparse authored accents over the procedural grass carpet and below water.
 *
 * Dense grass remains the purpose-built shared blade buffer. This layer is for
 * recognisable clover, weed, flower and reed silhouettes whose texture/material
 * parts matter at walking distance. Pack grouping, biome eligibility and scale
 * live entirely in configuration so another GLB can join without view changes.
 */
export class StylizedGroundDetailView {
  constructor({
    terrainView,
    config,
    revisionTracker,
    layerConfig,
    layerName,
    priorityChannel,
    biomeAssetPalette = null,
    regionalCharacterField = null,
    forestFieldProvider = null,
    paletteLayerId = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.layerConfig = layerConfig;
    this.layerName = layerName;
    this.paletteLayerId = paletteLayerId
      ?? (layerName === 'aquaticPlant' ? 'aquaticPlants' : 'groundDetails');
    this.priorityChannel = priorityChannel;
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.forestFieldProvider = forestFieldProvider;
    this.prototypeIndicesByAsset = new Map();
    this.prototypes = [];
    this.prototypeHeightOffsets = [];
    this.prototypePlacementRules = [];
    this.prototypeWaterRules = [];
    this.prototypeStrandRules = [];
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
    this.prototypeRevision = 0;
    this.meshes = [];
    this.manifestCache = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    // Instances are written relative to this, not in canonical metres (InstanceAnchor).
    this.instanceAnchor = new InstanceAnchor();
    this.root.name = `stylized-${layerName}`;
    terrainView.scene.add(this.root);
  }

  appendVariants(authoredVariants = []) {
    if (!this.layerConfig?.enabled || this.disposed || authoredVariants.length === 0) return;
    const firstNewPrototype = this.prototypes.length;
    for (const { scene, definition } of authoredVariants) {
      const firstIndex = this.prototypes.length;
      const extracted = extractAuthoredGroupedPrototypes(scene, {
        scale: definition.scale,
        groups: definition.prototypeGroups,
        label: `${this.layerName} variant ${definition.scene}`,
      });
      extracted.forEach((parts, groupIndex) => {
        this.prototypeHeightOffsets.push(
          definition.prototypeHeightOffsets?.[groupIndex]
            ?? definition.heightOffset
            ?? this.layerConfig.heightOffset
            ?? 0,
        );
        const placementRule = definition.prototypePlacements?.[groupIndex]
          ?? definition.placement
          ?? null;
        this.prototypePlacementRules.push(placementRule);
        this.prototypeWaterRules.push(
          definition.prototypeWater?.[groupIndex]
            ?? definition.water
            ?? (placementRule?.strategy === 'shoreline-colonies'
              ? this.layerConfig.surfaceWater
              : null),
        );
        this.prototypeStrandRules.push(null);
        this.prototypeBiomeRules.push({
          tileIds: definition.tileIds ?? null,
          weight: definition.prototypeWeights?.[groupIndex] ?? definition.weight ?? 1,
          character: definition.character ?? null,
          characterStrength: definition.characterStrength,
          canopy: definition.canopy,
        });
        this.prototypes.push(parts.map(({ geometry, source }) => {
          const sourceMaterial = materialList(source)[0];
          if (!sourceMaterial) {
            geometry.dispose();
            throw new Error(`${this.layerName} prototype contains a mesh without a material.`);
          }
          geometry.computeBoundingBox();
          return {
            geometry,
            material: cloneDetailMaterial(sourceMaterial, {
              // Water plants keep their own current-driven sway, not the air's;
              // stones (`sway: false`) keep still.
              wind: this.layerName === 'aquaticPlant' || definition.sway === false
                ? null
                : (this.config.wind ?? null),
              height: geometry.boundingBox.max.y - Math.min(0, geometry.boundingBox.min.y),
            }),
            kind: 'detail',
          };
        }));
      });
      if (extracted.length === 0) {
        throw new Error(`${this.layerName} variant ${definition.scene} produced no prototypes.`);
      }
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id ?? definition.scene,
        firstIndex,
        extracted.length,
      );
    }
    this.prototypeIndexForRoll = createBiomePrototypeSelector({
      rules: this.prototypeBiomeRules,
      regionalCharacterField: this.regionalCharacterField,
    });
    const capacity = instanceCapacity({
      residentRadius: this.layerConfig.residentRadius,
      perChunk: this.layerConfig.perChunk,
    });
    this.meshes.push(...createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.prototypes.slice(firstNewPrototype),
      capacity,
      name: `stylized-${this.layerName}-${firstNewPrototype}`,
      castShadow: this.layerConfig.castShadow === true,
    }));
    this.prototypeRevision += 1;
  }

  /**
   * Adds prototypes that are built in code rather than extracted from a GLB.
   *
   * The donor's shore life — starfish, strand debris, creeping leaves, sea grass —
   * is geometry it generates, and that is worth keeping: it costs no asset, no
   * atlas and no load, so a whole layer can be installed synchronously at boot
   * instead of streaming in through residency. Everything downstream is the same
   * machinery the authored prototypes use: the same deterministic per-chunk
   * manifest, the same spacing and biome rules, the same instanced renderers, and
   * the same rebuild path.
   *
   * A definition is: `{ id, parts, heightOffset, placement, strand, tileIds,
   * weight, character, characterStrength, canopy }`, where `parts` is a list of
   * `{ geometry, material, kind }` exactly as `appendVariants` produces. `strand`
   * is a band relative to sea level (see `strandPlacement.js`) and is what makes a
   * layer of these live on a shore rather than everywhere.
   */
  appendProceduralPrototypes(definitions = []) {
    if (!this.layerConfig?.enabled || this.disposed || definitions.length === 0) return;
    const firstNewPrototype = this.prototypes.length;
    for (const definition of definitions) {
      if (!Array.isArray(definition.parts) || definition.parts.length === 0) {
        throw new Error(`${this.layerName} prototype ${definition.id ?? '?'} has no parts.`);
      }
      this.prototypeHeightOffsets.push(
        definition.heightOffset ?? this.layerConfig.heightOffset ?? 0,
      );
      this.prototypePlacementRules.push(definition.placement ?? null);
      this.prototypeWaterRules.push(definition.water ?? null);
      this.prototypeStrandRules.push(
        definition.strand ?? this.layerConfig.strand ?? null,
      );
      this.prototypeBiomeRules.push({
        tileIds: definition.tileIds ?? null,
        weight: definition.weight ?? 1,
        character: definition.character ?? null,
        characterStrength: definition.characterStrength,
        canopy: definition.canopy,
      });
      this.prototypes.push(definition.parts.map((part) => ({
        geometry: part.geometry,
        material: part.material,
        kind: part.kind ?? 'detail',
      })));
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id,
        this.prototypes.length - 1,
        1,
      );
    }
    this.prototypeIndexForRoll = createBiomePrototypeSelector({
      rules: this.prototypeBiomeRules,
      regionalCharacterField: this.regionalCharacterField,
    });
    const capacity = instanceCapacity({
      residentRadius: this.layerConfig.residentRadius,
      perChunk: this.layerConfig.perChunk,
    });
    this.meshes.push(...createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.prototypes.slice(firstNewPrototype),
      capacity,
      name: `stylized-${this.layerName}-${firstNewPrototype}`,
      castShadow: this.layerConfig.castShadow === true,
    }));
    this.prototypeRevision += 1;
  }

  manifestForChunk(chunkX, chunkZ) {
    const forestField = this.forestFieldProvider?.();
    const key = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.layerConfig.perChunk,
      this.layerConfig.tileIds.join(','),
      JSON.stringify(this.layerConfig.densityByTile ?? null),
      JSON.stringify(this.layerConfig.water ?? null),
      JSON.stringify(this.layerConfig.surfaceWater ?? null),
      JSON.stringify(this.prototypeBiomeRules),
      JSON.stringify(this.prototypePlacementRules),
      JSON.stringify(this.prototypeWaterRules),
      JSON.stringify(this.prototypeStrandRules),
      this.regionalCharacterField?.signature ?? 'uniform-regions',
      forestField?.signature ?? 'uniform-forest',
      this.biomeAssetPalette?.revision ?? 0,
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) return cached.placements;
    const placements = buildStableChunkManifest({
      kind: this.layerName,
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize: this.terrainView.worldStore.tileSize,
      perChunk: this.layerConfig.perChunk,
      tileIds: this.layerConfig.tileIds,
      tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      prototypeCount: this.prototypes.length,
      prototypeIndexForRoll: (roll, tileId, x, z) => {
        const automaticIndex = this.prototypeIndexForRoll(
          roll,
          tileId,
          x,
          z,
          this.prototypeIndexForRoll.usesCanopy ? forestField?.sample(x, z) ?? null : null,
        );
        return this.biomeAssetPalette?.resolvePrototypeIndex({
          tileId,
          layerId: this.paletteLayerId,
          automaticIndex,
          prototypeIndicesByAsset: this.prototypeIndicesByAsset,
          roll,
        }) ?? automaticIndex;
      },
      minScale: this.layerConfig.minScale,
      maxScale: this.layerConfig.maxScale,
      radiusForScale: (scale) => this.layerConfig.radius * scale,
      priorityChannel: this.priorityChannel,
      candidateEvaluator: (candidate) => {
        if (!acceptsStrategicDetailPlacement(
          candidate,
          this.prototypePlacementRules[candidate.prototypeIndex],
          {
            tileSize: this.terrainView.worldStore.tileSize,
            tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
          },
        )) return null;

        let metadata = null;
        if (this.layerName === 'aquaticPlant') {
          const waterSample = this.terrainView.getCanonicalWater?.(candidate.x, candidate.z);
          metadata = evaluateAquaticPlacement({
            waterSample,
            layerRule: this.layerConfig.water,
            prototypeRule: this.prototypeWaterRules[candidate.prototypeIndex],
          });
          if (!metadata) return null;
        } else if (this.prototypeStrandRules[candidate.prototypeIndex]) {
          // The band either side of the waterline, which has no water sample to
          // read because the field reports no kind on dry ground.
          const strand = evaluateStrandPlacement({
            height: candidate.height,
            seaLevel: this.terrainView.worldStore?.generator?.seaLevel,
            layerRule: this.layerConfig.strand,
            prototypeRule: this.prototypeStrandRules[candidate.prototypeIndex],
          });
          if (!strand) return null;
          metadata = strand;
        }

        const tileDensity = this.layerConfig.densityByTile?.[candidate.tileId] ?? 1;
        if (tileDensity < 1 && candidate.priority >= tileDensity) return null;
        if (!this.regionalCharacterField) return metadata ?? true;
        const regionalMeadow = this.regionalCharacterField.sampleChannel(
          candidate.x,
          candidate.z,
          'meadow',
        );
        return candidate.priority < regionalMeadow
          ? { ...(metadata ?? {}), regionalMeadow }
          : null;
      },
    });
    this.manifestCache.set(cacheKey, { key, placements });
    return placements;
  }

  update() {
    if (this.disposed || this.prototypes.length === 0 || !this.terrainView.focusChunkKey) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.place(this.root, origin);
    const radius = this.layerConfig.residentRadius;
    const revisionSignature = this.revisionTracker.windowSignature(focus, radius + 1, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${
      this.biomeAssetPalette?.revision ?? 0
    }:p${this.prototypeRevision}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    this.pendingRebuild = {
      key: `${this.layerName}:${updateKey}`,
      updateKey,
      focus,
    };
  }

  applyPendingRebuild() {
    const job = this.pendingRebuild;
    if (!job) return false;
    this.pendingRebuild = null;
    this.lastUpdateKey = job.updateKey;
    this.rebuild(job.focus);
    return true;
  }

  rebuild(focus) {
    PerfCounters.inc(`${this.layerName}Rebuilds`);
    const instances = this.prototypes.map(() => []);
    const activeChunks = new Set();
    const radius = this.layerConfig.residentRadius;
    const colorVariation = Math.max(0, Number(this.layerConfig.colorVariation) || 0);
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        activeChunks.add(key);
        for (const placement of this.manifestForChunk(chunkX, chunkZ)) {
          const placementHeight = Number.isFinite(placement.waterPlacementHeight)
            ? placement.waterPlacementHeight
            : placement.height;
          instances[placement.prototypeIndex].push({
            matrix: new THREE.Matrix4().compose(
              DETAIL_SCRATCH.position.set(
                placement.x,
                placementHeight + (this.prototypeHeightOffsets[placement.prototypeIndex] ?? 0),
                placement.z,
              ),
              DETAIL_SCRATCH.quaternion.setFromAxisAngle(DETAIL_UP, placement.rotationY),
              DETAIL_SCRATCH.scale.setScalar(placement.scale),
            ),
            fade: 1,
            seed: placement.priority,
            colorVariation: 1 - colorVariation * 0.5 + placement.priority * colorVariation,
          });
        }
      }
    }
    const anchorOrigin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.follow(anchorOrigin);
    const count = writeInstances(this.meshes, instances, this.instanceAnchor);
    this.instanceAnchor.place(this.root, anchorOrigin);
    PerfCounters.set(`${this.layerName}Instances`, count);
    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key)) this.manifestCache.delete(key);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.meshes);
    for (const parts of this.prototypes) {
      for (const part of parts) {
        part.geometry?.dispose();
        part.material?.dispose();
      }
    }
    this.prototypes.length = 0;
    this.prototypeHeightOffsets.length = 0;
    this.prototypePlacementRules.length = 0;
    this.prototypeWaterRules.length = 0;
    this.prototypeStrandRules.length = 0;
    this.prototypeBiomeRules.length = 0;
    this.prototypeIndicesByAsset.clear();
    this.prototypeIndexForRoll = null;
    this.manifestCache.clear();
  }
}
