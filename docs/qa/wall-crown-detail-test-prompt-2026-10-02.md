# Independent AI test prompt — stone crowns and close-up fidelity

Review and test the October 2 wall changes against the Tiny Glade reference
screenshots in `docs/reference/tiny-glade/`. Read AGENTS.md, CLAUDE.md, the
required workshop geometry documents, `docs/perf-qa.md` and the
[implementation review](wall-crown-detail-review-2026-10-02.md). Preserve user
work. Use a temporary world and a fresh browser context.

## Automated checks

Start a fresh Vite development server on an available port; replace 5188 below
as needed. Complete builds before browser checks and run GPU browsers sequentially.

```powershell
rtk proxy npm test
rtk proxy node tools/generate-construction-joint-profiles.mjs --check
rtk proxy npm run build
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --closeup --zoom 3 --scenes low,straight,curve,arch-profiles --out tmp/crown-independent-near
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --closeup --zoom 5 --scenes straight,arch-profiles --out tmp/crown-independent-detail
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --view back --scenes low,curve,tower --out tmp/crown-independent-back
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --lod coarse --scenes low,straight,curve,tower --out tmp/crown-independent-coarse
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5188 --headed --style rounded-fieldstone --scenes low,straight,curve --out tmp/crown-independent-rounded
rtk proxy npm run qa:construction:editing -- --url http://127.0.0.1:5188 --headed --out tmp/crown-independent-editing
```

Require WebGPU and zero page errors. Inspect the actual PNGs at 100%, including
both wall faces, top thickness, open ends, arch shoulders and tight curves.

## Checks in the editor

1. Create sandstone walls at 0.50, 0.69, 0.72, 0.80, 0.96 and 1.60 m. Check the
   full crown length, especially module seams and wall ends. Reject floating
   coping, bare bands of backing, missing split pieces and thin strips.
2. Check understated cap-height variation. Every cap should keep its bed
   seated; crown wear should stay below the authored top and not move body
   stones. Repeat regeneration and save/reload to confirm deterministic wear.
3. Raise and lower a local crown through course boundaries. Try sharp and gentle
   ramps, then undo and redo. Look for missing wedges, thin partial courses and
   changes outside the edit region. Arbitrary local profiles need further
   coverage beyond the flat low-wall regression sweep.
4. Draw, line and circle creation, wall-body drag and Escape cancellation should
   still work. Listen for quiet editing sounds on creation/edit commits, with
   no repeated sound on every pointer move. Confirm undo restores the geometry.
5. Compare the reference's broad stone faces, uneven worn bevels, pale joints,
   chunky mixed proportions and quiet surface grain. Report cap and dressing
   regularity, shadow aliasing and vegetation differences separately from holes
   or invalid geometry.
6. Move through near/coarse/shell transitions. Coarse repacking remains an
   existing limitation; identify new gaps, silhouette changes or shading jumps.
7. Verify other stone styles keep their appearance and zero crown variation by
   default. Detail must remain batched, saved state semantic and local edits
   local.

## Performance

Use separate frozen before/after production builds and hardware WebGPU. Follow
the settled construction corridor route in `docs/perf-qa.md`:

```powershell
rtk proxy npm run qa:perf -- --url http://127.0.0.1:5202 --headed --qa construction-ring --x 0 --z -100 --yaw 180 --warmup 40 --duration 12 --settle --constructionStyle glade-sandstone --out tmp/crown-independent-perf.json --timeoutMs 240000
```

Check settled status, complete frame buffers, residency/build queues, collision
readiness, frame p95 and hitch rate. Compare equivalent routes; a mesher CPU
benchmark or triangle count alone cannot establish release performance.

Return findings by severity with file/line, reproduction steps, screenshots and
exact test counts. Include the raw performance reports and distinguish existing
limitations from regressions. Do not claim full reference parity or passed
performance gates without the measurements.
