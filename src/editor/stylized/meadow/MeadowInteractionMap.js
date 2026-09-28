import * as THREE from 'three/webgpu';

/**
 * Where the player's body pushes the meadow over, ported from grass-test's
 * `InteractionMap`: a small texture centred on the player, into which the body is
 * stamped as a sphere every frame. Blades read it and fold over; the stamp fades
 * (`recoverySpeed` per frame) so the grass stands back up behind the player.
 *
 * Everything is in render space, like the blades. The floating origin moving is
 * not the player moving: `shiftOrigin` re-bases the centre without scrolling the
 * ink, so a re-centre never smears the trail.
 *
 * The donor's optimisations are kept: recovery and scrolling touch only the
 * rectangle that has ink, and once the peak decays to zero nothing is uploaded.
 */
export class MeadowInteractionMap {
  /**
   * @param {object} options
   * @param {number} [options.resolution] texels per side
   * @param {number} [options.worldSize] metres across (the donor's 75 units)
   * @param {number} [options.recoverySpeed] share of the stamp kept each frame
   * @param {number} [options.strength]
   * @param {number} [options.bodyRadius] metres (the donor's 0.72 units)
   * @param {(x: number, z: number) => number} options.getHeight render-space ground
   */
  constructor({
    resolution = 256, worldSize = 27, recoverySpeed = 0.94, strength = 1, bodyRadius = 0.26, getHeight,
  }) {
    this.resolution = resolution;
    this.worldSize = worldSize;
    this.recoverySpeed = recoverySpeed;
    this.strength = strength;
    this.bodyRadius = bodyRadius;
    this.getHeight = getHeight;
    this.center = new THREE.Vector2();
    this.lastCenter = new THREE.Vector2();
    this.started = false;
    this.peak = 0;
    this.ink = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
    this.pixels = new Uint8Array(resolution * resolution * 4);
    this.scratch = new Uint8Array(resolution * resolution);
    this.clearPixels();
    this.texture = new THREE.DataTexture(this.pixels, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  clearPixels() {
    this.pixels.fill(0);
    for (let index = 3; index < this.pixels.length; index += 4) this.pixels[index] = 255;
  }

  hasInk() {
    return this.ink.maxX >= this.ink.minX && this.ink.maxY >= this.ink.minY;
  }

  clearInk() {
    Object.assign(this.ink, { minX: 0, minY: 0, maxX: -1, maxY: -1 });
  }

  addInk(minX, minY, maxX, maxY) {
    const ink = this.ink;
    if (!this.hasInk()) {
      Object.assign(ink, { minX, minY, maxX, maxY });
      return;
    }
    ink.minX = Math.min(ink.minX, minX);
    ink.minY = Math.min(ink.minY, minY);
    ink.maxX = Math.max(ink.maxX, maxX);
    ink.maxY = Math.max(ink.maxY, maxY);
  }

  /** The floating origin moved by (dx, dz): render coordinates shift by −(dx, dz). */
  shiftOrigin(dx, dz) {
    this.center.x -= dx;
    this.center.y -= dz;
    this.lastCenter.x -= dx;
    this.lastCenter.y -= dz;
  }

  /**
   * @param {{ x: number, y: number, z: number } | null} body render-space point to
   *   stamp (the player's feet), or null to only let the meadow recover
   */
  update(body) {
    if (body) {
      if (!this.started) {
        this.lastCenter.set(body.x, body.z);
        this.started = true;
      }
      if (this.peak > 0) this.scroll(body.x - this.lastCenter.x, body.z - this.lastCenter.y);
      this.lastCenter.set(body.x, body.z);
      this.center.set(body.x, body.z);
    }
    const hadInk = this.peak > 0;
    this.recover();
    if (body) this.paintSphere(body.x, body.y, body.z, this.bodyRadius, this.strength);
    if (hadInk || body) this.texture.needsUpdate = true;
  }

  recover() {
    if (this.peak === 0) return;
    const { minX, minY, maxX, maxY } = this.ink;
    const stride = this.resolution * 4;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * stride + x * 4;
        this.pixels[index] = Math.floor(this.pixels[index] * this.recoverySpeed);
      }
    }
    this.peak = Math.floor(this.peak * this.recoverySpeed);
    if (this.peak === 0) this.clearInk();
  }

