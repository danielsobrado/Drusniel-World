import { createRandom, mixSeed } from '../../workshop/ProceduralRandom.js';
import { CONSTRUCTION_GROWTH_PROFILES } from '../config/ConstructionGrowthProfiles.generated.js';
import { createWallTopProfile } from './WallTopProfile.js';
import { constructionStyle } from './ConstructionStyleCatalog.js';
import { survivingIntervalsOverBand } from './OpeningLayout.js';

function segmentSeed(seed, id) {
  for (const letter of id) seed = mixSeed(seed, letter.charCodeAt(0));
  return seed;
}

/** Stable, bounded ground-rooted growth in semantic surface coordinates. */
export function planWallGrowth(record, arcTable, pathInterval) {
  const profile = CONSTRUCTION_GROWTH_PROFILES[record.style.key];
  if (!profile || !pathInterval || record.style.growth === 'none') return [];
  const [from, to] = pathInterval;
  const top = createWallTopProfile(record, arcTable, { style: constructionStyle(record.style.key) });
  const openings = record.features.map(feature => ({ ...feature,
    s: arcTable.toArc(feature.segmentId, feature.arcFraction) }));
  const leaves = [];
  for (const segment of record.path.segments) {
    const start = arcTable.toArc(segment.id, 0);
    const end = arcTable.toArc(segment.id, 1);
    if (end <= from || start >= to) continue;
    const seed = segmentSeed(record.seed ^ 0x49a381ef, segment.id);
    const first = Math.max(0, Math.floor((from - start) / profile.cellSize));
    const last = Math.ceil((Math.min(end, to) - start) / profile.cellSize);
    for (let cell = first; cell < last; cell += 1) for (const side of [-1, 1]) {
      const random = createRandom(mixSeed(seed, cell * 2 + (side > 0 ? 1 : 0)));
      if (random() > profile.chance) continue;
      const root = start + (cell + 0.2 + random() * 0.6) * profile.cellSize;
      if (root < from || root >= to || root >= end - 0.2) continue;
      const height = Math.max(0.07, Math.min(profile.maximumHeight,
        top.heightAt(root) - profile.leafRadius[1] - 0.08)) * (0.65 + random() * 0.35);
      const clear = (s, y, radius) => {
        if (s - radius < 0 || s + radius > arcTable.totalLength || y + radius > top.heightAt(s)) return false;
        const spans = survivingIntervalsOverBand([s - radius, s + radius], openings,
          [Math.max(0, y - radius), y + radius], { clearance: profile.clearance });
        return spans.length === 1 && Math.abs(spans[0][1] - spans[0][0] - 2 * radius) < 1e-7;
      };
      // A blocked root cannot seed a floating patch above a passage.
      if (!clear(root, 0.05, profile.spread + profile.leafRadius[1])) continue;
      for (let stem = 0; stem < profile.stems; stem += 1) {
        const phase = random() * Math.PI * 2;
        const nodeCount = Math.min(profile.nodes, Math.max(2, Math.floor(height / (profile.leafRadius[1] * 1.5)) + 1));
        let previous = [root, 0.015];
        let connected = false;
        for (let node = 0; node < nodeCount; node += 1) {
          const t = node / (nodeCount - 1);
          const s = root + Math.sin(t * 4 + phase) * profile.spread * (0.25 + t * 0.75);
          const y = 0.07 + height * t;
          if (!clear(s, y, profile.leafRadius[1])) break;
          const range = [Math.min(previous[0], s) - 0.015, Math.max(previous[0], s) + 0.015];
          const clearStem = survivingIntervalsOverBand(range, openings, [previous[1], y], { clearance: profile.clearance });
          if (clearStem.length !== 1 || Math.abs(clearStem[0][1] - clearStem[0][0] - range[1] + range[0]) > 1e-7) break;
          const branch = Object.freeze({ from: Object.freeze(previous), to: Object.freeze([s, y]), rooted: !connected });
          let stemAttached = false;
          for (let leaf = 0; leaf < profile.leavesPerNode; leaf += 1) {
            const radius = profile.leafRadius[0] + random() * (profile.leafRadius[1] - profile.leafRadius[0]);
            const angle = random() * Math.PI * 2;
            const leafS = s + Math.cos(angle) * radius * 1.1;
            const leafY = Math.max(radius + 0.015, y + Math.sin(angle) * radius * 0.8);
            if (!clear(leafS, leafY, radius)) continue;
            const petioleRange = [Math.min(s, leafS) - 0.008, Math.max(s, leafS) + 0.008];
            const petioleSpans = survivingIntervalsOverBand(petioleRange, openings,
              [Math.min(y, leafY) - 0.008, Math.max(y, leafY) + 0.008], { clearance: profile.clearance });
            if (petioleSpans.length !== 1 || Math.abs(petioleSpans[0][1] - petioleSpans[0][0]
              - petioleRange[1] + petioleRange[0]) > 1e-7) continue;
            leaves.push(Object.freeze({ id: `${segment.id}:${cell}:${side}:${stem}:${node}:${leaf}`,
              s: leafS, y: leafY, side, radius, angle, outward: profile.standOff + random() * 0.012,
              shape: random() < 0.35 ? 'lobed' : 'heart', fold: radius * (0.035 + random() * 0.04),
              tilt: (random() - 0.5) * 0.18,
              petiole: Object.freeze({ from: branch.to, to: Object.freeze([leafS, leafY]) }),
              ...(!stemAttached ? { stem: branch } : {}),
              color: profile.palette[Math.floor(random() * profile.palette.length)] }));
            stemAttached = true;
            if (leaves.length >= profile.maxLeavesPerModule) return leaves;
          }
          if (stemAttached) { previous = branch.to; connected = true; }
        }
      }
    }
  }
  return leaves;
}
