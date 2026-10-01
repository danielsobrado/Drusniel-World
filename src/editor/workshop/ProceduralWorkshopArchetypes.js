import { buildVillageProp, estimateVillagePropParts } from './props/PropGenerator.js';
import { buildVillageHouse, estimateVillageHouseParts } from './village/HouseGenerator.js';

/**
 * Generators for the variant-bearing archetypes (see
 * `ProceduralWorkshopArchetypeCatalog`). Each fills the medieval pipeline's
 * material sets, so they share its materials, remeshing, component editing,
 * LOD tiers and bake path without a parallel pipeline.
 */
const GENERATORS = Object.freeze({
  house: Object.freeze({ build: buildVillageHouse, estimate: estimateVillageHouseParts }),
  prop: Object.freeze({ build: buildVillageProp, estimate: estimateVillagePropParts }),
});

export function hasArchetypeGenerator(archetype) {
  return Object.hasOwn(GENERATORS, archetype);
}

export function buildArchetypeSets(recipe, sets) {
  return GENERATORS[recipe.archetype].build(recipe, sets);
}

export function estimateArchetypeParts(recipe) {
  return GENERATORS[recipe.archetype].estimate(recipe);
}
