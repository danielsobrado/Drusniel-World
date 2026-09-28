import { rockSignatureForChunk, rocksInfluencingChunk } from '../chunkRockSignature.js';
import { createForestDensitySampler } from '../forest/ForestFloor.js';
import { sampleHeight } from '../scatterMath.js';
import { hash2d } from './meadowGrassGeometry.js';

/** Surface mask channels, as the terrain page bakes them (see SurfaceMaskNodes.js). */
const CLASSIFICATION = 0.5;
/** Below this strength a stem is not worth drawing: compaction drops it. */
export const MIN_GRASS_STRENGTH = 0.02;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Bilinear read of one RGBA channel at continuous cell coordinates (cell centres at +0.5). */
function sampleMask(pixels, chunkSize, localX, localZ, channel) {
  const u = Math.max(0, Math.min(chunkSize - 1, localX - 0.5));
  const v = Math.max(0, Math.min(chunkSize - 1, localZ - 0.5));
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const x1 = Math.min(chunkSize - 1, x0 + 1);
  const z1 = Math.min(chunkSize - 1, z0 + 1);
  const tx = u - x0;
  const tz = v - z0;
  const at = (x, z) => pixels[(z * chunkSize + x) * 4 + channel];
  const north = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * tx;
  const south = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * tx;
  return (north + (south - north) * tz) / 255;
}

/**
 * The ground under the meadow grass: height, whether grass grows, and which
 * silhouette it wears, read from the terrain pages already resident in the
 * terrain view — never from the generator, which would stall a frame.
 *
 * A meadow tile is chunk-aligned, so `forTile` resolves its page once and the
 * returned sampler answers every stem of the tile against that one page.
 */
export class MeadowGroundSampler {
  /**
   * @param {object} options
   * @param {object} options.terrainView InfiniteTerrainView (slots, worldStore)
   * @param {Iterable<number>} options.tileIds biomes grass grows on
   * @param {Uint8Array} options.shapeTable shape id per tile id
   * @param {() => object | null} [options.forestFieldProvider]
   * @param {object} [options.forestFloorConfig] trees.forestFloor
   * @param {() => object[]} [options.rockPlacementsProvider] canonical rock placements
   * @param {{ radius: number, falloff: number, flatten: number }} [options.rocks] config.rocks
   */
  constructor({
    terrainView, tileIds, shapeTable, forestFieldProvider = () => null, forestFloorConfig = null,
    rockPlacementsProvider = () => [], rocks = null,
  }) {
    this.terrainView = terrainView;
    this.eligible = new Uint8Array(256);
    for (const id of tileIds) this.eligible[id] = 1;
    this.shapeTable = shapeTable;
    this.forestFieldProvider = forestFieldProvider;
    this.forestFloorConfig = forestFloorConfig;
    this.forestSamplers = new Map();
    this.rockPlacementsProvider = rockPlacementsProvider;
    this.rocks = rocks;
    this.rockPlacements = [];
  }

  get chunkSize() {
    return this.terrainView.worldStore.chunkSize;
  }

  get tileSize() {
    return this.terrainView.worldStore.tileSize;
  }

  get chunkWorldSize() {
    return this.chunkSize * this.tileSize;
  }

  /** Indexes the resident slots by chunk; call once a frame before `forTile`. */
  beginFrame() {
    this.rockPlacements = this.rocks ? (this.rockPlacementsProvider?.() ?? []) : [];
    this.slotsByChunk ??= new Map();
    this.slotsByChunk.clear();
    for (const slot of this.terrainView.slots) {
      const descriptor = slot.descriptor;
      if (descriptor && slot.page && !slot.loading) this.slotsByChunk.set(`${descriptor.chunkX}:${descriptor.chunkZ}`, slot);
    }
  }

  /** The resident slot holding a chunk, with a committed page; null while it streams. */
  slotFor(chunkX, chunkZ) {
    if (!this.slotsByChunk) this.beginFrame();
    return this.slotsByChunk.get(`${chunkX}:${chunkZ}`) ?? null;
  }

  /**
   * What a tile at this canonical centre would build from — its page revision and
   * the rocks standing in its chunk — or null while the chunk streams. A rock set
   * that changes elsewhere leaves this tile's revision, and so its stems, alone.
   */
  revisionAt(centerX, centerZ) {
    const slot = this.slotFor(...this.chunkOf(centerX, centerZ));
    if (!slot) return null;
    return `${slot.descriptor.key}:${slot.pageRevision}:${this.rockSignature(slot.descriptor)}`;
  }

  rockSignature(descriptor) {
    if (!this.rocks || this.rockPlacements.length === 0) return '';
    return rockSignatureForChunk({
      descriptor,
      rockPlacements: this.rockPlacements,
      chunkWorldSize: this.chunkWorldSize,
      radius: this.rocks.radius,
      falloff: this.rocks.falloff,
    });
  }

