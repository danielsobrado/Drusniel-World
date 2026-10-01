# Wall detail, creation and sound review — October 1, 2026

## Reference and intent

The supplied screenshots favour broad stone faces, restrained bevels, uneven
corner wear, narrow joints and small controls near the work. The official
[Tiny Glade description](https://store.steampowered.com/app/2198150/Tiny_Glade/)
describes freeform, gridless building with details that adapt to edits. The
user's [article](https://opgamemarketing.substack.com/p/tiny-glade-an-indie-game-by-2-devs)
provides product context. These are public visual and behaviour references;
the implementation and sounds here are our own.

## Changes

- **Close-up sandstone:** four independently sampled corner radii, stable for
  each stone and shared between its two faces. Rim clearance and packing bounds
  are preserved. Near geometry uses two arc segments per corner, coarse keeps
  one. Dressings retain their calmer shaping. Removed the shell masonry texture
  from individual sandstone faces; the material keeps its fine stone grain.
- **Creation:** a compact Draw / Line / Circle tray uses the existing warm paper
  theme. Circle is a centre-to-rim drag with four smooth cubic quarters. Line
  ignores pointer wobble. Freehand courtyard closure is now visible in preview.
  Preview and commit use one path factory and produce ordinary semantic curves.
  Release keeps the wall and leaves the tool ready for another stroke.
- **Manipulation:** drag a selected wall's surface to move it. Nodes take
  priority, and a four-pixel threshold prevents a selection click from moving
  anything. Existing height and thickness handles remain available. Explicit
  cuts and Alt on a wall reach the cut tool instead of selecting the wall; Alt
  on a tangent retains its corner-edit behaviour.
- **Cancellation:** Escape cancels an active wall gesture before closing menus,
  including height, thickness and whole-wall moves. Switching tools also
  cancels the direct preview. Clicking a node without dragging no longer adds a
  history entry. Completed moves remain one undo step.
- **Sound:** quiet procedural stone impacts and grit for drawing, movement,
  cuts, placement, deletion and undo/redo. Drawing and manipulation require
  both 16 cm of travel and 120 ms between grains. Holding still is silent.
  Cancel stops scheduling; the last grain decays. Audio uses the existing bus,
  world volume, master volume and mute, with lazy initialization from a user
  gesture. Each temporary audio node disconnects when finished. No new loops,
  downloads or AudioContexts are introduced by wall editing.

The audio YAML now includes the previously JSON-only footstep definitions,
preserving their values and recordings. `tools/generate-audio-config.mjs`
generates/checks the runtime JSON, and a test checks source/runtime agreement.

## Boundaries

Authored walls remain semantic. Circle/line are creation gestures, not new saved
archetypes. Preview leaves the store unchanged. The mesher still batches stones
into module geometry; this adds no scene object per stone and no viewport
texture pass. Stone count is unchanged. A whole-wall move legitimately reaches
the whole wall; known node edits keep the existing local command invalidation.

## Verification

- Full Node suite: **2,933 tests passed**, including Alt-tangent precedence.
  Production build passes. It retains the existing missing inventory image,
  thumbnail WebGLRenderer import and chunk-size warnings.
- Generated stone configuration, generated natural UI, audio YAML/JSON agreement
  and `git diff --check` checked.
- Fixed WebGPU close-ups under neutral and warm light:
  `tmp/wall-oct1-close-before/` and `tmp/wall-oct1-close-final/`.
  Straight wall: 411 stones in both; triangles 31,908 → 45,060.
  Four opening profiles: 466 stones in both; triangles 34,190 → 43,182.
- Browser interaction/audio harness passes: a four-anchor circle, preview/commit
  agreement, continuous creation, line creation, body-drag commit/undo, Escape
  for drawing and body movement, and Alt-cut intent on an existing wall.
  Gesture events include draw, move, placement and undo/redo; mute suppresses
  synthesis. Five OfflineAudioContext renders are finite and nonzero, with
  peaks from 0.012 to 0.030. Numerical checks do not replace a listening review.
  Evidence: `tmp/wall-oct1-editing/report.json`, `creation-controls.png`, and
  `stone-editing-sounds.wav` (draw, move, cut, place, remove).
- Ten reverse-view captures and eight coarse captures under neutral/warm light
  completed with no page errors. Evidence: `tmp/wall-oct1-reverse/` and
  `tmp/wall-oct1-coarse/`. Inspected the reverse curved opening and four coarse
  opening profiles as well as the close-up straight wall and creation controls.

### Performance comparison

Frozen production builds, headed NVIDIA WebGPU, one browser at a time. Used the
documented construction-ring approach from `(0, -100)`, yaw 180, warmup 40 s,
duration 12 s, `--settle`, `glade-sandstone`.

| Measurement | Before | After |
| --- | ---: | ---: |
| Mean FPS | 54.73 | 58.52 |
| Frame p95 | 37.2 ms | 34.9 ms |
| Hitch rate (>33.3 ms) | 7.67% | 7.46% |
| Collision p95 | 0.1 ms | 0.1 ms |
| Resident wall modules | 96 | 96 |
| Final wall build queue | 0 | 0 |

Both runs settled and retained complete frame data. Collision passed. The
overall 33.3 ms / 2% targets **remain unmet in both runs**. This pair shows no
observed corridor regression, not a proven performance improvement. Reports:
`tmp/wall-oct1-perf-before.json` and `tmp/wall-oct1-perf-after.json`.

## Remaining visual work

The course rhythm and capstone line are still more orderly than the reference.
Future work should break those long rhythms through the packing/top-profile
layers, keeping openings, dressing and local stability intact. Ground blending,
ivy leaf shapes and the scene's strong grass/lighting treatment also affect the
overall resemblance. This pass does not establish full parity with Tiny Glade.

Near triangles increase for softer corners; sustained close-up scenes with many
walls still need their own performance envelope. The corridor route ends with
coarse/shell residents, so it cannot alone prove sustained near performance.

Use the [independent testing prompt](wall-detail-editing-audio-test-prompt-2026-10-01.md)
for the next review.
