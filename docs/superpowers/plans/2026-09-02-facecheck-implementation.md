# 안면인식 체크인 (facecheck) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생·교사가 얼굴을 등록하면 식당 태블릿의 `/facecheck` 페이지에서 카메라만으로 1:N 식별 체크인이 되도록 한다.

**Architecture:** 브라우저(@vladmandic/human)에서 얼굴 검출·임베딩 추출을 수행하고, 서버는 임베딩 저장과 코사인 유사도 1:N 매칭·체크인만 담당한다. 얼굴 이미지는 서버로 전송되지 않는다. 학생은 매칭 즉시 체크인, 교사는 근무/개인/취소 선택(10초 미선택 시 자동 "개인")한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 (adapter-pg), @vladmandic/human(버전 고정) + 모델 self-host(`public/models/`), zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-facecheck-design.md`

## Global Constraints

- 브랜치: `feat/facecheck`. 커밋은 태스크마다.
- 마이그레이션은 **additive만** (새 테이블 FaceProfile, enum 값 FACE 추가). destructive 변경 금지.
- **`src/app/check/page.tsx` 와 `src/app/api/checkin/route.ts` 는 절대 수정하지 않는다.**
- 얼굴 원본 이미지·프레임은 어떤 API로도 서버 전송 금지. 임베딩(number[])만 전송.
- `@vladmandic/human` 은 정확한 버전 고정(`npm i -E`). 모델 파일은 `public/models/` self-host, 외부 CDN 사용 금지.
- Human 라이브러리는 클라이언트 전용 — 서버 코드(`route.ts`, lib 서버 유틸)에서 import 금지. 클라이언트에서도 dynamic import만.
- 사용자용 에러 메시지는 한국어, 기존 `/api/checkin` 메시지와 동일 문구 재사용 ("현재 식사 시간이 아닙니다." / "식사 신청 기간이 아닙니다." / "이미 {식사} 체크인 하였습니다.").
- 시스템 경계(요청 바디)는 zod 검증. 내부 코드는 방어적 if 남발 금지.
- UI: 버튼·라벨 `whitespace-nowrap`, 터치 타겟 44px 이상(`min-h-11`), `100vh` 금지(`100dvh`), 모바일 퍼스트.
- 주석은 "왜"가 비자명할 때만. WHAT 주석 금지.
- User.id 는 `Int`(autoincrement). 세션의 본인 id는 `session.user.dbUserId`.
- 검증 게이트: 각 태스크에서 `npm test` 통과, 마지막에 `npm run build` 통과.

---

## 파일 구조 (전체 지도)

| 파일 | 태스크 | 역할 |
|------|--------|------|
| `prisma/schema.prisma` | 1 | FaceProfile 모델, CheckInSource.FACE, User 관계 |
| `src/lib/face-constants.ts` | 2 | 차원·개수·모델버전·임계값 기본 상수 (서버·클라 공용) |
| `src/lib/face-match.ts` | 2 | 코사인 유사도 + 1:N 매칭 판정 (순수 함수) |
| `src/lib/schemas/face.ts` | 3 | zod: faceEnrollSchema / faceCheckSchema |
| `src/lib/face-consent.ts` | 4 | 동의문 전문 + FACE_CONSENT_VERSION |
| `src/app/api/users/me/face/route.ts` | 4 | GET/POST/DELETE 등록 API |
| `src/lib/face-embedding-cache.ts` | 5 | FaceProfile 인메모리 캐시 (60s TTL) |
| `src/lib/settings-cache.ts` | 5 | (수정) face_match_threshold/margin 추가 |
| `src/app/api/facecheck/route.ts` | 6 | 1:N 매칭 → 체크인 (2단계 무상태) |
| `public/models/*` | 7 | Human 얼굴 파이프라인 모델 (커밋) |
| `src/lib/human-client.ts` | 7 | Human 로더·설정·단일 얼굴 검출 (클라 전용) |
| `src/components/FaceEnroll.tsx` | 8 | 등록 UI (동의 모달 포함) |
| `src/app/student/page.tsx` | 8 | (수정) 개인정보 탭에 FaceEnroll |
| `src/app/teacher/page.tsx` | 8 | (수정) 개인정보 탭에 FaceEnroll |
| `src/lib/checkin-sounds.ts` | 9 | 사운드 유틸 (check 페이지에서 복사, check는 비변경) |
| `src/app/facecheck/page.tsx` | 9 | 인식 페이지 |

---

### Task 1: Prisma 스키마 — FaceProfile + CheckInSource.FACE

**Files:**
- Modify: `prisma/schema.prisma` (enum CheckInSource 21행 부근, model User 51행 부근)
- Create: `prisma/migrations/<timestamp>_add_face_profile/migration.sql` (prisma가 생성)

**Interfaces:**
- Produces: Prisma 모델 `FaceProfile { id: Int, userId: Int, embeddings: Json, modelVersion: String, consentAt: DateTime, consentVersion: String, createdAt, updatedAt }`, `CheckInSource.FACE`. 이후 태스크는 `prisma.faceProfile.*` 사용.

- [ ] **Step 1: schema.prisma 수정**

`enum CheckInSource` 에 `FACE` 추가:

```prisma
enum CheckInSource {
  QR
  ADMIN_MANUAL
  LOCAL_SYNC
  FACE
}
```

`model User` 의 relations 블록(`registrations MealRegistration[]` 아래)에 추가:

```prisma
  faceProfile   FaceProfile?
```

파일 말미(마지막 모델 뒤)에 추가:

```prisma
model FaceProfile {
  id             Int      @id @default(autoincrement())
  userId         Int      @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  embeddings     Json
  modelVersion   String
  consentAt      DateTime
  consentVersion String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 2: (오케스트레이터) prisma-migration-guardian 에이전트로 위 diff 검수**

기대: additive-only 판정 (새 enum 값 + 새 테이블). destructive 지적이 나오면 중단하고 사용자에게 보고.

- [ ] **Step 3: 로컬 DB 기동 + 마이그레이션 생성·적용**

Run: `docker compose up -d && npx prisma migrate dev --name add_face_profile`
Expected: 마이그레이션 1건 생성·적용, `prisma generate` 자동 실행, 에러 없음.

- [ ] **Step 4: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: 전체 PASS (스키마 추가는 기존 코드에 영향 없음).

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(facecheck): FaceProfile 모델·CheckInSource.FACE 추가"
```

---

### Task 2: 얼굴 매칭 라이브러리 (순수 함수, TDD)

**Files:**
- Create: `src/lib/face-constants.ts`
- Create: `src/lib/face-match.ts`
- Test: `src/lib/__tests__/face-match.test.ts`

**Interfaces:**
- Produces:
  - `face-constants.ts`: `FACE_EMBEDDING_DIM = 1024`, `FACE_MIN_EMBEDDINGS = 3`, `FACE_MAX_EMBEDDINGS = 5`, `FACE_MODEL_VERSION = "human@<Task 7에서 고정한 버전>"` (Task 7 완료 전까지 `"human@pending"`), `DEFAULT_FACE_MATCH_THRESHOLD = 0.55`, `DEFAULT_FACE_MATCH_MARGIN = 0.05`
  - `face-match.ts`: `interface FaceCandidate { userId: number; embeddings: Float32Array[] }`, `interface FaceMatch { userId: number; similarity: number; runnerUp: number }`, `cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number`, `findBestMatch(embedding: ArrayLike<number>, candidates: FaceCandidate[], opts: { threshold: number; margin: number }): FaceMatch | null`

- [ ] **Step 1: 상수 파일 작성** (`src/lib/face-constants.ts`)

```ts
export const FACE_EMBEDDING_DIM = 1024;
export const FACE_MIN_EMBEDDINGS = 3;
export const FACE_MAX_EMBEDDINGS = 5;
export const FACE_MODEL_VERSION = "human@pending";
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.55;
export const DEFAULT_FACE_MATCH_MARGIN = 0.05;
```

- [ ] **Step 2: 실패하는 테스트 작성** (`src/lib/__tests__/face-match.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { cosineSimilarity, findBestMatch, type FaceCandidate } from "@/lib/face-match";

function unitVec(dim: number, axis: number): Float32Array {
  const v = new Float32Array(dim);
  v[axis] = 1;
  return v;
}

// 테스트는 4차원으로 충분 — 알고리즘은 차원 무관
const A = unitVec(4, 0);
const B = unitVec(4, 1);
const NEAR_A = Float32Array.from([0.95, 0.05, 0, 0]);

const candidates: FaceCandidate[] = [
  { userId: 1, embeddings: [A] },
  { userId: 2, embeddings: [B] },
];

describe("cosineSimilarity", () => {
  it("동일 벡터는 1", () => {
    expect(cosineSimilarity(A, A)).toBeCloseTo(1);
  });
  it("직교 벡터는 0", () => {
    expect(cosineSimilarity(A, B)).toBeCloseTo(0);
  });
  it("영벡터는 0 (NaN 금지)", () => {
    expect(cosineSimilarity(new Float32Array(4), A)).toBe(0);
  });
});

describe("findBestMatch", () => {
  const opts = { threshold: 0.55, margin: 0.05 };

  it("임계값 이상 + 마진 충족 시 최고 후보 반환", () => {
    const m = findBestMatch(NEAR_A, candidates, opts);
    expect(m?.userId).toBe(1);
    expect(m!.similarity).toBeGreaterThan(0.9);
  });

  it("임계값 미달이면 null", () => {
    expect(findBestMatch(Float32Array.from([0.3, 0.3, 0.9, 0]), candidates, { threshold: 0.9, margin: 0 })).toBeNull();
  });

  it("1·2위 격차가 마진 미달이면 null", () => {
    const ambiguous: FaceCandidate[] = [
      { userId: 1, embeddings: [Float32Array.from([1, 0.9, 0, 0])] },
      { userId: 2, embeddings: [Float32Array.from([0.9, 1, 0, 0])] },
    ];
    expect(findBestMatch(Float32Array.from([1, 1, 0, 0]), ambiguous, { threshold: 0.5, margin: 0.05 })).toBeNull();
  });

  it("등록자가 1명이면 마진 조건 생략", () => {
    const solo = [{ userId: 7, embeddings: [A] }];
    const m = findBestMatch(NEAR_A, solo, { threshold: 0.55, margin: 0.99 });
    expect(m?.userId).toBe(7);
  });

  it("사용자별 유사도는 임베딩들 중 최대값", () => {
    const multi: FaceCandidate[] = [
      { userId: 1, embeddings: [B, A] }, // A가 더 가까움 → max 사용
      { userId: 2, embeddings: [B] },
    ];
    const m = findBestMatch(NEAR_A, multi, opts);
    expect(m?.userId).toBe(1);
  });

  it("후보가 없으면 null", () => {
    expect(findBestMatch(A, [], opts)).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/face-match.test.ts`
Expected: FAIL — "Cannot find module '@/lib/face-match'" 류.

- [ ] **Step 4: 구현** (`src/lib/face-match.ts`)

```ts
export interface FaceCandidate {
  userId: number;
  embeddings: Float32Array[];
}

export interface FaceMatch {
  userId: number;
  similarity: number;
  runnerUp: number;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function findBestMatch(
  embedding: ArrayLike<number>,
  candidates: FaceCandidate[],
  opts: { threshold: number; margin: number },
): FaceMatch | null {
  let best: { userId: number; similarity: number } | null = null;
  let second = 0;

  for (const candidate of candidates) {
    let sim = -1;
    for (const emb of candidate.embeddings) {
      const s = cosineSimilarity(embedding, emb);
      if (s > sim) sim = s;
    }
    if (!best || sim > best.similarity) {
      if (best) second = best.similarity;
      best = { userId: candidate.userId, similarity: sim };
    } else if (sim > second) {
      second = sim;
    }
  }

  if (!best) return null;
  if (best.similarity < opts.threshold) return null;
  if (candidates.length >= 2 && best.similarity - second < opts.margin) return null;
  return { userId: best.userId, similarity: best.similarity, runnerUp: second };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/face-match.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/face-constants.ts src/lib/face-match.ts src/lib/__tests__/face-match.test.ts
git commit -m "feat(facecheck): 코사인 1:N 매칭 라이브러리"
```

---

### Task 3: zod 스키마 (TDD)

**Files:**
- Create: `src/lib/schemas/face.ts`
- Test: `src/lib/__tests__/face-schema.test.ts`

**Interfaces:**
- Consumes: `face-constants.ts`의 `FACE_EMBEDDING_DIM`, `FACE_MIN_EMBEDDINGS`, `FACE_MAX_EMBEDDINGS`
- Produces: `faceEnrollSchema` (`{ embeddings: number[][], consentVersion: string }`), `faceCheckSchema` (`{ embedding: number[], type?: "WORK" | "PERSONAL" }`)

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/__tests__/face-schema.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { faceEnrollSchema, faceCheckSchema } from "@/lib/schemas/face";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const validEmbedding = Array.from({ length: FACE_EMBEDDING_DIM }, () => 0.1);

describe("faceEnrollSchema", () => {
  it("3~5개의 1024차원 임베딩 + consentVersion 허용", () => {
    const r = faceEnrollSchema.safeParse({
      embeddings: [validEmbedding, validEmbedding, validEmbedding],
      consentVersion: "2026-09-v1",
    });
    expect(r.success).toBe(true);
  });

  it("2개 이하 거부", () => {
    expect(
      faceEnrollSchema.safeParse({ embeddings: [validEmbedding, validEmbedding], consentVersion: "v" }).success,
    ).toBe(false);
  });

  it("차원이 다르면 거부", () => {
    expect(
      faceEnrollSchema.safeParse({
        embeddings: [validEmbedding, validEmbedding, [1, 2, 3]],
        consentVersion: "v",
      }).success,
    ).toBe(false);
  });

  it("NaN/Infinity 거부", () => {
    const bad = [...validEmbedding];
    bad[0] = Infinity;
    expect(
      faceEnrollSchema.safeParse({
        embeddings: [validEmbedding, validEmbedding, bad],
        consentVersion: "v",
      }).success,
    ).toBe(false);
  });
});

describe("faceCheckSchema", () => {
  it("embedding만 허용 (type 생략 가능)", () => {
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding }).success).toBe(true);
  });
  it("type WORK/PERSONAL 허용, 그 외 거부", () => {
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding, type: "WORK" }).success).toBe(true);
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding, type: "STUDENT" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/face-schema.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** (`src/lib/schemas/face.ts`)

```ts
import { z } from "zod";
import {
  FACE_EMBEDDING_DIM,
  FACE_MAX_EMBEDDINGS,
  FACE_MIN_EMBEDDINGS,
} from "@/lib/face-constants";

const embeddingSchema = z
  .array(z.number().finite())
  .length(FACE_EMBEDDING_DIM);

export const faceEnrollSchema = z.object({
  embeddings: z.array(embeddingSchema).min(FACE_MIN_EMBEDDINGS).max(FACE_MAX_EMBEDDINGS),
  consentVersion: z.string().min(1),
});

export const faceCheckSchema = z.object({
  embedding: embeddingSchema,
  type: z.enum(["WORK", "PERSONAL"]).optional(),
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/face-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/face.ts src/lib/__tests__/face-schema.test.ts
git commit -m "feat(facecheck): 등록·체크인 zod 스키마"
```

---

### Task 4: 동의문 + 등록 API `/api/users/me/face` (TDD)

**Files:**
- Create: `src/lib/face-consent.ts`
- Create: `src/app/api/users/me/face/route.ts`
- Test: `src/lib/__tests__/face-enroll-route.test.ts`

**Interfaces:**
- Consumes: `faceEnrollSchema`, `FACE_MODEL_VERSION`, `invalidateFaceCache`(Task 5에서 생성 — 이 태스크에서는 아직 없으므로 **Task 5 이후에 연결**. 이 태스크에서는 import 없이 작성하고 Task 5 Step 6에서 추가)
- Produces:
  - `face-consent.ts`: `FACE_CONSENT_VERSION = "2026-09-v1"`, `FACE_CONSENT_TEXT: string` (전문)
  - API 응답: GET `{ registered: boolean, consentAt?: string, modelVersion?: string }` / POST 200 `{ ok: true }` / DELETE `{ ok: true }`

- [ ] **Step 1: 동의문 작성** (`src/lib/face-consent.ts`)

```ts
export const FACE_CONSENT_VERSION = "2026-09-v1";

export const FACE_CONSENT_TEXT = `[민감정보(안면인식정보) 수집·이용 동의]

1. 수집 항목: 얼굴 특징정보(수치화된 임베딩 벡터). 얼굴 사진 원본은 서버로 전송·저장되지 않습니다.
2. 수집 목적: 급식 체크인 시 본인 확인(안면인식 체크인).
3. 보유 기간: 졸업·전출 또는 본인이 삭제를 요청할 때까지.
4. 동의 거부 권리: 동의하지 않아도 기존 QR 체크인은 동일하게 이용할 수 있습니다.
5. 동의 철회: 개인정보 탭의 [삭제] 버튼으로 언제든 즉시 삭제(철회)할 수 있습니다.

위 내용을 확인하였으며, 안면인식정보 수집·이용에 동의합니다.`;
```

- [ ] **Step 2: 실패하는 라우트 테스트 작성** (`src/lib/__tests__/face-enroll-route.test.ts`)

기존 `sync-upload.test.ts` 의 vi.hoisted + vi.mock 패턴을 그대로 따른다.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  faceProfileFindUnique: vi.fn(),
  faceProfileUpsert: vi.fn(),
  faceProfileDeleteMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    faceProfile: {
      findUnique: mocks.faceProfileFindUnique,
      upsert: mocks.faceProfileUpsert,
      deleteMany: mocks.faceProfileDeleteMany,
    },
  },
}));

const validEmbedding = Array.from({ length: FACE_EMBEDDING_DIM }, () => 0.1);

function postRequest(body: unknown) {
  return new Request("http://localhost/api/users/me/face", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/users/me/face", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { dbUserId: 42 } });
  });

  it("비로그인 401", async () => {
    mocks.auth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/users/me/face/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET: 등록 없으면 registered=false", async () => {
    mocks.faceProfileFindUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/users/me/face/route");
    const body = await (await GET()).json();
    expect(body.registered).toBe(false);
  });

  it("POST: 유효 바디 → userId 42로 upsert", async () => {
    mocks.faceProfileUpsert.mockResolvedValue({ id: 1 });
    const { POST } = await import("@/app/api/users/me/face/route");
    const res = await POST(
      postRequest({
        embeddings: [validEmbedding, validEmbedding, validEmbedding],
        consentVersion: "2026-09-v1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.faceProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42 } }),
    );
  });

  it("POST: 잘못된 바디 400", async () => {
    const { POST } = await import("@/app/api/users/me/face/route");
    const res = await POST(postRequest({ embeddings: [[1, 2]], consentVersion: "v" }));
    expect(res.status).toBe(400);
    expect(mocks.faceProfileUpsert).not.toHaveBeenCalled();
  });

  it("DELETE: 본인 프로필 삭제", async () => {
    mocks.faceProfileDeleteMany.mockResolvedValue({ count: 1 });
    const { DELETE } = await import("@/app/api/users/me/face/route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mocks.faceProfileDeleteMany).toHaveBeenCalledWith({ where: { userId: 42 } });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/face-enroll-route.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 4: 라우트 구현** (`src/app/api/users/me/face/route.ts`)

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { faceEnrollSchema } from "@/lib/schemas/face";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.faceProfile.findUnique({
    where: { userId: session.user.dbUserId },
    select: { consentAt: true, modelVersion: true, updatedAt: true },
  });

  if (!profile) return NextResponse.json({ registered: false });
  return NextResponse.json({
    registered: true,
    consentAt: profile.consentAt,
    modelVersion: profile.modelVersion,
    updatedAt: profile.updatedAt,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = faceEnrollSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { embeddings, consentVersion } = parsed.data;
  const now = new Date();
  await prisma.faceProfile.upsert({
    where: { userId: session.user.dbUserId },
    create: {
      userId: session.user.dbUserId,
      embeddings,
      modelVersion: FACE_MODEL_VERSION,
      consentAt: now,
      consentVersion,
    },
    update: {
      embeddings,
      modelVersion: FACE_MODEL_VERSION,
      consentAt: now,
      consentVersion,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.faceProfile.deleteMany({ where: { userId: session.user.dbUserId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/face-enroll-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/face-consent.ts src/app/api/users/me/face/route.ts src/lib/__tests__/face-enroll-route.test.ts
git commit -m "feat(facecheck): 얼굴 등록 API + 동의문"
```

---

### Task 5: 임베딩 캐시 + settings-cache 확장 (TDD)

**Files:**
- Create: `src/lib/face-embedding-cache.ts`
- Modify: `src/lib/settings-cache.ts` (cache 객체에 faceMatch 추가)
- Modify: `src/app/api/users/me/face/route.ts` (POST/DELETE 성공 후 invalidateFaceCache 호출 1줄씩)
- Test: `src/lib/__tests__/face-embedding-cache.test.ts`

**Interfaces:**
- Consumes: `FaceCandidate` (Task 2), `DEFAULT_FACE_MATCH_THRESHOLD/MARGIN` (Task 2)
- Produces:
  - `getFaceCandidates(): Promise<FaceCandidate[]>`, `invalidateFaceCache(): void`
  - `getCachedSettings()` 반환 객체에 `faceMatch: { threshold: number; margin: number }` 추가

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/__tests__/face-embedding-cache.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  faceProfileFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { faceProfile: { findMany: mocks.faceProfileFindMany } },
}));

describe("face-embedding-cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { invalidateFaceCache } = await import("@/lib/face-embedding-cache");
    invalidateFaceCache();
  });

  it("DB rows를 Float32Array 후보로 변환", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([
      { userId: 1, embeddings: [[0.1, 0.2], [0.3, 0.4]] },
    ]);
    const { getFaceCandidates } = await import("@/lib/face-embedding-cache");
    const candidates = await getFaceCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].userId).toBe(1);
    expect(candidates[0].embeddings[0]).toBeInstanceOf(Float32Array);
    expect(candidates[0].embeddings[1][1]).toBeCloseTo(0.4);
  });

  it("TTL 내 재호출은 DB 재조회 없음", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([]);
    const { getFaceCandidates } = await import("@/lib/face-embedding-cache");
    await getFaceCandidates();
    await getFaceCandidates();
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidate 후에는 재조회", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([]);
    const { getFaceCandidates, invalidateFaceCache } = await import("@/lib/face-embedding-cache");
    await getFaceCandidates();
    invalidateFaceCache();
    await getFaceCandidates();
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/face-embedding-cache.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 캐시 구현** (`src/lib/face-embedding-cache.ts`)

```ts
import { prisma } from "@/lib/prisma";
import type { FaceCandidate } from "@/lib/face-match";

let cache: FaceCandidate[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

export async function getFaceCandidates(): Promise<FaceCandidate[]> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL) return cache;

  const rows = await prisma.faceProfile.findMany({
    select: { userId: true, embeddings: true },
  });
  cache = rows.map((row) => ({
    userId: row.userId,
    embeddings: (row.embeddings as number[][]).map((e) => Float32Array.from(e)),
  }));
  cacheTimestamp = Date.now();
  return cache;
}

export function invalidateFaceCache() {
  cache = null;
  cacheTimestamp = 0;
}
```

- [ ] **Step 4: settings-cache 확장** (`src/lib/settings-cache.ts`)

cache 타입에 `faceMatch: { threshold: number; margin: number };` 필드 추가, import에 상수 추가:

```ts
import {
  DEFAULT_FACE_MATCH_MARGIN,
  DEFAULT_FACE_MATCH_THRESHOLD,
} from "@/lib/face-constants";
```

`cache = { ... }` 조립부의 `mealWindows` 다음에 추가:

```ts
    faceMatch: {
      threshold: parseSetting(map.face_match_threshold, DEFAULT_FACE_MATCH_THRESHOLD),
      margin: parseSetting(map.face_match_margin, DEFAULT_FACE_MATCH_MARGIN),
    },
```

파일 하단에 헬퍼 추가:

```ts
function parseSetting(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
```

- [ ] **Step 5: 등록 API에 캐시 무효화 연결** (`src/app/api/users/me/face/route.ts`)

import 추가: `import { invalidateFaceCache } from "@/lib/face-embedding-cache";`
POST의 `upsert` 성공 직후와 DELETE의 `deleteMany` 직후에 각각 `invalidateFaceCache();` 1줄 추가.

- [ ] **Step 6: 전체 테스트 확인**

Run: `npm test`
Expected: 전체 PASS (기존 settings 관련 테스트 포함 회귀 없음).

- [ ] **Step 7: Commit**

```bash
git add src/lib/face-embedding-cache.ts src/lib/settings-cache.ts src/app/api/users/me/face/route.ts src/lib/__tests__/face-embedding-cache.test.ts
git commit -m "feat(facecheck): 임베딩 인메모리 캐시 + 매칭 임계값 설정"
```

---

### Task 6: 체크인 API `/api/facecheck` (TDD)

**Files:**
- Create: `src/app/api/facecheck/route.ts`
- Test: `src/lib/__tests__/facecheck-route.test.ts`

**Interfaces:**
- Consumes: `faceCheckSchema`, `getFaceCandidates`, `findBestMatch`, `getCachedSettings().faceMatch`, `resolveMealKind`, `isStudentEligibleToday`, `MEAL_LABEL`
- Produces (클라이언트가 의존하는 응답 계약):
  - 400 `{ success: false, error: "잘못된 요청입니다." }` (zod 실패)
  - 400 `{ success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" }`
  - 200 `{ success: false, matched: false, error: "인식되지 않았습니다. 다시 서 주세요." }`
  - 200 `{ success: false, matched: true, duplicate: true, user, mealKind, checkedAt, error }`
  - 200 `{ success: false, matched: true, notApplicant: true, user, mealKind, error: "식사 신청 기간이 아닙니다." }` (학생 미자격)
  - 200 `{ success: false, matched: true, needType: true, user, mealKind }` (교사, type 미지정)
  - 200 `{ success: true, matched: true, user, type, mealKind, checkedAt }`
  - user shape: `{ id, name, role, grade, classNum, number, photoUrl }` (기존 /api/checkin 과 동일)

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/__tests__/facecheck-route.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInCreate: vi.fn(),
  getFaceCandidates: vi.fn(),
  getCachedSettings: vi.fn(),
  isStudentEligibleToday: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    checkIn: { findFirst: mocks.checkInFindFirst, create: mocks.checkInCreate },
  },
}));
vi.mock("@/lib/face-embedding-cache", () => ({
  getFaceCandidates: mocks.getFaceCandidates,
}));
vi.mock("@/lib/settings-cache", () => ({
  getCachedSettings: mocks.getCachedSettings,
}));
vi.mock("@/lib/meal-kind", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meal-kind")>();
  return { ...actual, isStudentEligibleToday: mocks.isStudentEligibleToday };
});

// 축 0 단위벡터 — 등록 임베딩과 요청 임베딩을 동일하게 두어 유사도 1
const emb = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

const STUDENT = { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7, photoUrl: null };
const TEACHER = { id: 9, name: "박교사", role: "TEACHER", grade: null, classNum: null, number: null, photoUrl: null };

function request(body: unknown) {
  return new Request("http://localhost/api/facecheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 항상 열려있는 석식 윈도우 → resolveMealKind가 DINNER 반환
const OPEN_SETTINGS = {
  mealWindows: {
    breakfast: { start: "00:00", end: "00:00" },
    lunch: { start: "00:00", end: "00:00" },
    dinner: { start: "00:00", end: "23:59" },
  },
  faceMatch: { threshold: 0.55, margin: 0.05 },
};

describe("/api/facecheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSettings.mockResolvedValue(OPEN_SETTINGS);
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 1, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.checkInFindFirst.mockResolvedValue(null);
    mocks.isStudentEligibleToday.mockResolvedValue(true);
    mocks.checkInCreate.mockResolvedValue({ checkedAt: new Date("2026-09-02T09:00:00Z") });
  });

  it("잘못된 바디 400", async () => {
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: [1, 2, 3] }));
    expect(res.status).toBe(400);
  });

  it("식사 시간 아님 → NO_MEAL_WINDOW", async () => {
    mocks.getCachedSettings.mockResolvedValue({
      ...OPEN_SETTINGS,
      mealWindows: {
        breakfast: { start: "00:00", end: "00:00" },
        lunch: { start: "00:00", end: "00:00" },
        dinner: { start: "00:00", end: "00:00" },
      },
    });
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: emb }));
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe("NO_MEAL_WINDOW");
  });

  it("매칭 실패 → matched:false, 체크인 없음", async () => {
    mocks.getFaceCandidates.mockResolvedValue([]);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.matched).toBe(false);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("학생 매칭 → source FACE, type STUDENT로 즉시 체크인", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, type: "STUDENT", source: "FACE" }),
      }),
    );
  });

  it("학생 미자격 → notApplicant, 체크인 없음", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.isStudentEligibleToday.mockResolvedValue(false);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.notApplicant).toBe(true);
    expect(body.user.name).toBe("김학생");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("중복 → duplicate 응답", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.checkInFindFirst.mockResolvedValue({ checkedAt: new Date() });
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.duplicate).toBe(true);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("교사 + type 미지정 → needType, 체크인 없음", async () => {
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 9, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.needType).toBe(true);
    expect(body.user.name).toBe("박교사");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("교사 + type WORK → WORK로 체크인", async () => {
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 9, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, type: "WORK" }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 9, type: "WORK", source: "FACE" }),
      }),
    );
  });

  it("학생에게 type이 와도 STUDENT로 저장", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    await POST(request({ embedding: emb, type: "WORK" }));
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "STUDENT" }) }),
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/facecheck-route.test.ts`
Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: 라우트 구현** (`src/app/api/facecheck/route.ts`)

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { isStudentEligibleToday, resolveMealKind, type MealKind } from "@/lib/meal-kind";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { getFaceCandidates } from "@/lib/face-embedding-cache";
import { findBestMatch } from "@/lib/face-match";
import { faceCheckSchema } from "@/lib/schemas/face";

const USER_SELECT = {
  id: true, name: true, role: true,
  grade: true, classNum: true, number: true, photoUrl: true,
} as const;

export async function POST(request: Request) {
  try {
    const parsed = faceCheckSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
    }
    const { embedding, type } = parsed.data;

    const settings = await getCachedSettings();
    const mealKind = resolveMealKind(nowKST(), settings.mealWindows);
    if (!mealKind) {
      return NextResponse.json(
        { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
        { status: 400 },
      );
    }

    const candidates = await getFaceCandidates();
    const match = findBestMatch(embedding, candidates, settings.faceMatch);
    if (!match) {
      return NextResponse.json({
        success: false,
        matched: false,
        error: "인식되지 않았습니다. 다시 서 주세요.",
      });
    }

    const todayDate = new Date(todayKST());
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: match.userId }, select: USER_SELECT }),
      prisma.checkIn.findFirst({
        where: { userId: match.userId, date: todayDate, mealKind: mealKind as MealKind },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        matched: true,
        duplicate: true,
        user,
        mealKind,
        checkedAt: existing.checkedAt,
        error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
      });
    }

    let checkInType: "STUDENT" | "WORK" | "PERSONAL";
    if (user.role === "TEACHER") {
      if (!type) {
        return NextResponse.json({ success: false, matched: true, needType: true, user, mealKind });
      }
      checkInType = type;
    } else {
      const eligible = await isStudentEligibleToday(user.id, mealKind as MealKind, todayDate);
      if (!eligible) {
        return NextResponse.json({
          success: false,
          matched: true,
          notApplicant: true,
          user,
          mealKind,
          error: "식사 신청 기간이 아닙니다.",
        });
      }
      checkInType = "STUDENT";
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: user.id,
        date: todayDate,
        mealKind: mealKind as MealKind,
        type: checkInType,
        source: "FACE",
      },
    });

    return NextResponse.json({
      success: true,
      matched: true,
      user,
      type: checkInType,
      mealKind,
      checkedAt: checkIn.checkedAt,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ success: false, matched: true, duplicate: true, error: "이미 체크인 하였습니다." });
    }
    return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/facecheck-route.test.ts`
Expected: PASS (9 tests). 이어서 `npm test` 전체 PASS 확인.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/facecheck/route.ts src/lib/__tests__/facecheck-route.test.ts
git commit -m "feat(facecheck): 1:N 매칭 체크인 API (2단계 무상태)"
```

---

### Task 7: @vladmandic/human 설치 + 모델 self-host + 클라이언트 로더

**Files:**
- Modify: `package.json` (의존성)
- Create: `public/models/` (모델 파일 커밋)
- Create: `src/lib/human-client.ts`
- Modify: `src/lib/face-constants.ts` (FACE_MODEL_VERSION 실버전으로)

**Interfaces:**
- Produces:
  - `loadHuman(): Promise<Human>` — 싱글턴, dynamic import + `load()`/`warmup()`
  - `detectSingleFace(human: Human, video: HTMLVideoElement): Promise<DetectedFace | null>` — `interface DetectedFace { embedding: number[]; real: number; live: number; score: number }`. 얼굴이 정확히 1개가 아니거나 임베딩이 없으면 null
  - `FACE_QUALITY = { minScore: 0.7, minReal: 0.5, minLive: 0.5 }` — 등록·인식 공용 게이트 상수
  - `isQualityFace(face: DetectedFace): boolean`

- [ ] **Step 1: 의존성 설치 (정확 버전 고정)**

Run: `npm i -E @vladmandic/human && npm i -DE @vladmandic/human-models`
Expected: package.json에 캐럿(^) 없는 정확 버전 기록. 설치된 버전 확인: `node -e "console.log(require('@vladmandic/human/package.json').version)"`

- [ ] **Step 2: 얼굴 파이프라인 모델만 public/models/ 복사**

Run:
```bash
mkdir -p public/models
for m in blazeface facemesh faceres antispoof liveness; do
  cp node_modules/@vladmandic/human-models/models/$m.json public/models/
  cp node_modules/@vladmandic/human-models/models/$m.bin public/models/
done
ls -la public/models/
```
Expected: 10개 파일(각 .json+.bin), 합계 약 10MB. (파일명이 다르면 `ls node_modules/@vladmandic/human-models/models/` 로 실제 이름 확인 후 동일 5종을 복사 — detector=blazeface, mesh=facemesh, description=faceres, antispoof, liveness.)

- [ ] **Step 3: FACE_MODEL_VERSION 갱신** (`src/lib/face-constants.ts`)

Step 1에서 확인한 버전으로 교체 (예: 3.3.6이면):

```ts
export const FACE_MODEL_VERSION = "human@3.3.6";
```

- [ ] **Step 4: 클라이언트 로더 구현** (`src/lib/human-client.ts`)

```ts
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
```

주의: 이 파일은 클라이언트 컴포넌트에서만 import 한다 (Human 자체는 함수 내부 dynamic import라 서버 번들에는 타입만 남음). `new mod.Human(...)` 이 타입 에러를 내면 `new mod.default(...)` 로 교체 (버전에 따라 default export).

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공. (human이 서버 번들로 새어 들어가 실패하면 human-client의 정적 import가 남아있는지 확인 — 타입 import만 허용.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json public/models/ src/lib/human-client.ts src/lib/face-constants.ts
git commit -m "feat(facecheck): @vladmandic/human 고정 설치 + 모델 self-host + 로더"
```

---

### Task 8: FaceEnroll 등록 컴포넌트 + 학생/교사 페이지 연결

**Files:**
- Create: `src/components/FaceEnroll.tsx`
- Modify: `src/app/student/page.tsx` (개인정보 탭, PhotoUpload 아래 — 229행 부근)
- Modify: `src/app/teacher/page.tsx` (개인정보 탭, PhotoUpload 아래 — 172행 부근)

**Interfaces:**
- Consumes: `loadHuman`, `detectSingleFace`, `isQualityFace` (Task 7), `FACE_CONSENT_TEXT`, `FACE_CONSENT_VERSION` (Task 4), `FACE_MIN_EMBEDDINGS` (Task 2), API `/api/users/me/face` (Task 4)
- Produces: `<FaceEnroll />` — props 없음 (본인 세션 기준). 내부에서 SWR로 상태 조회.

- [ ] **Step 1: 컴포넌트 구현** (`src/components/FaceEnroll.tsx`)

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanFace, Trash2 } from "lucide-react";
import { FACE_CONSENT_TEXT, FACE_CONSENT_VERSION } from "@/lib/face-consent";
import { FACE_MIN_EMBEDDINGS } from "@/lib/face-constants";
import { detectSingleFace, isQualityFace, loadHuman } from "@/lib/human-client";

interface FaceStatus {
  registered: boolean;
  consentAt?: string;
}

type Phase = "idle" | "consent" | "capturing" | "saving";

const CAPTURE_INTERVAL_MS = 400;
const CAPTURE_GAP_MS = 700;

export function FaceEnroll() {
  const { data, mutate } = useSWR<FaceStatus>("/api/users/me/face", fetcher);
  const [phase, setPhase] = useState<Phase>("idle");
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const embeddingsRef = useRef<number[][]>([]);
  const stopRef = useRef(false);

  const stopCamera = useCallback(() => {
    stopRef.current = true;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCapture = useCallback(async () => {
    setPhase("capturing");
    setProgress(0);
    setMessage("카메라 준비 중...");
    embeddingsRef.current = [];
    stopRef.current = false;

    try {
      const [human, stream] = await Promise.all([
        loadHuman(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }),
      ]);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      setMessage("얼굴을 화면 중앙에 맞춰주세요");
      let lastCaptureAt = 0;

      while (!stopRef.current && embeddingsRef.current.length < FACE_MIN_EMBEDDINGS) {
        await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL_MS));
        if (stopRef.current) return;
        const face = await detectSingleFace(human, video);
        if (!face) {
          setMessage("얼굴이 인식되지 않습니다. 혼자, 정면으로 서 주세요");
          continue;
        }
        if (!isQualityFace(face)) {
          setMessage("조금 더 밝은 곳에서 정면을 바라봐 주세요");
          continue;
        }
        if (Date.now() - lastCaptureAt < CAPTURE_GAP_MS) continue;
        lastCaptureAt = Date.now();
        embeddingsRef.current.push(face.embedding);
        setProgress(embeddingsRef.current.length);
        setMessage(`촬영 ${embeddingsRef.current.length}/${FACE_MIN_EMBEDDINGS} — 고개를 살짝 움직여 주세요`);
      }

      if (embeddingsRef.current.length >= FACE_MIN_EMBEDDINGS) {
        setPhase("saving");
        setMessage("저장 중...");
        const res = await fetch("/api/users/me/face", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeddings: embeddingsRef.current,
            consentVersion: FACE_CONSENT_VERSION,
          }),
        });
        if (!res.ok) throw new Error("save failed");
        await mutate();
        setPhase("idle");
        setMessage(null);
      }
    } catch (err) {
      console.error("Face enroll error:", err);
      setPhase("idle");
      setMessage(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "카메라 권한을 허용해 주세요."
          : "등록에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      stopCamera();
    }
  }, [mutate, stopCamera]);

  const handleDelete = useCallback(async () => {
    if (!confirm("등록된 안면인식 정보를 삭제(동의 철회)하시겠습니까?")) return;
    await fetch("/api/users/me/face", { method: "DELETE" });
    await mutate();
  }, [mutate]);

  const handleCancelCapture = useCallback(() => {
    stopCamera();
    setPhase("idle");
    setMessage(null);
  }, [stopCamera]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
        <span className="text-muted-foreground whitespace-nowrap">안면인식</span>
        {data?.registered ? (
          <span className="flex items-center gap-2">
            <span className="font-medium text-emerald-600 whitespace-nowrap">
              등록됨 ({data.consentAt ? new Date(data.consentAt).toLocaleDateString("ko-KR") : ""})
            </span>
            <Button size="sm" variant="outline" className="rounded-xl min-h-9" onClick={() => { setAgreed(false); setPhase("consent"); }}>
              재등록
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl min-h-9 text-red-600" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </span>
        ) : (
          <Button size="sm" className="rounded-xl min-h-9 whitespace-nowrap" onClick={() => { setAgreed(false); setPhase("consent"); }}>
            <ScanFace className="h-4 w-4 mr-1" /> 얼굴 등록하기
          </Button>
        )}
      </div>
      {message && phase === "idle" && <p className="text-xs text-red-600">{message}</p>}

      {/* 동의 모달 */}
      <Dialog open={phase === "consent"} onOpenChange={(open) => !open && setPhase("idle")}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>안면인식정보 수집·이용 동의</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground rounded-xl bg-muted/40 p-3">
            {FACE_CONSENT_TEXT}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4" />
            위 내용에 동의합니다
          </label>
          <Button disabled={!agreed} onClick={startCapture} className="rounded-xl min-h-11 w-full">
            동의하고 촬영 시작
          </Button>
        </DialogContent>
      </Dialog>

      {/* 촬영 모달 */}
      <Dialog open={phase === "capturing" || phase === "saving"} onOpenChange={(open) => !open && handleCancelCapture()}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>얼굴 등록 ({progress}/{FACE_MIN_EMBEDDINGS})</DialogTitle>
          </DialogHeader>
          <video ref={videoRef} playsInline muted className="w-full rounded-xl bg-black aspect-[3/4] object-cover" />
          <p className="text-sm text-center text-muted-foreground">{message}</p>
          <Button variant="outline" onClick={handleCancelCapture} className="rounded-xl min-h-11 w-full">
            취소
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

