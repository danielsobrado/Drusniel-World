import { createRiverFallSiteSource } from '../water/RiverFallSites.js';

/**
 * The river data a chunk's riverbank rocks are drawn from: the channel
 * segments that can cross it and the falls near it, for whatever world is
 * loaded. `signature` changes with the world, so cached rock manifests from a
 * previous world are never reused.
 */
export class RiverRockSource {
  constructor(getGenerator) {
    this.getGenerator = getGenerator;
    this.fallSites = createRiverFallSiteSource(getGenerator);
    this.generator = undefined;
    this.revision = 0;
  }

  sync() {
    const generator = this.getGenerator();
    if (generator !== this.generator) {
      this.generator = generator;
      this.revision += 1;
    }
    return generator?.waterTerrainModel?.riverChannel ?? null;
  }

  get signature() {
    this.sync();
    return `rivers-${this.revision}`;
  }

  /** Segments and falls for one chunk, or null where there are no rivers. */
  forChunk(chunkX, chunkZ, chunkSize, tileSize) {
    const channel = this.sync();
    if (!channel) return null;
    const segments = new Set();
    const block = channel.blockSize;
    const minX = chunkX * chunkSize;
    const minZ = chunkZ * chunkSize;
    for (let cellZ = minZ; cellZ < minZ + chunkSize; cellZ += block) {
      for (let cellX = minX; cellX < minX + chunkSize; cellX += block) {
        for (const segment of channel.candidates(cellX, cellZ)) segments.add(segment);
      }
    }
    const index = this.fallSites();
    const centerX = (minX + chunkSize * 0.5) * tileSize;
    const centerZ = -(minZ + chunkSize * 0.5) * tileSize;
    const falls = index ? index.near(centerX, centerZ, chunkSize * tileSize) : [];
    if (segments.size === 0 && falls.length === 0) return null;
    return { segments: [...segments], falls };
  }
}
