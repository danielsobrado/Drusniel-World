import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { renderOutput } from 'three/tsl';

/**
 * Finishes a post pipeline's output, with FXAA when asked.
 *
 * The god-rays pipelines are the walking view's whole post chain — they return
 * before the post-processing graph, so its temporal AA never runs there — and MSAA
 * stays off (renderer.antialias in editor.config.yaml: materials that sample the
 * depth texture fail validation against a multisampled target). FXAA is the edge
 * filter that fits: one full-screen pass over the finished image, no depth, no
 * history, and it softens exactly what aliases worst while walking — grass blades
 * and card cut-outs against the sky.
 *
 * FXAA works on display-space colour, so the pipeline's automatic tone mapping and
 * output transform are turned off and applied explicitly first.
 *
 * @param {import('three/webgpu').RenderPipeline} pipeline
 * @param {object} composite the scene-referred output node
 * @param {{ fxaa?: boolean }} [options]
 */
export function setPipelineOutput(pipeline, composite, { fxaa: antialias = true } = {}) {
  if (!antialias) {
    pipeline.outputNode = composite;
    return pipeline;
  }
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(renderOutput(composite));
  return pipeline;
}
