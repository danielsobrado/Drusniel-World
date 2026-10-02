# Full wall fidelity improvements

User objective: implement all improvements proposed in the October 2 discussion.
Status: active. Completion requires the full list below, including visual and
interaction verification. Earlier stone/crown/LOD passes are foundations.

Follow AGENTS.md and the semantic workshop geometry framework. Derived masonry,
growth and junction reactions remain deterministic and batched. Preserve local
edit invalidation, undo, persistence, collision and near/coarse identity.

## Scope and evidence

| Requirement | Current state | Completion evidence |
| --- | --- | --- |
| Matching close-up, curved meadow and arched courtyard reference scenes | Plain geometry fixtures exist | Render all three at matching poses and inspect actual PNGs |
| Warm sunlight, cooler shaded faces, softer shadows and contact shading | Glade preset exists; refinement pending | World and fixture captures plus settled rendering comparison |
| Mixed joint patterns, fewer continuous seams/four-way joints, upright blocks and fillers | Mixed leaves exist; refinement pending | Neutral close-up layout/coverage checks across seeds and curves |
| Exposure-aware corner chips and quiet broad faces | Stable uneven bevels exist; exposure refinement pending | Inspect ends/crowns/arches; bounded valid topology |
| Related stone depth differences and occasional proud stones | Independent depth offsets exist | Deterministic spatial variation; sealed curved joints |
| Related color patches, pale/ochre/peach outliers and localized stains | Per-stone color exists | Surface captures, custom-material preservation, stable regeneration |
| Rough crowns, varied cap lengths and less mechanical battlements | Top styles and mild cap wear exist | Bounded seated silhouettes at low/standard heights and all tiers |
| Bonded open ends, corners and T-junctions | End dressings exist; shared junction resolution pending | Derived junction plans, no buried dressings/overlap, undo and local rebuild |
| Radial arch stones, blended shoulders, supported narrow piers | Fitted openings exist | Curved/mixed-profile passage and collision checks |
| Interior face, thickness and coping quality | Two-sided geometry exists | Inner/outer captures on tight curves and closed loops |
| Larger shaped ivy leaves, branches, overlap, orientation, stone attachment and shadows | Folded heart/lobed leaves, faceted stems, petioles and placement-based attachment implemented; joint-guided routes, corner/crown strands pending | Actual close-up renders, opening/ground clearances, batched stable geometry |
| Grass tufts, flowers, pebbles, moss and embedded ground contact | World meadow exists; wall contact dressing pending | World/garden captures, bounded terrain-following decoration |
| Direct local bend with visible influence, inherited endpoint extension and preview | Whole-wall move and control handles exist | Pointer-driven edit, locality, cancel, undo and persistence checks |
| Direct trim with scissors preview | Opening cut exists; wall-run trim pending | End/interior trim, remapped features, cancel and one-step undo |
| Responsive opening resizing and adaptive pier/dressing geometry | Inspector and cut tools exist | Drag opening width/height; resolved surrounding geometry and clear passage |
| Finished masonry visible during localized drag, exact affected curve/opening/trim preview | Parked draft improvements exist | Pointer captures and bounded preview work at 60 FPS target |
| Layered soft stone taps/scrapes with gesture-based variation | Quiet synthesized events exist | Listening artifact plus mute/rate-limit/action checks |
| Inviting garden/courtyard/castle presets, minimal contextual controls | Draw/Line/Circle and matching exist | First-minute courtyard+opening+reshape+undo without numeric input |
| Regression, persistence, collision and performance acceptance | Ivy pass: 2,947 tests and build pass; hardware WebGPU visuals pass; hitch gate and added build cost remain open | Full relevant QA, settled before/after metrics, explicit gate verdict |

## Delivery order

1. Ivy geometry/attachment, garden fixture and scene lighting.
2. Ground contact, stone depth/color/exposure and crown/end art.
3. Shared corner/T-junction resolution and adaptive openings.
4. Local bend, extension, trim, presets and contextual previews.
5. Sound refinement, complete visual/interaction/performance verification.

This order does not narrow the objective. Unfinished rows remain required.

## Progress

- Initial inspection: current tree clean; previous stone/crown/LOD work is committed.
- At initial inspection, growth emitted five-vertex diamond leaves and one flat strip per stem;
  its patch height is capped at 65% of wall height. This prevents crown strands
  and makes close-up vegetation markedly simpler than the supplied references.
- Ivy pass replaces those diamonds with folded angular heart/lobed outlines,
  true facet normals, four-sided stems and connecting petioles. Leaf radii are
  9–18 cm, patch reach is bounded by the actual top profile, and short walls
  reduce node count rather than crowding all eight nodes below the cap.
- Attachment samples a conservative face envelope from resolved placements and
  the existing stable stone jitter. It does not inspect triangles. Growth stays
  in one batch per occupied module; roots follow both terrain faces. Near ivy
  casts shadows; coarse ivy keeps its geometry and receives shadows.
- Actual final captures: `tmp/wall-ivy-final-near/` and
  `tmp/wall-ivy-final-coarse-back/`. Full test log:
  `tmp/wall-ivy-final-tests.log`. Performance evidence:
  `tmp/wall-ivy-perf-{before,after,optimized,before-repeat}.json`.
- This is a partial vegetation milestone. Shared junction chemistry, direct
  editing gestures, garden comparison scenes, lighting, ground contact and the
  other rows remain required. Performance acceptance remains open.
- The repeated baseline ends with the same detail-band residency as optimized
  ivy. Optimized ivy measures about 9.5% lower FPS and 27% more construction
  build time; its 4.17% hitch rate exceeds the 2% target. Further cost reduction
  is required before accepting the vegetation milestone for release.
