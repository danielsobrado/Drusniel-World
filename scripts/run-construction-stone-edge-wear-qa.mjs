#!/usr/bin/env node
/**
 * Headless evidence for Second pass part 2 — worn arrises / edge wear.
 *
 * Gates two costs: the deterministic near triangle multiplier and the module
 * build time over the relief-only Part 1. The build microbench was previously
 * a p95 over 11 independent samples, which on a shared host swung ~40 points
 * between identical runs; it is now a median over 15 interleaved pairs, with a
 * deterministic triangle gate alongside it. See the gate comments.
 *
 * Usage: node scripts/run-construction-stone-edge-wear-qa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const JSON_PATH = join(OUT_DIR, 'construction-stone-edge-wear-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-stone-edge-wear-2026-07-28.md');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

// Wall-clock module-build microbench: 15 paired iterations. See
// timedPairedBuilds for why the gated ratio is a median over pairs rather than
// a p95 over independent batches.
const BUILD_RUNS = 15;

function summariseBuildTimes(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  // Drop the single worst sample — module build microbench is noisy on a cold
  // heap. This summary is reported for humans; the *gated* wall-clock figure is
  // the paired median in timedPairedBuilds, not this p95.
  const trimmed = sorted.length > 4 ? sorted.slice(0, -1) : sorted;
  return {
    p50: percentile(trimmed, 0.5),
    p95: percentile(trimmed, 0.95),
    samples: sorted,
  };
}

function createQaWall() {
  const soft = constructionStyle('soft-limestone-rubble');
  const path = createCubicBezierPathFromStroke([
    [0, 0], [6, 0], [12, 0], [14, 1], [18, 4], [21, 7], [24, 8],
  ], { simplifyTolerance: 0.02 });
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-edge-wear-wall',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path,
    features: [
      {
        id: 'door-1',
        kind: 'door',
        segmentId: path.segments[0].id,
        arcFraction: 0.55,
        width: 2.2,
        height: 2.6,
        sill: 0,
        profile: 'round',
        dressed: true,
        group: null,
      },
      {
        id: 'window-1',
        kind: 'window',
        segmentId: path.segments[Math.min(2, path.segments.length - 1)].id,
        arcFraction: 0.4,
        width: 1.2,
        height: 1.4,
        sill: 1.1,
        profile: 'round',
        dressed: true,
        group: null,
      },
    ],
    top: {
      style: 'ruined',
      base: 3.5,
      profile: [
        {
          segmentId: path.segments[Math.floor(path.segments.length / 2)].id,
          arcFraction: 0.2,
          height: 3.5,
        },
        {
          segmentId: path.segments[Math.floor(path.segments.length / 2)].id,
          arcFraction: 0.8,
          height: 2.1,
        },
      ],
    },
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: soft });
  const openings = record.path.features.map((feature, index) => ({
    ...feature,
    s: Math.min(
      arcTable.totalLength - 1,
      Math.max(0.01, arcTable.totalLength * (index === 0 ? 0.28 : 0.62)),
    ),
  }));
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: soft,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    openings,
  });
  return { record, arcTable, placements: packed.stones };
}

function buildOnce(record, arcTable, placements, options = {}) {
  const materials = createConstructionMaterials(record);
  const started = performance.now();
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand: 'near',
    ...options,
  });
  const buildMs = performance.now() - started;
  for (const mesh of built.meshes) mesh.geometry.dispose();
  disposeConstructionMaterials();
  return { stats: built.stats, meshCount: built.meshes.length, buildMs };
}

function timedBuilds(record, arcTable, placements, options, runs = BUILD_RUNS) {
  const samples = [];
  let last = null;
  for (let index = 0; index < runs; index += 1) {
    last = buildOnce(record, arcTable, placements, options);
    samples.push(last.buildMs);
  }
  return {
    ...last,
    buildMs: summariseBuildTimes(samples),
  };
}

/**
 * Interleaved relief-only vs edge-wear microbench.
 *
 * The module build is wall-clock and the host is routinely shared — the
 * phase-10 report records runs that "shared the machine with another agent's
 * browser workload". On this exact code the p95-of-11 ratio between these two
 * configs was measured swinging from 0.98 to 1.38 between runs (a 40-point
 * spread with no code change), so a p95-vs-p95 gate can neither pass nor fail
 * reliably. Pairing the two builds inside one loop makes each ratio share its
 * host conditions, and the MEDIAN of those paired ratios rejects the cold-heap
 * outlier. The deterministic driver — worn vs relief-only stone triangles — is
 * gated separately (buildOverPart1TrianglesOk).
 */
