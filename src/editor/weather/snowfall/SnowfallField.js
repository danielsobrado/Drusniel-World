import * as THREE from 'three/webgpu';

import { createSnowfallMaterial, createSnowfallUniforms } from './snowfallFieldMaterial.js';

/**
 * The flake populations: fine snow spread wide, medium flakes around the
 * player, and a few large out-of-focus flakes near the lens (negative radius).
 */
export const SNOWFALL_POPULATIONS = Object.freeze([
  Object.freeze({ count: 2600, width: 42, height: 22, radius: 0.028, fallSpeed: 1.0 }),
  Object.freeze({ count: 900, width: 14, height: 10, radius: 0.05, fallSpeed: 0.75 }),
  Object.freeze({ count: 48, width: 4.5, height: 4, radius: -0.13, fallSpeed: 0.55 }),
]);

export function snowfallFlakeCount(populations = SNOWFALL_POPULATIONS) {
  return populations.reduce((total, population) => total + population.count, 0);
}

/**
 * One quad per flake with its seed and population shape. Rank (seed.w) is
 * spread evenly within each population, so intensity thins every population
 * alike rather than dropping one.
 */
export function createSnowfallGeometry(populations = SNOWFALL_POPULATIONS, random = Math.random) {
  const count = snowfallFlakeCount(populations);
  const positions = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const seeds = new Float32Array(count * 4 * 4);
  const shapes = new Float32Array(count * 4 * 4);
  const indices = new Uint32Array(count * 6);
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  let flake = 0;
  for (const population of populations) {
    for (let index = 0; index < population.count; index += 1) {
      const seed = [random(), random(), random(), (index + random()) / population.count];
      const radius = population.radius * (0.7 + random() * 0.6);
      const shape = [population.width, population.height, radius, population.fallSpeed * (0.8 + random() * 0.4)];
      for (let vertex = 0; vertex < 4; vertex += 1) {
        const at = flake * 4 + vertex;
        positions.set([quad[vertex][0], quad[vertex][1], 0], at * 3);
        uvs.set([(quad[vertex][0] + 1) / 2, (quad[vertex][1] + 1) / 2], at * 2);
        seeds.set(seed, at * 4);
        shapes.set(shape, at * 4);
      }
      indices.set([0, 1, 2, 0, 2, 3].map((v) => flake * 4 + v), flake * 6);
      flake += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('snowSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute('snowShape', new THREE.BufferAttribute(shapes, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Gusts vary the wind's speed, never its direction. */
export function gustFactor(seconds) {
  return 1 + 0.35 * Math.sin(seconds * 0.37) + 0.2 * Math.sin(seconds * 1.13 + 1.7);
}

/**
 * The WebGPU snowfall, with the same handle the weather systems drive
 * (setTime, setIntensity, setCenter, setWind). The drift is integrated here,
 * frame by frame, from the wind and its gusts.
 */
export function createSnowfallField() {
  const uniforms = createSnowfallUniforms();
  const material = createSnowfallMaterial(uniforms);
  const geometry = createSnowfallGeometry();
  const wind = new THREE.Vector2(-0.62, 0.21);
  let lastTime = null;
  return {
    material,
    geometry,
    uniforms,
    setTime(seconds) {
      if (lastTime !== null) {
        const dt = Math.min(0.25, Math.max(0, seconds - lastTime));
        uniforms.drift.value.addScaledVector(wind, dt * gustFactor(seconds));
      }
      lastTime = seconds;
      uniforms.time.value = seconds;
    },
    setIntensity(value) {
      uniforms.intensity.value = value;
    },
    setCenter(center) {
      uniforms.center.value.copy(center);
    },
    setWind(x, z) {
      wind.set(x, z);
    },
    dispose() {
      material.dispose();
      geometry.dispose();
    },
  };
}
