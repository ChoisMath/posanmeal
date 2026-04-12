# 석식 신청 시스템 설계 스펙

## 1. 개요

### 배경
현재 posanmeal은 관리자가 학생별 MealPeriod를 직접 설정하는 방식. 학생 스스로 석식 신청이 불가하고, MealPeriod가 학생당 1개(`@unique`)로 제한되어 월별 신청 관리가 불가능함.

### 목표
- 학생이 웹앱에서 직접 석식/조식/기타 신청 (서명 포함)
- 관리자가 신청 공고 생성/관리, 신청자 명단 Excel 다운로드
- 기존 MealPeriod를 신청 기반 시스템으로 전환하여 복수 기간 지원

## 2. DB 스키마 변경

### 신규 테이블

#### MealApplication (신청 공고)
관리자가 생성하는 신청 공고.

```prisma
model MealApplication {
  id          Int       @id @default(autoincrement())
  title       String    // "5월 석식", "5월 주말 조식"
  description String?   // 안내 설명문
  type        String    // "DINNER" | "BREAKFAST" | "OTHER"

  applyStart  DateTime  @db.Date  // 신청 접수 시작일
  applyEnd    DateTime  @db.Date  // 신청 접수 마감일

  mealStart   DateTime? @db.Date  // 식사 시작일 (null = 명단 수합용)
  mealEnd     DateTime? @db.Date  // 식사 마감일 (null = 명단 수합용)

  status      String    @default("OPEN")  // "OPEN" | "CLOSED"
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  registrations MealRegistration[]

  @@index([status])
  @@index([applyStart, applyEnd])
}
```

#### MealRegistration (학생 신청 내역)
학생의 개별 신청 기록. 서명 이미지를 Base64 Text로 저장.

```prisma
model MealRegistration {
  id            Int       @id @default(autoincrement())
  applicationId Int
  userId        Int
  signature     String    @db.Text   // Base64 PNG 서명 이미지
  status        String    @default("APPROVED")  // "APPROVED" | "CANCELLED"
  createdAt     DateTime  @default(now())
  cancelledAt   DateTime?
  cancelledBy   String?   // "STUDENT" | "ADMIN"
  addedBy       String?   // null = 학생 본인 신청, "ADMIN" = 관리자 직접 추가

  application   MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([applicationId, userId])
  @@index([userId])
  @@index([applicationId, status])
}
```

### 삭제 테이블
- `MealPeriod` — 완전 삭제. 신청 기반 자격 판단으로 대체.

### User 모델 변경
```prisma
model User {
  // 기존 필드 유지
  mealPeriod    MealPeriod?      // 삭제
  registrations MealRegistration[] // 추가
}
```

### 마이그레이션 전략
1. MealApplication + MealRegistration 테이블 생성
2. 기존 MealPeriod 데이터가 있는 경우: 자동 생성된 MealApplication으로 마이그레이션 (선택적)
3. MealPeriod 테이블 삭제

## 3. QR 자격 판단 로직 변경

### 기존 (MealPeriod 기반)
```typescript
const mp = await prisma.mealPeriod.findUnique({ where: { userId } });
if (!mp || today < mp.startDate || today > mp.endDate) → QR 거부
```

### 변경 (Registration 기반)
```typescript
const active = await prisma.mealRegistration.findFirst({
  where: {
    userId,
    status: "APPROVED",
    application: {
      mealStart: { not: null, lte: today },
      mealEnd:   { not: null, gte: today },
    },
  },
});
if (!active) → QR 거부
```

`mealStart`/`mealEnd`가 null인 명단 수합용 신청은 QR 자격에 영향 없음.

## 4. 로컬 모드 (IndexedDB) 변경

### 방안: 서버 계산 + 결과만 동기화
서버가 "오늘 기준 QR 자격 있는 유저 ID 목록"을 계산하여 내려줌.

#### sync/download 응답 변경
```typescript
// 기존
{ users, mealPeriods: [{ userId, startDate, endDate }], ... }

// 변경 후
{ users, eligibleUserIds: [1, 5, 12, 33, ...], ... }
```

