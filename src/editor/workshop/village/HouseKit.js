import * as THREE from 'three/webgpu';
import { addStone } from '../ProceduralWorkshopMasonry.js';
import { applyUnitShading } from '../ProceduralWorkshopMaterials.js';
import { createRandom, mixSeed } from '../ProceduralRandom.js';
import { tagStructureGeometry } from '../ProceduralWorkshopSemantics.js';

/** First seed lane handed out; clear of the castle and manor lanes (< 5000). */
const FIRST_SEED_OFFSET = 6000;

/**
 * Build context shared by every village-house and prop builder.
 *
 * Owns the per-material geometry sets the medieval pipeline merges, hands out
 * unique seed lanes so no two masonry runs share a jitter stream, and tags each
 * emitted geometry with the structure currently being built. Tagging everything
 * matters: the component classifier otherwise infers doors from any tall thin
 * piece of wood, which a timber-framed facade is full of.
 */
export class HouseKit {
  constructor(recipe, sets) {
    this.recipe = recipe;
    this.sets = sets;
    this.random = createRandom(mixSeed(recipe.seed, 0x40a5e));
    this.nextSeed = FIRST_SEED_OFFSET;
    this.structure = null;
    this.stats = { roofTiles: 0 };
  }

  seedOffset() {
    const offset = this.nextSeed;
    this.nextSeed += 1;
    return offset;
  }

  /** Emit everything `build` adds as part of `structure`. */
  within(structure, build) {
    const previous = this.structure;
    this.structure = structure;
    try {
      return build();
    } finally {
      this.structure = previous;
    }
  }

  add(slot, geometry) {
    if (!geometry) return null;
    if (!this.sets[slot]) throw new Error(`Unknown workshop material set: ${slot}.`);
    if (!geometry.userData.workshopSemantic && this.structure) {
      tagStructureGeometry(geometry, this.structure);
    }
    this.sets[slot].push(geometry);
    return geometry;
  }

  addAll(slot, geometries) {
    for (const geometry of geometries) this.add(slot, geometry);
  }

  /** One dressed or field stone, shaped by the shared irregularity kernel. */
  stone(params, { category = 'field', heightRatio = 0.5, stableIndex = null } = {}) {
    const target = [];
    const index = stableIndex ?? this.seedOffset() * 10000;
    addStone(target, this.recipe, params, index, heightRatio, category);
    return this.add('stone', target[0]);
  }

  /** Per-unit colour and baked occlusion for a non-masonry unit (tiles, pots). */
  shade(geometry, family, heightRatio = 0.5) {
    return applyUnitShading(geometry, this.recipe, {
      stableIndex: this.seedOffset() * 10000,
      heightRatio,
      family,
    });
  }
}

/**
 * Wings, stairs, sheds and cart shafts make a design asymmetric about its
 * origin, while the placement footprint is measured symmetrically about it.
 * Shifting the finished object onto its own plan centre keeps that footprint
 * tight. Opening edits are stored in facade space, so they are unaffected.
 */
export function centreOnFootprint(sets) {
  const geometries = Object.values(sets).flat();
  const bounds = new THREE.Box3().makeEmpty();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }
  if (bounds.isEmpty()) return;
  const centre = bounds.getCenter(new THREE.Vector3());
  const shifted = new Map();
  for (const geometry of geometries) {
    geometry.translate(-centre.x, 0, -centre.z);
    geometry.boundingBox = null;
    // Facade hosts pin their pivot to an explicit origin; it must move with the
    // walls, or placements would land offset by the recentring shift.
    const semantic = geometry.userData.workshopSemantic;
    const origin = semantic?.attachmentSurface?.origin;
    if (!origin) continue;
    if (!shifted.has(semantic)) {
      shifted.set(semantic, Object.freeze({
        ...semantic,
        attachmentSurface: Object.freeze({
          ...semantic.attachmentSurface,
          origin: Object.freeze([origin[0] - centre.x, origin[1], origin[2] - centre.z]),
        }),
      }));
    }
    geometry.userData.workshopSemantic = shifted.get(semantic);
  }
}
