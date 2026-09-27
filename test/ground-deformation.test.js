import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFORMATION_TEXELS,
  DEFORMATION_WINDOW_METRES,
  readDeformationTexel,
  stampFootprint,
  updateGroundDeformation,
  WINDOW_ID_PERIOD,
} from '../src/editor/stylized/deformation/groundDeformationState.js';

const floorMod = (value, period) => value - Math.floor(value / period) * period;

/**
 * The shader's lookup (groundDeformationNode) replayed in JS: from a chunk's
 * whole-metre origin and a local offset on cell axes, which texel it reads and
 * which window it expects there.
 */
function shaderLookup(originCell, localCell) {
  const window = DEFORMATION_WINDOW_METRES;
  const origin = [originCell[0], -originCell[1]];
  const local = [localCell[0], -localCell[1]];
  const inWindow = [floorMod(origin[0], window) + local[0], floorMod(origin[1], window) + local[1]];
  const texel = inWindow.map((value) => Math.floor(floorMod(value / window, 1) * DEFORMATION_TEXELS));
  const windowId = [0, 1].map((axis) => floorMod(
    Math.floor(origin[axis] / window) + Math.floor(inWindow[axis] / window),
    WINDOW_ID_PERIOD,
  ));
  return { texel, windowId };
}

test('a footfall stamps an oriented print the terrain reads back', () => {
  updateGroundDeformation(100);
  // Far out on the planet, in a chunk whose corner is at cell metres (-7134720, 1900032).
  const originCell = [-7134720, 1900032];
  const localCell = [37.3, 81.9];
  const x = originCell[0] + localCell[0];
  const z = -(originCell[1] + localCell[1]);
  stampFootprint(x, z, 0.6);
  const [depth, time, windowX, windowZ] = readDeformationTexel(x, z);
  assert.ok(depth > 0.5);
  assert.equal(time, 100);
  const lookup = shaderLookup(originCell, localCell);
  assert.deepEqual([windowX, windowZ], lookup.windowId, 'the shader expects the window the print was made in');
  const texelX = floorMod(Math.floor(x / (DEFORMATION_WINDOW_METRES / DEFORMATION_TEXELS)), DEFORMATION_TEXELS);
  const texelZ = floorMod(Math.floor(z / (DEFORMATION_WINDOW_METRES / DEFORMATION_TEXELS)), DEFORMATION_TEXELS);
  assert.deepEqual(lookup.texel, [texelX, texelZ], 'the shader reads the texel that was stamped');
});

test('a print is not read back one window away, where the texel aliases', () => {
  updateGroundDeformation(200);
  stampFootprint(1000.3, -500.7, 0);
  const [, , windowX] = readDeformationTexel(1000.3, -500.7);
  const aliased = shaderLookup([1000 + DEFORMATION_WINDOW_METRES, 500], [0.3, 0.7]);
  assert.notEqual(aliased.windowId[0], windowX);
});

test('a faded print is wiped, so it cannot come back when the stamp clock wraps', async () => {
  const { PRINT_LIFETIME_SECONDS, TIME_PERIOD } = await import(
    '../src/editor/stylized/deformation/groundDeformationState.js'
  );
  updateGroundDeformation(300);
  stampFootprint(-4321.3, 987.6, 0);
  assert.ok(readDeformationTexel(-4321.3, 987.6)[0] > 0.5);
  // Well past its lifetime: the next sweep clears it.
  updateGroundDeformation(300 + PRINT_LIFETIME_SECONDS + 15);
  assert.equal(readDeformationTexel(-4321.3, 987.6)[0], 0);
  // A whole stamp-clock period later the age would read as zero again.
  updateGroundDeformation(300 + TIME_PERIOD);
  assert.equal(readDeformationTexel(-4321.3, 987.6)[0], 0);
});

test('the toe points the way the figure faces', () => {
  updateGroundDeformation(2000);
  // facing 0: forward is +z. The toe is wider than the heel.
  stampFootprint(100.02, 100.02, 0);
  const across = 0.09;
  const toe = readDeformationTexel(100.02 + across, 100.02 + 0.08)[0];
  const heel = readDeformationTexel(100.02 + across, 100.02 - 0.08)[0];
  assert.ok(toe > heel, `toe ${toe} should out-reach heel ${heel}`);
});
