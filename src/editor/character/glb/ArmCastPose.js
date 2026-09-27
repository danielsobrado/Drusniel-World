/**
 * Raises an authored character's arms into a spell cast.
 *
 * The procedural drow solves its arms toward hand targets every frame, so its
 * cast is a blend of targets (`CharacterFigure._poseArms`). An authored rig has
 * only its clips, so the same read is laid over them: the leading (right) hand
 * reaches out along the aim, the trailing hand is held low and inboard in front
 * of the chest, and each hand is blended from where the clip put it toward that
 * target by the cast weight. Blended rather than switched, it composes with the
 * locomotion underneath — a character casting while running still runs.
 */

import * as THREE from 'three';
import { createReachScratch, reachWithTwoBones } from './twoBoneReach.js';

// Targets as multiples of the arm's own reach, so a dwarf and an elf cast alike.
const LEAD = Object.freeze({ along: 0.82, outward: 0.18, rise: 0.14 });
const TRAIL = Object.freeze({ forward: 0.5, inward: 0.3, drop: 0.3 });
const ACTIVE_WEIGHT = 0.001;

export class ArmCastPose {
  /**
   * @param {ReturnType<import('./humanoidRig.js').collectHumanoidBones>} bones
   */
  constructor(bones) {
    this.chains = {
      left: { root: bones.left.arm, mid: bones.left.foreArm, end: bones.left.hand },
      right: { root: bones.right.arm, mid: bones.right.foreArm, end: bones.right.hand },
    };
    this.scratch = createReachScratch();
    this.shoulder = new THREE.Vector3();
    this.elbow = new THREE.Vector3();
    this.hand = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.left = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.bendAxis = new THREE.Vector3();
  }

  /**
   * @param {number} weight 0..1 blend into the cast
   * @param {number} aimX world-space aim direction; need not be normalised
   * @param {number} aimY
   * @param {number} aimZ
   * @param {number} facing body heading; forward is (sin, 0, cos)
   */
  apply(weight, aimX, aimY, aimZ, facing) {
    if (!(weight > ACTIVE_WEIGHT)) return;
    this.forward.set(Math.sin(facing), 0, Math.cos(facing));
    // The rig faces +Z with its left hand toward +X, so the body's left is up × forward.
    this.left.set(Math.cos(facing), 0, -Math.sin(facing));
    this.aim.set(aimX, aimY, aimZ).normalize();

    this._reach(this.chains.right, -1, weight, true);
    this._reach(this.chains.left, 1, weight, false);
  }

  _reach(chain, side, weight, lead) {
    chain.root.getWorldPosition(this.shoulder);
    chain.mid.getWorldPosition(this.elbow);
    chain.end.getWorldPosition(this.hand);
    const reach = this.shoulder.distanceTo(this.elbow) + this.elbow.distanceTo(this.hand);
    this.target.copy(this.shoulder);
    if (lead) {
      this.target
        .addScaledVector(this.aim, LEAD.along * reach)
        .addScaledVector(this.left, side * LEAD.outward * reach)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, LEAD.rise * reach);
    } else {
      this.target
        .addScaledVector(this.forward, TRAIL.forward * reach)
        .addScaledVector(this.left, -side * TRAIL.inward * reach)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, -TRAIL.drop * reach);
    }
    this.target.lerpVectors(this.hand, this.target, weight);
    // A straight arm bends its elbow down and back: about the body's side axis.
    this.bendAxis.copy(this.left).multiplyScalar(side);
    reachWithTwoBones(chain, this.target, this.bendAxis, this.scratch);
  }
}
