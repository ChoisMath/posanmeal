import "client-only";
import type { Human, Config, FaceResult } from "@vladmandic/human";
import type { FaceBackend } from "@/lib/face-pacing";

export const FACE_QUALITY = { minScore: 0.7, minReal: 0.5, minLive: 0.5 };

// 임베딩에 영향을 주는 단계(detector/mesh/rotation/equalization/cacheSensitivity)는
// 등록·인식 일관성을 위해 백엔드와 무관하게 고정한다.
const BASE_CONFIG: Partial<Config> = {
  modelBasePath: "/models/",
  cacheSensitivity: 0,
  warmup: "face",
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

interface LoadedHuman {
  human: Human;
  backend: FaceBackend;
}

let active: LoadedHuman | null = null;
let loading: { key: string; promise: Promise<LoadedHuman> } | null = null;

// Human은 webgpu 요청이라도 미지원 환경이면 내부에서 webgl로 내리므로 실제 백엔드는 tf에서 읽는다.
function actualBackend(human: Human): FaceBackend {
  return human.tf.getBackend() === "webgpu" ? "webgpu" : "webgl";
}

// 후보를 순서대로 시도해 load+warmup까지 성공한 첫 백엔드를 채택한다.
// 이미 채택된 백엔드가 후보에 포함되면 재사용한다(기본 후보는 등록 화면 호환용 webgl).
export function loadHuman(candidates: FaceBackend[] = ["webgl"]): Promise<Human> {
  if (active && candidates.includes(active.backend)) return Promise.resolve(active.human);
  const key = candidates.join(">");
  if (loading && loading.key === key) return loading.promise.then((l) => l.human);

  const promise = import("@vladmandic/human")
    .then(async (mod) => {
      let lastError: unknown = null;
      for (const backend of candidates) {
        try {
          const human = new mod.Human({ ...BASE_CONFIG, backend });
          await withTimeout(loadAndVerify(human), LOAD_TIMEOUT_MS, `human load (${backend})`);
          active = { human, backend: actualBackend(human) };
          return active;
        } catch (err) {
          lastError = err;
          console.error(`human load failed on ${backend}:`, err);
        }
      }
      throw lastError ?? new Error("no face backend available");
    })
    .finally(() => {
      if (loading?.key === key) loading = null;
    });
  loading = { key, promise };
  return promise.then((l) => l.human);
}

export function getActiveFaceBackend(): FaceBackend | null {
  return active?.backend ?? null;
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
