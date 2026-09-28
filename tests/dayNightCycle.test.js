import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize, uniform, vec3 } from 'three/tsl';
import {
  DayNightCycle,
  EAST_AZIMUTH_DEGREES,
  HOURS_PER_DAY,
  SYNODIC_MONTH_DAYS,
  TIME_PRESET_ANCHORS,
  TIME_PRESET_NAMES,
  WEST_AZIMUTH_DEGREES,
  angularSeparationDegrees,
  moonIllumination,
  moonPhase,
  moonPhaseName,
  moonPosition,
  nearestPreset,
  noonElevationDegrees,
  presetWeights,
  sunPosition,
  wrapHours,
} from '../src/editor/stylized/sky/dayNightCycle.js';
import { SKY_PRESETS } from '../src/editor/stylized/sky/SkyPresets.js';
import {
  createMoonDiscNode,
  createStarFieldNode,
  rotateStarDirection,
  starDirection,
  starElevationDegrees,
  starList,
  starMagnitude,
} from '../src/editor/stylized/sky/starField.js';

const LATITUDE = 40;

test('the clock wraps at midnight', () => {
  assert.equal(wrapHours(24), 0);
  assert.equal(wrapHours(25), 1);
  assert.equal(wrapHours(0), 0);
  assert.equal(wrapHours(-1), 23);
  assert.equal(wrapHours(47.5), 23.5);

  // A 24-second day means one second is one hour, so a step over midnight must
  // land on hour 0 and roll the day count, not on hour 24.
  const clock = new DayNightCycle({ hour: 23, dayLengthSeconds: HOURS_PER_DAY });
  clock.update(1);
  assert.ok(Math.abs(clock.hour) < 1e-9, `expected midnight, got ${clock.hour}`);
  assert.ok(Math.abs(clock.dayCount - 1 / HOURS_PER_DAY) < 1e-12);
});

test('the sun rises in the east and sets in the west', () => {
  const rising = sunPosition(6, { latitudeDegrees: LATITUDE });
  assert.ok(Math.abs(rising.azimuth - EAST_AZIMUTH_DEGREES) < 1e-9);
  assert.ok(Math.abs(rising.elevation) < 1e-9, 'the sun sits on the horizon at sunrise');

  const setting = sunPosition(18, { latitudeDegrees: LATITUDE });
  assert.ok(Math.abs(setting.azimuth - WEST_AZIMUTH_DEGREES) < 1e-9);

  let previous = -Infinity;
  for (let hour = 6; hour <= 18.0001; hour += 0.25) {
    const { azimuth } = sunPosition(hour, { latitudeDegrees: LATITUDE });
    assert.ok(azimuth >= previous - 1e-9, `azimuth went backwards at ${hour}h`);
    previous = azimuth;
  }
});

test('the sun peaks at noon and is negative at midnight', () => {
  const noon = sunPosition(12, { latitudeDegrees: LATITUDE });
  assert.ok(noon.elevation > sunPosition(11, { latitudeDegrees: LATITUDE }).elevation);
  assert.ok(noon.elevation > sunPosition(13, { latitudeDegrees: LATITUDE }).elevation);
  assert.ok(Math.abs(noon.elevation - noonElevationDegrees(LATITUDE)) < 1e-9);

  const midnight = sunPosition(0, { latitudeDegrees: LATITUDE });
  assert.ok(midnight.elevation < -10, 'midnight sun is well below the horizon');
  assert.ok(Math.abs(midnight.elevation - sunPosition(24, { latitudeDegrees: LATITUDE }).elevation) < 1e-9);

  // A world tilted further from the sun has a lower noon.
  assert.ok(sunPosition(12, { latitudeDegrees: 70 }).elevation < noon.elevation);
});

