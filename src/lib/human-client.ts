import type { Human, Config, FaceResult } from "@vladmandic/human";

export const FACE_QUALITY = { minScore: 0.7, minReal: 0.5, minLive: 0.5 };

const FACE_CONFIG: Partial<Config> = {
  modelBasePath: "/models/",
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

let humanPromise: Promise<Human> | null = null;

export function loadHuman(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = import("@vladmandic/human").then(async (mod) => {
      const human = new mod.Human(FACE_CONFIG);
      await human.load();
      await human.warmup();
      return human;
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

export async function detectSingleFace(
  human: Human,
  video: HTMLVideoElement,
): Promise<DetectedFace | null> {
  const result = await human.detect(video);
  if (result.face.length !== 1) return null;
  return toDetected(result.face[0]);
}

export function isQualityFace(face: DetectedFace): boolean {
  return (
    face.score >= FACE_QUALITY.minScore &&
    face.real >= FACE_QUALITY.minReal &&
    face.live >= FACE_QUALITY.minLive
  );
}
