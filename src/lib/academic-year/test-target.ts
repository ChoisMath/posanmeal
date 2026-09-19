const REJECTION_MESSAGE = "전용 테스트 DB 설정을 확인하세요";

export const ACADEMIC_TEST_HOST = "127.0.0.1";
export const ACADEMIC_TEST_PORT = "55439";
export const ACADEMIC_TEST_USER = "academic_year_test";
export const ACADEMIC_TEST_PASSWORD = "local-only";
export const ACADEMIC_TEST_DATABASE = "posanmeal_academic_year_test";

export const ACADEMIC_TEST_DATABASE_URL = `postgresql://${ACADEMIC_TEST_USER}:${ACADEMIC_TEST_PASSWORD}@${ACADEMIC_TEST_HOST}:${ACADEMIC_TEST_PORT}/${ACADEMIC_TEST_DATABASE}`;

export const ACADEMIC_TEST_COMPOSE_PROJECT = "posanmeal-academic-tests";
export const ACADEMIC_TEST_DOCKER_LABEL = "posanmeal.academic-year-test";
export const ACADEMIC_TEST_IDENTITY_MARKER = "posanmeal-academic-tests-v1";

/**
 * Runway 운영 DB로 잘못 연결되는 사고를 막기 위한 가드. host/port/db/user를
 * 모두 고정값과 비교하며, 실패 메시지에는 절대 원본 URL을 포함하지 않는다.
 */
export function parseAcademicTestTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(REJECTION_MESSAGE);
  }

  const isExactTestTarget =
    url.hostname === ACADEMIC_TEST_HOST &&
    url.port === ACADEMIC_TEST_PORT &&
    url.username === ACADEMIC_TEST_USER &&
    url.pathname === `/${ACADEMIC_TEST_DATABASE}`;

  if (!isExactTestTarget) {
    throw new Error(REJECTION_MESSAGE);
  }

  return url;
}
