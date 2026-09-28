import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contactFalloff,
  decodeAmount,
  decodeDirection,
  emptyInk,
  encodeAmount,
  encodeDirection,
  inkAdd,
  inkFromContact,
  inkIsEmpty,
  inkTranslate,
  raisedPeak,
  recoverByte,
  recoverPeak,
  recoveryFactor,
  scrollShift,
  snapToTexel,
  texelMetres,
  updateDue,
  updatePlan,
  windowUv,
  wrapTexel,
} from '../src/editor/stylized/trample/trampleMath.js';
import {
  DEFAULT_TRAMPLE_CONTACT_CAPACITY,
  GrassTrampleContacts,
} from '../src/editor/stylized/trample/GrassTrampleContacts.js';
import {
  DEFAULT_TRAMPLE_FIELD,
  GrassTrampleField,
} from '../src/editor/stylized/trample/GrassTrampleField.js';

// The field owns a render target, and a target needs a renderer to draw with,
// so nothing here calls `GrassTrampleField.update` against a live device. That
// is exactly why the field's rules live in `trampleMath.js`: whether an update
// is worth doing, how far a texel has recovered and which texels a contact
// dirties are all pure functions, and they are what these tests pin. What is
// left in the field is the pass itself and the resource lifecycle, and the one
// part of that which does not need a GPU -- allocation and disposal -- is
// covered at the end.

// ------------------------------------------------------------------ encoding

test('the direction channel round-trips exactly on the byte grid', () => {
  // A texel written and read back has to be the same byte, or the recovery pass
  // cannot be reasoned about as arithmetic on bytes. This is the property that
  // lets the shader's floor(value * factor) and the CPU twin agree.
  for (let byte = 0; byte <= 255; byte += 1) {
    assert.equal(encodeDirection(decodeDirection(byte)), byte, `byte ${byte}`);
  }
  assert.equal(encodeDirection(-1), 0);
  assert.equal(encodeDirection(0), 128);
  assert.equal(encodeDirection(1), 255);
  // Out of range is clamped, not wrapped: a direction is a direction.
  assert.equal(encodeDirection(-4), 0);
  assert.equal(encodeDirection(4), 255);
  // The bias means zero is 128, so an undisturbed texel decodes to a hair off
  // zero rather than exactly zero. The material tolerates it; this pins it so a
  // reader does not "fix" it and shift the whole field west.
  assert.ok(Math.abs(decodeDirection(128)) < 0.005);
});

test('the crush and freshness channels round-trip exactly', () => {
  for (let byte = 0; byte <= 255; byte += 1) {
    assert.equal(encodeAmount(decodeAmount(byte)), byte, `byte ${byte}`);
  }
  assert.equal(encodeAmount(0), 0);
  assert.equal(encodeAmount(1), 255);
  assert.equal(encodeAmount(-1), 0);
  assert.equal(encodeAmount(2), 255);
});

// ------------------------------------------------------------------- falloff

test('the contact falloff is 1 at the centre, 0 at the radius, monotonic between', () => {
  assert.equal(contactFalloff(0, 2), 1);
  assert.equal(contactFalloff(2, 2), 0);
  assert.equal(contactFalloff(3, 2), 0);
  assert.equal(contactFalloff(-1, 2), 1);
  // A contact with no reach presses nothing, whatever the distance.
  assert.equal(contactFalloff(0, 0), 0);
  assert.equal(contactFalloff(0.5, Number.NaN), 0);

  let previous = 1;
  for (let distance = 0; distance <= 2; distance += 0.05) {
    const value = contactFalloff(distance, 2);
    assert.ok(value >= 0 && value <= 1, `value ${value}`);
    assert.ok(value <= previous + 1e-12, `not monotone at ${distance}`);
    previous = value;
  }
  // Quadratic, not linear: half way out the falloff is 0.75, a linear ramp
  // would say 0.5. Pinning the shape keeps a print reading as a soft press.
  assert.ok(Math.abs(contactFalloff(1, 2) - 0.75) < 1e-12);
});

test('the inner radius lifts a flat plateau under the contact', () => {
  // A foot or a body should press its whole sole flat rather than spike at one
  // texel, so the plateau holds full strength out to the inner radius and only
  // the edge gives.
  assert.equal(contactFalloff(1, 2, 0.5), 1);
  assert.equal(contactFalloff(0, 2, 0.5), 1);
  assert.ok(Math.abs(contactFalloff(1.5, 2, 0.5) - 0.75) < 1e-12);
  assert.equal(contactFalloff(2, 2, 0.5), 0);
  // A fraction of 1 would fill the whole disc; it is clamped so callers can
  // ease the value in without a range check of their own.
  assert.equal(contactFalloff(1.99, 2, 4), 1);
});

// ------------------------------------------------------------------ recovery

