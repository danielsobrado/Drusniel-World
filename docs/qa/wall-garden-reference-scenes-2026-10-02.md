# Garden reference comparison scenes

Date: 2026-10-02. Partial milestone in the
[full wall fidelity scope](../plans/tiny-glade-wall-builder/full-fidelity-improvements-2026-10-02.md).

## Implemented

The appearance harness now includes three fixed semantic compositions:

- `meadow-closeup`: crenellated sandstone, ivy, meadow blades and a low grove.
- `meadow-curve`: a short curved enclosure with grass, flowers and shaded ground.
- `arched-courtyard`: four arched openings in the tall outer wall, plus an inner
  round tower with a front gap and a worn approach.

These correspond to the supplied reference scene families. Camera pose, scale,
seed and lighting are fixed and reported. They provide repeatable comparisons;
they are not evidence of an exact image match or completed art direction.

Grass uses the production meadow blade template, pigment and material, including
its configured palette. Weather time is frozen. This bounded fixture uses one
fixed grass band rather than world streaming. Ground is gently undulating;
wall geometry and contact dressing use the same terrain-height sampler. Meadow
flowers reuse the production construction ground-detail mesher in one batch.
The backdrop uses the authored green meadow tree asset and its original materials.
It does not exercise the production forest shader, residency or scene pipeline.

Grass and flowers are excluded from semantic wall footprints and the worn
approach. The fixture index bounds those queries locally. Openings continue to
use full-path arc coordinates. Reverse inspection hides backdrop trees so they
do not obscure the outer masonry; the report records zero visible trees there.

Camera state resets before each capture. Garden close-ups therefore cannot
change the next plain scene's pose. Shared tree geometry is disposed once.

## Verification and artifacts

All 36 distinct cases render on hardware WebGPU with no page errors:

- `tmp/wall-garden-all-scenes/`: all 12 scenes, neutral and warm lighting.
- `tmp/wall-garden-final-coarse/`: the three garden scenes in the coarse tier.
- `tmp/wall-garden-final-back/`: the three garden scenes viewed from behind.

The additional `tmp/wall-garden-final-near/` run repeats the garden scenes and
then captures the plain straight wall. All eight repeated screenshots and
reported metadata match the full-run captures exactly. Garden environment,
camera pose, stone count and opening anchors are identical across detail tiers.

| Scene | Stones | Near wall triangles | Coarse wall triangles |
| --- | ---: | ---: | ---: |
| Meadow close-up | 322 | 37,942 | 17,334 |
| Meadow curve | 318 | 36,954 | 16,602 |
| Arched courtyard | 1,783 | 199,628 | 102,988 |

Wall triangle totals include ivy and wall contact dressing. The separate fixture
meadow contains about 122,600-128,200 stems and 224-265 flower accents, depending
on the wall footprints. These are fixture counts, not production world budgets.

Inspected actual near, coarse, neutral, warm and reverse-view PNGs. The inner
tower gap and all outer arches are visible. The coarse tier retains the layout
and reduces wall triangles. The remaining long seams and regular crowns are
still apparent. Grass looks denser and more upright than in the references;
stone color, selective stains/chips, foliage arrangement and scene atmosphere
need further refinement. Optional presentation depth of field remains pending.

Reusable verification:

```powershell
rtk proxy node scripts/run-construction-appearance-qa.mjs --url http://127.0.0.1:5189 --headed --out tmp/wall-garden-all-scenes
rtk proxy node scripts/run-construction-appearance-qa.mjs --url http://127.0.0.1:5189 --headed --scenes meadow-closeup,meadow-curve,arched-courtyard,straight --out tmp/wall-garden-final-near
rtk proxy node scripts/run-construction-appearance-qa.mjs --url http://127.0.0.1:5189 --headed --lod coarse --scenes meadow-closeup,meadow-curve,arched-courtyard --out tmp/wall-garden-final-coarse
rtk proxy node scripts/run-construction-appearance-qa.mjs --url http://127.0.0.1:5189 --headed --lod coarse --view back --scenes meadow-closeup,meadow-curve,arched-courtyard --out tmp/wall-garden-final-back
rtk proxy node scripts/verify-construction-garden-captures.mjs
```

Use the running development server's actual URL. Run captures sequentially.
The verifier passes for the recorded artifacts. Syntax and whitespace checks
pass. This pass changes QA fixtures and verification only; the preceding
production milestone's 2,980-test and build results are recorded in
[Wall bond and close-up review](wall-bond-detail-review-2026-10-02.md).

## Remaining full-scope work

Interlocking masonry, selective surface wear/stains, crown/end art, shared
junctions, adaptive opening shoulders/piers, ivy joint/corner routes, direct
editing gestures, contextual presets, sound listening evidence and world
rendering validation remain required. The last production corridor's 4.02%
hitch rate still exceeds the 2% gate. These fixture captures do not measure
movement or pointer-drag performance.
