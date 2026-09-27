#!/usr/bin/env node
/**
 * Headless evidence for the rounded-fieldstone wall look.
 *
 * Plans the QA wall (curve, door, window) through the real planner, builds
 * every module in the near and coarse bands for the previous default
 * (`coursed-rubble`, irregular top) and the new one (`rounded-fieldstone`, flat
 * capped top), and records triangle, build-time, face-coverage and robustness
 * gates. A sloped ground variant checks draping and footing burial. Visual
 * judgement remains a manual checklist: screenshots do not work in the in-app
 * browser pane.
 *
 * Usage: npm run qa:construction:rounded
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { coarsePlacementsForModule } from '../src/editor/construction/render/ConstructionLod.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { uncoveredFaceShare, wallOpenings } from './lib/constructionFaceCoverage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const REPORT_DATE = '2026-09-26';
const JSON_PATH = join(OUT_DIR, 'construction-rounded-fieldstone-qa.json');
const REPORT_PATH = join(ROOT, `docs/qa/construction-rounded-fieldstone-${REPORT_DATE}.md`);

const WARMUP_RUNS = 3;
const TIMED_RUNS = 9;
const SLOPED_GROUND = (x, z) => 0.12 * x + 0.05 * z;
const CROSS_SLOPED_GROUND = (x, z) => 0.4 * z;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function qaRecord(styleKey, topStyle) {
  const path = createCubicBezierPathFromStroke([
    [0, 0], [6, 0], [12, 0], [14, 1], [18, 4], [21, 7], [24, 8],
  ], { simplifyTolerance: 0.02 });
  return normalizeConstructionRecord({
    version: 1,
    id: `qa-${styleKey}`,
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: styleKey, version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: topStyle },
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
  });
}

function vertexBuffers(geometry) {
  return Object.keys(geometry.attributes).length;
}

function finiteGeometry(meshes) {
  for (const mesh of meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      for (const value of attribute.array) if (!Number.isFinite(value)) return false;
    }
  }
  return true;
}

/** Build every module once per run; returns per-module times and totals. */
function measure(record, band, { groundHeightAt = () => 0, runs = TIMED_RUNS } = {}) {
  const plan = planConstruction(record);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const materials = createConstructionMaterials(record);
  const moduleTimes = [];
  const totals = {
    modules: 0,
    stones: 0,
    stoneTriangles: 0,
    mortarTriangles: 0,
    roundedFallbacks: 0,
    footingStones: 0,
    copingStones: 0,
    maxMeshesPerModule: 0,
    maxVertexBuffers: 0,
    finite: true,
    minStoneY: Infinity,
    maxStoneY: -Infinity,
  };
  for (let run = 0; run < WARMUP_RUNS + runs; run += 1) {
    const timed = run >= WARMUP_RUNS;
    const last = run === WARMUP_RUNS + runs - 1;
    for (const module of plan.modules) {
      const source = module.placements ?? [];
      const placements = band === 'coarse'
        ? coarsePlacementsForModule({ record, module, totalLength: plan.totalLength })
        : source;
      const started = performance.now();
      const built = buildModuleMasonry(placements, {
        record,
        materials,
        arcTable,
        moduleOrigin: { x: 0, z: 0 },
        groundHeightAt,
        lodBand: band,
      });
      const elapsed = performance.now() - started;
      if (timed) moduleTimes.push(elapsed);
      if (last) {
        totals.modules += 1;
        totals.stones += built.stats.stones ?? 0;
        totals.stoneTriangles += built.stats.stoneTriangles ?? 0;
        totals.mortarTriangles += built.stats.mortarTriangles ?? 0;
        totals.roundedFallbacks += built.stats.roundedFallbacks ?? 0;
        totals.footingStones += built.stats.footingStones ?? 0;
        totals.copingStones += placements.filter((placement) => placement.category === 'coping').length;
        totals.maxMeshesPerModule = Math.max(totals.maxMeshesPerModule, built.meshes.length);
        totals.finite &&= finiteGeometry(built.meshes);
        const stone = built.meshes.at(-1);
        if (stone) {
          totals.maxVertexBuffers = Math.max(totals.maxVertexBuffers, vertexBuffers(stone.geometry));
          stone.geometry.computeBoundingBox();
          totals.minStoneY = Math.min(totals.minStoneY, stone.geometry.boundingBox.min.y);
          totals.maxStoneY = Math.max(totals.maxStoneY, stone.geometry.boundingBox.max.y);
        }
      }
      for (const mesh of built.meshes) mesh.geometry.dispose();
    }
  }
  disposeConstructionMaterials();
  moduleTimes.sort((a, b) => a - b);
  return {
    ...totals,
    trianglesPerStone: totals.stones > 0 ? totals.stoneTriangles / totals.stones : 0,
    fallbackRate: totals.stones > 0 ? totals.roundedFallbacks / totals.stones : 0,
    moduleBuildMs: {
      p50: percentile(moduleTimes, 0.5),
      p95: percentile(moduleTimes, 0.95),
      max: moduleTimes.at(-1) ?? 0,
    },
  };
}

