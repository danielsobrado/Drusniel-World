/**
 * Openings in a curved wall: the void, and the dressed stone around it.
 *
 * The void is produced by **splitting the course**, not by filtering stones out
 * of a full one. `ProceduralCastleWallGenerator` packs the whole span and then
 * drops whatever intersects the opening, which leaves ragged jamb edges whose
 * position depends on how wide the omitted stone happened to be. Packing each
 * surviving sub-interval instead lands stone edges flush on the jamb line —
 * which is what real masonry does, because the jamb *is* the edge.
 *
 * This module is the **one** definition of where that void is. Near and coarse
 * masonry, the shell, the mortar core and the decoration mask all read
 * `openingHalfWidthAt` / `survivingIntervals` rather than re-deriving the
 * contour, so near, coarse and shell agree about silhouette and voids (phase 11
 * §7.3). `openingVoidInterval` is the single sampled contour; the band and
 * exclusion helpers are its only derived forms.
 */

const TRIM_THICKNESS = 0.22;

/**
 * Clearance every consumer reserves around the authored void, in metres.
 *
 * Published rather than defaulted per call site: the course packer, the shell,
 * the mortar core and the decoration mask must all read the *same* opening, and
 * two copies of "how wide is the void here" is exactly the disagreement phase 11
 * §7.3 forbids.
 */
export const OPENING_CLEARANCE = 0.018;

function springHeightOf(opening) {
  if (opening.profile === 'flat') return opening.height;
  if (opening.profile === 'segmental') return opening.height * 0.72;
  if (opening.profile === 'pointed') return opening.height * 0.55;
  return Math.max(0, opening.height - opening.width / 2);
}

/** Authored arch rise from springing to crown (zero for flat). */
function archRiseOf(opening) {
  if (opening.profile === 'flat') return 0;
  return Math.max(0.05, opening.height - springHeightOf(opening));
}

function archRadiusOf(opening) {
  if (opening.profile === 'segmental') {
    const rise = archRiseOf(opening);
    const half = opening.width / 2;
    return (half * half + rise * rise) / (2 * rise);
  }
  return opening.width / 2;
}

/** Radius of each leaf in a pointed (two-centre) arch. */
function pointedLeafRadius(opening) {
  return (2 / 3) * opening.width;
}

/** Half-width of the void at height `y`, following the opening's profile. */
export function openingHalfWidthAt(opening, y) {
  const half = opening.width / 2;
  const sill = opening.sill;
  if (y < sill) return 0;
  const springHeight = springHeightOf(opening);
  const shoulder = sill + springHeight;
  if (y <= shoulder) return half;
  if (opening.profile === 'flat') return y <= sill + opening.height ? half : 0;

  const archRise = archRiseOf(opening);
  const rise = y - shoulder;
  if (rise >= archRise) return 0;

  if (opening.profile === 'pointed') {
    // Two arcs struck from opposite thirds; scale the natural crown to the
    // authored height so the void pinches exactly at sill+height.
    const R = pointedLeafRadius(opening);
    const naturalRise = Math.sqrt(Math.max(0, R * R - (half / 3) * (half / 3)));
    const effectiveRise = (rise / Math.max(1e-6, archRise)) * naturalRise;
    return Math.max(
      0,
      Math.sqrt(Math.max(0, R * R - effectiveRise * effectiveRise)) - half / 3,
    );
  }

  if (opening.profile === 'segmental') {
    // Circle centre sits (R − archRise) below the springing so the arc hits the
    // jambs at full width and the crown at zero — not a semicircle of radius R.
    const R = archRadiusOf(opening);
    const distY = rise + (R - archRise);
    return Math.sqrt(Math.max(0, R * R - distY * distY));
  }

  // Round: springing is one radius below the crown, so rise ∈ [0, R].
  const radius = archRadiusOf(opening);
  return Math.sqrt(Math.max(0, radius * radius - rise * rise));
}

/**
 * Sill and crown of the authored void, in wall-local height.
 *
 * For every profile the crown is the springing plus the arch rise, which for a
 * flat head is `sill + height` exactly — the same value the shell's level set
 * and the collision bands use.
 */
export function openingVerticalSpan(opening) {
  const sill = opening.sill;
  if (opening.profile === 'flat') return { sill, crown: sill + opening.height };
  return { sill, crown: sill + springHeightOf(opening) + archRiseOf(opening) };
}

/**
 * The void's reserved arc interval at height `y`, or null where the opening is
 * solid.
 *
 * The single contour definition: `survivingIntervals` subtracts it, and the
 * mortar core, collision compiler and decoration mask clip to it. Nothing else
 * re-derives where the void is.
 */
export function openingVoidInterval(opening, y, { clearance = OPENING_CLEARANCE } = {}) {
  const half = openingHalfWidthAt(opening, y);
  if (!(half > 0)) return null;
  return { low: opening.s - half - clearance, high: opening.s + half + clearance };
}

/**
 * Widest half-width the contour reaches anywhere in `[yLow, yHigh]`.
 *
 * The void is flat from the sill to the springing then falls monotonically to
 * zero at the crown, so the widest point of a band is its lowest height inside
 * the void — no sampling needed, and the answer is the same one
 * `openingHalfWidthAt` gives at that level.
 */
