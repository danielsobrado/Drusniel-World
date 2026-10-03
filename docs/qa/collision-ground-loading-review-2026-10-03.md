# Collision ground loading review — 2026-10-03

The player HUD's “Preparing the ground… 4 chunks left” reports missing
collision owner chunks touched by the movement capsule. At the world origin,
the capsule overlaps four chunks. The count was accurate, but preparation could
wait behind the complete rock render window, or stop indefinitely while land
streaming was suspended.

## Cause and fix

Rock preparation's one-slice allowance reset inside `StylizedRockView.update`,
after player collision had already run. Collision therefore inherited the
previous frame's consumed allowance. Underwater land suspension bypassed that
reset entirely. Frame entry now resets the allowance before the QA harness and
player update; repeated layer entry with the same timestamp shares that budget.
The time budget starts with the first cold rock build.

Rock preparation also stored only one incremental builder. Interleaved requests
for different collision, render, and tree-blocker chunks discarded unfinished
work. Builders are now retained by chunk, validated against the current manifest
signature, removed on completion, and pruned with the manifest residency window.
One bounded preparation slice per frame is still enforced.

## Verification

Both defects were reproduced in failing tests before the fixes. The new
`tests/collisionRockFrameProgress.test.js` drives the real collision residency
and rock halo preparation, exercises the actual suspended-land update, and
interleaves partial builders. Existing deferred collision and manifest budget
tests also pass. The complete suite passed **2,994 tests**; `npm run build` passed.

Hardware comparison: headed Playwright Chromium, NVIDIA Lovelace, exclusively
WebGPU, 1280 × 720, `chunk-cross`, `high-grass`, 8 s warmup, 12 s movement,
settle enabled. The reference served the original three changed source files
from Git HEAD at baseline-server startup; the fixed run served this workspace.
Both used the same assets
and remaining source files. Exploratory captures from port 5173 served another
checkout and are excluded from this comparison.

| Observation | Original | Fixed |
| --- | ---: | ---: |
| Readiness miss counter, including warmup | 165 | 60 |
| First ready sample after initial player update | 5.315 s | 3.875 s |
| Final required collision chunks ready | 9/9 | 9/9 |
| Final queued collision builds | 0 | 0 |
| Failed collision chunks | 0 | 0 |
| Frame p95 | 27.46 ms | 22.62 ms |
| Hitch rate over 33.3 ms | 2.57% | 1.62% |

Readiness was sampled every 500 ms; first-ready times include cold rendering
stalls and are approximate. These are single-run observations, not a general
FPS improvement claim. Raw captures are `tmp/collision-stall-local-before.json`
and `tmp/collision-stall-local-after.json` (each contains `probe` and `report`).

## Wider movement and water checks

Ran `npm run qa:perf:matrix -- --headed --url http://127.0.0.1:5175
--warmup 8 --duration 12`. All five movement cases finished with 9/9 desired
collision chunks ready, zero queued builds and zero failed chunks. Collision
p95 was 0.1 ms in every case.

| Case | Frame p95 | Hitch rate | Collision gate |
| --- | ---: | ---: | --- |
| Standard | 26.805 ms | 1.64% | pass |
| Dense forest | 34.1 ms | 7.10% | pass |
| High grass | 26.88 ms | 2.40% | pass |
| Dense mixed | 23.42 ms | 1.19% | pass |
| Construction ring | 31.075 ms | 2.85% | pass |

The full matrix remains **failed** against the 33.3 ms p95 / 2% hitch targets.
A repeated fixed dense-forest run passed both frame targets (24.8 ms p95,
1.40% hitches); the original-code dense-forest run measured 16.925 ms p95 and
1.15% hitches. Results vary, and the fixed runs complete more rock/tree manifests
and publish different resident workloads during warmup. These observations do
not establish an equivalent-workload rendering regression or improvement.

The water route passed entry, swimming, submersion, surfacing, dry exit, body
identity, origin stability, and active caustics. Collision finished ready; frame
p95 was 14.9 ms and hitch rate 0.79%. The caustic CPU gate failed at a maximum
1,577.6 ms against its 4 ms limit. The original-code water run failed the same
gate at 1,428.6 ms (15.3 ms frame p95, 0.73% hitches), confirming that this
rendering stall also occurs without the collision scheduling changes. No GPU
validation errors occurred. The complete performance gate is not certified.

Raw evidence: `tmp/perf-matrix-latest.json`, `tmp/perf-matrix/*.json`,
`tmp/collision-stall-dense-before.json`,
`tmp/collision-stall-dense-after-repeat.json`, and
`tmp/collision-stall-water-before.json`, and
`tmp/collision-stall-water-after.json`.
