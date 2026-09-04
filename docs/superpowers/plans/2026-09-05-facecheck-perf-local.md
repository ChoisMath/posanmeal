# 안면인식 2단계(고성능 기기·로컬 모드·결과 4색/사운드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/facecheck`를 고성능 기기에서 WebGPU·적응형 페이싱으로 빠르게 만들고, 로컬 운영 모드에서도 브라우저 매칭으로 동작시키며, `/facecheck`·`/check` 결과를 4색·4사운드로 구분한다.

**Architecture:** Human 파이프라인(모델·입력 단계)은 그대로 두고 로더가 백엔드 후보(`webgpu`→`webgl`)를 순서대로 시도한다. 로컬 모드는 `/api/sync/download?faces=1`로 임베딩을 IndexedDB에 내려받아 순수 함수 `findBestMatch`로 브라우저에서 매칭하고, API와 같은 모양의 결과를 돌려주는 로컬 판정 엔진을 페이지가 온라인 경로와 동일하게 처리한다. 결과 분류/색상/사운드는 공용 유틸로 두 페이지가 공유한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, @vladmandic/human 3.3.6, IndexedDB, Vitest 4, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-05-facecheck-perf-local-design.md`

## Global Constraints

- 임베딩 모델·입력 단계 불변: `detector.rotation:true`, `mesh.enabled:true`, `filter.equalization:true`, `cacheSensitivity:0`, `faceres` 1024차원 (`FACE_EMBEDDING_DIM`).
- `FaceEnroll`(등록)은 `webgl` 유지 → `loadHuman()` 기본 후보는 `["webgl"]`.
- 로컬 임베딩 보관: 서버 `operationMode === "online"` 확인 시 `clearFaceProfiles()`.
- 로컬 동기화 권한: 기존 `canWriteAdmin` 유지.
- 미신청 문구(온라인·로컬 동일): `` `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.` ``
- 색상: success `bg-emerald-500` / duplicate `bg-blue-500` / notApplicant `bg-red-500` / error `bg-orange-500`.
- 버튼·배지 라벨 `whitespace-nowrap`, 터치 타겟 44px 이상 (`min-h-11`).
- 테스트는 `src/lib/__tests__/*.test.ts` (vitest, node 환경). 게이트: `npm test` + `npm run build`.
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: 페이싱·백엔드 후보 순수 함수 — `src/lib/face-pacing.ts`

**Files:**
- Create: `src/lib/face-pacing.ts`
- Test: `src/lib/__tests__/face-pacing.test.ts`

**Interfaces:**
- Produces: `type FaceBackend = "webgpu" | "webgl"`, `resolveFaceBackends(override: string | null | undefined, hasWebGpu: boolean): FaceBackend[]`, `nextDetectDelay(lastDetectMs: number): number`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/face-pacing.test.ts
import { describe, expect, it } from "vitest";
import { nextDetectDelay, resolveFaceBackends } from "@/lib/face-pacing";

describe("resolveFaceBackends", () => {
  it("override webgl → webgl만", () => {
    expect(resolveFaceBackends("webgl", true)).toEqual(["webgl"]);
  });
  it("override webgpu → webgpu 후 webgl 폴백", () => {
    expect(resolveFaceBackends("webgpu", false)).toEqual(["webgpu", "webgl"]);
  });
  it("override 없음 + WebGPU 지원 → webgpu 우선", () => {
    expect(resolveFaceBackends(null, true)).toEqual(["webgpu", "webgl"]);
  });
  it("override 없음 + WebGPU 미지원 → webgl만", () => {
    expect(resolveFaceBackends(undefined, false)).toEqual(["webgl"]);
    expect(resolveFaceBackends("garbage", false)).toEqual(["webgl"]);
  });
});

describe("nextDetectDelay", () => {
  it("검출 시간의 1/3, 30~200ms 클램프", () => {
    expect(nextDetectDelay(0)).toBe(30);
    expect(nextDetectDelay(40)).toBe(30);
    expect(nextDetectDelay(300)).toBe(100);
    expect(nextDetectDelay(900)).toBe(200);
    expect(nextDetectDelay(5000)).toBe(200);
  });
  it("비정상 입력은 최소값", () => {
    expect(nextDetectDelay(Number.NaN)).toBe(30);
    expect(nextDetectDelay(-50)).toBe(30);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/face-pacing.test.ts` → "Cannot find module '@/lib/face-pacing'"

- [ ] **Step 3: 구현**

```ts
// src/lib/face-pacing.ts
export type FaceBackend = "webgpu" | "webgl";

export function resolveFaceBackends(
  override: string | null | undefined,
  hasWebGpu: boolean,
): FaceBackend[] {
  if (override === "webgl") return ["webgl"];
  if (override === "webgpu") return ["webgpu", "webgl"];
  return hasWebGpu ? ["webgpu", "webgl"] : ["webgl"];
}

const MIN_DETECT_GAP_MS = 30;
const MAX_DETECT_GAP_MS = 200;

// 직전 검출 시간에 비례해 UI에 양보할 시간. 빠른 기기는 거의 연속으로 돌고,
// 느린 기기는 검출 자체가 페이스를 제한하므로 상한만 둔다.
export function nextDetectDelay(lastDetectMs: number): number {
  if (!Number.isFinite(lastDetectMs) || lastDetectMs <= 0) return MIN_DETECT_GAP_MS;
  return Math.min(MAX_DETECT_GAP_MS, Math.max(MIN_DETECT_GAP_MS, lastDetectMs / 3));
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `git add src/lib/face-pacing.ts src/lib/__tests__/face-pacing.test.ts && git commit -m "feat(facecheck): 백엔드 후보 선택·적응형 검출 간격 순수 함수"`

---

### Task 2: Human 로더 — 백엔드 후보 순차 시도·폴백 — `src/lib/human-client.ts`

**Files:**
- Modify: `src/lib/human-client.ts` (전체)

**Interfaces:**
- Consumes: `FaceBackend` (Task 1)
- Produces: `loadHuman(candidates?: FaceBackend[]): Promise<Human>` (기본 `["webgl"]`), `getActiveFaceBackend(): FaceBackend | null`. 기존 `detectFaces`, `qualityIssue`, `FACE_QUALITY`, `withTimeout`, `DetectedFace`, `DetectOutcome`, `QualityIssue` 시그니처 불변.

- [ ] **Step 1: 로더 교체** — `FACE_CONFIG`에서 `backend` 제거하고 `warmup: "face"` 추가, 싱글턴을 후보 기반으로 변경:

```ts
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
const REQUIRED_FACE_MODELS = ["blazeface", "facemesh", "faceres", "antispoof", "liveness"] as const;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> { /* 기존 그대로 */ }

