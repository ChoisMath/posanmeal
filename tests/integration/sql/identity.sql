-- public 스키마는 `prisma migrate deploy`가 "비어있는 스키마"로 인식해야
-- 하므로, identity marker는 별도 스키마에 둔다 (P3005 회피).
CREATE SCHEMA IF NOT EXISTS academic_meta;

CREATE TABLE IF NOT EXISTS academic_meta.academic_test_identity (
  key text PRIMARY KEY
);

INSERT INTO academic_meta.academic_test_identity (key)
VALUES ('posanmeal-academic-tests-v1')
ON CONFLICT (key) DO NOTHING;
