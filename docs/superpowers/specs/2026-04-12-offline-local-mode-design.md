# Offline/Local Mode — 오프라인 체크인 설계

> 날짜: 2026-04-12
> 상태: 승인됨

## 배경

식당 입구에 WiFi가 없어 태블릿(QR 스캐너)이 인터넷에 접속할 수 없음.
학생 폰은 5G 모바일 인터넷으로 항상 온라인.
태블릿이 오프라인에서 체크인을 처리하고, 온라인 환경에서 서버와 동기화하는 "로컬 모드"를 추가한다.
기존 온라인 모드는 그대로 유지한다.

## 접근 방식

Service Worker + IndexedDB 기반 Full PWA.
Workbox 등 외부 라이브러리 없이 직접 구현하여 동작을 완전히 제어한다.

---

## 1. 모드 관리 시스템

### 서버 측 — SystemSetting 테이블

```prisma
model SystemSetting {
  key       String   @id          // "operationMode", "qrGeneration"
  value     String                // "online" | "local", "1", "2", ...
  updatedAt DateTime @updatedAt
}
```

- `operationMode`: `"online"` (기본) 또는 `"local"`
- `qrGeneration`: 숫자 문자열. QR 새로고침 시 +1 증가.

### API

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/system/settings` | GET | 공개 | 현재 모드 + qrGeneration 조회 |
| `/api/system/settings` | PUT | 관리자 | 모드 변경 / QR 새로고침 |

### 관리자 UI

관리자 페이지에 "시스템 설정" 섹션 추가:
- 온라인/로컬 모드 토글 버튼
- "QR 전체 새로고침" 버튼 (qrGeneration 증가)
- 전환 시 확인 다이얼로그
- QR 새로고침 시 "태블릿 동기화 후 새 QR이 적용됩니다" 안내 문구

### 태블릿 동작

1. 온라인 상태에서 동기화 시 `operationMode`, `qrGeneration`을 IndexedDB에 저장
2. 오프라인에서는 캐시된 모드로 동작
3. `/check` 페이지 로드 시 IndexedDB에서 모드 확인 → 로컬/온라인 분기

---

## 2. QR 코드 체계

### 고유 QR 포맷

```
posanmeal:{userId}:{generation}:{type}
```

예시:
- 학생 (id=42, gen=3): `posanmeal:42:3:STUDENT`
- 교사 근무 (id=7, gen=3): `posanmeal:7:3:WORK`
- 교사 개인 (id=7, gen=3): `posanmeal:7:3:PERSONAL`

`posanmeal:` 접두사로 일반 QR과 구분한다.

### 학생 앱 — QR 표시

- 로컬 모드: 고유 QR 1개 표시. 타이머 숨김. "로컬 모드 — 고유 QR코드" 안내.
- 온라인 모드: 기존 JWT 3분 토큰 QR 그대로 (변경 없음).
- 학생은 항상 온라인이므로 서버 API로 현재 모드를 확인한다.

### 교사 앱 — QR 표시

- 로컬 모드: 근무/개인 탭 전환으로 2개의 고유 QR 표시.
- 온라인 모드: 기존 방식 유지.

### QR 새로고침 (위조 방지)

관리자가 "QR 전체 새로고침" 실행 → `qrGeneration` +1 → 학생 앱은 즉시 새 QR 표시 (온라인이므로) → 태블릿은 다음 동기화 시 새 generation 반영 → 구 generation QR은 거부됨.

---

## 3. IndexedDB 스키마

DB 이름: `posanmeal-local`

### Store: settings (key-value)

| key | value 예시 | 설명 |
|-----|-----------|------|
| `operationMode` | `"local"` | 현재 운영 모드 |
| `qrGeneration` | `3` | 현재 QR 세대 번호 |
| `lastSyncAt` | `"2026-04-12T18:30:00"` | 마지막 동기화 시각 |
| `lastUserSyncAt` | `"2026-04-12T15:00:00"` | 마지막 사용자 데이터 동기화 시각 |
| `adminToken` | `"..."` | 동기화용 관리자 세션 토큰 |

### Store: users (keyPath: id)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | number | userId (PK) |
| `name` | string | 이름 |
| `role` | string | STUDENT / TEACHER |
| `grade` | number? | 학년 |
| `classNum` | number? | 반 |
| `number` | number? | 번호 |

인덱스: `[role, grade, classNum, number]`

### Store: mealPeriods (keyPath: userId)

| 필드 | 타입 | 설명 |
|------|------|------|
| `userId` | number | 사용자 ID (PK) |
| `startDate` | string | 시작일 `"2026-04-01"` |
| `endDate` | string | 종료일 `"2026-04-30"` |

### Store: checkins (keyPath: auto-increment)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | number | 자동 증가 PK |
| `userId` | number | 사용자 ID |
| `date` | string | 체크인 날짜 `"2026-04-12"` |
| `checkedAt` | string | 체크인 시각 ISO |
| `type` | string | STUDENT / WORK / PERSONAL |
| `synced` | boolean | 서버 동기화 완료 여부 |

인덱스:
- `[userId, date]` (unique) — 중복 체크인 방지
- `synced` — 미동기화 건 조회

### 데이터 생명주기

| 이벤트 | 동작 |
|--------|------|
| 동기화 (다운로드) | `settings`, `users`, `mealPeriods` 전체 교체 |
| QR 스캔 체크인 | `checkins`에 `synced: false`로 추가 |
| 동기화 (업로드) | `synced: false` → 서버 전송 → 성공 시 `synced: true` |
| "동기화된 체크인 정리" | `synced: true`인 항목만 삭제 |
| "전체 초기화" | 모든 store 비우기 (확인 다이얼로그 필수) |

관리자가 명시적으로 초기화하기 전까지 모든 로컬 데이터는 영구 유지된다.

---

## 4. Service Worker & 캐싱

### 파일

`public/sw.js`로 직접 작성. Next.js 빌드 파이프라인과 분리.

### 캐싱 전략

| 대상 | 전략 | 이유 |
|------|------|------|
| `/check` 페이지 HTML | Cache First | 오프라인 필수 |
| `/_next/static/*` JS/CSS | Cache First | 앱 동작 필수 |
| 아이콘, manifest | Cache First | PWA 표시용 |
| `/api/*` | Network Only | 데이터는 IndexedDB로 관리 |
| 기타 페이지 | Network First | 오프라인 불필요 |

### 캐시 버전 관리

```js
const CACHE_VERSION = 'posanmeal-v1';
```

SW 업데이트 시 버전 번호 변경 → `activate`에서 구버전 캐시 삭제.

### SW 등록

`/check` 페이지에서만 등록:

```tsx
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}, []);
```

다른 페이지는 항상 온라인이므로 SW 불필요.

### SW scope

`/`로 등록하되, `fetch` 핸들러에서 `/check`와 정적 자산만 캐싱 처리. API 요청은 가로채지 않는다.

---

## 5. 로컬 모드 체크인 흐름

### 전체 흐름

```
학생 폰 QR 표시 → 태블릿 카메라 스캔 → JS 파싱 → IndexedDB 검증 → IndexedDB 저장 → 결과 표시
```

서버 통신 없이 태블릿 내부에서 완결된다.

### 단계별 처리

**1. QR 파싱**
- `posanmeal:{userId}:{generation}:{type}` 포맷 검증
- 포맷 오류 → "잘못된 QR코드입니다" + 오류 사운드

**2. Generation 검증**
- IndexedDB `qrGeneration`과 비교
- 불일치 → "QR코드가 만료되었습니다. 학생 앱에서 새 QR을 확인하세요" + 오류 사운드

**3. 사용자 조회**
- IndexedDB `users`에서 userId 조회
- 없음 → "미등록 사용자입니다" + 오류 사운드
- role/type 불일치 (STUDENT인데 WORK) → "잘못된 QR 유형입니다" + 오류 사운드

**4. 석식 대상자 확인**
- IndexedDB `mealPeriods`에서 userId 조회
- 오늘 날짜가 startDate~endDate 범위에 포함되는지 로컬 계산
- 대상 아님 → "오늘은 석식 대상이 아닙니다" + 오류 사운드

**5. 중복 체크**
- IndexedDB `checkins` [userId, date] 인덱스 조회
- 존재 → "이미 체크인되었습니다 (HH:MM)" + 중복 사운드

**6. 체크인 저장**
- `{ userId, date, checkedAt, type, synced: false }` 저장
- 쓰기 실패 → "저장 오류가 발생했습니다. 다시 스캔해 주세요" + 오류 사운드
- 성공 → "2-3-15 김OO — 체크인 완료" + 승인 사운드

**7. 결과 표시 (2초 후 자동 초기화)**

| 상태 | 배경색 | 사운드 | 표시 |
|------|--------|--------|------|
| 승인 | 초록 | 딩동 | "2-3-15 김OO 체크인 완료" |
| 중복 | 노랑 | 긴 삐 | "이미 체크인 (18:05)" |
| 거부 | 빨강 | 삐삐 | 구체적 거부 사유 |
| 오류 | 빨강 | 삐삐 | "저장 오류 — 다시 스캔" |

### 모드 분기

`/check` 로드 시 IndexedDB `operationMode` 확인:
- `"local"` → 위 로컬 흐름
- `"online"` 또는 미설정 → 기존 서버 API 호출 (변경 없음)

---

## 6. 동기화 시스템

### 방향

| 방향 | 데이터 | 설명 |
|------|--------|------|
| 서버 → 태블릿 | settings, users, mealPeriods | 서버가 항상 최신 (단방향) |
| 태블릿 → 서버 | checkins (synced: false) | 태블릿이 생성 |

### 동기화 API

**`GET /api/sync/download`** (관리자 인증)

```json
{
  "operationMode": "local",
  "qrGeneration": 3,
  "users": [{ "id": 1, "name": "김OO", "role": "STUDENT", "grade": 2, "classNum": 3, "number": 15 }],
  "mealPeriods": [{ "userId": 1, "startDate": "2026-04-01", "endDate": "2026-04-30" }],
  "serverTime": "2026-04-12T18:30:00+09:00"
}
```

전체 데이터 한 번에 전송 (1,500명 기준 ~400KB).

**`POST /api/sync/upload`** (관리자 인증)

요청:
```json
{
  "checkins": [
    { "userId": 42, "date": "2026-04-12", "checkedAt": "2026-04-12T18:05:00+09:00", "type": "STUDENT" }
  ]
}
```

응답:
```json
{
  "accepted": 45,
  "duplicates": 3,
  "rejected": [{ "userId": 42, "date": "2026-04-12", "reason": "NO_MEAL_PERIOD" }]
}
```

- `@@unique([userId, date])`로 중복 자동 무시
- 서버가 MealPeriod도 재검증 (로컬 데이터 오래된 경우 방어)

### 동기화 트리거

**자동**: 태블릿 `online` 이벤트 감지 → 3초 대기 (연결 안정화) → 업로드 → 다운로드.
업로드 우선: 체크인 기록 유실 방지가 최우선.

**수동**: `/check` 페이지의 "동기화 실행" 버튼.
네트워크 없으면 "인터넷 연결이 없습니다" 토스트.

### 동기화 인증

태블릿에서 최초 1회 관리자 로그인 → 세션 토큰을 IndexedDB `settings.adminToken`에 저장.
토큰 만료 시 "관리자 재로그인이 필요합니다" 안내.

### 오류 처리

| 상황 | 처리 |
|------|------|
| 업로드 중 네트워크 끊김 | 미전송 건 `synced: false` 유지, 다음 동기화 재시도 |
| 업로드 부분 성공 | 성공한 건만 `synced: true`, 나머지 재시도 |
| 다운로드 실패 | 기존 로컬 데이터 유지, 토스트 알림 |
| 서버 500 에러 | "서버 오류" 토스트, 로컬 데이터 변경 없음 |

---

## 7. UI 변경사항

### 관리자 페이지 (`/admin`) — 시스템 설정 섹션

- 온라인/로컬 모드 토글 버튼 + 확인 다이얼로그
- QR 세대 번호 표시 + "QR 전체 새로고침" 버튼
- "태블릿 동기화 후 적용됩니다" 안내 문구

### 학생 페이지 (`/student`) — QR 탭

- 로컬 모드: 고유 QR 1개 표시, 타이머 숨김, "로컬 모드" 안내
- 온라인 모드: 변경 없음

### 교사 페이지 (`/teacher`) — QR 탭

- 로컬 모드: 근무/개인 탭에 각각 고유 QR 표시
- 온라인 모드: 변경 없음

### 체크인 페이지 (`/check`) — 태블릿

- 상단 상태바: 연결 상태 (초록/빨강) + 현재 모드 + 미전송 건수
- 하단: 마지막 동기화 시각 + "동기화 실행" 버튼
- 데이터 관리: "동기화된 체크인 정리" / "전체 초기화" 버튼
- 온라인 모드일 때: 상태바만 표시, 동기화 영역 숨김, 기존 동작 유지

---

## 8. 세션 만료 변경

모든 사용자(관리자/학생/교사)의 세션 토큰을 1년 만료로 변경:

```ts
// src/auth.ts
session: {
  strategy: "jwt",
  maxAge: 60 * 60 * 24 * 365, // 365일 (기존 60일)
  updateAge: 60 * 60 * 24,    // rolling refresh 1일 유지
},
jwt: {
  maxAge: 60 * 60 * 24 * 365, // 365일
},
```

---

## 9. 엣지 케이스 및 안전장치

### 모드 전환 타이밍

- 로컬→온라인 전환 시 미전송 체크인 있으면 "동기화 후 모드 전환" 경고
- 온라인→로컬 전환 시 태블릿은 다음 동기화까지 구 모드로 동작 (문제 없음)
- QR 새로고침 후 태블릿 미동기화 시 학생의 새 QR 거부됨 → 관리자 UI에 안내

### 태블릿 브라우저

- 브라우저 캐시 삭제 시 IndexedDB + SW 캐시 모두 소실 → 온라인에서 재동기화 필요
- 저장 공간 부족 시 "동기화된 체크인 정리" 안내
- 1탭 사용 권장 (여러 탭은 IndexedDB 공유로 데이터 문제는 없으나 UX 혼란 가능)

### 시간

- 체크인 `date`는 태블릿 로컬 시간 기준
- 동기화 시 `serverTime`과 ±30분 이상 차이나면 "태블릿 시계 확인" 경고

### 데이터 정합성

- 여러 태블릿 동일 학생 체크인 → 양쪽 로컬 저장 성공, 서버 업로드 시 `@@unique` 중복 무시
- 서버에서 MealPeriod 삭제 후 로컬 체크인 업로드 → rejected 응답, 관리자에게 표시

---

## 변경 범위 요약

### 새로 추가

| 항목 | 설명 |
|------|------|
| `SystemSetting` 모델 | Prisma 스키마 |
| `GET/PUT /api/system/settings` | 모드 관리 API |
| `GET /api/sync/download` | 동기화 다운로드 API |
| `POST /api/sync/upload` | 동기화 업로드 API |
| `public/sw.js` | Service Worker |
| `src/lib/local-db.ts` | IndexedDB 래퍼 (CRUD, 동기화 로직) |
| `/check` 상태바/동기화 UI | 태블릿용 오프라인 UI |
| `/admin` 시스템 설정 섹션 | 모드 전환/QR 새로고침 UI |

### 기존 수정

| 항목 | 변경 내용 |
|------|-----------|
| `prisma/schema.prisma` | `SystemSetting` 모델 추가 |
| `src/auth.ts` | 세션 maxAge 60일 → 365일 |
| `src/app/check/page.tsx` | SW 등록 + 로컬/온라인 모드 분기 + 상태바 |
| `src/app/student/page.tsx` | QR 탭에서 모드별 QR 표시 분기 |
| `src/app/teacher/page.tsx` | QR 탭에서 모드별 QR 표시 분기 |
| `src/app/admin/page.tsx` | 시스템 설정 섹션 추가 |
| `src/components/QRGenerator.tsx` | 고유 QR 생성 모드 추가 |
