# PosanMeal 학생 안내 영상

1920×1080 · 30fps · 한국어 Chois 내레이션 · 자막 포함. 실제 앱 UI의 주황색 헤더와 모바일 탭을 재현한 React 목업을 사용한다. 모든 학생·계정·식단·체크인 예시는 가상 데이터다. QR은 안내용 패턴이며 사용 가능한 학생 자격정보를 담지 않는다.

| 장면 | 전달할 내용 | 화면 연출 |
|---|---|---|
| Intro | 포산밀 학생 사용안내, 학생 인사와 전체 내용 소개 | 첫 프레임부터 큰 타이틀·폰 목업, 핵심 3개 항목 순차 강조 |
| Address | meal.posan.kr 접속 | 주소창 입력, 대형 주소 강조, 로그인 화면 |
| AndroidInstall | Chrome에서 앱 설치 | 점 세 개→설치 및 바로가기 만들기→설치, 버전별 메뉴 이름, 주소 확인→설치 완료→홈 화면 아이콘 |
| IphoneInstall | Safari에서 홈 화면에 추가 | 공유→공유 메뉴 올리기→홈 화면에 추가, 없으면 동작 편집, 이름/주소와 웹 앱으로 열기→추가→아이콘 실행 |
| Login | 학교에 등록된 본인 Google 계정 | Google 로그인과 가상 계정 선택 |
| Recovery | 잘못된 계정에서 복구 | 로그아웃 → 계정 선택 → 시크릿 창 → 담임 문의 |
| Tabs | 식단·QR·개인정보·확인 | 탭별 역할 강조, 신청 공고 시 추가 탭 주석 |
| Menu | 날짜별 조식·중식·석식 | 날짜 이동, 메뉴와 알레르기 번호 |
| Apply | 공고·기간·본인 확인, 식사 선택 | 신청 탭→공고→신청함. 요일/날짜/면제는 공고별 차이 안내 |
| Sign | 급식비 확인·직접 서명·제출 | 총액→서명→신청하기→신청완료 |
| Manage | 신청내역·수정·취소 | 신청 기간 안에서만 수정/취소, 다시 서명하여 수정 |
| Qr | 자동 갱신·로컬 고정 QR·공유 금지 | 갱신 상태→고정 상태, 보안 경고 |
| Print | 담임에게 QR 인쇄 요청 | 휴대폰→인쇄 카드, 분실 시 신고 |
| FaceOption | 휴대전화·인쇄 QR 휴대가 어렵다면 얼굴 인식 베타를 선택 가능 | 휴대전화·인쇄 QR→얼굴, BETA·선택 동의·개인정보 탭 연결 |
| Enroll | 선택 동의 후 얼굴 등록·삭제 | 개인정보→동의→카메라→등록 완료 |
| Kiosk | 우하단 얼굴 전환·베타·본인 확인 | QR 대기→얼굴→학번/이름 확인→확인 또는 취소 |
| History | 월별 식사 기록·도용/누락 확인 | 월 이동과 예시 기록 강조, 담임 문의 |
| Closing | 핵심 행동 정리 후 물음표 도움말에서 다시 보기 | 네 가지 수칙→큰 ? 아이콘→학생 안내 페이지, 마지막 인사 |

앱 근거: `src/app/student/page.tsx`, `src/app/page.tsx`, `src/auth.ts`, `src/components/QRGenerator.tsx`, `src/components/FaceEnroll.tsx`, `src/components/MonthlyCalendar.tsx`, `src/app/check/page.tsx`, `src/app/facecheck/page.tsx`. 고정 QR은 학생의 수동 토글이 아니라 학교의 로컬 운영 모드에서 발급된다. 학생의 첫 탭(식단)과 급식실 키오스크의 기본 화면(QR)을 구별한다. 신청 탭은 공고가 있을 때만 표시된다.

