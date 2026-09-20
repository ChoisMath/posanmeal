# 2026-09-19 학생 안내 영상 제작

문장 끝 원음 절단을 수정한 **v4 최종 영상 제작·검증 완료**. 18장면·59문장·11,694프레임, 컨테이너 389.824초(약 6분 30초), 35,586,560bytes이며 원음 종료 검사와 최종 MP4 파형 검사 모두 59/59 통과했다. 직접 청취와 실제 휴대전화 설치 검증은 미실시다. v3 영상·기존 음성 캐시는 `demo-video/out/archive/v3/`, v1·v2도 각 archive 폴더에 보존했다. 아래 버전별 검증을 구별하며, 과거 전사·tail 길이 검증만으로는 원음 끝음 보존을 입증하지 못했다.

## v1 완료한 변경

- `$guide-page`와 Remotion·`mlx-voice-clone`을 사용해 루트 `demo-video/`를 템플릿에서 복사·설치했다. Remotion 4.0.518, 독립 Python 3.12 가상환경, `mlx-audio==0.5.3`을 사용한다. 기존 Chois 음성 프로필과 모델 캐시는 읽기 전용으로 재사용하며 원본 DB·참조 녹음을 복사하지 않았다.
- `StudentGuide` 본편은 14장면·40문장이다. `meal.posan.kr` 주소 강조, 등록된 Google 계정과 잘못된 계정 복구, 학생 탭과 식단, QR 보안·인쇄, 얼굴 등록과 체크인, 기록 확인을 포함한다. 사용자의 추가 요청에 따라 신청 공고→기간·본인 확인→식사 선택→급식비·서명→제출 결과→기간 내 수정·취소를 포함했다.
- 실제 앱 흐름을 바탕으로 학생·Google·키오스크 React 목업과 장면별 강조·포인터·자막을 만들었다. 학생·계정·식단·이력은 가상 예시이고 QR은 사용 가능한 자격정보가 없는 안내 패턴이다.
- 실제 Chois 음성 40문장을 생성하고 실측 길이로 자막·장면 시간을 계산했다. 발화의 끝음절·잔향을 보존한 뒤 1초 여유와 0.35초 페이드아웃을 적용한다.
- 본편과 같은 장면에서 검토용 스틸 12장(PNG·WebP)을 추출했고, SRT 자막·챕터 정보·검수 타임라인을 생성했다. `docs/video/student-guide-storyboard.md`에 장면 구성과 화면 근거를 기록했다.
- 독립 제작 폴더를 루트 TypeScript·ESLint·Tailwind 탐색에서 제외했다. 앱 `/help`, 운영 DB, 배포는 변경하지 않았다. 기존 동시 작업과 전역 메모리·legacy 원본은 보존했다.

## 설명에서 보존할 기준

- 학생 로그인 후 기본 탭은 식단이다. 식단·QR·개인정보·확인을 제공하며 신청 탭은 신청 공고가 있을 때 추가된다. 급식실 키오스크의 기본 QR 화면과 구별한다.
- Google은 학교에 등록된 본인 계정을 사용한다. 잘못된 계정은 로그아웃 후 계정을 선택하고, 자동 선택이 계속되면 새 시크릿 창에서 로그인한다. 앱 초기화가 Google 계정 선택을 보장한다고 안내하지 않는다.
- 고정 QR은 학교의 로컬 운영 모드에서 발급된다. 학생이 QR을 직접 고정하는 버튼은 없다. 코드·인쇄물 공유 금지와 분실 시 담임 문의를 안내한다.
- 신청 방식은 공고에 따라 신청함/신청안함 또는 요일·날짜 선택으로 달라진다. 면제 항목은 공고에 표시되며 실제 대상일 때만 선택한다. 서명 후 제출하고 신청완료·신청내역을 확인한다. 수정·취소는 신청 기간 안에 수행한다.
- 얼굴 등록은 선택 동의이며 QR 이용을 대체할 의무가 없다. 얼굴 체크인은 우하단 버튼으로 전환하고, 베타 기능이므로 표시된 학번·이름을 확인한 뒤 확인을 눌러야 한다. 타인으로 인식되면 취소하고 QR을 사용한다.
- 확인 탭의 월별 기록에서 식사하지 않은 날이나 누락을 찾아 담임에게 알린다. 현재 학생 달력에 없는 식사별 라벨을 목업에 추가하지 않는다.

