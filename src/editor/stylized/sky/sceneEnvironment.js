import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * The scene's image-based light, after grass-test's `loadEnvironment`: a soft
 * outdoor HDR (Poly Haven's "Zwartkops Straight Morning", CC0) as
 * `scene.environment` at a low intensity.
 *
 * Standard materials take their ambient fill and their reflections from it.
 * Without one, anything metallic — the hero's armour above all — has nothing to
 * reflect and reads as a black cut-out against the light, and every standard
 * surface loses the soft sky fill the donor's look is built on.
 *
 * Loaded in the background; the world renders without it until it arrives.
 *
 * @param {THREE.Scene} scene
 * @param {{ url?: string, intensity?: number } | null | undefined} settings sky.environment
 * @returns {{ ready: Promise<THREE.Texture | null>, dispose: () => void }}
 */
export function applySceneEnvironment(scene, settings) {
  if (!settings?.url || settings.enabled === false) {
    return { ready: Promise.resolve(null), dispose() {} };
  }
  let texture = null;
  let disposed = false;
  const ready = new HDRLoader().loadAsync(settings.url)
    .then((loaded) => {
      if (disposed) {
        loaded.dispose();
        return null;
      }
      loaded.mapping = THREE.EquirectangularReflectionMapping;
      texture = loaded;
      scene.environment = loaded;
      scene.environmentIntensity = settings.intensity ?? 0.3;
      return loaded;
    })
    .catch((error) => {
      console.warn('Scene environment could not be loaded; lighting stays without it.', error);
      return null;
    });
  return {
    ready,
    dispose() {
      disposed = true;
      if (texture && scene.environment === texture) scene.environment = null;
      texture?.dispose();
    },
  };
}