async function loadAndVerify(human: Human): Promise<void> { /* 기존 그대로 */ }

interface LoadedHuman { human: Human; backend: FaceBackend; }

let active: LoadedHuman | null = null;
let loading: { key: string; promise: Promise<LoadedHuman> } | null = null;

// Human은 webgpu 요청이라도 미지원 환경이면 내부에서 webgl로 내리므로 실제 백엔드는 tf에서 읽는다.
function actualBackend(human: Human): FaceBackend {
  return human.tf.getBackend() === "webgpu" ? "webgpu" : "webgl";
}

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

/* DetectedFace, toDetected, DetectOutcome, detectFaces, QualityIssue, qualityIssue — 기존 그대로 */
```

- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep human-client` → 출력 없음
- [ ] **Step 3: 커밋** — `git commit -am "feat(facecheck): Human 로더 백엔드 후보 순차 시도(webgpu→webgl)·warmup face"`

---

### Task 3: 결과 분류·색상 — `src/lib/checkin-result-style.ts`

**Files:**
- Create: `src/lib/checkin-result-style.ts`
- Test: `src/lib/__tests__/checkin-result-style.test.ts`

**Interfaces:**
- Produces: `type CheckInCategory = "success" | "duplicate" | "notApplicant" | "error"`, `resultCategory(r: { success: boolean; duplicate?: boolean; notApplicant?: boolean }): CheckInCategory`, `RESULT_BG_CLASS: Record<CheckInCategory, string>`, `RESULT_TEXT_CLASS: Record<CheckInCategory, string>`

- [ ] **Step 1: 테스트**

```ts
// src/lib/__tests__/checkin-result-style.test.ts
import { describe, expect, it } from "vitest";
import { RESULT_BG_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";

describe("resultCategory", () => {
  it("성공 → success", () => expect(resultCategory({ success: true })).toBe("success"));
  it("중복 → duplicate", () => expect(resultCategory({ success: false, duplicate: true })).toBe("duplicate"));
  it("미신청 → notApplicant", () => expect(resultCategory({ success: false, notApplicant: true })).toBe("notApplicant"));
  it("그 외 실패 → error", () => expect(resultCategory({ success: false })).toBe("error"));
});

describe("색상 매핑", () => {
  it("초록/파랑/빨강/주황", () => {
    expect(RESULT_BG_CLASS.success).toBe("bg-emerald-500");
    expect(RESULT_BG_CLASS.duplicate).toBe("bg-blue-500");
    expect(RESULT_BG_CLASS.notApplicant).toBe("bg-red-500");
    expect(RESULT_BG_CLASS.error).toBe("bg-orange-500");
    expect(RESULT_TEXT_CLASS.duplicate).toContain("text-blue-700");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/checkin-result-style.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/lib/checkin-result-style.ts
export type CheckInCategory = "success" | "duplicate" | "notApplicant" | "error";

export interface CategorizableResult {
  success: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
}

export function resultCategory(r: CategorizableResult): CheckInCategory {
  if (r.success) return "success";
  if (r.duplicate) return "duplicate";
  if (r.notApplicant) return "notApplicant";
  return "error";
}

export const RESULT_BG_CLASS: Record<CheckInCategory, string> = {
  success: "bg-emerald-500",
  duplicate: "bg-blue-500",
  notApplicant: "bg-red-500",
  error: "bg-orange-500",
};

export const RESULT_TEXT_CLASS: Record<CheckInCategory, string> = {
  success: "text-emerald-700 dark:text-emerald-300",
  duplicate: "text-blue-700 dark:text-blue-300",
  notApplicant: "text-red-700 dark:text-red-300",
  error: "text-orange-800 dark:text-orange-200",
};
```

- [ ] **Step 4: 통과 확인**, **Step 5: 커밋** — `git commit -m "feat(checkin): 결과 분류·4색 매핑 유틸"`

---

### Task 4: 사운드 4종 공용화 — `src/lib/checkin-sounds.ts` + `/check` 교체

**Files:**
- Modify: `src/lib/checkin-sounds.ts` (전체 교체)
- Modify: `src/app/check/page.tsx` — 인라인 사운드(`getAudioCtx`~`playLockClick`, 약 52~124행) 삭제 후 import, `bgClass`·카드 문구 색을 Task 3 매핑으로 교체

**Interfaces:**
- Produces: `playSuccess()`, `playDuplicate()`, `playDenied()`, `playError()`, `playLockClick()`. 기존 `playChime/playLongBeep/playDoubleBeep` 제거.

- [ ] **Step 1: 사운드 유틸 교체**

```ts
// src/lib/checkin-sounds.ts
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

interface Tone { freq: number; type: OscillatorType; start: number; duration: number; peak: number; }

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
```

- [ ] **Step 2: `/check` 교체**
  - 52~124행(`// AudioContext singleton` ~ `playLockClick` 끝) 삭제.
  - import 추가: `import { playDenied, playDuplicate, playError, playLockClick, playSuccess } from "@/lib/checkin-sounds";` 및 `import { RESULT_BG_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";`
  - 호출 치환: `playChime()`→`playSuccess()`; 중복(`json.duplicate`, `existing`) 경로의 `playLongBeep()`→`playDuplicate()`; 미신청(`notApplicant`) 경로의 `playLongBeep()`→`playDenied()`; 나머지 `playDoubleBeep()`→`playError()`. `handleOnlineScan`은 `if (json.success) playSuccess(); else if (json.duplicate) playDuplicate(); else if (json.notApplicant) playDenied(); else playError();`
  - `bgClass`: `const bgClass = result ? RESULT_BG_CLASS[resultCategory(result)] : "bg-background";`
  - 카드 문구: `result.duplicate` 문단 클래스 `text-red-700 dark:text-red-300` → `RESULT_TEXT_CLASS.duplicate`; `notApplicant` 문단 → `RESULT_TEXT_CLASS.notApplicant`; 기타 오류 문단 `text-amber-800 dark:text-amber-200` → `RESULT_TEXT_CLASS.error`; 성공 문단 → `RESULT_TEXT_CLASS.success`.
  - `CheckInResult` 타입은 이미 `notApplicant?: boolean` 포함 — 변경 없음.

