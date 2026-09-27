export function clumpsPerCell(bladesPerCell, bladesPerClump) {
  if (!Number.isInteger(bladesPerCell) || bladesPerCell < 1) {
    throw new Error('bladesPerCell must be a positive integer.');
  }
  if (!Number.isInteger(bladesPerClump) || bladesPerClump < 1) {
    throw new Error('bladesPerClump must be a positive integer.');
  }
  return Math.ceil(bladesPerCell / bladesPerClump);
}

/**
 * Triangles a blade costs at `segments` height divisions: each division above the
 * first contributes a quad, and the tip contributes one triangle. So 3 segments is
 * 5 triangles and 1 segment is a single triangle — the cheap band.
 */
export function trianglesPerBlade(segments) {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error('segments must be a positive integer.');
  }
  return segments * 2 - 1;
}

/**
 * Which blade geometry a chunk at `distance` chunks from the focus should use.
 *
 * Grass used to have one band and simply stop at `residentRadius`, which left the
 * terrain shader's faked distant cover to pick up from much further out. A cheap
 * middle band — full-shape blades near, single-triangle blades beyond — is what
 * lets real grass reach past the near ring without paying near-band cost for it.
 */
export function grassLodBand(distance, nearRadius) {
  return distance <= nearRadius ? 'near' : 'far';
}

/** Mean centre-to-centre distance between clumps at a given per-cell count. */
export function clumpSpacing(clumpsPerCellCount, tileSize) {
  const perSquareMetre = clumpsPerCellCount / (tileSize * tileSize);
  return 1 / Math.sqrt(Math.max(1e-6, perSquareMetre));
}

/**
 * Whether clumps overlap into continuous ground cover rather than reading as
 * separate tufts with bare ground between them. Meadow grass is a carpet; a field
 * of discrete pom-poms is the failure mode when blade count per clump goes up
 * without the clump footprint following it.
 *
 * `clumpRadius` is in metres and no longer depends on blade width. It used to be
 * expressed in blade-widths, because the clump's blade offsets and each blade's
 * half-width shared one local geometry that the shader scaled by the instance's
 * width — which meant a clump's footprint moved with how wide its blades were,
 * and narrowing blades to fix the ribbon silhouette would have shrunk every
 * clump by the same factor and broken the field into tufts. `createClumpGeometry`
 * now keeps the two in separate channels.
 */
export function clumpsFormCarpet(clumpRadius, clumpsPerCellCount, tileSize) {
  return clumpRadius * 2 >= clumpSpacing(clumpsPerCellCount, tileSize);
}

/**
 * Blade length fraction for a uniform roll, skewed toward the short end.
 *
 * Rolling length flat between min and max concentrates a field around "all
 * medium", which reads as a mown lawn or a crop rather than unmanaged grassland —
 * real sward is mostly short with a scattered tall minority. Raising the roll to a
 * power above 1 produces that without a branch or a second random draw.
 *
 * This mirrors what the vertex shader computes; it exists so the distribution the
 * config claims can be asserted rather than asserted-in-a-comment. Keep the two in
 * step.
 */
export function bladeLengthFraction(roll, skew = 1) {
  return Math.max(0, Math.min(1, roll)) ** skew;
}

