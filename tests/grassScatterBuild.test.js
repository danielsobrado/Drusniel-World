import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrassScatterComposer } from '../src/editor/stylized/grassScatterBuild.js';

const CHUNK_SIZE = 4;
const SOURCE_CLUMPS = 6;

/**
 * A stand-in for one page's grass scatter: `cells` eligible cells, each
 * contributing `sourceClumps` instances at the page's full density.
 */
function makeScatter(cells = 12, sourceClumps = SOURCE_CLUMPS) {
  const base = new Float32Array(cells * sourceClumps * 3);
  const parameters = new Float32Array(cells * sourceClumps * 4);
  for (let cell = 0; cell < cells; cell += 1) {
    for (let clump = 0; clump < sourceClumps; clump += 1) {
      const index = cell * sourceClumps + clump;
      base[index * 3] = cell * 2 + clump * 0.1;
      base[index * 3 + 1] = 10 + cell + clump * 0.5;
      base[index * 3 + 2] = -cell + clump * 0.25;
      parameters[index * 4] = 0.02 + index * 1e-4;
      parameters[index * 4 + 1] = 0.1 + index * 1e-3;
      parameters[index * 4 + 2] = index * 0.37;
      // The channel canopy suppression is judged on, uniform over the cells.
      parameters[index * 4 + 3] = (index * 7 % 11) / 11;
    }
  }
  return { base, parameters, count: cells * sourceClumps, clumpsPerCell: sourceClumps };
}

/**
 * The two-pass shape this replaced, written independently so the equivalence
 * claim is held by a test rather than by the comment on the composer: take a
 * prefix of each cell's clumps, then reject instances the canopy covers.
 */
function referenceBuild(scatter, targetClumpsPerCell, forestDensityAt = null) {
  const compactedBase = [];
  const compactedParameters = [];
  for (let group = 0; group < scatter.count / scatter.clumpsPerCell; group += 1) {
    for (let clump = 0; clump < targetClumpsPerCell; clump += 1) {
      const source = group * scatter.clumpsPerCell + clump;
      for (let component = 0; component < 3; component += 1) {
        compactedBase.push(scatter.base[source * 3 + component]);
      }
      for (let component = 0; component < 4; component += 1) {
        compactedParameters.push(scatter.parameters[source * 4 + component]);
      }
    }
  }
  const base = [];
  const parameters = [];
  for (let index = 0; index < compactedParameters.length / 4; index += 1) {
    const density = forestDensityAt
      ? forestDensityAt(compactedBase[index * 3], compactedBase[index * 3 + 2])
      : 1;
    if (compactedParameters[index * 4 + 3] >= density) continue;
    for (let component = 0; component < 3; component += 1) {
      base.push(compactedBase[index * 3 + component]);
    }
    for (let component = 0; component < 4; component += 1) {
      parameters.push(compactedParameters[index * 4 + component]);
    }
  }
  return { base, parameters, count: parameters.length / 4 };
}

function runComposer(scatter, targetClumpsPerCell, { budget = Infinity, forestDensityAt = null } = {}) {
  const composer = createGrassScatterComposer({
    scatter,
    targetClumpsPerCell,
    forestDensityAt,
  });
  const base = new Float32Array(scatter.base.length);
  const parameters = new Float32Array(scatter.parameters.length);
  let guard = 0;
  while (!composer.done) {
    // The slice that finishes the build reports false, so the loop drains on
    // `done` rather than on the return value — the return value is what the slot
    // uses to decide whether to ask for another frame.
    composer.advance(budget, base, parameters);
    guard += 1;
    assert.ok(guard < 100000, 'composer did not terminate');
  }
  return {
    base: Array.from(base.subarray(0, composer.count * 3)),
    parameters: Array.from(parameters.subarray(0, composer.count * 4)),
    count: composer.count,
    minimumHeight: composer.minimumHeight,
    maximumHeight: composer.maximumHeight,
  };
}

