/**
 * Plants an authored character's feet on the ground under each of them.
 *
 * Ported from grass-test (`CharacterMotion.js`). The player's feet sit at one
 * height — the controller's `footY` — which on a slope is the uphill contact,
 * leaving the downhill foot hanging. So the pelvis sinks until the lower foot
 * can reach its ground, each leg is then solved as a two-bone chain to put its
 * ankle at its own ground height (the knee takes up the difference), and a
 * planted foot tilts to the slope. A foot lifted in a stride keeps its lift
 * above its own ground, and fades out of the correction as it lifts, so the
 * swing is left exactly as authored.
 *
 * The mixer's output is kept apart from the solve: `beginFrame` restores the
 * pose the mixer wrote last frame before it writes this frame's, so blending
 * always starts from the authored pose rather than from last frame's IK.
 */

import * as THREE from 'three';
import { createReachScratch, reachWithTwoBones, rotateBoneInWorld } from './twoBoneReach.js';

// Fractions of the character's height: the most the pelvis sinks to let the
// downhill foot reach the ground, and the swing lift over which a foot's
// correction fades out.
const MAX_PELVIS_DROP = 0.2;
const SWING_FADE = Object.freeze([0.04, 0.12]);
/** Radians: the most a planted foot tilts to follow the slope under it. */
const MAX_FOOT_TILT = 0.45;
/** Per-second rates at which the pelvis drop and each foot's weight settle. */
const PELVIS_RATE = 12;
const FOOT_RATE = 16;
/** Terrain normal sample spacing, as a fraction of the character's height. */
const NORMAL_STEP = 0.035;
const UP = new THREE.Vector3(0, 1, 0);

// Measured in world space after the character has been scaled and placed, so
// the solve does not care whether the rig was authored in metres, centimetres
// or under a scaled armature.
function measureAnkleHeight(model, chains, solesY, height) {
  const fallback = height * 0.065;
  if (!Number.isFinite(solesY) || chains.length === 0) return fallback;
  model.updateWorldMatrix(true, true);
  const ankle = new THREE.Vector3();
  let total = 0;
  let count = 0;
  for (const chain of chains) {
    chain.foot.getWorldPosition(ankle);
    const measured = ankle.y - solesY;
    if (!Number.isFinite(measured) || measured <= 0) continue;
    total += measured;
    count += 1;
  }
  if (count === 0) return fallback;
  return THREE.MathUtils.clamp(total / count, height * 0.01, height * 0.2);
}

export class FootPlacement {
  /**
   * @param {THREE.Object3D} model the scaled rig; its `position.y` is the pelvis drop handle
   * @param {{ heightAt(x: number, z: number): number }} terrain
   * @param {number} height character height, metres
   * @param {ReturnType<import('./humanoidRig.js').collectHumanoidBones>} bones
   * @param {number} solesY world height of the soles in the pose the model is in now
   */
  constructor(model, terrain, height, bones, solesY) {
    this.model = model;
    this.terrain = terrain;
    this.height = height;
    this.baseY = model.position.y;
    this.drop = 0;
    this.chains = [bones.left, bones.right].map((limb) => ({
      foot: limb.foot,
      bones: { root: limb.upLeg, mid: limb.leg, end: limb.foot },
      weight: 0,
      ankle: new THREE.Vector3(),
      ground: 0,
      lift: 0,
    }));
    this.solved = this.chains.flatMap((chain) => [chain.bones.root, chain.bones.mid, chain.bones.end])
      .map((bone) => ({ bone, input: bone.quaternion.clone(), output: null }));
    this.prepared = false;
    this.ankleHeight = measureAnkleHeight(model, this.chains, solesY, height);
    this.scratch = createReachScratch();
    this.target = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.tiltAxis = new THREE.Vector3();
    this.hipQuaternion = new THREE.Quaternion();
    this.kneeAxis = new THREE.Vector3();
  }

  /** Put back the mixer's last output before the mixer writes the next one. */
  beginFrame() {
    this.model.position.y = this.baseY;
    for (const entry of this.solved) {
      if (entry.output) entry.bone.quaternion.copy(entry.input);
    }
    this.prepared = true;
  }

