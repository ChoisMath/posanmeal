> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/-Users-chois-Library-CloudStorage-GoogleDrive-complete860127-gmail-com--------projects-posanmeal/memory/railway-cli-quirks.md`

---
name: railway-cli-quirks
description: Railway CLI 5.49 비대화형 사용 시 걸림돌(volume add 옵션 위치·패닉, add --database 이름 무시, variable set --stdin)
metadata:
  type: reference
---

Railway CLI 5.49.0 에서 확인한 동작:

- 비대화형 링크: `railway link -w Chois -p posanmeal -e production` 후 `railway service link <name>`.
- `railway add --database postgres --service <name>`은 `--service` 이름을 무시하고 `Postgres-XXXX` 랜덤 접미사로 생성한다(CLI에 서비스 rename 없음).
- `railway volume add`는 `--service`를 `volume` 뒤(서브커맨드 앞)에 써야 하고, 서비스가 링크되지 않은 상태에서 이름으로 주면 `volume.rs` unwrap 패닉이 난다. 서비스를 링크한 뒤 `railway volume add --mount-path /app/uploads --json`이 안정적.
- 값 노출 없이 변수 설정: `printf '%s' "$v" | railway variable set KEY --stdin --service <svc> --skip-deploys --json`. `variable list --json`은 참조 변수를 resolve된 값으로 보여준다.
- `railway up --detach --json`은 deploymentId를 반환하고, 진행은 `railway service status --service <svc> --json`(BUILDING→…→SUCCESS/FAILED)으로 폴링.
- `railway up`로 만든 새 서비스는 저장소의 `railway.json`(buildCommand/startCommand)을 읽지 않았다 — 빌드가 `npm run build`만 실행되어 `@/generated/prisma/client` 미생성으로 실패. 운영 `dinner`는 서비스 인스턴스 설정에 명령이 직접 들어 있음. CLI에 설정 명령이 없으므로 GraphQL `serviceInstanceUpdate(serviceId, environmentId, input:{buildCommand, startCommand})`를 `https://backboard.railway.com/graphql/v2`에 호출(토큰은 `~/.railway/config.json`의 `user.accessToken`, macOS python은 SSL 인증서 오류가 나므로 curl 사용).
- 네트워크 명령은 Bash `dangerouslyDisableSandbox: true`로 실행해야 한다.

관련: [[railway-facecheck-test-service]], [[posanmeal-local-env-quirks]]
