# 2026-09-19 안내 영상·가이드 페이지 스킬 이관

최신 상태는 아래 **3차 개선 — Qwen3 원음 길이 절단 수정**과 [학생 안내 영상 기록](2026-09-19-student-guide-video.md)을 함께 본다. 최초 이관·2차 개선의 미실행 항목과 검증 수치는 각 시점의 기록이다.

## 완료한 변경

- `school_cowork`와 `selfstudy`를 비교하고 Next.js에 맞춰진 selfstudy 원본을 채택했다. `.agents/skills/`에 `guide-page`, Remotion 13종(공식 문서 버전 4.0.518 및 모션 그래픽), 새 `mlx-voice-clone` 등 총 15개 스킬을 적용했다.
- `.codex/GUIDE_PAGES.md`와 `AGENTS.md`에 PosanMeal의 학생·교사·관리자·키오스크 제작 흐름을 연결했다. 영상과 가이드 이미지는 동일한 Remotion 장면을 재사용한다. UI 목업의 그레인·비네트·색 보정·Ken Burns는 제외한다.
- `guide-page/assets/demo-video/`에 47파일·297KB의 미설치 제작 템플릿을 두었다. 개인/생성 바이너리·가상환경·`node_modules`·심볼릭 링크는 없으며 다른 프로젝트명은 출처 설명에만 남겼다. 루트 `tsconfig.json`·`eslint.config.mjs`는 `.agents/**`를 제외한다. 실제 제작 요청 때 루트 `demo-video/`로 복사·설치한다.
- 음성 패키지는 `mlx-audio==0.5.3`이다. Voicebox의 기존 `Chois` 프로필은 읽기 전용으로 사용하고 Qwen3-TTS 생성·Whisper 전사 검수를 연결한다. 모델·사용자 참조 녹음·Voicebox DB·가상환경을 템플릿에 복사하지 않았다.
- 사용자와 다른 작업자의 명부 설계·인계 및 `.claude/PROJECT_MAP.md` 등 기존 변경을 보존했다. 전역 메모리·legacy·다른 프로젝트는 수정하지 않았다.

## 실제 검증

- 스킬 `quick_validate` 15/15, Codex `debug prompt-input` 실제 스킬 인식 15/15, Markdown 경로 누락 0, TOML 파싱 통과. 현재 세션에서는 경로를 직접 읽어 사용할 수 있고 새 세션의 자동 탐색도 확인했다.
- 루트 `npx tsc --noEmit`, `npx eslint eslint.config.mjs`, `git diff --check` 통과.
- 전체 `npm run lint`는 기존 `src` 오류 14개·경고 10개로 실패했다. 이번 변경 파일의 오류로 기록하지 않는다.
- `codex --strict-config debug prompt-input`은 `--strict-config is not supported for codex debug`로 실행할 수 없어 일반 `debug prompt-input`과 별도 TOML 파싱으로 대체했다.
- 템플릿은 임시 복사본과 원본 프로젝트의 읽기 전용 Node/Python 환경으로 검증했다. Node 테스트 13개·Python 테스트 7개, 템플릿 타입·린트, `--estimate` 11.4초 및 `frame-at` 204/278 결과를 확인했다. 다른 프로젝트를 영구 의존성으로 설정하지 않았다.
- 독립 문서 검토 통과. UI 검토는 고정 1920×1080 템플릿의 정적 검토에서 결함 없음: 버튼·커서·주석이 크롭 안에서 일치하고 204프레임은 상태 전환 이후이며 폰 좌표는 공용 상수를 재사용한다. 실제 렌더·음성 확인을 대신하는 결과는 아니다.

## 미실행·다음 단계

- 루트 `demo-video/`, `/help`, 공용 가이드 UI, 실제 안내 영상은 아직 없다. 모델 설치·실제 음성 생성·렌더·앱 build·DB 접근/변경·배포는 실행하지 않았다.
- 실제 제작 요청에서 `$guide-page <대상 화면과 요청>`을 사용한다. `.agents/skills/guide-page/SKILL.md`와 `.codex/GUIDE_PAGES.md`를 읽고 템플릿을 복사·설치한 뒤 현재 앱 화면으로 장면을 만든다.
- 복사한 제작 폴더는 루트 타입·린트·Tailwind 스캔에서 제외한다. 실제 내레이션 생성/청취·실측 타이밍·영상/스틸 시각 검증 후 가이드 페이지를 연결한다. 전체 lint의 기존 오류는 별도 작업이다.

## 2차 개선 — 문장 끝 오디오 처리

같은 날 사용자가 `skill-creator`로 문장 끝이 딱 끊기는 현상을 개선하도록 요청했다. 위 내용은 최초 이관 당시의 기록이며 아래가 후속 변경·검증 상태다.

### 완료한 변경

- 문장 끝은 **원음의 말끝·잔향 보존 → 약 1초 여유 → 0.35초 `hsin` 음량 페이드**로 처리한다. 앞 무음만 제거한 원음을 출력에 쓰고, 뒤 무음 제거는 발화 길이 측정에만 사용한다.
- `guide-page/SKILL.md`, `mlx-voice-clone/SKILL.md`, `.codex/GUIDE_PAGES.md`, 제작 템플릿 `README.md`·`scripts/narrate.mjs`·`scripts/lib/narration-core.mjs` 및 기존 테스트, `src/setup-check/narration.ts`·추정 타이밍 JSON을 갱신했다.
- 캐시에 trailing·fade 설정과 processing hash를 포함해 이전 처리 결과를 무효화한다. `say` 경로에도 같은 후처리를 적용한다. 추정·실측 길이는 말끝 여유와 페이드 구간을 포함한다. 시각 전환과 TSX는 변경하지 않았다.

