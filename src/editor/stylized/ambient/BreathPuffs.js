import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, cameraWorldMatrix, color, dot, float, mix, normalize, positionGeometry, positionWorld,
  smoothstep, texture, uv,
} from 'three/tsl';

import { presetWeight } from './ambientEffectsConfig.js';

/** Puff slots: a breath takes a few, so two or three breaths can hang at once. */
const SLOTS = 16;
/** Human-scale reference; the hero's height scales everything. */
const REFERENCE_HEIGHT = 1.8;
const EXHALE_SECONDS = 0.35;
const DRAG = 1.6;
const SKY_GAIN = 0.55;
const HEAD_PATTERN = /(^|[^a-z])head$/i;

function smoothstep01(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The player's breath condensing in snow country (after grass-test's
 * BreathPuffs). A handful of CPU puffs: unlike the GPU fields they must stay
 * where they were exhaled while the hero walks on, so they are integrated here
 * and uploaded as one small instanced attribute a frame. Hidden, and free, off
 * the snow. An AmbientEffectsSystem extra.
 */
export class BreathPuffs {
  constructor({ settings, light, sun, puffTexture }) {
    this.name = 'breath';
    this.settings = settings;
    this.intensity = 0;
    this.timer = 0;
    this.pending = 0;
    this.emitClock = 0;
    this.next = 0;
    this.lastMouth = null;
    this.mouthPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.puffs = Array.from({ length: SLOTS }, () => ({
      age: Infinity, life: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3(), seed: Math.random(),
    }));
    this.state = new Float32Array(SLOTS * 4);
    this.shape = new Float32Array(SLOTS * 2);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.stateAttribute = new THREE.InstancedBufferAttribute(this.state, 4);
    this.shapeAttribute = new THREE.InstancedBufferAttribute(this.shape, 2);
    this.stateAttribute.setUsage(THREE.DynamicDrawUsage);
    this.shapeAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('breathState', this.stateAttribute);
    this.geometry.setAttribute('breathShape', this.shapeAttribute);
    this.material = this.createMaterial(light, sun, puffTexture);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, SLOTS);
    this.mesh.name = 'ambient-breath';
    const identity = new THREE.Matrix4();
    for (let index = 0; index < SLOTS; index += 1) this.mesh.setMatrixAt(index, identity);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.head = null;
    this.headModel = null;
  }

  createMaterial(light, sun, puffTexture) {
    // breathState: position xyz and size; breathShape: opacity and variant.
    const state = attribute('breathState', 'vec4');
    const shape = attribute('breathShape', 'vec2');
    const right = cameraWorldMatrix.element(0).xyz;
    const up = cameraWorldMatrix.element(1).xyz;
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    material.name = 'ambient-breath';
    material.positionNode = state.xyz.add(right.mul(positionGeometry.x.mul(state.w)))
      .add(up.mul(positionGeometry.y.mul(state.w)));
    const sample = texture(puffTexture, uv());
    const variant = shape.y.mul(4).floor();
    const density = variant.lessThan(1).select(sample.r, variant.lessThan(2).select(sample.g,
      variant.lessThan(3).select(sample.b, sample.a)));
    const near = smoothstep(0.4, 1.4, cameraPosition.distance(positionWorld));
    material.opacityNode = density.mul(shape.x).mul(near).mul(float(this.settings.opacity));
    const mu = dot(normalize(positionWorld.sub(cameraPosition)), sun);
    const backlit = mu.max(0).pow(4);
    material.colorNode = color('#f2f6fa').mul(light.sun.mul(mix(float(0.35), float(1.6), backlit))
      .add(light.sky.mul(SKY_GAIN)));
    return material;
  }

  /** The head bone's world position, or a point above the hero's root. */
  mouth(source, target) {
    const { model, height, facing } = source;
    if (model !== this.headModel) {
      this.headModel = model;
      this.head = null;
      model?.traverse((object) => {
        if (!this.head && object.isBone && HEAD_PATTERN.test(object.name)) this.head = object;
      });
    }
    const scale = height / REFERENCE_HEIGHT;
    const forwardX = Math.sin(facing);
    const forwardZ = Math.cos(facing);
    if (this.head) {
      this.head.getWorldPosition(target);
      target.y -= 0.06 * scale;
    } else {
      model.getWorldPosition(target);
      target.y += height * 0.9;
    }
    target.x += forwardX * 0.12 * scale;
    target.z += forwardZ * 0.12 * scale;
    return target;
  }

  /** @param {number} delta @param {object} state AmbientEffectsSystem state (weights, presetName, player) */
  update(delta, state) {
    const s = this.settings;
    const cold = smoothstep01(s.minSnow, Math.min(1, s.minSnow + 0.3), state.weights?.snow ?? 0);
    const weight = cold * s.strength * presetWeight(s, state.presetName);
    const source = weight > 0 ? state.player?.breathSource?.() : null;
    this.intensity = weight;
    const scale = (source?.height > 0 ? source.height : REFERENCE_HEIGHT) / REFERENCE_HEIGHT;
    if (source?.model) {
      const mouth = this.mouth(source, this.mouthPosition);
      if (this.lastMouth && delta > 0) {
        this.velocity.subVectors(mouth, this.lastMouth).divideScalar(delta);
        // A teleport is not a velocity.
        if (this.velocity.lengthSq() > 900 * scale * scale) this.velocity.set(0, 0, 0);
      }
      (this.lastMouth ??= new THREE.Vector3()).copy(mouth);
      const period = source.running ? s.runningPeriod : s.period;
      this.timer += delta;
      if (this.timer >= period) {
        this.timer %= period;
        this.pending = s.puffsPerBreath;
        this.emitClock = 0;
      }
      // The puffs of one breath leave over the exhale, not all at once.
      this.emitClock += delta;
      const interval = EXHALE_SECONDS / s.puffsPerBreath;
      while (this.pending > 0 && this.emitClock >= 0) {
        this.emit(mouth, source.facing, scale);
        this.pending -= 1;
        this.emitClock -= interval;
      }
    } else {
      this.lastMouth = null;
    }
    this.integrate(delta, scale);
  }

  integrate(delta, scale) {
    const s = this.settings;
    const damping = Math.exp(-DRAG * delta);
    let alive = 0;
    for (let index = 0; index < SLOTS; index += 1) {
      const puff = this.puffs[index];
      puff.age += delta;
      const t = puff.age / puff.life;
      if (t < 1) {
        alive += 1;
        puff.velocity.multiplyScalar(damping);
        puff.velocity.y += 0.12 * scale * delta;
        puff.position.addScaledVector(puff.velocity, delta);
        const size = (s.size[0] + (s.size[1] - s.size[0]) * Math.sqrt(t)) * scale;
        const envelope = smoothstep01(0, 0.12, t) * (1 - smoothstep01(0.35, 1, t));
        this.state.set([puff.position.x, puff.position.y, puff.position.z, size], index * 4);
        this.shape[index * 2] = envelope * this.intensity;
        this.shape[index * 2 + 1] = puff.seed;
      } else {
        this.state[index * 4 + 3] = 0;
        this.shape[index * 2] = 0;
      }
    }
    this.mesh.visible = alive > 0;
    if (alive > 0) {
      this.stateAttribute.needsUpdate = true;
      this.shapeAttribute.needsUpdate = true;
    }
  }

  emit(mouth, facing, scale) {
    const puff = this.puffs[this.next];
    this.next = (this.next + 1) % SLOTS;
    const speed = this.settings.speed * scale * (0.75 + Math.random() * 0.5);
    puff.age = 0;
    puff.life = this.settings.lifetime * (0.8 + Math.random() * 0.4);
    puff.seed = Math.random();
    puff.position.copy(mouth);
    puff.velocity.set(Math.sin(facing) * speed, -0.15 * speed, Math.cos(facing) * speed)
      .addScaledVector(this.velocity, 0.85);
  }

  /** Puffs in the air ride floating-origin snaps. */
  shiftWorld(shiftX, shiftZ) {
    for (const puff of this.puffs) {
      puff.position.x -= shiftX;
      puff.position.z -= shiftZ;
    }
    if (this.lastMouth) {
      this.lastMouth.x -= shiftX;
      this.lastMouth.z -= shiftZ;
    }
  }

  getState() {
    return { intensity: Number(this.intensity.toFixed(3)), visible: this.mesh.visible };
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
