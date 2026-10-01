/**
 * Variant-bearing workshop archetypes.
 *
 * The original archetypes (wall, gatehouse, towers, manor) are one shape each,
 * steered by the shared recipe fields. Village houses and props are families:
 * a recipe picks one design with `variant`, and the shared fields scale it.
 *
 * Pure data with no three.js import, so the recipe store, the workshop form and
 * the placement catalogue can all read it without pulling in a generator.
 *
 * `defaults` are what the workshop form applies when the variant is chosen;
 * they must satisfy `normalizeProceduralRecipe`. For props, `uses` lists the
 * recipe fields beyond stone style, detail and seed that the variant actually
 * reads, so the form can hide the rest. Houses read every building field.
 */

const HOUSE_VARIANTS = Object.freeze([
  Object.freeze({
    id: 'cottage',
    group: 'Village',
    label: 'L-shaped cottage',
    icon: '🏠',
    defaults: Object.freeze({ label: 'Village Cottage', width: 9, depth: 6, height: 5, topStyle: 'terracotta', finish: 'limewash', style: 'limestone' }),
  }),
  Object.freeze({
    id: 'tavern',
    group: 'Village',
    label: 'Jettied tavern',
    icon: '🍺',
    defaults: Object.freeze({ label: 'Village Tavern', width: 7.5, depth: 6, height: 4, topStyle: 'terracotta', finish: 'ochre', style: 'granite' }),
  }),
  Object.freeze({
    id: 'smithy',
    group: 'Farm & trade',
    label: 'Smithy with forge shed',
    icon: '⚒️',
    defaults: Object.freeze({ label: 'Village Smithy', width: 8, depth: 5.5, height: 3.8, topStyle: 'slate', finish: 'ochre', style: 'granite' }),
  }),
  Object.freeze({
    id: 'townhouse',
    group: 'Town',
    label: 'Tall jettied town house',
    icon: '🏘️',
    defaults: Object.freeze({ label: 'Town House', width: 11, depth: 7, height: 10, topStyle: 'terracotta', finish: 'rose', style: 'granite' }),
  }),
  Object.freeze({
    id: 'deck-tavern',
    group: 'Village',
    label: 'Tavern on a plank deck',
    icon: '🛖',
    defaults: Object.freeze({ label: 'Deck Tavern', width: 9, depth: 6.5, height: 8, topStyle: 'slate', finish: 'masonry', style: 'granite' }),
  }),
  Object.freeze({
    id: 'generated',
    group: 'Generated',
    label: 'Generated house (reroll the seed)',
    icon: '🎲',
    defaults: Object.freeze({ label: 'Village House', width: 9, depth: 6, height: 6, topStyle: 'terracotta', finish: 'limewash', style: 'limestone' }),
  }),
  Object.freeze({
    id: 'rowhouse',
    group: 'Town',
    label: 'Terraced row house',
    icon: '🏘️',
    defaults: Object.freeze({ label: 'Row House', width: 5.5, depth: 9, height: 9, topStyle: 'terracotta', finish: 'ochre', style: 'sandstone' }),
  }),
  Object.freeze({
    id: 'shop',
    group: 'Town',
    label: 'Merchant shop',
    icon: '🏪',
    defaults: Object.freeze({ label: 'Merchant Shop', width: 9, depth: 7, height: 6.5, topStyle: 'slate', finish: 'limewash', style: 'limestone' }),
  }),
  Object.freeze({
    id: 'warehouse',
    group: 'Town',
    label: 'Warehouse with hoist',
    icon: '🏭',
    defaults: Object.freeze({ label: 'Warehouse', width: 8, depth: 10, height: 9, topStyle: 'slate', finish: 'masonry', style: 'granite' }),
  }),
  Object.freeze({
    id: 'farmhouse',
    group: 'Farm & trade',
    label: 'Longhouse farm',
    icon: '🌾',
    defaults: Object.freeze({ label: 'Longhouse', width: 13, depth: 6.5, height: 3.4, topStyle: 'slate', finish: 'limewash', style: 'granite' }),
  }),
  Object.freeze({
    id: 'barn',
    group: 'Farm & trade',
    label: 'Timber barn',
    icon: '🐄',
    defaults: Object.freeze({ label: 'Barn', width: 8, depth: 11, height: 4.8, topStyle: 'slate', finish: 'masonry', style: 'granite' }),
  }),
  Object.freeze({
    id: 'bakery',
    group: 'Farm & trade',
    label: 'Bakery with bread oven',
    icon: '🍞',
    defaults: Object.freeze({ label: 'Bakery', width: 7, depth: 5.5, height: 3.2, topStyle: 'terracotta', finish: 'limewash', style: 'sandstone' }),
  }),
  Object.freeze({
    id: 'chapel',
    group: 'Civic',
    label: 'Village chapel',
    icon: '⛪',
    defaults: Object.freeze({ label: 'Chapel', width: 6.5, depth: 11, height: 6, topStyle: 'slate', finish: 'masonry', style: 'limestone' }),
  }),
]);