  /** Rocks close enough to touch a tile, with their reach squared, for the stem loop. */
  rocksNear(descriptor, centerX, centerZ, tileHalf) {
    if (!this.rocks || this.rockPlacements.length === 0) return [];
    const local = rocksInfluencingChunk({
      descriptor,
      rockPlacements: this.rockPlacements,
      chunkWorldSize: this.chunkWorldSize,
      radius: this.rocks.radius,
      falloff: this.rocks.falloff,
    });
    const near = [];
    for (const rock of local) {
      const radius = rock.radius ?? this.rocks.radius;
      const reach = radius + this.rocks.falloff;
      if (Math.abs(rock.x - centerX) > tileHalf + reach || Math.abs(rock.z - centerZ) > tileHalf + reach) continue;
      near.push({ x: rock.x, z: rock.z, radius, reach });
    }
    return near;
  }

  chunkOf(centerX, centerZ) {
    return [
      Math.floor(Math.floor(centerX / this.tileSize) / this.chunkSize),
      Math.floor(Math.floor(-centerZ / this.tileSize) / this.chunkSize),
    ];
  }

  forestSampler(slot) {
    const field = this.forestFieldProvider?.() ?? null;
    if (!field) return null;
    const key = `${slot.descriptor.key}:${slot.pageRevision}`;
    const cached = this.forestSamplers.get(key);
    if (cached && cached.field === field) return cached.sampler;
    if (this.forestSamplers.size > 64) this.forestSamplers.clear();
    const sampler = createForestDensitySampler({
      descriptor: slot.descriptor,
      field,
      kind: 'grass',
      config: this.forestFloorConfig,
      chunkWorldSize: this.chunkWorldSize,
    });
    this.forestSamplers.set(key, { field, sampler });
    return sampler;
  }

  /**
   * A sampler for the tile centred on a canonical point, or null while its
   * chunk is not resident. The sampler reads canonical metres and writes into
   * `out`: { height, strength, shape, path }; it returns false where no grass
   * grows.
   */
  forTile(centerX, centerZ, tileHalf = 4) {
    const tileSize = this.tileSize;
    const chunkSize = this.chunkSize;
    const slot = this.slotFor(...this.chunkOf(centerX, centerZ));
    if (!slot) return null;
    const page = slot.page;
    const descriptor = slot.descriptor;
    const mask = page.surfaceMaskPixels;
    const forest = this.forestSampler(slot);
    const { eligible, shapeTable } = this;
    // Only the rocks that can reach this tile are tested per stem.
    const rocks = this.rocksNear(descriptor, centerX, centerZ, tileHalf);
    const flatten = this.rocks?.flatten ?? 0;
    const sample = (x, z, rank, out) => {
      const localX = x / tileSize - descriptor.originCellX;
      const localZ = -z / tileSize - descriptor.originCellZ;
      if (localX < 0 || localZ < 0 || localX >= chunkSize || localZ >= chunkSize) return false;
      const tile = page.tiles[Math.floor(localZ) * chunkSize + Math.floor(localX)];
      if (!eligible[tile]) return false;
      let strength = 1;
      let path = 0;
      if (mask) {
        if (sampleMask(mask, chunkSize, localX, localZ, 1) < CLASSIFICATION) return false;
        strength = 1 - smoothstep(0.15, 0.6, sampleMask(mask, chunkSize, localX, localZ, 2));
        path = sampleMask(mask, chunkSize, localX, localZ, 0);
      }
      // Canopy suppression, as the clump scatter did it: a stem survives where its
      // own roll is under the forest floor's grass density.
      if (forest && hash2d(rank, 91) >= forest(x - descriptor.centerWorldX, z - descriptor.centerWorldZ)) return false;
      // Nothing grows under a rock; round its foot the stand is pressed flatter.
      for (const rock of rocks) {
        const distance = Math.hypot(x - rock.x, z - rock.z);
        if (distance < rock.radius) return false;
        if (distance < rock.reach) {
          strength *= 1 - flatten * (1 - smoothstep(rock.radius, rock.reach, distance));
        }
      }
      if (strength < MIN_GRASS_STRENGTH) return false;
      out.height = sampleHeight(page, localX, localZ, chunkSize);
      out.strength = strength;
      out.shape = shapeTable[tile];
      out.path = path;
      return true;
    };
    // The same key `revisionAt` gives the tile, rocks included: a job whose
    // revision differs from its tile's is abandoned, so a mismatch here would
    // restart every build every frame.
    return { sample, revision: `${descriptor.key}:${slot.pageRevision}:${this.rockSignature(descriptor)}` };
  }
}
