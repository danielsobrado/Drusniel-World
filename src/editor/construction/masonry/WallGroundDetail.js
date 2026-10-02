import { createRandom, mixSeed } from '../../workshop/ProceduralRandom.js';
import { CONSTRUCTION_GROWTH_PROFILES } from '../config/ConstructionGrowthProfiles.generated.js';
import { survivingIntervalsOverBand } from './OpeningLayout.js';
import { constructionStyle } from './ConstructionStyleCatalog.js';

// Includes the offset pebble and bent blades, with margin for curved frames.
export const GROUND_DETAIL_RADIUS = 0.14;

/** Sparse wall contact dressing, owned by stable semantic cells on both faces. */
export function planWallGroundDetail(record, arcTable, pathInterval) {
  const profile = CONSTRUCTION_GROWTH_PROFILES[record.style.key];
  const ground = profile?.ground;
  if (!ground || !pathInterval || record.style.growth === 'none') return [];
  const details = []; const [from, to] = pathInterval;
  const footingReach = constructionStyle(record.style.key).footing?.plinth ?? 0;
  const openings = record.features.map(feature => ({ ...feature, s: arcTable.toArc(feature.segmentId, feature.arcFraction) }));
  for (const segment of record.path.segments) {
    const start = arcTable.toArc(segment.id, 0); const end = arcTable.toArc(segment.id, 1);
    if (end <= from || start >= to) continue;
    let seed = record.seed ^ 0x71df804b;
    for (const letter of segment.id) seed = mixSeed(seed, letter.charCodeAt(0));
    const first = Math.max(0, Math.floor((from - start) / ground.cellSize));
    const last = Math.ceil((Math.min(end, to) - start) / ground.cellSize);
    for (let cell = first; cell < last; cell += 1) for (const side of [-1, 1]) {
      const random = createRandom(mixSeed(seed, cell * 2 + (side > 0 ? 1 : 0)));
      const s = start + (cell + 0.2 + random() * 0.6) * ground.cellSize;
      if (s < from || s >= to || s + GROUND_DETAIL_RADIUS >= end) continue;
      const spans = survivingIntervalsOverBand([s - GROUND_DETAIL_RADIUS, s + GROUND_DETAIL_RADIUS], openings,
        [0, 0.3], { clearance: profile.clearance });
      if (spans.length !== 1 || Math.abs(spans[0][1] - spans[0][0] - GROUND_DETAIL_RADIUS * 2) > 1e-7) continue;
      details.push(Object.freeze({ id: `${segment.id}:ground:${cell}:${side}`, s, side,
        offset: record.dimensions.thickness / 2 + footingReach + 0.07 + random() * ground.reach,
        angle: random() * Math.PI * 2, height: 0.08 + random() * 0.12,
        color: profile.palette[Math.floor(random() * profile.palette.length)],
        flower: random() < ground.flowerChance, pebble: random() < ground.pebbleChance,
        moss: random() < ground.mossChance }));
      if (details.length >= ground.maxDetailsPerModule) return details;
    }
  }
  return details;
}
