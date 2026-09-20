---
name: guide-page
description: PosanMeal의 학생·교사·관리자·키오스크 사용 안내를 Remotion 영상과 같은 목업 장면에서 추출한 이미지로 가이드 페이지로 만들거나 갱신한다. Chois 복제 음성 내레이션을 함께 제작할 때도 사용한다.
---

# PosanMeal 안내 영상·가이드 페이지

호출 예: `$guide-page 학생 급식 신청 안내 영상과 가이드 페이지를 만들어줘`.

1. 프로젝트 루트의 [제작 기준](../../../.codex/GUIDE_PAGES.md)을 읽고, 현재 앱에서 대상 화면·권한·문구·날짜/식사 판정을 확인한다. 기준 문서의 현황 표로 기존 장면과 페이지를 찾아 재사용한다.
2. `demo-video/`가 없으면 이 스킬의 [제작 템플릿](assets/demo-video/README.md)을 읽고 `assets/demo-video/`를 프로젝트 루트 `demo-video/`로 복사한다. 이미 있으면 덮어쓰지 않고 필요한 파일만 비교·통합한다. 루트 TypeScript·ESLint·Tailwind 스캔에서 제작 프로젝트를 분리한다. 설치 후 `cd demo-video && npm run doctor`로 도구·음성 모델·프로필을 확인한다.
3. 대상 화면에 장면이 없으면 장면별 원고와 화면 상태를 먼저 정한다. 현재 요청에서 확정된 범위로 진행하고, 실제로 필요한 미정 사항만 질문한다. 학생·교사 개인정보 대신 가상 데이터를 쓴다.
4. [mlx-voice-clone](../mlx-voice-clone/SKILL.md) 절차로 `narration.ts` → Chois 음성 → 실측 길이 JSON → 전사 검수·청취 확인을 진행한다. **문장 끝음절·잔향을 자르지 않고, 발화 종료 후 약 1초의 여유(무음)를 둔 뒤 0.35초 동안 음량이 부드럽게 사라지는 페이드아웃**을 기본으로 한다. 패딩 전 원본 WAV의 끝도 확인하며, 전사 일치와 길이 검사만으로 말끝 보존을 판정하지 않는다. 무음만 붙여 이미 잘린 발음을 감추지 않는다. 장면 작업을 병행하려면 `--estimate`를 쓰되 최종 영상은 무음·페이드까지 포함한 실측 길이로 교체한다. 청취 결과를 확인하지 않았으면 그 상태를 명시한다.
5. [remotion-best-practices](../remotion-best-practices/SKILL.md)로 필요한 API 참조를, [remotion-motion-graphics](../remotion-motion-graphics/SKILL.md)로 모션 기준을 읽는다. `createTiming`·`GuideScene`·`lineAt`을 재사용해 실제 화면과 같은 목업을 만든다. **UI 목업에는 그레인·비네트·색 보정·Ken Burns를 적용하지 않는다.**
6. 같은 장면으로 요청된 안내 영상을 렌더하고 `src/stills/<page>.ts`의 프레임을 WebP로 추출한다. 결과 프레임·스틸을 직접 보고 문구·잘림·커서·자막·음성 타이밍을 보정한다.
7. 기존 가이드 컴포넌트를 먼저 찾고, 없으면 제작 기준의 최소 구조로 `/help/<page>`를 작성한다. `src/proxy.ts`의 공개 경계와 화면별 도움말 진입점을 함께 확인한다. 페이지·영상 중 하나만 요청되면 해당 산출물 범위에 맞춘다.
8. 변경 범위에 맞는 검사와 반응형 브라우저 확인을 수행하고 `responsive-ui-reviewer`, `project-map-updater`, `project-memory-keeper`로 검토·기록한다. 진행 현황에 실제 생성·검증 상태를 적는다. 커밋·외부 업로드·게시 여부는 현재 사용자 요청 범위에 따른다.

원본: `selfstudy/.claude/skills/guide-page` 및 `selfstudy/demo-video`(2026-09-19 복사). 공통 파이프라인의 최초 출처는 `school_cowork/demo-video`다. PosanMeal 적용 차이와 버전은 제작 기준에 기록한다.
