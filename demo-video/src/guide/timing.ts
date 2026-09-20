import { FPS } from "../theme";

export const LEAD_FRAMES = 15;
export const TAIL_FRAMES = 15;

export type SceneDurations = { total: number; lines: number[] };
export type Caption = { text: string; from: number; durationInFrames: number };
export type NarrationTable<Id extends string> = { id: Id; lines: string[] }[];

const frames = (seconds: number) => Math.round(seconds * FPS);

export const createTiming = <Id extends string>(
  narration: NarrationTable<Id>,
  table: Record<Id, SceneDurations>,
  lineGapSeconds: number,
) => {
  const sceneFrames = (id: Id) => LEAD_FRAMES + frames(table[id].total) + TAIL_FRAMES;

  const lineStart = (id: Id, n: number) => {
    const before = table[id].lines.slice(0, n).reduce((sum, seconds) => sum + seconds, 0);
    return LEAD_FRAMES + frames(before + lineGapSeconds * n);
  };

  const lineFrames = (id: Id, n: number) => frames(table[id].lines[n]);
  const lineEnd = (id: Id, n: number) => lineStart(id, n) + lineFrames(id, n);

  // 문장 n 안에서 비율 t(0~1) 위치의 프레임 — 화면 동작을 음성 길이에 맞춰 배치할 때 쓴다.
  const lineAt = (id: Id, n: number, t: number) => lineStart(id, n) + Math.round(lineFrames(id, n) * t);

  const captionsFor = (id: Id): Caption[] => {
    const scene = narration.find((s) => s.id === id);
    if (!scene) throw new Error(`narration missing: ${id}`);
    return scene.lines.map((text, n) => ({
      text,
      from: lineStart(id, n),
      // 다음 문장이 시작되기 직전까지 유지 (마지막 문장은 TAIL 포함). 마지막 문장은 반올림 때문에 장면을 1프레임
      // 넘을 수 있어, 장면 마지막 프레임에 흐린 자막이 남지 않도록 그 한 프레임 앞에서 끝낸다.
      durationInFrames:
        n < scene.lines.length - 1
          ? lineStart(id, n + 1) - lineStart(id, n)
          : Math.min(lineFrames(id, n) + TAIL_FRAMES, sceneFrames(id) - lineStart(id, n) - 1),
    }));
  };

  return { sceneFrames, lineStart, lineFrames, lineEnd, lineAt, captionsFor };
};
