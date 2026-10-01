import assert from 'node:assert/strict';
import test from 'node:test';
import { createArcBendTable, createStoneBend } from '../src/editor/construction/compile/ConstructionArcBend.js';

function circleArc(radius) {
  return {
    totalLength: 2 * Math.PI * radius,
    frameAt(s) {
      const angle = s / radius;
      return {
        x: radius * Math.cos(angle),
        z: radius * Math.sin(angle),
        tangentX: -Math.sin(angle),
        tangentZ: Math.cos(angle),
      };
    },
  };
}

const straightArc = {
  totalLength: 20,
  frameAt: (s) => ({ x: s, z: 0, tangentX: 1, tangentZ: 0 }),
};

function stoneBend(arcTable, s) {
  const table = createArcBendTable({ arcTable, moduleOrigin: { x: 0, z: 0 }, from: 0, to: arcTable.totalLength });
  const frame = arcTable.frameAt(s);
  return createStoneBend(table, { s, x: frame.x, z: frame.z, tangentX: frame.tangentX, tangentZ: frame.tangentZ });
}

test('bending is the identity on a straight wall', () => {
  const bend = stoneBend(straightArc, 7);
  const out = [0, 0, 0, 0];
  bend(7.3, 0.4, 0.6, 0.8, out);
  for (const [actual, expected] of [[out[0], 7.3], [out[1], 0.4], [out[2], 0.6], [out[3], 0.8]]) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
  }
});

test('a bent stone face lies on the arc offset by its distance from the centreline', () => {
  const radius = 10;
  const arc = circleArc(radius);
  const s = 5;
  const bend = stoneBend(arc, s);
  const frame = arc.frameAt(s);
  const normal = [-frame.tangentZ, frame.tangentX];
  const out = [0, 0, 0, 0];
  for (const across of [-0.4, 0, 0.4]) {
    // The corner of a 0.36 m stone, half a width along its straight tangent.
    const x = frame.x + frame.tangentX * 0.18 + normal[0] * across;
    const z = frame.z + frame.tangentZ * 0.18 + normal[1] * across;
    bend(x, z, 0, 0, out);
    // The normal points inward on this circle, so +across shrinks the radius.
    assert.ok(Math.abs(Math.hypot(out[0], out[1]) - (radius - across)) < 1e-4, `across ${across}`);
    const expectedAngle = (s + 0.18) / radius;
    assert.ok(Math.abs(Math.atan2(out[1], out[0]) - expectedAngle) < 1e-4, `angle at ${across}`);
  }
  // A face normal along the stone's tangent turns with the arc.
  bend(frame.x, frame.z, frame.tangentX, frame.tangentZ, out);
  const turned = arc.frameAt(s);
  assert.ok(Math.abs(out[2] - turned.tangentX) < 1e-6 && Math.abs(out[3] - turned.tangentZ) < 1e-6);
});
