# Independent AI test prompt — wall detail, manipulation and sounds

Review and test the current wall changes against the user's Tiny Glade images.
Read AGENTS.md, CLAUDE.md, docs/perf-qa.md and the three workshop geometry/behaviour
documents required by AGENTS.md. Read the accompanying October 1 review. Keep
existing user changes. Use a fresh browser context and a temporary world.

## Run

Use the repository's RTK command prefix. Start a Vite development server, then:

```powershell
rtk proxy npm test
rtk proxy npm run build
rtk proxy node tools/generate-construction-stone-rounding.mjs --check
rtk proxy node tools/generate-audio-config.mjs --check
rtk proxy npm run check:natural-ui
rtk proxy npm run qa:construction:editing -- --url http://127.0.0.1:5183 --headed --out tmp/wall-independent-editing
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --closeup --scenes straight,arch-profiles --out tmp/wall-independent-closeup
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --view back --scenes curve,tower,curved-arch,low,standard --out tmp/wall-independent-reverse
rtk proxy npm run qa:construction:appearance -- --url http://127.0.0.1:5183 --headed --lod coarse --scenes straight,curve,tower,arch-profiles --out tmp/wall-independent-coarse
```

Run builds/tests before browser QA. Vite reloads the app when generated public
files change; do not build or edit source while the interaction harness runs.
Run GPU checks sequentially. Use frozen production builds and the documented
settled construction corridor route for performance A/B.

## Visual checks

Inspect the actual PNGs at 100% and at normal editing distance. Compare against
the user references, not just the previous render. Look for:

- Independently worn corners with broad flat faces, no repeated corner stamp.
- No dark outline painted inside a stone, cracks crossing every block, new
  holes, inverted triangles or geometry outside its packed face.
- Calm arch dressings, clear voids, intact front/back reveals and sensible
  coping. Check all four opening profiles and a tight curve.
- Stable stones after a local edit, undo and save/reload. Other styles should
  keep their existing profile. Near/coarse transition should remain coherent.

## Creation and manipulation

1. Use Draw, Line and Circle from the visible tray. Make a freehand open curve,
   a loop, a wobbly straight drag and a round enclosure in one drag each.
2. Confirm freehand closure and circle shape before release. The stored result
   must match that preview. Small clicks must not build. Draw several walls in
   succession; the tool must remain ready.
3. Select a wall, then drag its surface to move it. Tap without moving, move a
   few pixels, and drag properly. Only the deliberate drag should add history.
4. Drag anchors, tangents, height arrows and thickness handles. Nodes must win
   over body dragging. Ctrl suppresses snapping, Shift gives precision, and
   Alt on a tangent still produces a corner edit. Check double-click insertion.
5. Alt-drag across an existing wall and use the explicit cut action. Neither
   should be intercepted by wall selection, even with Line/Circle selected.
6. During each drag, press Escape, switch tools, trigger pointercancel, and open
   an input-blocking overlay. The authored wall must stay at its prior state.
   Mouse release after cancellation must not commit the old preview.
7. Undo/redo each completed action; one gesture is one entry. Save/reload the
   resulting semantic world and check openings, top profile, growth and style.
8. Check keyboard focus, small windows and the natural UI theme. The shape tray
   must not overlap the selected wall's action bar or steal camera panning.

## Sound

Listen to the app with headphones/speakers. The harness writes a short
`stone-editing-sounds.wav` in order: draw, move, cut, place, remove. It also checks
finite, nonzero sample envelopes and a conservative peak bound; those numerical
checks cannot establish that the sound is pleasant.

- Draw slowly, quickly, and hold still. Require quiet grains only during travel.
- Bend, raise, widen, translate, cut, delete and undo/redo. Check that feedback
  fits the action and there is one settle sound per committed gesture.
- Cancel, lose capture or change tools: no stuck scraping or repeated feedback.
- Toggle master mute and volume, then world volume. UI volume alone should not
  change wall sound. A muted/reloaded editor should stay muted until enabled.
- Confirm no editing sound on world load, module rebuild, selection or hover.
- Check lazy AudioContext start on the first genuine pointer/keyboard gesture.

## Report

Give concrete findings with severity, file/line, reproduction and evidence.
Separate implementation faults from subjective reference gaps. Include test
counts, browser errors, screenshots, audio impressions and both performance
reports. Report the near triangle increase explicitly. Do not describe the
existing performance gates or Tiny Glade parity as passed without evidence.