주의: `@/components/ui/dialog`, `@/components/ui/button`, `@/lib/fetcher` 의 실제 export 이름은 기존 파일에서 확인 후 맞춘다 (student/teacher page가 이미 사용 중이므로 동일 import 경로 복사).

- [ ] **Step 2: 학생 페이지 연결** (`src/app/student/page.tsx`)

import 추가: `import { FaceEnroll } from "@/components/FaceEnroll";`
개인정보 탭 `<PhotoUpload ... />` 종료 태그 직후에 `<FaceEnroll />` 한 줄 추가.

- [ ] **Step 3: 교사 페이지 연결** (`src/app/teacher/page.tsx`)

동일하게 import + `<PhotoUpload ... />` 직후 `<FaceEnroll />` 추가.

- [ ] **Step 4: 빌드·테스트 확인**

Run: `npm run build && npm test`
Expected: 둘 다 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FaceEnroll.tsx src/app/student/page.tsx src/app/teacher/page.tsx
git commit -m "feat(facecheck): 얼굴 등록 UI(동의 절차 포함) — 학생·교사 개인정보 탭"
```

---

### Task 9: `/facecheck` 인식 페이지

**Files:**
- Create: `src/lib/checkin-sounds.ts`
- Create: `src/app/facecheck/page.tsx`

**Interfaces:**
- Consumes: `loadHuman`/`detectSingleFace`/`isQualityFace` (Task 7), `/api/facecheck` 응답 계약 (Task 6), `QRScanner` (기존), `postCheckInWithRetry` (기존 `@/lib/checkin-client`), `MEAL_LABEL` (기존)
- Produces: 공개 라우트 `/facecheck`

- [ ] **Step 1: 사운드 유틸 추출** (`src/lib/checkin-sounds.ts`)

`src/app/check/page.tsx` 52~124행의 AudioContext 싱글턴과 4개 함수를 **복사**해 export 한다 (check 페이지는 수정하지 않는다):

```ts
let _audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

