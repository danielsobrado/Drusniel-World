import { audioBus } from '../audio/audio_bus.js';

const isConstruction = entry => entry?.kind === 'construction' || entry?.kind === 'construction-batch';

/** Gesture feedback is driven by travel, never by render frames or rebuilds. */
export class ConstructionEditAudio {
  constructor({ emit = (id) => audioBus.emitAudio(id), now = () => performance.now() } = {}) {
    this.emit = emit;
    this.now = now;
    this.gesture = null;
  }

  begin(kind, point) {
    this.gesture = { kind, point: point && { ...point }, time: this.now() - 120 };
  }

  move(point) {
    const gesture = this.gesture;
    if (!gesture || !point) return;
    if (!gesture.point) { gesture.point = { ...point }; return; }
    const distance = Math.hypot(point.x - gesture.point.x, (point.y ?? 0) - (gesture.point.y ?? 0),
      point.z - gesture.point.z);
    const time = this.now();
    if (distance < 0.16 || time - gesture.time < 120) return;
    gesture.point = { ...point };
    gesture.time = time;
    this.emit(`construction.${gesture.kind}`);
  }

  end() { this.gesture = null; }

  commit(entry) {
    if (!isConstruction(entry)) return;
    if (entry.kind === 'construction-batch') this.emit('construction.place');
    else if (!entry.after) this.emit('construction.remove');
    else this.emit('construction.place');
  }

  history(entry, direction) {
    this.end();
    if (isConstruction(entry)) this.emit(`construction.${direction}`);
  }
}
