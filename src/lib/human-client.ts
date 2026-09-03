import "client-only";
import type { Human, Config, FaceResult } from "@vladmandic/human";

export const FACE_QUALITY = { minScore: 0.7, minReal: 0.5, minLive: 0.5 };

const FACE_CONFIG: Partial<Config> = {
  modelBasePath: "/models/",
  backend: "webgl",
  cacheSensitivity: 0,
  filter: { enabled: true, equalization: true },
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 2 },
    mesh: { enabled: true },
    iris: { enabled: false },
    description: { enabled: true },
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  },
  body: { enabled: false },
  hand: { enabled: false },
  gesture: { enabled: false },
};

const LOAD_TIMEOUT_MS = 90_000;
const DETECT_TIMEOUT_MS = 5_000;

// FACE_CONFIG에서 켠 파이프라인이 실제로 로드하는 Models 프로퍼티 이름
// (node_modules/@vladmandic/human/dist/human.esm.js Models.load() 기준 — 파일명(blazeface.json 등)과는
// 별개의 내부 키라 다를 수 있음. detector→blazeface, mesh→facemesh, description→faceres)
const REQUIRED_FACE_MODELS = ["blazeface", "facemesh", "faceres", "antispoof", "liveness"] as const;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function loadAndVerify(human: Human): Promise<void> {
  await human.load();
  const loaded = human.models.loaded();
  const missing = REQUIRED_FACE_MODELS.filter((m) => !loaded.includes(m));
  if (missing.length > 0) {
    throw new Error("face models failed to load: " + missing.join(", "));
  }
  await human.warmup();
}

let humanPromise: Promise<Human> | null = null;

export function loadHuman(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = import("@vladmandic/human")
      .then(async (mod) => {
        const human = new mod.Human(FACE_CONFIG);
        await withTimeout(loadAndVerify(human), LOAD_TIMEOUT_MS, "human load");
        return human;
      })
      .catch((err) => {
        humanPromise = null;
        throw err;
      });
  }
  return humanPromise;
}

export interface DetectedFace {
  embedding: number[];
  real: number;
  live: number;
  score: number;
}

function toDetected(face: FaceResult): DetectedFace | null {
  if (!face.embedding || face.embedding.length === 0) return null;
  return {
    embedding: Array.from(face.embedding),
    real: face.real ?? 0,
    live: face.live ?? 0,
    score: face.score ?? 0,
  };
}

export type DetectOutcome =
  | { kind: "face"; face: DetectedFace }
  | { kind: "none" }
  | { kind: "multiple" };

export async function detectFaces(human: Human, video: HTMLVideoElement): Promise<DetectOutcome> {
  const result = await withTimeout(human.detect(video), DETECT_TIMEOUT_MS, "detect");
  if (result.face.length === 0) return { kind: "none" };
  if (result.face.length > 1) return { kind: "multiple" };
  const face = toDetected(result.face[0]);
  return face ? { kind: "face", face } : { kind: "none" };
}

export type QualityIssue = "spoof" | "lowScore" | null;

export function qualityIssue(face: DetectedFace): QualityIssue {
  if (face.real < FACE_QUALITY.minReal || face.live < FACE_QUALITY.minLive) return "spoof";
  if (face.score < FACE_QUALITY.minScore) return "lowScore";
  return null;
}