export function playChime() { /* check/page.tsx 60~77행과 동일 구현 복사 */ }
export function playLongBeep() { /* 79~91행 복사 */ }
export function playDoubleBeep() { /* 93~110행 복사 */ }
export function playLockClick() { /* 112~124행 복사 */ }
```

(함수 본문은 check/page.tsx에서 그대로 복사 — 오실레이터 주파수·타이밍 변경 금지.)

- [ ] **Step 2: 페이지 구현** (`src/app/facecheck/page.tsx`)

구조 (기존 `/check` 온라인 흐름·결과 UI 패턴 준수):

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-kind-local";
import { postCheckInWithRetry } from "@/lib/checkin-client";
import { playChime, playDoubleBeep, playLongBeep } from "@/lib/checkin-sounds";
import { detectSingleFace, isQualityFace, loadHuman } from "@/lib/human-client";
import { QrCode, ScanFace } from "lucide-react";

interface FaceCheckUser {
  id: number;
  name: string;
  role: string;
  grade?: number | null;
  classNum?: number | null;
  number?: number | null;
  photoUrl?: string | null;
}

interface FaceCheckResult {
  success: boolean;
  matched?: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  needType?: boolean;
  error?: string;
  user?: FaceCheckUser;
  type?: string;
  checkedAt?: string;
  mealKind?: MealKind;
}

interface PendingTeacher {
  user: FaceCheckUser;
  mealKind: MealKind;
  embedding: number[];
}

const DETECT_INTERVAL_MS = 300;
const RESULT_DISPLAY_MS = 2000;
const TEACHER_TIMEOUT_S = 10;

export default function FaceCheckPage() {
  const [mode, setMode] = useState<"face" | "qr">("face");
  const [result, setResult] = useState<FaceCheckResult | null>(null);
  const [pending, setPending] = useState<PendingTeacher | null>(null);
  const [countdown, setCountdown] = useState(TEACHER_TIMEOUT_S);
  const [status, setStatus] = useState("카메라 준비 중...");
  const [modelFailed, setModelFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);      // API 호출·결과 표시·선택 대기 중 스캔 정지
  const pendingRef = useRef<PendingTeacher | null>(null);

  // --- 결과 처리 (학생 성공/중복/미자격/미매칭 공용) ---
  const applyResult = useCallback((json: FaceCheckResult) => {
    if (json.needType && json.user && json.mealKind) return; // 교사 분기에서 별도 처리
    if (!json.matched && !json.success) {
      // 미매칭: 전체 화면 결과 대신 상태 문구만 (지나가는 사람마다 삐 소리 방지)
      setStatus(json.error || "인식되지 않았습니다. 다시 서 주세요.");
      setTimeout(() => { busyRef.current = false; }, 800);
      return;
    }
    setResult(json);
    if (json.success) playChime();
    else if (json.duplicate || json.notApplicant) playLongBeep();
    else playDoubleBeep();
    setTimeout(() => {
      setResult(null);
      busyRef.current = false;
    }, RESULT_DISPLAY_MS);
  }, []);

  // --- 1단계 호출 ---
  const submitEmbedding = useCallback(async (embedding: number[]) => {
    try {
      const res = await fetch("/api/facecheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding }),
      });
      const json: FaceCheckResult = await res.json();
      if (json.needType && json.user && json.mealKind) {
        const p = { user: json.user, mealKind: json.mealKind, embedding };
        pendingRef.current = p;
        setPending(p);
        setCountdown(TEACHER_TIMEOUT_S);
        return; // busyRef 유지 — 선택 대기
      }
      applyResult(json);
    } catch {
      setStatus("서버 연결 오류 — 잠시 후 다시 시도됩니다");
      setTimeout(() => { busyRef.current = false; }, 1500);
    }
  }, [applyResult]);

  // --- 2단계 호출 (교사 type 확정 / 자동 개인) ---
  const submitTeacherType = useCallback(async (type: "WORK" | "PERSONAL") => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!p) return;
    try {
      const res = await fetch("/api/facecheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding: p.embedding, type }),
      });
      applyResult(await res.json());
    } catch {
      setStatus("서버 연결 오류");
      setTimeout(() => { busyRef.current = false; }, 1500);
    }
  }, [applyResult]);

  const cancelTeacher = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
    busyRef.current = false;
  }, []);

  // --- 교사 10초 카운트다운 → 자동 "개인" ---
  useEffect(() => {
    if (!pending) return;
    if (countdown <= 0) {
      submitTeacherType("PERSONAL");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [pending, countdown, submitTeacherType]);

  // --- 얼굴 감지 루프 ---
  useEffect(() => {
    if (mode !== "face") return;
    let cancelled = false;

    (async () => {
      try {
        const [human, stream] = await Promise.all([
          loadHuman(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }),
        ]);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("얼굴을 화면에 보여주세요");

        while (!cancelled) {
          await new Promise((r) => setTimeout(r, DETECT_INTERVAL_MS));
          if (cancelled || busyRef.current) continue;
          const face = await detectSingleFace(human, video);
          if (!face || !isQualityFace(face)) continue;
          busyRef.current = true;
          setStatus("인식 중...");
          await submitEmbedding(face.embedding);
        }
      } catch (err) {
        console.error("Face mode init error:", err);
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setStatus("카메라 권한을 허용해 주세요");
        } else {
          setModelFailed(true);
          setStatus("안면인식을 사용할 수 없습니다 — QR 모드를 이용하세요");
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode, submitEmbedding]);

  // --- QR 폴백 (온라인 JWT QR 전용 — 인쇄 카드 QR은 /check 사용) ---
  const handleQrScan = useCallback(async (data: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const json = await postCheckInWithRetry(data);
      applyResult({ ...json, matched: true });
    } catch {
      applyResult({ success: false, matched: true, error: "서버 연결 오류" });
    }
  }, [applyResult]);

  /* 렌더링: /check 와 동일한 구조 —
     - bgClass: result 상태별 배경 전환 (check/page.tsx 551~557행과 동일 로직, 복사)
     - 좌: 카메라 영역 (face 모드: <video>, qr 모드: <QRScanner onScan={handleQrScan} />)
     - 우: 결과 카드 (check/page.tsx 601~652행 결과 카드 markup 복사, FaceCheckResult 필드 사용)
     - 결과 없을 때 대기 안내: ScanFace 아이콘 + status 문구
     - 교사 선택 오버레이 (pending 시): 이름·사진 + 아래 3버튼
     - 하단 고정 모드 전환 버튼: [QR로 체크인] / [얼굴로 체크인] (min-h-11, whitespace-nowrap)
  */
  // 교사 선택 오버레이 JSX:
  //   <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
  //     <div className="glass card-elevated rounded-2xl p-6 w-full max-w-md text-center space-y-4">
  //       {/* 사진(w-20 h-20 rounded-2xl) + "{name} 선생님" + MEAL_LABEL[mealKind] */}
  //       <div className="flex gap-2">
  //         <button onClick={() => submitTeacherType("WORK")} className="flex-1 min-h-14 rounded-xl bg-blue-600 text-white text-lg font-bold whitespace-nowrap">근무</button>
  //         <button onClick={() => submitTeacherType("PERSONAL")} className="flex-1 min-h-14 rounded-xl bg-emerald-600 text-white text-lg font-bold whitespace-nowrap">개인 ({countdown})</button>
  //         <button onClick={cancelTeacher} className="flex-1 min-h-14 rounded-xl bg-gray-500 text-white text-lg font-bold whitespace-nowrap">취소</button>
  //       </div>
  //     </div>
  //   </div>
}
```

