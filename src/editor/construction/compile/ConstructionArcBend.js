/**
 * Bends a module's stones along the wall's arc.
 *
 * A stone is a straight prism set on the tangent at its own centre. On a curve
 * its faces are chords, so the convex face of two neighbours diverges by
 * `width * offset / radius` at every head joint: on a 10 m radius a 0.8 m wall
 * opens a centimetre-and-a-half wedge on its outer face, which reads as a dark
 * crack between blocks the packer fitted tightly. Bending maps each vertex from
 * the stone's tangent frame onto the arc itself, so a point `u` along and `v`
 * across the stone's frame lands at `frame(s + u) + normal(s + u) * v`: the
 * stones either side of a joint evaluate the same frame there and the joint
 * stays the width the packer solved on both faces. On a straight wall it is the
 * identity.
 *
 * Frames are sampled once per module at a fixed step, so the per-vertex cost is
 * a table lookup. Three.js-free.
 */

const DEFAULT_STEP = 0.1;

/**
 * @param options.arcTable the wall's `CurveArcTable`
 * @param options.moduleOrigin `{ x, z }` subtracted to reach module space
 * @param options.from, options.to arc range to cover; clamped to the wall
 */
export function createArcBendTable({
  arcTable,
  moduleOrigin,
  from,
  to,
  step = DEFAULT_STEP,
}) {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(arcTable.totalLength, Math.max(from, to));
  const span = Math.max(0, end - start);
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const spacing = span > 0 ? span / (count - 1) : step;
  // x, z, tangentX, tangentZ per sample.
  const frames = new Float64Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const frame = arcTable.frameAt(start + index * spacing);
    frames[index * 4] = frame.x - moduleOrigin.x;
    frames[index * 4 + 1] = frame.z - moduleOrigin.z;
    frames[index * 4 + 2] = frame.tangentX;
    frames[index * 4 + 3] = frame.tangentZ;
  }

  /** Writes `[x, z, tangentX, tangentZ]` at arc `s`, extrapolating linearly past the ends. */
  function frameAt(s, out) {
    const position = (s - start) / spacing;
    const low = Math.min(count - 2, Math.max(0, Math.floor(position)));
    const t = position - low;
    const a = low * 4;
    const b = a + 4;
    const x = frames[a] + (frames[b] - frames[a]) * t;
    const z = frames[a + 1] + (frames[b + 1] - frames[a + 1]) * t;
    let tx = frames[a + 2] + (frames[b + 2] - frames[a + 2]) * t;
    let tz = frames[a + 3] + (frames[b + 3] - frames[a + 3]) * t;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    out[0] = x;
    out[1] = z;
    out[2] = tx;
    out[3] = tz;
    return out;
  }

  return Object.freeze({ start, end, frameAt });
}

/**
 * A per-stone bend: `bend(x, z, nx, nz, out)` writes the bent `[x, z, nx, nz]`.
 *
 * `s` and the tangent describe the frame the stone was built in; `(x, z)` is
 * that frame's centreline point in module space (the stone's own centre sits
 * `offsetNormal` off it, which the cross-arc coordinate carries).
 */
export function createStoneBend(table, { s, x, z, tangentX, tangentZ }) {
  const frame = [0, 0, 0, 0];
  // The wall normal is the tangent turned a quarter towards +x, matching
  // CurveArcTable's `normalX = -tangentZ`, `normalZ = tangentX`.
  const normalX = -tangentZ;
  const normalZ = tangentX;
  return function bend(px, pz, nx, nz, out) {
    const dx = px - x;
    const dz = pz - z;
    const along = dx * tangentX + dz * tangentZ;
    const across = dx * normalX + dz * normalZ;
    table.frameAt(s + along, frame);
    const [fx, fz, tx, tz] = frame;
    out[0] = fx - tz * across;
    out[1] = fz + tx * across;
    // Turn the horizontal normal by the frame's change of heading.
    const cos = tangentX * tx + tangentZ * tz;
    const sin = tangentX * tz - tangentZ * tx;
    out[2] = nx * cos - nz * sin;
    out[3] = nx * sin + nz * cos;
    return out;
  };
}