## v1 실제 검증

- `demo-video` 환경 점검 9/9 및 테스트 22개(Node 15·Python 7) 통과. 독립 환경의 번들·브라우저·Google Fonts 로딩을 확인했다. 최초 브라우저 실행 시간 초과는 재시도로 해결됐다.
- 실제 40문장 음성의 Whisper 전사 검수 결과 `CHECK 0 / NOCHECK 0`. 이는 전사 기준이며 사람이 직접 청취한 검증은 아니다.
- `demo-video`의 `npm run lint`(ESLint·TypeScript)와 루트 `npx tsc --noEmit` 통과.
- 프레임·목업을 직접 시각 검수했다. 작업자가 responsive reviewer 체크리스트를 수행해 차단할 문제를 발견하지 못했다. 고정 1920×1080 영상 검수이며 실제 기기에서 앱 UI를 검증한 결과는 아니다.
- 최종 MP4에서 14장면의 전체 프레임과 가이드 WebP 12장을 추출했다. 연락판(contact sheet)과 Closing·Print·주요 장면을 직접 시각 검수했다. WebP 12장의 합계는 333,094bytes, 최대 파일은 35,814bytes다.
- SRT 40개 자막 구간이 서로 겹치지 않는 것을 확인했다. 14개 챕터 삽입·faststart remux 뒤 `ffprobe`로 H.264·1920×1080·30fps·7,619프레임, AAC·48kHz를 확인했다. 전체 FFmpeg 디코딩은 7,619프레임·종료 코드 0이며 peak -4.5dB, mean -25.3dB다.
- 이전 스킬 이관 작업에서 전체 앱 lint는 기존 오류 14개·경고 10개로 실패했다. 이번 영상 검증을 전체 앱 lint 통과로 해석하지 않는다.

## v1 최종 산출물·남은 검증

- `demo-video/out/PosanMeal-student-guide.mp4`: 최종 렌더·챕터 삽입·faststart 처리 완료. 컨테이너 길이 253.994667초(약 4분 14초), 23,687,791bytes(23.7MB). 영상 프레임 기준 길이는 253.966667초다.
- 함께 제공하는 파일은 `demo-video/out/PosanMeal-student-guide-preview.jpg`, `PosanMeal-student-guide.srt`, `PosanMeal-student-guide-chapters.txt`와 `demo-video/out/guide-stills/student/`의 장면 이미지다. 생성 음성·환경·산출물은 Git 제외 대상이다.
- 사람의 전체 청취 검수는 미실시다. 자동 전사·디코딩·음량 및 시각 검수를 자연스러운 발음·청취 검수 완료로 기록하지 않는다.
- 앱 `/help` 구현·앱 build·DB 변경·운영 배포는 이번 요청 범위에서 실행하지 않았다.
- 별도 앱 검토 후보: 소스 감사에서 신규 WEEKDAY/DATE 신청의 `applied=false` 초기 상태로 인해 `PaymentSummary` 총 납부금액이 0으로 남을 수 있는 경로를 발견했다. 런타임 재현·앱 수정은 하지 않았다. 이번 영상은 실제 YN 신청 예시를 사용했다.

## v2 후속 개정 — 도입·얼굴 인식 선택·마무리

