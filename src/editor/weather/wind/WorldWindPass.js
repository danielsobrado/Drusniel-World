/**
 * Renders the world wind field into `worldWindTarget` once per frame, and
 * answers CPU queries for the same field.
 *
 * The texture window follows the camera but is snapped to whole texels in
 * canonical coordinates, so it neither swims as the camera moves nor jumps when
 * the floating origin rebases. The prevailing wind comes from the weather: its
 * wind vector sets the direction and scales the intensity; with weather off the
 * configured default blows.
 *
 * Cost: one 128 × 128 full-screen pass (≈16k field evaluations) per frame,
 * instead of the same evaluation per grass vertex.
 */

import * as THREE from 'three/webgpu';
import { float, uniform, uv, vec2, vec4 } from 'three/tsl';
import { createWindFieldNode, resolveWindFieldConfig, sampleWindFieldCpu } from './windFieldModel.js';
import {
  WIND_TEXTURE_SIZE,
  WIND_WINDOW_METRES,
  worldWindTarget,
  worldWindUniforms,
} from './worldWindState.js';

const RAD_TO_DEG = 180 / Math.PI;
/** Weather wind magnitude → field intensity: calm air still moves a little. */
const INTENSITY_FLOOR = 0.45;
const INTENSITY_PER_UNIT = 0.35;
const INTENSITY_CEILING = 2.4;

/**
 * Prevailing wind from the weather settings.
 * @returns {{ directionDegrees: number, intensity: number }}
 */
export function prevailingWindFromWeather(weather, fallbackDirection) {
  const x = Number(weather?.windX);
  const z = Number(weather?.windZ);
  const magnitude = Math.hypot(x, z);
  if (!weather?.enabled || !(magnitude > 1e-4)) {
    return {
      directionDegrees: Math.atan2(fallbackDirection[1], fallbackDirection[0]) * RAD_TO_DEG,
      intensity: 1,
    };
  }
  const intensity = Math.min(
    INTENSITY_CEILING,
    INTENSITY_FLOOR + magnitude * INTENSITY_PER_UNIT * (0.5 + Number(weather.intensity ?? 1) * 0.5),
  );
  return { directionDegrees: Math.atan2(z, x) * RAD_TO_DEG, intensity };
}

export class WorldWindPass {
  /**
   * @param {object} options
   * @param {object} [options.config] field overrides (`weather.windField`)
   * @param {[number, number]} [options.defaultDirection] prevailing direction with weather off
   */
  constructor({ config = {}, defaultDirection = [1, 0] } = {}) {
    this.params = resolveWindFieldConfig(config);
    this.defaultDirection = defaultDirection;
    this.time = 0;
    this.directionDegrees = 0;
    this.intensity = 1;
    this.centerCanonical = { x: 0, z: 0 };
    this.origin = { x: 0, z: 0 };
    worldWindUniforms.referenceStrength.value = this.params.baseStrength;

    this.uniforms = {
      time: uniform(0),
      directionDegrees: uniform(0),
      intensity: uniform(1),
      centerCanonical: uniform(new THREE.Vector2()),
      size: uniform(WIND_WINDOW_METRES),
    };
    const canonical = this.uniforms.centerCanonical.add(uv().sub(0.5).mul(this.uniforms.size));
    const field = createWindFieldNode({
      positionXZ: vec2(canonical),
      timeNode: this.uniforms.time,
      directionDegrees: this.uniforms.directionDegrees,
      intensity: this.uniforms.intensity,
      params: this.params,
    });
    this.material = new THREE.NodeMaterial();
    this.material.name = 'world-wind-field';
    this.material.fragmentNode = vec4(field.direction.mul(field.strength), field.gust, float(field.strength));
    this.material.toneMapped = false;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.quad = new THREE.QuadMesh(this.material);
  }

  /**
   * @param {number} dt seconds
   * @param {{ x: number, z: number }} cameraRender camera position, render space
   * @param {{ x: number, z: number }} origin floating-origin offset (canonical = render + origin)
   * @param {object} [weather] `{ enabled, windX, windZ, intensity }`
   */
  update(dt, cameraRender, origin, weather = null) {
    this.time += Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.25);
    const prevailing = prevailingWindFromWeather(weather, this.defaultDirection);
    this.directionDegrees = prevailing.directionDegrees;
    this.intensity = prevailing.intensity;
    this.origin = { x: origin.x, z: origin.z };

    const texel = WIND_WINDOW_METRES / WIND_TEXTURE_SIZE;
    const centerX = Math.round((cameraRender.x + origin.x) / texel) * texel;
    const centerZ = Math.round((cameraRender.z + origin.z) / texel) * texel;
    this.centerCanonical = { x: centerX, z: centerZ };

    this.uniforms.time.value = this.time;
    this.uniforms.directionDegrees.value = this.directionDegrees;
    this.uniforms.intensity.value = this.intensity;
    this.uniforms.centerCanonical.value.set(centerX, centerZ);
    worldWindUniforms.windowCenter.value.set(centerX - origin.x, centerZ - origin.z);
    worldWindUniforms.windowCenterCanonical.value.set(centerX, centerZ);
    const radians = this.directionDegrees / RAD_TO_DEG;
    worldWindUniforms.prevailing.value.set(Math.cos(radians), Math.sin(radians));
    worldWindUniforms.prevailingStrength.value = this.params.baseStrength * this.intensity;
  }

  /** Draw this frame's field. Call before the scene renders. */
  render(renderer) {
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT?.() ?? null;
    renderer.setMRT?.(null);
    renderer.setRenderTarget(worldWindTarget);
    try {
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT?.(previousMrt);
    }
  }

  /**
   * The field at a render-space point, for CPU consumers (cloth, particles, audio).
   * @returns {ReturnType<typeof sampleWindFieldCpu>}
   */
  sample(renderX, renderZ) {
    return sampleWindFieldCpu({
      x: renderX + this.origin.x,
      z: renderZ + this.origin.z,
      time: this.time,
      directionDegrees: this.directionDegrees,
      intensity: this.intensity,
      params: this.params,
    });
  }

  dispose() {
    this.material.dispose();
  }
}
