import {
  WATER_BODY_ID_NONE,
  WATER_KIND_NONE,
  WATER_KINDS,
  WATER_SAMPLE_FLAG_NONE,
} from './WaterConstants.js';

const FLOW_EPSILON = 1e-8;

function assertFinite(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new Error(`Water sample ${fieldName} must be finite.`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Water sample ${fieldName} must be a non-negative safe integer.`);
  }
}

function normalizeFlow(flowX, flowZ) {
  assertFinite(flowX, 'flowX');
  assertFinite(flowZ, 'flowZ');
  const length = Math.hypot(flowX, flowZ);
  if (length <= FLOW_EPSILON) {
    return Object.freeze({ x: 0, z: 0 });
  }
  return Object.freeze({ x: flowX / length, z: flowZ / length });
}

export function createWaterSample({
  kind,
  bodyId = WATER_BODY_ID_NONE,
  coverage = kind === WATER_KIND_NONE ? 0 : 1,
  surfaceHeight,
  bedHeight,
  shoreDistance = 0,
  flowX = 0,
  flowZ = 0,
  fall = 0,
  plunge = 0,
  flags = WATER_SAMPLE_FLAG_NONE,
}) {
  if (!WATER_KINDS.includes(kind)) {
    throw new Error(`Unknown water kind: ${kind}.`);
  }
  assertNonNegativeInteger(bodyId, 'bodyId');
  assertNonNegativeInteger(flags, 'flags');
  assertFinite(coverage, 'coverage');
  assertFinite(surfaceHeight, 'surfaceHeight');
  assertFinite(bedHeight, 'bedHeight');
  assertFinite(shoreDistance, 'shoreDistance');
  if (coverage < 0 || coverage > 1) {
    throw new Error('Water sample coverage must be within [0, 1].');
  }
  for (const [value, name] of [[fall, 'fall'], [plunge, 'plunge']]) {
    assertFinite(value, name);
    if (value < 0 || value > 1) throw new Error(`Water sample ${name} must be within [0, 1].`);
  }
  if (shoreDistance < 0) {
    throw new Error('Water sample shoreDistance must be non-negative.');
  }
  if (kind === WATER_KIND_NONE && coverage !== 0) {
    throw new Error('A non-water sample must have zero coverage.');
  }

  const flow = normalizeFlow(flowX, flowZ);
  const depth = kind === WATER_KIND_NONE
    ? 0
    : Math.max(0, surfaceHeight - bedHeight);

  return Object.freeze({
    kind,
    bodyId: kind === WATER_KIND_NONE ? WATER_BODY_ID_NONE : bodyId,
    coverage,
    surfaceHeight: kind === WATER_KIND_NONE ? bedHeight : surfaceHeight,
    bedHeight,
    depth,
    shoreDistance: kind === WATER_KIND_NONE ? 0 : shoreDistance,
    flowX: kind === WATER_KIND_NONE ? 0 : flow.x,
    flowZ: kind === WATER_KIND_NONE ? 0 : flow.z,
    /** 0..1: how much of this point is the face of a waterfall. */
    fall: kind === WATER_KIND_NONE ? 0 : fall,
    /** 0..1: churn in the plunge pool below a fall. */
    plunge: kind === WATER_KIND_NONE ? 0 : plunge,
    flags,
  });
}

export function createNoWaterSample(bedHeight = 0) {
  assertFinite(bedHeight, 'bedHeight');
  return createWaterSample({
    kind: WATER_KIND_NONE,
    surfaceHeight: bedHeight,
    bedHeight,
  });
}
