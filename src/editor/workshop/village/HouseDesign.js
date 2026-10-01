import { storeyHostId, storeyHosts } from './HouseStoreys.js';

/**
 * Shared vocabulary for village-house designs.
 *
 * A design is two-phase so editable openings can be resolved before any wall is
 * laid: it declares its storeys — each of whose built sides is an editable
 * facade host — and the openings it would put on them. The generator resolves
 * those against the component editor's moves, resizes, duplicates and joined
 * assemblies, builds every storey around exactly those voids, then calls the
 * design's `build` for roofs, chimneys, stairs and other details.
 */

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Ridge rise over a half-span, from the recipe's pitch and roof-height scale. */
export function roofRise(recipe, halfSpan, { minimumPitch = 15, pitchScale = 1 } = {}) {
  const pitch = Math.max(minimumPitch, recipe.roofPitch * pitchScale);
  return halfSpan * Math.tan(clamp(pitch, 15, 64) * Math.PI / 180) * recipe.roofScale;
}

/** Length of one side of a storey's footprint. */
export function sideLength(storey, side) {
  const { x0, x1, z0, z1 } = storey.box;
  return side === 'front' || side === 'back' ? x1 - x0 : z1 - z0;
}

/**
 * An opening in the resolver's vocabulary. `centerX` is measured from the
 * facade centre and `bottom` from the storey base. Rectangular heads keep the
 * resolver's minimum radius (half the width) so their total height survives
 * resizing; `rectangular` tells the builders not to arch them.
 */
function openingShape({ centerX, bottom, width, height, arch = false, door = false }) {
  const radius = width / 2;
  return {
    centerX,
    surfaceX: centerX,
    bottom,
    width,
    springHeight: Math.max(0.3, height - radius),
    radius,
    rectangular: !arch,
    door,
  };
}

/** Evenly spaced opening centres across [start, end] (facade-centred metres). */
export function bays(start, end, spacing) {
  const span = end - start;
  if (span <= 0) return [];
  const count = Math.max(1, Math.floor(span / spacing));
  return Array.from({ length: count }, (_, index) => start + span * (index + 0.5) / count);
}

/** Editable openings, numbered across every host of one design. */
export class OpeningNumbering {
  constructor(recipe) {
    this.enabled = recipe?.windows !== false;
    this.doors = 0;
    this.windows = 0;
    this.openings = [];
  }

  add(hostId, spec) {
    if (!this.enabled) return null;
    const door = spec.door === true;
    const index = door ? (this.doors += 1) : (this.windows += 1);
    const opening = Object.freeze({
      ...openingShape(spec),
      componentId: `${door ? 'door' : 'window'}-${index}`,
      componentLabel: spec.label ?? (door ? (index === 1 ? 'Main entrance' : `Door ${index}`) : `Window ${index}`),
      hostId,
    });
    this.openings.push(opening);
    return opening;
  }

  /** A door on one side of a storey. */
  door(storey, side, spec) {
    return this.add(storeyHostId(storey, side), { ...spec, door: true, bottom: spec.bottom ?? 0 });
  }

  /**
   * A row of like windows along one side, spaced by `spacing`, keeping `margin`
   * clear at each end and skipping any facade-centred interval in `avoid`.
   */
  row(storey, side, { spacing = 2.4, margin = 0.6, avoid = [], ...spec }) {
    const half = sideLength(storey, side) / 2;
    const clear = (x) => avoid.every(([a, b]) => x + spec.width / 2 < a || x - spec.width / 2 > b);
    for (const centerX of bays(-half + margin, half - margin, spacing).filter(clear)) {
      this.add(storeyHostId(storey, side), { ...spec, centerX });
    }
  }
}

export function design({ storeys, openings, build = () => {} }) {
  return Object.freeze({
    storeys: Object.freeze(storeys),
    hosts: Object.freeze(storeys.flatMap((storey) => Object.values(storeyHosts(storey)))),
    openings: Object.freeze(openings),
    build,
  });
}