test('recovery returns a texel to neutral and never past it', () => {
  assert.equal(recoverByte(0, 0.5), 0);
  assert.equal(recoverByte(0, 0), 0);
  // A factor of 1 is "no time has passed", not "spring all the way back".
  assert.equal(recoverByte(255, 1), 255);
  // Floor is what makes this exact: 0.999 * the last byte is 0.
  assert.equal(recoverByte(1, 0.999), 0);
  assert.equal(recoverPeak(1, 0.999), 0);

  let value = 255;
  let steps = 0;
  while (value > 0 && steps < 500) {
    value = recoverByte(value, 0.72);
    assert.ok(value >= 0 && value <= 255, `out of range: ${value}`);
    steps += 1;
  }
  assert.equal(value, 0);
  // It converges in seconds of pass time, not in hundreds of passes.
  assert.ok(steps < 40, `took ${steps} passes`);
  // And once neutral it stays neutral, which is what lets the pass be skipped.
  for (let i = 0; i < 10; i += 1) assert.equal(recoverByte(0, 0.3), 0);
});

test('the decay is expressed per second, so the cadence cap cannot slow it', () => {
  assert.equal(recoveryFactor(0.5, 0), 1);
  assert.equal(recoveryFactor(0.5, 1), 0.5);
  assert.equal(recoveryFactor(1, 5), 1);
  // Two half-second steps and one one-second step land in the same place.
  const twoSteps = recoveryFactor(0.5, 0.5) * recoveryFactor(0.5, 0.5);
  assert.ok(Math.abs(twoSteps - recoveryFactor(0.5, 1)) < 1e-12);
  // Monotone in time, so a longer gap always decays further.
  let previous = 1;
  for (let seconds = 0; seconds <= 4; seconds += 0.25) {
    const value = recoveryFactor(0.4, seconds);
    assert.ok(value <= previous + 1e-12);
    previous = value;
  }
});

test('a high-water mark only rises on a paint and falls on a recovery', () => {
  assert.equal(raisedPeak(10, 4), 10);
  assert.equal(raisedPeak(10, 40), 40);
  assert.equal(recoverPeak(0, 0.5), 0);
  assert.equal(recoverPeak(200, 0.5), 100);
});

// --------------------------------------------------------------- peak and ink

test('the peak and ink skip a still focus and do the minimum for a small move', () => {
  // Settled: nothing to recover, nothing moved, no contacts. A still, recovered
  // player costs nothing at all -- the donor's whole reason for the high-water
  // mark.
  assert.deepEqual(updatePlan({ peak: 0, shiftX: 0, shiftY: 0 }), {
    recover: false,
    scroll: false,
    run: false,
  });
  // Standing still with ink: recover only, and the ink rectangle is what bounds
  // it. No reprojection is asked for because nothing moved.
  assert.deepEqual(updatePlan({ peak: 200, shiftX: 0, shiftY: 0 }), {
    recover: true,
    scroll: false,
    run: true,
  });
  // The window moved but the field is empty. A translate of an all-zero red
  // channel is that same all-zero channel, so there is nothing to scroll.
  assert.deepEqual(updatePlan({ peak: 0, shiftX: 5, shiftY: -3 }), {
    recover: false,
    scroll: false,
    run: false,
  });
  // Ink and a whole-texel move: both.
  assert.deepEqual(updatePlan({ peak: 200, shiftX: 5, shiftY: -3 }), {
    recover: true,
    scroll: true,
    run: true,
  });
  // A footfall must land the frame it happens, whatever the mark says.
  assert.equal(updatePlan({ peak: 0, hasContacts: true }).run, true);
});

test('a sub-texel move scrolls nothing, a whole one scrolls exactly', () => {
  const texel = texelMetres(DEFAULT_TRAMPLE_FIELD.windowMetres, DEFAULT_TRAMPLE_FIELD.texels);
  // 75 m over 256 texels: the donor's 0.29 m.
  assert.ok(Math.abs(texel - 0.29296875) < 1e-9);
  assert.deepEqual(scrollShift(texel * 0.4, -texel * 0.9, texel), { shiftX: 0, shiftY: 0 });
  assert.deepEqual(scrollShift(texel * 2.9, -texel * 0.2, texel), { shiftX: 2, shiftY: 0 });
  // Trunc, so the shift is monotone and a player sitting on a texel boundary
  // cannot oscillate the field back and forth.
  assert.deepEqual(scrollShift(-texel * 1.5, texel * 1.5, texel), { shiftX: -1, shiftY: 1 });
  assert.deepEqual(scrollShift(Number.NaN, 0, texel), { shiftX: 0, shiftY: 0 });
});

