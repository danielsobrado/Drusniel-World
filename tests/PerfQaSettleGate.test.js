import assert from 'node:assert/strict';
import test from 'node:test';
import { PerfQaSettleGate } from '../src/editor/performance/qa/PerfQaSettleGate.js';
import { createMovementPlan, parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

const ready = { collision: true, streaming: true, construction: true };

test('the gate settles only after every check holds for the required frames', () => {
  const gate = new PerfQaSettleGate({ requiredFrames: 3, timeoutSeconds: 60 });
  assert.equal(gate.update(ready, 0), 'waiting');
  assert.equal(gate.update(ready, 0.1), 'waiting');
  assert.equal(gate.update({ ...ready, streaming: false }, 0.2), 'waiting', 'a relapse restarts the streak');
  assert.deepEqual(gate.blockers, ['streaming']);
  assert.equal(gate.update(ready, 0.3), 'waiting');
  assert.equal(gate.update(ready, 0.4), 'waiting');
  assert.equal(gate.update(ready, 0.5), 'settled');
});

test('the gate gives up after its timeout and names what it was waiting for', () => {
  const gate = new PerfQaSettleGate({ requiredFrames: 3, timeoutSeconds: 2 });
  assert.equal(gate.update({ ...ready, collision: false }, 1), 'waiting');
  assert.equal(gate.update({ ...ready, collision: false }, 2), 'timeout');
  assert.deepEqual(gate.blockers, ['collision']);
});

test('settling is opt-in and only the timed warmup waits on it', () => {
  const plain = createMovementPlan(parseQaParams('?qa=construction-ring'));
  assert.equal(plain.settle, false);
  assert.equal(plain.phases[0].settle, false);

  const settled = createMovementPlan(parseQaParams('?qa=construction-ring&settle=1&settleTimeout=90'));
  assert.equal(settled.settle, true);
  assert.equal(settled.settleTimeoutSeconds, 90);
  assert.equal(settled.phases[0].id, 'warmup');
  assert.equal(settled.phases[0].settle, true);
  assert.notEqual(settled.phases[1].settle, true, 'the measured phase never waits');
});
