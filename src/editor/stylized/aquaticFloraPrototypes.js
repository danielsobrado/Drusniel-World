import * as THREE from 'three/webgpu';
import { AQUATIC_PLACEMENT_SURFACE } from '../water/AquaticPlacement.js';
import { WATER_KIND_LAKE, WATER_KIND_OCEAN } from '../water/WaterConstants.js';
import { createLilyPadGeometry, createRibbonPlantGeometry } from './proceduralFlora.js';
import { applyPlantSway } from './plantSway.js';

/**
 * Water plants — after grass-test's sea algae (seagrass, kelp, red tufts) and its
 * lake flora (eelgrass, waterweed, pondweed, lily pads).
 *
 * All of it is generated, so like the shore layer it costs no asset and installs at
 * boot. The placement is the donor's own rule inverted into the water field this
 * project already has: `evaluateAquaticPlacement` takes a depth band, a placement
 * mode and a set of water kinds, which is exactly the vocabulary the donor encodes
 * in its own species table — seagrass shallowest, kelp deeper, tufts scattered
 * across both, pads floating.
 *
 * Depth is the species' niche, so the bands overlap deliberately: a bed that is
 * only seagrass to 3 m and only kelp past it has a line across it. Each species
 * peaks at its own depth and thins either side, which is what the donor's clusters
 * do.
 *
 * Ribbons are authored one metre tall and scaled here, so the sway shader can read
 * the blade's height straight off its vertical coordinate. Sway amounts are the
 * donor's: 0.3 for kelp, 0.18 for seagrass, 0.1 for the algae.
 */

const KINDS = Object.freeze({
  seagrass: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 7, segments: 3, height: 1, width: 0.05, spread: 0.3, curve: 0.18 }),
    height: 0.38,
    sway: 0.18,
    color: '#3f6b34',
    depth: Object.freeze([0.6, 4]),
    kinds: Object.freeze([WATER_KIND_OCEAN, WATER_KIND_LAKE]),
  }),
  kelp: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 3, segments: 5, height: 1, width: 0.16, spread: 0.12, curve: 0.1 }),
    height: 1.5,
    sway: 0.3,
    color: '#4a5c2c',
    depth: Object.freeze([1.2, 9]),
    kinds: Object.freeze([WATER_KIND_OCEAN]),
  }),
  redAlgae: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 8, segments: 2, height: 1, width: 0.035, spread: 0.26, curve: 0.24 }),
    height: 0.2,
    sway: 0.1,
    color: '#8c3f3a',
    depth: Object.freeze([0.8, 7]),
    kinds: Object.freeze([WATER_KIND_OCEAN, WATER_KIND_LAKE]),
  }),
  eelgrass: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 6, segments: 3, height: 1, width: 0.03, spread: 0.22, curve: 0.3 }),
    height: 0.6,
    sway: 0.2,
    color: '#43682f',
    depth: Object.freeze([0.5, 5]),
    kinds: Object.freeze([WATER_KIND_LAKE]),
  }),
  waterweed: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 5, segments: 3, height: 1, width: 0.05, spread: 0.34, curve: 0.14 }),
    height: 0.85,
    sway: 0.16,
    color: '#4f7434',
    depth: Object.freeze([0.8, 7]),
    kinds: Object.freeze([WATER_KIND_LAKE]),
  }),
  pondweed: Object.freeze({
    geometry: () => createRibbonPlantGeometry({ blades: 4, segments: 4, height: 1, width: 0.08, spread: 0.4, curve: 0.1 }),
    height: 1.1,
    sway: 0.14,
    color: '#3d5f2e',
    depth: Object.freeze([1, 8]),
    kinds: Object.freeze([WATER_KIND_LAKE]),
  }),
  lilyPad: Object.freeze({
    geometry: () => createLilyPadGeometry({ segments: 12, notch: 0.32 }),
    height: 0.26,
    // A pad is not rooted, so it rides the surface and only breathes with the swell.
    sway: 0.03,
    color: '#4c7a3a',
    depth: Object.freeze([0.4, 6]),
    kinds: Object.freeze([WATER_KIND_LAKE]),
    placement: AQUATIC_PLACEMENT_SURFACE,
    // Pads gather along the bank rather than out in the middle of a lake.
    shoreDistance: Object.freeze([0, 22]),
  }),
});

export const AQUATIC_FLORA_KINDS = Object.freeze(Object.keys(KINDS));

function materialFor(kind, entry) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: entry.color ?? kind.color,
    roughness: entry.roughness ?? 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  return applyPlantSway(material, { amount: entry.sway ?? kind.sway });
}

/**
 * Turns the configured layer into prototype definitions for the aquatic view.
 *
 * @param {object} layer `stylizedSurface.aquaticPlants`
 */
export function createAquaticFloraPrototypes(layer = {}) {
  const definitions = [];
  for (const [id, entry] of Object.entries(layer.proceduralVariants ?? {})) {
    const spec = entry?.kind ?? id;
    const kind = KINDS[spec];
    if (!kind || entry?.enabled === false) continue;
    const geometry = kind.geometry();
    // Only the height is scaled: the blade's width and spread are its proportions,
    // and scaling those with it would make kelp as broad as it is tall.
    geometry.scale(1, kind.height * (entry.heightScale ?? 1), 1);
    geometry.computeBoundingSphere();
    const [minimumDepth, maximumDepth] = kind.depth;
    definitions.push({
      id,
      parts: [{
        geometry,
        material: materialFor(kind, entry),
        kind: 'detail',
      }],
      heightOffset: layer.heightOffset ?? 0,
      // The water rule the view hands to `evaluateAquaticPlacement`: niche depth,
      // which bodies it lives in, and rooted or floating.
      water: {
        placement: kind.placement ?? 'rooted',
        minimumDepth: entry.minimumDepth ?? minimumDepth,
        maximumDepth: entry.maximumDepth ?? maximumDepth,
        minimumCoverage: entry.minimumCoverage ?? 0.5,
        minimumShoreDistance: entry.minimumShoreDistance
          ?? kind.shoreDistance?.[0]
          ?? 0,
        maximumShoreDistance: entry.maximumShoreDistance
          ?? kind.shoreDistance?.[1]
          ?? Number.POSITIVE_INFINITY,
        allowedKinds: entry.allowedKinds ?? kind.kinds,
      },
      tileIds: entry.tileIds ?? null,
      weight: entry.weight ?? 1,
    });
  }
  return definitions;
}
