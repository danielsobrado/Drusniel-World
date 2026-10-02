# Wall crown and close-up detail review — October 2

This continues the [October 1 stone fidelity pass](wall-stone-fidelity-review-2026-10-01.md).
The reference screenshots are in `docs/reference/tiny-glade/`. The uneven face
bevels, quiet surfaces and mixed block proportions from that pass remain the
foundation; this pass improves the crown and corrects exposed backing on short
walls.

## Changes

- Sandstone coping now has deterministic downward crown wear, up to **2.88 cm**
  per cap. Its bottom, depth, width and position along the wall remain seated.
  The wear stays inside the authored height envelope. Other styles default to
  zero crown variation; the style catalog validates the parameter.
- A course intersecting the wall crown survives even when its centre is above
  the body. Previously a 0.8 m sandstone wall lost the 0.16 m course beneath its
  coping, leaving a conspicuous band of backing. The same defect was visible
  in the October 1 low-wall capture.
- When an exact whole-course fit falls outside the existing 80–125% style
  bounds, the fitter selects a bounded grid that overshoots the crown. The
  lattice then trims the last course. This avoids tiny remnants left by the
  former nominal-grid fallback. Grid fitting still uses wall-wide authored
  values, preserving agreement between modules.
- Splitting uses the height that survives crown clipping, allowing for the
  bed-wave margin. A short crown slice stays whole instead of becoming two
  leaves that are both too short to render.
- Batched pillow geometry avoids redundant normal-length calculations at the
  bevel endpoints and on uniform rings. Intermediate variable elliptic slopes
  retain per-point normalization. No extra scene objects or triangles are added
  by this mesher change.
- The joint-profile generator test now writes into a private temporary directory.
  Its previous rewrite of the checked-in module caused a concurrent planner
  test to import a temporarily empty file. Determinism and agreement with the
  checked-in output are still checked.

The crown changes are derived geometry. They introduce no saved stone meshes,
new UI controls, mesh inference, terrain changes or renderer configuration.

## Verification

- **2,941 tests passed**, no failures. Production build passed.
- Regression coverage checks a retained partial crown, deterministic cap wear,
  seated cap bottoms, unchanged body placements when only wear is toggled, and
  flat sandstone walls from **0.50 to 1.60 m in 0.01 m steps**. Each sampled crown
  span reaches its coping bed and every solved field face exceeds the existing
  0.09 m minimum.
- The raise test now checks bounded course heights and addition of a course,
  accommodating the newly retained slices along ramps. The existing density
  comparison keeps its ±15% gate over 16 deterministic layout seeds rather than
  one seed. Module budgets and edit locality tests also passed.
- Final headed Chromium appearance checks used hardware WebGPU, with no page
  errors, for near front views of low/straight/curve/arch-profile walls and coarse
  views of low/straight/tower walls, plus back views of low/tower walls, under
  neutral and warm lighting. Final zoom 5 straight/arch captures and
  rounded-fieldstone low/straight captures also passed on WebGPU.
- The editor harness passed circle preview agreement, two-anchor line creation,
  wall-body movement, undo, Escape cancellation and Alt cutting. The sound smoke
  checks recorded zero synth calls while muted, an enabled call, and finite quiet
  draw/move/cut/place/remove buffers. No page errors were reported; this is
  functional audio verification, not a listening assessment.

Final captures and reports:

- `tmp/wall-oct2-final-closeup/`: zoom 3 near captures. `low-warm.png` shows the
  seated crown; `straight-warm.png` shows broad faces, thin joints and varied
  proportions.
- `tmp/wall-oct2-final-coarse/`: distance captures, including the corrected low
  wall. Low-wall geometry increased from 55 to 91 near stones and from 55 to 85
  coarse stones because the missing crown is now present. Final counts are
  10,500 near / 7,132 coarse triangles for this fixture.
- `tmp/wall-oct2-final-back/`: reverse views of the corrected low wall and tower.
- `tmp/wall-oct2-final-detail/`: final zoom 5 stone and arch captures.
- `tmp/wall-oct2-final-rounded/`: rounded-fieldstone style checks.
- `tmp/wall-oct2-final-editing/`: interaction report, creation-controls capture
  and generated editing-sound WAV.
- `tmp/wall-oct2-stone-detail/`, `tmp/wall-oct2-cap-closeup/`,
  `tmp/wall-oct2-back/`: earlier checks of the cap/mesher changes before the
  seating correction. Their low-wall images retain the old defect and should
  not be used as final seating evidence.
- `tmp/wall-oct2-final-tests.log`, `tmp/wall-oct2-final-build.log`.

The build retains existing warnings about inventory images, the thumbnail
renderer import and large chunks.

## Mesher measurement

`tmp/bench-stone-mesher.mjs` writes 2,048 stones per measured batch after warmup,
over seven batches, using 256 distinct deterministic stone descriptors.

| Style | Before median | After median |
| --- | ---: | ---: |
| Glade sandstone | 20.98 ms | 20.07 ms |
| Rounded fieldstone | 36.95 ms | 33.25 ms |

Positions, normals, colors, UVs and indices had identical combined hashes for
the before/after outputs across the 256 descriptors in each style. Raw results
are `tmp/wall-oct2-mesher-{before,after}.json`. These are local CPU measurements;
they do not establish an overall frame-rate improvement.

## World performance

The current baseline is the committed `f8c7be10` build, including October 1's
stone changes. Separate frozen production builds used the settled construction
ring route at `x=0,z=-100,yaw=180`, 40 s warmup and 12 s measurement on NVIDIA
hardware WebGPU. GPU browser checks ran sequentially. The final suite finished
during the last route's warmup, before its measured interval.

| Build | Average FPS | Frame p95 | Hitch rate |
| --- | ---: | ---: | ---: |
| Current committed baseline | 54.33 | 35.37 ms | 7.73% |
| Cap/mesher changes, before seating correction | 60.85 | 33.68 ms | 5.66% |
| Final changes, including seating correction | 60.44 | 33.61 ms | 5.97% |

All three settled, retained complete frame buffers, ended with 96 resident
construction modules and an empty build queue, and passed collision timing and
readiness with p95 **0.1 ms**. The final run measured 720 frames, with cumulative
construction build time 1,205 ms. Raw evidence is
`tmp/wall-oct2-perf-{before,after,final}.json`.

**Release performance acceptance remains open:** p95 is above 33.3 ms and hitch
rate above 2%. These runs do not show the slowdown seen in the earlier October 1
comparison, but they do not isolate or close its cause. Final near residency is
zero; this route also does not establish sustained close-up performance. Treat
the frame-rate difference as a local observation, not a proven general gain.

## Remaining work

The later [distance continuity pass](wall-distance-continuity-review-2026-10-02.md)
addresses sandstone placement changes between near and coarse tiers. The notes
below describe this crown pass's state before that follow-up.

Cap variation is deliberately small; exposed ends and dressing blocks still
look more regular than the references. Warm scene lighting, softer shadows,
richer ivy branching and ground vegetation remain substantial visual gaps.
The fixed neutral scene exposes shadow aliasing at extreme magnification.

Coarse packing still changes the arrangement and number of stones. This pass
corrects the short-wall crown in each tier, but does not resolve that existing
transition issue. The flat low-wall sweep does not establish complete coverage
for every arbitrary locally lowered or ruined top profile.

Use the [independent AI test prompt](wall-crown-detail-test-prompt-2026-10-02.md)
for fresh visual, interaction and performance verification.
