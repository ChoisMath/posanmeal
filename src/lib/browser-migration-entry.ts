/**
 * 실브라우저 이전 검증(`tests/browser/academic-local-migration.html`) 전용 번들 진입점.
 * 제품 코드가 이 파일을 import하지 않는다 — 검증이 제품 함수를 그대로 쓰게 하려고만 둔다.
 */
export { DB_NAME, openDB } from "@/lib/local-db";
export { applyKioskSnapshot } from "@/lib/kiosk-sync";