export function densityForDistance(distance, radius, farDensity) {
  if (radius <= 0 || distance <= 0) return 1;
  const amount = Math.min(1, distance / radius);
  return 1 + (farDensity - 1) * amount;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The smooth density law the per-ring compaction is only approximating.
 *
 * `densityForDistance` takes a whole ring, so a chunk's population is one of a
 * handful of values and the boundary between two rings is a step: 100% inside,
 * 45% outside, with nothing in between. At 128 m pages that step is a visible
 * band that moves with the camera, and the residency edge is a hard ring of
 * grass appearing and disappearing.
 *
 * This is the same law evaluated in metres, so it is continuous in space, plus
 * an optional tail past the residency radius. The tail is what lets the last
 * ring thin out into the terrain shader's faked ground cover instead of ending
 * at a line, and it means a chunk arriving at the edge of residency fades in
 * rather than popping.
 */
export function grassContinuousDensity(distanceMeters, {
  radiusMeters,
  farDensity,
  fadeMeters = 0,
} = {}) {
  const reach = Math.max(1e-6, Number(radiusMeters) || 0);
  const falloff = clamp01(distanceMeters / reach);
  const density = 1 + (farDensity - 1) * falloff;
  if (!(fadeMeters > 0)) return Math.max(0, density);
  const fade = clamp01((distanceMeters - reach) / fadeMeters);
  return Math.max(0, density * (1 - fade));
}

/**
 * How much of a chunk's compacted population should still be standing.
 *
 * The compaction keeps a whole number of clumps per cell, so it can only hit the
 * smooth law `bandDensity` above or below it. This is the ratio between the two:
 * where the chunk's quantised population is the honest answer the coverage is 1
 * and nothing is retired, and where the quantised population is too dense for how
 * far the chunk actually is, the difference is retired per blade.
 *
 * Because it is a *ratio* against the population already in the buffer it cannot
 * double-count the falloff: blades x coverage is the smaller of what the chunk was
 * compacted to and the smooth law, never below either and never above the buffer.
 *
 * The correction is one-sided by construction. A chunk whose quantised population
 * came out *denser* than the law — the normal case, and the one that draws the
 * ring — is thinned down to it exactly. A chunk that came out *sparser*, which is a
 * sparse ring sitting closer to the camera than its ring implies, would need blades
 * that are not in the buffer; it keeps what it has. Every other ring closes.
 */
export function grassLodCoverage({
  distanceMeters,
  bandDensity,
  radiusMeters,
  farDensity,
  fadeMeters = 0,
}) {
  if (!(bandDensity > 0)) return 1;
  const density = grassContinuousDensity(distanceMeters, {
    radiusMeters,
    farDensity,
    fadeMeters,
  });
  return clamp01(density / bandDensity);
}

/**
 * Tuning shared with the shader, which mirrors `grassLodPresence` and
 * `grassLodWiden` in TSL. The material imports these rather than restating the
 * numbers, because the two sides drifting apart is exactly the failure this
 * system's other CPU/GPU pair (`bladeLengthFraction`) is pinned against.
 */
export const GRASS_LOD_PRESENCE_WINDOW = 0.06;
export const GRASS_LOD_WIDEN_DEFAULTS = Object.freeze({
  compensation: 1,
  maximumWiden: 1.35,
});

/**
 * Whether one blade survives its chunk's coverage, staggered by its own rank.
 *
 * A blade retires once the coverage falls past its rank, and ranks are spread
 * evenly over `[0, 1)`, so the share still standing is the coverage — but each
 * blade leaves at its own distance rather than the whole chunk snapping to a new
 * density. The window softens each blade's departure so a blade does not flicker
 * on and off while the camera drifts around the threshold; without it the fog of
 * blades appearing and disappearing one at a time is a shimmer.
 *
 * The ramp is centred on the rank rather than starting at it, so the weighted
 * share of blade standing is the coverage exactly: the window blurs which blades
 * go, not how many. That is what keeps `coverage` a statement about density.
 *
 * Two end conditions are not symmetric and both matter. At coverage 1 the blades
 * in the top half of the window are still part-way out, which is invisible but
 * means this can never promise "all blades whole" — the tests below hold the
 * weaker, true guarantee. At coverage 0 the tail ramp would leave the lowest
 * ranks at half width forever, so it is multiplied by a term that closes the
 * field off exactly as the coverage reaches zero.
 *
 * `rank` must come from data both LOD bands already carry, so a chunk crossing
 * the band boundary retires exactly the same blades in either band and the seam
 * cannot show as a density step.
 */
export function grassLodPresence(rank, coverage, window = GRASS_LOD_PRESENCE_WINDOW) {
  const half = Math.max(1e-4, window);
  const passing = clamp01(coverage);
  const ramp = clamp01((passing - clamp01(rank)) / half + 0.5);
  return ramp * clamp01(passing / half);
}

/**
 * How much the surviving blades widen to keep the carpet reading full.
 *
 * Thinning alone drops apparent coverage with the count, which reads as the field
 * going bald rather than receding. Widening the survivors by the share already
 * retired holds the opacity. It is capped because a blade is a strip: the donor
 * measured a shape at ~1.35x its baseline half-width before the extra fill began
 * costing more than the instance it replaced.
 */
export function grassLodWiden(
  coverage,
  { compensation = GRASS_LOD_WIDEN_DEFAULTS.compensation, maximumWiden = GRASS_LOD_WIDEN_DEFAULTS.maximumWiden } = {},
) {
  const widen = Math.min(Math.max(1, maximumWiden), 1 / Math.max(coverage, 1e-3));
  return 1 + (widen - 1) * clamp01(compensation);
}

/**
 * The tile a chunk mostly grows its grass on, so a biome can choose the
 * silhouette that chunk wears.
 *
 * A chunk is 64 cells across and a biome boundary crosses it for free, so
 * "the biome of this chunk" only means anything as a majority vote. Ties go to
 * the lower tile id so the answer does not depend on scan order.
 */
export function dominantEligibleTile(tiles, tileIds) {
  const eligible = tileIds instanceof Set ? tileIds : new Set(tileIds);
  const counts = new Map();
  let dominant = null;
  let best = 0;
  for (const tile of tiles) {
    if (!eligible.has(tile)) continue;
    const count = (counts.get(tile) ?? 0) + 1;
    counts.set(tile, count);
    if (count > best || (count === best && dominant !== null && tile < dominant)) {
      best = count;
      dominant = tile;
    }
  }
  return dominant;
}

export function grassInstanceAttributeBytes({
  chunkSize,
  bladesPerCell,
  bladesPerClump,
  floatsPerInstance = 7,
}) {
  return chunkSize * chunkSize
    * clumpsPerCell(bladesPerCell, bladesPerClump)
    * floatsPerInstance
    * Float32Array.BYTES_PER_ELEMENT;
}
