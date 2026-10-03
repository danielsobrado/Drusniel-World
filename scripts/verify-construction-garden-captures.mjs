import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const folders = {
  all: arg('all', 'tmp/wall-garden-all-scenes'),
  repeat: arg('repeat', 'tmp/wall-garden-final-near'),
  coarse: arg('coarse', 'tmp/wall-garden-final-coarse'),
  back: arg('back', 'tmp/wall-garden-final-back'),
};
const reports = Object.fromEntries(Object.entries(folders).map(([key, folder]) =>
  [key, JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8'))]));
const gardens = ['meadow-closeup', 'meadow-curve', 'arched-courtyard'];
const find = (report, id, light) => report.results.find(result => result.id === id && result.light === light);

for (const report of Object.values(reports)) {
  assert.deepEqual(report.errors, [], 'Capture must have no page errors.');
  assert.ok(report.results.every(result => result.backend === 'WebGPUBackend'));
}
for (const id of gardens) for (const light of ['neutral', 'warm']) {
  const near = find(reports.all, id, light);
  const repeated = find(reports.repeat, id, light);
  const coarse = find(reports.coarse, id, light);
  const back = find(reports.back, id, light);
  assert.ok(near && repeated && coarse && back, `Missing capture: ${id}/${light}`);
  assert.deepEqual(near, repeated, `Repeat changed semantic counts or pose: ${id}/${light}`);
  const file = `${id}-${light}.png`;
  assert.ok(fs.readFileSync(path.join(folders.all, file)).equals(
    fs.readFileSync(path.join(folders.repeat, file))), `Repeat pixels changed: ${file}`);
  assert.deepEqual(coarse.environment, near.environment, 'LOD changed the meadow.');
  assert.deepEqual(coarse.camera, near.camera, 'LOD changed the pose.');
  assert.deepEqual(coarse.openingArcs, near.openingArcs, 'LOD changed opening anchors.');
  assert.equal(coarse.stones, near.stones, 'LOD changed Glade stone identity count.');
  assert.ok(coarse.triangles < near.triangles, 'Coarse wall must reduce triangles.');
  assert.equal(back.environment.trees, 0, 'Reverse inspection must have an unobstructed backdrop.');
  assert.equal(back.environment.grassStems, near.environment.grassStems);
  assert.equal(back.environment.flowers, near.environment.flowers);
  assert.equal(near.wallCount, id === 'arched-courtyard' ? 2 : 1);
  assert.equal(near.openingArcs.length, id === 'arched-courtyard' ? 4 : 0);
  console.log(`${id}/${light}: stable repeat, environment and pose; wall triangles ${near.triangles} -> ${coarse.triangles}`);
}
const plain = find(reports.repeat, 'straight', 'neutral');
assert.ok(plain, 'Repeat set must end with the straight fixture to check camera reset.');
assert.equal(plain.zoom, 1);
assert.deepEqual(plain.camera.position, [11, 10, 16]);
assert.equal(plain.environment, null);
console.log('Garden capture verification passed; plain fixture camera reset verified.');
