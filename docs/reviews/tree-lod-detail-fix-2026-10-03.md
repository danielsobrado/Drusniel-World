**Nearby tree detail fix — 2026-10-03**

Tree LOD radius limits followed the terrain editing/streaming focus, while
projected size followed the active camera. When those positions differed, nearby
trees were forced into the billboard band and farther trees retained full
geometry. The default edit camera reproduced this: its position was
`(150, 180, 150)`, its canonical chunk was `1:-2`, and terrain focus remained
`0:0`. Ten of the twelve closest trees used billboards before the fix.

Tree representation radii now follow the active camera's canonical chunk,
including floating-origin offsets and the terrain's inverted Z convention.
The shared LOD planner accepts an optional distance callback; terrain residency,
streaming priority, and other vegetation layers keep their existing policies.
The configured radii and instance allocations are unchanged. All twelve closest
trees in the same browser view now select full geometry.

The vegetation QA runner now checks full detail in the camera chunk and verifies
registration of every configured tree and bush asset. Its near/proxy galleries
cover all 29 current tree prototypes instead of stopping at the former 18.

**Verification**

- Five regression tests cover the offset editor camera, movement across a chunk
  boundary while terrain focus lags, floating-origin rebasing, instance capacity,
  and the unchanged default policy for other layers. The two reproduced detail
  failures passed after the runtime change.
- Native Windows Chromium vegetation QA passed all 107 checks with no browser
  errors, including source parts, proxy geometry, atlas parity, and camera detail.
- `npm run verify` passed production asset and generated UI validation, all
  3,022 tests with no failures or skips, and the production build. The existing
  large JavaScript chunk warning remains.

Browser evidence is in `tmp/tree-lod-before-inspection.json` and
`tmp/tree-lod-after-inspection.json`, with matching
`tmp/tree-lod-{before,after}-editor.png` captures. The vegetation report and
galleries are in `tmp/tree-lod-visual-qa/`. The full verification log is
`/tmp/drusniel-tree-lod-verify.log`.

**Movement performance comparison**

Sequential native Windows Chromium runs used the NVIDIA Lovelace hardware
WebGPU adapter, standard density, `chunk-cross`, an 8-second warmup, a 12-second
measurement, and settling, following `docs/perf-qa.md`.

| Measurement | Before | After | Confirmation |
| --- | ---: | ---: | ---: |
| Measured frames | 1,060 | 1,046 | 1,056 |
| Frame dt p95 | 18.015 ms | 19.900 ms | 23.675 ms |
| Hitches over 33.3 ms | 9 (0.85%) | 14 (1.34%) | 11 (1.04%) |
| Full geometry tree instances at capture end | 63 | 63 | 63 |
| Instances dropped by capacity | 0 | 0 | 0 |
| Terrain upload pages / bytes | 7 / 702,576 | 7 / 702,576 | 7 / 702,576 |

All runs settled and passed the collision gate with nine desired chunks ready
and collision p95 of 0.1 ms. Each met the movement matrix's 33.3 ms frame p95
and 2% hitch thresholds. The first after-run wrote a complete capture before
its runner exited with signal 143; the confirmation runner exited successfully.
Reports are `tmp/tree-lod-perf-{before,after,confirm}.json`.

These captures validate this movement route and do not demonstrate a speedup.
Stylized CPU p95 remains around 13 ms, above the guide's 4 ms target, and tree
rebuilds remain frequent. The full density, construction, and water matrix was
not rerun for this detail-selection change.
