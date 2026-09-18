# Codex / GPT-6-Astra로 이어서 작업하기

프로젝트 폴더에서 시작한다. 현재 설치된 Codex CLI 0.141.0과 모델 캐시의 ID `gpt-6-astra`를 기준으로 구성했다.

```sh
cd /Volumes/Chois_SD2/dev/PosanMeal
codex -m gpt-6-astra
```

기본 모델은 `.codex/config.toml`에 지정되어 있어 새 세션은 `codex`로도 시작할 수 있다. Codex 앱에서는 이 폴더를 열고 새 대화의 모델 선택이 GPT-6-Astra인지 확인한다. 실행 옵션/앱의 명시적 모델 선택이 기본값보다 우선할 수 있으며, 파일 수정만으로 이미 진행 중인 대화 모델이 전환되지는 않는다.

| 목적 | 명령/요청 |
|---|---|
| 새 작업 | `codex -m gpt-6-astra "프로젝트 맵과 인계 메모리를 읽고 기존 작업을 이어가 줘"` |
| 이전 Codex 대화 선택 | `codex resume` |
| 이 폴더의 마지막 Codex 대화 재개 | `codex resume --last` |
| 읽기 전용 Git 변경 검토 | `codex review --uncommitted` |
| 앱 열기 | `codex app .` |
| CLI 옵션 확인 | `codex --help` |

`resume`은 Codex 대화에 적용되며 Claude 대화 ID를 이어받지 않는다. 기존 Claude 맥락은 아래 이관 문서에서 읽는다. 새 컴퓨터에서 프로젝트 설정이 적용되지 않으면 Codex의 프로젝트 신뢰 상태를 확인한다. 현재 이 컴퓨터는 이미 trusted로 등록되어 있으며 전역 설정을 변경하지 않았다.

## 무엇을 옮겼는가

| 기존 위치/기능 | Codex 위치/처리 |
|---|---|
| CLAUDE.md 및 전역 공통 지침 | 루트 AGENTS.md: 현재 구현에 맞게 요약·정정 |
| 최신 .claude/PROJECT_MAP.md | .codex/PROJECT_MAP.md: 별도 관리 사본 |
| ~/.claude/rules | .codex/rules: UI/코딩 규칙 복사, 탐색/Prisma/Railway는 프로젝트에 맞게 변환 |
| Claude 전용 agent/전역 역할 | .codex/agents/*.toml 및 config.toml의 agents 등록(5종) |
| 이전 Windows/Drive 프로젝트 메모리 10개 | .codex/memory/legacy/windows, legacy/mac: 출처가 있는 과거 사본 |
| 현재 진행 상태 | .codex/memory/MEMORY.md 및 current-state.md |
| specs/plans | 기존 docs/superpowers/ 그대로 참조 |
| Claude SessionStart/PostToolUse | 자동 이식하지 않음. AGENTS.md의 세션 시작/종료 체크와 역할 호출로 대체 |

Claude 원본과 루트의 옛 PROJECT_MAP.md는 그대로 보존했다. 전역 에이전트에 남아 있던 다른 프로젝트(MathChois)/Windows 절대경로를 새 역할에 포함하지 않았다. 로그인 정보, API 키, MCP 인증, 대화 로그, 캐시와 권한 우회 설정은 복사하지 않았다. 사용 가능한 MCP/플러그인은 현재 Codex 환경을 이용하며 Claude 전용 명령은 자동 호환되지 않는다.

## 검증 및 유지

- `codex --strict-config debug prompt-input`은 모델 호출 없이 실제 로드되는 지침을 점검하는 로컬 진단이다. 출력에는 개인 전역 지침도 포함되므로 저장소에 저장하지 않는다.
- `.codex/memory/legacy/`는 과거 자료다. 현재 실행 경로·배포 연결·검증 상태는 current-state와 실제 파일을 먼저 확인한다.
- 이관 이후 구조 변경은 project-map-updater, 중요한 인계는 project-memory-keeper가 프로젝트 내부 문서를 갱신한다. 역할 사용 불가 시 동일 체크리스트를 메인 에이전트가 수행한다.

근거: [OpenAI Codex 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference)와 로컬 `codex --help` / `codex debug prompt-input --help`. 모델 ID는 로컬 모델 캐시에서 확인했다.