function timedPairedBuilds(record, arcTable, placements, runs = BUILD_RUNS) {
  const reliefSamples = [];
  const wornSamples = [];
  const ratios = [];
  let lastRelief = null;
  let lastWorn = null;
  for (let index = 0; index < runs; index += 1) {
    // Alternate which config goes first so neither systematically pays the
    // cold-heap cost of an iteration.
    if (index % 2 === 1) {
      lastWorn = buildOnce(record, arcTable, placements, {});
      lastRelief = buildOnce(record, arcTable, placements, { disableEdgeWear: true });
    } else {
      lastRelief = buildOnce(record, arcTable, placements, { disableEdgeWear: true });
      lastWorn = buildOnce(record, arcTable, placements, {});
    }
    reliefSamples.push(lastRelief.buildMs);
    wornSamples.push(lastWorn.buildMs);
    ratios.push(lastWorn.buildMs / lastRelief.buildMs);
  }
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  return {
    relief: lastRelief,
    worn: lastWorn,
    reliefMs: summariseBuildTimes(reliefSamples),
    wornMs: summariseBuildTimes(wornSamples),
    // Relative build increase over Part 1 = median paired ratio − 1.
    buildOverPart1: percentile(sortedRatios, 0.5) - 1,
    pairedRatios: sortedRatios,
  };
}

const { record, arcTable, placements } = createQaWall();
const coarse = coarsePlacements(placements, { styleKey: record.style.key });

const baseline = timedBuilds(record, arcTable, placements, {
  disableRelief: true,
  disableEdgeWear: true,
});
// relief-only and worn are measured interleaved so their build ratio is not
// corrupted by drift in the shared host.
const paired = timedPairedBuilds(record, arcTable, placements);
const reliefOnly = {
  stats: paired.relief.stats,
  meshCount: paired.relief.meshCount,
  buildMs: paired.reliefMs,
};
const worn = {
  stats: paired.worn.stats,
  meshCount: paired.worn.meshCount,
  buildMs: paired.wornMs,
};
const coarseWorn = timedBuilds(record, arcTable, coarse, { lodBand: 'coarse' });

const nearMultiplier = baseline.stats.stoneTriangles > 0
  ? worn.stats.stoneTriangles / baseline.stats.stoneTriangles
  : 0;
// Deterministic companion to the wall-clock gate: the module build writes into
// typed arrays and is triangle-bound, so this ratio is the measurement-free
// cost signal for edge wear over the relief-only Part 1.
const overPart1Triangles = reliefOnly.stats.stoneTriangles > 0
  ? worn.stats.stoneTriangles / reliefOnly.stats.stoneTriangles
  : 0;
// Robust wall-clock figure: median paired ratio − 1 (relative increase).
const overPart1 = paired.buildOverPart1;
const fallbackRate = worn.stats.edgeWearEligible > 0
  ? worn.stats.edgeWearFallbacks / worn.stats.edgeWearEligible
  : 0;
const clampedRate = worn.stats.edgeWearEligible > 0
  ? worn.stats.edgeWearClamped / worn.stats.edgeWearEligible
  : 0;

const gates = {
  noExtraMeshes: worn.meshCount === baseline.meshCount,
  mortarUnchanged: worn.stats.mortarTriangles === baseline.stats.mortarTriangles,
  // Part 3: coarse soft-limestone keeps reduced soft wear instead of going flat.
  coarseSoftWear: (coarseWorn.stats.coarseSoftStones ?? 0) > 0
    && coarseWorn.stats.edgeWearStones > 0,
  // Budget recalibrated 2026-09-27 against the post-942e8d55 soft topology.
  // The original 2.0x was set when a worn near soft stone carried four-corner
  // bevel loops (64 tris). 942e8d55 "Sculpt procedural wall stone edges" made
  // ConstructionStoneTopologyResolver insert an inward midpoint on every arris
  // whenever the sampled edgeMidpointScale varies (it always does: 1 ±
  // edgeVariation), doubling the bevel loop to eight and taking a worn near
  // stone to 104 tris. That is the intended stone-character look, pinned by
  // tests/ConstructionStoneTopologyResolver.test.js ("adds inward-only hand-cut
  // edge midpoints", faceLoop.length === 8). Deterministic measured value:
  // flat 7840 (unchanged, the pre-sculpting baseline), relief only 11240,
  // worn 20600 → 20600 / 7840 = 2.6276x. Human ratification wanted.
  nearMultiplierOk: nearMultiplier <= 2.8,
  // Robust wall-clock gate: median of the interleaved worn/relief build ratios
  // (see timedPairedBuilds). On this code the median paired ratio is ~2.0x, i.e.
  // ~100% over Part 1 — proportional to the deterministic 1.83x triangle
  // increase, so the extra time is the intended extra geometry, not a hidden
  // CPU regression. Budget 1.4 (150%) leaves room for host jitter while still
  // catching a blown-up builder. Absolutely not the old p95-of-11 statistic,
  // which swung 40 points run-to-run on identical code.
  buildOverPart1Ok: overPart1 <= 1.4,
  // Deterministic cost guard: edge wear over the relief-only Part 1
  // (20600 / 11240 = 1.833x). Reproducible bit-for-bit, so it is the gate a
  // human can trust; the wall-clock number above is advisory only.
  buildOverPart1TrianglesOk: overPart1Triangles <= 2.0,
  fallbackOk: fallbackRate < 0.005,
  clampedOk: clampedRate < 0.05,
  wearApplied: worn.stats.edgeWearStones > 0,
};

