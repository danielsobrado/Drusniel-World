import { sampleTilesAround } from '../../world/sampleTilesAround.js';

/** Tundra reads as partly snow country, glacier as wholly. */
const SNOW_TILE_WEIGHT = Object.freeze({ 10: 0.6, 11: 1 });
const SAMPLE_RINGS = [0, 60, 180];
const SAMPLE_DIRECTIONS = 8;
const RESAMPLE_SECONDS = 1;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How deep in snow country the ground under the camera is, 0..1: the larger
 * of the snowy biomes around it and its height against the snow line the
 * terrain draws. Measured from the ground below the camera, so an orbit
 * camera high over a meadow is still over a meadow.
 */
export function snowCountryWeight({ tiles, groundHeight, snowLine, snowFade }) {
  let biome = 0;
  for (const tile of tiles) biome += SNOW_TILE_WEIGHT[tile] ?? 0;
  biome = tiles.length ? biome / tiles.length : 0;
  const altitude = Number.isFinite(groundHeight)
    ? smoothstep(snowLine - snowFade, snowLine + snowFade, groundHeight)
    : 0;
  return Math.max(biome, altitude);
}

export class SnowCountryWeight {
  /**
   * @param {object} options
   * @param {(cellX: number, cellZ: number) => number} options.getTile
   * @param {() => number} options.getTileSize
   * @param {() => { x: number, z: number }} options.getOrigin floating origin
   * @param {(x: number, z: number) => number} options.getGroundHeight canonical metres
   * @param {number} options.snowLine
   * @param {number} options.snowFade
   */
  constructor({ getTile, getTileSize, getOrigin, getGroundHeight, snowLine, snowFade }) {
    Object.assign(this, { getTile, getTileSize, getOrigin, getGroundHeight, snowLine, snowFade });
    this.value = 0;
    this.sinceSample = Infinity;
  }

  /** @returns {number} the current weight, resampled about once a second */
  update(dt, camera) {
    this.sinceSample += dt;
    if (this.sinceSample < RESAMPLE_SECONDS) return this.value;
    this.sinceSample = 0;
    const origin = this.getOrigin();
    const x = camera.position.x + origin.x;
    const z = camera.position.z + origin.z;
    this.value = snowCountryWeight({
      tiles: sampleTilesAround({
        getTile: this.getTile,
        tileSize: this.getTileSize(),
        x,
        z,
        rings: SAMPLE_RINGS,
        directions: SAMPLE_DIRECTIONS,
      }),
      groundHeight: this.getGroundHeight(x, z),
      snowLine: this.snowLine,
      snowFade: this.snowFade,
    });
    return this.value;
  }
}
