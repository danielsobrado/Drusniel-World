import * as THREE from "three";
import { createSnowShaderMaterial } from "./rainShaderMaterial.js";
import { SNOW_FLAKE_COUNT } from "./rain_constants.js";
import { DEFAULT_SNOW_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createSnowGeometry } from "./rain_geometry.js";
import { createSnowfallField, snowfallFlakeCount } from "./snowfall/SnowfallField.js";
import { clampWindWeatherSettings, isWeatherVisible } from "./weather_settings.js";
/**
 * How hard it snows in snow country with the weather off: a light, steady
 * fall over the snowfields, as the weather's snow mode at this intensity.
 */
const REGIONAL_SNOW_INTENSITY = 0.3;
class SnowWeatherSystem {
  group = new THREE.Group();
  snowMaterial;
  snowMesh;
  center = new THREE.Vector3();
  settings = { ...DEFAULT_SNOW_WEATHER_SETTINGS };
  regional = 0;
  flakeCount;
  constructor(options) {
    this.group.name = "weather-snow";
    // WebGPU draws the camera-facing, three-population field; WebGL keeps the
    // crossed-quad flakes its shader material was written for.
    if (options.isWebGpu) {
      this.snowMaterial = createSnowfallField();
      this.snowMesh = new THREE.Mesh(this.snowMaterial.geometry, this.snowMaterial.material);
      this.flakeCount = snowfallFlakeCount();
    } else {
      this.snowMaterial = createSnowShaderMaterial();
      this.snowMesh = new THREE.Mesh(createSnowGeometry(options.seed ?? 1374351373), this.snowMaterial.material);
      this.flakeCount = SNOW_FLAKE_COUNT;
    }
    this.snowMesh.name = "weather-snow-flakes";
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 40;
    this.group.add(this.snowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampWindWeatherSettings(settings);
    this.snowMaterial.setWind(this.settings.windX, this.settings.windZ);
    this.refresh();
  }
  /**
   * Snow country (0..1) snows lightly whatever the weather; the weather's snow
   * mode can only make it heavier.
   */
  setRegionalSnow(amount) {
    this.regional = Math.max(0, Math.min(1, Number(amount) || 0));
    this.refresh();
  }
  effectiveIntensity() {
    const weather = isWeatherVisible(this.settings) ? this.settings.intensity : 0;
    return Math.max(weather, this.regional * REGIONAL_SNOW_INTENSITY);
  }
  refresh() {
    const intensity = this.effectiveIntensity();
    this.group.visible = intensity > 1e-3;
    this.snowMaterial.setIntensity(intensity);
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.center.copy(cameraPosition);
    this.snowMaterial.setCenter(this.center);
    this.snowMaterial.setTime(elapsedSeconds);
  }
  getStats() {
    return { flakes: this.group.visible ? this.flakeCount : 0 };
  }
  dispose() {
    this.group.removeFromParent();
    this.snowMesh.geometry.dispose();
    this.snowMaterial.dispose();
  }
}
export {
  REGIONAL_SNOW_INTENSITY,
  SnowWeatherSystem
};
