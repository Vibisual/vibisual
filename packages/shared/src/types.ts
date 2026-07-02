/** UI 표시 언어 — 서버 ProjectCheckpoint에 저장, 클라이언트는 서버 SSOT를 따름 */
export type UiLocale =
  | 'ko'
  | 'en'
  | 'ja'
  | 'zh-CN'
  | 'es'
  | 'es-419'
  | 'fr'
  | 'de'
  | 'hi'
  | 'id'
  | 'it'
  | 'pt-BR';

/** Claude Code Hook 이벤트 타입 */
export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  /** §4 v1.50 — Anthropic SDK 2026-05 신규. 컨텍스트 컴팩션 직전 발화. */
  | 'PreCompact';

/** Claude Code가 훅으로 보내는 원시 페이로드 (stdin / HTTP POST body) */
export interface HookEventPayload {
  session_id: string;
  hook_event_name: string;
  /** 도구 사용 이벤트(PreToolUse/PostToolUse)에만 존재 */
  tool_name?: string;
  /** 도구 사용 이벤트(PreToolUse/PostToolUse)에만 존재 */
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
  cwd?: string;
  /** Notification 이벤트의 메시지 */
  message?: string;
  /**
   * Notification 이벤트 서브타입 (Anthropic Agent SDK 2026-04~05 신규).
   * permission_prompt | idle_prompt | auth_success | elicitation_dialog 등.
   * 구버전 SDK 페이로드에는 없을 수 있어 optional. 누락 시 `message` heuristic 폴백.
   */
  type?: string;
  /**
   * §4 v1.50 — PostToolUse/PostToolUseFailure 의 도구 실행 시간(ms).
   * Anthropic SDK 2026-04 신규 필드. 구버전 SDK 에는 없어 optional.
   */
  duration_ms?: number;
  /** Stop 이벤트의 중단 사유 */
  stop_reason?: string;
  /** UserPromptSubmit 이벤트의 프롬프트 본문 */
  prompt?: string;
  /**
   * §4 v2.64 — CMD(인터랙티브 터미널) 에이전트 소유자 태그.
   * Vibisual 이 띄운 CMD 터미널의 claude 는 env `VIBISUAL_OWNER_AGENT_ID`(=그 CMD 버블의 agentId)
   * 를 물려받고, handler.mjs 가 /api/hook-event 본문에 이 필드로 실어 보낸다. 서버는 이 agentId 의
   * CMD 버블 세션으로 이벤트를 직접 귀속해 별개 Hook 버블(touchAgent orphan)을 만들지 않는다.
   * **명시 토큰**이라 §17 Hook≠Custom 경계의 cwd 휴리스틱 흡수와 달리 외부 세션 오흡수 위험이 없다.
   */
  _vibisualOwnerAgentId?: string;
  /**
   * §4 v2.64 — CMD 터미널 소유자 termId(`term:<agentId>:<session>`). PTY env `VIBISUAL_OWNER_TERM_ID`
   * 로 셸→claude→handler 상속. 서버가 이 termId 별로 claude 대화 sessionId 를 기록해 두면,
   * 앱 재시작 후 같은 termId 의 터미널을 다시 열 때 `claude --resume <id>` 로 직전 대화를 이어받는다.
   */
  _vibisualOwnerTermId?: string;
}

/**
 * §4 v1.50 — 도구 실행 시간 ring buffer 엔트리.
 * agent 별 최근 5건만 보관(서버 ring buffer). 영속화 ❌.
 */
export interface ToolDurationEntry {
  ts: number;
  tool: string;
  durationMs: number;
}

/**
 * §4 v1.98 — 진단 에러 로그 1건. DebugPanel(§7.7) 에러 뷰어가 표시.
 * renderer JS 에러 / main 프로세스 에러 / server 코어 에러를 `source` 로 구분.
 * 서버 `diagnosticService` 가 ring buffer(`DIAGNOSTIC_LOG_MAX`)로 수집 — 영속화 ❌.
 */
export interface DiagnosticEntry {
  /** 고유 id (서버 채번). 클라 리스트 key. */
  id: string;
  /** 발생 시각(epoch ms). */
  ts: number;
  /** 어느 프로세스에서 났나. */
  source: 'renderer' | 'main' | 'server';
  level: 'error' | 'warn';
  /** 한 줄 요약 메시지. */
  message: string;
  /** 스택 트레이스(있으면). */
  stack?: string;
}

/**
 * §4 v1.50 — PreCompact 누적 카운트.
 * agent 별로 컨텍스트 컴팩션이 몇 번 일어났는지 + 마지막 시각.
 * `ProjectCheckpoint.compactCounts?` 로 영속화.
 */
export interface CompactCount {
  count: number;
  lastAt: number;
}

/**
 * §4 v1.50 — Claude.ai 한도 사용률 (외부 statusline 스크립트가 푸시).
 * 한도는 사용자 단위라 GraphSnapshot 1건 글로벌. 영속화 ❌(런타임 캐시).
 */
export interface RateLimitInfo {
  used5h?: number;
  resetAt5h?: number;
  used7d?: number;
  resetAt7d?: number;
  updatedAt: number;
}

/**
 * 노드 상태:
 *   idle(대기) → active(작업중) → completed(에이전트만) → disappearing(소멸 중)
 *
 * §4 v1.49 — Anthropic Agent SDK Notification 이벤트 시각 신호:
 *   awaiting_permission — Claude Code 가 도구 호출 권한을 사용자에게 묻는 중
 *                         (v1.43 PreToolUse 동기 차단과는 별개 축, 본 상태는 *시각 신호*만)
 *
 * v1.73 — `awaiting_input`(모래시계) 제거. 데몬 단일-세션 연속성 경로에서 서버 재시작 시
 * 모래시계가 떠 연속성이 끊겨 보이던 원인. 입력 대기는 더 이상 별도 시각 상태로 두지 않는다
 * (세션은 `--resume` 으로 항상 이어지므로 "대기" 신호 자체가 불필요).
 */
export type NodeStatus =
  | 'idle'
  | 'active'
  | 'completed'
  | 'disappearing'
  | 'awaiting_permission';

/** 버블 타입 — 시각 카테고리 */
export type BubbleType = 'agent' | 'internal_folder' | 'external_folder' | 'file' | 'bash' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'worktree' | 'conti' | 'auto';

// ─── Git Status (§7.6 GitStatusCard) ───

/** git 커밋 한 개의 요약 (최근 커밋 리스트용) */
export interface GitCommit {
  /** 커밋 SHA (7자리 short) */
  sha: string;
  /** 커밋 메시지 첫 줄 */
  subject: string;
  /** 작성자 이름 */
  author: string;
  /** 작성 시각 (epoch ms) */
  timestamp: number;
  /** Co-Authored-By에 Claude 포함 여부 — Claude가 만든 커밋 배지용 */
  coAuthoredByClaude: boolean;
}

/** 단일 worktree의 git 상태 요약 (GitStatusCard Case D 리스트용) */
export interface GitWorktreeStatus {
  /** worktree 버블 nodeId — 클릭 시 focusOnNode 대상 */
  nodeId: string;
  /** worktree 프로젝트 이름 (basename) */
  name: string;
  /** worktree가 체크아웃한 브랜치 */
  branch: string;
  /** base(upstream) 대비 ahead 커밋 수 */
  ahead: number;
  /** base 대비 behind 커밋 수 */
  behind: number;
  /** uncommitted 변경(staged+modified+untracked) 존재 여부 */
  dirty: boolean;
  /** 마지막 커밋 시각 (epoch ms, 없으면 undefined) */
  lastActivityAt?: number;
}

/** 프로젝트의 git 상태 — root 버블 DetailPanel 표시용. 4가지 케이스 유니온. */
export type GitStatus =
  | { case: 'no-git'; fetchedAt: number }
  | { case: 'not-repo'; fetchedAt: number }
  | {
      case: 'repo';
      fetchedAt: number;
      /** 현재 브랜치 이름 (detached HEAD면 짧은 SHA) */
      branch: string;
      /** upstream 대비 ahead 커밋 수 (upstream 없으면 0) */
      ahead: number;
      /** upstream 대비 behind 커밋 수 */
      behind: number;
      /** staged 파일 수 */
      staged: number;
      /** modified(unstaged) 파일 수 */
      modified: number;
      /** untracked 파일 수 */
      untracked: number;
      /** 최근 커밋 N개 (최신순, 최대 3) */
      commits: GitCommit[];
      /** 부모 프로젝트의 worktree들. 길이 ≥ 1이면 Case D로 UI 승격. */
      worktrees: GitWorktreeStatus[];
    };

/** 파이프라인 에이전트 타입 — 실행 전략 */
export type PipelineType = 'pipeline-subagent' | 'pipeline-teams' | 'pipeline-hybrid';

/** 파이프라인 자식 에이전트 역할 */
export type AgentRole = 'explore' | 'architect' | 'implementer' | 'verifier';

// ─── Task Edge (버블 간 작업 지시) ───

/** Task Edge 상태 — 작업 진행 라이프사이클 */
export type TaskEdgeStatus = 'idle' | 'executing' | 'completed' | 'error';

/** Task Edge 자동 전파 모드 (UI에서는 "Gate"로 노출 — 동일 데이터) */
export type TaskEdgeForwardMode = 'manual' | 'auto';

/** Task Edge 의미(종류) — 엣지가 무엇을 주고받는지. v1.18.
 * - command: 지시/명령 (기본)
 * - artifact: 결과물(파일/diff) 전달
 * - request: 역요청/도움 요청 (소스가 타겟에게 막힌 부분 요청)
 * - critique: 리뷰/비평 (감사·레드팀)
 */
export type TaskEdgeKind = 'command' | 'artifact' | 'request' | 'critique';

/** Task Edge 메시지 형식 — 자유 작문 vs 정해진 양식 (schema는 structured payload 기대) */
export type TaskEdgeMessageFormat = 'free' | 'schema';

/** Task Edge 반환 형식 — 결과를 어떤 형태로 받을지 */
export type TaskEdgeReturnFormat = 'artifact' | 'summary' | 'both';

/** Task Edge 우선순위 — 동시 실행 시 순서 */
export type TaskEdgePriority = 'low' | 'normal' | 'high';

/** Critique 엣지 타이밍 — 리뷰를 언제 수행할지. v1.41 (kind='critique' 일 때만 의미).
 * - intermediate: 타겟 작업 중간 milestone마다 끼어들어 리뷰. 기본값.
 * - final: 타겟 작업 완료 후 final review 만.
 */
export type TaskEdgeCritiqueTiming = 'intermediate' | 'final';

/** Critique 엣지 권한 — reject 발생 시 타겟에게 무엇을 강제할지. v1.41 (kind='critique' 일 때만 의미).
 * - force-rework: critique가 reject 하면 타겟은 재작업 의무. maxReworkCount 초과 시 코멘트 모드로 강등 + 부모 세션 에스컬레이션.
 * - comment-only: reject 해도 타겟은 참고만. 재작업 강제 없음.
 */
export type TaskEdgeCritiqueAuthority = 'force-rework' | 'comment-only';

/** Command 엣지 위임 형태 — 부모와 자식이 도구를 어떻게 나눠 가질지. v1.44 (kind='command' 일 때만 의미).
 * `delegationPolicy`(강제 정도: strict/auto)와 **직교**하는 축. 강제 정도는 그대로 두고 "어떤 형태로 강제하는가"만 표현.
 * - shared (기본): 부모와 자식이 같은 도구를 공유. 부모도 직접 호출 가능. 도구 박탈 ❌. (= v1.37 이전 거동)
 * - tool-delegation: 부모에서 자식의 도구를 박탈. v1.37 strip 로직 재사용 — 자식.tools ∩ 부모.tools 가 박탈 대상.
 * - mode-delegation: 자식이 같은 도구를 가지지만 모드(plan/acceptEdits/특정 model/skill)가 다른 케이스.
 *   박탈할 게 없으니 strip 비활성. 시스템 프롬프트로 위임 강제 + (후속) PreToolUse hook 게이트.
 *
 * 후방호환: `commandMode === undefined` 인 기존 엣지는 `delegationPolicy === 'strict'` 일 때
 * 'tool-delegation' 으로 해석(v1.37~v1.43 거동 보존), 그 외에는 'shared' 로 해석.
 */
export type TaskEdgeCommandMode = 'shared' | 'tool-delegation' | 'mode-delegation';

/** Task Edge — 에이전트 간 작업 흐름 연결 (언리얼 스테이트머신 트랜지션) */
export interface TaskEdge {
  /** 고유 ID (예: "tedge-a1b2c3") */
  id: string;
  /** 소스 에이전트 ID (결과 제공자) */
  sourceAgentId: string;
  /** 타겟 에이전트 ID (작업 수행자) */
  targetAgentId: string;
  /** 엣지 위 라벨 = 작업 지시 명령 */
  command: string;
  /** 현재 상태 */
  status: TaskEdgeStatus;
  /** 자동/수동 전파 모드 (UI: "Gate") */
  forwardMode: TaskEdgeForwardMode;
  /** 사용된 템플릿 ID (null이면 커스텀) */
  templateId: string | null;
  /** v1.85 — 이 엣지가 속한 탭 프로젝트 이름. 생성 시 소스 에이전트의 세션 cwd 로 확정.
   *  엔드포인트 에이전트 버블이 만료·소멸해도 `toProjectCheckpoint` 가 이 값으로 엣지를
   *  해당 프로젝트 체크포인트에 보존한다(§3.5/§5 line 226 수명 규칙).
   *  legacy(미설정) 엣지는 양끝 에이전트 생존 기준으로 폴백 필터. */
  projectId?: string;
  /** 엣지 의미 (v1.18, optional — 미설정 시 'command'로 간주) */
  kind?: TaskEdgeKind;
  /** 메시지 형식 (v1.18, optional — 기본 'free') */
  messageFormat?: TaskEdgeMessageFormat;
  /** v1.48 — 자유 형식 스키마 본문 (optional). `messageFormat='schema'` 인 엣지에서 source 가
   *  발신할 때 따라야 할 양식. 자유 텍스트(JSON 템플릿/자연어 명세 등). 빈 값 또는
   *  `messageFormat='free'` 면 형식 강제 없음. 엣지 삭제 시 같이 사라짐(엣지 본인에 영구 저장). */
  messageSchema?: string;
  /** 반환 형식 (v1.18, optional — 기본 'summary') */
  returnFormat?: TaskEdgeReturnFormat;
  /** 최대 실행 시간 ms (v1.18, optional — 미설정 시 무제한) */
  timeoutMs?: number;
  /** 실패 시 재시도 횟수 (v1.18, optional — 기본 0) */
  retryCount?: number;
  /** 같은 입력이면 이전 결과 재사용 (v1.18, optional — 기본 false) */
  cacheEnabled?: boolean;
  /** 실행 우선순위 (v1.18, optional — 기본 'normal') */
  priority?: TaskEdgePriority;
  /** 소스 에이전트의 마지막 결과 (컨텍스트 전달용) */
  lastSourceResult?: string;
  /** 실행 결과 요약 */
  lastResult?: string;
  /** 에러 메시지 (status='error'일 때) */
  errorMessage?: string;
  /** v1.32 / v1.54 — Bundle ID. 자매 엣지가 공유. 단독 엣지는 undefined.
   *  - v1.32: `kind='command' + returnFormat='both'` → command(primary) ↔ artifact(auto-artifact) 자매
   *  - v1.54: `kind='critique' + critiqueAuthority='force-rework'` → critique(primary) ↔ command(auto-rework) 자매
   */
  bundleId?: string;
  /** v1.32 / v1.54 — Bundle 내 역할.
   *  - 'primary': 편집/표시 주체 (사용자가 만든 엣지). 삭제 시 자매도 cascade.
   *  - 'auto-artifact' (v1.32): command primary 의 결과 반환 채널. 방향 반대, 편집/삭제 잠금.
   *  - 'auto-rework' (v1.54): critique primary 의 force-rework 명령 채널. 방향 동일(감시자→작업자), kind='command', 편집/삭제 잠금. `command` 본문은 서버가 표준 라벨로 자동 채움.
   */
  bundleRole?: 'primary' | 'auto-artifact' | 'auto-rework';
  /** v1.33 — 이 엣지의 위임 정책. 엣지별로 독립 설정.
   * - 'strict' (기본): 이 엣지의 용도에 매칭되는 작업은 반드시 위임. 소스가 자체 Read/Grep 금지.
   * - 'auto': 소스 판단 — 탐색 비용 클 때만 위임. 간단한 건 자체 처리.
   * 미설정 시 'strict' 로 해석. */
  delegationPolicy?: 'strict' | 'auto';
  /** v1.41 — Critique 전용: 리뷰 타이밍 (optional, kind='critique' 일 때만 해석). 기본 'intermediate'. */
  critiqueTiming?: TaskEdgeCritiqueTiming;
  /** v1.41 — Critique 전용: reject 권한 (optional, kind='critique' 일 때만 해석). 기본 'force-rework'. */
  critiqueAuthority?: TaskEdgeCritiqueAuthority;
  /** v1.41 — Critique 전용: force-rework 시 최대 재작업 횟수. 초과 시 comment-only로 강등 + 에스컬레이션.
   *  기본 3. kind='critique' + critiqueAuthority='force-rework' 일 때만 의미. */
  maxReworkCount?: number;
  /** v1.55 — Critique 런타임 강제: 현재 사이클의 누적 재작업 횟수. 새 사이클(타겟이 fresh 완료)에서 0으로 리셋,
   *  watcher 가 reject 판정 + auto-rework 발사 시 +1. `maxReworkCount` 초과 시 자동 강등.
   *  `kind='critique' + bundleRole='primary'` 엣지에서만 의미. 영속화는 TaskEdge 직렬화 편승. */
  reworkCount?: number;
  /** v1.44 — Command 전용: 위임 형태 (shared/tool-delegation/mode-delegation). kind='command' 일 때만 의미.
   *  미설정 시 후방호환 해석: delegationPolicy='strict' → 'tool-delegation', 그 외 → 'shared'. */
  commandMode?: TaskEdgeCommandMode;
  createdAt: number;
  lastExecutedAt?: number;
}

