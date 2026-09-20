---
name: mlx-voice-clone
description: PosanMeal 안내 영상용 한국어 클론 음성을 기존 Voicebox Chois 프로필과 mlx-audio 0.5.3으로 생성하고, 발음·길이·자막 동기화를 검수할 때 사용한다.
---

# PosanMeal 로컬 클론 음성

이 프로젝트의 실제 패키지는 `mlx-audio==0.5.3`이다. 사용자가 `mix-audio`라고 부르는 작업도 이 구현을 확인해 사용한다. 기존 `Chois` 프로필을 활용하며, 스킬 설치만 요청된 경우 음성 생성·모델 다운로드·프로필 편집까지 실행하지 않는다.

## 실행 경로

공용 구현은 [guide-page 템플릿](../guide-page/assets/demo-video/README.md)에 있다. 상세 환경·설치는 이 README의 「설치」와 「음성」을 읽는다.

- TTS 워커: [tts_mlx.py](../guide-page/assets/demo-video/scripts/tts_mlx.py)
- 원고·캐시·길이·검수 파이프라인: [narrate.mjs](../guide-page/assets/demo-video/scripts/narrate.mjs)
- STT 검수: [stt_check.py](../guide-page/assets/demo-video/scripts/stt_check.py)

실제 제작은 프로젝트 루트의 `demo-video/`에서 한다. 없으면 `$guide-page`의 준비 절차로 템플릿을 복사한다. 스킬 자산 폴더에는 의존성·가상환경·생성 오디오를 설치하거나 만들지 않는다. 기존 `demo-video/`가 있다면 원고·음성·등록 가이드를 보존한다.

## 절차

1. `demo-video/README.md`, `requirements-tts.txt`, `requirements-tts.lock.txt`와 `scripts/narrate.mjs`의 `GUIDES` 등록을 확인한다. `npm run doctor`로 Python·도구·모델 캐시·Voicebox 참조의 현재 준비 상태를 확인한다.
2. `src/<guide>/narration.ts`의 자막 원고를 확인하고 `SPOKEN`에 숫자·영문·기호의 한글 읽기를 넣는다. `PosanMeal`은 `포산밀`, `QR`은 `큐알`처럼 실제로 읽힐 문장을 검토한다. 음성용 문자는 한글·공백·마침표·쉼표·가운뎃점만 허용되므로 코드의 검사 결과를 따른다.
3. `node scripts/narrate.mjs --guide <guide>`로 생성한다. 처음 환경을 준비했다면 `setup-check`의 세 문장부터 생성·청취하고 본편에 적용한다. 원고를 새로 등록했는지, 경로가 PosanMeal 프로젝트인지 먼저 확인한다.
4. `public/narration/<guide>/review.tsv`와 mp3를 확인한다. `CHECK`·`NOCHECK`를 해결하고, 최종 음성을 직접 들어 한국어 발음·빠르기·끝음절·끊김·문장 사이 무음을 검수한다. 특히 마지막 음절이 완전히 들린 뒤 약 1초 쉬고 음량이 부드럽게 사라지는지 확인한다. STT 유사도만으로 청취 검수를 대체하지 않는다.
5. 문제가 있는 문장은 원고 또는 `SPOKEN`을 고쳐 `--only <SceneId>-<문장 인덱스>`로 재생성한다. 인덱스는 0부터 시작한다. 최종 `narration-durations.json`이 실측 결과인지 확인한 뒤 영상·스틸을 다시 렌더하고 자막·커서와 동기화를 점검한다.

```bash
cd demo-video
npm run doctor
node scripts/narrate.mjs --guide setup-check
node scripts/narrate.mjs --guide setup-check --only Check-1
```

## 유지할 조건

