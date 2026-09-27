/**
 * Recorded sounds from the CC0 bank (public/audio/cc0, see its CATALOG.md).
 *
 * Buffers are fetched and decoded on first use and cached. A sound asked for
 * before its buffer is ready is not queued; the caller falls back (the
 * procedural synth for events), so nothing ever plays late and out of step.
 */

export const SAMPLE_BANK_ROOT = 'audio/cc0/';

export class SampleBank {
  /**
   * @param {object} options
   * @param {() => AudioContext | null} options.getContext
   * @param {() => AudioNode | null} options.getDestination
   * @param {string} [options.baseUrl] site base, `import.meta.env.BASE_URL` in the app
   * @param {(url: string) => Promise<ArrayBuffer>} [options.fetchBytes]
   */
  constructor({ getContext, getDestination, baseUrl = '/', fetchBytes = null }) {
    this.getContext = getContext;
    this.getDestination = getDestination;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchBytes = fetchBytes ?? (async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio sample ${url} failed to load (${response.status}).`);
      return response.arrayBuffer();
    });
    this.buffers = new Map();
    this.pending = new Map();
    this.failed = new Set();
  }

  url(path) {
    return `${this.baseUrl}${SAMPLE_BANK_ROOT}${path}`;
  }

  /** The decoded buffer, or null — and start loading it if it is not. */
  get(path) {
    const buffer = this.buffers.get(path);
    if (buffer) return buffer;
    this.load(path);
    return null;
  }

  load(path) {
    if (this.buffers.has(path)) return Promise.resolve(this.buffers.get(path));
    if (this.pending.has(path)) return this.pending.get(path);
    if (this.failed.has(path)) return Promise.resolve(null);
    const context = this.getContext();
    if (!context) return Promise.resolve(null);
    const promise = this.fetchBytes(this.url(path))
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        this.buffers.set(path, buffer);
        return buffer;
      })
      .catch((error) => {
        this.failed.add(path);
        console.warn(`[audio] ${error.message ?? error}`);
        return null;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, promise);
    return promise;
  }

  /**
   * Play a one-shot now if its buffer is ready.
   *
   * @returns {boolean} whether it played
   */
  play(path, { volume = 1, rate = 1, pan = 0, destination = null } = {}) {
    const context = this.getContext();
    const target = destination ?? this.getDestination();
    const buffer = this.get(path);
    if (!context || !target || !buffer) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = volume;
    let tail = gain;
    if (pan !== 0 && typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      tail = panner;
    }
    source.connect(gain);
    tail.connect(target);
    source.start();
    return true;
  }

  /**
   * A looping voice with its own gain, silent until raised. Null until the
   * buffer is ready; ask again next frame.
   */
  loop(path, destination = null) {
    const context = this.getContext();
    const target = destination ?? this.getDestination();
    const buffer = this.get(path);
    if (!context || !target || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(target);
    source.start(0, Math.random() * buffer.duration);
    return { source, gain };
  }
}