위 스켈레톤의 렌더링 주석 부분은 `/check` 페이지(559~712행)의 마크업을 복사해 완성한다. 규칙:
- `min-h-screen` 은 그대로 두되 새로 쓰는 높이 계산에는 `100dvh` 사용
- 상태바에는 "안면인식 체크인" 라벨 + 모드 표시
- 오프라인/로컬 모드 UI(동기화 푸터 등)는 **가져오지 않는다** (온라인 전용)

- [ ] **Step 3: 빌드·테스트 확인**

Run: `npm run build && npm test`
Expected: 둘 다 PASS. 빌드 출력에서 `/facecheck` 라우트 생성 확인.

- [ ] **Step 4: Commit**

```bash
git add src/lib/checkin-sounds.ts src/app/facecheck/page.tsx
git commit -m "feat(facecheck): 안면인식 체크인 페이지 (교사 근무/개인/취소, QR 폴백)"
```

---

### Task 10: 최종 검증 + 문서 갱신

**Files:**
- Modify: `.claude/PROJECT_MAP.md` (에이전트가 갱신)

- [ ] **Step 1: 전체 게이트**

Run: `npm run build && npm test`
Expected: 모두 PASS.

- [ ] **Step 2: (오케스트레이터) responsive-ui-reviewer 에이전트 실행**

