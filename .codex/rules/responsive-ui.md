# 반응형 UI 규칙 (모든 프로젝트 공통)

웹앱은 데스크탑·태블릿·모바일 모두에서 동작해야 한다. 아래 규칙은 프로젝트 특화 규칙이 명시적으로 덮어쓰지 않는 한 모든 UI 작업에 적용된다.

---

## 1. 화면 활용 (Padding / Margin 최소화)

- 모바일/태블릿은 **viewport 전체**를 사용. 고정 `max-width` 로 가운데 정렬만 하는 레이아웃은 모바일에서 금지.
- 바깥 여백은 최소화:
  - 모바일: `p-1` ~ `p-2` (4–8px)
  - 태블릿: `sm:p-2 md:p-3` (8–12px)
  - 데스크탑: `lg:p-4` 이상 허용
- 내부 요소 간 간격은 `gap-*` 로 관리. margin 으로 간격 주는 것 지양.
- 고정 헤더/탭바가 있으면 본문은 `flex-1` 로 남은 공간 전부 사용.

## 2. 텍스트 줄바꿈 금지 (No Word Wrap)

단어 한 개가 두 줄로 쪼개져 보이는 상황은 **금지**. 다음 중 하나로 대응:

- 일반 텍스트: `whitespace-nowrap`.
- 한 줄에 담아야 하지만 길 수 있는 제목: `whitespace-nowrap overflow-hidden text-ellipsis`. 원문은 `title` 속성 또는 Tooltip.
- 버튼/배지/칩/탭의 라벨: **절대** 줄바꿈 금지. `whitespace-nowrap` 필수.
- 컨테이너 폭이 부족하면 → **컨테이너가 가로 스크롤** 되게. 텍스트를 깨지 말고 영역을 스크롤.
- `break-words`, `word-break: break-all`, `overflow-wrap: anywhere` 등 **단어 중간을 끊는 속성 사용 금지** (URL 등 예외적으로 필요한 경우만).

## 3. 표(Table) 규칙

모든 데이터 표는 아래를 만족해야 한다:

### 3.1 셀 내부
- 모든 셀 `whitespace-nowrap`.
- 셀이 길어지면 **표 자체가 가로 스크롤** 되도록 래퍼에 `overflow-x-auto`.
- 줄바꿈 절대 금지.

### 3.2 Sticky Header (세로 고정)
```css
thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--header-bg); /* 반드시 지정 */
}
```

### 3.3 Sticky First Column / Index (가로 고정)
지정된 인덱스 열(보통 첫 번째, 프로젝트별로 다를 수 있음)은 가로 스크롤 시 좌측 고정:
```css
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--cell-bg); /* 반드시 지정 */
}
/* header 와 교차하는 좌상단 셀 */
thead th.sticky-col { z-index: 4; }
```

### 3.4 z-index 서열
1. 일반 셀: 기본
2. sticky header: 2
3. sticky 인덱스 열: 3
4. sticky 좌상단(교차) 셀: 4

### 3.5 배경색 필수
sticky 속성이 적용되는 모든 셀은 **불투명 배경색**을 명시. 없으면 스크롤 시 아래 셀이 비쳐 보여 가독성 파괴.

## 4. 뷰포트 높이 계산

- 모바일에서 `100vh` **사용 금지** → `100dvh` 사용 (주소창 변화 시 버튼 잘림 방지).
- 헤더/하단바가 있는 레이아웃: `calc(100dvh - var(--header-h) - var(--tabbar-h))`.
- 콘텐츠 영역은 **내부 스크롤**을 기본으로. `document` 전체가 스크롤되는 구조는 모바일에서 지양.
- 가상 키보드 대응이 필요한 입력 화면은 `svh`(small viewport height) 고려.

## 5. 브레이크포인트

- 모바일: `< 640px` (Tailwind 기본)
- 태블릿: `640px – 1024px` (`sm:` ~ `md:`)
- 데스크탑: `> 1024px` (`lg:` 이상)

**Mobile-first** 설계. 기본 스타일은 모바일, 더 큰 화면은 `sm: md: lg:` 로 확장.

## 6. 터치 타겟

- 버튼/탭 최소 크기 **44×44px** (`min-h-11 min-w-11`).
- 인접 터치 타겟 간 간격 최소 8px.
- hover 전용 UI 금지 (모바일은 hover 없음). 탭/클릭 기반 동작 제공.

## 7. 리뷰 체크리스트 (`responsive-ui-reviewer` 에이전트가 순회)

UI 파일(`.tsx`, `.jsx`, `.css`, `.scss`, `styles/*`, `app/**/page.tsx`, `components/**`) 변경 시 아래를 모두 점검:

1. [ ] 텍스트/버튼 라벨에 줄바꿈이 일어날 가능성이 있는가? → `whitespace-nowrap` 적용.
2. [ ] 표가 있다면 헤더·인덱스가 sticky 인가? 배경색이 지정되어 있는가?
3. [ ] 표 래퍼에 `overflow-x-auto` 가 있는가? 셀 `whitespace-nowrap` 인가?
4. [ ] 모바일에서 바깥 padding 이 `p-4` 이상인 루트 컨테이너가 있는가? → 줄이기.
5. [ ] `100vh` 사용처가 있는가? → `100dvh` 로 교체.
6. [ ] 고정 `max-w-*` 컨테이너가 모바일에서 좌우 여백을 낭비하는가?
7. [ ] `break-words`, `break-all`, `overflow-wrap: anywhere` 가 불필요하게 쓰였는가?
8. [ ] 터치 타겟이 44px 미만인가?
9. [ ] hover 로만 노출되는 기능이 있는가?
10. [ ] 가로 스크롤 가능한 컨테이너의 `overflow` 설정이 올바른가? (자식이 `overflow-visible` 로 덮어쓰지 않는지)

보고 형식:
```
위반: <파일>:<줄번호>
규칙: <규칙 섹션 번호>
현재: <문제 코드 스니펫>
제안: <수정안 스니펫>
```
