# Wall ivy detail review

Date: 2026-10-02. Status: partial fidelity milestone; full objective remains active.
Scope: improve the vegetation visible in the supplied Tiny Glade close-ups.
Full requirements: [fidelity ledger](../plans/tiny-glade-wall-builder/full-fidelity-improvements-2026-10-02.md).

## Result

The old small diamonds and flat stem ribbons are replaced by angular heart and
lobed leaves, a shallow central fold, individual facet normals, four-sided stems
and petioles. The first render had sharp star-shaped leaves; visual inspection
led to simpler, broader outlines with shallower folds and more heart variants.

Leaf radii grow from 6.5–11.5 cm to 9–18 cm. Patches can reach up to 2.85 m rather
than being capped at 1.35 m and 65% of wall height. The actual top profile and
opening masks still bound growth. Node count follows available patch height:
the 0.8 m straight fixture has 29 leaves instead of the initial crowded 125.

Each leaf sits outside the highest resolved stone face in its footprint. A
spatial index samples existing placements and stable stone jitter, including
normal offsets, depth and a conservative tilt/bulge allowance. This is an
envelope approximation, not exact attachment to every stone bevel. Branches
sample their own route; petioles bridge from their stem to the leaf fold. Roots
touch terrain on both faces, including cross slopes.

Growth remains one merged mesh per occupied module, with complete position,
normal, color and UV streams. It introduces no per-leaf objects or update loop.
Near ivy casts and receives shadows. Coarse ivy receives shadows and preserves
its shape without casting separate distant vegetation shadows. Growth refresh
passes the same placements and active detail band as the masonry build.

## Verification

- **2,947 tests passed**, zero failures; production build and generated growth
  profile check passed. Existing build warnings remain.
- Checks cover deterministic identity, module ownership, budgets, distant
  stability after opening edits, growth persistence/undo, unchanged collision
  revision, both terrain roots, proud-stone attachment on both faces, bounded
  leaf footprints, finite complete streams, unit outward normals, mirrored
  branch winding, short-wall density and branch/opening clearance.
- Headed hardware WebGPU captures pass for straight, curved, curved-arch and
  low walls under neutral/warm light: near front and coarse back. No page errors.
  Actual final straight/low/curve PNGs were inspected during this pass.
- `tmp/wall-ivy-final-near/`: final near images and report.
- `tmp/wall-ivy-final-coarse-back/`: final coarse reverse images and report.
- `tmp/wall-ivy-final-tests.log`, `tmp/wall-ivy-optimized-build.log`.

## Performance

Frozen production builds use the settled construction-ring route with 40 s
warmup and 12 s measurement, x=0,z=-100,yaw=180, sandstone, NVIDIA WebGPU.
GPU browsers run sequentially; tests/builds finish before measured intervals.

| Run | Average FPS | Frame p95 | Hitch rate | Construction build time |
| --- | ---: | ---: | ---: | ---: |
| Before | 69.80 | 30.74 ms | 3.60% | 1,295 ms |
| Initial ivy | 57.93 | 32.50 ms | 4.05% | 1,794 ms |
| Optimized ivy | 62.33 | 32.00 ms | 4.17% | 1,646 ms |
| Repeated before | 68.90 | 30.79 ms | 3.77% | 1,300 ms |

The optimization removes per-triangle temporary arrays, reduces redundant stem
subdivision and limits ivy shadow casting to near detail. Compared with the
initial implementation, construction build time drops about 8% and render
submission average drops from 7.49 to 6.68 ms. These are individual runs;
streaming/residency differs slightly, so they do not establish a precise causal
FPS change. The repeated baseline agrees with the initial baseline and ends
with the same 37 coarse / 59 shell modules as the optimized run. Against that
repeat, optimized ivy measures about 9.5% lower FPS and 27% more construction
build time. This regression remains unresolved and needs further work.

All four settle with complete frame buffers, 96 resident modules and an empty
queue; collision readiness is 9/9 and query p95 is 0.1 ms. **Performance acceptance
remains open:** hitch rate exceeds the 2% target. The movement route does not
establish sustained close-up drag performance. Raw reports are
`tmp/wall-ivy-perf-{before,after,optimized,before-repeat}.json`.

## Remaining fidelity work

Vegetation still needs joint-guided branch routes, corner wrapping and crown
strands. Ruin damage voids need dedicated attachment verification. Broad stone
color groups, reduced course repetition, more natural battlements, softened
lighting, ground-contact dressing and reference-matched garden fixtures remain
separate requirements. Direct bend/extension/trim/opening-resize work and sound
refinement remain in the full ledger.

Use the [independent testing prompt](wall-ivy-detail-test-prompt-2026-10-02.md)
for fresh inspection.
