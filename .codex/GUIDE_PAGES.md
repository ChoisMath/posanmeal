# PosanMeal 안내 영상·가이드 페이지 기준

`$guide-page <대상 화면과 요청>`으로 안내 영상과 목업 이미지 기반 가이드 페이지를 만든다. 영상의 React 장면이 목업 원본이고, 가이드 이미지는 그 장면의 정지 화면이다. 서로 따로 그리지 않는다.

2026-09-19 기준 **독립 `demo-video/` 환경과 학생 안내 18장면·59문장을 제작한 상태**다. 실제 Chois 음성·실측 타이밍과 목업을 사용한다. 앱 `/help/student`와 공용 영상·이미지·도움말 컴포넌트를 구현했다. `/help`는 학생 안내로 이동하며 로그인 없이 열 수 있다. 산출물·검증 상태는 §6을 따른다.

## 1. 스킬과 원본

| 위치 | 용도 |
|---|---|
| [guide-page](../.agents/skills/guide-page/SKILL.md) | 전체 제작 흐름 |
| [Remotion 라우터](../.agents/skills/remotion-best-practices/SKILL.md) | API·장면·자막·렌더 등 12종 공식 스킬, 원본 버전 4.0.518 |
| [모션 그래픽](../.agents/skills/remotion-motion-graphics/SKILL.md) | 모션·프레임 검수, UI 목업 예외 우선 |
| [복제 음성](../.agents/skills/mlx-voice-clone/SKILL.md) | `mlx-audio==0.5.3`, Qwen3-TTS, Voicebox `Chois` 프로필 |
| [제작 템플릿과 설치 안내](../.agents/skills/guide-page/assets/demo-video/README.md) | 독립 Remotion 프로젝트·공용 장면·내레이션·스틸·검수 스크립트 |

원본은 `/Volumes/Chois_SD2/dev/selfstudy/.claude/skills/`와 `.claude/GUIDE_PAGES.md`, `demo-video/`다. `school_cowork` 원본과 비교해 Next.js에 맞춰진 selfstudy를 채택했다. 공식 Remotion 스킬은 양쪽이 동일하며, selfstudy의 `remotion-motion-graphics`도 포함했다(MIT, 폴더 LICENSE 보존). 원본의 중복 참조 트리는 상대 링크를 고쳐 한 벌로 유지한다.

PosanMeal 적용: `.claude` 기준 문서는 `.codex`로, 인증 경로는 `src/proxy.ts`로 변경한다. 자율학습 역할·화면·기존 영상 ID는 가져오지 않는다. TSX 서버 컴포넌트와 `src/components/guide/`의 공용 컴포넌트를 재사용하고, 필요가 생기기 전에는 MDX를 추가하지 않는다. 원본의 자동 커밋 단계 대신 현재 사용자 요청을 따른다.

원본 Remotion 문서의 ElevenLabs 등 외부 음성 서비스 예시는 이 프로젝트의 기본 음성 방식이 아니다. 사용자 지정이 없으면 로컬 `mlx-audio==0.5.3`과 `Chois` 프로필을 우선하고 다른 서비스로 자동 대체하지 않는다.

## 2. 최초 제작 준비

프로젝트 루트에서 `demo-video/`가 없는지 확인한 후:

```bash
cp -R .agents/skills/guide-page/assets/demo-video demo-video
cd demo-video
npm ci
```

Python·모델 캐시·Voicebox 준비는 복사한 `demo-video/README.md`와 음성 스킬을 따른다. 앱 의존성에 Remotion/MLX를 넣지 않는다. 모델·기존 사용자 참조 녹음·Voicebox DB·가상환경을 git이나 템플릿에 복사하지 않는다.

실제 `demo-video/`를 만들 때 루트 `tsconfig.json`의 `exclude`에 `demo-video`를, `eslint.config.mjs`의 `globalIgnores`에 `demo-video/**`를 추가한다. `src/app/globals.css`의 Tailwind 4 스캔에서도 `@source not "../../demo-video"`를 추가한다. 제작 폴더의 `.gitignore`는 `node_modules`·`.venv-tts`·렌더 출력·raw wav를 제외한다. 현재 `.agents/**`는 루트 타입·린트에서 제외해 미설치 템플릿의 의존성이 앱 검사를 방해하지 않게 했다.

