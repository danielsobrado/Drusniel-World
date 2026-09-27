/**
 * The soft dark disc a contact shadow is drawn with: a dark core falling off
 * smoothly to nothing, like ambient occlusion rather than a hard-edged decal.
 * Ported from grass-test (`ContactShadow.js`).
 */

import * as THREE from 'three/webgpu';
import { color, float, smoothstep, uniform, uv } from 'three/tsl';

/**
 * @param {string} name
 * @param {string} tint CSS colour of the shade
 * @param {number} sharpness exponent on the falloff; higher is a tighter core
 * @returns {{ mesh: THREE.Mesh, setOpacity(value: number): void }}
 */
export function createContactBlob(name, tint, sharpness) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.rotateX(-Math.PI / 2);
  const opacity = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const distance = uv().sub(0.5).length().mul(2);
  const falloff = smoothstep(float(0), float(1), distance.oneMinus());
  material.colorNode = color(tint);
  material.opacityNode = falloff.pow(sharpness).mul(opacity);
  material.fog = false;
  material.name = `${name} material`;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return {
    mesh,
    setOpacity(value) {
      opacity.value = value;
    },
  };
}