- [ ] **Step 3: 확인** — `grep -n "playChime\|playLongBeep\|playDoubleBeep" src -r` → 없음(`/facecheck`는 Task 9에서 교체하므로 이 시점엔 남아 있음 — Task 9 완료 후 재확인). `npx tsc --noEmit` 오류 중 `check/page.tsx` 없음.
- [ ] **Step 4: 커밋** — `git commit -am "feat(checkin): 결과 4종 사운드 공용화 + /check 4색 적용"`

---

### Task 5: 미신청 문구 정정 — `/api/facecheck`

**Files:**
- Modify: `src/app/api/facecheck/route.ts` (notApplicant 응답 `error`)
- Test: `src/lib/__tests__/facecheck-route.test.ts` (108행 케이스에 문구 단언 추가)

- [ ] **Step 1: 테스트 단언 추가** — 108행 `it("학생 미자격 → notApplicant, 체크인 없음")` 안 `expect(body.notApplicant).toBe(true);` 뒤에:

```ts
    expect(body.error).toBe("오늘 석식 신청자가 아닙니다.");
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/facecheck-route.test.ts`
- [ ] **Step 3: 구현** — route.ts의 `error: "식사 신청 기간이 아닙니다."` → `` error: `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.`, `` (`MEAL_LABEL`은 이미 import됨)
- [ ] **Step 4: 통과 확인**, **Step 5: 커밋** — `git commit -am "fix(facecheck): 미신청 학생 안내 문구 정정"`

---

### Task 6: IndexedDB v5 — `faceProfiles` 스토어

**Files:**
- Modify: `src/lib/local-db.ts`

**Interfaces:**
- Produces: `interface LocalFaceProfile { userId: number; embeddings: number[][] }`, `replaceAllFaceProfiles(profiles: LocalFaceProfile[]): Promise<void>`, `getAllFaceProfiles(): Promise<LocalFaceProfile[]>`, `clearFaceProfiles(): Promise<void>`. `clearAllData()`가 `faceProfiles`도 비움.

- [ ] **Step 1: 스키마 상향**
  - `const DB_VERSION = 5; // v5: faceProfiles (로컬 모드 안면인식 후보)`
  - `onupgradeneeded` 끝에:
```ts
      if (!db.objectStoreNames.contains("faceProfiles")) {
        db.createObjectStore("faceProfiles", { keyPath: "userId" });
      }
```
  - 타입·함수 추가(체크인 섹션 뒤):
```ts
// --- Face Profiles (로컬 모드 안면인식 후보) ---

export interface LocalFaceProfile {
  userId: number;
  embeddings: number[][];
}

export async function replaceAllFaceProfiles(profiles: LocalFaceProfile[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readwrite");
    const store = tx.objectStore("faceProfiles");
    store.clear();
    for (const profile of profiles) store.put(profile);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllFaceProfiles(): Promise<LocalFaceProfile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readonly");
    const req = tx.objectStore("faceProfiles").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearFaceProfiles(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readwrite");
    tx.objectStore("faceProfiles").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```
  - `clearAllData`의 `storeNames`에 `"faceProfiles"` 추가.
- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit 2>&1 | grep local-db` → 없음
- [ ] **Step 3: 커밋** — `git commit -am "feat(local-db): v5 faceProfiles 스토어(로컬 모드 안면인식 후보)"`

---

### Task 7: `/api/sync/download?faces=1` — 임베딩·임계값 포함

**Files:**
- Modify: `src/app/api/sync/download/route.ts`
- Test: `src/lib/__tests__/sync-download.test.ts` (신규)

**Interfaces:**
- Produces: 응답에 `faces=1`일 때만 `faceProfiles: Array<{ userId: number; embeddings: number[][] }>`, `faceMatch: { threshold: number; margin: number }` 추가.

- [ ] **Step 1: 테스트**

```ts
// src/lib/__tests__/sync-download.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  canWriteAdmin: vi.fn(() => true),
  systemSettingFindMany: vi.fn(),
  userFindMany: vi.fn(),
  mealDateFindMany: vi.fn(),
  faceProfileFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ canWriteAdmin: mocks.canWriteAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findMany: mocks.systemSettingFindMany },
    user: { findMany: mocks.userFindMany },
    mealRegistrationMealDate: { findMany: mocks.mealDateFindMany },
    faceProfile: { findMany: mocks.faceProfileFindMany },
  },
}));