```bash
npm run doctor
npm test
node scripts/narrate.mjs --guide setup-check
npx remotion render SetupCheck out/setup-check.mp4
node scripts/guide-stills.mjs --page setup-check --out out/guide-stills-check
```

위 명령은 복사·설치 후의 환경 점검이다. 실행하지 않은 단계는 성공으로 기록하지 않는다. `setup-check`는 제작 환경 샘플이며 실제 급식 사용 가이드가 아니다.

## 3. 원고 → 음성 → 장면 → 영상·스틸

이 절의 `src/`, `scripts/`, `public/narration/`, `out/`는 **demo-video 기준**이다.

1. 앱의 실제 컴포넌트와 사용자 동선을 읽는다. 학생(급식 신청·QR·얼굴 등록), 교사(담임 여부·근무/개인), 관리자(권한 수준), 키오스크(`/check`, `/facecheck`)를 구분한다. 식사는 조식·중식·석식, 날짜 판정은 KST다. 얼굴 확인 후 저장, 온라인/로컬·QR 폴백을 현재 코드와 맞춘다.
2. `src/setup-check/narration.ts` 형식을 재사용해 `src/<guide>/narration.ts`에 장면별 문장을 쓰고 `scripts/narrate.mjs`의 `GUIDES`에 등록한다. `LINE_GAP_SECONDS`, `TRAILING_SILENCE_SECONDS = 1`, `FADE_OUT_SECONDS = 0.35`를 내보내고 `timing.ts`에도 같은 문장 간격을 사용한다. 끝음절·원음 잔향을 보존한 뒤 약 1초 여유를 두고, 이어 0.35초 음량 페이드아웃을 적용한다. 숫자·영문·기호의 음성 표기는 `SPOKEN`에 한글로 따로 쓴다(`QR` → `큐알`). 문장 키의 번호는 0부터다.
3. `node scripts/narrate.mjs --guide <guide>`로 음성·실측 `narration-durations.json`·`review.tsv`를 만든다. `CHECK`는 우선 청취, `NOCHECK`는 미전사 상태다. 고칠 문장은 `--only <Scene>-<index>`로 다시 생성한다. 생성한 mp3와 검수 결과를 사용자에게 제공하고 청취 확인 여부를 기록한다.
4. 임시 타이밍은 `--estimate`, 기존 음성 재측정은 `--measure`로 만든다. 문장 길이에는 여유·페이드 1.35초가 포함되고 문장 사이에 `LINE_GAP_SECONDS`가 추가된다. `--estimate`는 실측 JSON도 덮어쓰므로 최종 렌더 전에 음성을 생성하거나 `--measure`로 복구한다. 후처리 규칙을 바꾸면 기존 음성을 다시 생성한 뒤 재측정한다(`--measure`만으로 패딩·페이드가 적용되지 않는다). 이미 잘린 발음은 무음으로 감추지 말고 원음을 재생성한다.
5. `src/guide/`의 `createTiming`·`GuideScene`·`createGuideVideo`를 재사용한다. `src/Root.tsx`에 본편과 장면별 컴포지션을 등록한다. 동작 시점은 고정 프레임 대신 `lineAt(scene, line, ratio)`로 잡는다.
6. 실제 화면의 레이아웃·문구·색으로 `src/<guide>/` 목업을 만들고 가상 데이터는 해당 가이드의 `data.ts`에 둔다. 템플릿 테마·브라우저 제목·URL은 PosanMeal 화면과 대조한다. 참조 녹음이나 학생 사진을 목업 데이터로 넣지 않는다.
7. 영상은 `npx remotion render <Composition> out/<name>.mp4`, 스틸은 `node scripts/guide-stills.mjs --page <page>`로 만든다. 인접 장면 전환·음성/자막 시작과 끝·포인터 위치·모바일 글자를 직접 확인한다.

모션 API는 관련 Remotion 스킬을 선택해서 읽는다. 새 등장·퇴장 동작은 easing·clamp·스태거를 적용하되, 공용 타이밍 코드를 스타일 규칙에 맞추려고 전면 수정하지 않는다. **UI 목업에는 그레인·비네트·색 보정·Ken Burns를 넣지 않는다.** 인트로·아웃트로의 장식이 안내 문구를 가리면 제거한다.

