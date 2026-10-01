# Stone close-up fidelity — October 1, 2026

The sandstone now has broad, quiet faces and uneven faceted bevels. Taller
whole blocks sit beside stacked thin inserts, and the exposed mortar is closer
to the stone's colour. This pass follows the earlier
[creation, manipulation and sound work](wall-detail-editing-audio-review-2026-10-01.md).

## Reference and changes

Compared directly with the local Tiny Glade close-ups `190121`, `190157` and
`190257` in [the reference folder](../reference/tiny-glade/). Their useful
details are broad flat faces, changing bevel widths, angular corner wear,
thin joints, and a mix of tall blocks and short stacked inserts.

- `StonePillowField` samples eight bevel widths and depths per face: four
  corners and four edge midpoints. Seed, stable stone index and face determine
  these values. Front and back have independent wear; dressings attenuate it.
- `PillowStoneOutline` adds an optional midpoint on each straight edge.
  Midpoints stay on the packed silhouette. Only their inward bevel changes,
  so wear cannot spread the wall's joints or cross its course boundaries.
- `PillowStoneRim` limits insets and depth on small units. A remaining corner
  arc prevents vertices from collapsing when a broad bevel meets a tight corner.
- Sandstone uses faceted material shading, much less bulge, and restrained
  bump/normal detail. Other palettes keep smooth shading. Both workshop and
  construction materials consume the shared surface setting.
- The sandstone base cell is now 0.40 m high and targets 0.46 m width.
  Its split probability is 0.48, with a 0.70 preference for horizontal pairs.
  Minimum dimensions still reject slivers. Other styles retain their existing
  choice of split axis.
- Mortar is a warmer, lighter sandstone colour. Its existing recess is retained
  so the backing stays behind protruding/recessed blocks.
- The appearance harness accepts `--zoom` and records the actual camera zoom.

The generated geometry remains derived from semantic authoring state. The
builder writes into the existing module batches; there are no stone objects,
extra draw calls, viewport texture nodes or persisted detail descriptors.

## Geometry and visual verification

- **2,937 tests passed** in the final full run. An earlier run reported a
  process-level failure for `ProceduralCastleWallBudget.test.js` without an
  assertion diagnostic; that file passed alone and the complete rerun passed.
- New coverage checks 120 small, thin and leaning units in both LOD bands:
  finite vertices, unit normals, packed bounds, outward triangles, and a closed
  surface with consistent edge winding. Other checks cover stable face wear,
  restrained dressings, matching outline samples across LODs, and split bounds.
- Production build and `git diff --check` passed. The build still reports the
  existing missing inventory images, thumbnail `WebGLRenderer` import, and
  bundle-size warnings.
- Ordinary near stones still use **96 triangles**, coarse stones **64**. One corner
  subdivision was exchanged for an edge midpoint. The 14 m straight fixture
  changed from **411 stones / 45,060 total triangles** to
  **317 stones / 34,908 total triangles**, with the same 144 growth leaves.
- Headed Chromium used `WebGPUBackend`. All appearance captures below completed
  without page errors. Actual PNGs were inspected, including neutral/warm close
  views, the reverse face, curved walls, opening profiles, and coarse geometry.

### Captures

Paths are relative to the repository root; `tmp` artifacts are local outputs.

| Evidence | Location |
| --- | --- |
| Before, fixed close camera at zoom 3 | `tmp/stone-detail-before/straight-neutral.png` |
| After, same camera and lighting | `tmp/stone-detail-close-final/straight-neutral.png` |
| Detailed zoom 5, neutral and warm | `tmp/stone-detail-after-v2/` |
| Nine scenes, neutral and warm | `tmp/stone-detail-scenes/` |
| Reverse close-ups | `tmp/stone-detail-back/` |
| Coarse straight/curve/tower/opening profiles | `tmp/stone-detail-coarse/` |
| Rounded fieldstone control | `tmp/stone-detail-rounded-control/` |
| Final full test log | `tmp/stone-detail-tests-final.log` |
| Production build log | `tmp/stone-detail-build.log` |

The earlier baseline command requested zoom 5 but the old dev server served the
fixture without that option. Its image is the original zoom 3 view. The final
zoom 3 capture is the valid camera-matched comparison; do not compare pixel
sizes against the zoom 5 detail capture.

## Performance evidence

Used headed Chromium on the NVIDIA hardware WebGPU adapter, separate frozen
production builds, and the documented `construction-ring` approach from
`x=0,z=-100,yaw=180`, with 40 s warmup, 12 s measurement and `--settle`.
All runs settled, retained complete frame buffers, ended with 96 resident wall
modules and an empty construction queue, and passed collision readiness/timing
with collision p95 of 0.1 ms.

| Run | Average FPS | Frame p95 | Hitch rate |
| --- | ---: | ---: | ---: |
| Original baseline | 60.42 | 33.30 ms | 5.27% |
| New stones | 48.74 | 36.76 ms | 10.00% |
| Baseline repeat | 48.24 | 48.24 ms | 12.04% |
| New stones repeat | 35.37 | 63.13 ms | 22.91% |

The new-build measurements are slower in both pairs. The baseline also varies
substantially, so these runs do not isolate the cause. **Performance acceptance
has not passed**: every run exceeds the 2% hitch target. End-of-run near residency
is zero; these results do not establish sustained close-up performance.

A separate same-scene material comparison alternated faceted and smooth shading
on identical geometry and waited for GPU completion. Across three samples each,
mean render-plus-completion time was about **3.43 ms faceted / 3.45 ms smooth**.
This did not reproduce the world-scale slowdown; it does not exonerate all of the
geometry/packing changes. Keep the full-world performance concern open.

Raw evidence: `tmp/stone-detail-perf-{before,after,before-repeat,after-repeat}.json`
and `tmp/stone-material-perf.json`. The temporary isolation script is
`tmp/stone-material-perf.mjs`; it does not change production settings.

## Remaining visual differences

The close-up stone shape is closer, but this is not full reference parity.
Caps and end dressings remain quite regular. The reference's warmer lighting,
soft shadows, richer ivy and ground vegetation are also significant parts of
its appearance. The neutral fixture still exposes shadow-map aliasing along
some top bevels at extreme magnification.

The existing coarse packer changes the stone layout and course count. Outline
samples now remain coherent for a given stone across LODs, but that does not
solve the larger packing change during a near/coarse transition. Preserve the
near arrangement when addressing that separate issue.

See the [independent testing prompt](wall-stone-fidelity-test-prompt-2026-10-01.md)
for reproducible commands and checks.
