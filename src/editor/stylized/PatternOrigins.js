import * as THREE from 'three/webgpu';
import { floor, smoothstep, uniform, vec2 } from 'three/tsl';

/**
 * Pattern coordinates that stay exact at planet scale.
 *
 * Canonical positions reach millions of metres, where float32 cannot hold a
 * fraction: a shader that scales them into pattern space gets a coordinate
 * stepping in whole cells and a lattice hash that no longer mixes, and the
 * pattern collapses into a regular grid. So no shader sees a canonical
 * position. Each chunk gets its origin in pattern space, computed here in
 * double precision and wrapped, and the shader adds the chunk-local offset,
 * which is small and exact.
 *
 * Two kinds of origin, each seamless across chunk borders:
 *
 * - lattice: the chunk centre times a scale, wrapped by `PATTERN_PERIOD`
 *   cells. Neighbouring chunks may land on different wraps, so the pattern's
 *   hash must repeat over the same period (PeriodicNoiseNodes) — then the two
 *   realise one field.
 * - wave: a plane wave's phase at the chunk centre, wrapped to [0, 2π).
 *
 * A pattern projected onto a per-pixel direction (a band along the current)
 * has neither form: its phase is dot(position, direction), and no wrap of the
 * position commutes with a direction that varies. `referenceBlendTaps` handles
 * those.
 */

const TAU = Math.PI * 2;

/**
 * Lattice cells after which every periodic pattern repeats: a power of two, so
 * PeriodicNoiseNodes can wrap a cell with a bit mask, and each of its octaves
 * (an exact doubling) closes over the same wrap.
 */
export const PATTERN_PERIOD = 512;

export function wrapPeriodic(value, period) {
  const wrapped = value - Math.floor(value / period) * period;
  return wrapped >= period ? 0 : wrapped;
}

/** A canonical point's pattern coordinate at `scale`, wrapped by `period`. */
export function latticePatternOrigin(x, z, scale, period = PATTERN_PERIOD) {
  return [wrapPeriodic(x * scale, period), wrapPeriodic(z * scale, period)];
}

/** A plane wave's phase, dot(point, waveVector), wrapped to [0, 2π). */
export function wavePatternOrigin(x, z, waveX, waveZ) {
  return wrapPeriodic(x * waveX + z * waveZ, TAU);
}

/**
 * Per-slot origin uniforms for a fixed set of named patterns.
 *
 * `frames` maps a name to `{ scale, period? }` (lattice) or `{ wave: [x, z] }`.
 * The material reads a pattern's scale from here rather than from config, so a
 * uniform and the shader that consumes it can never disagree.
 */
export class PatternOrigins {
  constructor(frames) {
    this.frames = Object.freeze({ ...frames });
    this.uniforms = {};
    for (const [name, frame] of Object.entries(this.frames)) {
      this.uniforms[name] = frame.wave ? uniform(0) : uniform(new THREE.Vector2());
    }
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  frame(name) {
    const frame = this.frames[name];
    if (!frame) throw new Error(`Unknown pattern origin "${name}".`);
    return frame;
  }

  /** A lattice pattern's coordinate: the origin plus `localMeters` × scale. */
  latticePoint(name, localMeters) {
    const frame = this.frame(name);
    if (frame.wave) throw new Error(`Pattern origin "${name}" is a wave, not a lattice.`);
    return this.uniforms[name].add(localMeters.mul(frame.scale));
  }

  /** A plane wave's phase: the origin plus dot(localMeters, waveVector). */
  wavePhase(name, localMeters) {
    const frame = this.frame(name);
    if (!frame.wave) throw new Error(`Pattern origin "${name}" is a lattice, not a wave.`);
    return this.uniforms[name]
      .add(localMeters.x.mul(frame.wave[0]))
      .add(localMeters.y.mul(frame.wave[1]));
  }

  /**
   * A view of this set for a material shared between objects: each uniform
   * follows the PatternOrigins that `read(object)` returns for the object being
   * drawn, and this set's own values stand in for an object without one.
   */
  perObject(read) {
    const view = Object.create(PatternOrigins.prototype);
    view.frames = this.frames;
    view.uniforms = {};
    for (const [name, template] of Object.entries(this.uniforms)) {
      const initial = this.frames[name].wave ? template.value : template.value.clone();
      view.uniforms[name] = uniform(initial)
        .onObjectUpdate(({ object }) => (read(object) ?? this).uniforms[name].value);
    }
    return view;
  }

  /** Re-centre on a chunk, canonical metres. */
  update(centerX, centerZ) {
    if (centerX === this.centerX && centerZ === this.centerZ) return;
    this.centerX = centerX;
    this.centerZ = centerZ;
    for (const [name, frame] of Object.entries(this.frames)) {
      if (frame.wave) {
        this.uniforms[name].value = wavePatternOrigin(centerX, centerZ, frame.wave[0], frame.wave[1]);
      } else {
        const [x, z] = latticePatternOrigin(centerX, centerZ, frame.scale, frame.period ?? PATTERN_PERIOD);
        this.uniforms[name].value.set(x, z);
      }
    }
  }
}

/**
 * Seamless evaluation of a pattern that must be measured from a nearby point.
 *
 * A band along a varying current has phase dot(position − reference, flow):
 * far from the reference its spacing is ruled by position × ∇flow rather than
 * by the flow, and at planet scale the reference cannot be the world origin.
 * References therefore sit on a canonical lattice of `spacing` metres. Each
 * pixel evaluates the pattern from the four around it and blends them; a
 * reference's weight is one over the square it owns and falls to zero across
 * a band `blend` × spacing wide at its edge, so no reference ever switches
 * while it is visible.
 *
 * @param {object} position vec2 node: metres from a point on the reference
 *   lattice, e.g. a PatternOrigins lattice point with scale 1, period `spacing`
 * @param {number} spacing metres between references
 * @param {number} blend half-width of the cross-fade, as a share of spacing
 * @returns {Array<{ offset: object, weight: object }>} metres from each
 *   reference, and its weight; the weights sum to one
 */
export function referenceBlendTaps(position, spacing, blend) {
  const scaled = position.div(spacing);
  const cell = floor(scaled);
  const fraction = scaled.sub(cell);
  const nextX = smoothstep(0.5 - blend, 0.5 + blend, fraction.x);
  const nextZ = smoothstep(0.5 - blend, 0.5 + blend, fraction.y);
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cornerX, cornerZ]) => ({
    offset: position.sub(cell.add(vec2(cornerX, cornerZ)).mul(spacing)),
    weight: (cornerX ? nextX : nextX.oneMinus()).mul(cornerZ ? nextZ : nextZ.oneMinus()),
  }));
}

function smoothstepCpu(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** `referenceBlendTaps` on the CPU: each tap's reference point, in `x, z`'s frame, and weight. */
export function referenceBlendTapsCpu(x, z, spacing, blend) {
  const cellX = Math.floor(x / spacing);
  const cellZ = Math.floor(z / spacing);
  const nextX = smoothstepCpu(0.5 - blend, 0.5 + blend, x / spacing - cellX);
  const nextZ = smoothstepCpu(0.5 - blend, 0.5 + blend, z / spacing - cellZ);
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cornerX, cornerZ]) => ({
    referenceX: (cellX + cornerX) * spacing,
    referenceZ: (cellZ + cornerZ) * spacing,
    weight: (cornerX ? nextX : 1 - nextX) * (cornerZ ? nextZ : 1 - nextZ),
  }));
}
