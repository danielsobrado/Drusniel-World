import { parseQaParams } from '../../src/editor/performance/qa/parseQaParams.js';

/** Allow the browser's entire warmup/settle/measurement route plus startup. */
export function defaultPerfQaTimeoutMs(query) {
  const config = parseQaParams(query);
  if (!config) throw new Error('Performance QA timeout requires a QA scenario.');
  const settleSeconds = config.settle ? config.settleTimeoutSeconds : 0;
  return (config.warmupSeconds + settleSeconds + config.durationSeconds + 90) * 1000;
}