test('the moon is not co-located with the sun', () => {
  // A full moon is genuinely opposite the sun, not a second sun.
  const fullMoonDay = SYNODIC_MONTH_DAYS / 2;
  for (const hour of [0, 3, 6, 12, 18, 21]) {
    const separation = angularSeparationDegrees(
      sunPosition(hour, { latitudeDegrees: LATITUDE }),
      moonPosition(hour, fullMoonDay, { latitudeDegrees: LATITUDE }),
    );
    assert.ok(separation > 90, `full moon at ${hour}h was only ${separation.toFixed(1)} deg from the sun`);
  }

  // Near conjunction a real moon rides close to the sun, and only the moon's
  // 5.1 deg orbital inclination keeps the two discs apart at all. Swept over the
  // month the closest approach is a few degrees — never co-located.
  let minimum = Infinity;
  for (let day = 0; day < SYNODIC_MONTH_DAYS; day += 0.25) {
    for (const hour of [0, 6, 12, 18]) {
      const separation = angularSeparationDegrees(
        sunPosition(hour, { latitudeDegrees: LATITUDE }),
        moonPosition(hour, day, { latitudeDegrees: LATITUDE }),
      );
      minimum = Math.min(minimum, separation);
    }
  }
  assert.ok(minimum > 3, `the moon came within ${minimum.toFixed(2)} deg of the sun`);
});

