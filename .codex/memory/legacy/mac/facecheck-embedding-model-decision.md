> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/-Users-chois-Library-CloudStorage-GoogleDrive-complete860127-gmail-com--------projects-posanmeal/memory/facecheck-embedding-model-decision.md`

---
name: facecheck-embedding-model-decision
description: "안면인식 임베딩을 FaceRes(1024)에서 insightface-mobilenet-emore(256)로 바꾼 이유와 측정 수치, 로컬에서 Human 모델을 정량 비교하는 프로브 방법"
metadata: 
  node_type: memory
  type: project
  originSessionId: 329a57bb-716f-4ad1-acf6-beb6c3196d19
  modified: 2026-09-04T22:56:40.995Z
---

2026-09-05 안면인식 오인식(아무 남자→남교사, 아무 여자→여교사) 조사 결과:

- 원인: `@vladmandic/human`의 기본 식별 모델 FaceRes 디스크립터(1024차원)는 `global_pooling/Mean`(ReLU6 출력 평균)이라 전부 음수가 없고, 같은 벡터가 나이·성별 헤드로 직행한다. 원시 코사인은 선명한 얼굴 기준 **타인 간 0.45~0.68, 같은 사람(다른 사진) 0.17~0.69**로 분리가 없어 threshold 0.55가 무의미했다. Human 자체 `match.similarity`(유클리드 정규화)도 norm(선명도)에 좌우돼 불안정.
- 대안 측정(같은 34개 얼굴, Human 샘플 스크린샷): faceres-deep 타인 최대 0.70, mobilefacenet은 모든 얼굴 cos≈1.0(사용 불가), insightface-mobilenet-swish(512) 타인 최대 0.61, **insightface-mobilenet-emore(256) 타인 ≤0.26(중앙값 0.03)** → emore 채택. 모델 파일은 https://github.com/vladmandic/insightface `models/`(MIT, human-models npm에는 없음). Human 설정은 `face.description.enabled=false` + `face.insightface={enabled:true, modelPath}` (Config 타입에 없어 `as Partial<Config["face"]>` 캐스트), `human.models.loaded()`에 `insightface`로 나타난다.
- 기본 threshold 0.45/margin 0.05로 시작하되 실제 키오스크 값은 `/facecheck` 상태바 `유사도 1위/2위`로 확인해 `PUT /api/system/settings {faceMatchThreshold}`로 조정. 운영 DB에 `face_match_threshold` 행이 있으면 그 값이 기본값보다 우선한다(2026-09-05 시점 양쪽 서비스 모두 0.55/0.05 = 기본값).
- 프로브 방법: 스크래치에 `human.esm.js` + `public/models` + 샘플 이미지(`node_modules/@vladmandic/human/assets/*.jpg`)를 정적 서버(node http)로 띄우고 Playwright MCP로 열어 `human.detect(img)`→`face.embedding` 쌍별 코사인 집계. 운영 DB 직접 조회(railway variable → pg)는 auto 모드 분류기가 차단하므로 시도하지 말 것.

**Why:** 모델 선택 근거가 코드에 남지 않으며, 다음에 임계값을 다시 손볼 때 같은 측정을 반복하지 않기 위해.
**How to apply:** 임계값 논의 시 위 수치를 기준으로 삼고, 모델을 다시 바꾸면 `FACE_MODEL_VERSION` 상승 + 재등록 흐름(서버 캐시·sync가 구 버전 제외, FaceEnroll 안내)이 이미 있음을 전제로 한다. 관련: [[railway-facecheck-test-service]], [[posanmeal-local-env-quirks]]

**배포 상태(2026-09-06):** main = cf22ed6 (관리자 `/admin` 설정 탭에 "안면인식 임계값" 카드 추가, `face-match-validation.ts`; 이전 2318ba3 (운영 dinner 배포 SUCCESS, 테스트 dinner-facecheck는 b7d2348에서 멈춤 — 사용자가 "테스트 배포 없이 main에서" 요청). 누적 변경: ① 모델 insightface-emore(b7d2348) ② 기본 threshold 0.45→0.55(a31b77f): 현장에서 사용자 아들이 0.48로 사용자(최재혁 교사)에 매칭됨 — 가족 유사도가 0.45를 넘음 ③ 미등록 얼굴 거부 표시(2318ba3): `unmatched-tracker.ts`로 같은 얼굴 2회(3초, cos≥0.6) 확인 후 주황 카드 "등록된 사용자가 아닙니다"+오류음, 10초 억제; `errorCode: "UNMATCHED"`. 운영·테스트 DB 모두 face_match_threshold 행이 없어 코드 기본값이 그대로 적용됨(GET /api/system/settings로 확인). 키오스크는 페이지 로드 때 `fetchKioskSettings`로 서버 설정을 다시 받으므로 임계값 변경은 새로고침만으로 반영, 임베딩 변경은 [동기화] 필요.

**현장 미확인 사항:** 교사 본인의 유사도 수치(0.55 위 여유), 화장·안경 등 외형 변화 시 본인 유사도 하락 폭. 본인 거부가 잦으면 0.5로, 타인 통과가 있으면 0.6으로 조정. 사용자 질문(옷 영향)에 대한 답: 임베딩 입력은 검출 박스의 112×112 얼굴 크롭이라 옷·배경은 영향 없음; 화장·안경·머리·조명은 본인 유사도를 낮추는 쪽(오거부)으로 작용. 참고한 상용 사례: Apple Face ID(3D depth+IR, 1/1,000,000 FMR이지만 쌍둥이·형제·13세 미만은 높다고 명시, 성공 인증·비밀번호 입력 후 템플릿 자동 갱신), 토스 페이스페이(RGB+IR+depth 라이브니스, 비슷한 얼굴 등록 시 2차 인증 유도).

**사용자 결정(2026-09-06):** 임계값 0.55, 2D 웹캠 구조 그대로 운영. 임계값 근처 QR 2차 확인·3D/IR 하드웨어·상용 단말기는 도입하지 않기로 함(석식 집계 위험 수준에 비해 과함). 다음에 임계값을 논할 때 이 결정을 전제로 하고, 2차 확인을 다시 제안하지 말 것.