- 사용자의 추가 요청 세 가지를 반영했다. `Intro` 장면에 첫 화면 제목 `포산밀 학생 사용 안내`와 인사를 넣고, `Print`와 `Enroll` 사이에 `FaceOption` 장면을 추가해 휴대전화나 인쇄 QR을 휴대하기 어려울 때 베타 얼굴 인식을 선택할 수 있다고 소개한다. `Closing`은 기존 네 가지 수칙 뒤에 `?` 아이콘으로 학생 안내 페이지를 다시 확인하는 안내와 인사를 넣었다.
- 학생 안내 페이지는 사용자가 계획한 단계로 영상 안에서만 안내했다. 이번 영상 작업에서는 앱 `/help`·앱 기능·DB·배포를 수정하지 않았다.
- 총 16장면·46문장이다. 변경·신규 음성 7문장을 생성하고 39문장은 캐시를 재사용했다. Whisper 전사 검수는 전체 46문장 `CHECK 0 / NOCHECK 0`이며 실측 구성은 8,898프레임·296.6초(약 4분 57초)다. 기존 말끝 보존·1초 여유·0.35초 페이드 기준을 유지했다.
- 후속 변경에서 환경 점검 9/9, 영상 전체 lint·type 검사, 변경된 3장면 스틸 직접 검수와 `responsive-ui-reviewer` 검토를 통과했다. 테스트 22개·루트 type 등 위 기록은 v1에서 실제 실행한 결과이며 후속 개정에서 재실행했다고 기록하지 않는다.
- `demo-video/out/PosanMeal-student-guide.mp4`의 v2 최종 렌더·16개 챕터·faststart 처리 완료. H.264·1920×1080·30fps·8,898프레임, AAC·48kHz, 컨테이너 길이 296.618667초, 27,755,994bytes(27.8MB)다. 전체 FFmpeg 디코딩은 8,898프레임·종료 코드 0이며 max -4.4dB, mean -25.4dB다.
- 최종 MP4의 16장면을 추출해 contact sheet 및 FaceOption·Closing을 직접 시각 검수했다. 가이드 WebP는 15장, 합계 412,240bytes, 최대 35,792bytes다. 별도 `demo-video/out/PosanMeal-student-guide-thumbnail.png`는 Remotion 원본 프레임 12에서 출력한 1920×1080 무손실 PNG다.
- SRT 46구간의 범위·순서·비중첩을 확인했고 모든 문장의 말끝 여유와 페이드 길이는 1.350~1.351초다. `?` 학생 안내 페이지 소개는 280.5667초(4분 40초)부터 마지막 약 16초에 배치했다. 해당 앱 도움말은 아직 구현하지 않았으며 계획된 흐름을 영상으로 안내한 것이다.
- v1 보존 파일은 `demo-video/out/archive/v1/`에 있다. 사람의 전체 청취 검수는 여전히 미실시다.

## v3 후속 개정 — Android·iPhone 설치 안내

- 사용자 요청에 따라 URL 소개 직후 Android Chrome과 iPhone Safari에서 홈 화면에 설치하는 절차를 상세히 추가했다. 순서는 `Intro → Address → AndroidInstall → IphoneInstall → Login → 기존 장면`이며 총 18장면·59문장이다. 실측 구성은 11,317프레임·377.233초(약 6분 17초)다.
- `InstallMockups.tsx`, `AndroidInstall.tsx`, `IphoneInstall.tsx`와 실제 앱 아이콘을 이용한다. Android는 Chrome의 `⋮` 메뉴부터 설치·홈 아이콘 실행까지 6문장, iPhone은 Safari 공유→홈 화면에 추가→아이콘 실행까지 7문장이다. Chrome 버전에 따른 메뉴 차이, iPhone의 동작 편집, `웹 앱으로 열기`가 보이면 켜는 조건을 설명한다.
- 학생에게는 브라우저를 통한 PWA 설치 절차로 표현했다. TWA 패키지·APK 제작이나 배포 작업은 수행하지 않았다. 실제 공개 manifest는 읽기 전용으로 확인해 `demo-video/out/live-manifest-v3.json`에 저장했지만 실제 Android·iPhone 기기에서 설치하는 검증은 하지 않았다.
- 기존 46문장 음성을 보존하고 신규 13문장을 생성했다. `AndroidInstall-5`는 한 차례 재생성했다. 전사 검수 `CHECK 0 / NOCHECK 0`, 전체 59문장의 말끝 여유·페이드 1.350~1.351초를 확인했다. 사람의 직접 청취 검수는 미실시다.
- 영상 lint·TypeScript 검사 통과. 기본 프레임 15장과 추가 상태·수정 후 프레임을 직접 검토했고 UI reviewer의 최종 차단 지적은 없다. 보조 안내문과 카드의 겹침 및 `LandingMock`의 z-index 누수를 해결했다. 이전 버전의 doctor·테스트·루트 type 기록을 이번 버전에서 재실행한 결과로 간주하지 않는다.
- 최종 MP4에서 18장면과 가이드 WebP 19장을 추출해 시각 검수했다. WebP 합계 505,290bytes, 최대 35,914bytes다. SRT 59구간의 순서·범위·비중첩, 챕터 18개와 실제 프레임 정합성, 1920×1080 원본 썸네일을 확인했다.
- v3 최종 렌더·18챕터·faststart 처리 완료. `demo-video/out/PosanMeal-student-guide.mp4`: H.264 1920×1080 30fps, AAC 48kHz, 11,317프레임, 컨테이너 377.258667초, 34,654,196bytes(34.7MB). 전체 FFmpeg 디코딩 종료코드 0, 최대 음량 -3.9dB. 결과 수치는 `out/validation-v3.json`과 `out/final-probe-v3.json`, 디코딩 기록은 `out/final-decode-v3.log`에 있다. v2 보존본은 `demo-video/out/archive/v2/`에 있다. 앱 `/help`·DB·운영 배포는 이 영상 개정에서 수정하지 않았다.

