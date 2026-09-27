/**
 * Where a shore thing stands, by its height relative to sea level.
 *
 * `AquaticPlacement` answers this for anything that lives *in* water, off the
 * streamed water field's kind, depth and shore distance. That leaves the two bands
 * either side of the waterline, which is where the donor's shore life actually
 * is: strand debris and starfish on the sand just above the water, and the
 * groundcover inland of it. Those have no water sample to read — the field reports
 * no kind on dry ground — so they are placed off height instead, the same signal
 * the beach pebbles and the seabed boulders already use.
 *
 * Same shape as `resolveAquaticPlacementRule`/`evaluateAquaticPlacement` on
 * purpose: a layer carries a rule, a prototype may override it, and the evaluator
 * either rejects the candidate or returns the height it should be drawn at.
 */

export const STRAND_PLACEMENT_GROUND = 'ground';
export const STRAND_PLACEMENT_BED = 'bed';

const PLACEMENT_MODES = new Set([STRAND_PLACEMENT_GROUND, STRAND_PLACEMENT_BED]);

const EMPTY_RULE = Object.freeze({});

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {object} [layerRule]
 * @param {object} [prototypeRule] wins over the layer rule, per prototype
 * @returns {{placement: string, minimumAbove: number, maximumAbove: number,
 *   minimumDepth: number, maximumDepth: number}}
 */
export function resolveStrandPlacementRule(layerRule = null, prototypeRule = null) {
  const source = { ...EMPTY_RULE, ...(layerRule ?? {}), ...(prototypeRule ?? {}) };
  const placement = source.placement ?? STRAND_PLACEMENT_GROUND;
  if (!PLACEMENT_MODES.has(placement)) {
    throw new Error(`Unknown strand placement mode: ${String(placement)}.`);
  }
  // A ground rule counts upwards from the waterline; a bed rule counts downwards.
  // The defaults are a zero-width band, which is rejected below: a rule that names
  // only one side is a config mistake, and failing on it is better than silently
  // placing nothing or claiming the whole world.
  const rule = {
    placement,
    minimumAbove: finiteOr(source.minimumAbove, 0),
    maximumAbove: finiteOr(source.maximumAbove, 0),
    minimumDepth: finiteOr(source.minimumDepth, 0),
    maximumDepth: finiteOr(source.maximumDepth, 0),
  };
  if (placement === STRAND_PLACEMENT_GROUND) {
    if (rule.maximumAbove <= rule.minimumAbove) {
      throw new Error('Strand maximumAbove must exceed minimumAbove.');
    }
  } else if (rule.maximumDepth <= rule.minimumDepth) {
    throw new Error('Strand maximumDepth must exceed minimumDepth.');
  }
  return Object.freeze(rule);
}

/**
 * @param {object} options
 * @param {number} options.height canonical ground height at the candidate
 * @param {number} options.seaLevel
 * @param {object} [options.layerRule]
 * @param {object} [options.prototypeRule]
 * @returns {null|{strandPlacement: string, strandPlacementHeight: number,
 *   strandAbove: number, strandDepth: number}} null when the candidate is outside
 *   the band, which the manifest reads as a rejection.
 */
export function evaluateStrandPlacement({
  height,
  seaLevel,
  layerRule = null,
  prototypeRule = null,
}) {
  if (!Number.isFinite(height) || !Number.isFinite(seaLevel)) return null;
  const rule = resolveStrandPlacementRule(layerRule, prototypeRule);
  const above = height - seaLevel;
  const depth = -above;
  if (rule.placement === STRAND_PLACEMENT_GROUND) {
    if (above < rule.minimumAbove || above > rule.maximumAbove) return null;
  } else if (depth < rule.minimumDepth || depth > rule.maximumDepth) {
    return null;
  }
  return Object.freeze({
    strandPlacement: rule.placement,
    strandPlacementHeight: height,
    strandAbove: above,
    strandDepth: depth,
  });
}
