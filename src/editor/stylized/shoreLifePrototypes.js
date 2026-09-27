import * as THREE from 'three/webgpu';
import { STRAND_PLACEMENT_GROUND } from './strandPlacement.js';
import {
  createDriftwoodGeometry,
  createLeafGeometry,
  createShellGeometry,
  createStarfishGeometry,
} from './proceduralFlora.js';

/**
 * The shore-life layer's prototypes — after grass-test's beach scatter, its
 * starfish and its creeping coastal groundcover.
 *
 * One kind per donor feature, each shape coming from `proceduralFlora.js` and its
 * material built here rather than extracted from an asset. The band each one
 * occupies is what matters: all of these are placed against an authored coastline
 * in the donor, and the equivalent here is a band of metres above sea level, which
 * is what `strand` carries.
 *
 * Each shape is built at its *natural size* — a 12 cm starfish, a 6 cm shell, a
 * 1.6 m twig — and the layer's scale band is then only variation around that,
 * because the ground-detail manifest carries one scale range for a whole layer and
 * not one per prototype. Sizing at build time is also what lets a starfish and a
 * driftwood log share a layer without the log inheriting the starfish's scale.
 *
 * Materials are deliberately plain: a colour, a roughness, and two-sided where the
 * shape is a single surface seen from either side. Nothing here reads the scene,
 * the depth buffer or a viewport texture, so a shore costs no rule at any quality.
 */

const KINDS = Object.freeze({
  starfish: Object.freeze({
    // Radius 1 in the factory; 12 cm is the donor's near-instance size.
    geometry: () => createStarfishGeometry(),
    size: 0.12,
    material: (definition) => new THREE.MeshStandardNodeMaterial({
      color: definition.color ?? '#c4553a',
      roughness: definition.roughness ?? 0.72,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    // Loose on the damp sand, not up in the dry.
    band: Object.freeze([0.05, 1.4]),
  }),
  shell: Object.freeze({
    geometry: () => createShellGeometry({ segments: 8, dome: 0.3 }),
    size: 0.06,
    material: (definition) => new THREE.MeshStandardNodeMaterial({
      color: definition.color ?? '#c9bea2',
      roughness: definition.roughness ?? 0.86,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    band: Object.freeze([0.02, 1.8]),
  }),
  driftwood: Object.freeze({
    geometry: () => createDriftwoodGeometry({ length: 1.6, radius: 0.05, bend: 0.18 }),
    size: 1,
    material: (definition) => new THREE.MeshStandardNodeMaterial({
      color: definition.color ?? '#7b674d',
      roughness: definition.roughness ?? 0.94,
      metalness: 0,
    }),
    // The strand line, which is the top of the swash rather than the waterline.
    band: Object.freeze([0.1, 2.4]),
  }),
  groundcover: Object.freeze({
    geometry: () => createLeafGeometry({ length: 0.5, width: 0.32 }),
    size: 1,
    material: (definition) => new THREE.MeshStandardNodeMaterial({
      color: definition.color ?? '#667957',
      roughness: definition.roughness ?? 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    // Inland of the beach: the donor's creeping leaves start past the sand and
    // thin out before the grass takes over for good.
    band: Object.freeze([1.4, 26]),
  }),
});

export const SHORE_LIFE_KINDS = Object.freeze(Object.keys(KINDS));

/**
 * Turns the configured layer into prototype definitions.
 *
 * A kind the builders do not know is skipped rather than thrown on: a config naming
 * a species this build does not carry should leave the rest of the shore standing,
 * the same way a missing blade-profile manifest still leaves a field of grass.
 *
 * @param {object} layer `stylizedSurface.shoreLife`
 */
export function createShoreLifePrototypes(layer = {}) {
  const definitions = [];
  for (const [id, entry] of Object.entries(layer.variants ?? {})) {
    const kind = entry?.kind ?? id;
    const builder = KINDS[kind];
    if (!builder || entry.enabled === false) continue;
    const geometry = builder.geometry();
    if (builder.size !== 1) geometry.scale(builder.size, builder.size, builder.size);
    geometry.computeBoundingSphere();
    definitions.push({
      id,
      parts: [{
        geometry,
        material: builder.material(entry),
        kind: 'detail',
      }],
      heightOffset: entry.heightOffset ?? layer.heightOffset ?? 0,
      // The layer owns the band; a variant narrows it, which is how one layer
      // carries species that live at different heights on the same beach.
      strand: {
        placement: STRAND_PLACEMENT_GROUND,
        minimumAbove: entry.minimumAbove ?? builder.band[0],
        maximumAbove: entry.maximumAbove ?? builder.band[1],
      },
      tileIds: entry.tileIds ?? null,
      weight: entry.weight ?? 1,
    });
  }
  return definitions;
}
