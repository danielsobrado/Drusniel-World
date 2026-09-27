# Construction stone face relief — evidence (2026-07-28)

Headless QA for deterministic pillowed near-LOD field stones
(`soft-limestone-rubble`, seed 3141).

## Wall fixture

| Property | Value |
| --- | --- |
| Style | soft-limestone-rubble |
| Seed | 3141 |
| Path length | 26.86 m |
| Height | 3.5 m |
| Thickness | 0.8 m |
| Stones | 280 |
| Openings | door + window |
| Top | complete + ruined profile |

## Metrics

| Metric | Flat baseline | Relief enabled |
| --- | ---: | ---: |
| Near stone triangles | 7840 | 11240 |
| Mortar triangles | 3360 | 3360 |
| Coarse stone triangles (flat / soft relief) | 4648 | 4980 |
| Coarse soft-relief stones | 0 | 83 |
| Relief stones | 0 | 170 |
| Relief fallbacks | 0 | 0 |
| Relief clamped | 0 | 18 |
| Mesh count | 2 | 2 |
| Module build p50 (ms) | 10.41 | 11.88 |
| Module build p95 (ms) | 15.18 | 12.45 |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | PASS |
| Mortar triangles unchanged | 0 delta | PASS |
| Coarse keeps reduced soft relief | yes | PASS |
| Near triangle multiplier | ≤ 1.65× | 1.434× PASS |
| Module build p95 increase | ≤ 20% | -18.0% PASS |
| Relief fallback rate | < 0.5% | 0.000% PASS |
| Relief applied | > 0 stones | PASS |
| Placement count unchanged | yes | PASS |

Overall: **PASS**

## Visual checklist (manual)

- [ ] front diffuse light
- [ ] front grazing light
- [ ] 45-degree view
- [ ] near curve
- [ ] inside curve
- [ ] doorway
- [ ] ruined top
- [ ] near-to-coarse transition
- [ ] binary silhouette
- [ ] neutral material (white / roughness 1)
- [ ] moving-camera parallel pass

## Notes

- Packing, `placement.corners`, and `placement.mortarCorners` are untouched.
- Relief is YAML-driven (`stone-face-relief.yml`) and sampled from seed + stableIndex + side.
- Near LOD applies full soft relief; coarse soft-limestone keeps *reduced* soft relief (`soft-coarse`), and the far shell LOD stays the flat ribbon.
- Edge wear is a separate pass (`run-construction-stone-edge-wear-qa.mjs`), so this run isolates relief.
