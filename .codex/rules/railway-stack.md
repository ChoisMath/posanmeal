# Railway 프로젝트 규칙

- 저장소의 `railway.json`이 빌드/시작 명령의 기준: Prisma generate 후 build, migrate deploy 후 Next 시작.
- 업로드는 현재 구현의 `UPLOAD_DIR`와 Volume 마운트 일치를 확인하고 `/api/uploads/[filename]`로 서빙한다. 일반 규칙의 `RAILWAY_VOLUME_MOUNT_PATH`로 임의 교체하지 않는다.
- 기존 기록상 운영은 `dinner`, `main`, `meal.posan.kr`. 단, 2026-09 메모리에 별도 `dinner-facecheck`/`feat/facecheck` 연결 기록이 있어 “feature 브랜치 push는 배포되지 않는다”는 6월 기록을 그대로 적용하면 안 된다.
- 실제 서비스·브랜치 연결·DB·Volume은 배포 작업 시 읽기 전용 조회로 확인한다. 과거 메모리를 현재 운영 상태로 단정하지 않는다.
- Railway/환경변수/Volume 작업은 railway-deploy-advisor 검수. 환경변수 값·토큰을 출력하거나 메모리에 복사하지 않는다.
- 이번 지침 이관은 배포나 DB 변경 승인이 아니다. 배포는 사용자 작업 범위에 포함된 경우에만 수행한다.
