# Independent AI test prompt — wall distance continuity

Review the sandstone distance-layout changes described in
[the review](wall-distance-continuity-review-2026-10-02.md). Read AGENTS.md,
CLAUDE.md, the required workshop geometry documents and `docs/perf-qa.md`.
Preserve existing user work. Use a temporary world and fresh browser context.

## Run

Use a fresh Vite development server on an available port; replace 5188 below
as needed. Complete builds before browser checks; run GPU browsers sequentially.

```powershell
rtk proxy npm test
rtk proxy node tools/generate-construction-stone-rounding.mjs --check
rtk proxy npm run build
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --scenes straight,curve,tower,arch-profiles,low --out tmp/layout-independent-near
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --lod coarse --scenes straight,curve,tower,arch-profiles,low --out tmp/layout-independent-coarse
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --lod coarse --view back --scenes straight,curve,tower,low --out tmp/layout-independent-back
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --style rounded-fieldstone --lod coarse --scenes straight,curve,low --out tmp/layout-independent-rounded
```

Require hardware WebGPU and zero page errors. Compare actual same-pose PNGs at
100%, and compare stone proportions and faces with `docs/reference/tiny-glade/`.

## Inspect

1. Near and coarse sandstone must keep the exact same stone count and placement
   identities. Check small stacked inserts, bed lines, caps, exposed ends, module
   seams and arch shoulders. Reject courses doubling in height or split blocks
   merging into different patterns.
2. Zoom or walk repeatedly through the near/coarse threshold in the app. The
   stone pattern should remain recognizable; report bevel, silhouette and shadow
   changes separately. The shell tier still omits masonry.
3. Try low walls at 0.69, 0.72 and 0.80 m, gentle and sharp local top edits, closed
   curves, crenellations and ruins. Opening and ruin voids must stay open, with
   no new gaps, floating caps or overlapping courses at distance.
4. Rebuild, undo/redo and save/reload. Confirm stable wear/color identity and
   semantic saved state. No generated stone mesh should become authoring data.
5. Confirm ordinary sandstone units cost 96 near / 32 coarse triangles; fitted
   polygon pieces are exceptions. Stone and mortar remain batched. Other styles
   retain their configured merge policy and rounded-fieldstone's 64-triangle
   ordinary coarse units.
6. Inspect total triangles and construction build time. Keeping all sandstone
   cells can raise total distant geometry even though each cell is cheaper.

## Performance

Compare separate frozen before/after production builds with the settled route
from `docs/perf-qa.md`, without other GPU browsers or test/build jobs running:

```powershell
rtk proxy npm run qa:perf -- --url http://127.0.0.1:5204 --headed --qa construction-ring --x 0 --z -100 --yaw 180 --warmup 40 --duration 12 --settle --constructionStyle glade-sandstone --out tmp/layout-independent-perf.json --timeoutMs 240000
```

Report frame p95, hitch rate, construction build time, queues/residency and
collision readiness. Existing hitch acceptance remains open; do not call the
change a general performance gain based on triangle reduction alone.

Return findings by severity with file/line, reproduction steps, images, exact
test counts and raw performance reports. Distinguish layout continuity from
perfect geometric or lighting continuity.