/**
 * Share of the wall body, outside the door and window, that no stone covers in
 * each band; the difference is what the coarse reduction loses.
 */
function faceCoverage(record) {
  const plan = planConstruction(record);
  const face = {
    length: plan.totalLength,
    bodyTop: record.top.base - constructionStyle(record.style.key).coping.height,
    openings: wallOpenings(record),
  };
  const near = plan.modules.flatMap((module) => module.placements ?? []);
  const coarse = plan.modules.flatMap((module) => (
    coarsePlacementsForModule({ record, module, totalLength: plan.totalLength })
  ));
  const nearShare = uncoveredFaceShare(near, face);
  const coarseShare = uncoveredFaceShare(coarse, face);
  return { near: nearShare, coarse: coarseShare, coarseExtra: coarseShare - nearShare };
}

const previous = qaRecord('coursed-rubble', 'irregular');
const rounded = qaRecord('rounded-fieldstone', 'flat');

const results = {
  previous: { near: measure(previous, 'near'), coarse: measure(previous, 'coarse') },
  rounded: { near: measure(rounded, 'near'), coarse: measure(rounded, 'coarse') },
  crenellated: { near: measure(qaRecord('rounded-fieldstone', 'crenellated'), 'near', { runs: 1 }) },
  ruined: { near: measure(qaRecord('rounded-fieldstone', 'ruined'), 'near', { runs: 1 }) },
  sloped: { near: measure(rounded, 'near', { groundHeightAt: SLOPED_GROUND, runs: 1 }) },
  crossSloped: { near: measure(rounded, 'near', { groundHeightAt: CROSS_SLOPED_GROUND, runs: 1 }) },
};
const coverage = {
  rounded: faceCoverage(rounded),
  coursedFlat: faceCoverage(qaRecord('coursed-rubble', 'flat')),
};

const near = results.rounded.near;
const coarse = results.rounded.coarse;
const gates = {
  nearTrianglesPerStone: near.trianglesPerStone <= 280,
  coarseTrianglesPerStone: coarse.trianglesPerStone <= 72,
  nearBuildP95VsPrevious: near.moduleBuildMs.p95 <= results.previous.near.moduleBuildMs.p95,
  meshesPerModule: near.maxMeshesPerModule === 2 && coarse.maxMeshesPerModule === 2,
  vertexBuffers: near.maxVertexBuffers <= 4 && coarse.maxVertexBuffers <= 4,
  fallbackRate: near.fallbackRate < 0.005 && coarse.fallbackRate < 0.005,
  finiteGeometry: Object.values(results).every((bands) => Object.values(bands).every((band) => band.finite)),
  footingPresent: near.footingStones > 0,
  capstonesPresent: near.copingStones > 0,
  variantsBuild: results.crenellated.near.stones > 0 && results.ruined.near.stones > 0,
  footingMeetsCrossSlope: results.crossSloped.near.minStoneY < -0.4 * 0.45,
  coarseCoverage: Object.values(coverage).every((entry) => entry.coarseExtra < 0.003),
};
const allPass = Object.values(gates).every(Boolean);

const payload = { generatedAt: new Date().toISOString(), results, coverage, gates };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`);

const row = (label, a, b, digits = 2) => (
  `| ${label} | ${typeof a === 'number' ? a.toFixed(digits) : a} | ${typeof b === 'number' ? b.toFixed(digits) : b} |`
);
const pass = (value) => (value ? 'PASS' : 'FAIL');
const percent = (value) => `${(value * 100).toFixed(2)}%`;
const percentPoints = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}`;