## v4 완료 — 생성 단계의 문장 끝 절단 수정

### 진단과 재현

- 사용자가 v3 전반에서 문장 끝이 딱 끊기는 문제를 보고했다. v2/v3 공통 46문장의 PCM을 0.33~0.67ms 라그로 정렬했을 때 상관계수는 모두 0.999881 이상이고 종료 시점 차이는 0이었다. v3에서 새롭게 자른 근거는 없으며 기존 캐시에도 같은 문제가 있었다.
- 원인은 `mlx-audio==0.5.3` Qwen3의 `speech_tokenizer.decode`가 유효한 codec 토큰 `0`을 padding으로 취급해 `valid_length`를 줄이는 계산이었다. 참조 356토큰 중 `0` 하나 때문에 전체 끝 80ms가 잘린 뒤 참조 구간이 비례 절단됐다. 기존 raw 59개 길이 모두 오류식에 일치했다. 58개는 `0` 1개, `FaceOption-0`은 2개여서 끝 160ms가 잘렸다.
- 기존 원음의 마지막 20ms RMS는 58/59개가 -60dB보다 크고 39/59개는 -45dB보다 컸다. 후처리로 여유·페이드 시간을 붙였더라도 생성 단계에서 잘린 원음은 돌아오지 않는다. 이전 전사 `CHECK 0`과 1.35초 tail 검증을 말끝 보존의 근거로 삼지 않는다.
- 동일 코드 재현에서 Address 샘플은 전체 783,360 대비 유효 781,440샘플로 1,920샘플이 사라졌다. 잘린 끝의 -48.9dB 대비 정상 전체 target 끝은 약 -99dB였다. iPhone 샘플도 1,920샘플이 사라졌고 -20.46dB 대비 정상 target 끝은 -98.94dB였다.
- 근거는 `demo-video/out/audio-diagnosis/aligned-comparison.json`, `generation-probe.json`, `comparison.json`이다. 참조 오디오와 참조 본문은 출력하거나 복사하지 않았다.

### 완료한 수정·검증

- `scripts/tts_mlx.py`에 `preserve_single_unpadded_decode_length(tokenizer)`를 넣고 `load_model` 직후 적용했다. 단일 비패딩 입력에서 유효 길이를 `min(T × rate, 실제 파형 길이)`로 보정하며 파형·dtype·shape는 유지한다. 배치 입력은 기존 결과를 그대로 반환한다. `mlx-audio==0.5.3`과 기존 모델을 유지한다.
- 초기 길이 보정 시점에 추가 회귀 테스트 5개를 RED → GREEN으로 검증했다. 당시 Node 15개·Python 12개, 총 27개 테스트가 통과했다. 기록은 `demo-video/out/audio-diagnosis/tests-v4.log`다. 아래 종료 검사 추가 뒤의 결과와 구분한다.
- `narrate.mjs`의 `AUDIO_PROCESSING`에 생성기 소스 해시를 포함해 기존의 잘린 음성 캐시를 폐기한다. helper·테스트·캐시 변경을 제작 템플릿에도 동기화했다. 두 스킬의 원음 끝 구간 검사·호환 보정 안내와 `quick_validate` 2개 검증을 완료했다. 상세는 [스킬 인계 기록](2026-09-19-guide-page-skills.md) 참조.
- 원음 EOF 마지막 20ms RMS에 -60dB 기준 종료 검사를 추가하고 실패한 문장을 최대 3라운드 재시도한다. 제작본과 템플릿 모두 Node 18개·Python 12개, 총 30개 테스트가 통과했다. 스킬 `quick_validate` 2개와 `demo-video` lint·TypeScript 검사도 통과했다.
- `demo-video/out/PosanMeal-audio-before.wav`, `demo-video/out/PosanMeal-audio-after.wav` 비교 파일을 생성했다. 직접 청취는 미실시다. v3 완성 영상과 음성 캐시는 `demo-video/out/archive/v3/`에 보존했다.

