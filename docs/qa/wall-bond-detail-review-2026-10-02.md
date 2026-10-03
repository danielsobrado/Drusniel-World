# Wall bond and close-up detail review

Date: 2026-10-02. This is a partial milestone in the
[full fidelity scope](../plans/tiny-glade-wall-builder/full-fidelity-improvements-2026-10-02.md).

Subsequent milestone: [Garden reference comparison scenes](wall-garden-reference-scenes-2026-10-02.md).
Fixed meadow close-up, curved enclosure and arched courtyard captures now exist;
the plain-fixture observations below record the preceding masonry milestone.

## Implemented

- Glade sandstone uses two-course bands with deterministic uneven subdivisions.
  Tall blocks now sit beside smaller fitted inserts. Footing and module grids
  remain aligned, including different local crown heights.
- Normal face offsets share a continuous wall-local field. Nearby blocks have
  related depth variation while retaining their solved joint footprints.
- Color patches preserve individual stone colors instead of blending away their
  variation. Pale, ochre and peach patches have stronger spatial contrast.
  Authored custom materials retain their color control.
- Small Glade battlements use fewer full-sized stones. Coping crown variation
  increases; crown wear has an independent hash lane. Other styles keep their
  previous course and merlon defaults.
- The Glade sun direction better lights the front of the comparison fixture.
  Neutral captures remain available to assess geometry independently.
- Adaptive arch sampling now bounds horizontal contour error near the apex.
  Opening backing is recessed further, and coarse four-corner outlines preserve
  the solved footprint. These fixes prevent reveal/backing defects exposed by
  the larger stones without increasing the ordinary coarse triangle budget.
- Workshop roof batches separate geometry with and without UVs. This fixes the
  mixed primitive/polygon roof merge failure while preserving existing streams.

## Verification

All 2,980 tests pass (`tmp/wall-bond-tests.log`). Production build, generated
stone-color configuration check, and whitespace check pass. New checks cover
paired grids, fitted coverage on curves and varying heights, color/depth field
continuity, custom material preservation, arch contour accuracy, and small
battlement seating. Existing topology, backing, opening and roof batching checks
also pass.

Ordinary Glade stones remain 96 triangles near and 32 triangles coarse. Whole
fixture counts include growth and dressings: the straight fixture goes from
313 stones / 36,970 triangles to 271 / 32,434, and the curve from 612 / 70,002
to 502 / 58,122. Counts are not a frame-time guarantee.

Hardware WebGPU captures inspected:

- `tmp/wall-bond-final-wide/`: curved wall and curved arch, both lighting modes.
- `tmp/wall-bond-final-coarse/`: straight, curve, curved arch and low wall, back.
- `tmp/wall-bond-verified-near/`: fresh straight, curved, curved-arch and low-wall
  close-ups after the final reveal fix, in neutral and warm lighting; no page errors.

Reference: `docs/reference/tiny-glade/Screenshot 2026-09-28 190157.png`.
These are plain geometry fixtures, not matching meadow/courtyard scenes.

## Remaining visible differences

Paired bands still create long seams at their boundaries. Many uprights are too
narrow, the coping forms a regular strip, and the straight close-up is mostly
cream. The reference combines wider upright blocks, interrupted seams, larger
selective corner cuts, warm stone groups, occasional stains and branching ivy.
The current fixture's bare plane also prevents judging the overall garden feel.

## Next implementation priorities

1. Build matching meadow and courtyard comparison fixtures with fixed camera,
   stone scale and production lighting. Keep neutral close-ups for geometry QA.
2. Replace the remaining band-boundary seams with locally interlocking cells.
   Favor broad uprights and occasional small fillers; reduce narrow repeated
   strips. Preserve both faces, deterministic identity and opening coverage.
3. Refine exposed corner cuts and quiet broad faces. Add selective ground stains,
   crown streaks and faint joint moss from semantic exposure/contact fields.
4. Vary cap lengths and fit shared corner/T-junction dressings. Refine arch
   shoulders and narrow piers in the deterministic resolved layer.
5. Route ivy along selected joints and around ends/crowns; arrange ground detail
   in clusters and respect ruin masks and traversal clearances.
6. Finish local bend, inherited endpoint extension, scissors trim and opening
   resize gestures with finished previews, cancel and one-step undo.
7. Refine gesture-based taps, grit and scrapes, then record a listening artifact
   and a first-minute pointer workflow with contextual controls and presets.

These recommendations interpret the supplied images and the public
[Tiny Glade description](https://store.steampowered.com/app/2198150/Tiny_Glade/).
They do not assume access to its private implementation.

## Performance

Sequential frozen production corridor reports:
`tmp/wall-bond-perf-before.json` and `tmp/wall-bond-perf-after.json`.
The route uses hardware WebGPU, settled streaming, a 40-second warmup and a
12-second approach through the wall LOD bands. It uses the default meadow sky;
it does not validate the Glade sky preset or pointer-drag latency.

| Metric | Before | Candidate |
| --- | ---: | ---: |
| Average FPS | 64.61 | 64.78 |
| p95 frame time | 31.90 ms | 31.55 ms |
| Hitch rate | 4.15% | 4.02% |
| Cumulative construction build work | 1,507 ms | 1,384 ms |
| Resident modules | 96 | 96 |
| Near / coarse / shell modules | 0 / 38 / 58 | 0 / 37 / 59 |
| Construction queue | 0 | 0 |
| Collision p95 | 0.1 ms | 0.1 ms |

Both runs settle, retain complete frames and pass collision readiness (9/9).
The candidate passes the 33.3 ms p95 limit and fails the 2% hitch limit. One
module ends in a different detail band, so this single pair does not isolate
individual changes or prove a speed improvement. Performance acceptance remains
open, along with the full visual and interaction scope.