const PROP_VARIANTS = Object.freeze([
  Object.freeze({
    id: 'walk-lantern',
    group: 'Walkway',
    label: 'Walk lantern',
    icon: '🏮',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Walk Lantern', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'stone-lantern',
    group: 'Walkway',
    label: 'Stone lantern',
    icon: '🗿',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Stone Lantern', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'torch-post',
    group: 'Walkway',
    label: 'Torch post',
    icon: '🔥',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Torch Post', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'totem',
    group: 'Walkway',
    label: 'Carved totem',
    icon: '🪵',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Totem', width: 2, depth: 1, height: 3.2 }),
  }),
  Object.freeze({
    id: 'wayside-shrine',
    group: 'Walkway',
    label: 'Adoration post',
    icon: '⛩️',
    uses: Object.freeze(['height', 'topStyle']),
    defaults: Object.freeze({ label: 'Adoration Post', width: 2, depth: 1, height: 2.2, topStyle: 'slate' }),
  }),
  Object.freeze({
    id: 'wayside-cross',
    group: 'Walkway',
    label: 'Wayside cross',
    icon: '✝️',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Wayside Cross', width: 2, depth: 1, height: 2.4 }),
  }),
  Object.freeze({
    id: 'milestone',
    group: 'Walkway',
    label: 'Milestone',
    icon: '🪨',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Milestone', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'cairn',
    group: 'Walkway',
    label: 'Cairn',
    icon: '🪨',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Cairn', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'planter',
    group: 'Walkway',
    label: 'Flower planter',
    icon: '🌷',
    uses: Object.freeze(['width']),
    defaults: Object.freeze({ label: 'Flower Planter', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'bollards',
    group: 'Walkway',
    label: 'Chained bollards',
    icon: '⛓️',
    uses: Object.freeze(['width']),
    defaults: Object.freeze({ label: 'Bollards', width: 4, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'lantern-post',
    group: 'Street',
    label: 'Lantern post',
    icon: '🏮',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Lantern Post', width: 2, depth: 1, height: 2.8 }),
  }),
  Object.freeze({
    id: 'wall-lantern',
    group: 'Street',
    label: 'Wall lantern',
    icon: '🕯️',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Wall Lantern', width: 2, depth: 1, height: 2.2 }),
  }),
  Object.freeze({
    id: 'well',
    group: 'Market & yard',
    label: 'Roofed well',
    icon: '🪣',
    uses: Object.freeze(['width', 'topStyle']),
    defaults: Object.freeze({ label: 'Village Well', width: 2, depth: 1, height: 3, topStyle: 'terracotta' }),
  }),
  Object.freeze({
    id: 'market-stall',
    group: 'Market & yard',
    label: 'Market stall',
    icon: '⛺',
    uses: Object.freeze(['width', 'height', 'topStyle']),
    defaults: Object.freeze({ label: 'Market Stall', width: 3, depth: 1, height: 2.6 }),
  }),
  Object.freeze({
    id: 'cart',
    group: 'Market & yard',
    label: 'Hand cart',
    icon: '🛒',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Hand Cart', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'barrels',
    group: 'Market & yard',
    label: 'Barrel cluster',
    icon: '🛢️',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Barrels', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'crates',
    group: 'Market & yard',
    label: 'Crate stack',
    icon: '📦',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Crates', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'bench',
    group: 'Street',
    label: 'Bench',
    icon: '🪑',
    uses: Object.freeze(['width']),
    defaults: Object.freeze({ label: 'Bench', width: 2, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'signpost',
    group: 'Street',
    label: 'Signpost',
    icon: '🪧',
    uses: Object.freeze(['height']),
    defaults: Object.freeze({ label: 'Signpost', width: 2, depth: 1, height: 2.6 }),
  }),
  Object.freeze({
    id: 'fence',
    group: 'Street',
    label: 'Rail fence',
    icon: '🚧',
    uses: Object.freeze(['width']),
    defaults: Object.freeze({ label: 'Rail Fence', width: 4, depth: 1, height: 2 }),
  }),
  Object.freeze({
    id: 'chest',
    group: 'Market & yard',
    label: 'Iron-bound chest',
    icon: '🧰',
    uses: Object.freeze([]),
    defaults: Object.freeze({ label: 'Chest', width: 2, depth: 1, height: 2 }),
  }),
]);

export const WORKSHOP_VARIANT_ARCHETYPES = Object.freeze({
  house: Object.freeze({ label: 'Village house', defaultVariant: 'cottage', variants: HOUSE_VARIANTS }),
  prop: Object.freeze({ label: 'Village prop', defaultVariant: 'lantern-post', variants: PROP_VARIANTS }),
});

export function isVariantArchetype(archetype) {
  return Object.hasOwn(WORKSHOP_VARIANT_ARCHETYPES, archetype);
}

export function getWorkshopVariant(archetype, variantId) {
  return WORKSHOP_VARIANT_ARCHETYPES[archetype]?.variants.find(({ id }) => id === variantId) ?? null;
}

export function defaultWorkshopVariant(archetype) {
  return WORKSHOP_VARIANT_ARCHETYPES[archetype]?.defaultVariant ?? null;
}