- `tts_mlx.py`는 Voicebox DB를 SQLite `mode=ro`로 읽는다. 기본 경로는 `~/Library/Application Support/sh.voicebox.app/voicebox.db`, 프로필은 `Chois`다. `VOICEBOX_DB`·`TTS_PROFILE`로 기존 위치를 지정할 수 있다. DB·참조 녹음·개인 참조 문장을 프로젝트나 공유 산출물에 복사하지 않는다.
- Voicebox 서버 API로 생성하지 않는다. 공용 스크립트가 직접 MLX 모델을 로드하는 방식을 재사용한다. 참조 문장은 녹음과 일치해야 하며, 불일치 시 원본을 임의 수정하지 말고 상태를 보고한다.
- TTS 모델은 `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`이며 기본 Hugging Face 캐시를 읽는다. STT 모델은 `mlx-community/whisper-large-v3-turbo`, 기본 캐시는 `/Volumes/Chois_SD2/dev/hf-cache`다. `HF_HUB_CACHE`를 TTS 워커에서 제거하는 코드를 유지한다. 캐시 위치 변경 시 `HF_HOME`과 TTS 캐시 경로를 함께 확인한다.
- Python 워커는 `HF_HUB_OFFLINE=1`로 실행된다. 없는 모델이 자동 설치된다고 가정하지 않는다. 요청된 음성 제작에 설치가 필요하면 README의 잠금 파일과 캐시 준비 명령을 따른다.
- TTS 워커가 끝난 뒤 STT를 실행한다. 여러 영상에 대해 `narrate.mjs`를 병렬 실행하지 않는다.
- `mlx-audio 0.5.3` Qwen3의 단일 비패딩 ICL 디코딩에는 템플릿의 `preserve_single_unpadded_decode_length` 보정을 유지한다. 코드북의 유효한 `0`을 패딩으로 세면 참조 음성에 있는 코드 때문에 모든 문장 말끝 80ms 이상이 잘릴 수 있다. 생성기 소스도 캐시 키에 포함하며, 보정 전 WAV/MP3는 재생성한다. 패딩이 있는 배치 입력에 이 보정을 확대 적용하지 않는다.
- 문장 종료는 **원음 끝음절·잔향 보존 → 약 1초 여유(무음) → 0.35초 부드러운 음량 페이드아웃** 순서다. 원고에 `TRAILING_SILENCE_SECONDS = 1`, `FADE_OUT_SECONDS = 0.35`를 내보낸다. “슬라이딩”은 음량을 점진적으로 줄이는 것으로 처리한다.
- 앞 무음만 제거한 원음에 후처리한다. 뒤 무음 제거본은 발화 길이 측정에만 사용하고 실제 출력으로 쓰지 않는다. 원음의 잔향을 유지하며 부족한 길이는 무음으로 채운 뒤, 발화 종료 + 1초 시점부터 `hsin` 곡선으로 음량을 0까지 줄인다. 이미 무음인 구간에는 소리를 새로 만들지 않는다. 원본 발음 자체가 잘렸다면 해당 문장을 다시 생성한다.
- 말끝 검수는 패딩 전 원본 WAV도 확인한다. 문장 길이가 1.35초 늘었거나 STT가 일치해도 끝음절 보존을 보장하지 않는다. 원음 마지막 20ms RMS가 -60dB 이하인지 검사하고 `review.tsv`의 `ending_rms_db`에 기록한다. 실패하면 해당 문장만 최대 세 라운드 재생성하고, 반복 실패는 생성/디코딩 원인을 점검한다. 이 수치 검사는 청취 검수를 대체하지 않는다. 긴 무음이나 발화 위 페이드로 가리지 않는다.
- 문장·장면 길이 JSON에는 여유와 페이드 1.35초를 모두 포함한다. 기존 `LINE_GAP_SECONDS`는 문장 사이에 추가되므로 쉼이 길면 이 값을 조정하고 자막 타이밍에도 같은 값을 사용한다. 다음 문장과 장면 전환이 앞 문장의 꼬리를 잘라 먹지 않게 최종 렌더를 확인한다.
- 캐시는 문장·참조·모델 외에 여유 길이·페이드 길이·후처리 해시를 비교한다. 이전 0.5초 패딩 캐시는 재사용하지 않는다. 기존 제작 폴더에도 스크립트와 원고 설정을 반영한 후 일반 생성 명령을 다시 실행한다. `--measure`만으로 기존 파일에 페이드가 생기지는 않는다.
- 속도·길이 검사는 여유·페이드 전 발화 길이로 수행한다. 실패는 최대 세 라운드 재시도한 뒤 멈추고, 반복되면 참조 문장·원고·모델 환경을 점검한다. 특정 종결 표현에서만 계속 실패하면 안내 의미를 유지하는 자연스러운 문장으로 다듬고, 자막 원고와 `SPOKEN`을 함께 맞춘 뒤 다시 검증한다. 검사 임계값을 완화하거나 발화 위 페이드로 통과시키지 않는다.
- `--estimate`는 길이 JSON을 덮어쓰는 임시 시각화용이다. 실제 음성이나 검수 결과가 아니다. `--measure`는 기존 mp3를 재측정할 뿐 원고 변경을 반영한 음성을 만들지 않는다.
- 생성 음성·raw wav·검수 캐시는 로컬 `demo-video/public/narration/`에 보관하며 템플릿이나 Git에 넣지 않는다. 결과를 공개할 때는 사용자가 요청한 최종 영상·가이드 산출물만 배치한다.

보고할 때 **스킬 적용**, **환경 점검**, **음성 생성**, **청취 검수**, **영상 동기화 확인** 중 실제 수행한 범위를 구분한다. 읽기 전용 코드 테스트나 템플릿 복사를 실제 목소리 검증 완료로 표현하지 않는다.
