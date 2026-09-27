/**
 * Turning a page's full-density grass scatter into one chunk's instance buffers,
 * in one resumable pass.
 *
 * The page ships a scatter built at the world's maximum density, because any page
 * can become the camera's page. A given chunk only ever draws a prefix of each
 * cell's clumps and loses some of those to canopy suppression, so what reaches the
 * GPU is a filtered subset. That used to be two passes over two freshly allocated
 * copies — compact to the target density, then filter that — which cost about
 * 1.4 MB of garbage and two full walks of the chunk per rebuild, on the main
 * thread, inside one frame.
 *
 * This walks the source once, writes the survivors straight into the instance
 * attributes, and allocates nothing. It is also resumable: `advance` takes a group
 * budget and returns whether there is more, so a chunk's build can be spread across
 * frames instead of landing whole. That is what makes the outer grass rings
 * affordable — the measured reason the residency radius was left at one ring was
 * the per-chunk build cost, not the draw cost.
 *
 * The result is identical to the two-pass version by construction: compaction was
 * a prefix copy and suppression a per-instance test on a value the copy preserved,
 * so testing before copying or after gives the same survivors in the same order.
 * `tests/grassScatterBuild.test.js` holds that equivalence rather than assuming it.
 */
export function createGrassScatterComposer({
  scatter,
  targetClumpsPerCell,
  forestDensityAt = null,
}) {
  const sourceClumps = Number(scatter?.clumpsPerCell) || 0;
  const usable = Boolean(scatter?.base && scatter?.parameters) && sourceClumps > 0;
  // A chunk may be asked for more clumps per cell than the source holds — the
  // density only ever rises as a chunk comes closer — and a group has no clump to
  // give past the end, so the prefix stops at whichever is smaller.
  const keep = Math.max(0, Math.min(
    Number.isFinite(targetClumpsPerCell) ? Math.floor(targetClumpsPerCell) : sourceClumps,
    sourceClumps,
  ));
  const totalGroups = usable ? Math.floor(scatter.count / sourceClumps) : 0;

  let cursor = 0;
  let count = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;

  return {
    totalGroups,
    keep,
    get done() {
      return cursor >= totalGroups;
    },
    get count() {
      return count;
    },
    get minimumHeight() {
      return minimumHeight;
    },
    get maximumHeight() {
      return maximumHeight;
    },

    /**
     * Writes up to `groupBudget` source cells into the destination arrays, at the
     * instance index the last call left off. Returns true while groups remain.
     */
    advance(groupBudget, base, parameters) {
      if (this.done) return false;
      const budget = Number.isFinite(groupBudget)
        ? Math.max(1, Math.floor(groupBudget))
        : totalGroups;
      const end = Math.min(totalGroups, cursor + budget);
      const sourceBase = scatter.base;
      const sourceParameters = scatter.parameters;
      for (; cursor < end; cursor += 1) {
        const groupStart = cursor * sourceClumps;
        for (let clump = 0; clump < keep; clump += 1) {
          const source = groupStart + clump;
          const sourceBaseIndex = source * 3;
          const sourceParameterIndex = source * 4;
          if (forestDensityAt) {
            const density = forestDensityAt(
              sourceBase[sourceBaseIndex],
              sourceBase[sourceBaseIndex + 2],
            );
            if (sourceParameters[sourceParameterIndex + 3] >= density) continue;
          }
          const targetBaseIndex = count * 3;
          const targetParameterIndex = count * 4;
          const height = sourceBase[sourceBaseIndex + 1];
          base[targetBaseIndex] = sourceBase[sourceBaseIndex];
          base[targetBaseIndex + 1] = height;
          base[targetBaseIndex + 2] = sourceBase[sourceBaseIndex + 2];
          parameters[targetParameterIndex] = sourceParameters[sourceParameterIndex];
          parameters[targetParameterIndex + 1] = sourceParameters[sourceParameterIndex + 1];
          parameters[targetParameterIndex + 2] = sourceParameters[sourceParameterIndex + 2];
          parameters[targetParameterIndex + 3] = sourceParameters[sourceParameterIndex + 3];
          if (height < minimumHeight) minimumHeight = height;
          if (height > maximumHeight) maximumHeight = height;
          count += 1;
        }
      }
      return cursor < totalGroups;
    },
  };
}
