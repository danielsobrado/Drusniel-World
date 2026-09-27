import * as THREE from 'three/webgpu';
import { texture, uniform, vec2 } from 'three/tsl';

/**
 * The ground under a patch of world around the camera, as a small texture a
 * vertex shader can read: ambient particles that hug the ground (spindrift,
 * blowing sand, pollen) sit on it rather than on a flat plane.
 *
 * Heights are stored in half floats relative to the patch centre's height,
 * which a uniform adds back, so they stay precise at any altitude. The patch
 * is rebuilt only when the camera leaves its middle, or the floating origin
 * moves under it.
 */
export class LocalGroundHeight {
  /**
   * @param {object} options
   * @param {(x: number, z: number) => number} options.getHeight canonical metres
   * @param {number} [options.resolution] texels per side
   * @param {number} [options.extent] metres per side
   */
  constructor({ getHeight, resolution = 64, extent = 128 }) {
    this.getHeight = getHeight;
    this.resolution = resolution;
    this.extent = extent;
    this.data = new Uint16Array(resolution * resolution);
    this.texture = new THREE.DataTexture(
      this.data,
      resolution,
      resolution,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.uniforms = {
      /** Render-space corner of the patch (minimum x, z). */
      corner: uniform(new THREE.Vector2()),
      extent: uniform(extent),
      base: uniform(0),
    };
    this.center = null;
    this.origin = { x: Number.NaN, z: Number.NaN };
    this.rebuilds = 0;
  }

  /** Ground height (metres, render space) under a render-space point. */
  heightNode(x, z) {
    const { corner, extent, base } = this.uniforms;
    // Samples sit on the patch's corners and edges (`rebuild` steps
    // extent / (resolution − 1)), while a texel's centre is at (i + 0.5) /
    // resolution: map onto the centres so each sample is read where it was taken.
    const resolution = this.resolution;
    const uv = vec2(x, z).sub(corner).div(extent).clamp(0, 1)
      .mul((resolution - 1) / resolution)
      .add(0.5 / resolution);
    return texture(this.texture, uv).level(0).r.add(base);
  }

  /**
   * @param {{ x: number, z: number }} focus render space
   * @param {{ x: number, z: number }} origin floating origin (canonical of render zero)
   * @returns {boolean} whether the patch was rebuilt
   */
  update(focus, origin) {
    const originMoved = origin.x !== this.origin.x || origin.z !== this.origin.z;
    const drift = this.center ? Math.max(Math.abs(focus.x - this.center.x), Math.abs(focus.z - this.center.z)) : Infinity;
    if (!originMoved && drift < this.extent / 4) return false;
    this.rebuild(focus, origin);
    return true;
  }

  rebuild(focus, origin) {
    const { resolution, extent } = this;
    const step = extent / (resolution - 1);
    // Snapped so a patch rebuilt nearby samples the same ground at the same texels.
    const centerX = Math.round(focus.x / step) * step;
    const centerZ = Math.round(focus.z / step) * step;
    const cornerX = centerX - extent / 2;
    const cornerZ = centerZ - extent / 2;
    const base = this.getHeight(centerX + origin.x, centerZ + origin.z);
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const height = this.getHeight(cornerX + column * step + origin.x, cornerZ + row * step + origin.z);
        this.data[row * resolution + column] = THREE.DataUtils.toHalfFloat(
          Number.isFinite(height) && Number.isFinite(base) ? height - base : 0,
        );
      }
    }
    this.uniforms.corner.value.set(cornerX, cornerZ);
    this.uniforms.base.value = Number.isFinite(base) ? base : 0;
    this.texture.needsUpdate = true;
    this.center = { x: centerX, z: centerZ };
    this.origin = { x: origin.x, z: origin.z };
    this.rebuilds += 1;
  }

  dispose() {
    this.texture.dispose();
  }
}
