import assert from 'node:assert/strict';
import test from 'node:test';
import { vec2, vec3 } from 'three/tsl';
import { applyHandoff } from '../src/editor/stylized/meadow/meadowFade.js';

// Evaluate the actual mask graph at a fixed distance and screen-noise value.
// This reaches applyHandoff's material assignment, not a parallel CPU formula.
function evaluate(node, distance, noise) {
  if (node.isVarNode || node.isConvertNode) return evaluate(node.node, distance, noise);
  if (node.isConstNode || node.isUniformNode) return node.value;
  if (node.isSplitNode) return evaluate(node.node, distance, noise)[node.components];
  if (node.isShaderCallNodeInternal) return noise;
  if (node.isMathNode) {
    if (node.method === 'length') return distance;
    const a = evaluate(node.aNode, distance, noise);
    if (node.method === 'oneMinus') return 1 - a;
    if (node.method === 'smoothstep') {
      const b = evaluate(node.bNode, distance, noise);
      const c = evaluate(node.cNode, distance, noise);
      const t = Math.max(0, Math.min(1, (c - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }
  }
  if (node.isOperatorNode) {
    const a = evaluate(node.aNode, distance, noise);
    const b = evaluate(node.bNode, distance, noise);
    switch (node.op) {
      case '*': return a * b;
      case '-': return a - b;
      case '<': return a < b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '&&': return a && b;
    }
  }
  throw new Error(`Unsupported mask node: ${node.constructor.name}:${node.method ?? node.op}`);
}

function mask(fadeIn, fadeOut) {
  const material = {};
  applyHandoff(material, { base: vec3(0), fadeIn, fadeOut });
  return material.maskNode;
}

test('blade and card handoff masks partition every pixel without gaps or double coverage', () => {
  const handoff = vec2(40, 50);
  const blades = mask(null, handoff);
  const cards = mask(handoff, vec2(162, 180));
  for (const distance of [39, 40, 41, 43, 45, 47, 49, 50, 51]) {
    for (let sample = 0; sample < 100; sample += 1) {
      const noise = sample / 100;
      assert.notEqual(evaluate(blades, distance, noise), evaluate(cards, distance, noise),
        `gap or overlap at distance ${distance}, noise ${noise}`);
    }
  }
});

test('far cards fade away completely and a lone blade layer keeps its ordinary dissolve', () => {
  const cards = mask(vec2(40, 50), vec2(162, 180));
  const blades = mask(null, vec2(40, 50));
  for (let sample = 0; sample < 100; sample += 1) {
    const noise = sample / 100;
    assert.equal(evaluate(cards, 39, noise), false);
    assert.equal(evaluate(cards, 100, noise), true);
    assert.equal(evaluate(cards, 180, noise), false);
    assert.equal(evaluate(blades, 39, noise), true);
    assert.equal(evaluate(blades, 50, noise), false);
  }
});
