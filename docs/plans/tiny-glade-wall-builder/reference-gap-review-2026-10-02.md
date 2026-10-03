# Remaining wall reference gaps

Date: 2026-10-02

Latest implementation and refreshed priorities:
[Wall bond and close-up review](../../qa/wall-bond-detail-review-2026-10-02.md).
The evidence below records the earlier ground/lighting milestone. Paired bands,
coherent depth offsets, stronger color patches and smaller battlements have
since landed; remaining band seams, broad upright proportions, selective wear,
meadow scenes, direct gestures and the hitch gate still require work.

This review refines the active scope in
[Full wall fidelity improvements](full-fidelity-improvements-2026-10-02.md).
The full scope remains required. The recommendations below describe our
implementation direction; they do not assume access to Tiny Glade's source.

## Evidence and current state

Compared the saved reference close-up
`docs/reference/tiny-glade/Screenshot 2026-09-28 190157.png` with new hardware
WebGPU captures in `tmp/wall-current-review/` and
`tmp/wall-current-review-fixed/`. The latter uses the production Glade lighting
preset for warm captures. These fixtures still use a flat ground plane; meadow
and courtyard compositions remain pending.

The reference has broad quiet stone faces, irregular corner cuts, tall blocks
that interrupt courses, peach/ochre/pale areas, and angular branching vines.
Our new captures still show long horizontal seams, pale color with little
spatial contrast, regular cap rows, and stacked, very similar battlements.
Heart/lobed leaves and batched ground dressing are useful foundations, but the
overall arrangement needs further work.

