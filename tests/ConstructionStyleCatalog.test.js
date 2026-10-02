import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSTRUCTION_STYLES,
  DEFAULT_CONSTRUCTION_STYLE_KEY,
  DEFAULT_COPING,
  constructionStyle,
  defineConstructionStyle,
} from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';

test('soft-limestone-rubble exists with required tuning', () => {
  const style = constructionStyle('soft-limestone-rubble');
  assert.equal(style.key, 'soft-limestone-rubble');
  assert.equal(style.label, 'Soft limestone rubble');
  assert.equal(style.courseHeight, 0.52);
  assert.equal(style.targetWidth, 1.09);
  assert.equal(style.minWidth, 0.28);
  assert.equal(style.irregularity, 0.36);
  assert.equal(style.bedAmplitude, 0.08);
  assert.equal(style.jointTilt, 0.10);
  assert.equal(style.splitChance, 0.34);
  assert.equal(style.splitMaxDepth, 1);
  assert.equal(style.jointInsetMin, 0.018);
  assert.equal(style.jointInsetMax, 0.032);
  assert.equal(style.jointInsetVerticalRatio, 0.72);
  assert.equal(style.depthScaleMin, 0.965);
  assert.equal(style.depthScaleMax, 0.995);
  assert.equal(style.faceOffsetAmplitude, 0.012);
  assert.equal(style.stonePalette, 'soft-limestone');
  assert.equal(Object.isFrozen(style), true);
});

test('new walls default to rounded fieldstone; older styles keep their order', () => {
  assert.equal(DEFAULT_CONSTRUCTION_STYLE_KEY, 'rounded-fieldstone');
  assert.equal(
    Object.keys(CONSTRUCTION_STYLES)[0],
    'coursed-rubble',
  );
  assert.equal(Object.keys(CONSTRUCTION_STYLES)[1], 'soft-limestone-rubble');
  assert.deepEqual(Object.keys(CONSTRUCTION_STYLES).slice(-2), ['rounded-fieldstone', 'glade-sandstone']);
});

test('glade-sandstone matches the reference scale: small near-square blocks, restrained caps', () => {
  const candidate = constructionStyle('glade-sandstone');
  assert.equal(candidate.geometry, 'rounded');
  assert.equal(candidate.stonePalette, 'glade-sandstone');
  assert.equal(candidate.coarseLayout, 'preserve');
  assert.throws(() => defineConstructionStyle({ ...candidate, coarseLayout: 'shuffle' }), /coarseLayout/);
  // Taller whole blocks interleave with thin horizontal pairs in each course.
  assert.ok(candidate.courseHeight >= 0.35 && candidate.courseHeight <= 0.45);
  assert.ok(candidate.targetWidth >= 0.35 && candidate.targetWidth <= 0.5);
  assert.ok(candidate.targetWidth / candidate.courseHeight < 1.6, 'near square, not brick');
  assert.ok(candidate.coping.oversail >= 1.0 && candidate.coping.oversail <= 1.12);
  assert.ok(candidate.footing.heightRatio >= 1.0 && candidate.footing.heightRatio <= 1.25);
  // Its own stone budget, so small blocks do not truncate a wall; other styles
  // keep the shared caps.
  assert.ok(candidate.stoneBudget.module > 280);
  assert.equal(constructionStyle('rounded-fieldstone').stoneBudget ?? null, null);
  assert.throws(() => defineConstructionStyle({ ...candidate, splitHorizontalChance: 1.1 }), /splitHorizontalChance/);
});

test('rounded fieldstone declares its mesher, top, footing and coping', () => {
  const style = constructionStyle('rounded-fieldstone');
  assert.equal(style.label, 'Rounded fieldstone');
  assert.equal(style.geometry, 'rounded');
  assert.equal(style.defaultTop, 'flat');
  assert.equal(style.stonePalette, 'warm-fieldstone');
  assert.deepEqual({ ...style.footing }, {
    heightRatio: 1.5,
    widthRatio: 1.35,
    splitChance: 0.15,
    plinth: 0.05,
    burialMargin: 0.1,
    burialMax: 0.6,
  });
  assert.deepEqual({ ...style.coping }, { height: 0.24, oversail: 1.2, widthRatio: 1.35, crownVariation: 0 });
  assert.equal(Object.isFrozen(style.footing), true);
  assert.equal(Object.isFrozen(style.coping), true);
});

