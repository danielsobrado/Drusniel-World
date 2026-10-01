/**
 * Azgaar burgs as settlements the terrain and renderer can plan.
 *
 * Burgs are kept on the macro world source (`baseTerrain.settlements`) in world
 * cells, beside the routes the terrain already grades, so terrain workers and
 * the main thread see the same list. Worlds imported before settlements existed
 * are backfilled from their saved campaign at load; nothing is re-imported.
 */

const FLAGS = Object.freeze(['capital', 'walls', 'citadel', 'plaza', 'temple', 'port']);

function burgCell(burg, { sourceWidth, sourceHeight, bounds }) {
  return {
    cellX: bounds.minCellX + Number(burg.x) / sourceWidth * bounds.widthCells,
    cellZ: bounds.minCellZ + Number(burg.y) / sourceHeight * bounds.heightCells,
  };
}

export function settlementsFromBurgs(burgs, frame) {
  if (!Array.isArray(burgs) || !(frame?.sourceWidth > 0) || !(frame?.sourceHeight > 0) || !frame.bounds) return [];
  return burgs.flatMap((burg) => {
    if (!burg || burg.removed || !Number.isSafeInteger(Number(burg.i)) || Number(burg.i) <= 0) return [];
    if (!Number.isFinite(Number(burg.x)) || !Number.isFinite(Number(burg.y))) return [];
    const flags = Object.fromEntries(FLAGS.map((flag) => [flag, Boolean(Number(burg[flag]) || burg[flag] === true)]));
    return [{
      id: Number(burg.i),
      name: String(burg.name ?? ''),
      ...burgCell(burg, frame),
      population: Number.isFinite(Number(burg.population)) ? Number(burg.population) : 0,
      culture: Number.isFinite(Number(burg.culture)) ? Number(burg.culture) : null,
      ...flags,
    }];
  });
}

/** From an Azgaar document at import time. */
export function createSettlementData(document, bounds) {
  return settlementsFromBurgs(document.pack?.burgs, {
    sourceWidth: Number(document.info?.width),
    sourceHeight: Number(document.info?.height),
    bounds,
  });
}

/**
 * Give a saved world's base terrain its settlements, from the campaign it was
 * imported with, when it has none. Returns the base terrain unchanged when it
 * already has them, has no campaign burgs, or settlements are disabled.
 */
export function withSettlementData(baseTerrain, campaign, { enabled = true } = {}) {
  if (!baseTerrain?.bounds) return baseTerrain;
  if (!enabled) {
    if (!baseTerrain.settlements) return baseTerrain;
    const { settlements: _settlements, ...rest } = baseTerrain;
    return rest;
  }
  if (Array.isArray(baseTerrain.settlements)) return baseTerrain;
  const settlements = settlementsFromBurgs(campaign?.burgs, {
    sourceWidth: Number(campaign?.source?.sourceWidth),
    sourceHeight: Number(campaign?.source?.sourceHeight),
    bounds: baseTerrain.bounds,
  });
  return settlements.length > 0 ? { ...baseTerrain, settlements } : baseTerrain;
}

export function validateSettlementMetadata(settlements) {
  if (settlements == null) return;
  if (!Array.isArray(settlements)) throw new Error('Azgaar macro source settlements must be an array.');
  for (const settlement of settlements) {
    if (!Number.isSafeInteger(settlement?.id) || !Number.isFinite(settlement.cellX) || !Number.isFinite(settlement.cellZ)
        || !Number.isFinite(settlement.population)) {
      throw new Error('Azgaar macro source contains invalid settlement metadata.');
    }
  }
}
