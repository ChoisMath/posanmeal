import "client-only";
import type { Human, Config, FaceResult } from "@vladmandic/human";
import type { FaceBackend } from "@/lib/face-pacing";
import { FACE_MODEL_PATH } from "@/lib/face-constants";
import type { EnrollmentFaceGeometry } from "@/lib/face-quality";

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
    // FaceRes(description)는 나이·성별 헤드와 특징을 공유해 타인 간 유사도가 높다 → 식별은 insightface 전용
    description: { enabled: false },
    insightface: { enabled: true, modelPath: FACE_MODEL_PATH },
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  } as Partial<Config["face"]>,
  body: { enabled: false },
  hand: { enabled: false },
  gesture: { enabled: false },
};

const LOAD_TIMEOUT_MS = 90_000;
const DETECT_TIMEOUT_MS = 5_000;

let operationRunning = false;
const waitingOperations = new Set<() => void>();

function runNextOperation(): void {
  if (operationRunning) return;
  waitingOperations.values().next().value?.();
}

// Human 인스턴스가 달라도 TF와 얼굴 모델 상태를 공유한다. 호출자의 제한 시간이
// 끝나도 취소할 수 없는 원본 연산이 종료되기 전에는 다음 연산을 시작할 수 없다.
function runExclusive<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let pending = true;
    const finish = (settle: () => void) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      waitingOperations.delete(start);
      settle();
    };
    const abort = () => finish(() => reject(new DOMException("Face operation aborted", "AbortError")));
    const start = () => {
      waitingOperations.delete(start);
      operationRunning = true;
      const release = () => {
        operationRunning = false;
        runNextOperation();
      };
      Promise.resolve().then(() => pending ? operation() : undefined).then(
        (value) => {
          finish(() => resolve(value as T));
          release();
        },
        (error: unknown) => {
          finish(() => reject(error));
          release();
        },
      );
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`))),
      timeoutMs,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    waitingOperations.add(start);
    runNextOperation();
  });
}

// BASE_CONFIG에서 켠 파이프라인이 실제로 로드하는 Models 프로퍼티 이름
// (node_modules/@vladmandic/human/dist/human.esm.js Models.load() 기준 — 파일명(blazeface.json 등)과는
// 별개의 내부 키라 다를 수 있음. detector→blazeface, mesh→facemesh, insightface→insightface)
const REQUIRED_FACE_MODELS = ["blazeface", "facemesh", "insightface", "antispoof", "liveness"] as const;

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
          active = await runExclusive(async () => {
            active = null;
            const human = new mod.Human({ ...BASE_CONFIG, backend });
            await loadAndVerify(human);
            return { human, backend: actualBackend(human) };
          }, LOAD_TIMEOUT_MS, `human load (${backend})`);
          return active;
        } catch (err) {
          lastError = err;
          console.error(`human load failed on ${backend}:`, err);
        }
      }
      throw lastError ?? new Error("no face backend available");
    })
    .finally(() => {
      if (loading?.promise === promise) loading = null;
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
  geometry: EnrollmentFaceGeometry | null;
}

function toDetected(face: FaceResult, frame: { width: number; height: number }): DetectedFace | null {
  if (!face.embedding || face.embedding.length === 0) return null;
  const angle = face.rotation?.angle;
  const geometry = frame.width > 0 && frame.height > 0 && angle
    ? {
        frame,
        box: {
          x: face.box[0],
          y: face.box[1],
          width: face.box[2],
          height: face.box[3],
        },
        pose: { yaw: angle.yaw, pitch: angle.pitch, roll: angle.roll },
      }
    : null;
  return {
    embedding: Array.from(face.embedding),
    real: face.real ?? 0,
    live: face.live ?? 0,
    score: face.score ?? 0,
    geometry,
  };
}

export type DetectOutcome =
  | { kind: "face"; face: DetectedFace }
  | { kind: "none" }
  | { kind: "multiple" };

export function detectFaces(human: Human, video: HTMLVideoElement, signal?: AbortSignal): Promise<DetectOutcome> {
  return runExclusive(async () => {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return { kind: "none" };
    const frame = { width: video.videoWidth, height: video.videoHeight };
    const result = await human.detect(video);
    if (result.face.length === 0) return { kind: "none" };
    if (result.face.length > 1) return { kind: "multiple" };
    const face = toDetected(result.face[0], frame);
    return face ? { kind: "face", face } : { kind: "none" };
  }, DETECT_TIMEOUT_MS, "detect", signal);
}

export type QualityIssue = "spoof" | "lowScore" | null;

export function qualityIssue(face: DetectedFace): QualityIssue {
  if (face.real < FACE_QUALITY.minReal || face.live < FACE_QUALITY.minLive) return "spoof";
  if (face.score < FACE_QUALITY.minScore) return "lowScore";
  return null;
}
