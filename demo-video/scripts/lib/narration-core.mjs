import { createHash } from "node:crypto";

export const lineKey = (sceneId, index) => `${sceneId}-${index}`;

export const spokenText = (spoken, sceneId, index, line) => spoken?.[lineKey(sceneId, index)] ?? line;

// 숫자·영문은 Qwen3-TTS 가 한국어 문맥에서 잘못 읽는다("12시" → 사전 시험 실패). 음성용 읽기를 강제한다.
// 숫자·영문만 막던 때 "회차 × 과목" 의 × 가 빠져나가 "곱해핵사인" 으로 읽혔다(STT 유사도 0.917 이라
// 자동 검수도 못 잡았다). 그래서 막을 것을 열거하지 않고 읽을 수 있는 것만 허용한다 —
// 한글·공백과, 여섯 가이드가 실제로 쓰며 TTS 가 쉼으로 처리하는 마침표·쉼표·가운뎃점뿐이다.
const READABLE = /[가-힣\s.,·]/;
export const findUnreadable = (narration, spoken) =>
  narration.flatMap((scene) =>
    scene.lines
      .map((line, index) => ({ key: lineKey(scene.id, index), text: spokenText(spoken, scene.id, index, line) }))
      .filter(({ text }) => [...text].some((ch) => !READABLE.test(ch)))
      .map(({ key }) => key),
  );

export const countChars = (text) => text.replace(/\s/g, "").length;

export const checkSpeech = (text, speechSeconds, { minCps = 3.0, maxCps = 9.0, minSeconds = 0.6 } = {}) => {
  const cps = countChars(text) / speechSeconds;
  if (!(speechSeconds >= minSeconds)) return { ok: false, cps, reason: "too-short" };
  if (cps > maxCps) return { ok: false, cps, reason: "too-fast" };
  if (cps < minCps) return { ok: false, cps, reason: "too-slow" };
  return { ok: true, cps };
};

export const checkEnding = (rmsDb, { maxRmsDb = -60 } = {}) =>
  Number.isFinite(maxRmsDb) && maxRmsDb < 0 &&
  (rmsDb === -Infinity || (Number.isFinite(rmsDb) && rmsDb < 0 && rmsDb <= maxRmsDb));

export const sha1 = (text) => createHash("sha1").update(text).digest("hex");

export const isCached = (entry, { textHash, refHash, model, trailing, fade, processing }, mp3Exists) =>
  Boolean(
    entry && mp3Exists && entry.textHash === textHash && entry.refHash === refHash && entry.model === model &&
      entry.trailing === trailing && entry.fade === fade && entry.processing === processing &&
      typeof fade === "number" && typeof processing === "string",
  );

export const estimateSeconds = (text, trailingSeconds, fadeSeconds = 0.35) =>
  Number((countChars(text) / 5.8 + trailingSeconds + fadeSeconds).toFixed(3));

export const audioEndingFilter = (speechSeconds, trailingSeconds = 1, fadeSeconds = 0.35) => {
  if (!Number.isFinite(speechSeconds) || speechSeconds < 0 ||
      !Number.isFinite(trailingSeconds) || trailingSeconds < 0 ||
      !Number.isFinite(fadeSeconds) || fadeSeconds <= 0) {
    throw new Error("invalid narration ending duration");
  }
  const fadeStart = Number((speechSeconds + trailingSeconds).toFixed(6));
  const duration = Number((fadeStart + fadeSeconds).toFixed(6));
  return `apad=whole_dur=${duration},atrim=duration=${duration},afade=t=out:st=${fadeStart}:d=${fadeSeconds}:curve=hsin`;
};

export const parseOnly = (value) =>
  value ? new Set(value.split(",").map((key) => key.trim()).filter(Boolean)) : null;

export const unknownKeys = (only, narration) => {
  if (!only) return [];
  const known = new Set(narration.flatMap((scene) => scene.lines.map((_, index) => lineKey(scene.id, index))));
  return [...only].filter((key) => !known.has(key));
};

// 이번 실행에서 만든 문장만이 아니라, 전사가 한 번도 안 된 문장(--no-check 로 만든 것 등)도 검수한다
export const sttTargets = (lines, manifest, hasWav) =>
  lines.filter((l) => manifest[l.key] && manifest[l.key].similarity === undefined && hasWav(l.key));

export const reviewFlag = (entry) => {
  if (entry?.similarity === undefined) return "NOCHECK";
  return entry.similarity < 0.8 ? "CHECK" : "";
};

// mlx-audio 가 모델 로드 중 stdout 에 진행 문구를 찍으므로 JSON 객체 줄만 고른다
export const parseJsonLines = (stdout) =>
  stdout.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return [];
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [];
    }
  });

export const mergeStt = (manifest, rows) => {
  for (const row of rows) {
    if (typeof row.key !== "string" || !manifest[row.key]) continue;
    Object.assign(manifest[row.key], { transcript: row.transcript, similarity: row.similarity });
  }
  return manifest;
};