## 4. 스틸 규격과 가이드 페이지

| 항목 | 기준 |
|---|---|
| 원본 | 장면 컴포지션 1920×1080, 30fps |
| 브라우저 크롭 | 템플릿 기본 x180 y70, 1560×800. 실제 프레임 변경 시 `DEFAULT_CROP`도 함께 수정 |
| 폰 목업 | `PhoneFrame`·`phone.ts` 좌표 재사용, `PHONE_CROP`, 폭 640px |
| 이미지 | WebP 폭 1280px, 품질 82, 장당 150KB 이하·페이지당 2MB 이하 |
| 목록 | `demo-video/src/stills/<page>.ts`: `{ composition, file, frame, crop?, resize? }` |
| 이름/저장 | `NN-slug.webp` → 앱 `public/guide/<page>/` |

목록의 `frame`은 개별 장면 기준 `lineAt`으로 잡는다. 스크립트의 용량 초과 메시지는 경고이므로 최종 파일 크기를 따로 확인한다. 이미지 가독성·크롭·실제 화면 일치를 직접 확인한다.

앱 구현 기본안:

- `src/app/help/page.tsx`: 도움말 허브. `src/app/help/<page>/page.tsx`: metadata가 있는 TSX 서버 컴포넌트.
- `src/components/guide/`: 기존 컴포넌트가 생겼으면 먼저 재사용한다. 최초에는 Article·Chapter·Step·Notice·Video·HelpButton 중 필요한 것만 만든다. 이미지 크기·비율·alt를 명시한다.
- 공개 안내로 만들 때 `src/proxy.ts`에서 **정확한 `/help` 또는 `/help/` 하위 경로**만 허용하고 로그아웃으로 검증한다. 관리자 데이터/API까지 공개하지 않는다. 현재 `src/lib/public-paths.ts`의 경계 일치 allowlist에 `/help`가 등록되어 있다.
- `?` 버튼은 `aria-label="사용 가이드"`, 44×44 터치 영역, `target="_blank" rel="noopener"`를 기본으로 한다. 학생/교사 편집 상태·키오스크 카메라 동작을 잃지 않는 위치에 둔다.
- 목차 4개 이하·단계 9개 이하를 기본으로 하고 길면 역할/업무별로 나눈다. 단계당 이미지 1~3장·설명 2~4문장, 첫머리에 대상 역할을 표시한다. 라벨은 nowrap, 본문은 `.codex/rules/responsive-ui.md` 기준으로 처리한다.
- 영상 업로드 위치나 ID가 없으면 가짜 링크·다른 프로젝트 영상을 넣지 않는다. mp4는 로컬 산출물로 제공하고 공개 링크가 확보된 뒤 영상 카드를 연결한다. 업로드·게시 요청이 없으면 외부에 게시하지 않는다.

## 5. 검증·워크트리·인계

앱을 수정하면 관련 테스트·린트·타입 검사, 375/768/1280px 화면, 실제 `?` 진입·로그아웃 접근을 확인한다. 공개 접근·이미지 참조처럼 사용자 동작에 영향을 주는 부분을 검사하고 구현 문구를 복제한 테스트는 추가하지 않는다. 배포 준비를 요청받았으면 프로젝트 규칙에 따라 build + test를 수행한다.

UI/스타일 변경 후 `responsive-ui-reviewer`, 구조 변경 후 `project-map-updater`, 중요 작업 종료 시 `project-memory-keeper`를 사용한다. `.codex/PROJECT_MAP.md`와 이 문서 현황에는 실제 구현·검증만 기록한다.

워크트리에서는 **이 프로젝트 메인 checkout**의 설치된 `demo-video/node_modules`·`.venv-tts`를 필요 시 연결한다. 다른 프로젝트 경로를 영구 의존성으로 만들지 않는다. raw wav가 없으면 캐시된 `NOCHECK`를 전사할 수 없으므로 `--only` 재생성 또는 원래 제작 위치에서 검수한다. TTS와 Whisper는 순차 실행한다.

음성 생성에서는 단일 비패딩 Qwen3 디코딩의 유효 코드 `0`을 보존하고, 생성기 소스 해시가 달라지면 음성 캐시를 다시 만든다. 패딩 전 원음 마지막 20ms RMS가 -60dB보다 크면 해당 문장만 최대 세 라운드 재생성한다. `review.tsv`의 전사와 마지막 어절도 확인하며, 자동 검사와 직접 청취 여부를 구분해 기록한다.