/** Task Edge 템플릿 — 드래그 연결 시 프리셋 제안.
 * `default*` 필드는 템플릿 선택 시 UI가 메인+고급 옵션을 자동 채우는 데 사용. */
export interface TaskEdgeTemplate {
  id: string;
  /** 표시 이름 (예: "탐색 → 설계") */
  label: string;
  /** 기본 명령어 (편집 가능) */
  defaultCommand: string;
  /** 소스 역할 힌트 (매칭 제안용, null이면 모든 소스) */
  sourceRole: AgentRole | null;
  /** 타겟 역할 힌트 */
  targetRole: AgentRole | null;
  /** 기본 전파 모드 */
  defaultForwardMode: TaskEdgeForwardMode;
  /** 기본 엣지 의미 (v1.18, optional — 미설정 시 'command') */
  defaultKind?: TaskEdgeKind;
  /** 기본 메시지 형식 (v1.18, optional) */
  defaultMessageFormat?: TaskEdgeMessageFormat;
  /** 기본 반환 형식 (v1.18, optional) */
  defaultReturnFormat?: TaskEdgeReturnFormat;
  /** 기본 우선순위 (v1.18, optional) */
  defaultPriority?: TaskEdgePriority;
  /** 기본 Critique 타이밍 (v1.41, optional — kind='critique' 프리셋용) */
  defaultCritiqueTiming?: TaskEdgeCritiqueTiming;
  /** 기본 Critique 권한 (v1.41, optional — kind='critique' 프리셋용) */
  defaultCritiqueAuthority?: TaskEdgeCritiqueAuthority;
  /** 기본 최대 재작업 횟수 (v1.41, optional — kind='critique' + force-rework 프리셋용) */
  defaultMaxReworkCount?: number;
  /** 기본 Command 위임 형태 (v1.44, optional — kind='command' 프리셋용). 미설정 시 TASK_EDGE_DEFAULTS.commandMode. */
  defaultCommandMode?: TaskEdgeCommandMode;
  /** 기본 위임 정책 (v1.83, optional — strict/auto). 미설정 시 TASK_EDGE_DEFAULTS.delegationPolicy. */
  defaultDelegationPolicy?: 'strict' | 'auto';
}

/** 파이프라인 자식 에이전트 설정 (constants.ts에서 config 테이블로 관리) */
export interface PipelineChildConfig {
  role: AgentRole;
  model: string;
  readOnly: boolean;
  tools: string[];
  maxTurns: number;
  color: string;
}

/** 파이프라인 상태 — 부모-자식 관계 + 실행 전략 */
export interface PipelineState {
  parentId: string;
  type: PipelineType;
  childIds: string[];
  createdAt: number;
}

/** iframe 버블의 서버 유형 — 프론트엔드(프리뷰 가능) vs 백엔드(API만) */
export type ServerKind = 'frontend' | 'backend';

/** Ghost 변경 유형 — 파일/폴더가 어떻게 사라졌는지 */
export type GhostChangeType = 'deleted' | 'renamed';

/** Ghost 버블 메타데이터 — 삭제/이름변경된 파일의 추적 정보 */
export interface GhostInfo {
  /** 변경 유형 */
  changeType: GhostChangeType;
  /** ghost 전환 전 원래 BubbleType (위성 판별 등에 사용) */
  originalBubbleType: BubbleType;
  /** 원래 경로 */
  fromPath: string;
  /** rename 시 새 경로 */
  toPath?: string;
  /** ghost 전환 시각 (ms) */
  ghostedAt: number;
  /** 사용자가 소멸 금지 체크한 상태 */
  pinned: boolean;
}

/** 버블 스타일 설정 — 타입별 시각 속성을 한 곳에서 관리 */
export interface BubbleStyleConfig {
  color: string;
  glow: string;
  icon: 'agent' | 'folder' | 'file' | 'terminal' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'conti' | 'auto';
  ringIdle: string;
  ringActive: string;
}

/** 엣지 스타일 설정 */
export interface EdgeStyleConfig {
  activeOpacity: string;
  inactiveColor: string;
  activeWidth: number;
  inactiveWidth: number;
  /** 엣지 비활성 후 사라지기까지 시간 (ms) */
  ttl: number;
}

/** 버블 데이터 — React Flow 노드에 들어갈 공통 데이터 */
export interface BubbleData {
  id: string;
  label: string;
  bubbleType: BubbleType;
  path: string;
  status: NodeStatus;
  activity: number;
  lastActivity?: number;
  lastTool?: string;
  childCount?: number;
  /**
   * 폴더에 satellite 로 매달린 파일 수 (§2.1 v1.55).
   * 외부 폴더(`external_folder`)는 평탄화 정책상 직속 child 가 없고 satellite 만 가지므로
   * `childCount` 가 항상 0/1 로 퇴화한다. 이 필드가 해당 폴더에서 실제 에이전트가 만진
   * 외부 파일 수를 가리킨다. 내부 폴더는 satellite 가 있으면 함께 채워지나
   * UI 카운트는 기본적으로 childCount(직속 하위 폴더 수)를 우선한다.
   */
  satelliteFileCount?: number;
  /**
   * 폴더 버블별 위성 표시 상한 (사용자가 디테일 패널에서 편집, §7.5).
   * undefined 면 `DEFAULT_MAX_SATELLITES`. internal_folder/external_folder 만 의미.
   * 초과 시 서버 `registerSatellite` 가 FIFO(오래된 것부터) 제거.
   * 노드 직렬화로 ProjectCheckpoint 에 자동 영속(별도 toCheckpoint 로직 불요).
   */
  maxSatellites?: number;
  /**
   * 파일 버블별 diff 저장 무한 토글 (사용자가 디테일 패널 체크박스로 편집, §7.4).
   * undefined/false 면 `MAX_FILE_EDITS`(=20) 상한 적용(기본). true 면 해당 파일은
   * 트림 없이 무한 누적. `file` 타입만 의미. 노드 직렬화로 ProjectCheckpoint 에
   * 자동 영속(별도 toCheckpoint 로직 불요 — maxSatellites/preservePinned 선례).
   */
  unlimitedFileEdits?: boolean;
  fileSize?: number;
  /** fade 시작 시각 (completed → 60초 후 idle 전환) */
  fadeStartedAt?: number;
  /** 에이전트 작업 완료 요약 (Stop 훅 시점 마지막 assistant 메시지) */
  summary?: string;
  /** 이 노드에 연결된 활성 에이전트 ID 목록 (파일/폴더용, 디테일 패널에서 표시) */
  activeAgentIds?: string[];
  /** 사용자가 지정한 화면 위치 (드래그 후 서버에 저장) */
  position?: { x: number; y: number };
  /** 절대 경로 (파일/폴더 버블용, 디테일 패널 표시 + 클릭 열기) */
  absolutePath?: string;
  /** 에이전트 사용 모델명 (예: "claude-opus-4-6") — agent 버블만 */
  modelName?: string;
  /** 현재 컨텍스트 사용량 (토큰 수) — agent 버블만 */
  contextUsed?: number;
  /** 모델 최대 컨텍스트 (토큰 수) — agent 버블만 */
  contextMax?: number;
  /** 자체 세션 누적 입력 토큰 — agent 버블만 */
  ownInputTokens?: number;
  /** 자체 세션 누적 출력 토큰 — agent 버블만 */
  ownOutputTokens?: number;
  /** 서브에이전트 포함 총 입력 토큰 (own + sum(sub)) — agent 버블만 */
  totalInputTokens?: number;
  /** 서브에이전트 포함 총 출력 토큰 (own + sum(sub)) — agent 버블만 */
  totalOutputTokens?: number;
  /** modelName/contextUsed/contextMax 가 특정 서브에이전트에서 유래했을 때 그 sub 의 라벨
   *  (예: "Sub #7"). 커스텀 에이전트 버블에서 "opus-4-7 / Sub #7" 형태로 표시. */
  contextSourceSubLabel?: string;
  /** 사용자가 루트 패널에서 수동 고정한 노드 (엣지 없이도 캔버스에 표시) */
  pinned?: boolean;
  /**
   * 사용자 preserve-pin (§2.4 v1.28). true면 이 버블은
   * (a) setDisappear / 자동 status='disappearing' 전환 스킵,
   * (b) DELETE /api/bubble/:nodeId 에서 409로 거부,
   * (c) convertToGhost 시 ghostInfo.pinned=true 자동 동기화로 fade 차단.
   * 기존 ghostInfo.pinned(Persist, ghost fade-out 만 제어)와 독립 축.
   */
  preservePinned?: boolean;
  /** 캔버스에서 사용자가 직접 생성한 에이전트 (훅 이벤트가 아닌 UI 생성) */
  customCreated?: boolean;
  /** Ghost 메타데이터 — bubbleType이 'ghost'일 때만 존재 */
  ghostInfo?: GhostInfo;
  /** 소멸 시작 시각 (ms) — status가 'disappearing'일 때 설정 */
  disappearStartedAt?: number;
  /** 소멸 완료 시각 (ms) — 이 시각 이후 서버가 실제 삭제 */
  disappearAt?: number;
  /** iframe 버블: 서버 URL (예: "http://localhost:3000") */
  url?: string;
  /** iframe 버블: 서버 유형 (frontend=프리뷰 가능, backend=API만) */
  serverKind?: ServerKind;
  /** iframe 버블: 연결된 Claude Code background shell ID (KillShell 매칭용) */
  shellId?: string;
  /** iframe 버블: 대상 서버 포트가 실제 살아있는지 (false면 opacity 낮춰서 비활성 표시) */
  iframeAlive?: boolean;
  /**
   * iframe 버블: `iframeAlive` 가 false 로 떨어진 시각(epoch ms). §7.11 v2.1.
   * checkIframesAlive 가 죽은 위성 발견 시 1회 기록 → `IFRAME_DEAD_GRACE_MS` 경과 시 위성 자동 제거.
   * 위성이 다시 살아나면(`iframeAlive` false→true) 서버가 클리어. 클라이언트는 읽지 않는다(서버 전용).
   */
  iframeDeadAt?: number;
  /** 에이전트 영구 위성 (bash/iframe) — 에이전트와 함께 체크포인트 저장/복원 */
  persistSatellites?: BubbleData[];
  /** 클라이언트 전용 placeholder 상태 — worktree 생성 연출. 서버는 이 필드를 설정하지 않는다. */
  creatingStatus?: 'creating' | 'error';
  /** 파이프라인 부모 버블: 실행 전략 타입 — bubbleType='pipeline'일 때만 */
  pipelineType?: PipelineType;
  /** 파이프라인 자식 에이전트: 역할 — pipelineParentId가 있을 때만 */
  agentRole?: AgentRole;
  /** 파이프라인 자식 에이전트 → 부모 파이프라인 ID 참조 */
  pipelineParentId?: string;
  /** Hook 부모 에이전트: 더블클릭 진입 가능 여부 (서브에이전트 보유 시 true) */
  isParentAgent?: boolean;
  /**
   * §5.7 #23-2 v1.60 — Claude Code Agent View 짧은 식별자 (8 hex).
   * `claude --bg` 가 인쇄한 `backgrounded · <short>` 의 short. supervisor 가 자식을 들고 있고
   * 우리는 이 short 로 `claude stop|respawn|rm <short>` 를 호출한다.
   * legacy `-p` 경로에선 항상 undefined.
   */
  agentViewShort?: string;
  /**
   * §5.7 #23-2 v1.60 — Agent View 가 할당한 풀 sessionId (UUID).
   * `~/.claude/projects/<cwdKey>/<sessionId>.jsonl` 경로 계산 + reconcile 매칭 키.
   * legacy `-p` 경로에선 sessionId 자체는 있어도(우리가 지정) 이 필드는 채우지 않는다 —
   * 서로 다른 발급 주체이므로 분리해 둔다.
   */
  agentViewSessionId?: string;
  /**
   * 에이전트 활성 체크 디버그 정보 — `claude -p --session-id <id>` 결과.
   * 10초마다 갱신, 클라이언트 debugMode에서 버블 위에 표시.
   * - inUse=true  → 다른 Claude Code가 점유 중 → 활성 → 버블 유지
   * - inUse=false → 세션 점유 없음 → 비활성 → 이번 주기에 제거
   */
  lastLivenessCheck?: {
    timestamp: number;
    inUse: boolean;
    durationMs: number;
  };
}

/** TodoWrite 도구의 개별 항목 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** 에이전트 유저 명령 기록 항목 */
export interface AgentEvent {
  id: string;
  message: string;
  /** 해당 프롬프트에 대한 assistant 응답 요약 */
  response?: string;
  timestamp: number;
  /** 프롬프트 출처: 유저 직접 입력 vs 대기열에서 실행 */
  source: 'user' | 'queue';
  /** 대기열에 넣은 시각 (source='queue'일 때만) */
  queuedAt?: number;
  /** 해당 턴에서 TodoWrite로 업데이트한 할일 목록 (마지막 TodoWrite 기준) */
  todos?: TodoItem[];
}

/** 에이전트 ↔ 폴더 상호작용 엣지 */
export interface ActivityEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  timestamp: number;
  /** 최신 엣지만 true, 이전 엣지는 false (회색 비활성) */
  isActive: boolean;
}

/** Bash 명령 기록 항목 */
export interface BashEntry {
  id: string;
  command: string;
  output?: string;
  timestamp: number;
}

/** 파일 수정 기록 항목 (Edit 도구 호출 1회 = 1 엔트리) */
export interface FileEdit {
  id: string;
  /** 원본 절대 경로 (VS Code에서 열기용, forward slash) */
  filePath: string;
  oldString: string;
  newString: string;
  timestamp: number;
}

/** 실행 중인 서버 프로세스 항목 */
export interface ServerEntry {
  id: string;
  command: string;
  port?: number;
  pid?: number;
  memoryMB?: number;
  startedAt: number;
  alive: boolean;
  /** Claude Code run_in_background shell ID (KillShell로 종료 감지용) */
  shellId?: string;
  /** run_in_background 출력 파일 절대 경로 (포트 탐지용) */
  outputFile?: string;
}

/** SubAgent 상태 */
export type SubAgentStatus = 'idle' | 'active' | 'completed' | 'error';

