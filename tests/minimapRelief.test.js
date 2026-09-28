import assert from 'node:assert/strict';
import test from 'node:test';

import { contourDarkening, reliefShade, shadeMinimapPixel } from '../src/editor/map/minimapRelief.js';

test('slopes facing the north-west light are brighter than slopes facing away', () => {
  const flat = reliefShade({ left: 10, right: 10, up: 10, down: 10 }, 4);
  const lit = reliefShade({ left: 0, right: 20, up: 0, down: 20 }, 4);
  const shadowed = reliefShade({ left: 20, right: 0, up: 20, down: 0 }, 4);
  assert.ok(lit > flat && flat > shadowed, `${lit} > ${flat} > ${shadowed}`);
  assert.ok(shadowed >= 0.62 && lit <= 1.12);
});

test('contours darken a thin band every interval, and water stays flat', () => {
  assert.ok(contourDarkening(40, 20) > 0.05, 'on a contour line');
  assert.equal(contourDarkening(50, 20), 0, 'between lines');
  const neighbours = { left: 0, right: 30, up: 0, down: 30 };
  const land = shadeMinimapPixel([100, 160, 60], { water: false, height: 5, neighbours, spacing: 2 });
  const water = shadeMinimapPixel([100, 160, 60], { water: true, height: 5, neighbours, spacing: 2 });
  assert.notDeepEqual(land, water, 'relief lights land only');
  assert.ok(water.every((channel) => channel >= 0 && channel <= 255));
});