### 재생성 확정과 최종 검증

- 전체 59문장 1차 생성 뒤 종료 검사에 실패한 18문장을 추가 생성했다. 최대 3라운드 후에도 실패한 `IphoneInstall-4`·`Sign-0`·`Kiosk-0`은 안내 의미를 유지하면서 종결을 각각 `켜 둡니다 → 켜 두세요`, `서명합니다 → 서명해 주세요`, `기본 QR 인식 화면입니다 → 기본적으로 QR을 인식하는 화면으로 시작해요`로 다듬었다. 원고·자막·`SPOKEN`을 맞춰 재생성한 뒤 최종 59문장을 확정했다.
- 최종 raw 59개 모두 codec 프레임 길이가 맞고 EOF 마지막 20ms RMS가 -60dB 이하다(최대 -63.154dB). 전사 `CHECK 0 / NOCHECK 0`, 마지막 5음절은 59문장 모두 일치했다. 별도 전사 리뷰에서도 명백한 누락은 발견하지 못했다. 문장별 말끝 여유·페이드는 1.350~1.351초다.
- 최종 MP4의 59문장을 원음과 비교한 `demo-video/out/audio-diagnosis/verified-v4-rendered-audio.json`의 `summary.pass=true`, `passedLines=59`를 확인했다. 전체 발화 상관계수 최소 0.99841288, 마지막 200ms 상관계수 최소 0.99522834, 꼬리 음량 차이 최대 0.49374dB다.
- 원음과 렌더 음량 차이 때문에 절대 임계값 끝시점 검사에서 3건의 오탐이 발생했다. 끝시점 측정에만 전체 발화에서 구한 고정 gain을 적용해 정규화했으며 원래 상관계수·레벨 조건은 유지했다. 보정 후 끝시점 차이 최소 -10ms로 허용 15ms 이내였고 기존 오탐 3건은 모두 0ms다. 실제 꼬리를 제거하면 실패하는 보조 회귀 검사도 통과했다(핵심 테스트 30개와 별도).
- 최종 `demo-video/out/PosanMeal-student-guide.mp4`는 11,694프레임, 영상 타임라인 389.8초, 컨테이너 389.824초, 35,586,560bytes다. 18챕터·59자막 구간과 faststart 처리를 확인했고 전체 디코딩을 완료했다. 최대 음량은 -3.2dB다. 최종 수치와 파형 검사 요약은 `demo-video/out/validation-v4.json`에 있다.
- 최종 18장면 contact sheet와 Android·iPhone·수정한 Sign/Kiosk·Closing 및 썸네일을 시각 검토했고 reviewer의 지적은 없다. 가이드 WebP 19장 합계 504,380bytes, 최대 35,914bytes, 원본 썸네일은 1920×1080이다.
- 제작본·템플릿의 Node 18개 + Python 12개 = 30개 테스트, 두 스킬 검증, `demo-video` lint·TypeScript 검사가 통과했다. 초기 길이 보정 단계의 27개 테스트 결과와 구분한다.

### 남은 검증·범위

- 직접 청취는 미실시다. `AndroidInstall-1`의 `세 개/세계`, `Manage-1`의 `서명해/서명에` 전사 표기 차이가 있어 자연스러운 발음 확인은 청취가 필요하다. 자동 전사·원음 종료·MP4 파형 검증을 사람의 청취 검수로 기록하지 않는다.
- 실제 Android·iPhone 기기 설치 검증은 미실시다. 앱 `/help`·앱 기능·DB·운영 배포는 이번 영상 수정에서 변경하지 않았다. 사용자 전역 메모리와 다른 작업자의 변경을 보존했다.