/** SubAgent — 부모 에이전트가 소유하는 독립 실행 세션 */
export interface SubAgent {
  /** subagent 고유 ID (예: "sub-a3f2b1c0") */
  id: string;
  /** Claude Code 세션 ID */
  sessionId: string;
  /** 표시 이름 (예: "Sub #1") */
  label: string;
  /** 부모 에이전트 ID */
  parentAgentId: string;
  status: SubAgentStatus;
  /** 마지막 실행 명령 */
  lastCommand?: string;
  /** 마지막 실행 결과 요약 */
  lastResult?: string;
  createdAt: number;
  lastActivityAt: number;
  /** 누적 입력 토큰 (모든 턴 합산, JSONL에서 읽음) */
  totalInputTokens?: number;
  /** 누적 출력 토큰 (모든 턴 합산) */
  totalOutputTokens?: number;
  /** 사용 모델명 (마지막 턴 기준) */
  modelName?: string;
  /** 현재 컨텍스트 사용량 (토큰) — JSONL에서 읽음, 스냅샷마다 재계산 */
  contextUsed?: number;
  /** 모델 최대 컨텍스트 (토큰) */
  contextMax?: number;
  /** §5.7 #23-2 v1.60 — Agent View short id (해당 SubAgent 가 `--bg` 경로로 dispatch 된 경우) */
  agentViewShort?: string;
  /** §5.7 #23-2 v1.60 — Agent View 가 할당한 풀 sessionId (UUID) — `sessionId` 와 일치하지만
   *  발급 주체 구분 위해 별도 필드. legacy `-p` 경로에선 undefined. */
  agentViewSessionId?: string;
}

/**
 * §5.7 #23-2 v1.60 — `~/.claude/daemon/roster.json` 의 한 worker 항목.
 * Anthropic 가 schema 를 흔들 수 있어 우리는 우리가 쓰는 필드만 좁게 잡음(나머지는 unknown).
 */
export interface AgentViewRosterEntry {
  /** worker 프로세스 PID */
  pid: number;
  /** 풀 sessionId (UUID) */
  sessionId: string;
  /** Claude Code 버전 */
  cliVersion: string;
  /** 시작 시각 (ms epoch) */
  startedAt: number;
  /** worker 의 cwd */
  cwd: string;
  /** dispatch 메타 (isolation 등) — 필요한 만큼만 좁게 */
  dispatch?: {
    short?: string;
    isolation?: 'none' | 'worktree' | string;
    cwd?: string;
  };
}

/**
 * §5.7 #23-2 v1.60 — `~/.claude/jobs/<short>/state.json` 의 우리가 보는 부분.
 * Anthropic 가 schema 를 확장할 수 있으므로 알려진 필드만 좁게 잡음.
 */
export interface AgentViewJobState {
  state: 'working' | 'idle' | 'needs-input' | 'done' | 'failed' | 'stopped' | string;
  detail?: string;
  tempo?: string;
  inFlight?: { tasks: number; queued: number; kinds?: string[] };
  output?: { result?: string };
  /** `~/.claude/projects/<cwdKey>/<sessionId>.jsonl` 의 절대경로 */
  linkScanPath?: string;
  sessionId?: string;
  daemonShort?: string;
  cliVersion?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  backend?: string;
  intent?: string;
  name?: string;
}

/** 과거(archive) SubAgent 요약 — folder 팝업에서 "다시 열기" 후보로 표시.
 *  archive Map에서 해당 parentAgentId 소속만 추려 전달.
 *  `subAgentId`를 restore API에 넘겨 살려낸다. */
export interface SubAgentHistoryItem {
  /** archive에 보존된 원래 sub-id (restore 시 그대로 복귀) */
  subAgentId: string;
  /** Claude Code 세션 ID — 복원 후 --resume 키 */
  sessionId: string;
  /** 원래 label (예: "Sub #3") */
  label: string;
  /** 마지막 실행 명령 요약 — 있으면 표시 */
  lastCommand?: string;
  /** 마지막 활동 시각 (ms) */
  lastActivityAt: number;
  /** 누적 입력 토큰 */
  totalInputTokens?: number;
  /** 누적 출력 토큰 */
  totalOutputTokens?: number;
}

/** 대기열 명령 항목 (서버가 관리, 클라이언트는 읽기만) */
export interface QueuedCommand {
  id: string;
  text: string;
  timestamp: number;
  /** 실행할 subagent ID (null이면 새 세션 자동 생성) */
  subAgentId: string | null;
  /** 실행 상태 */
  status: 'queued' | 'executing' | 'completed' | 'error';
  /** 실행 결과 (completed 시) */
  result?: string;
  /** 이 명령 실행에 사용된 입력 토큰 (이전 누적 대비 증분) */
  inputTokens?: number;
  /** 이 명령 실행에 사용된 출력 토큰 (이전 누적 대비 증분) */
  outputTokens?: number;
  /** v1.32 — Task Edge dispatch로 주입된 경우 해당 엣지 ID. 완료 시 대기 promise resolve + 엣지 status 동기화. */
  edgeId?: string;
  /**
   * v1.35 — 클립보드 paste 로 첨부된 이미지 파일 경로 목록.
   * 서버 `.vibisual/attachments/<sessionId>/<uuid>.<ext>` 절대경로.
   * dispatch 시 프롬프트 텍스트 말미에 공백 구분으로 append 하여 CLI 에 전달되고,
   * 명령 완료/에러 시 `setOnComplete` 콜백이 파일 unlink + 이 필드를 undefined 로 되돌림.
   * 결과 아카이브(completedCommands)에는 남지 않음.
   */
  attachments?: string[];
  /**
   * v1.79 — 서버 재시작으로 끊긴 커스텀 에이전트 명령을 `[orphaned]` 에러로 봉합하지 않고
   * 보존된 세션(sub.sessionId)으로 1회 자동 재개(re-queue)했음을 표시. 무한 재개 루프 방지용
   * one-shot 가드 — 재개 후에도 또 끊기면 그때는 `[orphaned]` 에러로 마감한다.
   */
  restartResumed?: boolean;
}

/** 명령 페이로드 — DetailPanel 액션 버튼용 */
export interface CommandPayload {
  action: 'inspect' | 'send_agent' | 'what_remains';
  nodeId: string;
}

/** 에이전트 상태 — 시스템 레벨 (전체 에이전트 활동 여부) */
export interface AgentStatus {
  isActive: boolean;
  activeCount: number;
  totalCount: number;
  lastSeen: number;
}

// ─── Comment Box (언리얼 블프 스타일 주석 컨테이너) ───
// §4 확장 포인트 — 새 엔티티(커스텀 노드) + 새 영속 데이터 조합.
// 기존 BubbleType 과는 별개 축. 버블을 시각적으로 "감싸는" 배경 레이어.
// parent/child 관계가 아니라 offset 기반 공간 휴리스틱(드래그 시 동반 이동).