test('styles without the new fields keep the behaviour they always had', () => {
  for (const key of ['coursed-rubble', 'soft-limestone-rubble', 'ashlar', 'random-rubble', 'dry-stone']) {
    const style = constructionStyle(key);
    assert.equal(style.geometry, 'soft', key);
    assert.equal(style.defaultTop, null, key);
    assert.equal(style.coarseLayout, 'merge', key);
    assert.equal(style.footing, null, key);
    assert.equal(style.coping, DEFAULT_COPING, key);
  }
  assert.deepEqual({ ...DEFAULT_COPING }, { height: 0.16, oversail: 1.14, widthRatio: 1.15, crownVariation: 0 });
});

test('existing styles keep their authored values and packer defaults', () => {
  const coursed = constructionStyle('coursed-rubble');
  assert.equal(coursed.courseHeight, 0.56);
  assert.equal(coursed.targetWidth, 1.2);
  assert.equal(coursed.minWidth, 0.26);
  assert.equal(coursed.irregularity, 0.56);
  assert.equal(coursed.bedAmplitude, 0.16);
  assert.equal(coursed.jointTilt, 0.18);
  assert.equal(coursed.splitChance, 0.42);
  assert.equal(coursed.splitMaxDepth, 2);
  assert.equal(coursed.jointInsetMin, 0.012);
  assert.equal(coursed.jointInsetMax, 0.03);
  assert.equal(coursed.jointInsetVerticalRatio, 0.7);
  assert.equal(coursed.depthScaleMin, 0.92);
  assert.equal(coursed.depthScaleMax, 1.025);
  assert.equal(coursed.faceOffsetAmplitude, 0.018);
  assert.equal(coursed.stonePalette, 'soft-limestone');
});

test('all descriptors are frozen', () => {
  assert.equal(Object.isFrozen(CONSTRUCTION_STYLES), true);
  for (const style of Object.values(CONSTRUCTION_STYLES)) {
    assert.equal(Object.isFrozen(style), true);
  }
});

test('catalogue keys are unique and match descriptor keys', () => {
  const keys = Object.values(CONSTRUCTION_STYLES).map(({ key }) => key);
  assert.equal(new Set(keys).size, keys.length);
  for (const [mapKey, descriptor] of Object.entries(CONSTRUCTION_STYLES)) {
    assert.equal(mapKey, descriptor.key);
  }
});

test('invalid definitions fail immediately', () => {
  const base = {
    key: 'test-style',
    label: 'Test',
    courseHeight: 0.5,
    targetWidth: 1,
    minWidth: 0.2,
    irregularity: 0.4,
    detail: 2,
    merlonSpacing: 1,
    stonePalette: 'limestone',
    bedAmplitude: 0.1,
    jointTilt: 0.1,
    splitChance: 0.4,
  };

  assert.throws(
    () => defineConstructionStyle({ ...base, courseHeight: -1 }),
    /courseHeight/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, minWidth: 1.5 }),
    /minWidth must be below targetWidth/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, splitMaxDepth: 3 }),
    /splitMaxDepth/,
  );
  assert.throws(
    () => defineConstructionStyle({
      ...base,
      jointInsetMin: 0.04,
      jointInsetMax: 0.02,
    }),
    /joint inset range is reversed/,
  );
  assert.throws(
    () => defineConstructionStyle({
      ...base,
      depthScaleMin: 1.0,
      depthScaleMax: 0.9,
    }),
    /depth scale range is reversed/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, stonePalette: 'obsidian' }),
    /unknown stone palette/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, detail: 2.5 }),
    /detail must be an integer/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, splitMaxDepth: 1.5 }),
    /splitMaxDepth must be an integer/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, geometry: 'voxel' }),
    /geometry must be one of/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, defaultTop: 'domed' }),
    /defaultTop domed is not a top style/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, footing: { heightRatio: 0.5, widthRatio: 1 } }),
    /footing heightRatio/,
  );
  assert.throws(
    () => defineConstructionStyle({
      ...base,
      footing: { heightRatio: 1.5, widthRatio: 1, burialMargin: 0.3, burialMax: 0.1 },
    }),
    /burialMax must be at least burialMargin/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, coping: { oversail: 2 } }),
    /coping oversail/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, coping: { crownVariation: 0.4 } }),
    /coping crownVariation/,
  );
});
