import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPerfQaTimeoutMs } from '../scripts/lib/perf-qa-timeout.mjs';

test('performance runner allows the full default settle window before timing out', () => {
  const query = 'qa=chunk-cross&warmup=8&duration=12&settle=1';
  assert.equal(defaultPerfQaTimeoutMs(query), 230000);
});

test('performance runner allows a custom settle window only when settle is enabled', () => {
  const query = 'qa=chunk-cross&warmup=8&duration=12&settleTimeout=240';
  assert.equal(defaultPerfQaTimeoutMs(`${query}&settle=1`), 350000);
  assert.equal(defaultPerfQaTimeoutMs(query), 110000);
  assert.equal(defaultPerfQaTimeoutMs(`${query}&settle=false`), 110000);
});

test('performance timeout uses the same normalized timing values as the browser', () => {
  assert.equal(defaultPerfQaTimeoutMs('qa=move&warmup=-1&duration=0&settle=1&settleTimeout=0'), 91500);
  assert.equal(defaultPerfQaTimeoutMs('qa=move&warmup=bad&duration=bad&settle=1&settleTimeout=bad'), 224000);
});