#### local-db.ts 변경
- `mealPeriods` ObjectStore → `eligibleUsers` ObjectStore로 교체 (또는 settings에 JSON 저장)
- `getMealPeriod(userId)` → `isEligible(userId)` (Set lookup)
- DB_VERSION 증가 (v2 → v3)

#### 로컬 QR 자격 확인
```typescript
// 기존: getMealPeriod(userId)로 기간 비교
// 변경: eligibleUserIds에 포함 여부만 확인
if (eligibleUserIds.has(userId)) → QR 허용
```

## 5. API 설계

### 신규 API Routes

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/applications` | GET | 학생/교사 | 활성 공고 목록 (신청기간 내) + 본인 신청 상태 |
| `/api/applications/[id]/register` | POST | 학생 | 신청 (서명 Base64 포함) |
| `/api/applications/[id]/register` | DELETE | 학생 | 신청 취소 (신청기간 내만) |
| `/api/applications/my` | GET | 학생 | 본인 신청 내역 전체 |
| `/api/admin/applications` | GET | 관리자 | 전체 공고 목록 |
| `/api/admin/applications` | POST | 관리자 | 공고 생성 |
| `/api/admin/applications/[id]` | PUT | 관리자 | 공고 수정 |
| `/api/admin/applications/[id]` | DELETE | 관리자 | 공고 삭제 |
| `/api/admin/applications/[id]/close` | POST | 관리자 | 공고 마감 |
| `/api/admin/applications/[id]/registrations` | GET | 관리자 | 신청자 명단 |
| `/api/admin/applications/[id]/registrations` | POST | 관리자 | 학생 직접 추가 |
| `/api/admin/applications/[id]/registrations/[regId]` | PATCH | 관리자 | 신청 취소/복원 |
| `/api/admin/applications/[id]/export` | GET | 관리자 | Excel 다운로드 |

### 기존 API 변경

| API | 변경 내용 |
|-----|-----------|
| `/api/qr/token` | MealPeriod 조회 → MealRegistration 기반 자격 확인 |
| `/api/users/me` | mealPeriod 대신 활성 registrations 반환 |
| `/api/sync/download` | mealPeriods → eligibleUserIds |
| `/api/admin/users` | mealPeriod 관련 로직 제거 |
| `/api/admin/meal-periods` | 삭제 |

## 6. 학생 UI

### 탭 구조 변경
- 현재: QR, 식단, 개인정보, 확인 (4탭)
- 변경: QR, **신청** (조건부), 식단, 개인정보, 확인
- "신청" 탭: 활성 공고가 있거나 본인 신청 내역이 있을 때만 표시
- 활성 공고 수를 뱃지로 표시

### 신청 탭 내용
- **신청 가능 공고**: 종류 뱃지(석식/조식/기타), 제목, 설명, 신청기간, 식사기간, "신청하기" 버튼
- **신청 완료 공고**: 신청일, 상태, "신청 취소" 버튼 (신청기간 내만 활성)
- **명단 수합용 공고**: "명단 수합용 (별도 식사기간 없음)" 표시

### 신청 모달
- 학생 정보 표시 (이름, 학년/반/번호, 식사기간)
- Canvas 기반 서명 패드 (터치/마우스 지원)
- "서명 지우기" 버튼
- "신청 완료" 버튼 (서명 필수)

### 모바일 반응형
- 텍스트 줄바꿈 방지: `white-space: nowrap` + `text-fit-*` 클래스 활용
- 가로 스크롤: 테이블 등 넓은 콘텐츠는 `overflow-x: auto` 컨테이너

## 7. 관리자 UI

### "신청관리" 탭 추가
기존 탭(사용자 관리, 석식 확인, 당일 현황, 설정)에 "신청관리" 탭 추가.

### 공고 목록 화면
- "+공고" 버튼 (우측 상단)
- 공고 카드: 종류 뱃지, 상태(진행중/마감), 제목, 기간 정보, 신청자 수
- 진행중 공고: 명단, Excel, 수정, 마감 버튼
- 마감 공고: 명단, Excel 버튼

### 공고 생성/수정 다이얼로그
- 종류 선택: 석식/조식/기타 (토글 버튼)
- 제목 입력
- 설명 입력 (선택)
- 신청 시작일/마감일
- 식사 시작일/마감일 (선택 — 비워두면 명단 수합용)

### 신청자 명단 다이얼로그
- 학년 필터 (전체/1학년/2학년/3학년)
- 테이블: 학년, 반, 번호, 이름, 신청일, 상태, 관리(취소/복원)
- 관리자 추가: "+학생 추가" 버튼 → 학생 검색/선택 (서명 없이 추가, `addedBy="ADMIN"`, `signature=""`, 명단에서 "관리자 추가" 표시)
- Excel 다운로드: 학년/반/번호/이름/신청일시 포함

### 모바일 반응형
- 모든 텍스트 줄바꿈 방지
- 테이블: `overflow-x: auto` 가로 스크롤
- 버튼: 아이콘으로 축소되지 않고 텍스트 유지 + `nowrap`

## 8. 기존 기능 영향 분석

### 영향받는 파일

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `prisma/schema.prisma` | 수정 | MealApplication, MealRegistration 추가, MealPeriod 삭제 |
| `src/app/api/qr/token/route.ts` | 수정 | QR 자격 판단 로직 변경 |
| `src/app/api/users/me/route.ts` | 수정 | mealPeriod → registrations |
| `src/app/api/sync/download/route.ts` | 수정 | mealPeriods → eligibleUserIds |
| `src/app/api/admin/meal-periods/route.ts` | 삭제 | 더 이상 필요 없음 |
| `src/app/api/admin/users/route.ts` | 수정 | mealPeriod 관련 로직 제거 |
| `src/app/student/page.tsx` | 수정 | 신청 탭 추가, mealPeriod 참조 제거 |
| `src/app/admin/page.tsx` | 수정 | 신청관리 탭 추가, 사용자 편집에서 mealPeriod 제거 |
| `src/components/QRGenerator.tsx` | 수정 | mealPeriod 대신 registration 기반 표시 |
| `src/components/AdminMealTable.tsx` | 수정 | mealPeriod 참조 제거/변경 |
| `src/lib/local-db.ts` | 수정 | mealPeriods → eligibleUsers, DB_VERSION 3 |
| `src/middleware.ts` | 수정 | 신규 API 경로 인증 규칙 추가 |
| `src/app/check/page.tsx` | 수정 | 로컬 모드 자격 확인 로직 변경 |

### 신규 파일

| 파일 | 설명 |
|------|------|
| `src/app/api/applications/route.ts` | 학생용 공고 목록 API |
| `src/app/api/applications/[id]/register/route.ts` | 학생 신청/취소 API |
| `src/app/api/applications/my/route.ts` | 학생 본인 신청 내역 API |
| `src/app/api/admin/applications/route.ts` | 관리자 공고 CRUD |
| `src/app/api/admin/applications/[id]/route.ts` | 관리자 공고 수정/삭제 |
| `src/app/api/admin/applications/[id]/close/route.ts` | 공고 마감 |
| `src/app/api/admin/applications/[id]/registrations/route.ts` | 명단 조회/추가 |
| `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` | 명단 개별 관리 |
| `src/app/api/admin/applications/[id]/export/route.ts` | Excel 다운로드 |
| `src/components/SignaturePad.tsx` | 서명 캔버스 컴포넌트 |

## 9. 서명 캔버스 구현

- HTML5 Canvas 기반 (라이브러리 없이 직접 구현 또는 `signature_pad` 패키지)
- 터치 이벤트 + 마우스 이벤트 지원
- 서명 결과: Canvas → `toDataURL('image/png')` → Base64 문자열
- DB 저장: `MealRegistration.signature` (Text 타입)
- 서명 지우기: Canvas clear

## 10. Excel 다운로드

- 기존 `exceljs` 패키지 재사용
- 단일 시트: 학년, 반, 번호, 이름, 신청일시
- 파일명: `{공고제목}_신청명단.xlsx`
- 학년/반/번호 순으로 정렬
