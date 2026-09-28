/**
 * How far under water the camera is, as one number the frame's other systems can
 * read.
 *
 * The player's `UnderwaterViewController` already computes this each frame for the
 * environment — fog, light, near plane, sky, caustics — and this is the same value
 * handed to the surface view, so the two do not each decide separately what
 * "under water" means. It is a plain number rather than a uniform because what
 * reads it is CPU work, not a shader.
 *
 * The donor's `UnderwaterPerformanceController` hides land layers outright when
 * the camera goes under. This project suspends their *work* instead, and the
 * difference is deliberate: our measured cost is in rebuilding — scatter
 * compactions, buffer uploads, ground-texture paints — rather than in drawing, so
 * suspending the work is what saves the frame. Nothing is hidden, so nothing pops
 * when you surface; the field simply catches up over the next few frames.
 */

let blend = 0;

/** Set by the underwater controller each frame, 0 at the surface and 1 submerged. */
export function setUnderwaterBlend(value) {
  blend = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function getUnderwaterBlend() {
  return blend;
}

/**
 * Whether land streaming should stand down this frame.
 *
 * The threshold is well inside the transition rather than at its start, so the
 * work stops once the camera is genuinely under the surface and starts again
 * before the head breaks it — a player bobbing at the waterline should not
 * start and stop the world's streaming every wave.
 */
export function isLandStreamingSuspended(threshold = 0.6) {
  return blend >= threshold;
}
