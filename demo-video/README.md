# PosanMeal 안내 영상 · 가이드 이미지 제작

프로젝트 스킬의 제작 템플릿에서 준비한 독립 Remotion 작업 공간이다. 원본 공용 파이프라인은 `selfstudy/demo-video`이며, 여기서 설치·음성 생성·렌더를 수행한다. 스킬 자산 폴더에는 생성물을 기록하지 않는다.

작업 기준은 프로젝트 루트의 `.codex/GUIDE_PAGES.md`, 제작 절차는 `$guide-page`, 음성 절차는 `$mlx-voice-clone`을 따른다. 영상 장면의 목업을 그대로 정지 이미지로 렌더해 가이드 페이지에서 재사용한다.

Remotion `4.0.518`과 `mlx-audio==0.5.3`을 원본 잠금 파일로 고정했다. 설치 파일, 모델, 참조 음성, 생성 음성은 Git에 포함하지 않는다. `SetupCheck`는 환경 점검용 예시로 실제 PosanMeal 화면을 설명하지 않는다. `setup-check`와 `student`의 길이 JSON은 이 환경에서 생성한 실제 음성의 실측 값이다.

Next.js 앱과 독립된 Node 프로젝트다. 실제 `demo-video/`를 만들 때 루트 TypeScript·ESLint·Tailwind 탐색과 배포 범위에서 제외되었는지 `.codex/GUIDE_PAGES.md`에 따라 확인한다.

## 로컬 환경 점검

2026-09-19: Node 24.16.0, Remotion 4.0.518, 독립 Python 3.12 가상환경과 `mlx-audio==0.5.3` 설치를 완료했다. `npm run doctor` 9개 항목과 `npm test` 22개 테스트(Node 15개, Python 7개)가 통과했다. 기존 TTS·Whisper 캐시와 읽기 전용 Chois 프로필을 사용하며 모델·참조 음성은 복사하지 않았다. Remotion 브라우저 캐시는 로컬 의존성 폴더에 복사했고 `npx remotion compositions --log=warn`으로 번들·브라우저·Google Fonts 로딩을 확인했다. 첫 브라우저 실행은 연결 시간 초과였으며 재시도는 통과했다. 이 환경 점검은 본편 음성의 발음·청취 검수와 별개다.

## 설치

다음 명령은 프로젝트 루트에 복사한 `demo-video/` 기준이다. Node는 `.ts` 원고를 플래그 없이 가져올 수 있는 `22.18+`, `23.6+` 또는 `24+`를 사용한다. MLX 음성은 Apple Silicon의 로컬 Python 환경을 사용한다.

```bash
brew install ffmpeg webp python@3.12
cd demo-video
npm ci
/opt/homebrew/bin/python3.12 -m venv .venv-tts
.venv-tts/bin/pip install -r requirements-tts.lock.txt
```

TTS 모델 `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`과 `Chois` 프로필은 기존 Voicebox 환경을 사용한다. 기본 TTS 캐시는 `~/.cache/huggingface/hub`이고, 프로필 DB와 녹음은 복사하지 않는다. 환경이 없으면 준비할 항목을 먼저 명시하고 요청된 음성 제작에 필요한 범위에서 설치한다. 스킬 복사 요청만으로 모델을 내려받거나 원본 프로필을 변경하지 않는다.

검수용 Whisper는 별도 SD 카드 캐시를 사용한다. 원본 파이프라인에서 필요한 토크나이저 파일은 `openai/whisper-large-v3-turbo`에서 준비한다. 아래는 모델을 실제로 설치할 때 실행하는 명령이며 스킬 복사만으로 실행되지 않는다.

```bash
HF_HUB_CACHE=/Volumes/Chois_SD2/dev/hf-cache .venv-tts/bin/python -c "
from huggingface_hub import snapshot_download, hf_hub_download
import shutil
snap = snapshot_download('mlx-community/whisper-large-v3-turbo')
for f in ['tokenizer.json','tokenizer_config.json','vocab.json','merges.txt','normalizer.json','added_tokens.json','special_tokens_map.json','preprocessor_config.json','generation_config.json']:
    shutil.copy(hf_hub_download('openai/whisper-large-v3-turbo', f), f'{snap}/{f}')"

npm run doctor
npm test
```