  /** Scrolls the ink so it stays put in the world as the window follows the player. */
  scroll(deltaX, deltaZ) {
    const perMetre = this.resolution / this.worldSize;
    const shiftX = Math.trunc(deltaX * perMetre);
    const shiftY = Math.trunc(deltaZ * perMetre);
    if ((shiftX === 0 && shiftY === 0) || !this.hasInk()) return;
    const { minX: oldMinX, minY: oldMinY, maxX: oldMaxX, maxY: oldMaxY } = this.ink;
    const width = oldMaxX - oldMinX + 1;
    for (let y = oldMinY; y <= oldMaxY; y += 1) {
      for (let x = oldMinX; x <= oldMaxX; x += 1) {
        const offset = (y * this.resolution + x) * 4;
        this.scratch[(y - oldMinY) * width + (x - oldMinX)] = this.pixels[offset];
        this.pixels[offset] = 0;
      }
    }
    const last = this.resolution - 1;
    const minX = Math.max(0, oldMinX - shiftX);
    const maxX = Math.min(last, oldMaxX - shiftX);
    const minY = Math.max(0, oldMinY - shiftY);
    const maxY = Math.min(last, oldMaxY - shiftY);
    if (maxX < minX || maxY < minY) {
      this.clearInk();
      this.peak = 0;
      return;
    }
    Object.assign(this.ink, { minX, minY, maxX, maxY });
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        this.pixels[(y * this.resolution + x) * 4] = this.scratch[(y + shiftY - oldMinY) * width + (x + shiftX - oldMinX)];
      }
    }
  }

  /** Stamps a sphere; only where it reaches the ground does it press the grass. */
  paintSphere(x, y, z, radius, strength = 1) {
    const perMetre = this.resolution / this.worldSize;
    const centerX = ((x - this.center.x) / this.worldSize + 0.5) * this.resolution;
    const centerY = ((z - this.center.y) / this.worldSize + 0.5) * this.resolution;
    const pixelRadius = radius * perMetre;
    if (pixelRadius < 0.5) return;
    const minX = Math.max(0, Math.floor(centerX - pixelRadius));
    const maxX = Math.min(this.resolution - 1, Math.ceil(centerX + pixelRadius));
    const minY = Math.max(0, Math.floor(centerY - pixelRadius));
    const maxY = Math.min(this.resolution - 1, Math.ceil(centerY + pixelRadius));
    if (maxX < minX || maxY < minY) return;
    this.addInk(minX, minY, maxX, maxY);
    const radiusSquared = radius * radius;
    for (let py = minY; py <= maxY; py += 1) {
      const worldZ = this.center.y + ((py + 0.5) / this.resolution - 0.5) * this.worldSize;
      for (let px = minX; px <= maxX; px += 1) {
        const worldX = this.center.x + ((px + 0.5) / this.resolution - 0.5) * this.worldSize;
        const distanceSquared = (worldX - x) ** 2 + (worldZ - z) ** 2;
        if (distanceSquared > radiusSquared) continue;
        const ground = this.getHeight?.(worldX, worldZ);
        const reach = Math.sqrt(Math.max(0, radiusSquared - distanceSquared));
        if (Number.isFinite(ground) && y - reach > ground + 0.3) continue;
        const value = Math.floor(255 * strength * (1 - Math.sqrt(distanceSquared) / radius));
        const offset = (py * this.resolution + px) * 4;
        const next = Math.max(this.pixels[offset], value);
        this.pixels[offset] = next;
        if (next > this.peak) this.peak = next;
      }
    }
  }

  dispose() {
    this.texture.dispose();
  }
}
