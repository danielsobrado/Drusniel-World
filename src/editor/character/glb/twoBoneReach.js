/**
 * Two-bone reach on a live three.js skeleton, shared by the legs (foot
 * placement) and the arms (cast pose).
 *
 * Adapted from grass-test's `FootPlacement`. It works on top of whatever the
 * mixer just wrote: the middle joint bends within the plane the animation
 * already put it in, so a knee keeps bending forward and an elbow keeps bending
 * the way the clip bent it, then the root swings the chain so its end lands on
 * the target. Only a fully straight chain has no plane of its own; that one
 * bends about the caller's fallback axis.
 */

import * as THREE from 'three';

const EPSILON = 1e-3;

export function createReachScratch() {
  return {
    rootPosition: new THREE.Vector3(),
    midPosition: new THREE.Vector3(),
    endPosition: new THREE.Vector3(),
    toRoot: new THREE.Vector3(),
    toEnd: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    /** Free for callers to build a rotation in before `rotateBoneInWorld`. */
    rotation: new THREE.Quaternion(),
    local: new THREE.Quaternion(),
    parentRotation: new THREE.Quaternion(),
    inverseParent: new THREE.Quaternion(),
  };
}

/** Rotate a bone by a world-space rotation, keeping its parent where it is. */
export function rotateBoneInWorld(bone, rotation, scratch) {
  bone.parent.getWorldQuaternion(scratch.parentRotation);
  scratch.inverseParent.copy(scratch.parentRotation).invert();
  const local = scratch.local.copy(rotation)
    .premultiply(scratch.inverseParent)
    .multiply(scratch.parentRotation);
  bone.quaternion.premultiply(local);
  bone.updateWorldMatrix(false, true);
}

/**
 * Bend `mid` and swing `root` so `end` reaches `target` (world space), as far
 * as the chain's lengths allow.
 *
 * @param {{ root: THREE.Bone, mid: THREE.Bone, end: THREE.Bone }} chain
 * @param {THREE.Vector3} target
 * @param {THREE.Vector3} fallbackAxis world axis to bend a straight chain about
 * @param {ReturnType<typeof createReachScratch>} scratch
 */
export function reachWithTwoBones(chain, target, fallbackAxis, scratch) {
  const { root, mid, end } = chain;
  root.getWorldPosition(scratch.rootPosition);
  mid.getWorldPosition(scratch.midPosition);
  end.getWorldPosition(scratch.endPosition);

  const upper = scratch.rootPosition.distanceTo(scratch.midPosition);
  const lower = scratch.midPosition.distanceTo(scratch.endPosition);
  const reach = THREE.MathUtils.clamp(
    scratch.rootPosition.distanceTo(target),
    Math.abs(upper - lower) + EPSILON,
    upper + lower - EPSILON,
  );
  scratch.toRoot.copy(scratch.rootPosition).sub(scratch.midPosition).normalize();
  scratch.toEnd.copy(scratch.endPosition).sub(scratch.midPosition).normalize();
  const current = Math.acos(THREE.MathUtils.clamp(scratch.toRoot.dot(scratch.toEnd), -1, 1));
  const wanted = Math.acos(THREE.MathUtils.clamp(
    (upper * upper + lower * lower - reach * reach) / (2 * upper * lower),
    -1,
    1,
  ));
  scratch.axis.crossVectors(scratch.toRoot, scratch.toEnd);
  if (scratch.axis.lengthSq() < 1e-8) scratch.axis.copy(fallbackAxis);
  scratch.axis.normalize();
  rotateBoneInWorld(mid, scratch.rotation.setFromAxisAngle(scratch.axis, wanted - current), scratch);

  end.getWorldPosition(scratch.endPosition);
  scratch.from.copy(scratch.endPosition).sub(scratch.rootPosition).normalize();
  scratch.to.copy(target).sub(scratch.rootPosition).normalize();
  rotateBoneInWorld(root, scratch.rotation.setFromUnitVectors(scratch.from, scratch.to), scratch);
}