describe("/api/sync/download — faces=1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWriteAdmin.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: { adminLevel: "ADMIN" } });
    mocks.systemSettingFindMany.mockResolvedValue([
      { key: "operationMode", value: "local" },
      { key: "face_match_threshold", value: "0.6" },
    ]);
    mocks.userFindMany.mockResolvedValue([{ id: 1, name: "김학생", role: "STUDENT", grade: 1, classNum: 2, number: 3 }]);
    mocks.mealDateFindMany.mockResolvedValue([]);
    mocks.faceProfileFindMany.mockResolvedValue([{ userId: 1, embeddings: [[0.1, 0.2]] }]);
  });

  it("faces=1이면 faceProfiles·faceMatch 포함 (threshold는 설정값, margin은 기본값)", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    const body = await res.json();
    expect(body.faceProfiles).toEqual([{ userId: 1, embeddings: [[0.1, 0.2]] }]);
    expect(body.faceMatch).toEqual({ threshold: 0.6, margin: 0.05 });
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(1);
  });

  it("faces 없음 → faceProfiles 조회·포함 안 함 (기존 /check 페이로드 불변)", async () => {
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download"));
    const body = await res.json();
    expect(body.faceProfiles).toBeUndefined();
    expect(body.faceMatch).toBeUndefined();
    expect(mocks.faceProfileFindMany).not.toHaveBeenCalled();
    expect(body.users).toHaveLength(1);
  });

  it("권한 없음 → 403", async () => {
    mocks.canWriteAdmin.mockReturnValue(false);
    const { GET } = await import("@/app/api/sync/download/route");
    const res = await GET(new Request("http://localhost/api/sync/download?faces=1"));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/sync-download.test.ts` (GET이 request를 받지 않아 첫 케이스 실패)
- [ ] **Step 3: 구현**
  - 시그니처 `export async function GET(request: Request)`; `const includeFaces = new URL(request.url).searchParams.get("faces") === "1";`
  - `Promise.all`에 4번째 항목: `includeFaces ? prisma.faceProfile.findMany({ select: { userId: true, embeddings: true } }) : Promise.resolve(null)` → `faceProfiles`
  - import 추가: `import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD } from "@/lib/face-constants";`
  - 응답 객체 마지막에:
```ts
    ...(includeFaces && faceProfiles
      ? {
          faceProfiles: faceProfiles.map((p) => ({ userId: p.userId, embeddings: p.embeddings as number[][] })),
          faceMatch: {
            threshold: parseFloatOr(settingsMap.face_match_threshold, DEFAULT_FACE_MATCH_THRESHOLD),
            margin: parseFloatOr(settingsMap.face_match_margin, DEFAULT_FACE_MATCH_MARGIN),
          },
        }
      : {}),
```
  - 파일 하단 헬퍼:
```ts
function parseFloatOr(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
```
- [ ] **Step 4: 통과 확인**, **Step 5: 커밋** — `git commit -m "feat(sync): download?faces=1 — 로컬 모드용 얼굴 임베딩·임계값 포함"`

---

### Task 8: 로컬 판정 엔진 — `src/lib/facecheck-local.ts`

**Files:**
- Create: `src/lib/facecheck-local.ts`
- Test: `src/lib/__tests__/facecheck-local.test.ts`

**Interfaces:**
- Consumes: `findBestMatch`/`FaceCandidate` (`@/lib/face-match`), `resolveMealKindLocal`/`MealWindows`/`MealKind` (`@/lib/meal-kind-local`), `MEAL_LABEL` (`@/lib/meal-plan`), `LocalUser`/`LocalCheckIn` (`@/lib/local-db`)
- Produces:
```ts
export interface FaceCheckUser { id: number; name: string; role: string; grade?: number | null; classNum?: number | null; number?: number | null; photoUrl?: string | null; }
export interface FaceCheckResult { success: boolean; matched?: boolean; duplicate?: boolean; notApplicant?: boolean; needType?: boolean; error?: string; errorCode?: string; user?: FaceCheckUser; type?: string; checkedAt?: string; mealKind?: MealKind; }
export interface LocalFaceRepo { getUser(id: number): Promise<LocalUser | undefined>; getCheckIn(userId: number, date: string, mealKind: MealKind): Promise<LocalCheckIn | undefined>; isEligible(userId: number, date: string, mealKind: MealKind): Promise<boolean>; addCheckIn(checkin: Omit<LocalCheckIn, "id">): Promise<void>; }
export interface LocalFaceInput { embedding: ArrayLike<number>; candidates: FaceCandidate[]; faceMatch: { threshold: number; margin: number }; now: Date; mealWindows: MealWindows; type?: "WORK" | "PERSONAL"; }
export function localDateKey(now: Date): string;               // "YYYY-MM-DD" (기기 로컬 시간)
export function toFaceCandidates(profiles: { userId: number; embeddings: number[][] }[]): FaceCandidate[];
export async function runLocalFaceCheckIn(input: LocalFaceInput, repo: LocalFaceRepo): Promise<FaceCheckResult>;
```

- [ ] **Step 1: 테스트**

```ts
// src/lib/__tests__/facecheck-local.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { localDateKey, runLocalFaceCheckIn, toFaceCandidates, type LocalFaceRepo } from "@/lib/facecheck-local";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";

const WINDOWS = {
  breakfast: { start: "00:00", end: "00:00" },
  lunch: { start: "00:00", end: "00:00" },
  dinner: { start: "00:00", end: "23:59" },
};
const CLOSED = { breakfast: { start: "00:00", end: "00:00" }, lunch: { start: "00:00", end: "00:00" }, dinner: { start: "00:00", end: "00:00" } };
const FACE_MATCH = { threshold: 0.55, margin: 0.05 };
const NOW = new Date(2026, 8, 5, 17, 30); // 로컬 2026-09-05 17:30

const axis = (i: number) => Array.from({ length: 4 }, (_, k) => (k === i ? 1 : 0));
const CANDIDATES = toFaceCandidates([
  { userId: 1, embeddings: [axis(0)] },
  { userId: 9, embeddings: [axis(1)] },
]);

function makeRepo(users: LocalUser[], eligible = new Set<string>()) {
  const checkins: LocalCheckIn[] = [];
  const repo: LocalFaceRepo = {
    getUser: async (id) => users.find((u) => u.id === id),
    getCheckIn: async (userId, date, mealKind) => checkins.find((c) => c.userId === userId && c.date === date && c.mealKind === mealKind),
    isEligible: async (userId, date, mealKind) => eligible.has(`${userId}:${date}:${mealKind}`),
    addCheckIn: async (c) => { checkins.push({ ...c, id: checkins.length + 1 }); },
  };
  return { repo, checkins };
}

const STUDENT: LocalUser = { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7 };
const TEACHER: LocalUser = { id: 9, name: "박교사", role: "TEACHER" };

describe("localDateKey", () => {
  it("기기 로컬 날짜를 YYYY-MM-DD로", () => expect(localDateKey(NOW)).toBe("2026-09-05"));
});

describe("runLocalFaceCheckIn", () => {
  let ctx: ReturnType<typeof makeRepo>;
  beforeEach(() => { ctx = makeRepo([STUDENT, TEACHER], new Set(["1:2026-09-05:DINNER"])); });

  it("식사 시간 아님 → NO_MEAL_WINDOW", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: CLOSED }, ctx.repo);
    expect(r).toMatchObject({ success: false, errorCode: "NO_MEAL_WINDOW" });
  });

  it("미매칭 → matched:false, 저장 없음", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(3), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS }, ctx.repo);
    expect(r).toMatchObject({ success: false, matched: false });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("학생 정상 → 저장(synced:0, STUDENT) + success", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS }, ctx.repo);
    expect(r).toMatchObject({ success: true, matched: true, type: "STUDENT", mealKind: "DINNER", user: { id: 1, name: "김학생" } });
    expect(ctx.checkins[0]).toMatchObject({ userId: 1, date: "2026-09-05", mealKind: "DINNER", type: "STUDENT", synced: 0 });
  });

  it("학생 두 번째 → duplicate (서버와 같은 문구)", async () => {
    const input = { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS };
    await runLocalFaceCheckIn(input, ctx.repo);
    const r = await runLocalFaceCheckIn(input, ctx.repo);
    expect(r).toMatchObject({ success: false, duplicate: true, error: "이미 석식 체크인 하였습니다." });
    expect(r.checkedAt).toBeDefined();
    expect(ctx.checkins).toHaveLength(1);
  });

  it("학생 미신청 → notApplicant + 문구", async () => {
    const noEligible = makeRepo([STUDENT]);
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS }, noEligible.repo);
    expect(r).toMatchObject({ success: false, matched: true, notApplicant: true, error: "오늘 석식 신청자가 아닙니다." });
    expect(noEligible.checkins).toHaveLength(0);
  });

  it("교사 type 없음 → needType, 저장 없음", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(1), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS }, ctx.repo);
    expect(r).toMatchObject({ success: false, matched: true, needType: true, user: { id: 9 }, mealKind: "DINNER" });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("교사 type=WORK → 저장 + success", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(1), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, type: "WORK" }, ctx.repo);
    expect(r).toMatchObject({ success: true, type: "WORK" });
    expect(ctx.checkins[0]).toMatchObject({ userId: 9, type: "WORK", synced: 0 });
  });

  it("명단에 없는 매칭 → matched:false + 동기화 안내", async () => {
    const empty = makeRepo([]);
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS }, empty.repo);
    expect(r).toMatchObject({ success: false, matched: false });
    expect(r.error).toContain("동기화");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/facecheck-local.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/lib/facecheck-local.ts
