import { WATER_BODY_ID_RIVER_BASE } from './WaterConstants.js';
import { createReachProfile } from './RiverReachProfile.js';
import { atlasToWorldCell } from './WaterSourceCoordinates.js';

const MINIMUM_RIVER_RADIUS_CELLS = 0.75;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function deduplicatePoints(points) {
  const result = [];
  for (const point of points) {
    if (!point) continue;
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
      result.push(point);
    }
  }
  return result;
}

function resolveBodyId(value) {
  const id = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const bodyId = WATER_BODY_ID_RIVER_BASE + id;
  return Number.isSafeInteger(bodyId) ? bodyId : WATER_BODY_ID_RIVER_BASE;
}

function assertSourceDimensions(source) {
  const values = [
    source?.atlas?.width,
    source?.atlas?.height,
    source?.bounds?.widthCells,
    source?.bounds?.heightCells,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('River surface generation requires positive atlas and world dimensions.');
  }
}

/**
 * The river level, traced downstream sample by sample: never above the ground
 * there (less a small bank inset), never above the level upstream less the
 * minimum gradient, never above a lake it runs through, never below the sea.
 */
function createLevelTracer({ sampleBaseHeight, seaLevel, bankInset, lakeLevelAt, minimumGradient }) {
  const ceiling = (point) => Math.min(
    sampleBaseHeight(point.x, point.z) - bankInset,
    lakeLevelAt?.(point.x, point.z) ?? Number.POSITIVE_INFINITY,
  );
  return {
    start: (point) => Math.max(seaLevel, ceiling(point)),
    next: (upstream, point, distanceMeters) => Math.max(
      seaLevel,
      Math.min(ceiling(point), upstream - minimumGradient * distanceMeters),
    ),
  };
}

export function createRiverSurfaceSegments({
  source,
  sampleBaseHeight,
  seaLevel,
  config,
  lakeLevelAt = null,
}) {
  if (!source?.rivers?.length) return [];
  assertSourceDimensions(source);
  const segments = [];
  const cellSizeMeters = config.cellSizeMeters;

  for (const river of source.rivers) {
    let points = deduplicatePoints((river.points ?? []).map((point) => atlasToWorldCell(source, point)));
    if (points.length < 2) continue;
    const firstHeight = sampleBaseHeight(points[0].x, points[0].z);
    const lastHeight = sampleBaseHeight(points[points.length - 1].x, points[points.length - 1].z);
    if (firstHeight < lastHeight) points = points.reverse();

    const widthAtlas = Number(river.widthAtlas);
    const safeWidthAtlas = Number.isFinite(widthAtlas) && widthAtlas > 0 ? widthAtlas : 0;
    const worldWidthCells = Math.max(
      1 / 256,
      safeWidthAtlas / source.atlas.width * source.bounds.widthCells,
    );
    const worldWidthMeters = worldWidthCells * cellSizeMeters;
    const channelDepth = clamp(
      config.river.minimumDepth + worldWidthMeters * config.river.widthDepthRatio,
      config.river.minimumDepth,
      config.river.maximumDepth,
    );
    const radiusCells = Math.max(worldWidthCells * 0.5, MINIMUM_RIVER_RADIUS_CELLS);
    const bankInset = Math.min(0.35, channelDepth * 0.2);
    const bodyId = resolveBodyId(river.id);
    const trace = createLevelTracer({
      sampleBaseHeight,
      seaLevel,
      bankInset,
      lakeLevelAt,
      minimumGradient: config.river.minimumGradient,
    });
    let level = trace.start(points[0]);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= 1e-6) continue;
      const lengthMeters = length * cellSizeMeters;
      const steps = Math.max(1, Math.ceil(lengthMeters / config.river.profileStepMeters));
      const levels = new Float64Array(steps + 1);
      levels[0] = level;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        levels[step] = trace.next(
          levels[step - 1],
          { x: start.x + dx * t, z: start.z + dz * t },
          lengthMeters / steps,
        );
      }
      level = levels[steps];
      segments.push(Object.freeze({
        bodyId,
        profile: createReachProfile(levels, lengthMeters, config.falls),
        ax: start.x,
        az: start.z,
        bx: end.x,
        bz: end.z,
        dx,
        dz,
        length,
        flowX: dx / length,
        flowZ: dz / length,
        startSurface: levels[0],
        endSurface: levels[steps],
        radiusCells,
        channelDepth,
      }));
    }
  }
  return segments;
}
