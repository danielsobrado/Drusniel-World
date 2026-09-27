/**
 * A standing clip for rigs delivered with locomotion only.
 *
 * Ported from grass-test (`createLocomotionClips` in `CharacterMotion.js`). The
 * Meshy bind pose holds the arms out in an A, and a figure that stops walking
 * and snaps into it reads as a shop dummy. Averaged over a whole walk cycle the
 * arm swing cancels, leaving the arms hanging and the spine carried the way the
 * character actually walks — which is how it should stand. The legs keep the
 * bind pose: a walk's mean knee bend would lift the soles off the ground.
 *
 * On top of that pose sits a slow breath: the spine and arms sway by a few
 * hundredths of a radian over four seconds, enough that a character left
 * standing is visibly alive.
 */

import * as THREE from 'three';
import { UPPER_BODY_BONE, humanoidBoneRole } from './humanoidRig.js';
import { sampleClipCycle } from './poseSampling.js';

const MEAN_POSE_SAMPLES = 24;
const STANDING_FRAMES = 32;
const STANDING_SECONDS = 4;
const ANIMATED_BONE = /UpLeg|^LeftLeg$|^RightLeg$|^LeftArm$|^RightArm$|ForeArm|^Spine/;

/** Bones keyed by role name (see `humanoidBoneRole`), so the rules below read the same on every rig. */
function collectBones(model) {
  const bones = new Map();
  model.traverse((object) => {
    const role = humanoidBoneRole(object.name);
    if (object.isBone && !bones.has(role)) bones.set(role, object);
  });
  return bones;
}

function meanUpperBodyPose(model, bones, clip) {
  const sums = new Map();
  if (!clip) return sums;
  sampleClipCycle(model, clip, MEAN_POSE_SAMPLES, () => {
    for (const [name, bone] of bones) {
      if (!UPPER_BODY_BONE.test(name)) continue;
      const q = bone.quaternion;
      const sum = sums.get(name);
      if (!sum) {
        sums.set(name, new THREE.Vector4(q.x, q.y, q.z, q.w));
        continue;
      }
      // Keep every sample in the first sample's hemisphere before summing.
      const sign = sum.x * q.x + sum.y * q.y + sum.z * q.z + sum.w * q.w < 0 ? -1 : 1;
      sum.x += q.x * sign;
      sum.y += q.y * sign;
      sum.z += q.z * sign;
      sum.w += q.w * sign;
    }
  });
  return new Map([...sums].map(([name, sum]) => [
    name,
    new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize(),
  ]));
}

/** Breathing sway for one frame of the standing loop, as a local Euler offset. */
function breathOffset(name, phase, euler) {
  euler.set(0, 0, 0);
  const side = name.startsWith('Left') ? 1 : -1;
  if (/^LeftLeg$|^RightLeg$/.test(name)) euler.x = 0.04;
  else if (/^LeftArm$|^RightArm$/.test(name)) {
    euler.z = side * 0.03;
    euler.x = Math.sin(phase) * 0.018;
  } else if (name.includes('ForeArm')) euler.x = -0.02;
  else if (name.startsWith('Spine')) euler.x = Math.sin(phase) * 0.009;
  return euler;
}

/**
 * @param {THREE.Object3D} model the rig, in its bind pose
 * @param {THREE.AnimationClip | null} walkClip supplies the standing upper body
 * @param {string} [name]
 * @returns {THREE.AnimationClip}
 */
export function createStandingClip(model, walkClip, name = 'Standing') {
  const bones = collectBones(model);
  const stance = meanUpperBodyPose(model, bones, walkClip);
  const tracks = [];
  const euler = new THREE.Euler();
  const offset = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  for (const [boneName, bone] of bones) {
    const standing = stance.get(boneName);
    if (!standing && !ANIMATED_BONE.test(boneName)) continue;
    const trackName = bone.name;
    const base = standing ?? bone.quaternion;
    const times = [];
    const values = [];
    for (let frame = 0; frame <= STANDING_FRAMES; frame += 1) {
      const phase = frame / STANDING_FRAMES * Math.PI * 2;
      offset.setFromEuler(breathOffset(boneName, phase, euler));
      rotation.copy(base).multiply(offset);
      times.push(frame / STANDING_FRAMES * STANDING_SECONDS);
      rotation.toArray(values, values.length);
    }
    // Keyed by bone name like the authored clips: the mixer keeps one
    // accumulator per binding path, so a uuid path and a name path on the same
    // bone would write it independently and fades between the authored and the
    // generated clip would freeze the legs at whichever wrote last.
    tracks.push(new THREE.QuaternionKeyframeTrack(`${trackName}.quaternion`, times, values));
  }
  return new THREE.AnimationClip(name, STANDING_SECONDS, tracks);
}
