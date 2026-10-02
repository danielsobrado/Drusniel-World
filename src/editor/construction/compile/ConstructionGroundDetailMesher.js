import { writeDecorationTriangle as triangle } from './ConstructionDecorationMesher.js';

/** Terrain-following tufts, little flowers, moss and pebbles in the growth batch. */
export function writeGroundDetail(writer, detail, { arcTable, moduleOrigin, groundHeightAt, color }) {
  const frame = arcTable.frameAt(detail.s);
  const x = frame.x + frame.normalX * detail.side * detail.offset;
  const z = frame.z + frame.normalZ * detail.side * detail.offset;
  const point = (dx, dy, dz) => [x + dx - moduleOrigin.x, groundHeightAt(x + dx, z + dz) + dy, z + dz - moduleOrigin.z];
  color.set(detail.color);
  for (let blade = 0; blade < 4; blade += 1) {
    const angle = detail.angle + blade * 2.39996;
    const c = Math.cos(angle); const s = Math.sin(angle);
    const height = detail.height * (0.65 + blade * 0.12);
    const width = 0.014 + blade * 0.002;
    const rootX = c * 0.028; const rootZ = s * 0.028;
    const left = point(rootX - s * width, 0.004, rootZ + c * width);
    const right = point(rootX + s * width, 0.004, rootZ - c * width);
    const bend = point(rootX + c * height * 0.2, height * 0.55, rootZ + s * height * 0.2);
    const tip = point(rootX + c * height * 0.45, height, rootZ + s * height * 0.45);
    triangle(writer, left, right, bend, color);
    triangle(writer, left, bend, tip, color);
  }
  if (detail.flower) {
    const height = detail.height + 0.05;
    color.set('#708143');
    triangle(writer, point(-0.006, 0.005, 0), point(0.006, 0.005, 0), point(0, height, 0), color);
    color.set('#f4e8b7');
    const center = point(0, height + 0.007, 0);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = detail.angle + petal * Math.PI * 2 / 5;
      const a = point(Math.cos(angle - 0.35) * 0.027, height, Math.sin(angle - 0.35) * 0.027);
      const b = point(Math.cos(angle + 0.35) * 0.027, height, Math.sin(angle + 0.35) * 0.027);
      triangle(writer, center, b, a, color);
    }
  }
  if (detail.pebble) {
    color.set('#b5a285');
    const center = point(0.08, 0.037, 0);
    const ring = [[-0.04, -0.025], [0.045, -0.02], [0.032, 0.029], [-0.031, 0.027]];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      triangle(writer, center, point(0.08 + b[0], 0.003, b[1]), point(0.08 + a[0], 0.003, a[1]), color);
    }
  }
  if (detail.moss) {
    color.set('#82844f');
    const center = point(-0.025, 0.005, 0.03);
    for (let i = 0; i < 6; i += 1) {
      const a = i * Math.PI / 3; const b = (i + 1) * Math.PI / 3;
      triangle(writer, center, point(Math.cos(b) * 0.07 - 0.025, 0.004, Math.sin(b) * 0.045 + 0.03),
        point(Math.cos(a) * 0.07 - 0.025, 0.004, Math.sin(a) * 0.045 + 0.03), color);
    }
  }
}
