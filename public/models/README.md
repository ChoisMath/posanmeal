# 안면인식 모델 파일 출처

브라우저에서 `@vladmandic/human` 3.3.6이 `modelBasePath: /models/`로 로드한다 (`src/lib/human-client.ts`).

| 파일 | 용도 | 출처 |
|------|------|------|
| `blazeface.*` | 얼굴 검출 | `@vladmandic/human-models` 3.0.4 (`node_modules/@vladmandic/human-models/models/`) |
| `facemesh.*` | 메시·정렬 | 위와 동일 |
| `antispoof.*` / `liveness.*` | 안티스푸핑·라이브니스 | 위와 동일 |
| `insightface-mobilenet-emore.*` | 식별 임베딩 (256차원, 코사인 매칭) | https://github.com/vladmandic/insightface (MIT) `models/insightface-mobilenet-emore.*` — bin sha256 앞 16자리 `46131c5924a7ee95` |
| `faceres.*` | (미사용) 이전 식별 임베딩 | `@vladmandic/human-models` 3.0.4 |

- `faceres`(1024차원)는 나이·성별 헤드와 특징을 공유해 타인 간 코사인 유사도가 0.5~0.7까지 올라 식별용으로 부적합해 `insightface`로 교체했다(2026-09-05). 파일은 캐시 호환을 위해 남겨 두었으며 로드되지 않는다.
- 모델 파일을 교체할 때는 파일명(또는 경로)을 바꿔야 한다 — Human이 IndexedDB에 파일명 키로 캐시한다.
