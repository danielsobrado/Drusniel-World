import { getWorkshopVariant } from '../ProceduralWorkshopArchetypeCatalog.js';
import { centreOnFootprint, HouseKit } from '../village/HouseKit.js';
import { buildCart } from './CartProp.js';
import { buildChest } from './ChestProp.js';
import { buildLanternPost, buildWallLantern } from './LanternProps.js';
import { buildBarrels, buildCrates, buildMarketStall } from './MarketProps.js';
import { buildBench, buildFence, buildSignpost } from './StreetProps.js';
import { buildBollards, buildPlanter } from './WalkwayEdging.js';
import { buildStoneLantern, buildTorchPost, buildWalkLantern } from './WalkwayLights.js';
import {
  buildCairn,
  buildMilestone,
  buildTotem,
  buildWaysideCross,
  buildWaysideShrine,
} from './WalkwayMarkers.js';
import { buildWell } from './WellProp.js';

const BUILDERS = Object.freeze({
  'lantern-post': buildLanternPost,
  'wall-lantern': buildWallLantern,
  well: buildWell,
  'market-stall': buildMarketStall,
  cart: buildCart,
  barrels: buildBarrels,
  crates: buildCrates,
  bench: buildBench,
  signpost: buildSignpost,
  fence: buildFence,
  chest: buildChest,
  'walk-lantern': buildWalkLantern,
  'stone-lantern': buildStoneLantern,
  'torch-post': buildTorchPost,
  totem: buildTotem,
  'wayside-shrine': buildWaysideShrine,
  'wayside-cross': buildWaysideCross,
  milestone: buildMilestone,
  cairn: buildCairn,
  planter: buildPlanter,
  bollards: buildBollards,
});

/**
 * Generate a village prop into the medieval pipeline's material sets.
 *
 * A prop is one structure component: it moves, rotates and takes material
 * overrides as a whole, and has no editable openings.
 */
export function buildVillageProp(recipe, sets) {
  const build = BUILDERS[recipe.variant];
  const variant = getWorkshopVariant('prop', recipe.variant);
  if (!build || !variant) throw new Error(`Unknown village prop variant: ${recipe.variant}.`);
  const kit = new HouseKit(recipe, sets);
  kit.within(Object.freeze({
    id: 'structure-main',
    label: variant.label,
    type: 'planar',
    width: recipe.width,
    height: recipe.height,
  }), () => build(kit, recipe));
  centreOnFootprint(sets);
  return sets;
}

/** Props are small; the largest (a wide well or a tiled stall) stays well under this. */
export function estimateVillagePropParts() {
  return 400;
}
