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
from Git HEAD; the fixed run served this workspace. Both used the same assets
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

The wider movement/water matrix and its remaining frame-time limitations are
recorded below after completion.