import { findBestMatch, type FaceCandidate } from "@/lib/face-match";
import { resolveMealKindLocal, type MealKind, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";

export interface FaceCheckUser {
  id: number;
  name: string;
  role: string;
  grade?: number | null;
  classNum?: number | null;
  number?: number | null;
  photoUrl?: string | null;
}

// /api/facecheck 응답과 같은 모양 — 페이지가 온라인/로컬 결과를 동일하게 처리한다.
export interface FaceCheckResult {
  success: boolean;
  matched?: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  needType?: boolean;
  error?: string;
  errorCode?: string;
  user?: FaceCheckUser;
  type?: string;
  checkedAt?: string;
  mealKind?: MealKind;
}

export interface LocalFaceRepo {
  getUser(id: number): Promise<LocalUser | undefined>;
  getCheckIn(userId: number, date: string, mealKind: MealKind): Promise<LocalCheckIn | undefined>;
  isEligible(userId: number, date: string, mealKind: MealKind): Promise<boolean>;
  addCheckIn(checkin: Omit<LocalCheckIn, "id">): Promise<void>;
}

export interface LocalFaceInput {
  embedding: ArrayLike<number>;
  candidates: FaceCandidate[];
  faceMatch: { threshold: number; margin: number };
  now: Date;
  mealWindows: MealWindows;
  type?: "WORK" | "PERSONAL";
}

export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toFaceCandidates(profiles: { userId: number; embeddings: number[][] }[]): FaceCandidate[] {
  return profiles.map((p) => ({ userId: p.userId, embeddings: p.embeddings.map((e) => Float32Array.from(e)) }));
}

function toFaceUser(user: LocalUser): FaceCheckUser {
  return { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number };
}

export async function runLocalFaceCheckIn(input: LocalFaceInput, repo: LocalFaceRepo): Promise<FaceCheckResult> {
  const mealKind = resolveMealKindLocal(input.now, input.mealWindows);
  if (!mealKind) {
    return { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" };
  }
  const match = findBestMatch(input.embedding, input.candidates, input.faceMatch);
  if (!match) return { success: false, matched: false, error: "인식되지 않았습니다. 다시 서 주세요." };

  const user = await repo.getUser(match.userId);
  if (!user) return { success: false, matched: false, error: "명단에 없는 사용자입니다. 동기화가 필요합니다." };

  const date = localDateKey(input.now);
  const faceUser = toFaceUser(user);
  const existing = await repo.getCheckIn(user.id, date, mealKind);
  if (existing) {
    return {
      success: false, matched: true, duplicate: true, user: faceUser, mealKind,
      checkedAt: existing.checkedAt,
      error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
    };
  }

  let type: LocalCheckIn["type"];
  if (user.role === "TEACHER") {
    if (!input.type) return { success: false, matched: true, needType: true, user: faceUser, mealKind };
    type = input.type;
  } else {
    const eligible = await repo.isEligible(user.id, date, mealKind);
    if (!eligible) {
      return {
        success: false, matched: true, notApplicant: true, user: faceUser, mealKind,
        error: `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.`,
      };
    }
    type = "STUDENT";
  }

  const checkedAt = input.now.toISOString();
  await repo.addCheckIn({ userId: user.id, date, mealKind, checkedAt, type, synced: 0 });
  return { success: true, matched: true, user: faceUser, type, mealKind, checkedAt };
}
```

- [ ] **Step 4: 통과 확인**, **Step 5: 커밋** — `git commit -m "feat(facecheck): 로컬 모드 판정 엔진(브라우저 매칭·중복·자격·저장)"`

---

### Task 9: 키오스크 동기화·설정 — `src/lib/kiosk-sync.ts`

**Files:**
- Create: `src/lib/kiosk-sync.ts`

**Interfaces:**
- Consumes: `local-db` (`getUnsyncedCheckIns`, `markCheckInsSynced`, `replaceAllUsers`, `replaceAllEligibleEntries`, `replaceAllFaceProfiles`, `clearFaceProfiles`, `getSetting`, `setSetting`), `DEFAULT_MEAL_WINDOWS`/`MealWindows` (`meal-kind-local`), `DEFAULT_FACE_MATCH_*` (`face-constants`)
- Produces:
```ts
export type OperationMode = "online" | "local";
export interface KioskSettings { operationMode: OperationMode; mealWindows: MealWindows; faceMatch: { threshold: number; margin: number }; }
export async function fetchKioskSettings(): Promise<KioskSettings | null>;   // GET /api/system/settings → IDB 저장. 오프라인/실패 시 null
export async function loadSavedKioskSettings(): Promise<KioskSettings>;      // IDB → 없으면 기본값(online, DEFAULT_MEAL_WINDOWS, DEFAULT_FACE_MATCH_*)
export interface KioskSyncOutcome { ok: boolean; message: string; operationMode?: OperationMode; rejectedCount: number; }
export async function performKioskSync(): Promise<KioskSyncOutcome>;
```

- [ ] **Step 1: 구현**

```ts
// src/lib/kiosk-sync.ts
import {
  clearFaceProfiles, getSetting, getUnsyncedCheckIns, markCheckInsSynced,
  replaceAllEligibleEntries, replaceAllFaceProfiles, replaceAllUsers, setSetting,
  type LocalEligibleEntry, type LocalFaceProfile, type LocalUser,
} from "@/lib/local-db";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind-local";
import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD } from "@/lib/face-constants";

export type OperationMode = "online" | "local";

export interface KioskSettings {
  operationMode: OperationMode;
  mealWindows: MealWindows;
  faceMatch: { threshold: number; margin: number };
}

const DEFAULT_FACE_MATCH = { threshold: DEFAULT_FACE_MATCH_THRESHOLD, margin: DEFAULT_FACE_MATCH_MARGIN };

function toMode(value: unknown): OperationMode {
  return value === "local" ? "local" : "online";
}

async function saveSettings(s: KioskSettings): Promise<void> {
  await setSetting("operationMode", s.operationMode);
  await setSetting("mealWindows", JSON.stringify(s.mealWindows));
  await setSetting("faceMatch", JSON.stringify(s.faceMatch));
}

export async function fetchKioskSettings(): Promise<KioskSettings | null> {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch("/api/system/settings");
    if (!res.ok) return null;
    const data = await res.json();
    const settings: KioskSettings = {
      operationMode: toMode(data.operationMode),
      mealWindows: data.mealWindows ?? DEFAULT_MEAL_WINDOWS,
      faceMatch: data.faceMatch ?? DEFAULT_FACE_MATCH,
    };
    await saveSettings(settings);
    if (data.qrGeneration) await setSetting("qrGeneration", String(data.qrGeneration));
    if (settings.operationMode === "online") await clearFaceProfiles();
    return settings;
  } catch {
    return null;
  }
}

