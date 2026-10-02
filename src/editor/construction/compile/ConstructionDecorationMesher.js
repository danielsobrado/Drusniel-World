const NEUTRAL_SHADES = Object.freeze([1, 1, 1]);

/** Write a flat triangle with normals derived from its actual draped positions. */
export function writeDecorationTriangle(writer, a, b, c, color, shades = NEUTRAL_SHADES, awayFrom = null) {
  const bx = b[0] - a[0]; const by = b[1] - a[1]; const bz = b[2] - a[2];
  const cx = c[0] - a[0]; const cy = c[1] - a[1]; const cz = c[2] - a[2];
  let nx = by * cz - bz * cy; let ny = bz * cx - bx * cz; let nz = bx * cy - by * cx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-10) return;
  if (awayFrom && (nx * (a[0] - awayFrom[0]) + ny * (a[1] - awayFrom[1]) + nz * (a[2] - awayFrom[2])) < 0) {
    [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz;
  }
  nx /= length; ny /= length; nz /= length;
  const start = writer.vertexCount; writer.reserve(3, 3);
  writer.vertex(a[0], a[1], a[2], nx, ny, nz, color.r * shades[0], color.g * shades[0], color.b * shades[0], 0, 0);
  writer.vertex(b[0], b[1], b[2], nx, ny, nz, color.r * shades[1], color.g * shades[1], color.b * shades[1], 0, 0);
  writer.vertex(c[0], c[1], c[2], nx, ny, nz, color.r * shades[2], color.g * shades[2], color.b * shades[2], 0, 0);
  writer.triangle(start, start + 1, start + 2);
}