const report = `# Construction rounded fieldstone — evidence (${REPORT_DATE})

Headless QA for the \`rounded-fieldstone\` default wall style: pillow stones
from \`ConstructionPillowStoneMesher\`, a buried footing course, a capstone
course and baked crevice occlusion. Generated by
\`scripts/run-construction-rounded-stone-qa.mjs\`; the fixture is the
relief QA wall (seed 3141, ${results.rounded.near.modules} planner modules, door + window),
built module by module exactly as the view builds it.

"Previous" is the old default for new walls, \`coursed-rubble\` with an irregular top.

## Near band

| Metric | Previous | Rounded |
| --- | ---: | ---: |
${row('Stones', results.previous.near.stones, near.stones, 0)}
${row('Stone triangles', results.previous.near.stoneTriangles, near.stoneTriangles, 0)}
${row('Triangles per stone', results.previous.near.trianglesPerStone, near.trianglesPerStone, 1)}
${row('Mortar triangles', results.previous.near.mortarTriangles, near.mortarTriangles, 0)}
${row('Module build p50 (ms)', results.previous.near.moduleBuildMs.p50, near.moduleBuildMs.p50)}
${row('Module build p95 (ms)', results.previous.near.moduleBuildMs.p95, near.moduleBuildMs.p95)}
${row('Module build max (ms)', results.previous.near.moduleBuildMs.max, near.moduleBuildMs.max)}
${row('Footing stones', 0, near.footingStones, 0)}
${row('Capstones', results.previous.near.copingStones, near.copingStones, 0)}

## Coarse band

| Metric | Previous | Rounded |
| --- | ---: | ---: |
${row('Stone triangles', results.previous.coarse.stoneTriangles, coarse.stoneTriangles, 0)}
${row('Triangles per stone', results.previous.coarse.trianglesPerStone, coarse.trianglesPerStone, 1)}
${row('Module build p50 (ms)', results.previous.coarse.moduleBuildMs.p50, coarse.moduleBuildMs.p50)}
${row('Module build p95 (ms)', results.previous.coarse.moduleBuildMs.p95, coarse.moduleBuildMs.p95)}

## Face coverage

Share of the wall body (below the capstones, outside the door and window)
that no stone covers, scanned on a 5 cm × 1 cm grid over the whole wall with
every module's stones pooled. The coarse column should match near.

| Wall | Near | Coarse |
| --- | ---: | ---: |
| Rounded fieldstone, flat top | ${percent(coverage.rounded.near)} | ${percent(coverage.rounded.coarse)} |
| Coursed rubble, flat top | ${percent(coverage.coursedFlat.near)} | ${percent(coverage.coursedFlat.coarse)} |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Near triangles per stone | ≤ 280 | ${near.trianglesPerStone.toFixed(1)} ${pass(gates.nearTrianglesPerStone)} |
| Coarse triangles per stone | ≤ 72 | ${coarse.trianglesPerStone.toFixed(1)} ${pass(gates.coarseTrianglesPerStone)} |
| Near module build p95 | ≤ previous (${results.previous.near.moduleBuildMs.p95.toFixed(2)} ms) | ${near.moduleBuildMs.p95.toFixed(2)} ms ${pass(gates.nearBuildP95VsPrevious)} |
| Meshes per module | 2 | ${pass(gates.meshesPerModule)} |
| Vertex buffers | ≤ 4 | ${near.maxVertexBuffers} ${pass(gates.vertexBuffers)} |
| Fallback rate | < 0.5% | ${(near.fallbackRate * 100).toFixed(3)}% ${pass(gates.fallbackRate)} |
| Finite geometry, all variants | yes | ${pass(gates.finiteGeometry)} |
| Footing course present | yes | ${pass(gates.footingPresent)} |
| Capstone course present | yes | ${pass(gates.capstonesPresent)} |
| Crenellated and ruined tops build | yes | ${pass(gates.variantsBuild)} |
| Footing reaches the lower ground on a 0.4 cross slope | below ${(-0.4 * 0.45).toFixed(2)} m | ${results.crossSloped.near.minStoneY.toFixed(2)} m ${pass(gates.footingMeetsCrossSlope)} |
| Coarse band uncovers no more face than near (rounded; coursed, flat top) | < 0.30 points | ${percentPoints(coverage.rounded.coarseExtra)}; ${percentPoints(coverage.coursedFlat.coarseExtra)} ${pass(gates.coarseCoverage)} |

Overall: **${allPass ? 'PASS' : 'FAIL'}**

Sloped-ground variant (0.12 along, 0.05 across): stones span
${results.sloped.near.minStoneY.toFixed(2)} m to ${results.sloped.near.maxStoneY.toFixed(2)} m, draped per vertex along the wall.

## Visual checklist (manual, in the running app)

- [ ] Straight 24 m wall at 2 / 5 / 8 / 12 / 20 m: chunky rounded stones, dark crevices, no black outlines
- [ ] Beside a \`coursed-rubble\` wall (radial palette → masonry): warmer, lighter, rounder
- [ ] S-curve: no module seams, stones stay rounded on the tight side
- [ ] Along-wall slope: courses follow the ground without stepping at head joints
- [ ] Cross slope: footing stones sit in the ground on the downhill face
- [ ] Door and window: dressings crisper than field stones, arch reads
- [ ] Flat top: capstones read as one neat course; raised and lowered sections follow
- [ ] Crenellated and ruined tops
- [ ] Near → coarse → shell → coarse → near: silhouette holds, shell colour matches

Tune in \`src/editor/construction/config/stone-rounding.yml\` (edge and corner
radius, bulge, crevice strength) and the \`warm-fieldstone\` palette.
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, report);
console.log(allPass ? 'PASS' : 'FAIL');
console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${REPORT_PATH}`);
process.exit(allPass ? 0 : 1);
