import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';

import { createSprayPuffTexture } from '../mist/sprayPuffTexture.js';
import { presetWeight, windFactor } from './ambientEffectsConfig.js';
import { AmbientParticleField, FIELD_VISIBILITY_THRESHOLD } from './AmbientParticleField.js';
import { ambientRegionWeights, regionWeight, sampleAmbientSurroundings } from './ambientRegions.js';
import { LocalGroundHeight } from './LocalGroundHeight.js';

const TWO_PI = Math.PI * 2;
const MAX_STEP_SECONDS = 0.1;
/** A focus jump longer than this is a teleport: weights snap instead of easing. */
const SNAP_DISTANCE = 60;

function ease(current, target, rate, delta) {
  const eased = target + (current - target) * Math.exp(-rate * delta);
  return Math.abs(eased - target) < FIELD_VISIBILITY_THRESHOLD ? target : eased;
}

/**
 * The ambient layer (after grass-test's AmbientEffectsSystem): cheap GPU
 * particle fields that give each region its air — diamond dust and spindrift
 * in snow country, blowing sand and surf spray on the coast, pollen, seeds and
 * fireflies over meadows, spores and light shafts in jungle, midges and mist on
 * the water.
 *
 * Each field's strength is its region's weight at the focus × its preset
 * weight × the wind where it follows the wind, eased so nothing switches in a
 * single frame. `extras` (breath, plumes, surface uniforms) register on it and
 * are driven from the same weights.
 */
export class AmbientEffectsSystem {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {object} options.settings resolved ambientEffects
   * @param {(cellX: number, cellZ: number) => number} options.getTile
   * @param {() => number} options.getTileSize
   * @param {(x: number, z: number) => object | null} options.getWater canonical metres → water sample
   * @param {(x: number, z: number) => number} options.getGroundHeight canonical metres
   * @param {object | null} [options.sunDirection] live sun direction node
   * @param {string} [options.quality]
   */
  constructor({ scene, settings, getTile, getTileSize, getWater, getGroundHeight, sunDirection = null, quality = 'high' }) {
    this.settings = settings;
    this.enabled = settings.enabled;
    this.fields = [];
    this.extras = [];
    this.weights = null;
    this.windiness = 1;
    if (!this.enabled) return;
    this.getTile = getTile;
    this.getTileSize = getTileSize;
    this.getWater = getWater;
    this.getGroundHeight = getGroundHeight;
    this.ground = new LocalGroundHeight({ getHeight: getGroundHeight });
    this.levels = { sea: uniform(0), lake: uniform(-1e5), desert: uniform(0) };
    this.light = { sun: uniform(new THREE.Color(1, 1, 1)), sky: uniform(new THREE.Color(0.5, 0.6, 0.7)) };
    this.sun = sunDirection ?? vec3(0.35, 0.85, 0.25).normalize();
    this.puffTexture = createSprayPuffTexture();
    this.regionTimer = Infinity;
    this.lastFocus = null;
    this.elapsed = 0;
    this.wind = { x: 0, z: 0 };
    this.root = new THREE.Group();
    this.root.name = 'ambient-effects';
    this.root.renderOrder = 3;
    for (const fieldSettings of settings.fields) {
      const field = new AmbientParticleField({
        name: fieldSettings.name,
        settings: fieldSettings,
        ground: this.ground,
        levels: this.levels,
        light: this.light,
        sun: this.sun,
        puffTexture: this.puffTexture,
      });
      this.fields.push(field);
      this.root.add(field.mesh);
    }
    this.setQuality(quality);
    scene.add(this.root);
  }

  /** Something else driven by the ambient weights: `update(delta, state)`, `dispose()`. */
  addExtra(extra) {
    this.extras.push(extra);
    if (extra.mesh) this.root.add(extra.mesh);
    return extra;
  }

  setQuality(name) {
    if (!this.enabled) return;
    const share = this.settings.quality[name] ?? 1;
    for (const field of this.fields) field.setCount(field.settings.count * share);
  }

  /** Follow the scene's lights: sun colour × intensity and the sky's fill. */
  setLight({ sunColor, sunIntensity, skyColor, skyIntensity }) {
    if (!this.enabled) return;
    this.light.sun.value.copy(sunColor).multiplyScalar(sunIntensity / Math.PI);
    this.light.sky.value.copy(skyColor).multiplyScalar(skyIntensity / Math.PI);
  }

