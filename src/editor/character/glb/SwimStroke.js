/**
 * Poses an authored rig swimming, over whatever the mixer wrote.
 *
 * No roster rig ships a swim clip, and the bone axes differ between rig
 * generations, so the swim is described the way a coach would — where each hand
 * and foot goes through the cycle, in the body's own frame — and each limb is
 * then solved onto that path with the shared two-bone reach. That frame is the
 * model's own, after the body pitch, so the same targets serve a figure
 * treading water upright and one lying flat in a crawl.
 *
 *   Treading    hands scull in and out in front of the chest; the legs turn
 *               a slow eggbeater, knees bent.
 *   Front crawl each arm reaches overhead, pulls down under the body to the hip
 *               and recovers wide over the back, half a cycle apart; the legs
 *               flutter-kick three beats per arm cycle.
 *
 * The two are blended by `stroke`, the whole layer by `weight`.
 */

import * as THREE from 'three';
import { createReachScratch, reachWithTwoBones } from './twoBoneReach.js';

const TAU = Math.PI * 2;
const ACTIVE_WEIGHT = 0.001;

// Hand targets as multiples of arm reach, foot targets of leg length.
const CRAWL_ARM = Object.freeze({ overhead: 0.85, underneath: 0.4, overBack: 0.5, lateral: 0.1, wideRecovery: 0.2 });
const TREAD_ARM = Object.freeze({ forward: 0.45, down: 0.5, out: 0.3, scull: 0.18 });
const CRAWL_LEG = Object.freeze({ extension: 0.95, kick: 0.12, beats: 3 });
const TREAD_LEG = Object.freeze({ extension: 0.78, circle: 0.12, out: 0.1, lift: 0.06 });

export class SwimStroke {
  /**
   * @param {THREE.Object3D} model the rig root; its world rotation is the body frame
   * @param {ReturnType<import('./humanoidRig.js').collectHumanoidBones>} bones
   */
  constructor(model, bones) {
    this.model = model;
    this.limbs = [
      { side: 1, arm: chain(bones.left.arm, bones.left.foreArm, bones.left.hand), leg: chain(bones.left.upLeg, bones.left.leg, bones.left.foot) },
      { side: -1, arm: chain(bones.right.arm, bones.right.foreArm, bones.right.hand), leg: chain(bones.right.upLeg, bones.right.leg, bones.right.foot) },
    ];
    this.scratch = createReachScratch();
    this.frame = new THREE.Quaternion();
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.left = new THREE.Vector3();
    this.root = new THREE.Vector3();
    this.mid = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.tread = new THREE.Vector3();
    this.crawl = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  /**
   * @param {number} weight 0 on land … 1 swimming
   * @param {number} stroke 0 treading … 1 front crawl
   * @param {number} strokePhase crawl cycle position, 0..1
   * @param {number} treadPhase sculling cycle position, 0..1
   */
  apply(weight, stroke, strokePhase, treadPhase) {
    if (!(weight > ACTIVE_WEIGHT)) return;
    this.model.getWorldQuaternion(this.frame);
    this.forward.set(0, 0, 1).applyQuaternion(this.frame);
    this.up.set(0, 1, 0).applyQuaternion(this.frame);
    this.left.set(1, 0, 0).applyQuaternion(this.frame);

    for (const limb of this.limbs) {
      // The right arm and leg run half a cycle behind the left.
      const lag = limb.side > 0 ? 0 : 0.5;
      this._placeArm(limb, TAU * ((strokePhase + lag) % 1), TAU * treadPhase, stroke);
      this._solve(limb.arm, weight);
      this._placeLeg(limb, TAU * strokePhase, TAU * ((treadPhase + lag) % 1), stroke);
      this._solve(limb.leg, weight);
    }
  }

  _measure(limb) {
    limb.root.getWorldPosition(this.root);
    limb.mid.getWorldPosition(this.mid);
    limb.end.getWorldPosition(this.end);
    return this.root.distanceTo(this.mid) + this.mid.distanceTo(this.end);
  }

  _placeArm(limb, crawlAngle, treadAngle, stroke) {
    const reach = this._measure(limb.arm);
    const side = limb.side;
    // Pull (0..π) sweeps from overhead under the body to the hip; recovery
    // (π..2π) comes back over the back, swung wide.
    const sin = Math.sin(crawlAngle);
    const pulling = sin >= 0;
    this.crawl.copy(this.root)
      .addScaledVector(this.up, CRAWL_ARM.overhead * reach * Math.cos(crawlAngle))
      .addScaledVector(this.forward, (pulling ? CRAWL_ARM.underneath : CRAWL_ARM.overBack) * reach * sin)
      .addScaledVector(this.left, side * reach * (CRAWL_ARM.lateral + (pulling ? 0 : CRAWL_ARM.wideRecovery * -sin)));
    this.tread.copy(this.root)
      .addScaledVector(this.forward, TREAD_ARM.forward * reach)
      .addScaledVector(this.up, -TREAD_ARM.down * reach)
      .addScaledVector(this.left, side * reach * (TREAD_ARM.out + TREAD_ARM.scull * Math.sin(treadAngle)));
    limb.arm.goal.lerpVectors(this.tread, this.crawl, stroke);
    // A straight arm bends its elbow about the body's side axis.
    limb.arm.bend.copy(this.left).multiplyScalar(side);
  }

  _placeLeg(limb, crawlAngle, treadAngle, stroke) {
    const length = this._measure(limb.leg);
    this.crawl.copy(this.root)
      .addScaledVector(this.up, -CRAWL_LEG.extension * length)
      // The legs kick in opposition: half a beat apart.
      .addScaledVector(
        this.forward,
        CRAWL_LEG.kick * length * Math.sin(CRAWL_LEG.beats * crawlAngle + (limb.side > 0 ? 0 : Math.PI)),
      );
    this.tread.copy(this.root)
      .addScaledVector(this.up, length * (-TREAD_LEG.extension + TREAD_LEG.lift * Math.sin(treadAngle)))
      .addScaledVector(this.forward, TREAD_LEG.circle * length * Math.cos(treadAngle))
      .addScaledVector(this.left, limb.side * TREAD_LEG.out * length);
    limb.leg.goal.lerpVectors(this.tread, this.crawl, stroke);
    // A straight leg bends its knee forward, about the body's side axis.
    limb.leg.bend.copy(this.left);
  }

  _solve(limb, weight) {
    limb.end.getWorldPosition(this.target);
    this.target.lerp(limb.goal, weight);
    reachWithTwoBones(limb, this.target, limb.bend, this.scratch);
  }
}

function chain(root, mid, end) {
  return { root, mid, end, goal: new THREE.Vector3(), bend: new THREE.Vector3() };
}
