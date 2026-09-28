/**
 * The contacts waiting to be pressed into the grass trample field.
 *
 * A footfall is the only thing that writes to the field, and it does not know or
 * care what consumes it: this buffer takes a position, a radius and a push, and
 * is drained by `GrassTrampleField` on its next update. It imports nothing, so
 * the character, footstep and grass code can all reach it without any of them
 * reaching each other.
 *
 * It is fixed-capacity on purpose. A frame that submits more contacts than the
 * field can paint is a bug in the caller, not a reason to allocate: the buffer
 * refuses the extra contacts, counts them, and the count is there to be noticed
 * in a perf readout. Silently growing would make the field's per-update cost
 * depend on how many NPCs happened to be near the camera.
 *
 * Storage is one Float32Array per channel rather than an array of records, so a
 * drain allocates nothing and the field can upload the channels straight into
 * its uniform array.
 */

/** Contacts a single update can paint. One walker delivers two per stride. */
export const DEFAULT_TRAMPLE_CONTACT_CAPACITY = 16;

/** The channel names, in the order a drain reads them. */
const CHANNELS = [
  'x',
  'z',
  'radius',
  'strength',
  'directionX',
  'directionZ',
  'innerRadiusFraction',
  'directionalBlend',
];

export class GrassTrampleContacts {
  /**
   * @param {number} [capacity] contacts a single update may carry
   */
  constructor(capacity = DEFAULT_TRAMPLE_CONTACT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`Trample contact capacity must be a positive integer, got ${capacity}.`);
    }
    this.capacity = capacity;
    /** Contacts written since the last `clear()`. */
    this.count = 0;
    /** Contacts refused because the buffer was full. A diagnostic, never reset by `clear()`. */
    this.dropped = 0;
    for (const channel of CHANNELS) this[channel] = new Float32Array(capacity);
    this.#record = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  }

  #record;

  /**
   * Queue a contact. Rejects rather than grows, and rejects anything that would
   * put a non-finite or meaningless value in the field.
   *
   * @param {object} contact
   * @param {number} contact.x canonical metres
   * @param {number} contact.z canonical metres
   * @param {number} contact.radius metres the contact reaches
   * @param {number} [contact.strength] 0..1 how hard it presses
   * @param {number} [contact.directionX] unit push direction, or 0 to press radially
   * @param {number} [contact.directionZ] unit push direction, or 0 to press radially
   * @param {number} [contact.innerRadiusFraction] 0..1 plateau inside the radius
   * @param {number} [contact.directionalBlend] 0 radial, 1 the given direction
   * @returns {boolean} whether the contact was accepted
   */
  submitContact({
    x,
    z,
    radius,
    strength = 1,
    directionX = 0,
    directionZ = 0,
    innerRadiusFraction = 0,
    directionalBlend = 0,
  } = {}) {
    if (this.count >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    // A NaN position paints NaN into every texel it touches, and a NaN texel
    // never recovers because floor(NaN) is NaN -- the grass stays bent forever.
    // Nothing downstream can tell that from a real print, so it stops here.
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(Math.abs(radius) > 0)) return false;
    const index = this.count;
    this.x[index] = x;
    this.z[index] = z;
    this.radius[index] = Math.abs(radius);
    this.strength[index] = clamp01(strength);
    this.directionX[index] = Number.isFinite(directionX) ? Math.max(-1, Math.min(1, directionX)) : 0;
    this.directionZ[index] = Number.isFinite(directionZ) ? Math.max(-1, Math.min(1, directionZ)) : 0;
    this.innerRadiusFraction[index] = clamp01(innerRadiusFraction);
    this.directionalBlend[index] = clamp01(directionalBlend);
    this.count = index + 1;
    return true;
  }

  /**
   * Visit each queued contact in submission order. The record handed to the
   * visitor is reused between calls, so reading it is free and keeping it is not.
   */
  forEach(visitor) {
    for (let index = 0; index < this.count; index += 1) {
      visitor(this.at(index));
    }
  }

  /** The contact at `index` as a plain record (reused storage, read it before the next call). */
  at(index) {
    const record = this.#record;
    for (const channel of CHANNELS) record[channel] = this[channel][index];
    return record;
  }

  /** Drain: the contacts have been painted and the next update starts fresh. */
  clear() {
    this.count = 0;
  }

  /** Everything, for a session reset: the drop count is per session, not per update. */
  reset() {
    this.count = 0;
    this.dropped = 0;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