const allPass = Object.values(gates).every(Boolean);

const payload = {
  generatedAt: new Date().toISOString(),
  wall: {
    style: record.style.key,
    seed: record.seed,
    lengthM: arcTable.totalLength,
    stoneCount: placements.length,
  },
  baseline: {
    stoneTriangles: baseline.stats.stoneTriangles,
    mortarTriangles: baseline.stats.mortarTriangles,
    buildMs: baseline.buildMs,
  },
  reliefOnly: {
    stoneTriangles: reliefOnly.stats.stoneTriangles,
    buildMs: reliefOnly.buildMs,
  },
  worn: {
    stoneTriangles: worn.stats.stoneTriangles,
    edgeWearStones: worn.stats.edgeWearStones,
    edgeWearFallbacks: worn.stats.edgeWearFallbacks,
    edgeWearClamped: worn.stats.edgeWearClamped,
    flattenedCorners: worn.stats.flattenedCorners,
    buildMs: worn.buildMs,
  },
  ratios: {
    nearTriangleMultiplier: nearMultiplier,
    wornOverReliefTriangles: overPart1Triangles,
    buildPairedMedianIncreaseOverPart1: overPart1,
    buildPairedRatios: paired.pairedRatios,
    fallbackRate,
    clampedRate,
  },
  gates,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`);

const report = `# Construction stone edge wear — evidence (2026-07-28)

Headless QA for worn arrises on \`soft-limestone-rubble\` (seed 3141).

## Metrics

| Metric | Flat | Relief only | Relief + edge wear |
| --- | ---: | ---: | ---: |
| Near stone triangles | ${baseline.stats.stoneTriangles} | ${reliefOnly.stats.stoneTriangles} | ${worn.stats.stoneTriangles} |
| Mortar triangles | ${baseline.stats.mortarTriangles} | ${reliefOnly.stats.mortarTriangles} | ${worn.stats.mortarTriangles} |
| Edge-wear stones | 0 | 0 | ${worn.stats.edgeWearStones} |
| Edge-wear fallbacks | 0 | 0 | ${worn.stats.edgeWearFallbacks} |
| Edge-wear clamped | 0 | 0 | ${worn.stats.edgeWearClamped} |
| Flattened corners | 0 | 0 | ${worn.stats.flattenedCorners} |
| Build p50 (ms) | ${baseline.buildMs.p50.toFixed(2)} | ${reliefOnly.buildMs.p50.toFixed(2)} | ${worn.buildMs.p50.toFixed(2)} |
| Build p95 (ms) | ${baseline.buildMs.p95.toFixed(2)} | ${reliefOnly.buildMs.p95.toFixed(2)} | ${worn.buildMs.p95.toFixed(2)} |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | ${gates.noExtraMeshes ? 'PASS' : 'FAIL'} |
| Mortar unchanged | yes | ${gates.mortarUnchanged ? 'PASS' : 'FAIL'} |
| Coarse soft wear | yes | ${gates.coarseSoftWear ? 'PASS' : 'FAIL'} |
| Near triangle multiplier | ≤ 2.8× | ${nearMultiplier.toFixed(3)}× ${gates.nearMultiplierOk ? 'PASS' : 'FAIL'} |
| Build over Part 1 (paired median) | ≤ 150% | ${(overPart1 * 100).toFixed(1)}% ${gates.buildOverPart1Ok ? 'PASS' : 'FAIL'} |
| Worn/relief stone triangles | ≤ 2.0× | ${overPart1Triangles.toFixed(3)}× ${gates.buildOverPart1TrianglesOk ? 'PASS' : 'FAIL'} |
| Fallback rate | < 0.5% | ${(fallbackRate * 100).toFixed(3)}% ${gates.fallbackOk ? 'PASS' : 'FAIL'} |
| Clamped rate | < 5% | ${(clampedRate * 100).toFixed(3)}% ${gates.clampedOk ? 'PASS' : 'FAIL'} |
| Wear applied | > 0 | ${gates.wearApplied ? 'PASS' : 'FAIL'} |

Overall: **${allPass ? 'PASS' : 'FAIL'}**

## Visual checklist (manual)

- [ ] Neutral material (white / roughness 1 / no normal)
- [ ] Top-left / top-right / bottom-left lighting
- [ ] Front and rear grazing light
- [ ] Door / window / quoin / coping
- [ ] Curve + module seam
- [ ] Moving-camera pass
- [ ] Silhouette mask vs uniform bevel
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, report);
console.log(allPass ? 'PASS' : 'FAIL');
console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${REPORT_PATH}`);
process.exit(allPass ? 0 : 1);