export async function loadSavedKioskSettings(): Promise<KioskSettings> {
  const [mode, windows, faceMatch] = await Promise.all([
    getSetting("operationMode"), getSetting("mealWindows"), getSetting("faceMatch"),
  ]);
  return {
    operationMode: toMode(mode),
    mealWindows: windows ? (JSON.parse(windows) as MealWindows) : DEFAULT_MEAL_WINDOWS,
    faceMatch: faceMatch ? (JSON.parse(faceMatch) as KioskSettings["faceMatch"]) : DEFAULT_FACE_MATCH,
  };
}

export interface KioskSyncOutcome {
  ok: boolean;
  message: string;
  operationMode?: OperationMode;
  rejectedCount: number;
}

const LOGIN_REQUIRED = "관리자 로그인이 필요합니다. /admin/login에서 먼저 로그인하세요.";

export async function performKioskSync(): Promise<KioskSyncOutcome> {
  if (!navigator.onLine) return { ok: false, message: "오프라인 상태입니다.", rejectedCount: 0 };

  let uploaded = 0;
  let rejectedCount = 0;
  const unsynced = await getUnsyncedCheckIns();
  if (unsynced.length > 0) {
    const payload = unsynced
      .filter((ci) => typeof ci.id === "number")
      .map((ci) => ({ clientId: ci.id!, userId: ci.userId, date: ci.date, mealKind: ci.mealKind, checkedAt: ci.checkedAt, type: ci.type }));
    const upRes = await fetch("/api/sync/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkins: payload }),
    });
    if (upRes.status === 401 || upRes.status === 403) return { ok: false, message: `업로드 실패: ${LOGIN_REQUIRED}`, rejectedCount: 0 };
    if (!upRes.ok) return { ok: false, message: `업로드 실패 (${upRes.status})`, rejectedCount: 0 };
    const upData = await upRes.json();
    const syncedIds: number[] = Array.isArray(upData.syncedClientIds)
      ? upData.syncedClientIds.filter((id: unknown): id is number => typeof id === "number")
      : [];
    if (syncedIds.length > 0) await markCheckInsSynced(syncedIds);
    uploaded = syncedIds.length;
    rejectedCount = typeof upData.rejectedCount === "number" ? upData.rejectedCount : 0;
  }

  const downRes = await fetch("/api/sync/download?faces=1");
  if (downRes.status === 401 || downRes.status === 403) return { ok: false, message: `다운로드 실패: ${LOGIN_REQUIRED}`, rejectedCount };
  if (!downRes.ok) return { ok: false, message: `다운로드 실패 (${downRes.status})`, rejectedCount };
  const data = await downRes.json();

  const settings: KioskSettings = {
    operationMode: toMode(data.operationMode),
    mealWindows: data.mealWindows ?? DEFAULT_MEAL_WINDOWS,
    faceMatch: data.faceMatch ?? DEFAULT_FACE_MATCH,
  };
  await replaceAllUsers((data.users ?? []) as LocalUser[]);
  await replaceAllEligibleEntries((data.eligibleEntries ?? []) as LocalEligibleEntry[]);
  const faceProfiles = (data.faceProfiles ?? []) as LocalFaceProfile[];
  // 보관 정책: 서버가 로컬 모드일 때만 임베딩을 기기에 둔다.
  if (settings.operationMode === "local") await replaceAllFaceProfiles(faceProfiles);
  else await clearFaceProfiles();
  await saveSettings(settings);
  if (data.qrGeneration) await setSetting("qrGeneration", String(data.qrGeneration));
  const now = new Date().toISOString();
  await setSetting("lastSyncAt", now);

  const faceCount = settings.operationMode === "local" ? faceProfiles.length : 0;
  return {
    ok: true,
    operationMode: settings.operationMode,
    rejectedCount,
    message: `동기화 완료 — 업로드 ${uploaded}건, 명단 ${(data.users ?? []).length}명, 얼굴 ${faceCount}명`,
  };
}
```

- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit 2>&1 | grep kiosk-sync` → 없음
- [ ] **Step 3: 커밋** — `git commit -m "feat(facecheck): 키오스크 동기화·설정 로더(업로드→다운로드 faces=1→IDB, 임베딩 보관 정책)"`

---

### Task 10: `/facecheck` 페이지 — 페이싱·옵션 A·성능 표시·강등·로컬 모드·4색/사운드

**Files:**
- Modify: `src/app/facecheck/page.tsx`

**Interfaces:**
- Consumes: Task 1 `resolveFaceBackends`/`nextDetectDelay`/`FaceBackend`; Task 2 `loadHuman(candidates)`/`getActiveFaceBackend`; Task 3 `resultCategory`/`RESULT_BG_CLASS`/`RESULT_TEXT_CLASS`; Task 4 `playSuccess/playDuplicate/playDenied/playError`; Task 8 `runLocalFaceCheckIn`/`toFaceCandidates`/`FaceCheckResult`/`FaceCheckUser`; Task 9 `fetchKioskSettings`/`loadSavedKioskSettings`/`performKioskSync`/`KioskSettings`; `local-db` (`getUser`, `getCheckIn`, `isEligible`, `addCheckIn`, `getAllFaceProfiles`, `getUnsyncedCount`, `getSetting`)

