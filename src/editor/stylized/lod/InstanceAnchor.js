/**
 * Where a scatter view's instance matrices are measured from.
 *
 * Canonical positions on a planet-scale map run to millions of metres, and a
 * float32 matrix steps by a quarter to half a metre there. The GPU applies the
 * instance matrix before the root's, so every vertex of a 10 cm pebble landed
 * on the same step and the stone drew as a sliver; a trunk or a boulder's
 * facets snapped to the same grid. Instances are written relative to this
 * anchor instead — the floating origin as it stood at a rewrite — and the
 * view's root sits at (anchor − origin), so a translation stays within a few
 * kilometres, where float32 resolves well under a millimetre.
 *
 * The anchor moves only once the origin has drifted past `reach`, and only
 * from a rebuild, which rewrites every instance anyway: moving it dirties all
 * of them once, and every other rebuild still uploads only what changed.
 */
export const INSTANCE_ANCHOR_REACH_METERS = 2048;

export class InstanceAnchor {
  constructor(reach = INSTANCE_ANCHOR_REACH_METERS) {
    this.reach = reach;
    this.x = null;
    this.z = null;
  }

  /**
   * Re-centres on the floating origin once it has drifted past `reach`. Call
   * only before writing every instance of the view.
   *
   * @param {{ x: number, z: number }} origin canonical position of render (0, 0)
   */
  follow(origin) {
    if (this.x === null
        || Math.abs(origin.x - this.x) > this.reach
        || Math.abs(origin.z - this.z) > this.reach) {
      this.x = origin.x;
      this.z = origin.z;
    }
    return this;
  }

  /** Places the root holding anchor-relative instances for this origin. */
  place(root, origin) {
    root.position.set((this.x ?? 0) - origin.x, 0, (this.z ?? 0) - origin.z);
  }
}
