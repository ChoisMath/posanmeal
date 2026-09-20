// 환경 점검용 최소 가이드. 원고 → 클론 음성 → 길이 JSON → 장면 → 렌더·스틸 파이프라인 전체를 짧게 한 번 통과시킨다.
export type SetupCheckSceneId = "Intro" | "Check";

export type NarrationScene = { id: SetupCheckSceneId; lines: string[] };

// 문장 사이 무음. narrate.mjs 와 timing.ts 가 같은 값을 써야 자막이 맞는다.
export const LINE_GAP_SECONDS = 0.2;

// 발음과 잔향을 먼저 보존하고, 쉬는 구간 뒤에 음량을 줄여 끝음절이 잘리지 않게 한다.
export const TRAILING_SILENCE_SECONDS = 1;
export const FADE_OUT_SECONDS = 0.35;

export const NARRATION: NarrationScene[] = [
  { id: "Intro", lines: ["PosanMeal 안내 영상 환경 점검입니다."] },
  { id: "Check", lines: [
    "점검 버튼을 누르면 목업 화면의 상태가 바뀝니다.",
    "목소리와 자막의 타이밍을 함께 확인해 주세요.",
  ] },
];

// 숫자·영문은 음성용 읽기를 따로 둔다(자막은 원고 표기).
export const SPOKEN: Record<string, string> = {
  "Intro-0": "포산밀 안내 영상 환경 점검입니다.",
};
