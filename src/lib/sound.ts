let ctx: AudioContext | null = null;

/** Create (or resume) the audio context. Must be called from a user gesture at least once. */
export function primeAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Two short rising tones; no audio asset required. */
export function playAlertSound(): void {
  if (!ctx) primeAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [offset, freq] of [
    [0, 880],
    [0.16, 1320],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.15);
  }
}