The official game description emphasizes gridless construction and automatic
adaptation, including paths producing doors and raised buildings producing
supports. Matching that building feel requires contextual geometry as well as
direct editing controls. See the
[official Tiny Glade page](https://store.steampowered.com/app/2198150/Tiny_Glade/).
The [linked marketing article](https://opgamemarketing.substack.com/p/tiny-glade-an-indie-game-by-2-devs)
also discusses the ease of photographing and sharing creations. It is a product
reference rather than an implementation specification.

## Implementation priorities

### 1. Break up the masonry courses and quiet the stone faces

- Introduce more tall blocks spanning adjacent course bands. Use smaller
  neighboring fillers to fit them rather than leaving a continuous seam behind.
- Make irregularity spatially related: a few stones sit proud together, with
  neighboring stones fitting around them. Keep broad faces mostly planar.
- Refine corner cuts and bevel widths. Reserve strong chips for exposed ends,
  crowns and opening edges; the current fine, bright edge noise needs restraint.
- Preserve sealed joints on tight curves and both wall faces. Stable semantic
  cells must keep unrelated stones unchanged during edits.

Primary areas: `masonry/CurvedCoursePacker.js`, `masonry/CourseLattice.js`,
`compile/ConstructionStoneExposure.js`, `compile/ConstructionPillowStoneMesher.js`.

Acceptance: inspect neutral and warm close-ups across several seeds, low walls,
tight curves and near/coarse tiers. Course lines should visibly terminate at
tall blocks. Check coverage, finite geometry and unchanged distant identities.

### 2. Give the material stronger color structure and local aging

- Tune the base sandstone and existing spatial patch field together under the
  production lighting. The new captures still read as almost uniform cream.
- Group peach, ochre and pale stones into subtle coherent areas, with occasional
  stronger individual stones. Avoid equally noisy variation everywhere.
- Add localized face stains near ground contact, water streaks beneath crowns,
  and faint moss in selected joints. Preserve quiet regions on most faces.
- Keep imported material colors under user control. Use shared semantic
  exposure/contact fields for derived aging.

Primary areas: `compile/ConstructionStoneColorGrade.js`,
`masonry/StoneColorPatchField.js`, stone color and shading profiles.

Acceptance: compare the same camera, stone size and lighting against the
reference close-up. Verify deterministic regeneration, local edit stability
and custom-material preservation.

### 3. Make crowns, ends and connected walls look constructed together

- Vary cap lengths, crown seating and exposed corner wear within safe bounds.
- Reduce the repeated stacked-block appearance of the battlements. Fit stones
  to the authored silhouette with local variation in their arrangement.
- Resolve corners and T-junctions as shared construction: suppress buried end
  dressings, bond courses through the join, and inherit compatible style.
- Improve the exposed end face and inner coping on curved and closed walls.

Use the deterministic resolved/reaction layer and local dependency invalidation.
Do not discover these relationships from the generated meshes.

Acceptance: show open ends, corners, T-junctions, short crenellated walls and
closed loops from inside and outside. Check local rebuilds and exact undo.

### 4. Let the user shape the wall directly

- Drag any wall span to bend a local neighborhood; show the influenced region.
- Drag an endpoint to extend the same wall with inherited thickness, top,
  material and growth settings.
- Add scissors trimming for endpoints and interior spans, with a precise
  preview and remapped opening/top anchors.
- Add opening width/height handles and a movable opening center. Resize the
  surrounding stones and dressing as part of the same gesture.
- Keep completed masonry visible while rebuilding only the affected region.
  Cancel must restore the original wall; one gesture must create one undo entry.

Existing `resize_feature` commands are a foundation; the direct handles and
surrounding adaptation still need completion. Opening cutting already exists;
wall-run trimming is a separate capability.

Acceptance: build a courtyard, cut an opening, reshape, extend, trim and undo
using the pointer without entering numbers. Test persistence and bounded drag
work as well as appearance.

### 5. Make arches and narrow piers adapt gracefully

- Refine radial arch stones, blended shoulders, inner reveal and crown seating.
- Adapt adjacent courses to the opening rather than exposing abrupt filler
  transitions at the shoulders.
- Choose a valid surround when openings approach each other, a crown or a
  junction. Maintain supported piers and traversable passage dimensions.
- Feed the same resolved opening masks to masonry, growth and collision.

Acceptance: round, segmental, pointed and flat openings on straight and curved
walls; repeated resizing; narrow piers; clear collision passages.

### 6. Integrate the wall into the garden

- Continue ivy along suitable joints, around corners and over crowns. Vary
  branching, leaf orientation and clustering; keep stems visible in quiet gaps.
- Refine ground tufts, flowers, pebbles and moss into natural clusters and worn
  contact areas. Respect openings, ruin voids and walkable regions.
- Compare actual meadow scenes with the reference, including foreground grass,
  terrain embedding, leaf shadows and restrained green ground bounce.
- Keep optional depth of field for presentation after the wall and scene are
  correct at a sharp focus.

Acceptance: terrain slopes and both faces, clear openings, bounded decoration,
one batched growth mesh per occupied module, stable appearance across LOD.

### 7. Refine sound and contextual controls

- Layer soft stone taps, grit and scrape according to gesture travel and speed.
  Differentiate drawing, bending, cutting, deleting and settling a completed edit.
- Add small pitch/timing/gain variation and a restrained completion cue. Keep
  mute, rate limiting and cancellation behavior predictable.
- Show compact nearby handles and palette swatches for the current action.
  Fade inactive guides and keep generous pointer targets.
- Add inviting garden, courtyard and castle starting presets with useful
  defaults. Complete the first-minute pointer workflow before adding more panels.

Acceptance: a listening artifact and pointer-driven recording demonstrate all
actions, mute, undo and cancel without repeated or overly loud feedback.

## Review fixes and verification

- Corrected the appearance fixture's opening placement: desired fractions now
  map through the complete wall's arc table into their actual host segments.
  Earlier curved-arch screenshots placed the opening near the first segment and
  did not show the intended central comparison. Replace those visual checks.
- Warm captures now share the production Glade preset, sun direction, sky fill
  and shadow softness. Neutral geometry captures retain their neutral lighting.
- Ground exclusion now covers the full offset pebble and bent-blade footprint.
  Tests cover module ownership, distant identity, opening exclusion, both sides,
  sloped terrain, geometry bounds and finite normalized streams.
- Added checks for shadow-radius defaults, preset overrides and interpolation.
- All 2,952 tests pass, along with the production build, generated growth
  configuration check and diff whitespace check. Test log:
  `tmp/wall-current-review-tests.log`; build log:
  `tmp/wall-current-review-build.log`.

## Performance remains part of the result

The current frozen production corridor run uses hardware WebGPU, complete
frame retention, settled streaming, 96 resident wall modules and a clear build
queue. It measures 65.44 FPS, p95 31.6 ms and 3.71% hitches. Collision is ready
for all nine desired chunks and its p95 is 0.1 ms.

The frame-time p95 meets the 33.3 ms limit; the hitch rate exceeds the 2% limit.
The full fidelity objective remains open. Movement QA also does not prove drag
latency; direct manipulation needs its own pointer-driven performance checks.

Report: `tmp/wall-ground-light-perf-current.json`. The frozen candidate is
`tmp/wall-ground-light-dist/`.

A fresh sequential run of the retained ivy baseline measures 61 FPS, p95
32.17 ms, 4.13% hitches and 1,792 ms construction build work. Report:
`tmp/wall-ground-light-perf-ivy-baseline.json`. Both runs settle, retain complete
frames, have 96 resident modules and end with an empty queue. The baseline ends
with 38 coarse/58 shell modules; the candidate ends with 37 coarse/59 shell.
This single pair provides context for the complete candidate. Its slightly
different ending residency and the intervening color/cache changes prevent
attributing the difference to ground dressing alone. Both fail the hitch gate.
