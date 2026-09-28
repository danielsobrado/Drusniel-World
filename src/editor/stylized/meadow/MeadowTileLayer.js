import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createCompaction } from './meadowGrassCompaction.js';
import { MeadowGrassBatches } from './MeadowGrassBatches.js';
import { tileDistanceSquared } from './meadowGrassLayout.js';

/**
 * A camera-centred grid of chunk-aligned tiles, each drawing one band's template
 * compacted against its ground — the machinery grass-test's `GrassField` and
 * `FarGrassField` share, here shared by the meadow's blades and its far cards.
 *
 *  - Tiles are keyed by their canonical grid cell, so a tile survives the
 *    floating origin moving; only its render-space origin (and so its batch
 *    slot) is rewritten.
 *  - Builds run nearest-first until the caller's deadline, in slices of
 *    `SLICE_STEMS`, and a tile keeps drawing its previous band until the new one
 *    is ready, so nothing blinks.
 *  - One draw per band.
 *  - No garbage in steady state: a band's compaction outputs (up to ~0.5 MB each)
 *    are pooled and reused as tiles leave and rebuild. Allocating them fresh
 *    showed up as 40–230 ms collector pauses while running across the meadow.
 */
/** Stems compacted between deadline checks. */
const SLICE_STEMS = 1024;
/** Recycled outputs kept per band; past this they are left to the collector. */
const POOL_LIMIT = 24;

export class MeadowTileLayer {
  /**
   * @param {object} options
   * @param {object} options.scene
   * @param {string} options.name
   * @param {number} options.tileSize metres
   * @param {Record<string, object>} options.templates band → template
   * @param {object} options.material
   * @param {(distanceSquared: number, farthestSquared: number) => string | null} options.selectBand
   * @param {number} options.reach metres beyond which no tile is considered
   * @param {object} options.ground MeadowGroundSampler
   * @param {number} [options.renderOrder]
   */
  constructor({ scene, name, tileSize, templates, material, selectBand, reach, ground, renderOrder = 0 }) {
    this.tileSize = tileSize;
    this.templates = templates;
    this.selectBand = selectBand;
    this.reach = reach;
    this.ground = ground;
    this.batches = new MeadowGrassBatches({ scene, templates, material, name, renderOrder });
    this.tiles = new Map();
    this.pools = new Map(Object.keys(templates).map((band) => [band, []]));
    this.buildSerial = 0;
    this.stats = { tiles: 0, building: 0, stems: 0, bands: {} };
  }

  get meshes() {
    return this.batches.meshes;
  }

  /**
   * @param {{ x: number, z: number }} camera canonical metres
   * @param {{ x: number, z: number }} origin floating origin
   * @param {number} deadline performance.now() by which this frame's builds stop
   */
  update(camera, origin, deadline) {
    const size = this.tileSize;
    const reach = this.reach + size;
    const keep = new Set();
    for (let tz = Math.floor((camera.z - reach) / size); tz <= Math.floor((camera.z + reach) / size); tz += 1) {
      for (let tx = Math.floor((camera.x - reach) / size); tx <= Math.floor((camera.x + reach) / size); tx += 1) {
        const centerX = (tx + 0.5) * size;
        const centerZ = (tz + 0.5) * size;
        const nearest = tileDistanceSquared(camera.x, camera.z, centerX, centerZ, size);
        const farthest = (Math.abs(camera.x - centerX) + size / 2) ** 2 + (Math.abs(camera.z - centerZ) + size / 2) ** 2;
        const band = this.selectBand(nearest, farthest);
        if (!band) continue;
        const key = `${tx}:${tz}`;
        keep.add(key);
        let tile = this.tiles.get(key);
        if (!tile) {
          tile = { key, centerX, centerZ, output: null, buildId: 0, job: null };
          this.tiles.set(key, tile);
        }
        tile.band = band;
        tile.distanceSquared = nearest;
        tile.renderX = centerX - origin.x;
        tile.renderZ = centerZ - origin.z;
        tile.revision = this.ground.revisionAt(centerX, centerZ);
      }
    }
    for (const [key, tile] of this.tiles) {
      if (keep.has(key)) continue;
      this.release(tile.builtBand, tile.output);
      this.release(tile.job?.band, tile.job?.compaction.output);
      this.tiles.delete(key);
    }
    this.build(deadline);
    this.commit();
  }

  release(band, output) {
    const pool = this.pools.get(band);
    if (output && pool && pool.length < POOL_LIMIT) pool.push(output);
  }

  /** A tile needs a build when its ground is resident and its band or page moved on. */
  static isStale(tile) {
    return tile.revision !== null && (tile.builtBand !== tile.band || tile.builtRevision !== tile.revision);
  }

  build(deadline) {
    const stale = [];
    for (const tile of this.tiles.values()) {
      // A job started for a band or page the tile has since left is abandoned.
      if (tile.job && (tile.job.band !== tile.band || tile.job.revision !== tile.revision)) {
        this.release(tile.job.band, tile.job.compaction.output);
        tile.job = null;
      }
      if (MeadowTileLayer.isStale(tile)) stale.push(tile);
    }
    stale.sort((a, b) => a.distanceSquared - b.distanceSquared);
    let building = 0;
    let compacted = 0;
    for (const tile of stale) {
      if (performance.now() >= deadline) break;
      if (!tile.job) {
        const ground = this.ground.forTile(tile.centerX, tile.centerZ, this.tileSize / 2);
        if (!ground) continue;
        tile.job = {
          band: tile.band,
          revision: ground.revision,
          compaction: createCompaction({
            template: this.templates[tile.band],
            centerX: tile.centerX,
            centerZ: tile.centerZ,
            sample: ground.sample,
            output: this.pools.get(tile.band).pop() ?? null,
          }),
        };
      }
      const { compaction } = tile.job;
      const total = this.templates[tile.job.band].instanceCount;
      const before = compaction.progress;
      while (!compaction.done && performance.now() < deadline) compaction.advance(SLICE_STEMS);
      compacted += Math.round((compaction.progress - before) * total);
      building += 1;
      if (!compaction.done) continue;
      this.release(tile.builtBand, tile.output);
      tile.output = compaction.output;
      tile.builtBand = tile.job.band;
      tile.builtRevision = tile.job.revision;
      this.buildSerial += 1;
      tile.buildId = this.buildSerial;
      tile.job = null;
    }
    this.stats.building = building;
    PerfCounters.inc('meadowStemsCompacted', compacted);
  }

  commit() {
    this.batches.begin();
    let tiles = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.output || tile.output.count === 0) continue;
      this.batches.add(tile.builtBand, tile);
      tiles += 1;
    }
    const uploadStartedAt = performance.now();
    this.stats.bands = this.batches.commit();
    PerfCounters.inc('meadowBatchCommitMs', performance.now() - uploadStartedAt);
    this.stats.tiles = tiles;
    this.stats.stems = Object.values(this.stats.bands).reduce((sum, value) => sum + value, 0);
  }

  getState() {
    return { ...this.stats, bands: { ...this.stats.bands }, resident: this.tiles.size };
  }

  dispose() {
    this.batches.dispose();
    this.tiles.clear();
  }
}
