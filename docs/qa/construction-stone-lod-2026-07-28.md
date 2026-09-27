# Construction soft-stone LOD QA — 2026-07-28

Deterministic soft-limestone wall (seed 3141, ~48 m path with curve + openings).

## Counts

| Metric | Near | Coarse |
| --- | ---: | ---: |
| Stones | 280 | 129 |
| Soft stones | 209 | 90 |
| Soft triangles | 21616 | 2880 |
| Stone triangles | 23604 | 3972 |
| Mortar triangles | 3360 | 1548 |

## Timing

| Band | p50 ms | p95 ms |
| --- | ---: | ---: |
| Near | 35.57 | 44.23 |
| Coarse | 10.24 | 14.52 |

Soft triangle ratio (coarse/near): **13.3%** (gate ≤ 55%)

Build p95 ratio (coarse/near): **32.8%** (gate ≤ 60%)

## Gates

- [x] coarseTrianglesAtMost55pctNearSoft
- [x] coarseBuildP95AtMost60pctNear
- [x] mortarUnchanged
- [x] coarseSoftPresent

Crossfade remains config-gated (`crossfade.enabled: false`); hysteresis and
minimum residence are active via `ConstructionLodState`.

