/**
 * Growable typed arrays for one module's merged stone mesh.
 *
 * Stones are written straight into shared arrays — no per-stone
 * `BufferGeometry`, no `mergeGeometries` pass — which is most of what used to
 * make a module build expensive. The writer holds exactly four vertex streams
 * (position, normal, color, uv): WebGPU allows eight vertex buffers per
 * pipeline and a ninth makes the mesh vanish rather than slow down.
 *
 * Three.js-free, so the kernel that fills it can run in a worker.
 */

const MAX_UINT16_VERTEX = 65_535;

function grow(array, minimumLength) {
  let length = array.length;
  while (length < minimumLength) length *= 2;
  const next = new array.constructor(length);
  next.set(array);
  return next;
}

export class MasonryVertexWriter {
  constructor({ vertices = 1024, indices = 3072 } = {}) {
    this.positions = new Float32Array(Math.max(3, vertices * 3));
    this.normals = new Float32Array(Math.max(3, vertices * 3));
    this.colors = new Float32Array(Math.max(3, vertices * 3));
    this.uvs = new Float32Array(Math.max(2, vertices * 2));
    this.indices = new Uint32Array(Math.max(3, indices));
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  /** Make room for `vertices` more vertices and `indices` more indices. */
  reserve(vertices, indices) {
    const vertexTotal = this.vertexCount + vertices;
    if (vertexTotal * 3 > this.positions.length) {
      this.positions = grow(this.positions, vertexTotal * 3);
      this.normals = grow(this.normals, vertexTotal * 3);
      this.colors = grow(this.colors, vertexTotal * 3);
      this.uvs = grow(this.uvs, vertexTotal * 2);
    }
    if (this.indexCount + indices > this.indices.length) {
      this.indices = grow(this.indices, this.indexCount + indices);
    }
  }

  /** Append one vertex; returns its index. Call `reserve` first. */
  vertex(px, py, pz, nx, ny, nz, r, g, b, u, v) {
    const index = this.vertexCount;
    const offset = index * 3;
    this.positions[offset] = px;
    this.positions[offset + 1] = py;
    this.positions[offset + 2] = pz;
    this.normals[offset] = nx;
    this.normals[offset + 1] = ny;
    this.normals[offset + 2] = nz;
    this.colors[offset] = r;
    this.colors[offset + 1] = g;
    this.colors[offset + 2] = b;
    this.uvs[index * 2] = u;
    this.uvs[index * 2 + 1] = v;
    this.vertexCount += 1;
    return index;
  }

  triangle(a, b, c) {
    const offset = this.indexCount;
    this.indices[offset] = a;
    this.indices[offset + 1] = b;
    this.indices[offset + 2] = c;
    this.indexCount += 3;
  }

  /** Discard everything written since `mark()` — for a stone that failed midway. */
  mark() {
    return { vertexCount: this.vertexCount, indexCount: this.indexCount };
  }

  rewind(marker) {
    this.vertexCount = marker.vertexCount;
    this.indexCount = marker.indexCount;
  }

  /**
   * Append already-built plain arrays (a fallback stone). `indices` are local
   * to the appended block; a missing index array means a triangle soup.
   */
  append({ positions, normals, colors, uvs, indices = null }) {
    const count = positions.length / 3;
    const indexCount = indices ? indices.length : count;
    this.reserve(count, indexCount);
    const base = this.vertexCount;
    this.positions.set(positions, base * 3);
    this.normals.set(normals, base * 3);
    this.colors.set(colors, base * 3);
    this.uvs.set(uvs, base * 2);
    if (indices) {
      for (let index = 0; index < indices.length; index += 1) {
        this.indices[this.indexCount + index] = base + indices[index];
      }
    } else {
      for (let index = 0; index < count; index += 1) {
        this.indices[this.indexCount + index] = base + index;
      }
    }
    this.vertexCount += count;
    this.indexCount += indexCount;
  }

  /** Trimmed copies; indices narrow to 16 bits when every vertex fits. */
  toArrays() {
    const vertexCount = this.vertexCount;
    const indices = vertexCount <= MAX_UINT16_VERTEX
      ? Uint16Array.from(this.indices.subarray(0, this.indexCount))
      : this.indices.slice(0, this.indexCount);
    return {
      positions: this.positions.slice(0, vertexCount * 3),
      normals: this.normals.slice(0, vertexCount * 3),
      colors: this.colors.slice(0, vertexCount * 3),
      uvs: this.uvs.slice(0, vertexCount * 2),
      indices,
      vertexCount,
      triangleCount: this.indexCount / 3,
    };
  }
}