`doctor`는 도구·의존성·모델 캐시·읽기 전용 Voicebox 참조를 점검한다. 출력의 파일 경로와 참조 문장 길이도 개인 환경 정보이므로 공유 보고서에는 필요한 상태만 적는다. 스킬 복사 성공과 `doctor` 통과, 실제 생성·청취 검수 완료는 각각 구분한다.

## 폴더

| 위치 | 내용 |
|---|---|
| `src/guide/` | 공용 타이밍, 배경·STEP 배지·음성·자막, 장면 페이드 |
| `src/components/` | 브라우저·휴대폰 프레임, 커서, 주석, 알림 |
| `src/setup-check/` | 두 장면·세 문장의 환경 점검 예시 |
| `src/student/` | 학생 안내 18장면·59문장, 학생/Google/키오스크 목업과 실측 타이밍 |
| `src/student/InstallMockups.tsx` | Android Chrome·iPhone Safari 설치 메뉴/확인/홈 화면 목업 |
| `public/posanmeal-app-icon.png` | 앱의 `public/icon-512.png`를 복사한 설치 화면용 아이콘 |
| `src/stills/student.ts` | 학생 영상에서 추출하는 가이드 목업 19장 |
| `src/stills/setup-check.ts` | 같은 장면에서 가이드 이미지로 내보낼 프레임 |
| `src/Root.tsx` | 본편과 장면별 composition 등록 |
| `scripts/narrate.mjs` | 원고 → 문장 음성 → 장면 음성·길이 JSON·검수표 |
| `scripts/guide-stills.mjs` | 장면 프레임 → WebP, 기본 목적지는 `../public/guide/<page>/` |
| `scripts/frame-at.mjs` | 음성 문장의 상대 위치를 프레임 번호로 계산 |
| `scripts/student-deliverables.mjs` | 실제 프레임에 맞춘 SRT·MP4 챕터·검수 타임라인 |
| `scripts/student-previews.mjs` | 최종 MP4에서 장면 18장과 가이드용 WebP 19장 재추출 |
| `scripts/gen-tw-palette.mjs` | 루트 앱 Tailwind 팔레트를 `src/app-mocks/tw.ts`로 생성 |
| `public/narration/<guide>/` | 생성 후 만들어지는 로컬 음성·캐시·검수표, Git 제외 |

새 가이드는 `src/<guide>/`에 원고·타이밍·장면을 만들고 `src/Root.tsx` 및 `scripts/narrate.mjs`의 `GUIDES`에 등록한다. 현재 등록된 가이드는 환경 점검용 `setup-check`와 학생 안내용 `student`다. 본편 컴포지션은 `StudentGuide`, 학생 화면 목업은 `src/student/StudentMockups.tsx`에 있다. `appName` 기본값은 `PosanMeal`, `appUrl`은 로컬 확인용 `http://localhost:3000`이다. 실제 제작 시 확인한 주소로 설정한다.

## 명령

학생 안내 제작:

```bash
node scripts/narrate.mjs --guide student
npm run lint
npx remotion render StudentGuide out/PosanMeal-student-guide.mp4 --codec h264 --crf 18 --concurrency 8
node scripts/student-deliverables.mjs
node scripts/student-previews.mjs
node scripts/guide-stills.mjs --page student --out out/guide-stills
```

원고·화면 근거는 `../docs/video/student-guide-storyboard.md`에 있다. 초기 제작은 영상만 대상으로 했으며, 후속 요청으로 앱 `/help/student`와 `public/guide/student/`를 연결했다. 클론 음성 59문장 전사 검수는 CHECK 0 / NOCHECK 0이지만 사람의 청취 검수는 미실시 상태다.

완성본은 v4 `out/PosanMeal-student-guide.mp4`(1080p30, 약 6분 30초, 35.6MB)다. 생성 단계의 말끝 절단을 보정한 뒤 전체 59문장을 다시 생성했다. `out/PosanMeal-student-guide-preview.jpg`는 최종 영상의 18장면 미리보기이며 `.srt`와 `-chapters.txt`도 함께 제공한다. `out/PosanMeal-student-guide-thumbnail.png`는 인트로 12프레임을 원본 PNG로 렌더한 1920×1080 썸네일이다. 주소 소개 직후 Android Chrome·iPhone Safari 설치 절차, 인트로·신청·QR·얼굴·물음표 도움말 마무리를 유지했다. 이전 완성본과 v3 음성은 `out/archive/v1/`~`v3/`에 보관한다. 최종 검증은 `out/validation-v4.json`, 원음 말끝 검사는 `out/audio-diagnosis/restored-endpoints.json`에 있다. 직접 청취는 미실시다.

