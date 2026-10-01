/**
 * What kind of place an Azgaar burg is, and what it looks like.
 *
 * Azgaar reports population in thousands. Classes set the town's radius, how
 * many buildings its plots may hold and which landmarks it earns; the style is
 * chosen from the burg's culture so neighbouring towns of one people share
 * stone, roof and render. Pure data, safe in terrain workers.
 */

export const SETTLEMENT_CLASSES = Object.freeze([
  Object.freeze({ id: 'hamlet', maxPopulation: 0.6, radius: 55, buildings: 10, farms: 3 }),
  Object.freeze({ id: 'village', maxPopulation: 2.5, radius: 95, buildings: 26, farms: 5 }),
  Object.freeze({ id: 'town', maxPopulation: 10, radius: 150, buildings: 60, farms: 7 }),
  Object.freeze({ id: 'city', maxPopulation: 40, radius: 210, buildings: 105, farms: 9 }),
  Object.freeze({ id: 'metropolis', maxPopulation: Infinity, radius: 260, buildings: 145, farms: 10 }),
]);

const CLASS_RANK = Object.freeze(Object.fromEntries(SETTLEMENT_CLASSES.map(({ id }, index) => [id, index])));

/** Farm belt, as a multiple of the town radius. */
export const FARM_BELT = Object.freeze({ inner: 1.12, outer: 1.75 });

const STYLES = Object.freeze([
  Object.freeze({ key: 'granite-slate', style: 'granite', topStyle: 'slate', finishes: ['limewash', 'ochre', 'masonry'] }),
  Object.freeze({ key: 'limestone-terracotta', style: 'limestone', topStyle: 'terracotta', finishes: ['limewash', 'ochre', 'rose'] }),
  Object.freeze({ key: 'sandstone-terracotta', style: 'sandstone', topStyle: 'terracotta', finishes: ['ochre', 'rose', 'limewash'] }),
  Object.freeze({ key: 'limestone-slate', style: 'limestone', topStyle: 'slate', finishes: ['limewash', 'masonry', 'ochre'] }),
]);

export function hashInts(...values) {
  let hash = 2166136261;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export function classFor(population) {
  const value = Number.isFinite(population) ? population : 0;
  return SETTLEMENT_CLASSES.find((entry) => value < entry.maxPopulation) ?? SETTLEMENT_CLASSES.at(-1);
}

export function classRank(classId) {
  return CLASS_RANK[classId] ?? 0;
}

export function styleFor(settlement) {
  const culture = Number.isFinite(settlement.culture) ? settlement.culture : settlement.id;
  return STYLES[hashInts(culture, 0x5717e) % STYLES.length];
}

/**
 * Everything the planner needs to know about a burg beyond its position:
 * size class, the outer radius its plan may touch, its style and landmarks.
 */
export function settlementProfile(settlement) {
  const size = classFor(settlement.population);
  const rank = classRank(size.id);
  const radius = size.radius * (0.9 + (hashInts(settlement.id, 0x7ad1) % 1000) / 1000 * 0.2);
  const walled = Boolean(settlement.walls) && rank >= 2;
  return Object.freeze({
    ...size,
    rank,
    radius,
    reach: radius * FARM_BELT.outer + 12,
    style: styleFor(settlement),
    walled,
    keep: Boolean(settlement.citadel) || (Boolean(settlement.capital) && rank >= 2),
    square: rank >= 1 || Boolean(settlement.plaza),
    chapel: rank >= 1 || Boolean(settlement.temple),
    market: rank >= 1,
    trade: rank >= 2,
    port: Boolean(settlement.port),
  });
}
