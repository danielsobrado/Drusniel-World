/**
 * Grounds an authored character with a soft occlusion blob under the body and a
 * tight patch under each sole.
 *
 * Ported from grass-test. The real shadow falls wherever the sun sends it — long
 * and sideways at a low sun, or lost entirely in a shaded valley — which leaves a
 * standing character looking suspended. The body blob shrinks and fades as the
 * character leaves the ground, so a jump still reads as height; each sole's patch
 * fades as that foot lifts, so a stride plants one foot at a time. Both lie on
 * the terrain's own slope.
 */

import * as THREE from 'three';

const DEFAULTS = Object.freeze({
  // Fractions of the character's height.
  radius: 0.26,
  fadeHeight: 0.4,
  opacity: 0.82,
  color: '#0b1018',
  foot: Object.freeze({ radius: 0.05, fadeHeight: 0.035, opacity: 0.9 }),
});
/** Metres: the terrain-normal central difference, and the lift off the ground. */
const NORMAL_STEP = 0.6;
const SURFACE_LIFT = 0.04;
const VISIBLE_OPACITY = 0.005;
/** The ankle joint sits above the heel; the sole is this share of the height lower. */
const HEEL_DROP = 0.04;
const UP = new THREE.Vector3(0, 1, 0);

/** 1 on the ground, easing to 0 by `fade` metres above it. */
export function contactOpacity(heightAboveGround, fade, opacity) {
  if (!Number.isFinite(heightAboveGround)) return 0;
  const lift = THREE.MathUtils.clamp(heightAboveGround / fade, 0, 1);
  return opacity * (1 - lift) ** 2;
}

export class ContactShadow {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.parent where the blobs live (the scene)
   * @param {{ heightAt(x: number, z: number): number }} options.terrain
   * @param {ReturnType<import('./humanoidRig.js').collectHumanoidBones>} options.bones
   * @param {number} options.height character height, metres
   * @param {typeof import('./contactShadowBlob.js').createContactBlob} options.createBlob
   */
  constructor({ parent, terrain, bones, height, createBlob }) {
    this.terrain = terrain;
    this.height = height;
    this.body = createBlob('Hero contact shadow', DEFAULTS.color, 1.3);
    this.feet = ['Left', 'Right'].map((side) => ({
      heel: bones.byName.get(`${side}Foot`),
      toe: bones.byName.get(`${side}Toe_End`)
        ?? bones.byName.get(`${side}Toe_end`)
        ?? bones.byName.get(`${side}ToeBase`)
        ?? null,
      blob: createBlob(`Hero ${side.toLowerCase()} sole shadow`, DEFAULTS.color, 1.8),
    }));
    this.meshes = [this.body.mesh, ...this.feet.map((foot) => foot.blob.mesh)];
    parent.add(...this.meshes);
    this.heel = new THREE.Vector3();
    this.toe = new THREE.Vector3();
    this.normal = new THREE.Vector3();
  }

  hide() {
    for (const mesh of this.meshes) mesh.visible = false;
  }

  /**
   * @param {number} x world position of the character
   * @param {number} z
   * @param {number} footY world height of the character's feet
   * @param {number} facing body heading
   */
  update(x, z, footY, facing) {
    const ground = this.terrain.heightAt(x, z);
    const opacity = contactOpacity(footY - ground, this.height * DEFAULTS.fadeHeight, DEFAULTS.opacity);
    const mesh = this.body.mesh;
    mesh.visible = opacity > VISIBLE_OPACITY;
    if (mesh.visible) {
      this.body.setOpacity(opacity);
      const lift = 1 - Math.sqrt(opacity / DEFAULTS.opacity);
      const radius = this.height * DEFAULTS.radius * (1 - lift * 0.35);
      this._lieOnTerrain(mesh, x, z, facing);
      // Wider across the shoulders than from toe to heel.
      mesh.scale.set(radius, 1, radius * 0.72);
      mesh.position.set(x, ground + SURFACE_LIFT, z);
    }
    for (const foot of this.feet) this._updateFoot(foot);
  }

  _updateFoot(foot) {
    const mesh = foot.blob.mesh;
    if (!foot.heel || !foot.toe) {
      mesh.visible = false;
      return;
    }
    foot.heel.getWorldPosition(this.heel);
    foot.toe.getWorldPosition(this.toe);
    const x = (this.heel.x + this.toe.x) / 2;
    const z = (this.heel.z + this.toe.z) / 2;
    const ground = this.terrain.heightAt(x, z);
    const sole = Math.min(this.toe.y, this.heel.y - this.height * HEEL_DROP);
    const settings = DEFAULTS.foot;
    const opacity = contactOpacity(sole - ground, this.height * settings.fadeHeight, settings.opacity);
    mesh.visible = opacity > VISIBLE_OPACITY;
    if (!mesh.visible) return;
    foot.blob.setOpacity(opacity);
    const lift = 1 - Math.sqrt(opacity / settings.opacity);
    const length = Math.hypot(this.toe.x - this.heel.x, this.toe.z - this.heel.z);
    this._lieOnTerrain(mesh, x, z, Math.atan2(this.toe.x - this.heel.x, this.toe.z - this.heel.z));
    const radius = this.height * settings.radius * (1 + lift * 0.4);
    mesh.scale.set(radius, 1, Math.max(radius, length * 0.75 + radius * 0.4));
    mesh.position.set(x, ground + SURFACE_LIFT, z);
  }

  _lieOnTerrain(mesh, x, z, yaw) {
    const dx = this.terrain.heightAt(x + NORMAL_STEP, z) - this.terrain.heightAt(x - NORMAL_STEP, z);
    const dz = this.terrain.heightAt(x, z + NORMAL_STEP) - this.terrain.heightAt(x, z - NORMAL_STEP);
    this.normal.set(-dx, 2 * NORMAL_STEP, -dz).normalize();
    if (!Number.isFinite(this.normal.x)) this.normal.copy(UP);
    mesh.quaternion.setFromUnitVectors(UP, this.normal);
    mesh.rotateY(yaw);
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
