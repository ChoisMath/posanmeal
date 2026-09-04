let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

interface Tone {
  freq: number;
  type: OscillatorType;
  start: number;
  duration: number;
  peak: number;
}

// 짧은 어택/릴리즈 램프로 클릭 잡음 없이 최대 음량에 가깝게 재생
function play(tones: Tone[]) {
  try {
    const ctx = getAudioCtx();
    for (const t of tones) {
      const t0 = ctx.currentTime + t.start;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(t.peak, t0 + 0.01);
      gain.gain.setValueAtTime(t.peak, t0 + t.duration - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.duration);
      const osc = ctx.createOscillator();
      osc.type = t.type;
      osc.frequency.value = t.freq;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + t.duration);
    }
  } catch {}
}

/** 정상 체크인 — 상승 2음 */
export function playSuccess() {
  play([
    { freq: 880, type: "triangle", start: 0, duration: 0.14, peak: 1 },
    { freq: 1175, type: "triangle", start: 0.15, duration: 0.3, peak: 1 },
  ]);
}

/** 이미 체크인 — 하강 2음, 다른 음색 */
export function playDuplicate() {
  play([
    { freq: 1047, type: "square", start: 0, duration: 0.16, peak: 0.6 },
    { freq: 784, type: "square", start: 0.18, duration: 0.3, peak: 0.6 },
  ]);
}

/** 미신청 — 저음 버저 */
export function playDenied() {
  play([
    { freq: 200, type: "sawtooth", start: 0, duration: 0.7, peak: 0.55 },
    { freq: 150, type: "sawtooth", start: 0, duration: 0.7, peak: 0.4 },
  ]);
}

/** 기타 오류 — 고음 3연타 */
export function playError() {
  play([0, 0.14, 0.28].map((start) => ({ freq: 1568, type: "square" as const, start, duration: 0.09, peak: 0.5 })));
}

/** 처리 중 재스캔 무시 (짧은 클릭) */
export function playLockClick() {
  play([{ freq: 280, type: "sine", start: 0, duration: 0.08, peak: 0.35 }]);
}
