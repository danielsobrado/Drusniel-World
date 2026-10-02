// Both outlines stay inside the unit disc and are star-shaped about the fold.
// The base-to-tip asymmetry and side lobes remain readable without a texture.
const OUTLINES = Object.freeze({
  lobed: [[0, -0.78], [0.6, -0.12], [0.7, 0.42], [0.28, 0.46],
    [0, 0.95], [-0.28, 0.46], [-0.7, 0.42], [-0.6, -0.12]],
  heart: [[0, -0.85], [0.65, -0.15], [0.72, 0.45], [0.34, 0.68],
    [0, 0.48], [-0.34, 0.68], [-0.72, 0.45], [-0.65, -0.15]],
});

/** Flat facet normals from the actual draped positions, with complete streams. */
function triangle(writer, a, b, c, color, shades = [1, 1, 1], awayFrom = null) {
  const bx = b[0] - a[0]; const by = b[1] - a[1]; const bz = b[2] - a[2];
  const cx = c[0] - a[0]; const cy = c[1] - a[1]; const cz = c[2] - a[2];
  let nx = by * cz - bz * cy; let ny = bz * cx - bx * cz; let nz = bx * cy - by * cx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-10) return;
  if (awayFrom && nx * (a[0] - awayFrom[0]) + ny * (a[1] - awayFrom[1]) + nz * (a[2] - awayFrom[2]) < 0) {
    [b, c] = [c, b];
    nx = -nx; ny = -ny; nz = -nz;
  }
  nx /= length; ny /= length; nz /= length;
  const start = writer.vertexCount;
  writer.reserve(3, 3);
  writer.vertex(a[0], a[1], a[2], nx, ny, nz, color.r * shades[0], color.g * shades[0], color.b * shades[0], 0, 0);
  writer.vertex(b[0], b[1], b[2], nx, ny, nz, color.r * shades[1], color.g * shades[1], color.b * shades[1], 0, 0);
  writer.vertex(c[0], c[1], c[2], nx, ny, nz, color.r * shades[2], color.g * shades[2], color.b * shades[2], 0, 0);
  writer.triangle(start, start + 1, start + 2);
}

/** Angular, folded leaf; all facets share positions but keep their own normals. */
export function writeIvyLeaf(writer, leaf, pointAt, color) {
  const c = Math.cos(leaf.angle); const s = Math.sin(leaf.angle);
  const outline = OUTLINES[leaf.shape] ?? OUTLINES.lobed;
  const points = outline.map(([x, y]) => pointAt(leaf.s + (x * c - y * s) * leaf.radius,
    leaf.y + (x * s + y * c) * leaf.radius, leaf.outward + x * leaf.radius * leaf.tilt));
  const center = pointAt(leaf.s, leaf.y, leaf.outward + leaf.fold);
  for (let i = 0; i < points.length; i += 1) {
    const next = (i + 1) % points.length;
    if (leaf.side > 0) triangle(writer, center, points[i], points[next], color, [1.025, 0.97, 0.97]);
    else triangle(writer, center, points[next], points[i], color, [1.025, 0.97, 0.97]);
  }
}

/** A four-sided branch, sampled along the wall so it follows curves and grade. */
export function writeIvyStem(writer, stem, pointAt, color, { radius = 0.01, outward = 0.014 } = {}) {
  const ds = stem.to[0] - stem.from[0]; const dy = stem.to[1] - stem.from[1];
  const length = Math.hypot(ds, dy);
  if (length < 1e-6) return;
  const steps = Math.max(1, Math.ceil(length / 0.35));
  const dx = -dy / length * radius; const dh = ds / length * radius;
  const ringAt = t => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([across, depth]) => pointAt(
    stem.from[0] + ds * t + dx * across, stem.from[1] + dy * t + dh * across,
    outward + depth * radius, Boolean(stem.rooted && t === 0)));
  let previous = ringAt(0);
  for (let step = 1; step <= steps; step += 1) {
    const next = ringAt(step / steps);
    const t = (step - 0.5) / steps;
    const center = pointAt(stem.from[0] + ds * t, stem.from[1] + dy * t, outward);
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      triangle(writer, previous[i], next[i], next[j], color, undefined, center);
      triangle(writer, previous[i], next[j], previous[j], color, undefined, center);
    }
    previous = next;
  }
}