### 실제 검증

- Node 테스트 15개 통과. 실제 ffmpeg와 합성 PCM을 쓰는 2개 테스트에서 발화·hold 보존, RMS 감소, padding을 확인했다.
- 템플릿 임시 복사본의 실제 `narrate` CLI를 합성 TTS 워커와 연결해 3문장 mp3를 생성했다. 각 길이가 1.35초 늘어난 것을 55ms 이내 오차로 확인했고, 재실행 시 캐시 재사용도 통과했다. 사용자 복제 음성 검증은 아니다.
- `--estimate`: Intro 3.936초, Check 9.969초, 총 13.905초. `node --check`, 변경 스킬 `quick_validate` 2개, `git diff --check` 통과.
- 임시 복사본에서 템플릿 `npm run lint`(`eslint src && tsc`) 통과. 최종 독립 코드·스킬 검토에서 중요한 문제는 발견하지 못했다.

### 미실행·다음 단계

- 이번 후속 작업에서 실제 사용자 복제 음성 생성·청취, Voicebox DB/모델 실행, 영상 렌더, 앱 검사·배포는 실행하지 않았다. 최초 이관 때 수행한 앱 검사와 구분한다.
- 실제 제작 시 사용자 음성으로 말끝·잔향·여유·페이드를 청취하고 실측 타이밍으로 영상과 스틸을 검증한다. 루트 `demo-video/`와 앱 `/help`는 여전히 미구현이다.

## 3차 개선 — Qwen3 원음 길이 절단 수정

- 실제 학생 안내 영상 v3에서 사용자가 전반적인 문장 끝 끊김을 보고했다. v2와 공통인 46문장도 PCM 정렬 후 거의 같았으므로 v3에서 새로 자른 문제가 아니었다. 이전의 1초 여유·0.35초 페이드는 이미 생성 단계에서 사라진 끝음을 복원하지 못한다.
- `mlx-audio==0.5.3` Qwen3의 `speech_tokenizer.decode`가 유효한 codec 토큰 `0`을 padding으로 세어 반환 유효 길이를 줄였다. 참조 356토큰에 포함된 `0` 하나가 전체 파형의 끝 80ms를 잘라내고 이후 참조 구간을 비례 절단했다. 기존 raw 59개 모두 이 오류식과 일치했고 58개는 `0` 1개, `FaceOption-0`은 2개로 끝 160ms가 잘렸다. 상세 수치와 재현 근거는 학생 안내 영상 기록을 본다.
- `scripts/tts_mlx.py`의 `preserve_single_unpadded_decode_length(tokenizer)`를 `load_model` 직후 적용했다. 단일 비패딩 입력의 반환 길이만 `min(T × rate, 실제 파형 길이)`로 보정하고 파형·dtype·shape 및 배치 결과는 유지한다. 패키지·모델 버전은 바꾸지 않았다.
- `narrate.mjs`의 `AUDIO_PROCESSING`에 생성기 소스 해시를 포함해 잘린 과거 음성 캐시를 무효화한다. helper·테스트·캐시 변경을 `guide-page/assets/demo-video/` 템플릿에도 동기화했다. `guide-page`·`mlx-voice-clone` 스킬에는 이 호환 보정과 원음 끝 구간 확인, 길이/STT만으로 끝음 보존을 판정하지 않는 기준을 추가했다.
- 초기 길이 보정 시점에 회귀 테스트 5개를 실패 상태에서 확인한 뒤 수정해 통과시켰다. 당시 Node 15개 + Python 12개 = 총 27개, 스킬 `quick_validate` 2개가 통과했다. 아래 원음 종료 검사를 추가한 뒤의 결과와 구분한다.
- 원음 EOF 마지막 20ms RMS에 -60dB 기준 종료 검사를 추가하고 실패 문장을 최대 3라운드 재시도한다. 이 변경 후 제작본과 템플릿 모두 Node 18개 + Python 12개 = 총 30개 테스트, 두 스킬 `quick_validate`, `demo-video` lint·TypeScript 검사가 통과했다.
- 실제 v4 1차 생성에서 종료 검사에 실패한 18문장을 재시도했다. 최대 3라운드 뒤에도 실패한 3문장은 안내 의미를 유지해 종결 표현을 다듬고 원고·자막·`SPOKEN`을 일치시켜 재생성했다. 최종 raw 59개 모두 codec 프레임 정합·EOF 20ms ≤ -60dB(최대 -63.154dB), 전사 `CHECK 0 / NOCHECK 0`을 확인했다.
- v4 최종 영상 렌더·전체 디코딩·시각 검토와 MP4 파형 비교 59/59를 완료했다. `verified-v4-rendered-audio.json`의 `summary.pass=true`를 확인했으며 상세 수치와 검사기의 음량 보정 근거는 [학생 안내 영상 기록](2026-09-19-student-guide-video.md)에 있다. 실제 꼬리 제거를 검출하는 별도 회귀 검사도 통과했다. 직접 청취와 실제 기기 설치 검증은 미실시이며 앱·DB·배포는 변경하지 않았다.