- [ ] **Step 1: import·타입 정리**
  - 페이지 내부 `FaceCheckUser`/`FaceCheckResult` 인터페이스 삭제 → `import { runLocalFaceCheckIn, toFaceCandidates, type FaceCheckResult, type FaceCheckUser } from "@/lib/facecheck-local";`
  - 사운드 import → `import { playDenied, playDuplicate, playError, playSuccess } from "@/lib/checkin-sounds";`
  - 추가: `import { detectFaces, getActiveFaceBackend, loadHuman, qualityIssue } from "@/lib/human-client";`, `import { nextDetectDelay, resolveFaceBackends } from "@/lib/face-pacing";`, `import { RESULT_BG_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";`, `import { fetchKioskSettings, loadSavedKioskSettings, performKioskSync, type KioskSettings } from "@/lib/kiosk-sync";`, `import { addCheckIn, getAllFaceProfiles, getCheckIn, getSetting, getUnsyncedCount, getUser, isEligible } from "@/lib/local-db";`, `import type { FaceCandidate } from "@/lib/face-match";`, lucide `RefreshCw, Wifi, WifiOff` 추가.
  - 상수: `DETECT_INTERVAL_MS` 삭제. 추가 `const BACKEND_STORAGE = "facecheck.backend";`, `const SUPPRESSED_COOLDOWN_MS = 1500;`, `const BUSY_POLL_MS = 100;`, `const PERF_UPDATE_MS = 500;`

- [ ] **Step 2: 상태 추가**
```ts
  const [settings, setSettings] = useState<KioskSettings | null>(null);   // null = 확인 전
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [perf, setPerf] = useState<{ backend: string | null; detectMs: number | null }>({ backend: null, detectMs: null });
  const settingsRef = useRef<KioskSettings | null>(null);
  const candidatesRef = useRef<FaceCandidate[]>([]);
  const resultGenRef = useRef(0);
  const isLocal = settings?.operationMode === "local";
```
  - 백엔드 override: 키오스크 키 useEffect 안에서 `const backend = params.get("backend"); if (backend === "webgl" || backend === "webgpu") localStorage.setItem(BACKEND_STORAGE, backend); if (backend === "auto") localStorage.removeItem(BACKEND_STORAGE);` — `history.replaceState`는 `key` 또는 `backend`가 있을 때 실행.

- [ ] **Step 3: 설정·동기화 훅**
```ts
  const loadCandidates = useCallback(async () => {
    candidatesRef.current = toFaceCandidates(await getAllFaceProfiles());
  }, []);

  const applySettings = useCallback((s: KioskSettings) => {
    settingsRef.current = s;
    setSettings(s);
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const outcome = await performKioskSync();
      setSyncMessage(outcome.message);
      if (outcome.ok) {
        applySettings(await loadSavedKioskSettings());
        await loadCandidates();
        setLastSyncAt(await getSetting("lastSyncAt") ?? null);
      }
    } catch (err) {
      console.error("kiosk sync error:", err);
      setSyncMessage("동기화 오류가 발생했습니다.");
    } finally {
      setUnsyncedCount(await getUnsyncedCount());
      setSyncing(false);
    }
  }, [applySettings, loadCandidates, syncing]);

  useEffect(() => {
    let cancelled = false;
    setIsOnline(navigator.onLine);
    (async () => {
      const fetched = await fetchKioskSettings();
      const s = fetched ?? (await loadSavedKioskSettings());
      if (cancelled) return;
      applySettings(s);
      await loadCandidates();
      setUnsyncedCount(await getUnsyncedCount());
      setLastSyncAt((await getSetting("lastSyncAt")) ?? null);
      if (s.operationMode === "local" && navigator.onLine) runSyncRef.current();
    })();
    const handleOnline = () => { setIsOnline(true); if (settingsRef.current?.operationMode === "local") runSyncRef.current(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { cancelled = true; window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [applySettings, loadCandidates]);
```
  - `runSyncRef = useRef(runSync)` + `useEffect(() => { runSyncRef.current = runSync; }, [runSync]);` (마운트 effect가 최신 runSync를 부르되 의존성 재실행은 피한다.)

- [ ] **Step 4: 결과 처리 — 옵션 A + 4색/사운드**
  - `applyResult`:
```ts
  const applyResult = useCallback((json: FaceCheckResult) => {
    if (json.needType && json.user && json.mealKind) return;
    if (!json.matched && !json.success) {
      const cooldown = json.errorCode === "NO_MEAL_WINDOW" ? NO_MEAL_WINDOW_COOLDOWN_MS : QUIET_COOLDOWN_MS;
      updateStatus(json.error || "인식되지 않았습니다. 다시 서 주세요.");
      setPhase("waiting");
      setTimeout(resumeScan, cooldown);
      return;
    }
    const gen = ++resultGenRef.current;
    setResult(json);
    if (json.user?.id) suppressRef.current.set(json.user.id, Date.now() + RESULT_SUPPRESS_MS);
    const category = resultCategory(json);
    if (category === "success") playSuccess();
    else if (category === "duplicate") playDuplicate();
    else if (category === "notApplicant") playDenied();
    else playError();
    // 결과 카드는 남겨 두고 스캔은 즉시 재개 — 같은 사람은 억제 맵이 막는다.
    resumeScan();
    setTimeout(() => {
      if (resultGenRef.current === gen) setResult(null);
    }, RESULT_DISPLAY_MS);
  }, [resumeScan, updateStatus]);
```
  - `submitEmbedding`의 억제 분기 `setTimeout(resumeScan, QUIET_COOLDOWN_MS)` → `SUPPRESSED_COOLDOWN_MS`.
  - 로컬 분기: `submitEmbedding` 시작부에
```ts
      const s = settingsRef.current;
      if (s?.operationMode === "local") {
        try {
          const json = await runLocalFaceCheckIn(
            { embedding, candidates: candidatesRef.current, faceMatch: s.faceMatch, now: new Date(), mealWindows: s.mealWindows },
            { getUser, getCheckIn, isEligible, addCheckIn },
          );
          if (modeGenRef.current !== gen) { resumeScan(); return; }
          handleMatchedResponse(json, embedding, gen);
          if (json.success) setUnsyncedCount(await getUnsyncedCount());
        } catch (err) {
          console.error("local facecheck error:", err);
          updateStatus("로컬 저장 오류 — 다시 시도해 주세요");
          setPhase("waiting");
          setTimeout(resumeScan, 1500);
        }
        return;
      }
```
    `handleMatchedResponse(json, embedding, gen)`는 기존 온라인 경로의 "억제 확인 → needType → applyResult" 블록을 추출한 콜백(온라인·로컬 공용). 온라인 경로는 `handleGateErrors` 후 이 콜백을 호출.
  - `submitTeacherType`: `settingsRef.current?.operationMode === "local"`이면 `runLocalFaceCheckIn({ ...같은 입력, embedding: p.embedding, type }, repo)` 결과를 `applyResult`에 전달하고 `setUnsyncedCount` 갱신; 아니면 기존 fetch.