  /**
   * @param {boolean} grounded whether the feet should seek the ground at all
   * @param {number} solesY world height of the controller's feet
   * @param {number} deltaSeconds
   */
  update(grounded, solesY, deltaSeconds) {
    if (!this.prepared) this.beginFrame();
    this.prepared = false;
    const step = Math.min(Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0), 0.1);
    const settle = (rate) => 1 - Math.exp(-rate * step);
    // The mixer has written the authored/blended pose. Keep that exact input so
    // it can be restored at the start of the next frame.
    for (const entry of this.solved) entry.input.copy(entry.bone.quaternion);
    this.model.position.y = this.baseY;
    this.model.updateMatrixWorld(true);

    let lowest = 0;
    for (const chain of this.chains) {
      chain.foot.getWorldPosition(chain.ankle);
      const ground = Number.isFinite(chain.ankle.x) && Number.isFinite(chain.ankle.z)
        ? this.terrain.heightAt(chain.ankle.x, chain.ankle.z)
        : Number.NaN;
      // Ground that cannot be sampled releases the foot rather than poisoning
      // the solve: it keeps its last good height while its weight fades out.
      if (Number.isFinite(ground)) chain.ground = ground;
      chain.lift = Math.max(0, chain.ankle.y - solesY - this.ankleHeight);
      const planted = 1 - THREE.MathUtils.smoothstep(
        chain.lift,
        SWING_FADE[0] * this.height,
        SWING_FADE[1] * this.height,
      );
      const target = grounded && Number.isFinite(ground) ? planted : 0;
      chain.weight += (target - chain.weight) * settle(FOOT_RATE);
      if (chain.weight > 0.001) lowest = Math.min(lowest, (chain.ground - solesY) * chain.weight);
    }
    const drop = grounded && Number.isFinite(lowest)
      ? Math.max(lowest, -MAX_PELVIS_DROP * this.height)
      : 0;
    this.drop += (drop - this.drop) * settle(PELVIS_RATE);
    if (!Number.isFinite(this.drop)) this.drop = 0;
    this.model.position.y = this.baseY + this.drop;
    this.model.updateMatrixWorld(true);

    for (const chain of this.chains) {
      if (chain.weight <= 0.001) continue;
      chain.foot.getWorldPosition(this.target);
      // The ankle's own ground plus its bind height and any stride lift.
      const goal = chain.ground + this.ankleHeight + chain.lift;
      this.target.y += (goal - this.target.y) * chain.weight;
      // A straight leg has no bend plane of its own; bend it like a knee.
      chain.bones.root.getWorldQuaternion(this.hipQuaternion);
      this.kneeAxis.set(1, 0, 0).applyQuaternion(this.hipQuaternion);
      reachWithTwoBones(chain.bones, this.target, this.kneeAxis, this.scratch);
      this._tiltFoot(chain);
    }
    for (const entry of this.solved) (entry.output ??= new THREE.Quaternion()).copy(entry.bone.quaternion);
  }

  _tiltFoot(chain) {
    const step = NORMAL_STEP * this.height;
    const x = this.target.x;
    const z = this.target.z;
    this.normal.set(
      this.terrain.heightAt(x - step, z) - this.terrain.heightAt(x + step, z),
      step * 2,
      this.terrain.heightAt(x, z - step) - this.terrain.heightAt(x, z + step),
    ).normalize();
    if (!Number.isFinite(this.normal.x)) return;
    const tilt = Math.min(MAX_FOOT_TILT, UP.angleTo(this.normal)) * chain.weight;
    this.tiltAxis.crossVectors(UP, this.normal);
    if (tilt <= 1e-3 || this.tiltAxis.lengthSq() <= 1e-8) return;
    rotateBoneInWorld(
      chain.foot,
      this.scratch.rotation.setFromAxisAngle(this.tiltAxis.normalize(), tilt),
      this.scratch,
    );
  }
}