/** Comment Box — 영역 선택 + C 키로 생성되는 주석 컨테이너. */
export interface CommentBox {
  /** 고유 ID — `comment-<timestamp36>-<rand>` 포맷 */
  id: string;
  /** 소속 프로젝트 이름 (탭 필터링용). ProjectInfo.name 기준. */
  projectName: string;
  /**
   * 메인 캔버스 기준 위치(React Flow 좌상단). 폴더 내부에는 배치 금지 — 메인 뷰 전용.
   * 같은 맥락에서 Task Edge 도 메인 뷰에서만 렌더됨(§5.3 #12).
   */
  x: number;
  y: number;
  /** 박스 크기(픽셀). 리사이즈 시 업데이트. */
  width: number;
  height: number;
  /** 주석 텍스트. 줌 아웃 시 풍선 라벨로 확대 표시. */
  text: string;
  /** 배경/테두리 색(hex, 예: '#f59e0b'). 팔레트에서 선택. */
  color: string;
  /** 텍스트 색(hex). 미설정 시 자동 대비(흰/검). */
  textColor?: string;
  /** 폰트 크기(px). 기본 COMMENT_BOX_DEFAULTS.fontSize. */
  fontSize?: number;
  /** 배경 투명도 0..1. 기본 COMMENT_BOX_DEFAULTS.opacity. */
  opacity?: number;
  /**
   * 감싸고 있는 버블 ID 목록. 드래그 시 동반 이동 대상.
   * React Flow parent/child 관계는 쓰지 않음 — 기존 폴더/위성 계층과 꼬이지 않도록 offset-only.
   */
  childNodeIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** WebSocket 메시지 타입 */
export type WSMessageType =
  | 'hook_event'
  | 'node_update'
  | 'agent_status'
  | 'edge_update'
  | 'command'
  | 'command_pop'
  | 'connection_ack'
  | 'graph_snapshot'
  | 'sub_agent_stream'
  // 성능 — 여러 sub_agent_stream 을 서버에서 짧은 창(40ms)으로 모아 배열 1건으로 전송.
  // 멀티에이전트 스트림 폭주 시 이벤트당 1건씩 IPC/WS 밀어내던 것을 배치로 묶어 백프레셔 완화.
  | 'sub_agent_stream_batch'
  | 'liveness_probe'
  // lazy-load: 클라→서버 요청 / 서버→클라 broadcast
  | 'hydrate-project'
  | 'project-hydrated'
  | 'unload-project'
  | 'project-unloaded'
  // §5.3 #12-1 v1.43 — 권한 승인 UX
  | 'permission_request'
  | 'permission_resolved'
  // §7.11 v1.44 — iframe 서버 로그 스트리밍 (lazy pub/sub)
  | 'subscribe_iframe_log'
  | 'unsubscribe_iframe_log'
  | 'iframe_log_init'
  | 'iframe_log_append'
  // §7.7 v1.99 — Vibisual 서버 코어 로그 스트리밍 (lazy pub/sub)
  | 'subscribe_server_log'
  | 'unsubscribe_server_log'
  | 'server_log_init'
  | 'server_log_append'
  // §5.3 #28 v1.47 — 콘티모드 토스트 신호 (식별자만, 본체는 다음 snapshot)
  | 'conti_generated'
  | 'conti_patched'
  // §5.3 #28 (L) v1.58 — 같은 workId 의 후속 응답이 들어와 기존 Conti.frames 가 교체됨
  | 'conti_updated'
  // §5.7 #23-1 v1.59 — Claude Code 버전 업데이트 설치 진행 상황 푸시
  | 'claude_install_progress'
  // §5.3 #12-2 v2.26 — AskUserQuestion IDE 인라인 카드
  | 'ask_user_question'
  | 'ask_user_question_resolved'
  // §5.3 #10-2 v2.37 — Auto Agent 진행/완료 신호 (요약은 graph_snapshot.autoAgentSummaries 로 전달)
  | 'auto_agent_progress'
  // §4 v2.38 — 모델 레지스트리 갱신 (시드 + /v1/models 머지 결과). payload = ModelRegistry
  | 'model_registry_updated'
  // §4 v2.42 — Options 창에서 사용자 글로벌 디폴트 갱신. payload = UserDefaults
  | 'user_defaults_updated'
  // §4 v2.52 — 에이전트 작업 신고(did/userActions) 수신 신호. 본체는 graph_snapshot.agentReports
  | 'agent_report'
  // §4 v2.60 — 에이전트 질문 카드 수신 신호. 본체는 graph_snapshot.agentQuestions
  | 'agent_questions'
  // §4 v2.70 — 에이전트 검수 요청 카드 수신 신호. 본체는 graph_snapshot.agentReviews
  | 'agent_review'
  // §4 v2.84 — 에이전트 번호 목록 정렬 카드 수신 신호. 본체는 graph_snapshot.agentLists
  | 'agent_list';

/** §5.3 #28 v1.47 — 콘티 생성/패치 완료 토스트용 페이로드. 본체는 graph_snapshot 에서 받는다. */
export interface ContiEventPayload {
  contiId: string;
  agentId: string;
  /** patch 인 경우만 */
  frameId?: string;
  elementId?: string;
  /** §5.3 #28 (L) v1.58 — `conti_generated` / `conti_updated` 에 동봉, patch 에는 부재 */
  workId?: string;
}

/** §5.3 #12-1 v1.43 — 권한 승인 요청 (서버→클라 브로드캐스트용) */
export interface PermissionRequest {
  /** 요청 고유 ID (서버가 발급, UUID) */
  requestId: string;
  /** 요청한 에이전트 ID (Vibisual 관할 subagent id 또는 hook agent id) */
  agentId: string;
  /**
   * §5.3 #12-1 v1.96 — 호출 sub 인스턴스 ID (env `VIBISUAL_SUBAGENT_ID`).
   * 사용자의 Allow/Deny 결정을 어느 sub 의 stream 라인에 합성할지 식별하는 키.
   * 훅 env 가 비어 도착하지 않은 경우(레거시/외부 호출) undefined 가능 — 그땐 stream 합성을 건너뜀.
   */
  subAgentId?: string;
  /** 에이전트 라벨 (UI 표시용, 서버가 조회해서 stamp) */
  agentLabel: string;
  /** 에이전트 색상 (UI 스택 구분용, `AgentConfig.color` 또는 기본) */
  agentColor: string;
  /** 소속 프로젝트 이름 (UI 필터링용) */
  projectName: string;
  /** 호출될 도구 이름 (예: "Bash", "Write", "WebSearch") */
  toolName: string;
  /** 도구 입력(직렬화 안전한 JSON 값). UI 에서 요약 표시. */
  toolInput: Record<string, unknown>;
  /** 요청 생성 시각 (Date.now()) */
  createdAt: number;
  /** 타임아웃 만료 시각 (서버 계산, UI countdown 용) */
  expiresAt: number;
}

/** §5.3 #12-1 v1.43 — 권한 승인 결정 (클라→서버 REST 바디 + 서버→클라 broadcast payload) */
export interface PermissionDecision {
  requestId: string;
  decision: 'allow' | 'deny';
  /** 거부 시 이유 (선택) — UI 에서 입력받아 훅으로 전달, Claude 에게 표시됨 */
  reason?: string;
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 옵션 한 개 */
export interface AskUserQuestionOption {
  /** 사용자에게 보이는 라벨. 모델에게 답으로 회신될 식별자. */
  label: string;
  /** 라벨 아래 작은 설명 (optional) */
  description?: string;
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 요청 (서버→클라 브로드캐스트용). 본체는 한 호출에 여러 질문 가능. */
export interface AskUserQuestionRequest {
  /** 요청 고유 ID (서버가 발급, UUID) */
  requestId: string;
  /** 요청한 에이전트 ID (Vibisual 관할 custom agent) */
  agentId: string;
  /**
   * 호출 sub 인스턴스 ID (env `VIBISUAL_SUBAGENT_ID`).
   * 클라가 어느 IDE 세션 탭에 카드를 인라인 합류시킬지 식별하는 키.
   * 메인 세션이면 undefined.
   */
  subAgentId?: string;
  /** 에이전트 라벨 (UI 표시용, 서버가 stamp) */
  agentLabel: string;
  /** 에이전트 색상 (UI 식별용, `AgentConfig.color` 또는 기본) */
  agentColor: string;
  /** 소속 프로젝트 이름 (UI 필터링/표시용) */
  projectName: string;
  /**
   * 모델이 던진 질문 batch. claude-code v2.1.145+ 본체는 `tool_input.questions` 가 배열 —
   * CLI 와 동일하게 카드 UI 에서 순차 응답한다. 길이 ≥ 1 보장.
   */
  items: AskUserQuestionItem[];
  /** 요청 생성 시각 (Date.now()) */
  createdAt: number;
  /** 타임아웃 만료 시각 (서버 계산, UI countdown 용) */
  expiresAt: number;
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 한 질문에 대한 사용자 답. */
export interface AskUserQuestionAnswer {
  /**
   * 사용자가 고른 옵션 라벨들. 단일 선택이면 길이 1, 다중 선택이면 1+ 개.
   * "Other(직접 입력)" 선택 시엔 사용자가 입력한 자유 텍스트가 라벨로 합성된다.
   * 타임아웃 시 빈 배열.
   */
  selectedLabels: string[];
  /** Other 가 아닐 때 supplemental 메모 (optional) */
  note?: string;
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 결정 (클라→서버 REST 바디 + 서버→클라 broadcast payload) */
export interface AskUserQuestionDecision {
  requestId: string;
  /** request.items 와 1:1 길이/순서 매칭되는 답 배열. timeout 이면 빈 배열. */
  answers: AskUserQuestionAnswer[];
  /** 결정 출처: 사용자 명시 답 / 60s 타임아웃 자동 차단 */
  reason?: 'user' | 'timeout';
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 도구 의 단일 질문 아이템. */
export interface AskUserQuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
}

/**
 * §5.3 #12-2 v2.26 — AskUserQuestion 도구 입력 스키마 (claude-code v2.1.145+ 본체 호환).
 * 본체는 한 호출에 여러 질문을 배치로 던질 수 있으므로 `questions` 가 **배열** 이다.
 * Vibisual 본 라운드는 첫 질문만 카드로 surface (배치 처리는 후속).
 */
export interface AskUserQuestionToolInput {
  questions: AskUserQuestionItem[];
}

/**
 * §5.7 #23-1 v1.59 — Claude Code CLI 의 현재/최신 버전 비교 결과.
 * 서버 `claudeVersionService` 가 발급, `GET /api/claude-version` 응답 + 클라 모달 표시.
 */
export interface ClaudeVersionInfo {
  /** 현재 사용 중인 바이너리 버전 ("2.1.139" 등). 검출 실패 시 null. */
  current: string | null;
  /** npm registry @anthropic-ai/claude-code latest 태그. registryError 시 null. */
  latest: string | null;
  /**
   * 바이너리 출처. `findClaudeBin()` 가 결정한 경로 패턴으로 판정:
   * - 'vscode-extension' = `~/.vscode/extensions/anthropic.claude-code-*` 하위 → 자동 설치 ❌, 안내만
   * - 'path' = PATH 의 `claude` (npm global 등) → `npm install -g @anthropic-ai/claude-code` 자동 설치 가능
   * - 'unknown' = 검출 자체 실패 (PATH 에도 없음 등)
   */
  source: 'vscode-extension' | 'path' | 'unknown';
  /** 사용된 바이너리 절대 경로 (UI 디버그/안내용) */
  binPath: string;
  /** current/latest 모두 채워졌고 semver 비교 결과 current < latest 면 true. 한쪽이라도 null 이면 false. */
  isOutdated: boolean;
  /** 체크 시각 (Date.now()) — 캐시 hit/miss 판단용 */
  checkedAt: number;
  /** registry HTTPS 호출 실패 시 원인 짧게 (UI 노출용) */
  registryError?: string;
  /** `--version` spawn 실패 시 원인 (UI 노출용) */
  detectError?: string;
}

/**
 * §5.7 #23-1 v1.59 — `npm install -g @anthropic-ai/claude-code` 진행 상황.
 * WS `claude_install_progress` payload + REST 동기 응답 dual-use.
 */
export interface ClaudeInstallProgress {
  /** 설치 시도 식별자 — 중복 호출 시 같은 in-flight 작업 ID 반환 */
  installId: string;
  /** starting = spawn 직전, running = stdout 누적 중, done = 정상 종료 + 새 버전 검증 완료, error = 실패 */
  status: 'starting' | 'running' | 'done' | 'error';
  /** 누적 stdout/stderr 전체 (라인 단위 append, ANSI 미스트립) */
  stdout?: string;
  /** done/error 시 spawn exit code */
  exitCode?: number;
  /** done 시 새로 검증된 버전 ("2.1.140" 등) */
  newVersion?: string;
  /** error 시 사람 읽기용 메시지 */
  error?: string;
}

/**
 * §4 v2.43 — PC 에서 발견된 단일 `claude` 설치본. 옵션창 Version 탭의 선택 목록 항목.
 * `claudeBin.discoverAllClaudeBins()` 가 모든 후보(VS Code 변종 확장 + PATH 전체 + 알려진 위치)를
 * realpath dedupe 후 각각 `--version` probe 하여 만든다.
 */
export interface ClaudeInstall {
  /** 절대 경로 (realpath 정규화) */
  binPath: string;
  /** 출처 — `ClaudeVersionInfo.source` 와 동일 의미 */
  source: 'vscode-extension' | 'path' | 'unknown';
  /** `--version` 파싱 결과 ("2.1.154" 등). probe 실패 시 null. */
  version: string | null;
  /** probe 실패 시 원인 (UI 노출용) */
  detectError?: string;
  /** 현재 `resolveClaudeBin()` 이 실제로 고른 활성 바이너리면 true */
  active: boolean;
  /** 사용자가 명시 선택(override)한 경로와 일치하면 true */
  selected: boolean;
}

/**
 * §4 v2.43 — `GET /api/claude-installs` 응답 = 옵션창 Version 탭 전체 데이터.
 * 하드코딩 0 — 모든 필드 런타임 동적(설치본 probe / package.json / process / npm registry).
 */
export interface ClaudeInstallsInfo {
  /** 발견된 모든 설치본 (active 우선, 그다음 source·version 정렬) */
  installs: ClaudeInstall[];
  /** 사용자가 고정(override)한 경로. null = 자동 탐색 모드. */
  overridePath: string | null;
  /** Vibisual 자체 버전 (package.json `version` 동적 read) */
  appVersion: string;
  /** npm registry `@anthropic-ai/claude-code` latest 태그 (5분 TTL 캐시 공유). 실패 시 null. */
  latest: string | null;
  /** registry 조회 실패 시 원인 (UI 노출용) */
  registryError?: string;
  /** 런타임 환경 — About 섹션 표준 요소. 전부 `process.*` 에서 동적. */
  runtime: {
    /** process.versions.node */
    node: string;
    /** process.versions.electron — 데스크톱 앱에서만 채워짐 */
    electron?: string;
    /** process.platform ('win32' | 'darwin' | 'linux' ...) */
    platform: string;
    /** process.arch ('x64' | 'arm64' ...) */
    arch: string;
  };
  /** 스캔 시각 (Date.now()) */
  scannedAt: number;
}

/** isSessionInUse 실행 결과 — debug용으로 클라 콘솔에 출력 */
export interface LivenessProbePayload {
  sessionId: string;
  cwd: string;
  inUse: boolean;
  durationMs: number;
  /** 체크 종료 이유 (regex-match / close / timeout / spawn-error) */
  reason: string;
  /** claude CLI stdout+stderr 전체 */
  output: string;
  /** 실제 spawn된 명령줄 */
  command: string;
}

/** WebSocket 메시지 */
export interface WSMessage {
  type: WSMessageType;
  timestamp: number;
  payload: unknown;
}

// ─── Lazy Checkpoint Load — WS 페이로드 타입 ───

/** 클라→서버: 특정 프로젝트 hydrate 요청 */
export interface HydrateProjectPayload {
  projectName: string;
}

/** 서버→클라: hydrate 결과 broadcast */
export interface ProjectHydratedPayload {
  projectName: string;
  success: boolean;
  /** 실패 시 사유 */
  reason?: 'not-found' | 'already-hydrated' | 'load-error';
}

/** 클라→서버: 특정 프로젝트 unload 요청 */
export interface UnloadProjectPayload {
  projectName: string;
}

/** 서버→클라: unload 완료 broadcast */
export interface ProjectUnloadedPayload {
  projectName: string;
}

// ─── §7.11 v1.44 Iframe 서버 로그 스트리밍 ───

/** 로그 레벨 (정규식 추론 — 미상이면 undefined) */
export type IframeLogLevel = 'error' | 'warn' | 'info';

/** 한 줄짜리 서버 로그 */
export interface IframeLogLine {
  /** monotonic seq (서버 port-scope 내 증가) — 클라 dedupe/순서 보장용 */
  seq: number;
  /** epoch ms */
  ts: number;
  /** ANSI 제거된 본문 */
  text: string;
  /** 레벨 추론 결과. 미상이면 undefined */
  level?: IframeLogLevel;
}

/** 클라→서버: 특정 dev server 의 로그 구독 시작.
 *  스트림 식별자는 `(shellId, port)` — 다른 프로젝트가 같은 포트(예: Vite 5173)를
 *  써도 셸이 다르면 스트림이 분리된다(§7.11 v2.5). `shellId` 미상(레거시 위성)이면
 *  `port` 단독으로 후방호환. */
export interface IframeLogSubscribePayload {
  port: number;
  shellId?: string;
}

/** 클라→서버: 구독 해제 — subscribe 와 동일 식별자 */
export interface IframeLogUnsubscribePayload {
  port: number;
  shellId?: string;
}

/** 서버→클라: 구독 직후 현재 버퍼 일괄 전송 */
export interface IframeLogInitPayload {
  port: number;
  /** 구독 식별자 echo — 클라가 `(port, shellId)` 로 이벤트를 필터하도록 */
  shellId?: string;
  lines: IframeLogLine[];
  /** 소스 outputFile 경로 미확보 등 이유로 tail 불가 시 설정 */
  unavailable?: 'no-output-file' | 'no-server-entry' | 'file-not-found';
}

/** 서버→클라: 새 로그 라인 델타 (50ms 마이크로배치) */
export interface IframeLogAppendPayload {
  port: number;
  /** 구독 식별자 echo */
  shellId?: string;
  lines: IframeLogLine[];
}

// ─── §7.7 v1.99 Vibisual 서버 코어 로그 스트리밍 ───

/**
 * 로그 레벨. iframe 로그(IframeLogLevel)와 달리 정규식 추론이 아니라
 * `logger.*` 호출이 알려준 정확한 레벨 — undefined 없음. `debug` 포함.
 */
export type ServerLogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * 로그 라인 분류 (§7.7 v2.3) — ServerLogPopup 의 배지·필터 축.
 * `serverLogService` 가 라인 캡처 시점에 `level`+메시지 패턴으로 1회 판정한다.
 *  - `error` / `warn`: `level` 을 그대로 승격.
 *  - `hook`: Claude Code 훅 수신·처리 관련 라인.
 *  - `event`: 그 외 info/debug 전부(부팅·에이전트·세션·서버·iframe 등).
 * 새 분류 축 추가 시 이 유니온 + serverLogService 분류기 패턴 1줄.
 */
export type ServerLogCategory = 'error' | 'warn' | 'hook' | 'event';

/**
 * Vibisual 서버 코어 로그 한 줄. 서버 `serverLogService` 가 모든 `logger.*`
 * 호출을 ring buffer(`SERVER_LOG_BUFFER_MAX`)로 수집 — 영속화 ❌.
 */
export interface ServerLogEntry {
  /** monotonic seq (서버 전역 증가) — 클라 dedupe/순서 보장 + 리스트 key. */
  seq: number;
  /** epoch ms */
  ts: number;
  level: ServerLogLevel;
  /** 분류 (§7.7 v2.3) — 배지·필터 축. serverLogService 가 캡처 시 판정. */
  category: ServerLogCategory;
  /** 본문 (meta 합성 포함, 4000자 상한 트림). */
  message: string;
}

/** 클라→서버: 서버 코어 로그 구독 시작 (단일 전역 스트림 — payload 없음). */
export type ServerLogSubscribePayload = Record<string, never>;

/** 클라→서버: 구독 해제. */
export type ServerLogUnsubscribePayload = Record<string, never>;

/** 서버→클라: 구독 직후 현재 버퍼 일괄 전송. */
export interface ServerLogInitPayload {
  lines: ServerLogEntry[];
}

/** 서버→클라: 새 로그 라인 델타 (SERVER_LOG_BATCH_MS 마이크로배치). */
export interface ServerLogAppendPayload {
  lines: ServerLogEntry[];
}

/**
 * 앱 전역 상태 (`~/.vibisual/app-state.json` 영속, v1.52). 프로젝트 탭 라이프사이클 SSOT.
 *
 * **식별 모델 (v1.52(c) 정합 완성, v1.63):** 프로젝트 식별자 = **정규화 절대경로(projectId)**.
 * 과거엔 `path.basename` 이름을 PK 로 썼으나, 같은 basename 다른 경로 프로젝트(예: Vibisual
 * 체크아웃 2개)가 동시에 열리면 이름 1슬롯을 공유해 한쪽이 탭·재부팅 모두에서 소실됐다(§3.5 격리 위반).
 * 이제 `openProjects`/`pinnedProjects`/`lastActiveProject`/`defaultProject` 모두 **절대경로**(projectId)이며,
 * 표시 이름은 `path.basename`로 도출(중복 가능, 비식별). 비교·중복제거는 정규화(대소문자 무시) 기준.
 *
 * - 부팅 시 `openProjects`에 기록된 경로만 stub으로 등록 (닫은 프로젝트는 스킵).
 * - `lastActiveProject`는 부팅 직후 자동 hydrate 대상.
 * - `defaultProject`는 lastActive가 유효하지 않을 때 fallback hydrate 대상.
 * - `pinnedProjects`는 "Close Others / Close to the Right / Close All"에서 제외.
 * - `projectNames`(v1.63): projectId(절대경로) → 표시 이름 캐시. hydrate 전에도 탭 라벨을 그리기 위함
 *   (디스크 project.json 미가용 시 폴백). 식별엔 쓰지 않음 — 순수 표시용.
 * SSOT §3.2 line 101 / §3.5 / §5.7 #24 / feedback_boot_no_autoload_projects.
 */
export interface AppState {
  /** 열린 프로젝트 절대경로(projectId) 목록 (기본 탭바에 노출). forward-slash, 원본 케이스. 비교는 정규화. */
  openProjects: string[];
  /** 마지막 활성 프로젝트 절대경로(projectId) (부팅 시 자동 hydrate 우선순위 1). */
  lastActiveProject: string | null;
  /** Default 지정 프로젝트 절대경로(projectId) (lastActive가 없거나 stale일 때 fallback). */
  defaultProject: string | null;
  /** Pin된 프로젝트 절대경로(projectId) 목록 (bulk close 방어). */
  pinnedProjects: string[];
  /**
   * projectId(절대경로) → 표시 이름 캐시 (v1.63). hydrate 전 탭 라벨 렌더용 — 식별엔 미사용.
   * - 키: forward-slash 절대경로(`ProjectInfo.path` 동일 포맷). 비교는 정규화.
   * - 값: `path.basename` 표시 이름(중복 가능).
   * - `registerProject` 시점에 자동 갱신. optional — 구 AppState 하위호환(마이그레이션으로 채움).
   */
  projectNames?: Record<string, string>;
  /**
   * @deprecated v1.63 이전: 이름 → 절대경로 매핑. 부팅 마이그레이션 입력으로만 1회 읽고 더는 쓰지 않음.
   */
  projectPaths?: Record<string, string>;
  /**
   * §5.5 #17-4 — SkillsView 사용자 고정 순서 (드래그 재정렬). 머신 단위 전역.
   * type(`project`/`global`/`plugin`)별 스킬명 배열. 배열에 들어있는 스킬은 그 순서로 고정 렌더,
   * 없는(새로 추가된) 스킬은 기본 정렬(count desc → name asc) 후 뒤에 append.
   * 사용자가 한 번이라도 드래그하면 그 타입의 전체 가시 순서를 캡처해 여기에 저장.
   * §5.5 #17-5 — `global` = 사용자 홈 `~/.claude/skills/`·`~/.claude/commands/` (모든 프로젝트 공통).
   */
  skillOrder?: { project?: string[]; global?: string[]; plugin?: string[] };
  /**
   * §5.5 #17-4 v2.93 — SkillsView 즐겨찾기 스킬명 목록 (머신 단위 전역, 프로젝트 무관).
   * 출처(project/global/plugin) 무관하게 스킬명 키(병합 목록은 name 유일). 별을 누른 순서 보존 —
   * SkillsView 가 이 순서로 최상단 "Favorites" 카테고리에 렌더하고, 해당 스킬은 출처 그룹에서 제외.
   */
  skillFavorites?: string[];
  /** 마지막 업데이트 타임스탬프 (epoch ms). */
  updatedAt: number;
}

/** AppState 부분 업데이트 페이로드 — PATCH /api/app-state 요청 본문. `updatedAt`은 서버가 채움. */
export type AppStatePatch = Partial<Pick<AppState, 'lastActiveProject' | 'defaultProject' | 'pinnedProjects' | 'openProjects'>>;

/** boot 시 메타만 로드, hydrate 시 채워짐 */
export interface ProjectMetaSnapshot {
  project: ProjectInfo;
  lastSavedAt: number;
  createdAt: number;
  /** `<projectPath>/.vibisual/save/checkpoint.json` 절대경로 (v1.52 분산 저장) — lazy load 시 사용 */
  checkpointPath: string;
  /** discriminator — 항상 false. hydrated 인스턴스와 union 분기에 사용 */
  isHydrated: false;
  /** §3.2.1-4 (v3.03) — 부팅 hydrate(load) 실패로 읽기 전용 격리된 stub. 자동 저장 동결 + 빈 인스턴스 생성 거부. */
  readOnly?: boolean;
  /** 격리 사유(디버그/UI 표기용). */
  readOnlyReason?: 'load-error';
}

/** 에이전트 전체 상태 (서버에서 계산, 클라이언트는 읽기만) */
export type AgentPhase = 'waiting' | 'working' | 'completed';

/**
 * 세션 감지 소스 — 어느 Layer가 해당 세션을 감지했는지.
 * 'hook' (초록): SessionStart 훅 — 가장 신뢰 가능, PID/cwd 완전
 * 'jsonl' (노랑): JSONL 파일 감시 — 훅 미설치 시 폴백
 * 'process' (회색): tasklist/pgrep 폴링 — 최후 수단
 */
export type SessionSource = 'hook' | 'jsonl' | 'process';

/**
 * 세션 생명 상태 — sessionLifecycle 관리자가 부여.
 * 'active': 최근 활동 있음 (펄스 애니메이션)
 * 'idle': 30초 이상 활동 없음 (반투명)
 * 'dead'는 따로 스냅샷에 안 실음 — 제거되므로
 */
export type SessionLifeStatus = 'active' | 'idle';

/** 그래프 스냅샷 — 클라이언트 초기 연결 시 전체 상태 전달 */
/**
 * §4 v2.52 — 에이전트 작업 신고 (커스텀/스폰 에이전트 전용).
 *
 * "AI 가 한 일(did)" 과 "사용자가 직접 해야 할 일(userActions)" 을 에이전트가 작업 완료 시
 * 구조화해 loopback `POST /api/agent-report` 로 신고한다(하네스 빌더 curl 패턴 재사용 — §5.3 #10-2).
 * IDE 가 이 신고를 색 구분 카드로 렌더: did=중립(회색/체크), userActions=amber 강조, nextSteps=보조.
 * Hook 에이전트는 우리가 rules 를 통제하지 않아 신고 지시문이 안 들어가므로 신고하지 않는다
 * → 기존 텍스트 렌더만 유지(하이브리드). `agentId` 가 1차 렌더 필터 키.
 */
export interface AgentReport {
  /** 신고 고유 ID (서버가 발급). */
  id: string;
  /** 신고한 (부모) 에이전트 ID — Vibisual 관할 custom agent. 렌더 필터 1차 키. */
  agentId: string;
  /** 호출 sub 인스턴스(IDE 세션 탭) ID. 있으면 그 탭에 귀속, 없으면(undefined) 메인 탭. */
  subAgentId?: string;
  /** AI 가 실제로 끝낸 일 (완료 항목). */
  did: string[];
  /** 사용자가 직접 해야 할 일 (에이전트가 대신 못 하는 액션 — 빌드 실행/에디터 조작/외부 승인 등). */
  userActions: string[];
  /** 다음 단계 / 후속 작업 (선택). */
  nextSteps?: string[];
  /** 자유 메모 / 헤드라인 (선택). */
  note?: string;
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/**
 * §4 v2.60 — 에이전트 질문 카드의 개별 질문 항목.
 *
 * 자연어 질문 + 그에 대한 제안 응답 프롬프트(0~N). 각 프롬프트는 IDE 카드에서 복사 박스 +
 * (복사 / 즉시 전송) 버튼으로 렌더된다. "즉시 전송" 은 그 프롬프트를 해당 세션에 새 명령으로 보낸다.
 */
export interface AgentQuestionItem {
  /** 질문 본문 (자연어). */
  question: string;
  /** 선택: 짧은 헤더 라벨 (질문 요지). */
  header?: string;
  /** 제안 응답 프롬프트 목록 (0~N). 각각 복사 박스 + 복사/즉시전송 버튼. 비어도 됨(질문만 강조). */
  prompts: string[];
}

/**
 * §4 v2.60 — 에이전트 질문 신고 (커스텀/스폰 에이전트 전용).
 *
 * AI 가 사용자에게 자연어로 던지는 질문(1~N개)을 눈에 띄게 보여주기 위한 카드. 작업 신고(AgentReport)와
 * 동일 골격 — 에이전트가 작업 끝에 loopback `POST /api/agent-questions` 로 구조화 신고(토큰 인증).
 * 기존 AskUserQuestion(선택지 + 60초 동기 hold)과는 **별개 메커니즘** — 이쪽은 비차단이고, 사용자가
 * 제안 프롬프트를 복사하거나 "즉시" 버튼으로 새 명령 전송해 답한다. `agentId` 가 1차 렌더 필터 키.
 */
export interface AgentQuestions {
  /** 신고 고유 ID (서버가 발급). */
  id: string;
  /** 신고한 (부모) 에이전트 ID — Vibisual 관할 custom agent. 렌더 필터 1차 키. */
  agentId: string;
  /** 호출 sub 인스턴스(IDE 세션 탭) ID. 있으면 그 탭에 귀속, 없으면(undefined) 메인 탭. */
  subAgentId?: string;
  /** 질문 항목들 (1~N). */
  items: AgentQuestionItem[];
  /** 자유 메모 / 전체 맥락 한 줄 (선택). */
  note?: string;
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/**
 * §4 v2.70 — 에이전트 검수 요청 (커스텀/스폰 에이전트 전용).
 *
 * 작업 신고(AgentReport)·질문 카드(AgentQuestions)와 동일 골격이지만 **성격이 다르다**:
 * 사용자가 **지시한 작업**(특히 버그 수정·기능 변경)을 AI 가 **완료**한 뒤, 사용자가 직접 해야 할 일
 * (`AgentReport.userActions`)이 아니라 **그 결과가 맞는지 확인(검수)**할 것을 요청하는 카드.
 * 즉 "이 버튼 오류 고쳐라" → 고침 → "무슨 동작을 이렇게 고쳤습니다, 검수해 주세요" 흐름.
 * 에이전트가 작업 끝에 loopback `POST /api/agent-review` 로 구조화 신고(토큰 인증). `agentId` 가 1차 렌더 필터 키.
 */
export interface AgentReview {
  /** 신고 고유 ID (서버가 발급). */
  id: string;
  /** 신고한 (부모) 에이전트 ID — Vibisual 관할 custom agent. 렌더 필터 1차 키. */
  agentId: string;
  /** 호출 sub 인스턴스(IDE 세션 탭) ID. 있으면 그 탭에 귀속, 없으면(undefined) 메인 탭. */
  subAgentId?: string;
  /** 받은 지시 한 줄 맥락 (선택) — "이 버튼 클릭 시 X 오류 고쳐라" 같은 어떤 작업이었는지. */
  instruction?: string;
  /** 무슨 동작을 어떻게 고쳤는지 (1~N). AI 가 완료한 변경 내역. */
  changes: string[];
  /** 사용자가 확인할 검수 포인트·방법 (0~N). "이렇게 눌러보면 됩니다" 류 검증 안내. */
  checkpoints: string[];
  /** 자유 메모 / 전체 맥락 한 줄 (선택). */
  note?: string;
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/**
 * §4 v2.84 — 에이전트 번호 목록 정렬 카드 (커스텀/스폰 에이전트 전용).
 *
 * 에이전트가 답변에 담는 **여러 항목의 번호/순서 목록**(나열·체크리스트·단계 목록)을 본문 텍스트로
 * 길게 나열하는 대신 구조화 배열로 보내, IDE 가 번호를 자동으로 매겨 **가지런히 정렬된 카드**로 렌더.
 * 작업 신고(AgentReport)·질문(AgentQuestions)·검수(AgentReview)와 동일 골격 — 에이전트가
 * loopback `POST /api/agent-list` 로 신고(토큰 인증). 번호 매김은 IDE 가 하므로 항목 텍스트만 보낸다.
 * `agentId` 가 1차 렌더 필터 키.
 */
export interface AgentList {
  /** 신고 고유 ID (서버가 발급). */
  id: string;
  /** 신고한 (부모) 에이전트 ID — Vibisual 관할 custom agent. 렌더 필터 1차 키. */
  agentId: string;
  /** 호출 sub 인스턴스(IDE 세션 탭) ID. 있으면 그 탭에 귀속, 없으면(undefined) 메인 탭. */
  subAgentId?: string;
  /** 목록 제목 / 머리말 (선택). */
  title?: string;
  /** 번호 목록 항목들 (1~N). 번호는 IDE 가 1..N 으로 자동 매김 — 에이전트는 항목 텍스트만 보낸다. */
  items: string[];
  /** 자유 메모 / 맥락 한 줄 (선택). */
  note?: string;
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

export interface GraphSnapshot {
  /** hydrated 프로젝트 목록 (projectName → ProjectInfo). keys와 stubProjects keys는 겹치지 않음 */
  projects: Record<string, ProjectInfo>;
  /** boot 시 stub 상태인 프로젝트 메타 (projectName → ProjectMetaSnapshot). hydrate 완료 시 projects로 이동 */
  stubProjects?: Record<string, ProjectMetaSnapshot>;
  /** 앱 전역 탭 라이프사이클 상태 (openProjects / lastActive / default / pinned). 서버가 authoritative. */
  appState?: AppState;
  agents: BubbleData[];
  topFolders: BubbleData[];
  children: Record<string, BubbleData[]>;
  edges: ActivityEdge[];
  innerEdges: Record<string, ActivityEdge[]>;
  /** 모든 폴더의 위성 파일 (folder ID → 해당 폴더 하위 최근 작업 파일들) */
  satellites: Record<string, BubbleData[]>;
  /** Bash 버블별 명령 히스토리 (bash bubble ID → 최신순 엔트리) */
  bashHistory: Record<string, BashEntry[]>;
  /** Bash 버블별 서버 목록 (bash bubble ID → 서버) */
  runningServers: Record<string, ServerEntry[]>;
  /** 에이전트별 활동 기록 (agent ID → 최근 이벤트, 최신순) */
  agentEvents: Record<string, AgentEvent[]>;
  /** 에이전트 → 프로젝트 이름 매핑 (agent ID → project basename) */
  agentProjects: Record<string, string>;
  /** 노드 → 프로젝트 이름 매핑 (node ID → project basename) */
  nodeProjects: Record<string, string>;
  /** 파일별 수정 기록 (file node ID → 최신순 FileEdit[]) */
  fileEdits: Record<string, FileEdit[]>;
  /** 에이전트별 명령 대기열 (agent ID → queued/executing만, 서버가 관리) */
  commandQueues: Record<string, QueuedCommand[]>;
  /** 에이전트별 완료/에러 명령 아카이브 (agent ID → completed/error, Results 표시용) */
  completedCommands: Record<string, QueuedCommand[]>;
  /** 에이전트별 subagent 목록 (agent ID → SubAgent[]) */
  subAgents: Record<string, SubAgent[]>;
  /** 에이전트 전체 페이즈 (서버 계산) */
  agentPhase: AgentPhase;
  /** 현재 활성 에이전트 수 (서버 계산) */
  activeAgentCount: number;
  /** 위성 버블 저장 위치 (sat-{nodeId} → {x, y}) — 클라이언트 계산 → 서버 동기화 */
  satellitePositions: Record<string, { x: number; y: number }>;
  /** 파이프라인 부모 ID → 자식 에이전트 버블 목록 */
  pipelineChildren: Record<string, BubbleData[]>;
  /** 파이프라인 부모 ID → 파이프라인 상태 */
  pipelines: Record<string, PipelineState>;
  /** 에이전트별 설정 (agent ID → AgentConfig) — 디테일 패널 표시용 */
  agentConfigs: Record<string, AgentConfig>;
  /** 에이전트 간 작업 흐름 엣지 (TaskEdge ID → TaskEdge) */
  taskEdges: Record<string, TaskEdge>;
  /** 세션 감지 소스 (sessionId → SessionSource). 버블 뱃지 렌더링용. */
  sessionSources: Record<string, SessionSource>;
  /** 세션 생명 상태 (sessionId → SessionLifeStatus). idle 스타일링용. */
  sessionStatuses: Record<string, SessionLifeStatus>;
  /** worktree 버블 ID → 해당 worktree 프로젝트 이름. 드릴다운 시 에이전트 소속 필터 전환용. */
  worktreeProjects?: Record<string, string>;
  /** 프로젝트 이름 → git dirty 여부 (staged+modified+untracked > 0). root 버블 dirty dot 표시용. 서버 런타임 캐시 기반, 미조회 프로젝트는 미포함. */
  gitDirty?: Record<string, boolean>;
  /** 현재 UI 표시 언어 (서버 SSOT). 클라이언트는 이 값으로 i18n.changeLanguage() 호출 */
  uiLocale?: UiLocale;
  /**
   * 언리얼 블프 스타일 Comment Box 목록.
   * 메인 캔버스에만 렌더. Task Edge 처럼 Manager 레벨에서 프로젝트 스코프로 필터.
   * 클라이언트는 `projectName === activeProject` 로 걸러 렌더.
   */
  commentBoxes?: CommentBox[];
  /**
   * 프로젝트별 루트 캔버스 바운딩 박스 반쪽 폭/높이 (LAYOUT_CENTER_X/Y 중심).
   * 키 = projectName. 미설정 항목은 클라이언트 기본값 사용.
   */
  layoutBoundsByProject?: Record<string, { hw: number; hh: number }>;
  /**
   * §5.3 #28 v1.47 — 콘티 데이터 (contiId → Conti). 미설정 시 빈 맵.
   * 클라이언트는 활성 에이전트 또는 활성 conti 선택에 따라 필터해서 패널 렌더.
   */
  contis?: Record<string, Conti>;

