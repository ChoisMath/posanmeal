# Next.js / Prisma 프로젝트 규칙

- Next.js 16.2.1 App Router. 관련 로컬 Next.js 가이드를 코드 작성 전에 읽는다. 공개 경로와 인증 경계는 `src/proxy.ts` 및 각 API의 가드를 확인한다.
- Prisma 7 클라이언트는 `@/generated/prisma/client`, 실제 공용 인스턴스는 `src/lib/prisma.ts`. `PrismaPg` + `pg.Pool` 어댑터가 필수다. 전역 예제의 인자 없는 `new PrismaClient()`로 바꾸지 않는다.
- DB URL은 `prisma.config.ts`, 스키마는 `prisma/schema.prisma`. 생성 클라이언트는 직접 수정하지 않는다.
- 서버 전용 DB/fs 코드를 클라이언트에 import하지 않는다. 입력은 Zod와 기존 검증 유틸을 재사용한다.
- 각 API에서 인증/권한을 검증한다. 공개 키오스크 API는 기존 JWT/키오스크 키 정책을 유지한다.
- 서버 데이터 접근과 클라이언트 SWR을 구분한다. 기존 오프라인/카메라 effect를 일반 데이터 로딩 규칙만으로 제거하지 않는다.
- Tailwind 4는 `src/app/globals.css` 기반. next-themes는 현재 의존성에 없다. 기존 Warm Modern 라이트 UI를 따른다.
- CheckIn 고유키는 `(userId, date, mealKind)`. 신청 확정일은 `MealRegistrationMealDate`. 제거된 `MealPeriod`를 복구하지 않는다.
- 스키마/마이그레이션 변경 후 실행 전 prisma-migration-guardian 검수. additive 우선, 삭제는 이전 코드가 제거된 뒤 별도 배포. unique 변경은 기존 SQL의 INDEX/CONSTRAINT 형태를 확인한다.