export function openingHalfWidthOverBand(opening, yLow, yHigh) {
  const { sill, crown } = openingVerticalSpan(opening);
  const low = Math.max(yLow, sill);
  const high = Math.min(yHigh, crown);
  if (!(high > low)) return 0;
  return openingHalfWidthAt(opening, low);
}

/**
 * Subtract the reserved intervals from `[s0, s1]`, leaving the spans a course
 * at height `y` can actually be packed into.
 */
export function survivingIntervals(range, openings, y, { clearance = OPENING_CLEARANCE } = {}) {
  const [s0, s1] = range;
  let spans = [[s0, s1]];
  for (const opening of openings) {
    const interval = openingVoidInterval(opening, y, { clearance });
    if (!interval) continue;
    const { low, high } = interval;
    const next = [];
    for (const [from, to] of spans) {
      if (high <= from || low >= to) {
        next.push([from, to]);
        continue;
      }
      if (low > from) next.push([from, Math.min(low, to)]);
      if (high < to) next.push([Math.max(high, from), to]);
    }
    spans = next;
  }
  return spans.filter(([from, to]) => to - from > 1e-6);
}

/**
 * Highest point of the void's upper contour over the arc span `[s0, s1]`, or
 * null where the span does not reach the void.
 *
 * Used to decide whether a course has room for material above an opening.
 * Individual shoulders are then fitted to the sampled contour in OpeningContour.
 */
export function openingTopOverSpan(opening, s0, s1) {
  const low = Math.min(s0, s1);
  const high = Math.max(s0, s1);
  const nearest = opening.s < low ? low - opening.s : opening.s > high ? opening.s - high : 0;
  if (!(nearest < opening.width / 2)) return null;
  const { sill, crown } = openingVerticalSpan(opening);
  // The half-width is full from the sill to the springing and then falls
  // monotonically, so the last height still wider than `nearest` is found by
  // bisection on the shared contour.
  let below = sill;
  let above = crown;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (below + above) / 2;
    if (openingHalfWidthAt(opening, middle) > nearest) below = middle;
    else above = middle;
  }
  return above;
}

/**
 * Surviving spans over a vertical *band*, not a single height.
 *
 * A course is packed at its centre height, so one whose centre falls below a
 * sill or above an arch crown is packed whole and its recessed core would span
 * the opening. Taking the union of the contour across the band clips the whole
 * course at the widest void it touches. A consumer that can *discard* the
 * affected material — the recessed mortar core, the decoration mask — wants
 * exactly this. Stones cannot: dropping a whole straddling course would open a
 * real gap below the sill, so their exact remedy is the per-stone contour
 * clipping that phase 11 §7.3 assigns to W5.
 */
export function survivingIntervalsOverBand(
  range,
  openings,
  [yLow, yHigh],
  { clearance = OPENING_CLEARANCE } = {},
) {
  const [s0, s1] = range;
  let spans = [[s0, s1]];
  for (const opening of openings) {
    const half = openingHalfWidthOverBand(opening, yLow, yHigh);
    if (!(half > 0)) continue;
    const low = opening.s - half - clearance;
    const high = opening.s + half + clearance;
    const next = [];
    for (const [from, to] of spans) {
      if (high <= from || low >= to) {
        next.push([from, to]);
        continue;
      }
      if (low > from) next.push([from, Math.min(low, to)]);
      if (high < to) next.push([Math.max(high, from), to]);
    }
    spans = next;
  }
  return spans.filter(([from, to]) => to - from > 1e-6);
}

/**
 * The opening's full exclusion zone: the widest void plus clearance, over the
 * whole contour including the sill and crown.
 *
 * Growth (ivy, moss, footing grass) must be cleared from a passage, so this is
 * what a decoration system consumes — minted here so there is one definition of
 * where the passage is (phase 11 §6.4 / §7.3).
 */
export function openingExclusionZones(openings, { clearance = OPENING_CLEARANCE } = {}) {
  return openings.map((opening) => {
    const { sill, crown } = openingVerticalSpan(opening);
    const half = opening.width / 2;
    return Object.freeze({
      id: opening.id ?? null,
      s: opening.s,
      low: opening.s - half - clearance,
      high: opening.s + half + clearance,
      bottom: sill - clearance,
      top: crown + clearance,
    });
  });
}

/**
 * The exclusion mask a decoration system consumes: the zones plus a
 * `blocks(arc, y)` predicate in the wall's own surface domain, so a scatter
 * point can be rejected without knowing how an opening is shaped.
 */
export function createOpeningExclusionMask(openings, { clearance = OPENING_CLEARANCE } = {}) {
  const zones = openingExclusionZones(openings, { clearance });
  return Object.freeze({
    clearance,
    zones: Object.freeze(zones),
    blocks(arc, y) {
      return zones.some((zone) => (
        arc >= zone.low && arc <= zone.high && y >= zone.bottom && y <= zone.top
      ));
    },
  });
}

export { layoutOpening } from './OpeningDressings.js';

/** Total height the opening's dressings reach, for clearance checks. */
export function openingCrownHeight(opening) {
  if (opening.profile === 'flat') return opening.sill + opening.height + TRIM_THICKNESS;
  return opening.sill + springHeightOf(opening) + archRiseOf(opening) + TRIM_THICKNESS;
}