  /**
   * §5.3 #28 (L) v1.58 — 콘티 인플라이트 작업 추적 (agentId → ActiveContiWork).
   * 트리거 측에서 workId 발급 후 LLM 응답이 들어오기 전 in-flight 상태 노출용.
   * 응답 처리 후에도 같은 workId 의 후속 수정을 받기 위해 항목은 남는다.
   * 영속화 ❌ — 서버 재기동 시 자연 비움.
   */
  activeContiWork?: Record<string, ActiveContiWork>;

  /** §4 v1.50 — 에이전트(session)별 최근 도구 실행 시간 ring buffer (최대 5건). */
  recentToolDurations?: Record<string, ToolDurationEntry[]>;
  /** §4 v1.50 — 에이전트(session)별 컨텍스트 컴팩션 누적 카운트 + 마지막 시각. */
  compactCounts?: Record<string, CompactCount>;
  /** §4 v1.50 — Claude.ai 한도 사용률 (글로벌 1건, 외부 statusline 스크립트가 푸시). */
  rateLimits?: RateLimitInfo;

  /** §4 v1.98 — 진단 에러 로그 (글로벌 ring buffer, 최신순). 영속화 ❌ — 런타임 캐시. */
  diagnosticLog?: DiagnosticEntry[];

  /**
   * §5.5 #17-4 v2.36 — 프로젝트별 스킬 사용 카운트 (projectName → skillName → count).
   * 같은 스킬명이 여러 프로젝트에서 충돌하지 않도록 projectName 으로 1차 키.
   * `POST /api/commands/:sessionId` 가 명령 텍스트 줄머리 `/skill-name` 매칭마다 증분.
   * SkillsView 가 `agentProjects[agentId]` 로 프로젝트 키 조회 후 정렬·배지에 사용.
   */
  skillUsageCounts?: Record<string, Record<string, number>>;

  /**
   * §5.3 #10-2 v2.37 — Auto Agent 가 spawn 한 커스텀 에이전트 군의 메타.
   * key = auto-agent 의 sessionId (예: `auto-...`).
   * 클라가 auto-agent 버블의 진행 상태/요약 슬롯 렌더에 사용.
   * 미설정 시 빈 맵.
   */
  autoAgentSummaries?: Record<string, AutoAgentSummary>;

  /**
   * §4 v2.38 — 동적 모델 레지스트리. 서버가 부팅 시 시드 + `/v1/models` 머지로 빌드.
   * 클라 AgentConfigPopup 의 버전 sub-드롭다운 데이터 소스. 미설정 시 클라는 시드로 자체 폴백.
   */
  modelRegistry?: ModelRegistry;
  /**
   * §4 v2.42 — 사용자 글로벌 옵션(Options 창). 미설정 시 클라는 빈 객체로 처리.
   * 신규 에이전트 spawn 시 서버가 `agentConfig` 머지에 사용.
   */
  userDefaults?: UserDefaults;

  /**
   * §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[], 최신순 append).
   * 커스텀/스폰 에이전트가 `POST /api/agent-report` 로 보낸 did/userActions 구조화 신고.
   * 클라 IDE 가 agentId/subAgentId 로 필터해 색 구분 카드로 렌더. 미설정 시 빈 맵.
   */
  agentReports?: Record<string, AgentReport[]>;

  /**
   * §4 v2.60 — 에이전트 질문 카드 (agentId → AgentQuestions[], 최신순 append).
   * 커스텀/스폰 에이전트가 `POST /api/agent-questions` 로 보낸 질문 + 제안 프롬프트.
   * 클라 IDE 가 agentId/subAgentId 로 필터해 질문 카드로 렌더. 미설정 시 빈 맵.
   */
  agentQuestions?: Record<string, AgentQuestions[]>;

