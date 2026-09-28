/**
 * The maths behind the grass trample field, after grass-test's `InteractionMap`.
 *
 * Nothing here touches Three, the DOM or a renderer: every decision the field
 * makes about *what* to paint, *how far* a texel has recovered and *whether* an
 * update is worth doing at all is a plain function, so it can be pinned in a
 * node test rather than only be seen in a browser. `GrassTrampleField` owns the
 * GPU side; this module owns the rules.
 *
 * The texel layout is the donor's and the grass material already decodes it:
 * R and G are the crush direction X/Z biased to 0.5, B is how hard the ground
 * was pressed (0..1), A is how recently a contact landed. Neutral ground is
 * (0.5, 0.5, 0, 0) -- note the alpha: a texel nothing has touched must not read
 * as "fresh", or a material that gates on freshness would light up the world.
 */

/** Bias round(0.5 * 255). `encodeDirection(0)` lands here. */
export const DIRECTION_NEUTRAL_BYTE = 128;
export const CRUSH_NEUTRAL_BYTE = 0;
export const FRESHNESS_NEUTRAL_BYTE = 0;

/** The direction channel's full swing, in texel units. */
const DIRECTION_SCALE = 2;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * A unit X or Z component in [-1, 1] to its biased byte.
 *
 * The material reads the channel back as `byte / 255 * 2 - 1`, so this is the
 * exact inverse of `decodeDirection` on the byte grid -- a texel written and
 * then read is the same byte, which is what lets the recovery pass be reasoned
 * about as arithmetic on bytes rather than on floats.
 */
export function encodeDirection(value) {
  const clamped = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return Math.round((clamped / DIRECTION_SCALE + 0.5) * 255);
}

/** The biased byte back to [-1, 1]. */
export function decodeDirection(byte) {
  return (byte / 255) * DIRECTION_SCALE - 1;
}

/** A 0..1 crush or freshness amount to its byte. */
export function encodeAmount(value) {
  return Math.round(clamp01(value) * 255);
}

/** A crush or freshness byte back to 0..1. */
export function decodeAmount(byte) {
  return byte / 255;
}

/**
 * How hard a foot presses at `distance` from the centre of its contact.
 *
 * 1 at the centre, 0 at `radius`, and the quadratic between them is what makes
 * the crushed patch read as a soft print rather than a stamped disc with a lip.
 * `innerRadiusFraction` lifts a plateau inside the contact, which is how a foot
 * (or a body) gets a flat sole with the give at its edge instead of a spike at
 * one texel. It is clamped rather than validated so a caller easing the fraction
 * in can pass anything.
 *
 * The whole point of this being one function is that the CPU twin and the
 * shader expression cannot drift: a mismatch shows as grass that stays bent
 * after the field says it is neutral.
 */
export function contactFalloff(distance, radius, innerRadiusFraction = 0) {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0;
  if (distance <= 0) return 1;
  if (distance >= radius) return 0;
  const inner = clamp01(innerRadiusFraction) * radius;
  if (distance <= inner) return 1;
  const t = (distance - inner) / (radius - inner);
  return 1 - t * t;
}

/**
 * The per-update multiplier that decays a value by `perSecond` over `seconds`.
 *
 * The donor recovers by a constant per *frame* (`0.94` at 60 fps), which makes
 * how long a footprint lasts depend on the frame rate -- a 30 fps player's trail
 * fades half as fast. The field runs on a capped cadence as well, so the rate has
 * to be expressed per second and raised to the elapsed time; the alternative is a
 * decay that changes whenever the cap or the frame rate does.
 */
export function recoveryFactor(perSecond, seconds) {
  const rate = clamp01(perSecond);
  if (!(seconds > 0)) return 1;
  return Math.min(1, Math.pow(rate, seconds));
}

/**
 * One recovery step on a byte: the donor's `floor(value * speed)`.
 *
 * Floor, not round, and that is load-bearing. Floor is monotonic and
 * `floor(0 * anything) === 0`, so a recovered texel stays at 0 however many times
 * the pass runs -- the field can skip a pass without changing the result, and a
 * texel can never overshoot neutral into a negative or wrapped value.
 */
export function recoverByte(byte, factor) {
  if (!(byte > 0)) return CRUSH_NEUTRAL_BYTE;
  return Math.floor(byte * clamp01(factor));
}

/** The high-water mark's recovery step, mirrored from `recoverByte`. */
export function recoverPeak(peak, factor) {
  if (!(peak > 0)) return 0;
  return Math.floor(peak * clamp01(factor));
}

/** The high-water mark after a paint: it only ever rises. */
export function raisedPeak(peak, value) {
  return value > peak ? value : peak;
}

/**
 * An empty dirty rectangle. Inclusive on both ends; empty when an end has
 * crossed its start. Kept as a plain object so it can be compared and logged.
 */
export function emptyInk() {
  return { minX: 0, minY: 0, maxX: -1, maxY: -1 };
}

export function inkIsEmpty(ink) {
  return ink.maxX < ink.minX || ink.maxY < ink.minY;
}

/**
 * Grow the dirty rectangle to include `rect`, clamped to the texture.
 *
 * Pure: it returns a new rectangle rather than mutating, so the caller's copy is
 * never half-updated if an argument is bad, and the field's own rectangle can be
 * read from outside without aliasing.
 */
