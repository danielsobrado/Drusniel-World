import { cameraPosition, float, interleavedGradientNoise, oneMinus, screenCoordinate, smoothstep } from 'three/tsl';

/**
 * Screen-door dissolve by distance, grass-test's `distanceCoverage`: a pixel is
 * kept while a per-pixel noise is under the layer's coverage there. Two layers
 * crossing the same band with complementary coverage hand over without either
 * being blended — both stay opaque, depth-written and alpha-test cheap.
 *
 * @param {object} material
 * @param {object} options
 * @param {object} options.base the instance's render-space root (vec3 node)
 * @param {object | null} options.fadeIn vec2 uniform (start, end): coverage 0 → 1, or null
 * @param {object | null} options.fadeOut vec2 uniform (start, end): coverage 1 → 0, or null
 */
export function applyHandoff(material, { base, fadeIn, fadeOut }) {
  const distance = base.xz.sub(cameraPosition.xz).length();
  const noise = interleavedGradientNoise(screenCoordinate.xy);
  // The arriving layer keeps the pixels the departing layer has released.
  // Testing both against `noise < coverage` leaves half the pixels empty at
  // the midpoint and draws both layers over the other half.
  const incoming = fadeIn
    ? noise.greaterThanEqual(oneMinus(smoothstep(fadeIn.x, fadeIn.y, distance)))
    : float(1).greaterThan(0);
  const outgoing = fadeOut
    ? noise.lessThan(oneMinus(smoothstep(fadeOut.x, fadeOut.y, distance)))
    : float(1).greaterThan(0);
  material.maskNode = incoming.and(outgoing);
  return material;
}