  /**
   * §4 v2.70 — 에이전트 검수 요청 카드 (agentId → AgentReview[], 최신순 append).
   * 커스텀/스폰 에이전트가 `POST /api/agent-review` 로 보낸 changes/checkpoints 검수 요청.
   * 클라 IDE 가 agentId/subAgentId 로 필터해 검수 카드로 렌더. 미설정 시 빈 맵.
   */
  agentReviews?: Record<string, AgentReview[]>;

  /**
   * §4 v2.84 — 에이전트 번호 목록 정렬 카드 (agentId → AgentList[], 최신순 append).
   * 커스텀/스폰 에이전트가 `POST /api/agent-list` 로 보낸 번호 목록. 미설정 시 빈 맵.
   */
  agentLists?: Record<string, AgentList[]>;
}

/** 폴더 내 파일/디렉토리 엔트리 (폴더 트리 표시용) */
export interface FolderFileEntry {
  /** 파일/폴더 이름 */
  name: string;
  /** 프로젝트 루트 기준 상대 경로 */
  relativePath: string;
  /** 디렉토리 여부 */
  isDirectory: boolean;
  /** 하위 엔트리 (디렉토리일 때만) */
  children?: FolderFileEntry[];
  /** 현재 위성으로 표시 중인지 */
  isSatellite: boolean;
}

/**
 * 프로젝트 정보 — 에이전트 cwd 기반으로 자동 등록, 어디서든 접근 가능.
 *
 * **식별 규칙 (v1.63):** `path`(정규화 시) 가 **유일 식별자(projectId)**. `name` 은 **표시용**이며
 * 같은 basename 다른 경로 프로젝트가 동시에 살아 있으면 등록 시점에 경로 파생 접두로 전역 유일화된다
 * (예: 두 "client" → "client" / "client (other)"). 따라서 `name` 으로 프로젝트를 식별/영속하지 말 것 —
 * 항상 `path`. snapshot/agentProjects 등 이름 키 맵은 이 유일화 덕에 충돌하지 않는다.
 */
export interface ProjectInfo {
  /** 표시 이름. 기본 `path.basename(cwd)`, basename 충돌 시 전역 유일화(비식별, 세션간 가변 가능). */
  name: string;
  /** 프로젝트 루트 절대 경로 = **projectId**. 원본 케이스 유지, forward slash. 식별·영속의 단일 키. */
  path: string;
  /** worktree인 경우 부모 프로젝트의 cwd(원본 케이스). TabBar 필터링 식별자. */
  parentProjectPath?: string;
  /** worktree 디렉토리 basename (예: "romantic-burnell") */
  worktreeName?: string;
}

/** Result 타입 — 에러 핸들링용 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── State Persistence (v2) ───

/** 엣지 직렬화 스냅샷 */
export interface EdgeSnapshot {
  edges: Record<string, ActivityEdge>;
  groups: Record<string, string>;
  refs: Record<string, string[]>;
}

/** 프로젝트 메타 (project.json) */
export interface ProjectMeta {
  project: ProjectInfo;
  createdAt: number;
  lastSavedAt: number;
}

/** 프로젝트 체크포인트 (checkpoint.json) — v2 전면 개편 */
export interface ProjectCheckpoint {
  version: 1;
  project: ProjectInfo;
  seq: number;
  savedAt: number;

  graph: {
    agentCounter: number;
    agents: Record<string, BubbleData>;
    nodes: Record<string, BubbleData>;
    projects: Record<string, ProjectInfo>;
    hierarchy: {
      topLevelPaths: string[];
      childrenMap: Record<string, string[]>;
      satelliteMap: Record<string, string[]>;
    };
    refs: {
      /** @deprecated — bash/iframe은 agent.persistSatellites로 이동. 하위호환용 optional. */
      agentSpecialPaths?: Record<string, string[]>;
      nodeAgentRefs: Record<string, string[]>;
      sessionCwds: Record<string, string>;
      /** 노드별 소속 프로젝트 루트 (node key → project root path) */
      nodeProjectRoots?: Record<string, string>;
    };
  };

  activity: {
    bashHistory: Record<string, BashEntry[]>;
    runningServers: Record<string, ServerEntry[]>;
    fileEdits: Record<string, FileEdit[]>;
  };

  edges: {
    main: EdgeSnapshot;
    inner: EdgeSnapshot;
  };

  /** subagent 상태 (agentId → SubAgent[]) */
  subAgents?: Record<string, SubAgent[]>;
  /** 아카이브된(탭 닫은) subagent — 폴더 버튼 "다시 열기" 목록 소스. parentAgentId → SubAgent[] */
  archivedSubAgents?: Record<string, SubAgent[]>;
  /** subagent 카운터 (라벨 생성 번호 유지) */
  subAgentCounter?: number;
  /** 사용자 지정 버블 라벨 (agentId → label) */
  customLabels?: Record<string, string>;
  /** 에이전트별 명령 대기열 (sessionId → QueuedCommand[]). 서버 재시작 시 복원 대상. */
  commandQueues?: Record<string, QueuedCommand[]>;
  /** 완료/에러 명령 아카이브 (sessionId → QueuedCommand[]). Results 표시용. */
  completedCommands?: Record<string, QueuedCommand[]>;
  /** 위성 버블 위치 (sat-{nodeId} → {x, y}). 클라이언트 계산 → 서버 동기화. */
  satellitePositions?: Record<string, { x: number; y: number }>;
  /** 탭 닫기로 숨긴 프로젝트 이름 목록 (데이터 보존, 스냅샷에서만 제외) */
  hiddenProjects?: string[];
  /** 파이프라인 상태 (parentId → PipelineState). optional로 하위호환 유지. */
  pipelines?: Record<string, PipelineState>;
  /** 에이전트별 설정 (agent ID → AgentConfig). 디테일 패널에서 편집, 서버 재시작 시 복원. */
  agentConfigs?: Record<string, AgentConfig>;
  /** §4 v1.50 — 에이전트별 컨텍스트 컴팩션 누적 카운트(영속). 도구 시간/한도는 런타임이라 영속 ❌. */
  compactCounts?: Record<string, CompactCount>;
  /** 에이전트(session)별 관측된 도구 목록 (session_id → tool names). 훅에서 자동 수집. */
  observedTools?: Record<string, string[]>;
  /** 사용자가 수동 편집한 에이전트 ID 목록. 수동 편집 시 자동 동기화 비활성화. */
  manuallyConfigured?: string[];
  /** 에이전트 간 작업 흐름 엣지 (TaskEdge ID → TaskEdge). optional로 하위호환 유지. */
  taskEdges?: Record<string, TaskEdge>;
  /**
   * 사용자가 Delete로 지운 iframe 버블의 (sessionId → ports[]) 기록.
   * 서버 재시작 후에도 rehydrate 시 재생성 방지. 새 Bash `run_in_background`가
   * 같은 포트로 들어오면 자동 해제된다.
   */
  dismissedIframes?: Record<string, number[]>;
  /**
   * v1.6 SCENARIO §5.7 #24: VSCode 창 닫힘 등으로 lifecycle.onDead에서 제거된 에이전트 스냅샷.
   * 같은 cwd로 SessionStart 훅이 들어오면 `restoreDormantForCwd`로 재삽입된다.
   * 서버 재시작을 가로질러 살아남아야 하므로 체크포인트에 영속화.
   */
  dormantAgents?: Record<
    string,
    { agent: BubbleData; cwd: string; pid: number; removedAt: number }
  >;
  /** UI 표시 언어 (서버 SSOT). optional — 구버전 체크포인트 하위호환. 미설정 시 DEFAULT_UI_LOCALE 적용 */
  uiLocale?: UiLocale;
  /**
   * 언리얼 블프 스타일 Comment Box 목록 (이 프로젝트 스코프). v1.45.
   * optional — 구버전 체크포인트 하위호환. 미설정이면 빈 배열로 복원.
   */
  commentBoxes?: CommentBox[];
  /**
   * 루트 캔버스에서 부모 버블이 못 빠져나가는 사각 바운딩 박스의 반쪽 폭/높이.
   * LAYOUT_CENTER_X/Y 중심 기준. 사용자가 캔버스에서 핸들로 조절. optional — 미설정 시
   * 클라이언트 기본값(1500/1100) 사용. §3.2 예외 없이 ProjectCheckpoint 만 통한 영속화.
   */
  layoutBoundsHalfWidth?: number;
  layoutBoundsHalfHeight?: number;
  /**
   * §5.3 #28 v1.47 — 콘티 데이터 (contiId → Conti) 영속화.
   * 에이전트 삭제 시 cascade. 빈 맵이거나 미설정 시 모두 유효.
   */
  contis?: Record<string, Conti>;

  /**
   * §5.5 #17-4 v2.36 — 프로젝트별 스킬 사용 카운트 (skillName → count).
   * 명령 텍스트 줄머리 `/skill-name` 매칭 시 증분. SkillsView 정렬·배지에 사용.
   * optional — 구버전 체크포인트 하위호환. 미설정이면 빈 맵으로 복원.
   */
  skillUsageCounts?: Record<string, number>;

  /**
   * §5.3 #10-2 v2.37 — Auto Agent 가 spawn 한 커스텀 에이전트 군의 요약 메타.
   * key = auto-agent sessionId. optional — 구버전 체크포인트 하위 호환.
   * 미설정이면 빈 맵으로 복원. 영속 대상(사용자 산출물 트레이스).
   */
  autoAgentSummaries?: Record<string, AutoAgentSummary>;

  /**
   * §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * 완료 신고는 세션을 넘어 의미 있는 산출물 트레이스라 영속 대상.
   */
  agentReports?: Record<string, AgentReport[]>;

  /**
   * §4 v2.60 — 에이전트 질문 카드 (agentId → AgentQuestions[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   */
  agentQuestions?: Record<string, AgentQuestions[]>;

  /**
   * §4 v2.70 — 에이전트 검수 요청 카드 (agentId → AgentReview[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * 검수 요청은 세션을 넘어 의미 있는 산출물 트레이스라 영속 대상.
   */
  agentReviews?: Record<string, AgentReview[]>;

  /**
   * §4 v2.84 — 에이전트 번호 목록 정렬 카드 (agentId → AgentList[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   */
  agentLists?: Record<string, AgentList[]>;

