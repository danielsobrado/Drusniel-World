import { planWorkshopComposition } from './ProceduralWorkshopComposition.js';

function staleError() {
  return new DOMException('A newer workshop plan replaced this result.', 'AbortError');
}

function disposedError() {
  return new DOMException('Workshop planner was disposed.', 'AbortError');
}

export class ProceduralWorkshopPlannerClient {
  constructor({ workerFactory } = {}) {
    this.revision = 0;
    this.pending = new Map();
    this.worker = null;
    this.disposed = false;
    if (workerFactory || typeof Worker !== 'undefined') {
      let worker = null;
      try {
        worker = workerFactory
          ? workerFactory()
          : new Worker(new URL('./ProceduralWorkshopPlanner.worker.js', import.meta.url), {
            type: 'module',
          });
        if (!worker || typeof worker.addEventListener !== 'function') {
          throw new Error('Workshop planner worker factory returned an invalid worker.');
        }
        worker.addEventListener('message', ({ data }) => {
          if (!this.disposed && this.worker === worker) this.receive(data);
        });
        worker.addEventListener('messageerror', (event) => this.failWorker(
          worker, event, 'Workshop planning worker response could not be deserialized.',
        ));
        worker.addEventListener('error', (event) => this.failWorker(
          worker, event, 'Workshop planning worker failed.',
        ));
        this.worker = worker;
      } catch (error) {
        worker?.terminate?.();
        console.warn('Workshop planner worker is unavailable; planning will run on the main thread.', error);
      }
    }
  }

  plan(recipe, dirtyIds = []) {
    if (this.disposed) return Promise.reject(disposedError());
    const revision = ++this.revision;
    for (const [pendingRevision, pending] of this.pending) {
      if (pendingRevision < revision) {
        pending.reject(staleError());
        this.pending.delete(pendingRevision);
      }
    }
    if (!this.worker) {
      return Promise.resolve().then(() => {
        if (this.disposed) throw disposedError();
        if (revision !== this.revision) throw staleError();
        return planWorkshopComposition(recipe, dirtyIds);
      });
    }
    return new Promise((resolve, reject) => {
      this.pending.set(revision, { resolve, reject });
      try {
        this.worker.postMessage({ revision, recipe, dirtyIds });
      } catch (error) {
        this.pending.delete(revision);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  receive(data) {
    const { revision, plan, error } = data ?? {};
    const pending = this.pending.get(revision);
    if (!pending) return;
    this.pending.delete(revision);
    if (revision !== this.revision) {
      pending.reject(staleError());
    } else if (error) {
      pending.reject(new Error(error));
    } else if (!plan || typeof plan !== 'object') {
      pending.reject(new Error('Workshop planning worker returned an invalid plan.'));
    } else {
      pending.resolve(plan);
    }
  }

  failWorker(worker, event, fallbackMessage) {
    if (this.disposed || this.worker !== worker) return;
    event.preventDefault?.();
    worker.terminate();
    this.worker = null;
    this.failAll(new Error(event.message || fallbackMessage));
  }

  cancel() {
    this.revision += 1;
    this.failAll(staleError());
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(disposedError());
    this.worker?.terminate();
    this.worker = null;
  }
}
