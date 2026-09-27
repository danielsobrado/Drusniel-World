import assert from 'node:assert/strict';
import test from 'node:test';
import { compileConstructionCollision } from '../src/editor/construction/compile/ConstructionCollisionCompiler.js';
import { sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { survivingIntervals } from '../src/editor/construction/masonry/OpeningLayout.js';
import {
  curvedConstruction,
  doorFeature,
  straightConstruction,
} from './helpers/constructionCollisionFixtures.js';

// A door authored on the first segment's end fraction, so its centre sits exactly
// on the joint to the second segment and its width straddles both.
const JOINT_DOOR = doorFeature({
  id: 'door-join',
  segmentId: 'segment-west-north',
  arcFraction: 1,
  width: 2.4,
});

function compile(record, curveSegmentLength = 1.25) {
  return compileConstructionCollision(
    record,
    sampleCubicBezierPath(record.path),
    { curveSegmentLength },
  );
}

function contains(box, x, z, y) {
  if (y < box.bottom - 1e-9 || y > box.top + 1e-9) return false;
  const dx = x - box.center[0];
  const dz = z - box.center[1];
  const [tangentX, tangentZ] = box.tangent;
  const along = Math.abs(dx * tangentX + dz * tangentZ);
  const across = Math.abs(dx * -tangentZ + dz * tangentX);
  return along <= box.length / 2 + 1e-6 && across <= box.thickness / 2 + 1e-6;
}

function blockersAt(plan, arcTable, s, y) {
  const frame = arcTable.frameAt(s);
  return plan.boxes.filter((box) => contains(box, frame.x, frame.z, y));
}

/** Unblocked arc either side of `centre`, walking outward at height `y`. */
function voidSpan(plan, arcTable, centre, y, reach) {
  const step = 0.001;
  let left = centre;
  let right = centre;
  for (let offset = step; offset <= reach; offset += step) {
    if (blockersAt(plan, arcTable, centre - offset, y).length > 0) break;
    left = centre - offset;
  }
  for (let offset = step; offset <= reach; offset += step) {
    if (blockersAt(plan, arcTable, centre + offset, y).length > 0) break;
    right = centre + offset;
  }
  return [left, right];
}

function jointCase() {
  const record = { ...curvedConstruction({ id: 'construction-join' }), features: [JOINT_DOOR] };
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const centre = arcTable.toArc(JOINT_DOOR.segmentId, JOINT_DOOR.arcFraction);
  return { record, arcTable, centre };
}

test('a door centred on a joint leaves no blocking collider across its width', () => {
  const { record, arcTable, centre } = jointCase();
  const plan = compile(record);
  const half = JOINT_DOOR.width / 2;
  const blocked = [];
  for (let step = 1; step < 200; step += 1) {
    const s = centre - half + (JOINT_DOOR.width * step) / 200;
    const hits = blockersAt(plan, arcTable, s, 1);
    if (hits.length > 0) blocked.push(`${s.toFixed(3)} @ ${hits.map((box) => box.id).join(',')}`);
  }
  assert.deepEqual(blocked, [], 'the visible doorway must carry no masonry collider');
});

test('a door inside one segment keeps its previous three-box structure', () => {
  const record = straightConstruction({ id: 'construction-inside', features: [doorFeature()] });
  const plan = compile(record);
  const ordered = [...plan.boxes].sort((left, right) => left.center[0] - right.center[0]);

  assert.equal(ordered.length, 3);
  assert.deepEqual(ordered.map((box) => box.center[0]), [-4.5, 0, 4.5]);
  assert.deepEqual(ordered.map((box) => box.length), [7, 2, 7]);
  assert.deepEqual(ordered.map((box) => box.bottom), [0, 2.2, 0]);
  assert.deepEqual(ordered.map((box) => box.top), [3.5, 3.5, 3.5]);

  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const centre = arcTable.toArc('segment-main', 0.5);
  for (let step = 1; step < 100; step += 1) {
    const s = centre - 1 + (2 * step) / 100;
    assert.equal(blockersAt(plan, arcTable, s, 1).length, 0, `blocked at s=${s}`);
  }
});

test('the void is symmetric about the opening and matches the rendered void', () => {
  const { record, arcTable, centre } = jointCase();
  const plan = compile(record);
  const y = 1;
  const [left, right] = voidSpan(plan, arcTable, centre, y, JOINT_DOOR.width);

  assert.ok(
    Math.abs((centre - left) - (right - centre)) < 0.02,
    `void is not symmetric: ${left}..${right} about ${centre}`,
  );
  assert.ok(right - left > JOINT_DOOR.width - 0.05, `void too narrow: ${right - left}`);

  const rendered = survivingIntervals(
    [0, arcTable.totalLength],
    [{
      s: centre,
      width: JOINT_DOOR.width,
      height: JOINT_DOOR.height,
      sill: JOINT_DOOR.sill,
      profile: JOINT_DOOR.profile,
    }],
    y,
  );
  const renderedLeft = rendered[0][1];
  const renderedRight = rendered[1][0];
  // The collider void sits inside the rendered void and is not needlessly narrower.
  assert.ok(left >= renderedLeft - 1e-6, `collider at ${left} is outside the rendered void`);
  assert.ok(right <= renderedRight + 1e-6, `collider at ${right} is outside the rendered void`);
  assert.ok(renderedLeft - left < 0.05, `left collider ${left} vs rendered ${renderedLeft}`);
  assert.ok(right - renderedRight < 0.05, `right collider ${right} vs rendered ${renderedRight}`);
});

test('the shared opening definition tags colliders in every segment it reaches', () => {
  const { record, arcTable, centre } = jointCase();
  const plan = compile(record);

  const tagged = plan.boxes.filter((box) => box.openingIds.includes(JOINT_DOOR.id));
  assert.deepEqual(
    [...new Set(tagged.map((box) => box.segmentId))].sort(),
    ['segment-north-east', 'segment-west-north'],
  );

  const half = JOINT_DOOR.width / 2;
  for (let step = 1; step < 100; step += 1) {
    const s = centre - half + (JOINT_DOOR.width * step) / 100;
    const hits = blockersAt(plan, arcTable, s, 2.8);
    assert.ok(hits.length > 0, `lintel missing at s=${s.toFixed(3)}`);
    assert.ok(hits.every((box) => box.openingIds.includes(JOINT_DOOR.id)));
  }
});
