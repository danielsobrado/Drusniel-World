/**
 * Keeps foliage from hiding the player.
 *
 * Ported from grass-test. Canopy between the third-person camera and the
 * character is dithered away inside a soft circle around the character's
 * on-screen silhouette. Only fragments nearer the camera than the character are
 * cut, so the canopy behind the player stays whole. Solid obstacles are the
 * camera boom's job, not this.
 *
 * It is applied to tree leaves only: leaves cast no shadow here, and three.js
 * falls back to `maskNode` in the shadow pass, where the cut — measured from
 * the view camera — would mean nothing. With the cut off (`strength` 0) the
 * mask is a single comparison per leaf fragment.
 */

import * as THREE from 'three';
import {
  float,
  interleavedGradientNoise,
  positionView,
  screenCoordinate,
  smoothstep,
  uniform,
  vec2,
} from 'three/tsl';

const center = uniform(new THREE.Vector2(-1e4, -1e4));
const radius = uniform(0);
const depth = uniform(0);
const strength = uniform(0);
const EDGE_EPSILON = 1e-3;
/** The window is a little taller than the character: a clean opening, not a keyhole. */
const RADIUS_IN_HEIGHTS = 0.75;

/** Boolean TSL node: true where a fragment should be kept. And it into a `maskNode`. */
export function characterOcclusionKeep() {
  const distance = screenCoordinate.xy.sub(center).length();
  // 1 inside the circle, fading to 0 across its outer 40%. smoothstep with
  // reversed or equal edges is undefined in WGSL, and the NaN it returns
  // discards everything — so fade in, invert, and keep the edges apart.
  const inside = smoothstep(radius.mul(0.6), radius.max(EDGE_EPSILON), distance).oneMinus();
  // Only in front of the character: within a body's depth of it, or behind, stays.
  const nearEdge = depth.mul(0.8);
  const inFront = smoothstep(
    nearEdge,
    depth.mul(0.92).max(nearEdge.add(EDGE_EPSILON)),
    positionView.z.negate(),
  ).oneMinus();
  const cut = inside.mul(inFront).mul(strength);
  const noise = interleavedGradientNoise(screenCoordinate.xy.add(vec2(17, 5)));
  return strength.lessThanEqual(0).or(noise.greaterThanEqual(cut.mul(float(0.97))));
}

const scratch = new THREE.Vector3();
const bufferSize = new THREE.Vector2();

/**
 * Place the window for this frame, or switch it off.
 *
 * @param {object} options
 * @param {{ getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 }} options.renderer
 * @param {THREE.PerspectiveCamera | null} options.camera
 * @param {THREE.Vector3 | null} options.target the character's centre, world space
 * @param {number} options.height character height, metres
 * @param {number} [options.pixelScale] scene-pass resolution relative to the drawing buffer
 * @param {boolean} [options.enabled]
 */
export function updateCharacterOcclusion({
  renderer,
  camera,
  target,
  height,
  pixelScale = 1,
  enabled = true,
}) {
  if (!enabled || !target || !camera || !(height > 0)) {
    strength.value = 0;
    return;
  }
  renderer.getDrawingBufferSize(bufferSize);
  bufferSize.multiplyScalar(pixelScale > 0 ? pixelScale : 1);
  const viewDepth = -scratch.copy(target).applyMatrix4(camera.matrixWorldInverse).z;
  if (!(viewDepth > camera.near)) {
    strength.value = 0;
    return;
  }
  scratch.copy(target).project(camera);
  center.value.set((scratch.x * 0.5 + 0.5) * bufferSize.x, (0.5 - scratch.y * 0.5) * bufferSize.y);
  const pixelsPerMetre = bufferSize.y / (2 * viewDepth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  radius.value = height * RADIUS_IN_HEIGHTS * pixelsPerMetre;
  depth.value = viewDepth;
  strength.value = 1;
}

export const characterOcclusionUniforms = Object.freeze({ center, radius, depth, strength });