`out/student-chapters.ffmetadata`를 FFmpeg의 추가 입력으로 읽고 `-map_chapters 1 -map_metadata 1 -c copy -movflags +faststart`로 MP4에 챕터를 넣었다. 재렌더 시 챕터 삽입과 최종 프레임 추출을 다시 수행한다. 썸네일은 `npx remotion still Student-Intro out/PosanMeal-student-guide-thumbnail.png --frame 12`로 원본 PNG를 다시 만들 수 있다. 아웃트로의 물음표 도움말은 후속 구현된 `/help/student`로 연결되며 로그인 화면과 학생 헤더에 진입점이 있다.

```bash
npm run dev
node scripts/narrate.mjs --guide setup-check --estimate
node scripts/narrate.mjs --guide setup-check
node scripts/narrate.mjs --guide setup-check --only Check-1
node scripts/narrate.mjs --guide setup-check --measure
node scripts/frame-at.mjs setup-check Check 1 0.5
npx remotion render SetupCheck out/setup-check.mp4
node scripts/guide-stills.mjs --page setup-check --out out/guide-stills-check
```

`--estimate`는 음성을 생성하지 않고 길이 JSON을 덮어쓴다. 이 상태에서 음성 파일을 포함한 렌더가 성공한 것으로 판단하지 않는다. 음성 생성 전에는 `GuideScene`이 참조할 mp3가 없다. `--measure`는 기존 문장·장면 mp3 길이만 재측정하며, 새 원고에 맞는 음성을 생성하지 않는다.

실제 가이드 이미지를 배치할 때는 `--out`을 생략하면 `public/guide/<page>/`에 생성된다. `--only <파일명>`, `--scale 2`, `--max-kb 400`으로 일부 스틸·해상도·용량 기준을 지정할 수 있다. 출력 PNG는 `out/guide-stills/`에 남으며 최종 WebP를 페이지와 함께 검수한다.

## 음성

