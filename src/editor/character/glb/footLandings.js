/**
 * Where in a locomotion cycle each foot lands.
 *
 * Adapted from grass-test (`FootstepContacts.js`). The walk and run clips are
 * blended at a shared phase, and two clips that land the left foot at
 * different points of their cycles cancel into a shuffle mid-blend. Measuring
 * each clip's left landing lets the view offset both onto the same phase, and
 * the landings are also the instants footstep effects hang off.
 */

import * as THREE from 'three';
import { sampleClipCycle } from './poseSampling.js';

const SAMPLES = 120;
/** A foot has landed once it is within this share of its lift above its lowest point. */
const CONTACT_FRACTION = 0.15;
const MIN_LIFT_METRES = 1e-4;

function landings(heights) {
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  if (high - low < MIN_LIFT_METRES) return [];
  const threshold = low + (high - low) * CONTACT_FRACTION;
  const result = [];
  for (let index = 0; index < heights.length; index += 1) {
    const previous = heights[(index + heights.length - 1) % heights.length];
    if (previous > threshold && heights[index] <= threshold) result.push(index / heights.length);
  }
  return result;
}

/**
 * @param {THREE.Object3D} model
 * @param {THREE.AnimationClip} clip
 * @param {{ left: THREE.Object3D, right: THREE.Object3D }} feet
 * @returns {{ left: number[], right: number[] }} normalized landing times, ascending
 */
export function measureFootLandings(model, clip, feet) {
  const heights = { left: [], right: [] };
  const position = new THREE.Vector3();
  sampleClipCycle(model, clip, SAMPLES, () => {
    heights.left.push(feet.left.getWorldPosition(position).y);
    heights.right.push(feet.right.getWorldPosition(position).y);
  });
  return { left: landings(heights.left), right: landings(heights.right) };
}
