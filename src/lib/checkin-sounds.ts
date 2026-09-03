// AudioContext singleton
let _audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

export function playChime() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.4;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 523;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 659;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.18);
    osc2.stop(ctx.currentTime + 0.38);
  } catch {}
}

export function playLongBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.6;
    const osc = ctx.createOscillator();
    osc.frequency.value = 400;
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  } catch {}
}

export function playDoubleBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.5;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 500;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 500;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.35);
    osc2.stop(ctx.currentTime + 0.55);
  } catch {}
}
