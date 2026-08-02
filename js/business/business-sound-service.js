export function createBusinessSoundService({ audioContextFactory } = {}) {
  let muted = false;
  let context = null;
  return Object.freeze({
    get muted() { return muted; },
    setMuted(value) { muted = Boolean(value); return muted; },
    async playNewOrder() {
      if (muted) return false;
      const Factory = audioContextFactory || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Factory) return false;
      context ||= new Factory();
      if (context.state === 'suspended') await context.resume();
      const start = context.currentTime;
      for (const [index, frequency] of [880, 1175].entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + index * 0.16;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.18);
      }
      return true;
    },
  });
}
