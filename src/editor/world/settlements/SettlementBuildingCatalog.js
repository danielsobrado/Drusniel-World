/**
 * The buildings and props a settlement plan may place, as workshop recipes.
 *
 * Each entry is a small, fixed set of variants — the building pool. A town
 * never asks for arbitrary dimensions: it picks a variant index, so a whole
 * world needs at most `styles × entries × variants` distinct meshes, and every
 * placement of one variant shares its geometry. `footprint` is the plot the
 * planner must reserve (walls plus roof overhang, wings, stairs and sheds),
 * measured before any geometry exists.
 *
 * Pure data, safe in terrain workers.
 */

const house = (variant, width, depth, height, footprint) => ({ archetype: 'house', variant, width, depth, height, footprint });
const prop = (variant, width = 2, height = 2, footprint = [1.4, 1.4]) => ({ archetype: 'prop', variant, width, depth: 1, height, footprint });
const castle = (archetype, width, depth, height, footprint, extra = {}) => ({ archetype, width, depth, height, footprint, ...extra });

export const SETTLEMENT_BUILDINGS = Object.freeze({
  house: Object.freeze([
    house('generated', 8, 6, 5.5, [11.5, 12]),
    house('generated', 10, 7, 7.5, [13.5, 13]),
    house('generated', 7, 5.5, 4.2, [10.5, 11]),
    house('generated', 9, 6.5, 6.5, [12.5, 12.5]),
    house('cottage', 9, 6, 5, [13, 17]),
  ]),
  townhouse: Object.freeze([
    house('rowhouse', 5.5, 9, 9, [7.5, 12]),
    house('townhouse', 11, 7, 10, [14, 12]),
    house('generated', 9, 7, 9.5, [12.5, 13.5]),
  ]),
  shop: Object.freeze([house('shop', 9, 7, 6.5, [12, 11.5]), house('shop', 7, 6, 5.5, [10, 10])]),
  tavern: Object.freeze([house('tavern', 7.5, 6, 4, [11, 10.5]), house('deck-tavern', 9, 6.5, 8, [13, 13])]),
  smithy: Object.freeze([house('smithy', 8, 5.5, 3.8, [11, 12])]),
  bakery: Object.freeze([house('bakery', 7, 5.5, 3.2, [11, 9])]),
  warehouse: Object.freeze([house('warehouse', 8, 10, 9, [10, 13.5])]),
  chapel: Object.freeze([house('chapel', 6.5, 11, 6, [9, 14])]),
  farmhouse: Object.freeze([house('farmhouse', 13, 6.5, 3.4, [16, 11]), house('farmhouse', 11, 6, 3, [14, 10])]),
  barn: Object.freeze([house('barn', 8, 11, 4.8, [10, 13.5])]),
  keep: Object.freeze([castle('square-tower', 9, 3, 12, [16, 16], { style: null, topStyle: 'battlements' })]),
  hall: Object.freeze([castle('manor', 12, 3, 6.5, [18, 14], { towerSide: 'left', shape: 'stepped' })]),
  wall: Object.freeze([castle('wall', 12, 1.8, 6, [12, 5], { shape: 'classic', topStyle: 'battlements', windows: false })]),
  gatehouse: Object.freeze([castle('gatehouse', 10, 3, 7, [16, 10], { topStyle: 'battlements' })]),
  tower: Object.freeze([castle('tower', 6, 2, 9, [8, 8], { topStyle: 'battlements' })]),
  well: Object.freeze([prop('well', 2, 3, [3.4, 3.4])]),
  stall: Object.freeze([prop('market-stall', 3, 2.6, [4.4, 3]), prop('market-stall', 2.5, 2.4, [3.9, 3])]),
  lantern: Object.freeze([prop('lantern-post', 2, 2.8), prop('walk-lantern', 2, 2)]),
  planter: Object.freeze([prop('planter', 1.6, 2, [2, 1])]),
  shrine: Object.freeze([prop('wayside-shrine', 2, 2.2), prop('wayside-cross', 2, 2.4, [1.6, 1.6])]),
  signpost: Object.freeze([prop('signpost', 2, 2.6)]),
  bench: Object.freeze([prop('bench', 2, 2, [2.4, 1])]),
  cart: Object.freeze([prop('cart', 2, 2, [2, 4])]),
  barrels: Object.freeze([prop('barrels', 2, 2, [2, 2.4]), prop('crates', 2, 2, [2, 2])]),
  fence: Object.freeze([prop('fence', 4, 2, [4.2, 0.6])]),
  bollards: Object.freeze([prop('bollards', 4.5, 2, [4.8, 0.6])]),
});

export function buildingEntry(kind, variantIndex) {
  const entries = SETTLEMENT_BUILDINGS[kind];
  if (!entries) throw new Error(`Unknown settlement building kind: ${kind}.`);
  return entries[variantIndex % entries.length];
}

/** Stable identity of one pooled mesh: its style, kind and variant. */
export function poolKey(styleKey, kind, variantIndex) {
  return `${styleKey}|${kind}|${variantIndex % SETTLEMENT_BUILDINGS[kind].length}`;
}

/**
 * The workshop recipe for one pooled variant, in one settlement style. Seeds
 * derive from the pool key, so the same variant is the same building in every
 * town of that style, and different variants differ.
 */
export function buildingRecipe(style, kind, variantIndex, { detail = 2, finishIndex = 0 } = {}) {
  const { footprint: _footprint, ...entry } = buildingEntry(kind, variantIndex);
  let seed = 2166136261;
  for (const character of poolKey(style.key, kind, variantIndex)) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  const castleLike = !['house', 'prop'].includes(entry.archetype);
  return {
    style: style.style,
    topStyle: castleLike ? (entry.topStyle ?? 'battlements') : style.topStyle,
    finish: style.finishes[finishIndex % style.finishes.length],
    roofScale: 1,
    roofOverhang: 0.35,
    roofPitch: 40,
    weathering: 0.35,
    irregularity: 0.45,
    windows: true,
    ivy: false,
    remesh: true,
    albedo: true,
    ...entry,
    ...(castleLike && entry.topStyle ? { topStyle: entry.topStyle } : {}),
    ...(entry.style === null ? { style: style.style } : {}),
    detail,
    seed: (seed >>> 0) & 0x7fffffff,
  };
}
