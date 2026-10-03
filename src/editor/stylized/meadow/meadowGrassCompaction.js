import { createMeadowWindVariationWriter } from './meadowWindVariation.js';

/**
 * One tile's stems, filtered to where grass grows, ported from grass-test's
 * `compactGrassGeometry`: the tile walks its band's stable stem sequence once,
 * keeps the stems the ground allows, and writes the ground's height and grass
 * strength into them. Survivors keep their original rank (`instanceData.y`), so
 * the material's band retirement still sees the ids it expects.
 *
 * Resumable: `advance` does at most `limit` stems and returns whether more
 * remain, so a tile's build spreads over frames instead of landing in one.
 *
 * `instanceData.x` carries the blade's shape id in its integer part and the path
 * mask under it in its fraction — one float instead of another vertex buffer
 * (a pipeline has eight, and the batch already uses seven). A far card carries
 * its atlas cell there instead: shape × 4 + the card's variant.
 */
/** Arrays for one tile's compacted stems at a band's full capacity. */
export function createCompactionOutput(capacity) {
  return {
    position: new Float32Array(capacity * 4),
    rotation: new Float32Array(capacity * 2),
    data: new Float32Array(capacity * 4),
    count: 0,
  };
}

/**
 * @param {object} options
 * @param {object} options.template the band's template geometry
 * @param {number} options.centerX canonical tile centre
 * @param {number} options.centerZ
 * @param {Function} options.sample MeadowGroundSampler tile sampler
 * @param {object} [options.output] a recycled createCompactionOutput() of the band's capacity
 */
export function createCompaction({ template, centerX, centerZ, sample, output: recycled = null }) {
  const source = {
    position: template.getAttribute('instancePosition').array,
    rotation: template.getAttribute('instanceRotation').array,
    data: template.getAttribute('instanceData').array,
  };
  const output = recycled ?? createCompactionOutput(template.instanceCount);
  output.count = 0;
  const ground = { height: 0, strength: 1, shape: 0, path: 0 };
  const cards = Boolean(template.userData.meadow?.cards);
  const writeWind = createMeadowWindVariationWriter(centerX, centerZ, template.userData.meadow.tileSize);
  let cursor = 0;
  const total = template.instanceCount;
  return {
    output,
    get done() {
      return cursor >= total;
    },
    get progress() {
      return total ? cursor / total : 1;
    },
    advance(limit = Infinity) {
      const end = Math.min(total, cursor + Math.max(1, Math.floor(limit)));
      for (; cursor < end; cursor += 1) {
        const p = cursor * 4;
        const localX = source.position[p];
        const localZ = source.position[p + 2];
        const rank = source.data[p + 1];
        const worldX = centerX + localX;
        const worldZ = centerZ + localZ;
        if (!sample(worldX, worldZ, rank, ground)) continue;
        const o = output.count;
        output.position[o * 4] = localX;
        output.position[o * 4 + 1] = ground.height;
        output.position[o * 4 + 2] = localZ;
        output.position[o * 4 + 3] = ground.strength;
        output.rotation[o * 2] = source.rotation[cursor * 2];
        output.rotation[o * 2 + 1] = source.rotation[cursor * 2 + 1];
        // A card's atlas cell is its silhouette's block of four plus its variant.
        output.data[o * 4] = cards
          ? ground.shape * 4 + source.data[p]
          : ground.shape + Math.min(ground.path, 0.999);
        output.data[o * 4 + 1] = rank;
        writeWind(output.data, o * 4 + 2, worldX, worldZ);
        output.count = o + 1;
      }
      return cursor < total;
    },
  };
}