  /**
   * §3.2.1-3 v2.63 — 명시적으로 삭제된 커스텀 에이전트 sessionId 묘비.
   * identity.json 의 `deletedSessionIds` 와 같은 의미·소스. checkpoint 에도 실어
   * deriveIdentity 가 단일 소스에서 파생할 수 있게 한다(필터·왕복 일관성).
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 배열.
   */
  deletedCustomAgentIds?: string[];
}

/**
 * §3.2.2 v2.62 — 정체성/휘발성 물리 분리.
 * `identity.json` 으로 저빈도·고신뢰 저장되는 **잃으면 안 되는 정체성 데이터**.
 *
 * 휘발성 런타임 상태(status·lastActivity·노드·엣지 스냅샷·런타임 큐)는 여기 ❌ —
 * 그건 고빈도 `checkpoint.json` 에만 산다. 복원 순서: checkpoint 전체 복원 →
 * identity 로 누락 정체성 **보충**(이미 있으면 덮어쓰지 않음, 없으면 부활).
 *
 * checkpoint 가 비거나 깨져도 커스텀 에이전트는 identity 에서 되살아난다.
 * identity.json 이 없으면(구버전) 기존 단일 파일 동작 그대로(완전 하위호환).
 */
export interface ProjectIdentity {
  /** 전방 호환 — 미래 구조 변경 대비. 현재 1. 로드 시 `>= 1` 이면 수용. */
  version: number;
  project: ProjectInfo;
  /** 저장 시각 (epoch ms). */
  savedAt: number;
  /** 라벨 생성 번호 유지 (checkpoint.graph.agentCounter 와 최대값 동기). */
  agentCounter: number;
  /**
   * 사용자가 만든 커스텀 에이전트(+Auto Agent·파이프라인 합성 포함, `customCreated=true`)의
   * 정체성 버블. sessionId → BubbleData. 런타임 상태 필드는 복원 시 정규화되지만,
   * id/label/sessionId/생성·position 같은 정체성은 여기서 권위를 갖는다.
   */
  customAgents: Record<string, BubbleData>;
  /** 에이전트별 설정 (agent id → AgentConfig). */
  agentConfigs: Record<string, AgentConfig>;
  /** 사용자 지정 라벨 (agent id → label). */
  customLabels: Record<string, string>;
  /** 커스텀 에이전트 세션의 소속 cwd (sessionId → cwd). 저장 필터·재개의 근거. */
  sessionCwds: Record<string, string>;
  /** 에이전트 간 작업 흐름 엣지 (TaskEdge id → TaskEdge). */
  taskEdges: Record<string, TaskEdge>;
  /** Comment Box 목록 (이 프로젝트 스코프). */
  commentBoxes: CommentBox[];
  /** 콘티 데이터 (contiId → Conti). */
  contis: Record<string, Conti>;
  /**
   * §3.2.1-3 v2.63 — 사용자가 **명시적으로 삭제**한 커스텀 에이전트의 sessionId 묘비.
   * shrink guard 가 "정상 삭제(여기 기록됨)"와 "복원 실패(미기록 소멸)"를 구분하는 신호.
   * 부활(mergeIdentityIntoCheckpoint) 시 이 집합의 sessionId 는 되살리지 않는다 → 유령 부활 차단.
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 배열로 취급.
   */
  deletedSessionIds?: string[];
}

/**
 * §3.2.2 — 소실/삭제 후 **복구 가능한 커스텀 에이전트** 항목(표시용 메타).
 * identity.json 에 정체성은 남아 있으나 현재 캔버스에 살아있지 않은(사라졌거나 닫힌) 커스텀
 * 에이전트를 "지난 커스텀 에이전트 복구" UI 에 나열하기 위한 것. 복구 시 `sessionId` 로 원본 정체성을
 * 되살려 config·라벨·과거 스트림이 그대로 재연결된다. 사용자가 명시 삭제(묘비)한 것은 제외한다.
 */
export interface RecoverableCustomAgent {
  /** 원본 세션 ID — 복구 키(그대로 되살려 정체성 재연결). */
  sessionId: string;
  /** 버블 노드 ID(agent-<hash>). */
  agentId: string;
  /** 표시 라벨(customLabels 우선, 없으면 버블 label). */
  label: string;
  /** 소속 프로젝트 표시명. */
  projectName: string;
  /** 버블 색(config.color 가 있으면). */
  color?: string;
  /** 실행 모드(CMD 에이전트 구분용). */
  executionMode?: ExecutionMode;
  /** identity.json 저장 시각(최신순 정렬용, epoch ms). */
  savedAt: number;
}

// ─── Token Usage ───

/** 턴별 토큰 사용량 (JSONL assistant entry의 usage에서 추출) */
export interface TurnTokenUsage {
  turnIndex: number;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** 총 컨텍스트 = input + cacheRead + cacheCreate */
  totalContext: number;
  model?: string;
  /** 이 턴에서 사용한 도구 이름 목록 */
  tools: string[];
}

/** 토큰 카테고리 추정치 — [Estimate] 라벨 표시용 */
export interface TokenCategoryEstimate {
  /** 카테고리 식별 키 */
  key: string;
  /** 표시 라벨 (예: "CLAUDE.md", "System Prompt") */
  label: string;
  /** 추정 토큰 수 */
  estimatedTokens: number;
  /** 전체 대비 퍼센트 (0-100) */
  percentage: number;
  /** 상세 내역 (예: "Read: 42, Bash: 15, +3 more") */
  detail?: string;
}

// ─── User Defaults (§4 v2.42) ───

/**
 * §4 v2.42 — 사용자 글로벌 옵션/디폴트.
 *
 * File 메뉴 → Options 창에서 편집. `~/.vibisual/user-defaults.json` 글로벌 1건(프로젝트 무관).
 * 신규 커스텀 에이전트 생성 시 `agentConfig` 가 `DEFAULT_AGENT_CONFIG` 위에 덮어쓰이는 프리셋 역할.
 * 기존 에이전트엔 영향 ❌ — 신규 spawn 시점에만 적용.
 *
 * 카테고리:
 * - agentConfig — Agent Defaults 탭(1차 구현). Partial<AgentConfig> 라 undefined 필드는 DEFAULT 유지.
 * - appearance — Appearance 탭(uiLocale 만 1차, 나머지 추후).
 * - notifications / permissions / advanced — placeholder 슬롯(1차는 빈 객체).
 */
export interface UserDefaults {
  /** §4 v2.42 — 신규 에이전트 기본 설정. Partial — 미설정 필드는 `DEFAULT_AGENT_CONFIG` 사용. */
  agentConfig?: Partial<AgentConfig>;
  /** §4 v2.42 — 외관. 1차는 uiLocale 만. */
  appearance?: {
    uiLocale?: UiLocale;
  };
  /** §4 v2.42 — 알림. 1차 placeholder. */
  notifications?: Record<string, unknown>;
  /** §4 v2.42 — 권한 승인 UX. 1차 placeholder. */
  permissions?: Record<string, unknown>;
  /** §4 v2.42 — 고급(API 키·bin 경로·debug). 1차 placeholder. */
  advanced?: Record<string, unknown>;
  /**
   * §4 v2.43 — 옵션창 Version 탭에서 사용자가 선택한 `claude` 바이너리 절대 경로(override).
   * 미설정/빈 문자열 = 자동 탐색(`resolveClaudeBin` 기본 우선순위). 설정 시 `resolveClaudeBin` 이
   * 최우선 반환(파일 존재 검증 후). `subAgentManager` 가 모듈 로드 시 1회 캡처하므로 변경은 다음 실행에 적용.
   */
  claudeBinPath?: string;
  /** §4 v2.42 — 마지막 갱신 시각 (ms). PUT 응답·broadcast 디버그용. */
  updatedAt: number;
}

// ─── Model Registry (§4 v2.38) ───

/**
 * 모델 패밀리 alias — UI 드롭다운 + `--model` CLI alias.
 *
 * §4 v2.77 — `opus/sonnet/haiku` 는 디폴트 가격·컨텍스트 테이블(`MODEL_FAMILY_DEFAULTS`)을 가진
 * **알려진 패밀리**. 신규 패밀리(fable/mythos 등)도 동적으로 수용하도록 string 으로 확장한다 —
 * 미지 패밀리는 패밀리 디폴트가 없어 `DEFAULT_PRICING`/`DEFAULT_CONTEXT_LIMIT` 로 폴백.
 * `(string & {})` 트릭으로 임의 string 을 받되 에디터 자동완성은 known 3종을 계속 노출.
 */
export type KnownModelFamily = 'opus' | 'sonnet' | 'haiku';
export type ModelFamily = KnownModelFamily | (string & {});

/**
 * 단일 모델 풀ID 의 레지스트리 항목.
 *
 * source='seed' = constants.ts 의 시드 테이블에서 적재(오프라인 또는 부팅 시).
 * source='api' = `GET https://api.anthropic.com/v1/models` 응답에서 머지.
 * 같은 id 가 양쪽에 있으면 api 가 displayName/createdAt 등 추가 필드를 덮어쓰되,
 * 시드 측 pricing/contextWindow 가 정의돼 있으면 보존(가격은 API 미제공).
 */
export interface ModelRegistryEntry {
  /** Anthropic 풀 모델 ID (예: `claude-opus-4-8`). */
  id: string;
  /** 패밀리 — id prefix 로 추론(`claude-<family>-`, §4 v2.77 임의 패밀리 수용). */
  family: ModelFamily;
  /** 사람이 읽는 라벨 (예: "Claude Opus 4.8"). 없으면 UI 가 id 표시. */
  displayName?: string;
  /** 출시일 (ms). 패밀리 내 latest 선정 기준. 없으면 seed 기준 정렬 후순위. */
  createdAt?: number;
  /** 컨텍스트 한도 (토큰). 미정의 시 `MODEL_FAMILY_DEFAULTS[family].contextWindow` 폴백. */
  contextWindow?: number;
  /** 가격 (per 1M tokens). 미정의 시 `MODEL_FAMILY_DEFAULTS[family].pricing` 폴백. */
  pricing?: ModelPricing;
  /** 패밀리 내 latest 인지 — `resolveAliasToLatest` 가 부팅 시 1회 셋. */
  isLatestOfFamily?: boolean;
  /**
   * 출처:
   * - 'cli-scan' = Claude Code CLI 바이너리에서 raw scan 으로 발견 (§4 v2.41 — 주 소스, 0 하드코딩).
   * - 'api' = `/v1/models` API 응답 머지(키 있을 때).
   * - 'seed' = (deprecated) 정적 시드 — v2.40 에서 빈 배열로 격하.
   */
  source: 'seed' | 'cli-scan' | 'api';
}

/** 모델 가격표 (per 1M tokens, USD). */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * 서버가 부팅 시 빌드해 클라에 전달하는 전체 레지스트리.
 *
 * sourceMix:
 * - 'seed-only' = (legacy) v2.40 이후 시드 빈 배열이라 사실상 발생 안 함.
 * - 'cli-scan' = §4 v2.41 — Claude Code 바이너리 raw scan 만. API 키 없을 때 표준 경로.
 * - 'cli-scan+api' = CLI scan + `/v1/models` 머지.
 * - 'api-merged' = (legacy v2.38) API 만. 현재는 cli-scan 항상 우선 시도.
 *
 * 클라 AgentConfigPopup 버전 sub-드롭다운의 데이터 소스. WS `model_registry_updated` 로 갱신.
 * 영속화 ❌ (서버 측 `.vibisual/model-registry.json` 캐시는 별개 — TTL 기반).
 */
export interface ModelRegistry {
  entries: ModelRegistryEntry[];
  updatedAt: number;
  sourceMix: 'seed-only' | 'cli-scan' | 'cli-scan+api' | 'api-merged';
}

/** 에이전트 설정 — 디테일 패널에서 편집, ProjectCheckpoint에 저장 */
export interface AgentConfig {
  /** 사용 모델 (예: "sonnet", "opus", "haiku") */
  model: string;
  /** 허용 도구 목록 (예: ["Read", "Write", "Edit", "Bash"]) */
  tools: string[];
  /**
   * 퍼미션 모드 (claude CLI `--permission-mode` 전달값: default/acceptEdits/plan/bypassPermissions).
   * §5.3 #12-1 v1.87 — 권한 승인의 **유일 축**. 서버 `/api/permission-check` 게이트가 이 값+도구타입으로
   * Vibisual 승인 팝업 발동을 결정(default=가변도구 확인 / bypassPermissions=무확인 / acceptEdits=편집자동 / plan=실행없음).
   */
  permissionMode: string;
  /**
   * §5.3 #12-1 v1.90 — 승인 팝업이 떴는데 **60초 무응답**일 때의 fallback.
   * `'allow'`(기본, undefined 취급)=자동 허용(자리 비워도 작업 계속) / `'deny'`=자동 차단(안전측).
   * 팝업 *발동 여부*엔 영향 ❌ (그건 `permissionMode` 전담). `permissionMode∈{bypassPermissions,plan}`
   * 이면 팝업이 안 떠 무의미 → AgentConfigPopup 에서 토글 숨김. `permissionMode` 와 직교 축.
   */
  permissionTimeoutPolicy?: 'allow' | 'deny';
  /** 기본 사용 스킬 목록 (예: ["vibisual-feature", "commit"]) */
  skills: string[];
  /** 버블 커스텀 색상 (hex, 예: "#3B82F6") — 미설정 시 기본 BUBBLE_STYLES.agent.color */
  color?: string;
  /** 최대 턴 수 — 에이전트 무한루프 방지 */
  maxTurns?: number;
  /** 격리 모드 — "worktree"이면 별도 git worktree에서 작업 */
  isolation?: string;
  /** 사고 깊이 — Opus 4.6 전용 (예: "high") */
  effort?: string;
  /** 차단 도구 목록 — 이 도구들은 사용 불가 (예: ["Write", "Edit"]) */
  disallowedTools?: string[];
  /** 메모리 모드 (예: "project") */
  memory?: string;
  /** 에이전트 개별 규칙 (마크다운). 실행 시 프롬프트에 주입 */
  rules?: string;
  /**
   * §5.3 #28 (K) v1.48 — Rules 변경 히스토리.
   * 저장 시 prev rules 가 비어있지 않고 실제 변경되었으면 push. 최대 `RULES_HISTORY_MAX` (FIFO).
   * label: 'auto:conti-on' = 콘티모드 진입으로 자동 덮어쓰기 직전, 'auto:conti-off' = 콘티 모드 해제 직전, 'manual' = 사용자 직접 편집.
   * 클라이언트는 절대 직접 수정 ❌ — 서버 PUT /api/agent-config/:id 단일 경로.
   */
  rulesHistory?: RulesHistoryEntry[];
  /**
   * §5.3 #28 v1.47 — Vibisual Custom Mode 축. permissionMode (CLI) 와 직교.
   * undefined = 비활성. 'conti' = 콘티모드(스토리보드). 'review'/'debug' = placeholder(저장만, 본체 미구현).
   */
  customMode?: ContiCustomMode;
  /**
   * §4 v1.53 — Opus 1M 컨텍스트 변형 토글.
   * **기본 = 1M** (undefined 또는 `'1m'` → 1M 적용). 명시적 200k opt-out 만 `'200k'` 로 저장.
   * Opus 패밀리일 때만 서버 `buildConfigArgs` 가 모델 alias 를 `claude-opus-4-7[1m]` 로 매핑해 CLI 에 전달.
   * Opus 외 모델에서는 어떤 값이든 무시(서버 pass-through 안 함).
   */
  contextWindow?: '1m' | '200k';
  /**
   * §4 v1.53 — 어떤 프리셋으로 초기화되었는지 트레이스 메타데이터. UI 가 "프리셋: explore" 식 배지 표시용.
   * 사용자가 이후 폼을 편집해도 자동 invalidate ❌ — 메타 추적만. undefined = 프리셋 미사용(수동 구성).
   */
  presetId?: string;
  /**
   * §4 v2.38 — 특정 모델 풀ID 핀(예: `'claude-opus-4-7'`).
   * undefined = alias 모드 = `model` alias 가 가리키는 **현재 latest** 풀ID 사용.
   * 정의 시 풀ID 가 우선 — 서버 buildConfigArgs 가 resolveAliasToLatest 건너뛰고 그대로 CLI 에 전달.
   * AgentConfigPopup 의 버전 sub-드롭다운이 이 값을 관리.
   */
  modelVersion?: string;
  /**
   * §4 v2.63 — 실행(스폰) 모드 축. `permissionMode`/`customMode` 와 **직교**.
   * undefined 또는 `'headless'` = 기존 동작(서버가 `claude -p` 헤드리스로 스폰, 프로그래매틱 과금).
   * `'interactive-terminal'` = 더블클릭 시 IDE 창 안에 임베디드 PTY 터미널을 띄워
   *   사용자가 직접 모는 인터랙티브 `claude` REPL 실행(구독 과금). 6/15 프로그래매틱 과금 분리 대응.
   * 위장 우회 ❌ — 사람이 루프 안에 있는 진짜 인터랙티브 세션 전용(Anthropic ToS 합법선).
   */
  executionMode?: ExecutionMode;
  /**
   * §4 v2.88 — API 비용 상한(달러). 헤드리스 `claude -p` 스폰에 `--max-budget-usd <n>` 로 전달돼
   * 해당 금액 초과 시 런이 중단된다(2026.06.15 Agent SDK 크레딧 풀 분리 대응 — 폭주 방어).
   * undefined 또는 0 = **무제한**(기존 동작 보존). 양수일 때만 상한 적용.
   * CLI 제약상 `--max-budget-usd` 는 `--print` 전용 → 설정 시 persistent 재사용/Agent View 를 끄고
   * 매 턴 fresh `--print` 스폰으로 보내 상한이 실제 적용되게 한다(서버 subAgentManager).
   * interactive-terminal(구독 과금) 경로에는 적용하지 않는다(프로그래매틱 과금이 아님).
   */
  maxBudgetUsd?: number;
}

/**
 * §4 v2.63 — 커스텀 에이전트 실행(스폰) 모드.
 * 'headless' = 기존 `claude -p` 백그라운드 스폰. 'interactive-terminal' = IDE 임베디드 PTY REPL.
 */
export type ExecutionMode = 'headless' | 'interactive-terminal';

// ─── Agent Preset (§4 v1.53) ───

/**
 * §4 v1.53 — 새 커스텀 에이전트 생성 시 빠르게 시작점 제공하는 프리셋.
 * 사용자가 AgentConfigPopup 상단 드롭다운에서 선택하면 폼이 즉시 채워진다(저장 전까지 dirty).
 * UI 만 — 서버에는 적용된 결과(AgentConfig) 만 저장되며, 트레이스용으로 `AgentConfig.presetId?` 메타만 남는다.
 */
export interface AgentPreset {
  /** 프리셋 식별자 (예: 'explore', 'plan', 'code-reviewer', 'general-purpose'). i18n 키로도 사용. */
  id: string;
  /** 프리셋 적용 시 채워지는 AgentConfig 일부 (사용자가 이후 자유 편집). */
  config: Partial<Pick<
    AgentConfig,
    | 'model'
    | 'tools'
    | 'permissionMode'
    | 'effort'
    | 'rules'
    | 'maxTurns'
    | 'isolation'
    | 'disallowedTools'
  >>;
}

// ─── Conti Mode (§5.3 #28 v1.47) ───

/** 커스텀 에이전트의 Vibisual Custom Mode 값. undefined=비활성. 'conti' 만 본 라운드에서 동작. */
export type ContiCustomMode = 'conti' | 'review' | 'debug';

/** §5.3 #28 (K) v1.48 — Rules 변경 히스토리 1건. */
export interface RulesHistoryEntry {
  /** 변경 시각 (ms) */
  ts: number;
  /** 이 항목 시점의 rules 본문 (덮어쓰기 직전 값) */
  rules: string;
  /** 변경 사유 라벨 — 자동 분류, 사용자 편집 ❌ */
  label: 'auto:conti-on' | 'auto:conti-off' | 'manual';
}

/**
 * 콘티 element 의 형태. SVG 직렬화 ❌ — 정형 JSON 으로 patch 정확도/diff 안전성 확보.
 *
 * §5.3 #28 v1.60 — `'stamp'` 추가. LLM 이 좌표를 처음부터 계산하지 않고 미리 정의된
 * 컴포넌트(STAMP_CATALOG)를 이름으로 지정하도록 강제 → 가독성/일관성 확보.
 * 기존 4종(rect/circle/text/line)은 stamp 로 표현 안 되는 잔여 도형/주석용으로만.
 */
export type ContiElementType = 'rect' | 'circle' | 'text' | 'line' | 'stamp';

/** 콘티 frame 한 칸의 wire 안에 들어가는 단일 도형/텍스트/라인 element. */
export interface ContiElement {
  /** "el-<ts>-<rand>" */
  id: string;
  type: ContiElementType;
  /** viewBox 320×180 기준 좌표 (stamp 는 좌상단) */
  x: number;
  y: number;
  /** rect/stamp: 폭, circle: 반지름, line: 끝점 dx (선택) */
  w?: number;
  /** rect/stamp: 높이, line: 끝점 dy (선택) */
  h?: number;
  /** text 본문 또는 도형 라벨 (stamp 는 안에 들어갈 1-2단어 짧은 캡션) */
  label?: string;
  /** stroke 색 (hex 또는 CSS color). 미설정 시 컴포넌트 기본 */
  stroke?: string;
  /** fill 색. 'none' 가능 */
  fill?: string;
  /** SVG stroke-width */
  strokeWidth?: number;
  /** SVG stroke-dasharray */
  dash?: string;
  /** text 폰트 크기 (text 한정) */
  fontSize?: number;
  /**
   * §5.3 #28 v1.60 — `type==='stamp'` 일 때 필수. STAMP_CATALOG 의 키 중 하나.
   * 카탈로그에 없는 이름은 서버 coerce 단계에서 reject (해당 element 통째로 drop).
   */
  stampName?: string;
  /**
   * §5.3 #28 v1.60 — stamp 의 상태/방향 variant. STAMP_CATALOG[name].variants 에 있는 키만 허용.
   * 미지정 시 stamp 의 기본 모양. 예: button-primary 의 'active'/'disabled', arrow 의 'right'/'down'.
   */
  stampVariant?: string;
}

/** 콘티 한 frame 의 한 컷. */
export interface ContiFrame {
  /** "frame-<ts>-<rand>" */
  id: string;
  /** 한 줄 frame 제목 (예: "FRAME 1: Custom Agent 단일 클릭") */
  title: string;
  /** frame 의 한 줄 행동 설명 */
  action: string;
  /** wire 안의 element 들 */
  elements: ContiElement[];
  /** 변경 배지 */
  badges?: ContiBadge[];
}

/** 콘티 frame 의 변경 배지 (test3.html `add`/`mod`/`evt` 미러). */
export interface ContiBadge {
  kind: 'add' | 'mod' | 'evt';
  text: string;
}

/** 콘티 1건 — 에이전트 1명에게 0~N건 누적, 같은 agentId 안에서 createdAt 으로 정렬. */
export interface Conti {
  /** "conti-<ts>-<rand>" */
  id: string;
  /** 소유 에이전트 ID */
  agentId: string;
  /** 생성 시각 (ms) */
  createdAt: number;
  /**
   * §5.3 #28 (L) v1.58 — 작업 ID. 같은 work 의 후속 응답은 같은 workId 로 들어와
   * 서버가 신규/수정을 분별. 트리거 측(`POST /api/conti/generate`, task edge dispatch,
   * agent_session fallback) 에서 발급. 빈 문자열 허용(이전 체크포인트 호환).
   */
  workId: string;
  /**
   * §5.3 #28 (L) v1.58 — 마지막 수정 시각. 신규 생성 직후엔 createdAt 과 동일.
   * 같은 workId 로 후속 응답이 들어와 frames 가 교체되면 갱신.
   */
  updatedAt: number;
  /** 짧은 제목 (LLM 생성) */
  title?: string;
  /** frame 배열 (1~16, 표준 5~8) */
  frames: ContiFrame[];
}

/**
 * §5.3 #28 (L) v1.58 — 콘티 작업 발급 출처.
 * - `user_new`: `POST /api/conti/generate` ("새 콘티 생성" 버튼)
 * - `task_edge`: Task Edge 가 conti-mode 에이전트로 dispatch
 * - `agent_session`: 외부 트리거 없이 에이전트 세션에서 LLM 자체 발화
 */
export type ContiWorkSource = 'user_new' | 'task_edge' | 'agent_session';

/**
 * §5.3 #28 (L) v1.58 — 콘티 인플라이트 작업 추적. agentId 당 0~1건.
 * 첫 응답이 들어와 Conti 가 만들어지면 `contiId` 가 채워지고,
 * 같은 workId 의 후속 응답은 그 contiId 를 갱신(수정 케이스)한다.
 * 영속화 ❌ — 서버 재기동 시 자연 비움.
 */
export interface ActiveContiWork {
  /** "work-<ts>-<rand>" */
  workId: string;
  source: ContiWorkSource;
  /** 발급 시각 (ms) */
  startedAt: number;
  /** 첫 응답으로 Conti 가 만들어진 뒤 채움. undefined 면 아직 첫 응답 전. */
  contiId?: string;
}

/** SubAgent 실시간 스트림 이벤트 — 서버가 stream-json을 파싱하여 WS로 전송 */
export type StreamEventType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'system' | 'error' | 'result';

export interface SubAgentStreamEvent {
  /** 이벤트 ID (중복 방지) */
  id: string;
  /** 소속 SubAgent ID */
  subAgentId: string;
  /** 부모 에이전트 ID */
  parentAgentId: string;
  timestamp: number;
  /** 이벤트 종류 */
  eventType: StreamEventType;
  /** 표시할 텍스트 */
  content: string;
  /** 도구 이름 (tool_use / tool_result만) */
  toolName?: string;
  /**
   * Anthropic API의 tool_use_id — tool_use와 tool_result를 정확히 페어링하는 키.
   * - tool_use 이벤트: 해당 도구 호출의 id
   * - tool_result 이벤트: 참조하는 tool_use_id
   * 과거 버퍼(서버 재시작 전) 이벤트는 이 필드가 없을 수 있으므로 선택적.
   * 클라이언트는 존재 시 ID 페어링, 부재 시 FIFO 페어링으로 폴백.
   */
  toolUseId?: string;
}

// ─── Canvas Clipboard (§5.4 #29 v1.51) ───
// Vibisual 내부 클립보드 페이로드. localStorage 단일 슬롯 + POST /api/canvas/paste 로
// 다른 프로젝트 캔버스에 붙여넣기. 시스템 클립보드(navigator.clipboard) 와 분리.

/** 클립보드에 담기는 단일 커스텀 에이전트 항목. 세션·대화·rulesHistory 는 strip. */
export interface CanvasClipboardAgentEntry {
  /** 원본 BubbleData.id — paste 후 idMap 으로 새 ID 와 매핑 */
  oldId: string;
  /** 라벨(에이전트 이름) — paste 시 충돌하면 서버 uniqueLabel 이 자동 접미사 부여 */
  label: string;
  /** anchor 기준 상대 좌표 (anchor = 페이로드 셋의 minX/minY) */
  relPosition: { x: number; y: number };
  /** AgentConfig 전부 — rulesHistory 는 strip 후 담는다(다른 프로젝트로 누적 금지) */
  config: Omit<AgentConfig, 'rulesHistory'>;
}

/** 클립보드에 담기는 Task Edge 항목. status/lastResult/errorMessage/bundleId/bundleRole/createdAt 등 런타임은 strip. */
export interface CanvasClipboardTaskEdgeEntry {
  /** 원본 sourceAgentId */
  sourceOldId: string;
  /** 원본 targetAgentId */
  targetOldId: string;
  command: string;
  forwardMode: TaskEdgeForwardMode;
  templateId: string | null;
  // v1.18 + v1.42 + v1.44 모든 옵션 그대로 옮김
  kind?: TaskEdgeKind;
  messageFormat?: TaskEdgeMessageFormat;
  messageSchema?: string;
  returnFormat?: TaskEdgeReturnFormat;
  timeoutMs?: number;
  retryCount?: number;
  cacheEnabled?: boolean;
  priority?: TaskEdgePriority;
  delegationPolicy?: 'strict' | 'auto';
  critiqueTiming?: TaskEdgeCritiqueTiming;
  critiqueAuthority?: TaskEdgeCritiqueAuthority;
  maxReworkCount?: number;
  commandMode?: TaskEdgeCommandMode;
}

/** 클립보드에 담기는 Comment Box 항목. id/createdAt/updatedAt/projectName 은 strip. */
export interface CanvasClipboardCommentBoxEntry {
  /** anchor 기준 상대 좌상단 */
  relX: number;
  relY: number;
  width: number;
  height: number;
  text: string;
  color: string;
  textColor?: string;
  fontSize?: number;
  opacity?: number;
  /** 같은 페이로드 안의 노드 oldId 만 유효 — paste 시 매핑되지 않으면 drop */
  childOldIds: string[];
}

/** 클립보드 1슬롯 페이로드 — localStorage[CANVAS_CLIPBOARD_STORAGE_KEY]. */
export interface CanvasClipboardPayload {
  /** 직렬화 호환성 가드. 현재 1 — 호환되지 않는 페이로드는 paste 시 거부. */
  schemaVersion: 1;
  /** 복사 시각(ms) — 디버그/만료 정책용(현재 만료 ❌) */
  copiedAt: number;
  /** 출처 프로젝트(같은 프로젝트로 paste 도 허용 — 템플릿 복제) */
  origin: { projectName: string };
  /** 페이로드 셋 좌상단(원본 캔버스 좌표). relPosition 의 0점. */
  anchor: { x: number; y: number };
  agents: CanvasClipboardAgentEntry[];
  taskEdges: CanvasClipboardTaskEdgeEntry[];
  commentBoxes: CanvasClipboardCommentBoxEntry[];
}

/** POST /api/canvas/paste 응답 본문 — 클라가 새 ID 로 즉시 multi-select 등에 활용. */
export interface CanvasPasteResponse {
  ok: true;
  idMap: {
    /** oldAgentId -> newAgentId */
    agents: Record<string, string>;
    /** oldEdgeIndex(stringified) -> newEdgeId — 자매 artifact 엣지는 idMap 에 없음(서버 자동 생성) */
    edges: Record<string, string>;
    /** oldCommentBoxIndex(stringified) -> newCommentBoxId */
    commentBoxes: Record<string, string>;
  };
}

/** 붙여넣기로 저장된 이미지 메타데이터 */
export interface PastedImage {
  /** 고유 ID (예: "img-1712345678901-0") */
  id: string;
  /** 저장된 파일명 (예: "img-1712345678901-0.png") */
  filename: string;
  /** MIME 타입 (예: "image/png") */
  mimeType: string;
  /** 파일 크기 (bytes) */
  size: number;
  /** 접근 URL (예: "/api/images/img-1712345678901-0.png") */
  url: string;
  /** 저장 시각 (ms) */
  timestamp: number;
}

/** 세션 토큰 데이터 (API 응답) */
export interface SessionTokenData {
  sessionId: string;
  /** 전체 턴별 사용량 */
  turns: TurnTokenUsage[];
  /** 카테고리별 추정 분류 (최신 턴 기준, 내림차순) */
  categories: TokenCategoryEstimate[];
}

// ─── §5.3 #10-2 v2.37 — Auto Agent (메타 에이전트) ───

/**
 * Auto Agent 가 spawn 할 수 있는 커스텀 에이전트의 역할 카탈로그.
 * 새 역할 추가 시 유니온 한 줄 + `AUTO_AGENT_ROLE_POLICY` 한 줄.
 */
export type AutoAgentRole =
  | 'pm'
  | 'planner'
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'researcher'
  | 'doc-writer'
  | 'deep-interviewer'
  | 'oracle'
  | 'librarian'
  | 'explore';

/**
 * Auto Agent 가 선택할 수 있는 토폴로지 카탈로그.
 * pipeline=직선 체인, team=PM 허브+워커, ralph=team+critique 루프, autopilot=단일 슈퍼.
 */
export type AutoAgentTopology = 'pipeline' | 'team' | 'ralph' | 'autopilot' | 'custom';

/** 사용자 요청의 복잡도 휴리스틱 판정값 */
export type AutoAgentComplexity = 'low' | 'medium' | 'high';

/** Auto Agent 의 진행 상태 (UI 진행 표시용) */
export type AutoAgentPhase =
  | 'idle'
  | 'analyzing'
  | 'asking'
  | 'spawning'
  | 'building'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'error';

/**
 * 역할별 기본 AgentConfig 템플릿.
 * `AUTO_AGENT_TEMPLATES[role]` 로 조회, `AUTO_AGENT_ROLE_POLICY[role]` 가 partial AgentConfig 를 정의.
 */
export interface AutoAgentTemplate {
  role: AutoAgentRole;
  /** 사용자에게 보일 영문 라벨 (예: "Coder", "Reviewer") */
  label: string;
  /** 역할 설명 (auto-agent 가 토폴로지 결정 시 참조) */
  description: string;
  /** 이 역할로 spawn 될 때 기본으로 들어갈 AgentConfig partial */
  config: Partial<AgentConfig>;
}

/**
 * 토폴로지 프리셋 — 어떤 role 들을 어떤 엣지로 연결할지.
 * `nodes.entry === true` 인 노드가 사용자 메시지 forward 대상(=엔트리).
 * 정확히 1개의 entry 필수.
 */
export interface AutoAgentTopologyPreset {
  topology: AutoAgentTopology;
  /** 사용자 라벨 (예: "Team — PM hub + workers") */
  label: string;
  /** 짧은 설명 */
  description: string;
  /** 이 토폴로지로 spawn 할 노드 정의 */
  nodes: {
    role: AutoAgentRole;
    /** auto-agent 버블 기준 각도(도, 0=오른쪽, 시계 반대) — 원형 자동 배치용 */
    offsetAngleDeg: number;
    /** 정확히 1개의 노드만 entry=true */
    entry?: boolean;
  }[];
  /** 노드 간 엣지 정의 (role 기준 — auto-agent 가 실제 spawn 후 id 로 치환) */
  edges: {
    from: AutoAgentRole;
    to: AutoAgentRole;
    kind: TaskEdgeKind;
    returnFormat?: TaskEdgeReturnFormat;
    /** kind='critique' 일 때만 의미 — force-rework=자매 auto-rework 엣지 자동 동반 */
    critiqueAuthority?: TaskEdgeCritiqueAuthority;
    /** kind='command' 일 때만 의미 — shared/tool-delegation/mode-delegation */
    commandMode?: TaskEdgeCommandMode;
  }[];
}

/**
 * Auto Agent 가 사용자에게 띄우는 명확화 질문 1개.
 * IDE 인라인 카드(§5.3 #12-2 AskUserQuestion 패턴 재사용) 또는 간이 panel 둘 다 호환.
 */
export interface AutoAgentClarifyingQuestion {
  /** 질문 텍스트 */
  question: string;
  /** 옵션 라벨 (1~4개). 빈 배열이면 자유 입력만. */
  options: { label: string; description?: string }[];
  /** true 면 다중 선택 */
  multiSelect: boolean;
  /** 사용자가 입력한 답 (resolve 후 채워짐) */
  answer?: { selectedLabels: string[]; note?: string };
}

/**
 * Auto Agent 1회 요청의 완전한 메타.
 * key = auto-agent 의 sessionId. ProjectCheckpoint·GraphSnapshot 양쪽 동치.
 */
export interface AutoAgentSummary {
  /** auto-agent 버블의 sessionId (= 영속화 키) */
  autoAgentId: string;
  /** 휴리스틱 판정 결과 */
  complexity: AutoAgentComplexity;
  /** 선택된 토폴로지 */
  topology: AutoAgentTopology;
  /** spawn 된 커스텀 에이전트들의 sessionId 목록 (생성 순서) */
  spawnedAgentIds: string[];
  /** 그중 사용자 메시지 forward 대상 entry agent 의 sessionId */
  entryAgentId: string;
  /** 사용자가 보낸 원본 요청 (1회) */
  userRequest: string;
  /** asking 단계에서 발사된 명확화 질문들 (high 복잡도 + 토글 ON 일 때만 채워짐) */
  questionsAsked?: AutoAgentClarifyingQuestion[];
  /** 현재 진행 단계 */
  phase: AutoAgentPhase;
  /** 완료 시 1~2문 요약 (auto-agent 버블 summary 슬롯에 표시) */
  finalSummary?: string;
  /** 에러 발생 시 메시지 */
  errorMessage?: string;
  /** 요청 시작 시각 (ms) */
  startedAt: number;
  /** 완료 시각 (ms) — 미완료 시 undefined */
  completedAt?: number;
  /** 명확화 질문 토글 — true 면 high 복잡도에서 질문 발사. 기본 true. */
  askQuestionsEnabled: boolean;
}

/**
 * Auto Agent 가 spawn 한 노드 1개의 결과 (런타임 처리용 내부 타입).
 * 영속화 ❌ — `autoAgentSummaries.spawnedAgentIds` 만 영속.
 */
export interface AutoAgentSpawnedNode {
  role: AutoAgentRole;
  agentId: string;
  sessionId: string;
  position: { x: number; y: number };
}

// ─── §4 v2.44 — 자동 업데이트 (electron-updater + GitHub Releases) ─────────
//
// 업데이트 상태는 프로젝트 그래프 데이터(GraphSnapshot/ProjectCheckpoint)가 아니라
// Electron shell 상태다. server 코어를 거치지 않고 desktop main↔renderer 전용 IPC
// 채널(`vibisual:update:*`)로만 흐른다(§5.4 #14-1 별창 IPC 선례). 이 타입은 그 IPC
// 페이로드의 main↔renderer 계약 — 양쪽이 같은 모양에 합의하기 위한 shared 정의.

/**
 * 자동 업데이트 진행 단계.
 * - `idle`        : 아직 체크 전 / 초기.
 * - `checking`    : GitHub Releases 의 latest 메타 조회 중.
 * - `available`   : 새 버전 발견 (autoDownload=true 라 곧 downloading 으로 전이).
 * - `downloading` : 새 빌드 다운로드 중 (`percent`/`bytesPerSecond` 갱신).
 * - `downloaded`  : 다운로드 완료 — 재시작하면 적용 (사용자 액션 대기).
 * - `up-to-date`  : 현재가 최신.
 * - `error`       : 체크/다운로드 실패 (`error` 메시지).
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

/** main 프로세스 updaterManager 가 정규화해 renderer 로 푸시하는 업데이트 상태. */
export interface UpdateState {
  phase: UpdatePhase;
  /** 현재 실행 중인 앱 버전 (package.json version). */
  currentVersion: string;
  /** 발견된 새 버전 (available/downloading/downloaded 일 때). */
  newVersion?: string;
  /** 다운로드 진행률 0~100 (downloading 일 때). */
  percent?: number;
  /** 다운로드 속도 (bytes/sec, downloading 일 때). */
  bytesPerSecond?: number;
  /** 릴리스 노트 (available/downloaded 일 때, 있으면). */
  releaseNotes?: string;
  /** 에러 메시지 (phase==='error' 일 때). */
  error?: string;
  /** 마지막 체크 완료 시각 (ms). */
  checkedAt?: number;
}
