/**
 * Dry, short stone impacts and grit made from the existing noise buffer.
 * No oscillators, loops, downloads or additional AudioContexts. The envelopes
 * have soft attacks; each layer disconnects when finished, including on cancel
 * (gestures stop scheduling and the last grain decays within 160 ms).
 */
export function playStoneSound(ctx, destination, buffer, kind, volume, duration) {
  if (!ctx || !destination || !buffer || !(volume > 0)) return;
  const scrape = kind === 'move' || kind === 'cut';
  const settle = kind === 'place' || kind === 'redo';
  const layers = scrape
    ? [[0, 900, 0.45, 'bandpass'], [0.018, 2300, 0.14, 'highpass']]
    : [[0, settle ? 480 : 640, 0.8, 'lowpass'], [0.025, 1900, 0.25, 'bandpass'],
      [settle ? 0.07 : 0.04, 1100, 0.16, 'bandpass']];
  for (const [delay, frequency, gain, filterType] of layers) {
    const start = ctx.currentTime + delay;
    const length = Math.max(0.025, Math.min(0.14, duration));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency * (0.9 + Math.random() * 0.2);
    filter.Q.value = 0.7;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume * gain, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    envelope.gain.linearRampToValueAtTime(0, start + length + 0.005);
    source.connect(filter).connect(envelope).connect(destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    source.start(start, Math.random() * 0.5);
    source.stop(start + length + 0.006);
  }
}