export function inkAdd(ink, rect, texels) {
  const last = texels - 1;
  const minX = Math.max(0, Math.floor(Math.min(rect.minX, rect.maxX)));
  const minY = Math.max(0, Math.floor(Math.min(rect.minY, rect.maxY)));
  const maxX = Math.min(last, Math.ceil(Math.max(rect.minX, rect.maxX)));
  const maxY = Math.min(last, Math.ceil(Math.max(rect.minY, rect.maxY)));
  if (minX > maxX || minY > maxY) return inkIsEmpty(ink) ? emptyInk() : ink;
  if (inkIsEmpty(ink)) return { minX, minY, maxX, maxY };
  return {
    minX: Math.min(ink.minX, minX),
    minY: Math.min(ink.minY, minY),
    maxX: Math.max(ink.maxX, maxX),
    maxY: Math.max(ink.maxY, maxY),
  };
}

/**
 * The dirty rectangle of one contact, in texels.
 *
 * The one-texel margin is the same one `groundDeformationState` keeps: the
 * material samples this texture with linear filtering, so the texel a contact
 * only grazes still blends with its neighbours, and without the margin the edge
 * of a footprint quantises to the texel grid.
 */
export function inkFromContact(contact, centreX, centreZ, windowMetres, texels) {
  const texel = texelMetres(windowMetres, texels);
  const half = texels / 2;
  const reach = Math.ceil(Math.abs(contact.radius) / texel) + 1;
  const contactX = Math.floor((contact.x - centreX) / texel + half);
  const contactY = Math.floor((contact.z - centreZ) / texel + half);
  return {
    minX: contactX - reach,
    minY: contactY - reach,
    maxX: contactX + reach,
    maxY: contactY + reach,
  };
}

/**
 * Move a dirty rectangle with the field as the window scrolls.
 *
 * Target texel (x, y) reads source (x + shiftX, y + shiftY), so the content -- and
 * with it the rectangle -- moves by the negative of the shift. Anything pushed
 * off the texture is dropped: a texel there is neutral by construction.
 */
export function inkTranslate(ink, shiftX, shiftY, texels) {
  if (inkIsEmpty(ink)) return emptyInk();
  const last = texels - 1;
  const minX = Math.max(0, ink.minX - shiftX);
  const minY = Math.max(0, ink.minY - shiftY);
  const maxX = Math.min(last, ink.maxX - shiftX);
  const maxY = Math.min(last, ink.maxY - shiftY);
  if (minX > maxX || minY > maxY) return emptyInk();
  return { minX, minY, maxX, maxY };
}

/**
 * What one update has to do, given what is left in the field and where the
 * window moved.
 *
 * This is the donor's skip logic, and the two skips are the whole reason a still
 * player is cheap:
 *
 * - `recover` is off when the high-water mark is 0. Floor is monotonic and
 *   `floor(0 * r) === 0`, so an all-zero red channel is bit-exactly unchanged by
 *   a recovery pass -- skipping it cannot change what the material reads.
 * - `scroll` is off when the window moved less than a whole texel. `scrollShift`
 *   truncates, so a sub-texel move is a no-op by construction rather than by a
 *   tolerance that could drift.
 *
 * `hasContacts` forces a run even from a settled field: a footfall is the one
 * thing that must land the frame it happens, whatever the high-water mark says.
 */
export function updatePlan({ peak = 0, shiftX = 0, shiftY = 0, hasContacts = false } = {}) {
  const recover = peak > 0;
  const scroll = recover && (shiftX !== 0 || shiftY !== 0);
  return { recover, scroll, run: recover || scroll || hasContacts };
}

/** Whether a capped-cadence update is due. Contacts are never delayed. */
export function updateDue({ plan, hasContacts = false, elapsedSeconds = 0, intervalSeconds = 0 } = {}) {
  if (hasContacts) return true;
  if (!plan?.run) return false;
  return !(intervalSeconds > 0) || elapsedSeconds >= intervalSeconds;
}

/** Metres a texel covers. */
export function texelMetres(windowMetres, texels) {
  return windowMetres / texels;
}

/**
 * Snap a canonical coordinate to the texel grid.
 *
 * Snapping is what keeps the field from swimming: the window only ever moves in
 * whole texels, so the content under a texel is the same world point before and
 * after a scroll. It also keeps the centre exact at planet scale as long as the
 * texel is a power-of-two fraction of a metre.
 */
export function snapToTexel(value, texel) {
  if (!(texel > 0) || !Number.isFinite(value)) return 0;
  return Math.round(value / texel) * texel;
}

/**
 * The whole-texel shift for a window move, as the donor computes it.
 *
 * Trunc rather than round: trunc is monotonic and never grows with sub-texel
 * jitter, so a player standing on a texel boundary does not oscillate the field.
 * The `|| 0` normalises the negative zero trunc leaves behind a sub-texel
 * negative move, so the shift a caller logs or compares is a plain integer.
 */
export function scrollShift(deltaX, deltaZ, texel) {
  if (!(texel > 0)) return { shiftX: 0, shiftY: 0 };
  const dX = Number.isFinite(deltaX) ? deltaX : 0;
  const dZ = Number.isFinite(deltaZ) ? deltaZ : 0;
  return {
    shiftX: Math.trunc(dX / texel) || 0,
    shiftY: Math.trunc(dZ / texel) || 0,
  };
}

/** Toroidal texel index, for an addressing mode that wraps instead of scrolling. */
export function wrapTexel(index, texels) {
  if (!(texels > 0)) return 0;
  const wrapped = index % texels;
  return wrapped < 0 ? wrapped + texels : wrapped;
}

/**
 * The window uv for a canonical point -- the JS twin of the expression the grass
 * material runs, and the reason that expression is a documented contract rather
 * than a shader-only detail. `v` runs with canonical Z, so a reader does not have
 * to reason about the donor's row order.
 */
export function windowUv(x, z, centreX, centreZ, windowMetres) {
  if (!(windowMetres > 0)) return { u: 0.5, v: 0.5 };
  return {
    u: (x - centreX) / windowMetres + 0.5,
    v: (z - centreZ) / windowMetres + 0.5,
  };
}
