# Independent AI test prompt — stone close-up fidelity

Review and test the October 1 stone fidelity changes. Read AGENTS.md, CLAUDE.md,
the required geometry/behaviour documents, docs/perf-qa.md, and
[the implementation review](wall-stone-fidelity-review-2026-10-01.md).
Preserve existing user work. Use a fresh browser context and temporary world.

## Run

Use an available port for a fresh Vite development server; replace 5187 below
if needed. Run GPU checks sequentially and complete builds before browser QA.

```powershell
rtk proxy npm test
rtk proxy node tools/generate-construction-stone-rounding.mjs --check
rtk proxy npm run build
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5187 --headed --out tmp/stone-independent-scenes
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5187 --headed --closeup --zoom 5 --scenes straight,curve,arch-profiles --out tmp/stone-independent-detail
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5187 --headed --view back --scenes straight,curve,tower,arch-profiles --out tmp/stone-independent-back
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5187 --headed --lod coarse --scenes straight,curve,tower,arch-profiles --out tmp/stone-independent-coarse
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5187 --headed --style rounded-fieldstone --scenes straight,curve --out tmp/stone-independent-rounded
```

## Inspect

Compare actual images at 100% with the `190121`, `190157`, and `190257` Tiny Glade
screenshots in `docs/reference/tiny-glade/`.

1. Faces should be broad and quiet; bevel width and depth should vary around
   corners and edge midpoints. Reject repeated stamps, excessive triangular
   face shading, inflated pillows, or visible noise covering every stone.
2. Check both faces, top caps, end dressings, arch shoulders, narrow piers,
   very low walls, and tight bends. Look for collapsed triangles, mortar in
   front of stones, open joints, and cracks through the wall.
3. Require tall blocks beside thin horizontal pairs. Reject slivers and
   continuously aligned vertical joints. Keep narrow pale/recessed joints.
4. Rebuild the same wall; edit a distant segment; undo and save/reload. Stable
   stones must reproduce their wear, and saved data must remain semantic.
5. Check other stone styles and imported albedo materials. Flat shading should
   be driven by the sandstone surface profile, not a global renderer change.
6. Move through LOD transitions in the app. The existing coarse repacking issue
   remains documented; report any new silhouette, shading, or packing jumps.
7. Confirm 96 near / 64 coarse triangles per ordinary sandstone unit. Ensure
   detail remains batched and no extra scene objects or screen-copy passes appear.

For performance, use separate frozen production builds, hardware WebGPU, and
the settled construction corridor route from docs/perf-qa.md. Compare frame
percentiles, hitch rate, streaming/build queues and collision readiness. The
fixture triangle reduction alone does not prove a frame-rate improvement.

Report findings with severity, file/line, steps and screenshots. Include exact
test counts and both performance reports. Distinguish visual preferences from
geometry defects and existing limitations; do not claim full reference parity.