test('the moon phase cycles over a synodic month', () => {
  assert.equal(moonPhase(0), 0);
  assert.equal(moonPhase(SYNODIC_MONTH_DAYS), 0, 'a month returns to the same phase');
  assert.ok(Math.abs(moonPhase(SYNODIC_MONTH_DAYS / 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(moonPhase(SYNODIC_MONTH_DAYS / 4) - 0.25) < 1e-9);

  assert.equal(moonIllumination(0), 0, 'new moon is dark');
  assert.ok(Math.abs(moonIllumination(0.5) - 1) < 1e-9, 'full moon is lit');
  assert.ok(Math.abs(moonIllumination(0.25) - 0.5) < 1e-9, 'quarter moon is half lit');

  assert.equal(moonPhaseName(0), 'new');
  assert.equal(moonPhaseName(0.25), 'first quarter');
  assert.equal(moonPhaseName(0.5), 'full');
  assert.equal(moonPhaseName(0.75), 'last quarter');

  let previous = -1;
  for (let day = 0; day < SYNODIC_MONTH_DAYS; day += 0.5) {
    const phase = moonPhase(day);
    assert.ok(phase >= previous - 1e-12, `phase went backwards at day ${day}`);
    previous = phase;
  }
});

test('the preset weights sum to one and pick a sensible preset', () => {
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 0.5) {
    const weights = presetWeights(hour);
    const total = TIME_PRESET_NAMES.reduce((sum, name) => sum + weights[name], 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total} at ${hour}h`);
    for (const name of TIME_PRESET_NAMES) assert.ok(weights[name] >= 0);
  }

  assert.equal(nearestPreset(6), 'stillmeadow', 'dawn is the soft morning');
  assert.equal(nearestPreset(12), 'highfield', 'noon is the full day');
  assert.equal(nearestPreset(19), 'emberfall', 'dusk is the golden hour');
  assert.equal(nearestPreset(0), 'moonrise', 'midnight is night');

  for (const { preset, hour } of TIME_PRESET_ANCHORS) {
    assert.equal(nearestPreset(hour), preset, `${preset} should dominate its own anchor hour`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(SKY_PRESETS, preset),
      `${preset} must be a preset that already exists`,
    );
    assert.ok(presetWeights(hour)[preset] > 0.99);
  }

  // The untimed base look is never chosen by the clock.
  assert.equal(TIME_PRESET_NAMES.includes('configured'), false);
});

test('the same input gives the same output', () => {
  assert.deepEqual(
    sunPosition(9.25, { latitudeDegrees: 33 }),
    sunPosition(9.25, { latitudeDegrees: 33 }),
  );
  assert.deepEqual(moonPosition(9.25, 12.3), moonPosition(9.25, 12.3));
  assert.deepEqual(presetWeights(9.25), presetWeights(9.25));

  const a = new DayNightCycle({ hour: 5, dayLengthSeconds: 60 });
  const b = new DayNightCycle({ hour: 5, dayLengthSeconds: 60 });
  for (const dt of [0.5, 0.25, 1, 3, 0.1]) assert.equal(a.update(dt), b.update(dt));
  assert.deepEqual(a.evaluate(), b.evaluate());
});

test('a paused cycle is a no-op', () => {
  const cycle = new DayNightCycle({ hour: 18, dayLengthSeconds: 60, paused: true });
  const before = cycle.evaluate();
  assert.equal(cycle.update(5), before.preset);
  assert.equal(cycle.hour, 18, 'a paused clock does not advance');
  assert.deepEqual(cycle.evaluate(), before);

  cycle.setPaused(false);
  cycle.update(1);
  assert.notEqual(cycle.hour, 18, 'a resumed clock moves again');
});

test('the star field distribution is stable and bounded to the dome', () => {
  const count = 4000;
  let bright = 0;
  let brightest = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (let index = 0; index < count; index += 1) {
    const direction = starDirection(index);
    const radius = Math.hypot(direction.x, direction.y, direction.z);
    assert.ok(Math.abs(radius - 1) < 1e-9, `star ${index} is off the dome (r=${radius})`);
    assert.ok(Math.abs(direction.x) <= 1 && Math.abs(direction.y) <= 1 && Math.abs(direction.z) <= 1);

    const elevation = starElevationDegrees(direction);
    assert.ok(elevation >= -90 - 1e-9 && elevation <= 90 + 1e-9);

    const magnitude = starMagnitude(index);
    assert.ok(magnitude >= 0 && magnitude <= 1);
    if (magnitude > 0.5) bright += 1;
    brightest = Math.max(brightest, magnitude);

    sumX += direction.x;
    sumY += direction.y;
    sumZ += direction.z;
  }

  // Few bright stars, many faint ones.
  const brightFraction = bright / count;
  assert.ok(brightFraction > 0 && brightFraction < 0.35, `bright fraction ${brightFraction} is not sparse`);
  assert.ok(brightest > 0.9, 'the distribution must reach bright magnitudes');

  // Roughly uniform over the dome: the mean direction points nowhere.
  assert.ok(Math.abs(sumX / count) < 0.05);
  assert.ok(Math.abs(sumY / count) < 0.05);
  assert.ok(Math.abs(sumZ / count) < 0.05);

  // Stable: the same index and seed give the same star.
  assert.deepEqual(starDirection(7, 3), starDirection(7, 3));
  assert.equal(starMagnitude(7, 3), starMagnitude(7, 3));
});

test('rotation turns the field without leaving the dome', () => {
  const direction = starDirection(42);
  const rotated = rotateStarDirection(direction, 123);
  assert.ok(Math.abs(Math.hypot(rotated.x, rotated.y, rotated.z) - 1) < 1e-9);
  assert.equal(rotated.y, direction.y, 'the pole axis is untouched');

  const fullTurn = rotateStarDirection(direction, 360);
  assert.ok(Math.abs(fullTurn.x - direction.x) < 1e-9 && Math.abs(fullTurn.z - direction.z) < 1e-9);

  const a = starList(500, 9, { presence: 0.5 });
  const b = starList(500, 9, { presence: 0.5 });
  assert.deepEqual(a, b, 'the star list is deterministic');
  assert.ok(a.length > 0 && a.length < 500, 'presence thins the field');
  for (const star of a) {
    assert.ok(Math.abs(Math.hypot(star.direction.x, star.direction.y, star.direction.z) - 1) < 1e-9);
  }
});

test('the star field TSL node assembles', () => {
  // Building the graph here, in plain JavaScript, catches TSL API misuse in the
  // test run rather than as a blank night sky in the browser.
  const node = createStarFieldNode({
    direction: normalize(vec3(0.2, 0.9, 0.3)),
    time: uniform(0),
    density: 120,
  });
  assert.ok(node, 'the star node should build');

  // The moon disc is added over the same sky gradient, so it has to assemble from
  // the same inputs — a direction, a place for the moon and its phase.
  const moon = createMoonDiscNode({
    direction: normalize(vec3(0.2, 0.9, 0.3)),
    moonDirection: uniform(vec3(0.1, 0.6, 0.8)).normalize(),
    illumination: uniform(0.7),
  });
  assert.ok(moon, 'the moon disc node should build');
});