대상: `src/components/FaceEnroll.tsx`, `src/app/facecheck/page.tsx`, student/teacher page diff. 위반 보고 시 수정 후 재검.

- [ ] **Step 3: (오케스트레이터) project-map-updater 에이전트 실행**

새 라우트(`/facecheck`), API 2종, FaceProfile 모델, 새 lib/컴포넌트, 의존성(@vladmandic/human)을 PROJECT_MAP에 반영.

- [ ] **Step 4: 수동 검증 체크리스트 (사용자와 함께)**

1. `npm run dev` → `/student` 개인정보 탭에서 동의 → 등록 (폰/노트북 웹캠)
2. `/facecheck` 에서 본인 얼굴 인식 → 체크인 확인 (석식 시간대·신청일이어야 함 — 필요시 관리자에서 식사 시간 임시 조정)
3. 교사 계정 등록 → 인식 → 3버튼·10초 자동 "개인" 확인
4. 중복 체크인·미신청 학생·사진 스푸핑(폰 화면 사진) 거부 확인
5. QR 폴백 모드 전환 동작 확인

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "chore(facecheck): 최종 검증 및 프로젝트 맵 갱신"
git push origin feat/facecheck
```

main 머지는 사용자 승인 + 실기기 검증 후 별도 진행 (CLAUDE.md 워크플로우).

---

## Self-Review 결과

- **스펙 커버리지**: 스키마(§6→T1), 매칭 정책(§8→T2·T5·T6), 동의(§9→T4·T8), 등록 API(§7→T4), 캐시(§7→T5), facecheck API 2단계(§7→T6), 기술 선정·모델 self-host(§4→T7), 등록 UI(§9→T8), 인식 페이지·교사 3버튼·10초 자동 개인·QR 폴백(§10→T9), 에러 처리(§11→T6·T8·T9), 테스트(§12→각 태스크+T10). 누락 없음.
- **타입 일관성**: `FaceCandidate`/`findBestMatch`(T2) ↔ 캐시(T5) ↔ 라우트(T6), `DetectedFace`(T7) ↔ T8·T9, API 응답 계약(T6) ↔ T9 소비 — 서명 일치 확인.
- **주의 표시**: Human의 export 형태(`Human` vs default)와 모델 파일명은 설치 버전에 따라 다를 수 있어 T7에 확인 단계를 명시함. shadcn Dialog/Button import 경로는 기존 페이지에서 복사하도록 T8에 명시.
