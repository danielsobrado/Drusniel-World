# Independent AI testing prompt: ivy fidelity pass

Review and test the current ivy implementation in `F:\Development\SimCity-DnD`.
Read AGENTS.md, the required workshop architecture/behavior documents and
`docs/perf-qa.md`. Follow the RTK shell requirement. Read the paired ivy review
and the full fidelity ledger; the overall Tiny Glade objective is still active.

Inspect:

- `src/editor/construction/masonry/WallGrowth.js`
- `src/editor/construction/compile/ConstructionGrowthBuilder.js`
- `src/editor/construction/compile/ConstructionIvyMesher.js`
- `src/editor/construction/compile/ConstructionGrowthSurface.js`
- Growth config/generator, masonry integration and growth-only residency refresh.

Run `rtk proxy node --test` and
`rtk proxy node tools/generate-construction-growth.mjs --check`.
Run a production build. Use a fresh Vite dev server for appearance fixtures;
raw fixture imports are unavailable from production preview.

Capture actual images on hardware WebGPU with the appearance runner:

```powershell
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5189 --headed --scenes straight,curve,curved-arch,low --closeup --out tmp/ivy-independent-near
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5189 --headed --scenes straight,curve,curved-arch,low --lod coarse --view back --closeup --out tmp/ivy-independent-coarse
```

Adjust the server port if necessary. Inspect the PNGs, especially close-up
leaves, branch connections, root contact, cap edges and arch clearance. Compare
with `docs/reference/tiny-glade/Screenshot 2026-09-28 190157.png` and the supplied
curved meadow/arched courtyard references. Report visual differences plainly.

Verify:

1. Both wall faces have grounded roots on sloping terrain. Neither leaf shapes
   nor petioles invade dressed opening clearance.
2. The leaf silhouette looks like broad angular ivy. Normals remain finite,
   unit-length and outward on mirrored branches and both leaf faces.
3. Leaves follow proud/recessed stone face envelopes without obvious burial or
   excessive floating. Stress tight curves, thin walls and ruined wall voids.
4. Toggle growth off/on and undo/redo in the live editor. Existing masonry,
   collision and unrelated modules remain resident. Restored growth matches
   the initial build, including correct near/coarse shadow policy.
5. Low walls stay sparse; tall patches remain coherent and deterministic.
   Adding a distant opening does not reshuffle unaffected patches.
6. Geometry stays batched and within budgets. Watch for transient arrays or
   rebuild work on pointer movement.

Compare frozen before/after production builds using the settled construction
route in `docs/perf-qa.md`. Run GPU browsers sequentially and keep tests/builds
outside measured intervals. Reject software/fallback adapters and unsettled
runs. Report p95, hitch rate, build time, complete buffers, collision readiness
and residency. The existing hitch failure is unresolved; a prettier capture
does not prove performance acceptance. Add a sustained close-up editing check.

Return severity-ranked defects with file/line evidence, commands run, inspected
artifact paths, and a pass/fail verdict for each item. Do not mark the full
fidelity objective complete; the ledger contains additional visual, interaction,
chemistry and audio work.