  sampleRegions(focus, origin, snowCountry, seaLevel) {
    const x = focus.x + origin.x;
    const z = focus.z + origin.z;
    const surroundings = sampleAmbientSurroundings({
      x,
      z,
      getTile: this.getTile,
      tileSize: this.getTileSize(),
      getWater: this.getWater,
    });
    const ground = this.getGroundHeight(x, z);
    this.weights = ambientRegionWeights({
      ...surroundings,
      heightAboveSea: Number.isFinite(ground) ? ground - seaLevel : 0,
      snow: snowCountry,
    });
    this.levels.lake.value = Number.isFinite(surroundings.lakeLevel) ? surroundings.lakeLevel : -1e5;
    this.levels.desert.value = this.weights.desert ?? 0;
  }

  /**
   * @param {number} deltaSeconds
   * @param {object} state
   * @param {{ x: number, y: number, z: number }} state.focus render space (the player or camera)
   * @param {{ x: number, z: number }} state.origin floating origin
   * @param {string} state.presetName grass-test preset (ambientPresets.js)
   * @param {{ x: number, z: number, strength: number }} state.wind direction and strength
   * @param {number} state.snowCountry 0..1
   * @param {number} state.seaLevel metres
   */
  update(deltaSeconds, state) {
    if (!this.enabled || !state.focus) return;
    const { focus, origin, presetName, wind, snowCountry = 0, seaLevel = 0 } = state;
    const delta = Math.min(Math.max(Number(deltaSeconds) || 0, 0), MAX_STEP_SECONDS);
    this.elapsed += delta;
    this.levels.sea.value = seaLevel;
    this.ground.update(focus, origin);

    const jumped = !this.lastFocus
      || Math.hypot(focus.x + origin.x - this.lastFocus.x, focus.z + origin.z - this.lastFocus.z) > SNAP_DISTANCE;
    this.lastFocus = { x: focus.x + origin.x, z: focus.z + origin.z };
    this.regionTimer += delta;
    if (jumped || !this.weights || this.regionTimer >= this.settings.regionInterval) {
      this.regionTimer = 0;
      this.sampleRegions(focus, origin, snowCountry, seaLevel);
    }
    this.weights.snow = Math.max(0, Math.min(1, snowCountry));

    const windLength = Math.hypot(wind.x, wind.z);
    const axis = windLength > 1e-6 ? { x: wind.x / windLength, z: wind.z / windLength } : { x: 1, z: 0 };
    this.windiness = Math.max(0, wind.strength) / this.settings.windReference;
    const gustSettings = this.settings.gust;
    const gust = 1 + gustSettings.strength * Math.sin(this.elapsed * TWO_PI / gustSettings.period)
      * (0.7 + 0.3 * Math.sin(this.elapsed * TWO_PI / (gustSettings.period * 0.37) + 1.3));
    const rate = jumped ? Infinity : this.settings.fadeRate;
    this.step = (current, target) => (rate === Infinity ? target : ease(current, target, rate, delta));

    for (const field of this.fields) {
      const s = field.settings;
      field.target = regionWeight(this.weights, s.regions) * presetWeight(s, presetName)
        * windFactor(this.windiness, s.windResponse);
      field.setIntensity(this.step(field.current, Math.min(field.target, 1)));
      if (!field.mesh.visible && field.target <= 0) continue;
      const speed = s.wind.speed * (1 + (Math.min(this.windiness, 2) - 1) * s.wind.follow) * gust;
      this.wind.x = axis.x * Math.max(speed, 0);
      this.wind.z = axis.z * Math.max(speed, 0);
      field.update(delta, focus, this.wind);
    }
    const shared = {
      weights: this.weights, presetName, windiness: this.windiness, gust, axis, focus, origin, step: this.step,
    };
    for (const extra of this.extras) extra.update(delta, { ...state, ...shared });
  }

  shiftWorld(shiftX, shiftZ) {
    for (const field of this.fields) field.shiftWorld(shiftX, shiftZ);
    for (const extra of this.extras) extra.shiftWorld?.(shiftX, shiftZ);
  }

  /** Snapshot for the dev console and capture scripts. */
  getState() {
    if (!this.enabled) return { enabled: false };
    return {
      weights: { ...this.weights },
      windiness: Number(this.windiness.toFixed(3)),
      groundRebuilds: this.ground.rebuilds,
      fields: Object.fromEntries(this.fields.map((field) => [field.name, {
        intensity: Number(field.current.toFixed(3)),
        target: Number(field.target.toFixed(3)),
        count: field.mesh.count,
      }])),
      extras: Object.fromEntries(this.extras.map((extra) => [extra.name, extra.getState?.() ?? null])),
    };
  }

  dispose() {
    for (const field of this.fields) field.dispose();
    for (const extra of this.extras) extra.dispose?.();
    this.ground?.dispose();
    this.puffTexture?.dispose();
    this.root?.removeFromParent();
  }
}