| 항목 | 값 |
|---|---|
| Python | Homebrew `python3.12`, 가상환경 `.venv-tts` |
| 패키지 | `mlx-audio==0.5.3`, `requirements-tts.lock.txt` |
| TTS 모델 | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` |
| 참조 | `~/Library/Application Support/sh.voicebox.app/voicebox.db`, `Chois` 프로필의 첫 샘플, 읽기 전용 |
| TTS 캐시 | 기본 `~/.cache/huggingface/hub`, `HF_HOME` 설정 시 그 아래 `hub` |
| STT | `mlx-community/whisper-large-v3-turbo`, 기본 `/Volumes/Chois_SD2/dev/hf-cache` |
| 설정 | `TTS_PROFILE`, `TTS_MODEL`, `TTS_PYTHON`, `VOICEBOX_DB`, `HF_HUB_CACHE` |

- Qwen3 단일 비패딩 음성 생성에는 `tts_mlx.py`의 `preserve_single_unpadded_decode_length`를 적용한다. `mlx-audio 0.5.3`의 `decode`가 유효 코드 `0`을 패딩으로 세어 전체 음성 끝을 잘라내는 경로를 보정한다. 반환 파형은 바꾸지 않고 입력 토큰 수에 맞는 길이를 돌려준다. 패딩이 있는 배치 입력에는 적용하지 않는다. 생성기 소스 해시도 캐시 키에 포함되므로 보정 전 음성은 재생성된다.
- 패딩 전 원본 WAV의 마지막 20ms RMS가 -60dB 이하인지도 검사합니다. 소리가 남은 채 끝나면 해당 문장만 최대 세 라운드 재생성하며, 실패를 긴 무음이나 발화 위 페이드로 가리지 않습니다. 측정값은 `review.tsv`의 `ending_rms_db`에 기록합니다.
- Voicebox 서버 API 대신 `scripts/tts_mlx.py`를 순차 워커로 사용한다. 원본 환경에서 서버 경유 MLX 생성이 멈추는 문제가 있어 직접 모델을 호출한다.
- `tts_mlx.py`는 DB를 `mode=ro`로 연다. 참조 녹음·DB·모델을 프로젝트에 복사하지 않는다. 참조 문장은 실제 녹음과 일치해야 하며, 수정이 필요하면 먼저 불일치를 보고한다.
- `HF_HUB_CACHE`는 STT 캐시 전용이다. `narrate.mjs`는 TTS 워커에서 이 변수를 제거하고, 각 Python 워커를 `HF_HUB_OFFLINE=1`로 실행한다. TTS 모델을 이동하면 `HF_HOME`과 실제 캐시 위치를 함께 맞춘다.
- TTS와 Whisper를 동시에 실행하지 않는다. `narrate.mjs`가 음성 생성을 마친 다음 전사한다.
- `narration.ts`의 자막 원문과 `SPOKEN`의 음성 발음을 나눈다. 숫자·영문·특수기호는 한글 발음으로 적고 `findUnreadable` 검사에 통과시킨다. 예: `PosanMeal` → `포산밀`, `QR` → `큐알`.
- 문장 끝은 **끝음절·잔향 보존 → 약 1초 여유(무음) → 0.35초 음량 페이드아웃**이다. `narration.ts`에 `TRAILING_SILENCE_SECONDS = 1`, `FADE_OUT_SECONDS = 0.35`를 둔다. 원음에 남은 잔향을 살리고 부족한 길이만 무음으로 채운다. 무음 구간에 인위적인 소리를 덧붙이지 않는다.
- 앞 무음은 -40dB 기준으로 제거한다. 끝 무음 -45dB 제거는 발화 길이 측정용 복사본에만 적용한다. 출력은 앞 무음만 제거한 원음이며, 측정 발화 종료 + 1초부터 0.35초간 `afade`의 `hsin` 곡선으로 0까지 줄인다. 끝음절을 먼저 잘라낸 오디오에 무음만 붙이지 않는다. 원음 자체의 발음이 잘렸으면 해당 문장을 재생성한다.
- 문장 길이 JSON에는 여유·페이드 1.35초를 포함하며 문장 사이에는 `LINE_GAP_SECONDS`(샘플 0.2초)가 추가된다. 속도 검사는 여유·페이드 전 발화 길이로 계산한다. `say`를 명시적으로 사용하는 경우도 같은 후처리를 거친다.
- 캐시 키에 여유 길이·페이드 길이·후처리 해시(트림 설정·페이드 곡선·버전)를 포함한다. 이전 0.5초 패딩 캐시는 무효화된다. 이미 복사한 제작 폴더는 `narrate.mjs`·`lib/narration-core.mjs`와 각 원고의 두 상수를 함께 갱신하고 일반 생성 명령을 다시 실행한다. `--measure`는 기존 파일 길이만 재므로 새 후처리를 적용하지 않는다.
- 발화 속도 초당 3~9자 또는 최소 0.6초 기준을 벗어나면 최대 세 라운드 재생성한다. 계속 실패하면 원고·참조 상태를 점검한다.
- `review.tsv`의 `CHECK`는 Whisper 유사도 0.8 미만, `NOCHECK`는 전사 없음이다. `OK`도 정확한 발음과 자연스러움을 보장하지 않는다. 최종 영상에서 발음·끝음절·무음·자막 동기화를 직접 듣고 확인한다.
- `--no-check` 다음 재실행은 남아 있는 raw wav만 전사한다. raw가 없으면 `--only`로 재생성해야 검수할 수 있다. 참조 음성을 바꾸면 참조 해시가 바뀌어 캐시가 다시 생성된다.

원고 변경 뒤 음성을 다시 만들면 `narration-durations.json`에서 장면·커서·자막 길이가 재계산된다. 렌더 시 Google Fonts(Inter, Noto Sans KR)를 네트워크로 받아 오므로 실제 렌더 환경에서 폰트 로딩도 확인한다.

## 학생 안내 페이지 연결

앱 `/help/student`는 `https://youtu.be/rOww_TPHGR0`와 이 영상에서 추출한 목업을 사용한다. `/help`는 학생 안내로 이동한다. 앱 `src/app/help/student/content.ts`에서 영상 주소·4목차·9단계·영상 시작 초·이미지 목록을 관리한다. `public/guide/student/`에는 본문 이미지 16장과 `00-intro.webp`를 배치했다. 영상을 교체하면 해당 파일의 주소·구간 시각과 이미지도 함께 맞춘다.

로그인 전 접근, 새 탭 도움말, 영상 재생·구간 이동, 원본 이미지 확대, 320/375/640/768/1024/1280px 화면을 로컬에서 확인했다. 운영 사이트 배포는 수행하지 않았다.