## 6. 진행 현황

| 대상 | 현재 상태 |
|---|---|
| 스킬·제작 템플릿 | selfstudy에서 이관, PosanMeal 기준 적용 |
| 실제 `demo-video/` 환경 | Remotion 4.0.518·독립 Python·mlx-audio 0.5.3·기존 Chois 프로필. 초기 doctor 9/9, v4 제작본/템플릿 테스트 30개·제작본 lint/type 통과 |
| 학생 안내 원고·목업 | `demo-video/src/student/`, `StudentGuide` 18장면·59문장. 타이틀/인사·접속·Android Chrome/iPhone Safari 설치·계정 복구·신청/서명/수정/취소·QR/인쇄·얼굴 인식 베타 소개/선택적 등록/본인 확인·이력·물음표 도움말 마무리. 가상 데이터만 사용 |
| 학생 음성 | v4 전체 59문장 재생성, 원음 말끝 20ms RMS 검사·전사 CHECK 0/NOCHECK 0·마지막 어절 대조·최종 MP4 말끝 파형 59/59 통과. 1초 여유 + 0.35초 페이드. 직접 청취는 미실시 |
| 학생 영상·스틸 | v4 `demo-video/out/PosanMeal-student-guide.mp4`: 1920×1080/30fps, 11,694프레임, 약 6분 30초, 35.6MB, 18챕터. 전체 59문장 원음 재생성·말끝 검사·전사 및 최종 영상 디코딩·18장면 시각 검수 완료. SRT 59구간·미리보기 JPG·1920×1080 썸네일과 WebP 19장(총 504.4KB). 이전 완성본은 `out/archive/v1/`~`v3/`. 직접 청취는 미실시 |
| 교사 안내 원고·영상 | `demo-video/src/teacher/`, `TeacherGuide` 14장면·48문장. 인트로·주소·Android/iPhone 설치·로그인·교사/담임 메뉴·개인정산/근무·본인 기록·학급 월별 체크인·선택 QR출력·공고 신청자/시각·얼굴 등록/본인 확인·물음표 도움말. `out/PosanMeal-teacher-guide.mp4`: 1920×1080/30fps, 9,769프레임, 325.653초, 26,782,125bytes. 전체 디코딩·14장면 시각 검토 완료 |
| 교사 음성 | 모든 원고 `.   ` 끝맺음, 발화 후 1초 여유·0.5초 페이드와 기존 문장 간 0.2초. 원음 종료 48/48 통과, 전사 CHECK 0/NOCHECK 0. 핵심 개인정산·특근 매식비 전사 확인. 사람의 직접 청취 미실시 |
| 교사 안내 페이지·스틸 | 공개 `/help/teacher` 4목차·9단계, 교사 헤더 `?`에서 새 탭. 최종 MP4에서 추출한 WebP 14장 501,078bytes(본문 12장·포스터 1장·Tabs 예비 1장). 영상은 사용자 제공 YouTube `t1ujLxBVelA`를 공용 GuideVideo로 재생하며 4구간·9단계 시간 링크를 제공. public에는 WebP·VTT를 유지하고 MP4 원본은 demo-video/out에 보존. 브라우저 재생·170초 탐색·VTT48구간·375/768/1280px·목차·이미지 로드 확인. YouTube 연결 후 운영 배포 준비 중 |
| 관리자 안내 | 미제작 |
| 학생 안내 페이지 | `/help/student`(공개), `/help`에서 이동. 4목차·9단계·목업 16장과 영상 표지 1장, 총 459.3KB. 로그인 화면·학생 헤더의 `?`에서 새 탭으로 열림. 원본 이미지 확대·영상 구간 이동 제공 |
| 공개 영상 등록 | 사용자가 제공한 `https://youtu.be/rOww_TPHGR0`를 `src/app/help/student/content.ts`에 등록. 페이지 내 YouTube 재생·구간 이동 확인. 사이트 운영 배포는 별도 |

실제 가이드 제작 시 대상 화면·장면 경로·가이드 URL·영상 경로/ID·검증 상태를 행으로 추가한다.