test('the fused pass writes exactly what compaction followed by filtering wrote', () => {
  const scatter = makeScatter();
  for (const target of [1, 2, 3, 6]) {
    const fused = runComposer(scatter, target);
    const reference = referenceBuild(scatter, target);
    assert.equal(fused.count, reference.count, `target ${target} count`);
    assert.deepEqual(fused.base, reference.base, `target ${target} base`);
    assert.deepEqual(fused.parameters, reference.parameters, `target ${target} parameters`);
  }
});

test('the fused pass writes exactly what the canopy filter would have kept', () => {
  const scatter = makeScatter();
  // A canopy over the first half of the chunk, thinning toward its edge — the
  // shape the real bilinear field has.
  const forestDensityAt = (x) => (x < 8 ? 0.35 : 0.75);
  const fused = runComposer(scatter, 4, { forestDensityAt });
  const reference = referenceBuild(scatter, 4, forestDensityAt);
  assert.equal(fused.count, reference.count);
  assert.deepEqual(fused.base, reference.base);
  assert.deepEqual(fused.parameters, reference.parameters);
  // The filter has to actually be doing something, or the equality above proves
  // nothing.
  assert.ok(fused.count < runComposer(scatter, 4).count, 'canopy removed nothing');
});

test('slicing the build across frames changes nothing but when it lands', () => {
  const scatter = makeScatter(24);
  const whole = runComposer(scatter, 3);
  for (const budget of [1, 2, 5, 7]) {
    const sliced = runComposer(scatter, 3, { budget });
    assert.equal(sliced.count, whole.count, `budget ${budget} count`);
    assert.deepEqual(sliced.base, whole.base, `budget ${budget} base`);
    assert.deepEqual(sliced.parameters, whole.parameters, `budget ${budget} parameters`);
  }
});

test('a chunk never reads past the clumps its cell actually holds', () => {
  // The density rises as a chunk comes closer, so a rebuild can ask for more
  // clumps per cell than the page was generated with. Reading past the end of the
  // group would publish another cell's grass as this one's.
  const scatter = makeScatter(6, 2);
  const composer = createGrassScatterComposer({ scatter, targetClumpsPerCell: 8 });
  assert.equal(composer.keep, 2);
  const base = new Float32Array(scatter.base.length);
  const parameters = new Float32Array(scatter.parameters.length);
  while (!composer.done) composer.advance(2, base, parameters);
  assert.equal(composer.count, scatter.count);
  assert.deepEqual(Array.from(base.subarray(0, composer.count * 3)), Array.from(scatter.base));
});

test('a page with no scatter leaves the buffers untouched', () => {
  for (const scatter of [null, {}, { base: null, parameters: null }]) {
    const composer = createGrassScatterComposer({ scatter, targetClumpsPerCell: 4 });
    assert.equal(composer.done, true);
    assert.equal(composer.count, 0);
    const base = new Float32Array(12);
    assert.equal(composer.advance(4, base, new Float32Array(16)), false);
    assert.deepEqual(Array.from(base), new Array(12).fill(0));
  }
});

test('the height range it reports covers exactly the instances it wrote', () => {
  const scatter = makeScatter();
  const fused = runComposer(scatter, 2);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < fused.count; index += 1) {
    minimum = Math.min(minimum, fused.base[index * 3 + 1]);
    maximum = Math.max(maximum, fused.base[index * 3 + 1]);
  }
  // The bounds feed the mesh's culling box, so a range that is too small clips the
  // chunk away and one that is too large is wasted frustum work; both have to
  // describe the instances actually written, not the source they came from.
  assert.equal(fused.minimumHeight, minimum);
  assert.equal(fused.maximumHeight, maximum);
});

test('the canopy is consulted with the instance position, not the cell index', () => {
  const scatter = makeScatter();
  const seen = [];
  runComposer(scatter, 3, {
    forestDensityAt: (x, z) => {
      seen.push([x, z]);
      return 1;
    },
  });
  assert.ok(seen.length > 0);
  // Local XZ, the same space the source arrays are written in and the space the
  // scatter was placed in — a cell index here would silently filter the wrong
  // part of the chunk.
  assert.deepEqual(seen[0], [scatter.base[0], scatter.base[2]]);
  assert.ok(seen.some(([, z]) => z !== seen[0][1]));
});
