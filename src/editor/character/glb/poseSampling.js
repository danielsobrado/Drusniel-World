/**
 * Offline sampling of a clip on a live rig.
 *
 * Both the standing pose and the footfall measurement need to evaluate a clip
 * at many times *before* the character is shown, without leaving the skeleton
 * anywhere but where it started. This owns that bracket: a throwaway mixer,
 * and every node's transform restored afterwards, whatever the callback did.
 */

import * as THREE from 'three';

/**
 * @param {THREE.Object3D} model
 * @param {THREE.AnimationClip} clip
 * @param {number} samples evaluations spread evenly over one cycle
 * @param {(normalizedTime: number, index: number) => void} visit called with
 *   the rig posed at each sample
 */
export function sampleClipCycle(model, clip, samples, visit) {
  const saved = [];
  model.traverse((object) => {
    saved.push([object, object.position.clone(), object.quaternion.clone(), object.scale.clone()]);
  });
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  try {
    for (let index = 0; index < samples; index += 1) {
      const normalizedTime = index / samples;
      action.time = normalizedTime * clip.duration;
      mixer.update(0);
      model.updateMatrixWorld(true);
      visit(normalizedTime, index);
    }
  } finally {
    action.stop();
    mixer.uncacheRoot(model);
    for (const [object, position, quaternion, scale] of saved) {
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      object.scale.copy(scale);
    }
    model.updateMatrixWorld(true);
  }
}