- [ ] **Step 5: 감지 루프 — 백엔드 후보·페이싱·성능·강등**
  - 모델 로드: `const override = localStorage.getItem(BACKEND_STORAGE); const candidates = resolveFaceBackends(override, typeof navigator !== "undefined" && "gpu" in navigator); human = await loadHuman(candidates);` 로드 직후 `setPerf({ backend: getActiveFaceBackend(), detectMs: null })`.
  - 루프:
```ts
      let failures = 0;
      let downgraded = false;
      let lastDetectMs = 0;
      let lastPerfAt = 0;
      while (!cancelled) {
        const idle = busyRef.current || kioskBlockedRef.current;
        await new Promise((r) => setTimeout(r, idle ? BUSY_POLL_MS : nextDetectDelay(lastDetectMs)));
        if (cancelled) break;
        if (idle) continue;
        const currentVideo = videoRef.current;
        if (!currentVideo) continue;
        try {
          const t0 = performance.now();
          const outcome = await detectFaces(human, currentVideo);
          lastDetectMs = performance.now() - t0;
          if (cancelled) break;
          failures = 0;
          if (t0 - lastPerfAt > PERF_UPDATE_MS) {
            lastPerfAt = t0;
            setPerf({ backend: getActiveFaceBackend(), detectMs: Math.round(lastDetectMs) });
          }
          /* none/multiple/spoof/lowScore 분기 기존 그대로 */
          pauseScan("processing");
          updateStatus("인식 중...");
          await submitEmbedding(outcome.face.embedding);
          if (cancelled) break;
        } catch (err) {
          failures += 1;
          if (failures === 1) console.error("face loop error:", err);
          if (failures < MAX_LOOP_FAILURES) continue;
          if (getActiveFaceBackend() === "webgpu" && !downgraded) {
            downgraded = true;
            failures = 0;
            updateStatus("WebGPU 오류 — WebGL로 전환합니다");
            try {
              human = await loadHuman(["webgl"]);
              setPerf({ backend: getActiveFaceBackend(), detectMs: null });
              continue;
            } catch (reloadErr) {
              console.error("webgl fallback failed:", reloadErr);
            }
          }
          /* 카메라 정지 + QR 모드 전환 기존 그대로 */
          break;
        }
      }
```
  - 검출 성공 시 `busyRef`가 false인 상태에서 결과 카드가 떠 있어도 정상 진행(옵션 A).

- [ ] **Step 6: 렌더링**
  - `bgClass`: `result ? RESULT_BG_CLASS[resultCategory(result)] : "bg-background"`.
  - 상태바 좌측: `안면인식 체크인` 옆에 `/check`와 같은 온라인/오프라인 아이콘, `isLocal`이면 `<span className="text-amber-400 whitespace-nowrap">로컬 모드</span>`, `(isLocal || unsyncedCount > 0)`이면 `미전송: {unsyncedCount}건`. 우측: 기존 단계 표시 뒤에 `perf.backend && <span className="text-white/50 whitespace-nowrap">{perf.backend}{perf.detectMs !== null ? ` · ${perf.detectMs}ms` : ""}</span>`.
  - 카드 문구 색: 성공 `RESULT_TEXT_CLASS.success`, 중복 `RESULT_TEXT_CLASS.duplicate`, 미신청 `RESULT_TEXT_CLASS.notApplicant`, 기타 `RESULT_TEXT_CLASS.error`.
  - 하단 바: 기존 모드 전환 버튼을 `flex items-center justify-between gap-2` 컨테이너로 감싸고, `isLocal`일 때 좌측에 `<span className="text-white/70 text-xs whitespace-nowrap">마지막 동기화: {lastSyncAt ? new Date(lastSyncAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음"}</span>` + `{syncMessage && <span className="text-amber-300 text-xs truncate">{syncMessage}</span>}` + `<button onClick={runSync} disabled={syncing || !isOnline} className="min-h-11 px-4 rounded-full bg-blue-500/90 text-white text-sm font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "동기화 중..." : "동기화"}</button>`.
  - 모드 전환 버튼: `mode === "face" && isLocal`이면 `onClick={() => { window.location.href = "/check"; }}` (로컬 QR은 `/check`가 처리), 라벨 `QR로 체크인 (/check)`.
  - 결과 카드의 `photoUrl` 없는 경우는 기존 이니셜 아바타.

- [ ] **Step 7: 확인** — `npx tsc --noEmit`, `npm run lint`, `grep -rn "playChime\|playLongBeep\|playDoubleBeep" src` → 없음.
- [ ] **Step 8: 커밋** — `git commit -am "feat(facecheck): WebGPU 우선 로딩·적응형 페이싱·성능 표시·결과 중 스캔 재개·로컬 모드·4색/사운드"`

---

### Task 11: 문서·검증·머지

**Files:**
- Modify: `CLAUDE.md` (라우팅 `/facecheck` 설명, API `/api/sync/download`, 환경 무변경), `.claude/PROJECT_MAP.md` (project-map-updater 에이전트)

- [ ] **Step 1: CLAUDE.md** — 라우팅 표 `/facecheck`: `공개(키오스크 키)` → `공개(키오스크 키; 로컬 모드는 관리자 로그인 동기화)`, 설명에 "WebGPU 우선·webgl 폴백, `?backend=webgl|webgpu|auto`" 추가. API 표 `/api/sync/download`: "`?faces=1` 시 얼굴 임베딩·임계값 포함" 추가. 주요 컴포넌트/유틸 표에 `checkin-sounds`(4종), `checkin-result-style` 한 줄.
- [ ] **Step 2: PROJECT_MAP** — `project-map-updater` 에이전트 호출(신규 파일 5개, local-db v5, download 확장).
- [ ] **Step 3: 게이트** — `npm test` 전체 PASS, `npm run build` 성공. `responsive-ui-reviewer`로 `facecheck/page.tsx`·`check/page.tsx` 점검.
- [ ] **Step 4: 수동 확인(가능한 범위)** — `npm run dev` 후 `/facecheck` 콘솔에서 `human load` 로그·상태바 백엔드 표시. 로컬 DB 없이도 모델 로드·백엔드 표시는 확인 가능.
- [ ] **Step 5: 커밋·머지** — 문서 커밋 후 `git checkout main && git merge --ff-only feat/facecheck-perf-local && git push origin main` (사용자 확인 후).