로그아웃은 Google 자체 로그아웃이 아니다. 초기화 링크도 Google 계정 선택을 보장하지 않는다. 자동 선택이 계속되면 새 시크릿 창에서 별도 로그인하도록 안내한다. [Chrome 공식 안내](https://support.google.com/chrome/answer/95464?hl=ko).

설치 안내는 주소 장면 직후, 로그인 장면 직전에 배치한다. 2026-09-19 확인한 [Chrome Android 웹 앱 설치 안내](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=ko)와 [Apple iPhone 홈 화면 추가 안내](https://support.apple.com/ko-kr/guide/iphone/iphea86e5236/ios)를 따른다. Chrome 메뉴 이름은 버전에 따라 다를 수 있어 ‘앱 설치’·‘홈 화면에 추가’도 안내한다. Safari의 공유 버튼 위치도 화면 구성에 따라 달라 ‘더 보기→공유’ 경로를 함께 설명하고, ‘웹 앱으로 열기’는 보이는 경우 켜도록 안내한다.

현재 앱의 `src/app/manifest.ts`에는 standalone·아이콘·시작 주소가 있고, `src/app/layout.tsx`에는 Apple 웹 앱 설정이 있다. 설치 목업의 아이콘은 `public/icon-512.png` 원본을 재사용한다. 이번 절차는 브라우저에서 웹 앱을 설치하는 PWA 동선이다. 사용자가 표현한 TWA의 Android 앱 패키지 배포는 별도 기술이며 이번 영상 제작 범위가 아니다([Chrome TWA 문서](https://developer.chrome.com/docs/android/trusted-web-activity)). 공개 서비스의 `https://meal.posan.kr/manifest.webmanifest`도 읽어 이름·short_name·standalone·시작 주소가 같은지 확인했다(`out/live-manifest-v3.json`). 실제 Android/iPhone 기기 설치 성공 여부는 별도로 확인하지 않았다.

문장 끝은 원음의 말끝·잔향 보존 → 약 1초 여유 → 0.35초 음량 페이드아웃. 최종 영상은 실제 MP3 길이로 장면·자막을 계산한다. 코드 목업을 같은 장면 스틸로도 추출한다. 초기 산출물은 영상과 검토용 스틸이며, 후속 요청으로 같은 스틸과 유튜브 영상을 사용하는 `/help/student`를 구현했다.

후속 요청으로 도입 타이틀·얼굴 기능 연결·도움말 아웃트로를 추가했다. 도움말 아웃트로의 `?` 진입 방식은 후속 작업에서 로그인 화면과 학생 헤더의 `/help/student` 새 탭 링크로 구현했다.

## 실측 타이밍과 검수

v4 실측 구성은 11,694프레임, 389.800초(약 6분 30초)다. 주소 11.2초 → Android 설치 22.6초 → iPhone 설치 66.9초 → 로그인 109.6초 순서다. 신청 공고 170.9초, 얼굴 인식 베타 소개 263.8초, 도움말을 포함한 마무리 361.6초부터다. 정확한 SRT와 챕터는 `demo-video/scripts/student-deliverables.mjs`로 생성한다.

Qwen3 단일 비패딩 디코더가 유효 코드 `0`을 패딩으로 세어 원음 끝을 잘라내던 오류를 보정하고 전체 59문장을 재생성했다. 생성기 소스 해시로 이전 음성 캐시를 무효화했다. 원음 마지막 20ms RMS -60dB 기준과 전사 검수를 통과했으며 `CHECK 0 / NOCHECK 0`이다. 전사의 마지막 어절도 별도 확인했다. 문장 뒤 여유·페이드는 1.350~1.351초다. 자동 검사는 정확한 발음과 자연스러움을 보장하지 않으며 직접 청취는 미실시다.

최종 MP4의 59문장을 가공 음성과 정렬해 비교했다. 전체 파형 상관도 최저 0.99841, 마지막 200ms 상관도 최저 0.99523으로 말끝 보존 검사를 통과했다. 전체 발화의 일정한 음량 차이는 종료 시점 측정에만 반영하고, 꼬리의 원래 음량·파형 비교 조건은 유지했다. 상세는 `out/audio-diagnosis/verified-v4-rendered-audio.json`에 있다.

v4 회귀 검사 30개(Node 18·Python 12)와 Remotion 타입·ESLint 검사를 통과했다. 앱 UI와 영상 목업은 변경하지 않았다. 설치 장면의 UI reviewer 검토·겹침·z-index 수정은 이전 v3에서 수행한 기록이다. 루트 앱 검사·실제 Android/iPhone 설치 검증을 이번 음성 수정에서 수행한 것으로 간주하지 않는다.

최종 산출물: `demo-video/out/PosanMeal-student-guide.mp4`(H.264 1080p30 + AAC 48kHz, 35,586,560바이트, 컨테이너 389.824초). 18챕터와 faststart 적용. FFmpeg 전체 11,694프레임 디코딩 성공, 음성 최대 -3.2dB. 최종 영상의 18장면을 시각 검수했다. WebP 19장 합계 504,380바이트·최대 35,914바이트, SRT 59구간의 순서·범위·비중첩을 확인했다. 인트로 12프레임의 원본 PNG도 제공한다. 이전 완성본은 `out/archive/v1/`~`v3/`에 보존한다. 검증 수치는 `out/validation-v4.json`에 있다.

## 안내 페이지

사용자가 전달한 `https://youtu.be/rOww_TPHGR0`를 `/help/student`에 등록했다. 영상의 시작 시각을 재사용하는 4개 목차·9단계와 기존 목업 이미지 16장을 연결하고, 표지 1장을 포함한 WebP 합계는 459,294바이트다. 공개 접근·반응형·페이지 내 영상 재생과 구간 이동·목업 원본 새 탭 열기를 로컬에서 확인했다. 운영 배포는 미실시다.
