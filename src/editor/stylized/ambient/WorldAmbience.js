import { AmbientEffectsSystem } from './AmbientEffectsSystem.js';
import { BreathPuffs } from './BreathPuffs.js';
import { RidgePlumes } from './RidgePlumes.js';
import { ambientPresetName } from './ambientPresets.js';

/** Height above the orbit target that stands in for a walker's eyes. */
const ORBIT_EYE_HEIGHT = 1.7;

/**
 * The ambient layer hooked to the running world: tiles, water and ground from
 * the world store and terrain, light and time of day from the sky, wind from
 * the weather. Keeps main.js to one construction and one call a frame.
 */
export class WorldAmbience {
  /**
   * @param {object} options
   * @param {object} options.settings resolved stylizedSurface.ambientEffects
   * @param {object} options.terrainView InfiniteTerrainView
   * @param {() => object | null} options.getGenerator the world's water-aware generator
   * @param {(cellX: number, cellZ: number) => number} options.getTile
   * @param {number} options.tileSize
   * @param {object | null} options.skyView StylizedSkyView
   * @param {[number, number]} [options.defaultWindDirection] calm-weather breeze
   * @param {number} [options.snowLine] metres; crests above it can stream plumes
   */
  constructor({
    settings, terrainView, getGenerator, getTile, tileSize, skyView, defaultWindDirection = [1, 0], snowLine = 700,
  }) {
    this.terrainView = terrainView;
    this.getGenerator = getGenerator;
    this.skyView = skyView;
    this.defaultWind = { x: defaultWindDirection[0], z: defaultWindDirection[1] };
    this.focus = { x: 0, y: 0, z: 0 };
    this.system = new AmbientEffectsSystem({
      scene: terrainView.scene,
      settings,
      getTile,
      getTileSize: () => tileSize,
      getWater: (x, z) => getGenerator()?.sampleWater?.(x / tileSize, -z / tileSize) ?? null,
      getGroundHeight: (x, z) => terrainView.getCanonicalHeight(x, z),
      sunDirection: skyView?.sunDirection ?? null,
    });
    this.addExtras(settings, snowLine);
  }

  /** Breath in the cold and plumes off the crests, driven by the same weights. */
  addExtras(settings, snowLine) {
    const system = this.system;
    if (!system.enabled) return;
    const shared = { light: system.light, sun: system.sun, puffTexture: system.puffTexture };
    if (settings.breath?.enabled) system.addExtra(new BreathPuffs({ settings: settings.breath, ...shared }));
    if (settings.plumes?.enabled) {
      system.addExtra(new RidgePlumes({
        settings: settings.plumes,
        ...shared,
        getHeight: (x, z) => this.terrainView.getCanonicalHeight(x, z),
        getSnowLine: () => snowLine,
      }));
    }
  }

  /**
   * @param {number} delta seconds
   * @param {object} state
   * @param {import('three').Camera} state.camera
   * @param {boolean} state.walking the camera is the walker's
   * @param {{ x: number, z: number } | null} state.orbitFocus render space, when orbiting
   * @param {object} state.weather { enabled, mode, intensity, windX, windZ }
   * @param {string} state.skyPreset
   * @param {boolean} state.night
   * @param {number} state.snowCountry 0..1
   * @param {object | null} [state.player] the walker, for breath
   */
  update(delta, { camera, walking, orbitFocus, weather, skyPreset, night, snowCountry, player = null }) {
    if (!this.system.enabled) return;
    const origin = this.terrainView.floatingOrigin.getState();
    if (walking || !orbitFocus) {
      this.focus.x = camera.position.x;
      this.focus.y = camera.position.y;
      this.focus.z = camera.position.z;
    } else {
      this.focus.x = orbitFocus.x;
      this.focus.z = orbitFocus.z;
      const ground = this.terrainView.getCanonicalHeight(orbitFocus.x + origin.x, orbitFocus.z + origin.z);
      this.focus.y = (Number.isFinite(ground) ? ground : camera.position.y) + ORBIT_EYE_HEIGHT;
    }
    const sky = this.skyView;
    if (sky?.directional && sky?.hemisphere) {
      this.system.setLight({
        sunColor: sky.directional.color,
        sunIntensity: sky.directional.intensity,
        skyColor: sky.hemisphere.color,
        skyIntensity: sky.hemisphere.intensity,
      });
    }
    this.system.update(delta, {
      focus: this.focus,
      origin,
      presetName: ambientPresetName({ skyPreset, weatherMode: weather.enabled ? weather.mode : 'off', night }),
      wind: this.windFor(weather),
      snowCountry,
      seaLevel: this.getGenerator()?.seaLevel ?? 0,
      player,
    });
  }

  /** The weather's wind when it blows, else a light breeze at the reference strength. */
  windFor(weather) {
    const active = weather.enabled && weather.mode !== 'off';
    if (active) {
      const strength = Math.hypot(weather.windX, weather.windZ) * Math.max(0, weather.intensity ?? 0);
      if (strength > 1e-4) return { x: weather.windX, z: weather.windZ, strength };
    }
    return { ...this.defaultWind, strength: this.system.settings.windReference ?? 1 };
  }

  shiftWorld(shiftX, shiftZ) {
    this.system.shiftWorld(shiftX, shiftZ);
  }

  getState() {
    return this.system.getState();
  }

  dispose() {
    this.system.dispose();
  }
}