test('the cadence cap delays a pass but never a contact', () => {
  const interval = DEFAULT_TRAMPLE_FIELD.updateIntervalSeconds;
  const plan = { recover: true, scroll: false, run: true };
  assert.equal(updateDue({ plan, elapsedSeconds: 0.001, intervalSeconds: interval }), false);
  assert.equal(updateDue({ plan, elapsedSeconds: interval, intervalSeconds: interval }), true);
  assert.equal(updateDue({ plan, hasContacts: true, elapsedSeconds: 0.001, intervalSeconds: interval }), true);
  // A settled plan is due never, however long it has been idle.
  assert.equal(
    updateDue({ plan: updatePlan({}), elapsedSeconds: 1000, intervalSeconds: interval }),
    false,
  );
  // No interval configured means uncapped.
  assert.equal(updateDue({ plan, elapsedSeconds: 0, intervalSeconds: 0 }), true);
});

test('the dirty rectangle grows, translates with the content and stops at the edge', () => {
  const empty = emptyInk();
  assert.equal(inkIsEmpty(empty), true);
  let ink = inkAdd(empty, { minX: 10, minY: 10, maxX: 12, maxY: 12 }, 256);
  ink = inkAdd(ink, { minX: 8, minY: 14, maxX: 9, maxY: 20 }, 256);
  assert.deepEqual(ink, { minX: 8, minY: 10, maxX: 12, maxY: 20 });
  // Clamped to the texture: a rectangle the size of the world is a full window.
  assert.deepEqual(
    inkAdd(emptyInk(), { minX: -5, minY: -5, maxX: 900, maxY: 900 }, 256),
    { minX: 0, minY: 0, maxX: 255, maxY: 255 },
  );
  // A rectangle wholly outside contributes nothing.
  assert.equal(inkIsEmpty(inkAdd(emptyInk(), { minX: 300, minY: 0, maxX: 320, maxY: 5 }, 256)), true);
  // Target texel (x, y) reads source (x + shift), so the content moves the other
  // way and anything pushed off the texture is dropped -- it would be neutral.
  assert.deepEqual(
    inkTranslate({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, 4, -4, 256),
    { minX: 6, minY: 14, maxX: 16, maxY: 24 },
  );
  assert.equal(inkIsEmpty(inkTranslate({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, 30, 0, 256)), true);
  // And a translated empty rectangle stays empty rather than becoming huge.
  assert.equal(inkIsEmpty(inkTranslate(emptyInk(), 3, 3, 256)), true);
});

test("a contact's rectangle carries the one-texel filtering margin", () => {
  const texel = texelMetres(75, 256);
  const rect = inkFromContact({ x: 0, z: 0, radius: texel * 2 }, 0, 0, 75, 256);
  // Centre texel 128, reach ceil(2) + 1 = 3, so the print's edge texels have a
  // neighbour on each side carrying the same value for linear filtering.
  assert.deepEqual(rect, { minX: 125, minY: 125, maxX: 131, maxY: 131 });
  const offset = inkFromContact({ x: texel * 10, z: -texel * 10, radius: 0.1 }, 0, 0, 75, 256);
  assert.deepEqual(offset, { minX: 136, minY: 116, maxX: 140, maxY: 120 });
});

// ------------------------------------------------------------------ addressing

test('the window is snapped to whole texels and addressed modulo the grid', () => {
  const texel = 0.5;
  assert.equal(snapToTexel(3.3, texel), 3.5);
  assert.equal(snapToTexel(-3.3, texel), -3.5);
  assert.equal(snapToTexel(0, texel), 0);
  // A power-of-two texel keeps the snapped centre exact in float32 to planet
  // scale, which is why the window size and texel count are chosen to divide.
  assert.equal(snapToTexel(8_000_000.25, texel), 8_000_000.5);
  assert.equal(snapToTexel(Number.NaN, texel), 0);

  // The toroidal form, for an addressing mode that wraps instead of scrolling.
  assert.equal(wrapTexel(-1, 256), 255);
  assert.equal(wrapTexel(256, 256), 0);
  assert.equal(wrapTexel(257, 256), 1);
  assert.equal(wrapTexel(4, 256), 4);

  // The JS twin of the expression the material runs.
  assert.deepEqual(windowUv(0, 0, 0, 0, 75), { u: 0.5, v: 0.5 });
  const edge = windowUv(37.5, -37.5, 0, 0, 75);
  assert.ok(Math.abs(edge.u - 1) < 1e-12);
  assert.ok(Math.abs(edge.v) < 1e-12);
});

// -------------------------------------------------------------- contact buffer

test('the contact buffer takes a full frame and then refuses deterministically', () => {
  const contacts = new GrassTrampleContacts(4);
  assert.equal(DEFAULT_TRAMPLE_CONTACT_CAPACITY, 16);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(contacts.submitContact({ x: index, z: index * 2, radius: 0.5 }), true);
  }
  assert.equal(contacts.count, 4);
  // Overflow is refused, not grown: the field's per-update cost must not depend
  // on how many NPCs happened to be near the camera.
  assert.equal(contacts.submitContact({ x: 9, z: 9, radius: 0.5 }), false);
  assert.equal(contacts.count, 4);
  assert.equal(contacts.dropped, 1);
  assert.equal(contacts.submitContact({ x: 9, z: 9, radius: 0.5 }), false);
  assert.equal(contacts.dropped, 2);
  // The refused contact left nothing behind.
  const seen = [];
  contacts.forEach((contact) => seen.push([contact.x, contact.z]));
  assert.deepEqual(seen, [[0, 0], [1, 2], [2, 4], [3, 6]]);

  contacts.clear();
  assert.equal(contacts.count, 0);
  assert.equal(contacts.dropped, 2, 'clear drains contacts, it does not hide the drop count');
  assert.equal(contacts.submitContact({ x: 1, z: 1, radius: 0.5 }), true);
  contacts.reset();
  assert.equal(contacts.count, 0);
  assert.equal(contacts.dropped, 0);
});

test('the contact buffer refuses what would poison the field and clamps the rest', () => {
  const contacts = new GrassTrampleContacts(4);
  // A NaN position paints NaN into every texel it touches, and floor(NaN) never
  // recovers: the grass would stay bent for the session.
  assert.equal(contacts.submitContact({ x: Number.NaN, z: 0, radius: 1 }), false);
  assert.equal(contacts.submitContact({ x: 0, z: Number.POSITIVE_INFINITY, radius: 1 }), false);
  assert.equal(contacts.submitContact({ x: 0, z: 0, radius: 0 }), false);
  assert.equal(contacts.submitContact({ x: 0, z: 0, radius: Number.NaN }), false);
  assert.equal(contacts.count, 0);
  assert.equal(contacts.dropped, 0, 'a refused value is not an overflow');

  contacts.submitContact({
    x: 1,
    z: 2,
    radius: -3,
    strength: 4,
    directionX: -2,
    directionZ: 0.5,
    innerRadiusFraction: -1,
    directionalBlend: 9,
  });
  const record = contacts.at(0);
  assert.equal(record.radius, 3);
  assert.equal(record.strength, 1);
  assert.equal(record.directionX, -1);
  assert.equal(record.directionZ, 0.5);
  assert.equal(record.innerRadiusFraction, 0);
  assert.equal(record.directionalBlend, 1);
  // Defaults are a full-strength radial press, which is a footfall.
  const second = new GrassTrampleContacts(1);
  second.submitContact({ x: 0, z: 0, radius: 0.7 });
  assert.equal(second.strength[0], 1);
  assert.equal(second.directionX[0], 0);
  assert.equal(second.directionZ[0], 0);
  assert.equal(second.innerRadiusFraction[0], 0);
  assert.equal(second.directionalBlend[0], 0);

  assert.throws(() => new GrassTrampleContacts(0), RangeError);
  assert.throws(() => new GrassTrampleContacts(1.5), RangeError);
});

// ------------------------------------------------------------------ field

test('the field allocates without a renderer, reconfigures, and disposes twice', () => {
  const field = new GrassTrampleField({ config: { texels: 32, windowMetres: 12 } });
  assert.ok(field.stateTexture, 'the field should expose its state texture');
  assert.equal(field.state.width, 32);
  const first = field.stateTexture;

  // A settled field with nothing queued makes no pass, so no renderer is
  // touched: the decision is `updatePlan`'s, which is why it lives in the pure
  // module. The sampling centre is still published, because the material reads
  // it every frame.
  assert.equal(
    field.update(null, { canonicalX: 4, canonicalZ: -4, renderX: 4, renderZ: -4 }, 0),
    false,
  );
  // Published in render space, anchored to the texel-snapped window centre and
  // not to the raw focus -- the content is on the texel grid, so a centre that
  // tracked the focus exactly would put the two half a texel apart.
  const texel = texelMetres(12, 32);
  assert.equal(field.uniforms.windowCentreRender.value.x, snapToTexel(4, texel));
  assert.equal(field.uniforms.windowCentreRender.value.y, snapToTexel(-4, texel));

  // A resolution change cannot be applied to a live mapping, so the old targets
  // are released and a fresh pair built.
  field.configure({ texels: 64 });
  assert.notEqual(field.stateTexture, first, 'reconfigure should rebuild the target');
  assert.equal(field.state.width, 64);

  // Disposal is idempotent: a teardown that runs twice, or after a failed boot,
  // must not throw or touch a disposed target.
  field.dispose();
  field.dispose();
  assert.equal(field.stateTexture, null);
  assert.throws(() => field.configure({ texels: 32 }), /dispose/);
});
