import type { MediaConvertKind } from './constants.js';
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
  /**
   * 서브에이전트(Task/Agent 도구) 식별자. **서브에이전트 컨텍스트에서 발화한 이벤트에만** 존재한다.
   * 메인 세션의 Stop 에는 없다 — 이 필드(또는 `parent_tool_use_id`)가 있으면 "서브에이전트의 종료"이지
   * 부모(감독관) 세션의 자기 턴 종료가 아니다. 서버는 이걸로 부모 버블 조기 완료(markStop)를 막는다.
   */
  agent_id?: string;
  /** 서브에이전트 이름(예: `Explore`, `general-purpose`, 커스텀 에이전트명). 서브 컨텍스트에만 존재. */
  agent_type?: string;
  /** 이 이벤트가 부모의 어느 Task/Agent tool_use 아래에서 났는지. 서브에이전트 컨텍스트 이벤트에 존재. */
  parent_tool_use_id?: string;
  /** UserPromptSubmit 이벤트의 프롬프트 본문 */
  prompt?: string;
  /**
   * §5.5 #17-9 ⑦(b) — `Stop`/`SubagentStop` 이 싣고 오는 그 턴의 마지막 assistant 텍스트.
   * 서브에이전트 종료에서는 **자식의 최종 보고**라, 부모의 `PostToolUse(Task).tool_response` 가
   * 유실된 판본에서 결과 표시의 폴백이 된다.
   */
  last_assistant_message?: string;
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
  /** 사용률 **퍼센트(0~100)**. v3.64 — 0~1 비율 표기는 폐기(값 1 의 중의성으로 오표시 사고). */
  used5h?: number;
  resetAt5h?: number;
  used7d?: number;
  resetAt7d?: number;
  updatedAt: number;
}

/**
 * §4 v3.60 — 사용량 수집기(statusLine) 설치 상태.
 *
 * Claude Code 는 한도 사용률을 **statusLine 스크립트의 stdin JSON**(`rate_limits.five_hour…`)
 * 으로만 노출한다 — JSONL 트랜스크립트에도, CLI 서브커맨드에도 없다. 따라서 §4 v1.50 의
 * `POST /api/rate-limits` 를 채우려면 `~/.claude/settings.json` 의 `statusLine` 에 Vibisual
 * 핸들러를 걸어야 하고, 그건 훅과 달리 **사용자 opt-in**(§4 v1.50 원문)이다.
 *
 * `foreign` = 사용자가 이미 자기 statusLine 을 쓰고 있는 상태. 이 경우 설치는 그 명령을
 * `_vibisualPrevStatusLine` 으로 보존하고 핸들러가 **passthrough 실행**하므로 화면 출력은
 * 그대로 유지된다(해제 시 원복).
 */
/**
 * §4 — 화면에 그리는 Claude 사용량.
 *
 * **원천은 statusLine 하나다**(§4 v3.60) — Claude Code 가 플랜 한도를 외부에 노출하는 공식
 * 경로가 그것뿐이다. 서버 `claudeUsageService.buildClaudeUsage` 가 `RateLimitInfo` 를 이 모양으로
 * 옮겨 담는다. 그래서 값을 받으려면 사용자가 수집기(statusLine)를 켜야 하고, 켜지 않았으면
 * `error: 'no-credentials'` 로 와서 화면이 그 스위치를 노출한다.
 *
 * 구 v3.62 는 `GET /api/oauth/usage` 를 OAuth 토큰으로 직접 불러 모델별 주간 한도와 사용
 * 크레딧까지 담았으나, 문서화되지 않은 내부 엔드포인트에 대한 자동 접속이라 약관에 걸려
 * 걷어냈다. 그 두 항목(`weekly_scoped`·`extraCredits`)은 지금 채워지지 않는다.
 */
export interface ClaudeUsageLimit {
  /** session / weekly_all / weekly_scoped / seven_day_opus … (서버 원문 그대로) */
  kind: string;
  /** session | weekly — 화면 묶음 단위 */
  group: string;
  /** 0~100 */
  percent: number;
  /** normal | warning | critical … (서버 원문) */
  severity: string;
  /** 한도 리셋 epoch ms (없을 수 있음) */
  resetsAt?: number;
  /** 모델별 한도의 표시명 (예: Fable) */
  scopeLabel?: string;
  isActive: boolean;
}

/** 사용 크레딧(플랜 한도 초과분 과금) 상태. */
export interface ClaudeUsageExtraCredits {
  enabled: boolean;
  /** 0~100 */
  utilization?: number;
  usedCredits?: number;
  monthlyLimit?: number;
  currency?: string;
}

/**
 * 값의 원천. 지금은 statusLine 하나뿐이다 — 구 v3.62 의 `'oauth'`(내부 엔드포인트 직접 조회)는
 * 약관 문제로 폐기했다. 유니온을 남겨 두는 것은 훗날 공식 창구가 생기면 그 자리에 붙이기 위함.
 */
export type ClaudeUsageSource = 'statusline';

/**
 * no-credentials = 표시할 값이 없음(수집기 미설치 · 아직 첫 보고 전 · mac 키체인 환경).
 * unauthorized / network 는 구 v3.62 직접 조회 시절의 코드라 지금은 발생하지 않지만,
 * 화면이 이미 문구를 들고 있어 유니온에 남긴다.
 */
export type ClaudeUsageError = 'no-credentials' | 'unauthorized' | 'network';

export interface ClaudeUsageInfo {
  /** 예: "Max (20x)" — 자격증명의 subscriptionType + rateLimitTier 로 조립 */
  plan?: string;
  limits: ClaudeUsageLimit[];
  extraCredits?: ClaudeUsageExtraCredits;
  source: ClaudeUsageSource;
  fetchedAt: number;
  /** 마지막 조회가 실패했을 때의 사유. limits 는 직전 성공값이 남아 있을 수 있다. */
  error?: ClaudeUsageError;
}

/**
 * §4 v4.82 — Claude 계정 로그인 상태. `claude auth status --json` 원문을 그대로 옮긴 것.
 *
 * 우리가 자격증명을 읽거나 쓰지 않는다 — 판정도 로그인/로그아웃 실행도 전부 CLI 위임.
 * 글로벌 1건(계정은 머신 단위)이고 영속화 ❌(런타임 캐시).
 */
export interface ClaudeAuthStatus {
  loggedIn: boolean;
  /** 예: 'claude.ai' | 'console' | 'apiKey' — CLI 원문 그대로(우리가 재해석 ❌). */
  authMethod?: string;
  /** 예: 'firstParty' | 'bedrock' | 'vertex' — CLI 원문 그대로. */
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  /** 예: 'max' | 'pro' — 표시용. */
  subscriptionType?: string;
  /**
   * 상태를 **판정하지 못했을 때**의 사유(CLI 미발견 / 타임아웃 / 출력 파싱 실패).
   * 값이 있으면 `loggedIn:false` 는 "로그아웃"이 아니라 "모름"이므로 로그인 팝업을 자동으로 띄우지 않는다.
   */
  error?: ClaudeAuthProbeError;
  checkedAt: number;
}

/** cli-missing = claude 실행 불가, timeout = 응답 없음, parse = JSON 아님/형식 불명 */
export type ClaudeAuthProbeError = 'cli-missing' | 'timeout' | 'parse';

/** 로그인 방식 — `claude auth login --claudeai` (구독) / `--console` (API 과금). */
export type ClaudeAuthLoginMode = 'claudeai' | 'console';

export interface UsageCollectorStatus {
  /** Vibisual 관리 statusLine 이 걸려 있는가 */
  installed: boolean;
  /** 사용자(비-Vibisual) statusLine 이 존재하는가 — 설치 시 passthrough 로 감싼다 */
  foreign: boolean;
  /** passthrough 로 보존 중인 원래 명령 (installed && 원래 statusLine 이 있었을 때만) */
  passthroughCommand?: string;
  settingsPath: string;
  /** 설치/조회 실패 사유 (settings.json 손상 등) */
  error?: string;
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
  /**
   * 소속 세션이 **실패로** 끝났다. `SubAgentStatus` 에는 처음부터 `error` 가 있었지만 이 유니온에는
   * 없어서, 세션이 실패해도 부모 버블은 `completed` 로 내려갔다 — 캔버스에서 **실패가 완료로 세탁**되고
   * 완료음(`completionChime`)까지 울렸다. 두 축의 값 집합을 맞춰 그 세탁을 없앤다.
   */
  | 'error'
  | 'disappearing'
  | 'awaiting_permission';

/** 버블 타입 — 시각 카테고리 */
export type BubbleType = 'agent' | 'internal_folder' | 'external_folder' | 'file' | 'bash' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'worktree' | 'conti' | 'auto' | 'brain' | 'trash' | 'video' | 'spec' | 'lab' | 'shelf';

// ─── 화면/프로그램 캡처 (§5.9 capture 버블) ───
//
// capture 버블은 그래프 노드(에이전트/폴더/파일)나 위성이 아니라, CommentBox 처럼 사용자가
// 캔버스에 직접 만드는 **독립 요소**다(전용 React Flow 노드 타입 'captureNode'). 라이브 영상은
// 렌더러가 getUserMedia(desktop)로 붙이며(useCaptureStream), 여기 타입은 위치/크기/소스 식별만 나른다.

/** 캡처 대상 종류 — 전체 화면 vs 개별 창/프로그램(OBS/디스코드식 소스 선택). */
export type CaptureSourceKind = 'screen' | 'window';

/**
 * Electron `desktopCapturer.getSources()` 한 항목을 렌더러 소스 선택 UI 로 나르는 계약.
 * main(desktopCapturer) → preload(window.api.capture) → 클라이언트 picker. 썸네일은
 * NativeImage 를 data URL(PNG)로 직렬화해 IPC 텍스트 와이어로 무손실 전달한다.
 */
export interface CaptureSourceInfo {
  /** desktopCapturer 소스 id (getUserMedia chromeMediaSourceId 로 그대로 사용). */
  id: string;
  /** 사람이 읽는 이름(화면 번호 / 창 제목). */
  name: string;
  /** 전체 화면인지 개별 창인지. */
  kind: CaptureSourceKind;
  /** 미리보기 썸네일(data:image/png;base64,…). 없으면 빈 문자열. */
  thumbnailDataUrl: string;
  /** 창 소스의 앱 아이콘(data URL) — 있을 때만. picker 목록 글리프용. */
  appIconDataUrl?: string;
}

// ─── 캡처 원격 조작(§5.9 Phase B) — 렌더러→main 입력 주입 계약 ───
//
// 캡처 버블 본체 위 사용자 제스처를 정규화 좌표(u,v ∈ [0,1])로 담아 main 으로 보내면,
// main 이 소스(화면/창)의 실제 화면 좌표로 매핑해 nut.js 로 OS 레벨 마우스/키보드를 주입한다.

/**
 * 캡처 버블 마우스 주입 — u,v 는 캡처 콘텐츠 기준 정규화 좌표.
 *
 * **v3.58 — 모든 주입은 "사용자가 물리 버튼을 뗀 뒤"에 원자적으로 일어난다.** Windows 는 사용자가
 * 우리 창에서 버튼을 누르는 순간 그 창으로 **마우스 캡처(SetCapture)** 를 걸어 버려, 버튼이 눌려 있는
 * 동안 SendInput 으로 주입한 마우스 이벤트까지 **전부 우리 창으로 되돌아온다**(대상 앱에 닿지 않음).
 * v3.57 이 `mousedown → down 주입 / mousemove → 손이 직접 / mouseup → up 주입` 으로 설계를 옮긴 순간
 * 클릭·우클릭·드래그가 전부 먹통이 된 근본 원인이 이것이다. 그래서 제스처는 렌더러가 **끝까지 지켜본
 * 뒤**(release) 한 방에 재생한다 — 그 시점엔 캡처가 풀려 있어 주입이 대상에 그대로 닿는다.
 */
export interface CaptureMouseInput {
  type: 'mouse';
  sourceId: string;
  sourceKind: CaptureSourceKind;
  sourceName: string;
  /**
   * `click`/`dblclick`/`drag`/`wheel` 이 실사용 경로다(전부 원자적·커서 반납 포함).
   * `move`/`down`/`up` 은 v3.57 사슬 모델의 잔여 계약으로 남겨 두지만 렌더러는 더 이상 쓰지 않는다.
   */
  action: 'move' | 'down' | 'up' | 'click' | 'dblclick' | 'drag' | 'wheel';
  u: number;
  v: number;
  /** `drag` 의 도착 지점(정규화). 없으면 u,v 와 같은 자리에서 누르고 뗀다. */
  u2?: number;
  v2?: number;
  button?: 'left' | 'right' | 'middle';
  /** wheel 델타(양수=아래로 스크롤). */
  deltaY?: number;
  /**
   * 주입 후 사용자의 실제 커서를 원래 자리로 되돌릴지(v3.55). 이 PC 의 OS 커서는 하나뿐이라
   * 주입 지점에 그냥 두면 사용자의 마우스가 캡처 대상 화면으로 끌려가 갇힌다. **v3.58 부터는 모든
   * 원자적 동작(click/dblclick/drag/wheel)이 예외 없이 반납한다** — 사용자의 마우스는 버블 위에서
   * 잠시 깜빡였다가 늘 제자리로 돌아온다(갇히지 않음).
   */
  restoreCursor?: boolean;
  /**
   * u,v 로 커서를 옮기지 말고 **지금 커서가 있는 자리에서** 버튼만 처리한다(v3.57 사슬 모델 잔여).
   * v3.58 원자 주입 경로에서는 쓰지 않는다.
   */
  inPlace?: boolean;
  /**
   * "커서 안 움직이기"(v3.62) — 켜면 main 이 **대상 창에 마우스 메시지를 직접 넣어** 사용자의 커서를
   * 전혀 건드리지 않는다. 일반 Win32 앱엔 잘 먹지만 게임·보호된 창은 무시하므로, 그런 창이면 자동으로
   * 기본(커서를 잠깐 빌리는) 경로로 되돌아가고 결과의 `fallback` 으로 이유를 알린다.
   */
  preferBackgroundClick?: boolean;
}

/**
 * 캡처 대상(화면/창)의 실제 사각형 — 렌더러가 **드래그 중 손 움직임만 뽑아내기 위해** 쓴다(v3.57).
 *
 * 드래그를 하려면 OS 커서를 대상 위로 옮겨 둔 채로 손 움직임을 계속 읽어야 하는데, 커서가 이미
 * 대상으로 가 있으므로 브라우저가 주는 좌표는 "버블 안"이 아니라 "대상 화면 위"의 좌표다. 렌더러는
 * 자기가 방금 커서를 어디에 놓았는지(=기대 좌표)를 알아야 그 차이만큼만 손이 움직였다고 계산할 수
 * 있다(닫힌 루프 → 우리가 주입한 이동이 되먹임되어 커서가 폭주하는 것을 원천 차단).
 *
 * - `dip`: Electron DIP 좌표계 사각형. 브라우저 `MouseEvent.screenX/screenY` 와 같은 공간이라 이걸로 계산한다.
 * - `physical`: nut.js 주입에 쓰는 물리 픽셀 사각형(진단·표시용).
 */
/**
 * 주입 결과(v3.61) — 종전엔 실패해도 조용히 아무 일도 안 일어나 "클릭이 안 먹는다"로만 보였다.
 * 렌더러가 이 값을 받아 **왜 안 됐는지**를 오버레이 칩으로 알린다.
 */
export interface CaptureInjectResult {
  ok: boolean;
  /** 'nut-unavailable'=주입 엔진 로드 실패, 'target-not-found'=대상 화면/창 못 찾음, 'error'=주입 중 예외. */
  reason?: 'nut-unavailable' | 'target-not-found' | 'error';
  /**
   * 어떤 경로로 넣었는지(v3.62) — 'background'=커서를 안 건드리고 대상 창에 메시지 직접 전달,
   * 'cursor'=커서를 잠깐 빌려 쓰는 기본 경로.
   */
  method?: 'cursor' | 'background';
  /**
   * "커서 안 움직이기"를 켰는데 배경 클릭이 불가능해 커서 경로로 되돌아갔을 때의 사유.
   * 'message-deaf-app'=게임/보호된 창처럼 합성 메시지를 무시하는 앱, 'no-window'=그 지점에 창이 없음,
   * 'ffi-unavailable'=배경 클릭 경로 자체를 못 씀.
   */
  fallback?: 'ffi-unavailable' | 'no-window' | 'message-deaf-app';
}

export interface CaptureTargetRect {
  /** 대상을 찾았는지 — 창 제목이 바뀌어 못 찾으면 false(조작 불가 안내). */
  ok: boolean;
  dip: { x: number; y: number; width: number; height: number };
  physical: { x: number; y: number; width: number; height: number };
}

/** 캡처 버블 키보드 주입 — 대상 창을 포커스한 뒤 타이핑/특수키 전송. */
export interface CaptureKeyInput {
  type: 'key';
  sourceId: string;
  sourceKind: CaptureSourceKind;
  sourceName: string;
  /** 'type' = 출력 가능한 문자 그대로, 'press' = 정규화 키 이름(Enter/Backspace/ArrowLeft 등). */
  action: 'type' | 'press';
  /** action='type' 일 때 실제 입력 문자열. */
  text?: string;
  /** action='press' 일 때 정규화 키 이름. */
  key?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export type CaptureInputEvent = CaptureMouseInput | CaptureKeyInput;

/**
 * 사용자가 캔버스에 만든 화면/프로그램 캡처 버블(§5.9). CommentBox 와 같은 독립 캔버스 요소로,
 * React Flow parent/child 없이 절대좌표(x/y)로 배치된다. 렌더러가 `sourceId` 로 라이브 MediaStream 을
 * 붙여 네모난 본체에 <video> 로 표시한다. 서버는 위치/크기/소스 식별만 SSOT 로 들고 영속한다.
 */
/**
 * §5.13 v4.45 — 내부 앱 버블.
 *
 * CommentBox·CaptureBubble 과 같은 "사용자가 캔버스에 직접 만드는 독립 요소"다(그래프
 * 노드도 위성도 아니다). **특정 앱 전용이 아니라 범용**인 이유는 내부 앱을 앞으로 계속
 * 늘릴 것이기 때문이다 — 앱이 하나 늘 때마다 새 버블 타입·새 영속 필드·새 REST 를
 * 만들면 코어가 앱 수만큼 뚱뚱해진다. 여기서는 `appId` 한 글자만 달라진다.
 *
 * 더블클릭하면 그 앱의 전용 창이 열린다(무엇이 열리는지는 클라이언트 앱 레지스트리가 안다).
 */
export interface AppBubble {
  /** 고유 id (예: "app-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 어떤 내부 앱인가. 클라이언트 앱 레지스트리의 id(예: 'vibistudio'). */
  appId: string;
  /** 캔버스 절대 x. */
  x: number;
  /** 캔버스 절대 y. */
  y: number;
  width: number;
  height: number;
  /** 버블에 보일 이름. 비면 앱 기본 이름을 쓴다. */
  title?: string;
  /** 앱이 해석하는 열쇠(영상 앱이면 문서 id). 코어는 뜻을 모른다. */
  ref?: string;
  createdAt: number;
  /** §2.4 v1.28 — 사용자 preserve-pin. 소멸·삭제 경로 차단. */
  preservePinned?: boolean;
}

export interface CaptureBubble {
  /** 고유 id (예: "capture-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 캔버스 절대 x. */
  x: number;
  /** 캔버스 절대 y. */
  y: number;
  /** 본체 너비(px). */
  width: number;
  /** 본체 높이(px). */
  height: number;
  /** desktopCapturer 소스 id — getUserMedia chromeMediaSourceId. 재시작마다 창 핸들이 바뀔 수 있다. */
  sourceId: string;
  /** 캡처 대상의 사람이 읽는 이름(복원 재매칭·라벨용). */
  sourceName: string;
  /** 전체 화면 vs 개별 창. */
  sourceKind: CaptureSourceKind;
  /** 생성 시각(epoch ms). */
  createdAt: number;
  /** 마지막 수정 시각(epoch ms). */
  updatedAt: number;
}

// ─── §5.14 v4.62 — 플레이 버블 (이 프로젝트를 켜는 버튼) ───

/**
 * 실행 방식.
 * - `static`: 명령이 없다. Vibisual 의 loopback 정적 호스트가 폴더를 그대로 서빙한다(HTML 앱).
 * - `command`: 셸 명령을 띄운다(dev 서버 등).
 */
export type PlayRecipeKind = 'static' | 'command';

/** 이 레시피를 누가 정했나 — 화면에 그대로 보여 사용자가 "무엇이 실행되는지" 알게 한다. */
export type PlayRecipeSource = 'detected' | 'observed' | 'agent' | 'user';

/** 플레이 버블의 실행 상태. 버튼 색·아이콘이 이것만 보고 결정된다. */
export type PlayBubbleStatus = 'idle' | 'starting' | 'running' | 'failed';

/**
 * 실행 레시피 — "이 프로젝트를 어떻게 켜는가" 한 벌.
 *
 * 버블 하나가 레시피 하나를 가진다(웹·스토리북·API 를 따로 켜려면 버블을 여러 개 놓는다).
 */
export interface PlayRecipe {
  kind: PlayRecipeKind;
  /** 사람이 읽는 한 줄(예: "pnpm dev · package.json scripts"). */
  label?: string;
  /** `kind='command'` 일 때 실행할 명령. `{port}` 토큰은 실제 포트로 치환된다. */
  command?: string;
  /** 명령을 실행할 디렉터리(절대 경로 — 프로젝트 안으로 제한). */
  cwd?: string;
  /** `kind='static'` 일 때 서빙할 폴더(절대 경로 — 프로젝트 안으로 제한). */
  root?: string;
  /** 기대 포트. `command` 에서 뽑아냈거나 사용자가 지정. static 이면 서버가 정한다. */
  port?: number;
  /** 열 경로(예: `/index.html`). 비면 `/`. */
  openPath?: string;
  source: PlayRecipeSource;
}

/** 탐지기가 내놓는 후보 — 신뢰도와 근거를 달고 온다(사용자가 고를 수 있게). */
export interface PlayRecipeCandidate extends PlayRecipe {
  /** 0~1. 높을수록 먼저 제안된다. */
  confidence: number;
  /** 어디서 나온 후보인지 한 줄(예: "package.json scripts.dev"). */
  reason: string;
}

/**
 * §5.14 v4.62 — 플레이 버블.
 *
 * 캡처 버블·앱 버블과 같은 "사용자가 캔버스에 직접 만드는 독립 요소"다(그래프 노드도 위성도
 * 아니다). 레코드는 하나지만 캔버스에는 **두 개**로 그려진다 — 누르는 **버튼**(x/y/width/height)과
 * 그 옆에 뜨는 **프리뷰 iframe**(preview*). 프리뷰를 닫아도 버튼은 사용자가 지울 때까지 남는다.
 */
export interface PlayBubble {
  /** 고유 id (예: "play-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 버튼 캔버스 절대 x/y. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 버튼에 보일 이름. 비면 레시피 라벨/기본 이름. */
  title?: string;
  /** 실행 레시피. 없으면 "아직 실행법을 모름" — 버튼이 [실행법 알아내기] 를 띄운다. */
  recipe?: PlayRecipe;
  status: PlayBubbleStatus;
  /** 살아 있는 동안의 프리뷰 URL(포트+경로). */
  url?: string;
  /** 실제로 잡은 포트(stop 이 이걸로 kill 한다). */
  port?: number;
  /** 실패 사유 한 줄. `status='failed'` 일 때만 의미 있다. */
  error?: string;
  lastStartedAt?: number;
  /** 프리뷰 iframe 을 캔버스에 그릴지. 버튼과 독립 — 닫아도 버튼은 남는다. */
  previewOpen?: boolean;
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
  createdAt: number;
  updatedAt: number;
  /** §2.4 v1.28 — 사용자 preserve-pin. 삭제 경로 차단. */
  preservePinned?: boolean;
  /**
   * §5.17 (C) — 이 화면을 만든(=실행법을 알아내 준) 에이전트. 프리뷰가 열려 있으면 캔버스가
   * 여기로 점선을 긋는다. 사용자가 `[실행법 알아내기]` 로 물은 그 시각에 적히고, 그 에이전트가
   * 캔버스에 없으면 선은 그리지 않는다(없는 끝점으로 향하는 선 ❌).
   */
  ownerAgentId?: string;
}

// ─── §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드 → 실행) ───

/**
 * 수용 기준 한 줄. **이 한 줄이 작업 카드 한 장의 씨앗**이다.
 *
 * 카드를 만들면 `taskAgentId`/`taskSessionId` 가 채워지고, 그때의 스펙 개정 번호가
 * `generatedRevision` 에 박힌다 — 이후 스펙이 바뀌면 두 숫자의 차이가 곧 "낡았다"는 뜻이다.
 */
export interface SpecItem {
  /** 고유 id (예: "sitem-lp3x9-a1b2"). */
  id: string;
  /** 수용 기준 본문 한 줄. */
  text: string;
  /** 사람이 손으로 체크하는 완료 표시. 카드 생성 여부와 무관하다. */
  done?: boolean;
  /** 이 항목에서 만들어진 작업 카드(커스텀 에이전트) 버블 id. 없으면 아직 카드 없음. */
  taskAgentId?: string;
  /** 그 카드의 세션 키(`custom-…`). 서버가 카드 생존을 확인할 때 쓴다. */
  taskSessionId?: string;
  /** 카드를 만든 시점의 `SpecDoc.bodyRevision`. 지금 값보다 낮으면 "스펙 변경됨". */
  generatedRevision?: number;
}

/**
 * §5.15 — 스펙 한 장.
 *
 * 캡처 버블·앱 버블·플레이 버블과 같은 "사용자가 캔버스에 직접 만드는 독립 요소"다
 * (그래프 노드도 위성도 아니다). 캔버스에는 표지 한 장으로 그려지고, 더블클릭하면
 * 전체 화면 보드가 열려 본문과 수용 기준을 고친다.
 */
export interface SpecDoc {
  /** 고유 id (예: "spec-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 표지 캔버스 절대 x/y. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 스펙 제목. */
  title: string;
  /** 스펙 본문(마크다운). */
  body: string;
  /** 수용 기준 목록. 순서가 곧 작업 사슬의 순서다. */
  items: SpecItem[];
  /**
   * 스펙 내용 개정 번호. `body` 또는 `items[].text` 가 **실제로 달라질 때만** 서버가 +1 한다.
   * 좌표·크기·제목·`done` 토글은 스펙 내용이 아니므로 올리지 않는다.
   */
  bodyRevision: number;
  createdAt: number;
  updatedAt: number;
  /** §2.4 v1.28 — 사용자 preserve-pin. 삭제 경로 차단. */
  preservePinned?: boolean;
}

// ─── §5.16 — 리뷰·승인 레인 (머지 전에 사람이 붙잡는 자리) ───

/** 변경 파일 한 줄의 변경 종류. git 의 status 문자를 우리 말로 옮긴 것. */
export type ReviewFileChangeType = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';

/**
 * §5.16 — 리뷰에 실린 변경 파일 한 줄.
 *
 * `merge-base` 기준 커밋분과 미커밋분을 합쳐 한 목록으로 만든다. 증감(`additions`/`deletions`)은
 * `git diff --numstat` 이 준 숫자 그대로이며, 바이너리 파일은 둘 다 0 이다(numstat 가 `-` 를 준다).
 */
export interface ReviewFileChange {
  /** 워크트리 기준 상대 경로(POSIX 구분자). */
  path: string;
  /** 변경 종류. */
  changeType: ReviewFileChangeType;
  /** 추가된 줄 수. */
  additions: number;
  /** 삭제된 줄 수. */
  deletions: number;
  /** 아직 커밋되지 않은 변경분이면 true — 승인해도 병합에는 안 들어간다는 신호. */
  uncommitted?: boolean;
}

/** 사람이 내리는 결정 세 갈래. 승인=병합 절차, 반려=사유와 함께 재작업, 보류=아무것도 안 함. */
export type ReviewDecisionKind = 'approve' | 'reject' | 'hold';

/**
 * §5.16 — 결정 한 건. **이력으로 쌓인다**(보류했다가 승인해도 앞의 보류가 지워지지 않는다).
 *
 * 승인일 때는 그 자리에서 §7.6 병합을 시도하므로 결과(`mergeOk`/`mergeError`/`conflicts`)가
 * 같은 레코드에 함께 남는다 — "승인했는데 왜 안 들어갔는지"를 카드가 그대로 보여 준다.
 */
export interface ReviewDecision {
  /** 결정 고유 id (서버 발급). */
  id: string;
  /** 승인 / 반려 / 보류. */
  kind: ReviewDecisionKind;
  /** 반려 사유(반려는 필수 — 사유 없는 반려는 에이전트가 고칠 근거가 없다). */
  reason?: string;
  /** 결정 시각 (서버 stamp). */
  decidedAt: number;
  /** 승인일 때 병합이 실제로 됐는지. 승인 외에는 undefined. */
  mergeOk?: boolean;
  /** 병합이 안 됐을 때의 사유 코드/메시지(`parent-dirty`·`nothing-to-merge`·stderr 요약). */
  mergeError?: string;
  /** 병합 충돌 파일 목록(있을 때만). */
  conflicts?: string[];
  /** 반려로 실제 재작업 명령이 나갔는지 — 클라이언트가 보고한 값. */
  reworkDispatched?: boolean;
}

/** 리뷰 한 건의 현재 상태 — 마지막 결정에서 나오는 파생값. 서버만 계산한다(§3.1). */
export type ReviewRequestStatus = 'pending' | 'approved' | 'rejected' | 'held';

/**
 * §5.16 — 리뷰 한 건.
 *
 * 격리(워크트리)에서 일한 커스텀 에이전트가 그 턴을 끝냈고 실제 변경분이 있을 때 서버가 만든다.
 * 표시는 §4 v2.70 검수 카드 그 자리이고(`AgentReview.reviewRequestId` 로 연결), 승인 병합은 §7.6
 * 워크트리 merge 경로, 반려 재작업은 기존 명령 큐 경로를 그대로 쓴다 — 새 레이어 없음.
 */
export interface ReviewRequest {
  /** 고유 id (예: "review-lp3x9-a1b2"). */
  id: string;
  /** 워크트리 프로젝트 이름(basename) — 렌더/영속 필터 키. */
  projectName: string;
  /** 부모(본선) 프로젝트 이름 — 어디로 합쳐지는지. */
  parentProjectName?: string;
  /** 그 워크트리에서 일한 커스텀 에이전트 버블 id. 카드 렌더 1차 필터 키. */
  agentId: string;
  /** 그 턴이 돌던 IDE 세션 탭 id. 있으면 그 탭에 귀속. */
  subAgentId?: string;
  /** 부모 캔버스의 worktree 버블 id — 병합 엔드포인트 키(없으면 승인 병합 불가). */
  worktreeNodeId?: string;
  /** 워크트리 절대 경로. */
  worktreePath: string;
  /** 워크트리 브랜치명. */
  branch?: string;
  /** 합쳐질 부모 브랜치명. */
  baseBranch?: string;
  /** 변경 파일 목록(`REVIEW_FILES_MAX` 까지). */
  files: ReviewFileChange[];
  /** 파일 목록이 상한에서 잘렸으면 true. */
  filesTruncated?: boolean;
  /** 통합 diff 본문(`REVIEW_DIFF_MAX_BYTES` 까지). */
  diff: string;
  /** diff 본문이 상한에서 잘렸으면 true. */
  diffTruncated?: boolean;
  /** 마지막 결정에서 나온 현재 상태. */
  status: ReviewRequestStatus;
  /** 결정 이력(최신이 뒤, `REVIEW_DECISIONS_MAX` 까지). */
  decisions: ReviewDecision[];
  createdAt: number;
  updatedAt: number;
}


// ─── §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌) ───

/**
 * §5.18 — 한 변형이 흔드는 설정 축. `AgentConfig` 의 **부분집합 넷 + 덧말**이다.
 *
 * 나머지 설정(도구·스킬·MCP·기억 범위 등)은 기준 에이전트의 현재 설정을 그대로 물려받는다 —
 * 랩은 설정 창을 새로 짓는 자리가 아니라 §5.3 `AgentConfig` 를 몇 축만 흔들어 보는 자리다.
 */
export interface LabVariantConfig {
  /** 모델 id/alias. 비우면 기준 에이전트 값 그대로. */
  model?: string;
  /** 사고 깊이(`--effort`). 비우면 기준 값 그대로. */
  effort?: string;
  /** 권한 모드(claude CLI `--permission-mode`). 비우면 기준 값 그대로. */
  permissionMode?: string;
  /** 최대 턴 수. 비우면 기준 값 그대로. */
  maxTurns?: number;
  /** 이 변형에만 얹는 규칙 덧말 — 기준 `rules` **앞에** 붙는다(프롬프트 축 실험용). */
  rulesAppend?: string;
}

/** 변형 한 벌의 실행 결과 상태. 판정은 서버만 한다(§3.1). */
export type LabResultStatus = 'pending' | 'running' | 'success' | 'failed' | 'stopped';

/**
 * §5.18 — 변형 한 벌의 실행 결과.
 *
 * **못 읽은 값은 채우지 않는다.** 토큰·비용·변경분이 없으면 필드를 비워 두고 화면이 `—` 로 그린다 —
 * 0 으로 채우면 "공짜로 끝났다"·"아무것도 안 고쳤다"는 거짓말이 되고, 그 위에서 설정을 승격하면
 * 랩 전체가 무의미해진다.
 */
export interface LabResult {
  /** 현재 상태. */
  status: LabResultStatus;
  /** 과제가 실제로 발사된 시각. */
  startedAt?: number;
  /** 그 턴이 끝난 시각. */
  finishedAt?: number;
  /** 소요(ms) = finishedAt - startedAt. 서버가 계산해 실어 준다. */
  durationMs?: number;
  /** 워크트리에서 실제로 달라진 파일 수(§5.16 `collectWorktreeChanges` 와 같은 셈법). */
  filesChanged?: number;
  /** 추가된 줄 수 합계. */
  additions?: number;
  /** 삭제된 줄 수 합계. */
  deletions?: number;
  /** 이 실행이 쓴 입력 토큰(캐시 읽기·생성 포함). */
  inputTokens?: number;
  /** 이 실행이 쓴 출력 토큰. */
  outputTokens?: number;
  /** 추정 비용(USD) — `getModelPricing` 단가 × 토큰. 단가를 모르면 비워 둔다. */
  costUsd?: number;
  /** 실제로 돈 모델 이름(트랜스크립트가 말한 값). */
  model?: string;
  /** 마지막 응답 앞머리 — 표에서 무엇을 했는지 한 줄로 보이게. */
  summary?: string;
  /** 실패·중단 사유. */
  error?: string;
}

/**
 * §5.18 — 설정 조합 한 벌 = 표의 한 줄.
 *
 * 실행 전에는 `config` 만 있고, 실행하면 그 변형 전용 워크트리와 커스텀 에이전트 카드가 생겨
 * `agentId`/`sessionId`/`worktreePath` 가 채워진다. 결과는 그 턴이 끝날 때 `result` 로 들어온다.
 */
export interface LabVariant {
  /** 고유 id (예: "lvar-lp3x9-a1b2"). */
  id: string;
  /** 표에 보이는 이름. */
  label: string;
  /** 이 변형이 흔드는 축. */
  config: LabVariantConfig;
  /** 실행으로 만들어진 커스텀 에이전트 버블 id. */
  agentId?: string;
  /** 그 카드의 세션 키(`custom-…`). */
  sessionId?: string;
  /** 그 변형이 도는 워크트리 프로젝트 이름(basename). */
  worktreeProjectName?: string;
  /** 워크트리 절대 경로. */
  worktreePath?: string;
  /** 워크트리 브랜치명. */
  branch?: string;
  /** 실행 결과. 아직 안 돌렸으면 없음. */
  result?: LabResult;
}

/** 랩 한 장의 현재 상태 — 변형들의 결과에서 나오는 파생값. 서버만 계산한다(§3.1). */
export type LabRunStatus = 'draft' | 'running' | 'done';

/**
 * §5.18 — 랩 한 장 = 과제 하나 + 설정 조합 N개.
 *
 * 캡처·앱·플레이·스펙 버블과 같은 "사용자가 캔버스에 직접 만드는 독립 요소"다. 캔버스에는
 * 표지 한 장으로 그려지고, 더블클릭하면 전체 화면 보드가 열려 과제를 쓰고 변형을 짜고
 * 결과 표를 읽는다(§7.17).
 */
export interface LabRun {
  /** 고유 id (예: "lab-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 표지 캔버스 절대 x/y. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 랩 제목. */
  title: string;
  /** 모든 변형에 **똑같이** 나가는 과제 프롬프트. 변형끼리 다른 것은 설정뿐이어야 비교가 성립한다. */
  task: string;
  /** 설정 조합 목록 = 표의 줄들. */
  variants: LabVariant[];
  /** 파생 상태. */
  status: LabRunStatus;
  /**
   * 설정을 물려받을 기준 에이전트 버블 id(선택). 지정하면 그 에이전트의 현재 `AgentConfig` 전량을
   * 바탕에 깔고 변형 축만 덮으며, 승격의 기본 대상도 이 에이전트다.
   */
  baseAgentId?: string;
  /** 마지막으로 승격한 변형 id — 표에 `기본값` 배지로 남는다. */
  promotedVariantId?: string;
  /** 마지막 실행 시작·종료 시각. */
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
  /** §2.4 v1.28 — 사용자 preserve-pin. 삭제 경로 차단. */
  preservePinned?: boolean;
}


// ─── §5.20 — 스크립트 선반 (자주 쓰는 명령·프롬프트를 캔버스에 고정) ───

/**
 * §5.20 — 선반 항목이 하는 일. **갈래는 둘뿐이다.**
 * - `command`: 셸 한 줄. **끝나는 일**이라 출력이 결과로 남는다(서버를 띄우는 일은 §5.14 플레이 버블의 몫).
 * - `prompt`: 에이전트에게 보낼 프롬프트 한 벌. 기존 명령 큐로 나간다.
 */
export type ShelfItemKind = 'command' | 'prompt';

/** 선반 항목 한 번의 실행 결과 상태. 판정은 서버만 한다(§3.1). */
export type ShelfRunStatus = 'running' | 'success' | 'failed';

/**
 * §5.20 — 항목의 **마지막** 실행 결과. 이력은 쌓지 않는다(§9 무한 성장 금지).
 *
 * **못 읽은 값은 채우지 않는다** — 소요·종료 코드가 없으면 필드를 비워 두고 화면이 `—` 로 그린다.
 * 0 으로 채우면 "즉시 끝났다"·"정상 종료했다"는 거짓말이 된다(§5.18 과 같은 규율).
 */
export interface ShelfItemRun {
  status: ShelfRunStatus;
  /** 실행이 시작된 시각. */
  startedAt: number;
  /** 끝난 시각. 도는 중이면 없음. */
  finishedAt?: number;
  /** 소요(ms) = finishedAt - startedAt. 서버가 계산해 실어 준다. */
  durationMs?: number;
  /** 프로세스 종료 코드(`kind='command'` 한정). 신호로 죽었으면 없음. */
  exitCode?: number;
  /** stdout+stderr 꼬리(`SHELF_RUN_OUTPUT_MAX_CHARS` 까지). */
  output?: string;
  /** 출력이 상한에서 잘렸으면 true. */
  outputTruncated?: boolean;
  /** 실패·시간초과 사유 한 줄. */
  error?: string;
  /** `kind='prompt'` — 프롬프트가 나간 에이전트 버블 id. */
  agentId?: string;
  /** 그 카드의 세션 키(`custom-…`). */
  sessionId?: string;
}

/**
 * §5.20 — 선반 항목 글리프 이름. **고정 목록**이다 — 클라이언트가 같은 이름의 인라인 stroke SVG
 * (lucide 톤)를 그린다. 이모지·임의 문자열 저장 ❌(OS·폰트마다 다른 모양으로 새어 나오고, 남이 준
 * 선반 파일이 우리 화면에 아무 글리프나 그리는 통로가 된다). 실물 목록은 `SHELF_ICONS`.
 */
export type ShelfIconName =
  | 'terminal'
  | 'play'
  | 'rocket'
  | 'wrench'
  | 'bug'
  | 'sparkles'
  | 'refresh'
  | 'package'
  | 'database'
  | 'search'
  | 'doc'
  | 'shield';

/**
 * §5.20 — 선반 항목 한 줄 = 클릭 한 번으로 실행되는 것 하나.
 *
 * 아이콘·색은 **고정 목록**(`SHELF_ICONS` / `SHELF_ITEM_COLORS`)의 값만 담는다 — 임의 문자열·이모지
 * 저장 ❌(OS·폰트마다 다른 모양으로 새어 나오고, 남이 준 선반 파일이 아무 글리프나 그리는 통로가 된다).
 */
export interface ShelfItem {
  /** 고유 id (예: "sitem-lp3x9-a1b2"). */
  id: string;
  /** 줄에 보이는 이름. */
  label: string;
  kind: ShelfItemKind;
  /** `kind='command'` 일 때 실행할 셸 한 줄. */
  command?: string;
  /** 명령을 실행할 디렉터리(절대 경로 — 프로젝트 안으로 제한). 비면 프로젝트 루트. */
  cwd?: string;
  /** `kind='prompt'` 일 때 보낼 프롬프트 본문. */
  prompt?: string;
  /** 프롬프트를 받을 에이전트 버블 id. 비면 실행 때 카드를 한 장 만들어 보낸다. */
  targetAgentId?: string;
  /** `SHELF_ICONS` 안의 이름. */
  icon: ShelfIconName;
  /** `SHELF_ITEM_COLORS` 안의 hex. */
  color: string;
  /** 마지막 실행 결과. 아직 안 눌렀으면 없음. */
  lastRun?: ShelfItemRun;
  createdAt: number;
  updatedAt: number;
}

/**
 * §5.20 — 선반 한 장.
 *
 * 캡처·앱·플레이·스펙·랩 버블과 같은 "사용자가 캔버스에 직접 만드는 독립 요소"다. 랩·스펙과 달리
 * 캔버스에 **표지가 아니라 선반 그 자체**가 그려지고, 줄을 누르면 그 자리에서 실행된다(§7.18).
 */
export interface ShelfBubble {
  /** 고유 id (예: "shelf-lp3x9-a1b2"). */
  id: string;
  /** 소속 프로젝트 이름(basename) — 렌더 시 활성 프로젝트로 필터. */
  projectName: string;
  /** 캔버스 절대 x/y. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 선반 이름. */
  title: string;
  /** 항목 목록 = 눌러서 실행하는 줄들(`SHELF_MAX_ITEMS` 까지). */
  items: ShelfItem[];
  createdAt: number;
  updatedAt: number;
  /** §2.4 v1.28 — 사용자 preserve-pin. 삭제 경로 차단. */
  preservePinned?: boolean;
}

/**
 * §5.20 — 내보내기 파일 한 장의 스키마. 팀 공유는 **여기까지**다(계정·서버 동기화 ❌).
 *
 * 런타임 필드(id·lastRun·에이전트 id·절대 경로 cwd)는 담지 않는다 — 남의 기계에서 의미가 없거나
 * 그대로 밀어 넣으면 우리 상태를 덮어쓴다. 가져오기는 `normalizeShelfImport()` 를 반드시 통과한다.
 */
export interface ShelfExportItem {
  label: string;
  kind: ShelfItemKind;
  command?: string;
  prompt?: string;
  icon: string;
  color: string;
}

export interface ShelfExport {
  /** `SHELF_EXPORT_VERSION`. 모르는 버전은 거절한다. */
  version: number;
  /** 내보낼 때의 선반 이름(가져올 때 제안값으로만 쓴다). */
  title?: string;
  items: ShelfExportItem[];
}

// ─── §5.21 비용·토큰 지도 (Cost Map) ───

/**
 * §5.21 — 어느 단위에서든 같은 모양의 토큰 4종 + 비용.
 *
 * **입력을 뭉개지 않는다.** 캐시 읽기 단가는 입력의 1/10, 캐시 생성은 1.25배라 셋을 합쳐 버리면
 * 청구액과 자리수가 어긋난다(실측상 청구액의 대부분이 캐시 읽기에서 나온다).
 */
export interface CostTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** `calculateTokenCost` 로 4종을 각각 환산한 합(USD). */
  costUsd: number;
}

/** §5.21 — 팝업 기간 탭. 임의 구간 질의는 하지 않는다(사용자 달력과 같은 눈금이면 충분). */
export type CostPeriod = 'today' | 'week' | 'month' | 'all';

/** §5.21 — 기간 프리셋 4종을 서버가 미리 접어 실어 준다(클라이언트 재집계 ❌ — §3.1). */
export interface CostPeriodTotals {
  today: CostTotals;
  week: CostTotals;
  month: CostTotals;
  all: CostTotals;
}

/** §5.21 — 하루치 버킷. 키는 **로컬 날짜**(`YYYY-MM-DD`)다. */
export interface CostDayBucket extends CostTotals {
  date: string;
}

/**
 * §5.21 — 원장 한 줄 = 세션 하나. 에이전트·프로젝트 합계는 전부 여기서 접은 파생이며
 * 파생을 따로 누적하지 않는다(두 군데서 더하면 어긋났을 때 진실을 판정할 수 없다).
 */
export interface CostSessionEntry extends CostTotals {
  /** Claude Code 세션 ID(JSONL 파일명). */
  sessionId: string;
  /** 이 세션을 소유한 에이전트 버블 id. 모르면 비운다. */
  agentId?: string;
  /** 그 에이전트의 세션 탭(sub.id). */
  subAgentId?: string;
  /** 이 세션이 속한 프로젝트 이름. */
  projectName: string;
  /** 표에 보일 이름(세션 탭 라벨 또는 에이전트 이름). */
  label?: string;
  /** 마지막 턴이 말한 모델. */
  model?: string;
  /** 읽어들인 턴 수. 0 이면 `measured:false`. */
  turns: number;
  firstAt: number;
  lastAt: number;
  /** 턴을 하나라도 읽었는가. false 면 화면은 `$0.00` 이 아니라 "측정 없음"을 쓴다. */
  measured: boolean;
  /**
   * 날짜 키(`YYYY-MM-DD`) → 그 날 몫. **체크포인트에만 실린다** — 스냅샷에서는 생략해
   * 전선 용량을 아끼고(세션 × 날짜), 캡에 밀릴 때 이 분해가 `retired` 로 접힌다.
   */
  days?: Record<string, CostTotals>;
}

/** §5.21 — 에이전트 버블 한 장의 합(배지가 읽는 값). 세션 원장에서 접는다. */
export interface CostAgentTotal extends CostTotals {
  agentId: string;
  /** 버블 이름. */
  label?: string;
  /** 가장 최근 세션이 쓴 모델. */
  model?: string;
  /** 이 에이전트에 딸린 세션 수. */
  sessions: number;
  turns: number;
  lastAt: number;
  measured: boolean;
  /** 기간 탭 4종 — 표가 기간을 바꿔도 서버 값만 읽으면 되도록 미리 접어 둔다. */
  periods: CostPeriodTotals;
}

/**
 * §5.21 — 프로젝트 한 벌의 지도. `ProjectCheckpoint.costMap` 으로 영속되고
 * `GraphSnapshot.costMaps` 로 전선에 실린다(스냅샷 판에는 세션 `days` 가 없다).
 */
export interface ProjectCostMap {
  projectName: string;
  /** 세션 원장 — 최근 활동 순. `COST_MAP_SESSIONS_MAX` 로 자른다. */
  sessions: CostSessionEntry[];
  /** 에이전트 합 — 비용 내림차순. `COST_MAP_AGENTS_MAX` 로 자른다. */
  agents: CostAgentTotal[];
  /** 날짜 버킷 — 최신 순. `COST_MAP_DAYS_MAX` 로 자른다. */
  days: CostDayBucket[];
  /** 프로젝트 전체의 기간 탭 4종. */
  periods: CostPeriodTotals;
  /**
   * 캡에 밀려 원장에서 빠진 세션들의 몫. 합계가 줄지 않게 여기로 접는다 —
   * 사라지는 것은 "어느 세션이었나"라는 내역뿐이다(§9 키 개수 캡).
   */
  retired?: CostTotals;
  /** 이 프로젝트에서 턴을 하나라도 읽었는가. */
  measured: boolean;
  updatedAt: number;
}

// ─── 권한·감사 경계 (§5.22) ───

/**
 * §5.22 — 위험 동작 3종.
 *  - `delete`  지우는 명령·도구
 *  - `network` 바깥으로 나가거나 바깥에서 받아 오는 호출(루프백은 바깥이 아니다)
 *  - `config`  설정 파일 수정
 * 넷째를 늘리기 전에 그것이 정말 "실행 전에 사람을 세울 일"인지 먼저 묻는다.
 */
export type AuditRiskKind = 'delete' | 'network' | 'config';

/** §5.22 — 그 줄의 결정이 어디서 왔는가. `policy` = 모드가 사람 없이 답한 것. */
export type AuditDecisionSource = 'user' | 'timeout' | 'policy';

/**
 * §5.22 — 감사 원장 한 줄. "무슨 도구로 어디를 만졌나"와 "사람이 뭐라 답했나"가 같은 줄에 앉는다.
 * 도구 입력 전문은 담지 않는다 — 원장이 두 번째 트랜스크립트가 되면 그 자체가 부담이 된다.
 */
export interface AuditEntry {
  id: string;
  /** 호출이 도착한 시각(epoch ms). */
  at: number;
  projectName: string;
  sessionId: string;
  /** 이 호출을 낸 에이전트 버블 id(훅 세션이 버블에 귀속됐을 때). */
  agentId?: string;
  /** 그 에이전트의 세션 탭(sub.id). */
  subAgentId?: string;
  agentLabel?: string;
  /** 타임라인 좌측 dot 색(버블 색 그대로). */
  agentColor?: string;
  toolName: string;
  /** 사람이 읽는 한 줄 요약(`AUDIT_SUMMARY_MAX_CHARS` 로 자른다). */
  summary: string;
  /** 그 호출이 향한 곳 — 파일 경로 또는 호스트. 없으면 생략. */
  target?: string;
  /** 위험 판정 결과. 빈 배열 = 평범한 호출. */
  riskKinds: AuditRiskKind[];
  /** 모드가 통과시켰을 호출을 경계가 되돌려 사람에게 물었는가. */
  escalated?: boolean;
  /** 사람/정책의 답. 묻지 않고 지나간 호출은 **비어 있다**(허용과 다른 상태). */
  decision?: 'allow' | 'deny';
  decisionSource?: AuditDecisionSource;
  /** 거부 사유(사용자 입력) 또는 정책 마커. */
  decisionReason?: string;
  decidedAt?: number;
  /** 같은 호출의 Pre/Post 를 한 줄로 합치는 키. */
  toolUseId?: string;
}

/**
 * §5.22 — 프로젝트별 경계 스위치. 위험 동작을 **실행 전에 물을지**만 정한다 —
 * 기록을 끄는 스위치는 두지 않는다(감사의 값은 다 남는 데 있다).
 */
export interface AuditBoundaryConfig {
  /** 전체 스위치. 끄면 위험 동작도 묻지 않고 지나간다(기록은 계속). */
  escalateRisky: boolean;
  /** 종류별 스위치. 빠진 종류는 켜진 것으로 본다. */
  kinds: Partial<Record<AuditRiskKind, boolean>>;
}

/** §5.22 — 캡에 밀려 원장에서 빠진 줄들의 몫(숫자는 줄지 않는다 — §9). */
export interface AuditRetired {
  entries: number;
  risky: number;
  denied: number;
}

/** §5.22 — 서버가 접어서 실어 주는 집계(클라이언트에서 원장을 다시 세지 않는다 — §3.1). */
export interface AuditCounts {
  total: number;
  risky: number;
  denied: number;
  escalated: number;
  /** 로컬 날짜 기준 오늘 위험 호출 수(헤더 필이 읽는 값). */
  todayRisky: number;
}

/**
 * §5.22 — 프로젝트 한 벌의 감사 원장. `ProjectCheckpoint.auditLog` 로 영속되고
 * `GraphSnapshot.auditLogs` 로 전선에 실린다.
 */
export interface ProjectAuditLog {
  projectName: string;
  /** 최신 순. `AUDIT_ENTRIES_MAX_PER_PROJECT` 로 자른다. */
  entries: AuditEntry[];
  boundary: AuditBoundaryConfig;
  counts: AuditCounts;
  retired?: AuditRetired;
  updatedAt: number;
}

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
  icon: 'agent' | 'folder' | 'file' | 'terminal' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'conti' | 'auto' | 'brain' | 'trash' | 'video' | 'spec' | 'lab' | 'shelf';
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
  /**
   * §5.10 Project Brain — 커스텀 에이전트 휴지통. 커스텀 에이전트를 삭제하면 즉시 소멸/묘비
   * 기록 대신 이 플래그로 "휴지통 이동"(identity 보존). 묘비(`deletedCustomAgents`)는
   * 영구 삭제 시에만 찍는다(§3.2.1 급감 가드 관계 유지). BubbleData 는 그래프 직렬화로
   * ProjectCheckpoint·identity 에 자동 영속되므로 이 플래그도 재시작 시 함께 복원된다.
   */
  trashed?: boolean;
  /** §5.10 — 휴지통 이동 시각(epoch ms). trashed=true 일 때만 의미. */
  trashedAt?: number;
}

/**
 * §5.5 #17-12 — IDE 스트림 표시 밀도. **표시 계층 전용**(서버 미전달, 클라 localStorage 영속)이지만
 * 의존성 방향(stores → shared)상 store 와 컴포넌트가 함께 쓰려면 여기 있어야 한다.
 * `compact`=가장 많이 접음 / `standard`=기본 / `raw`=아무것도 접지 않음.
 */
export type StreamDensity = 'compact' | 'standard' | 'raw';

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
  /**
   * §7.11 v3.85 — 에이전트 신고(`POST /api/agent-iframe`)로만 알게 된 서버.
   * 기동 명령을 모르므로 `command` 는 신고 URL(표시용)이고 respawn(Restart/Start)은 불가하다.
   * Stop 은 `killByPort` 라 정상 동작. watcher 가 나중에 진짜 명령을 잡으면 승격되며 이 플래그는 사라진다.
   */
  reportedOnly?: boolean;
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
  /**
   * §2.4 (잠듦) — 유휴가 길어 **이 세션의 claude 자식 프로세스를 회수한 상태**.
   * 상태 유니온(`status`)은 건드리지 않는다(회수된 세션은 `idle`) — 화면 표시용 직교 축이다.
   * 다음 명령이 나가면 스폰 시점에 걷히고, `sessionId` 로 `--resume` 되어 대화가 이어진다.
   */
  dormant?: boolean;
  /** 잠든 시각(ms). `dormant` 가 false 면 의미 없다. */
  dormantSince?: number;
  /**
   * §4 (CMD 터미널 업그레이드 ①) — 이 세션이 **사용자 입력을 기다리며 멈춰 있는가**.
   * herdr 의 `blocked` 축 대응. `status` 유니온은 건드리지 않는다 — §2.4 '잠듦'(`dormant`)과
   * 같은 **직교 플래그**다(새 모양 발명 ❌). CMD(PTY) 세션에서만 세워지며 판정 근거는
   * 터미널 출력이다: 무출력 `CMD_BLOCKED_IDLE_MS` 경과 + 화면 꼬리가 `CMD_BLOCK_PATTERNS` 매치.
   * 바이트가 다시 흐르면 즉시 걷힌다. blocked 는 **살아 있는** 세션이라 §2.4 dormant 회수
   * 대상이 아니다(오히려 사용자를 부르는 상태다).
   */
  blocked?: boolean;
  /** blocked 로 바뀐 시각(ms). `blocked` 가 false 면 의미 없다. */
  blockedSince?: number;
  /** blocked 로 본 근거 한 줄(마지막 화면 꼬리 발췌). 표시·진단 전용. */
  blockedReason?: string;
  /**
   * §4 (CMD 터미널 업그레이드 ②) — 이 CMD 세션 PTY 의 전경 프로세스명(예: `claude`, `node`).
   * 탭 라벨 **보조** 표기 전용 — 라벨을 덮어쓰지 않는다(사용자 rename 우선).
   */
  foregroundProcess?: string;
  /**
   * §4 (CMD 터미널 업그레이드 ⑤) — 이 CMD 세션 탭의 pane 분할 트리.
   * undefined = 단일 pane(종전 동작). 그 탭의 표시 상태라 체크포인트에 영속된다.
   */
  paneTree?: CmdPaneNode;
  /** §5.7 #23-2 v1.60 — Agent View short id (해당 SubAgent 가 `--bg` 경로로 dispatch 된 경우) */
  agentViewShort?: string;
  /** §5.7 #23-2 v1.60 — Agent View 가 할당한 풀 sessionId (UUID) — `sessionId` 와 일치하지만
   *  발급 주체 구분 위해 별도 필드. legacy `-p` 경로에선 undefined. */
  agentViewSessionId?: string;
}

/**
 * §5.5 #17-9 v3.51 — 지금 백그라운드에서 도는 서브에이전트 1건.
 * 감독관(커스텀 에이전트)이 `Task`/`Agent` 도구로 띄운 자식 하나에 대응하며, PreToolUse 훅의
 * `tool_use_id` + `tool_input` 에서 그대로 뽑는다(새 수집 경로 신설 ❌ — §5.3 #12-1 v3.43 대차대조 재사용).
 * 런타임 전용 — 영속화 대상이 아니다.
 */
export interface RunningSubagentTask {
  /** 부모 Task 도구의 `tool_use_id`. 미상 페이로드면 서버가 만든 합성 키(`anon-N`). */
  id: string;
  /** 이 Task 를 띄운 부모(감독관) 에이전트 ID. */
  parentAgentId: string;
  /** 이 Task 를 띄운 세션 탭(sub.id). 훅에서 역조회 실패 시 undefined(= 메인 탭에서만 보임). */
  subAgentId?: string;
  /** `tool_input.description` — "무슨 내용인지" 한 줄. */
  description?: string;
  /** `tool_input.subagent_type` — 어떤 에이전트 타입으로 띄웠는지. */
  subagentType?: string;
  /** `tool_input.prompt` 앞부분 발췌(최대 200자). 설명이 없을 때의 대체 표시용. */
  prompt?: string;
  /** 시작 시각(ms epoch) — 경과 시간 표시용. */
  startedAt: number;
  /**
   * 이 항목을 무엇이 잡았는가.
   *  - `'hook'`   : `PreToolUse(Task|Agent)` 대차대조 — Task/Agent 서브에이전트.
   *  - `'stream'` : CLI 가 스트림에 흘린 `task_started` 칩 — `Bash run_in_background` · `Monitor` 처럼
   *    **훅으로는 보이지 않는** 백그라운드 작업. 종전에는 이 신호가 봉인을 3초 미루는 데만 쓰이고
   *    화면에는 한 글자도 안 나가, 그런 작업을 기다리는 세션이 **끝난 것처럼 보였다**.
   * 미지정이면 `'hook'`(기존 항목과 호환).
   */
  origin?: 'hook' | 'stream';
  /**
   * §5.5 #17-9 ⑦(a) — 공식 훅 공통 입력 필드 `agent_id`. 서브에이전트 **안에서** 훅이 발화할 때만
   * 존재하므로, 이 값이 붙었다는 것은 그 자식이 실제로 도구를 쓰기 시작했다는 뜻이다(항목 각인 키).
   */
  agentId?: string;
  /** 공식 훅 공통 입력 필드 `agent_type` — 자식이 스스로 밝힌 에이전트 이름(`subagent_type` 보강). */
  agentType?: string;
  /** 자식이 **지금** 쓰고 있는 도구 이름(`PreToolUse.tool_name`). */
  currentTool?: string;
  /** 그 도구가 무엇을 대상으로 하는지 한 줄(명령·파일·패턴 등, 최대 120자). */
  currentToolDetail?: string;
  /** 이 자식이 지금까지 쓴 도구 호출 수 — "일을 하고 있는가"의 유일한 정량 신호. */
  toolCount?: number;
  /** 자식 활동이 마지막으로 확인된 시각(ms epoch). 경과와 달리 **멈춰 있으면 멈춘다**. */
  lastActivityAt?: number;
}

/**
 * §5.5 #17-9 ⑦(b) — 방금 끝난 백그라운드 서브에이전트 1건.
 * `RunningSubagentTask` 가 대차대조에서 내려오는 순간 이 모양으로 옮겨지고, 부모가 받아 든 결과
 * (`PostToolUse(Task|Agent)` 의 `tool_response`)가 뒤따라 붙는다. 런타임 전용 — 영속화 대상이 아니다.
 */
export interface FinishedSubagentTask {
  /** 내려온 항목의 키(부모 Task 의 `tool_use_id` 또는 합성 키) 그대로. */
  id: string;
  parentAgentId: string;
  /** 이 Task 를 띄운 세션 탭(sub.id). 도는 항목과 같은 범위 산식을 쓰기 위해 함께 옮긴다. */
  subAgentId?: string;
  description?: string;
  subagentType?: string;
  agentType?: string;
  /** 시작·종료 시각(ms epoch) — 둘의 차가 소요 시간이다. */
  startedAt: number;
  endedAt: number;
  /** 끝날 때까지 쓴 도구 호출 수. */
  toolCount?: number;
  /** 부모가 받아 든 자식의 최종 보고 발췌(최대 1,200자). 아직 안 붙었으면 undefined. */
  result?: string;
  /**
   * 이 `result` 를 **훅이 아니라 디스크 트랜스크립트에서 건져 왔는가**(`subagentResultRescue.ts`).
   *
   * 프로세스 트리가 끊기면(사용자 [중지] · 탭 닫기 · 크래시) `SubagentStop` 도 `PostToolUse` 도
   * 발화하지 않아 결과 칸이 영영 비는데, 정작 자식이 해 놓은 일은 트랜스크립트에 온전히 남는다.
   * 그때 건져 온 본문이라는 표식 — 사용자가 "부모가 실제로 받아 든 보고"와 구별할 수 있게 한다
   * (이 보고는 **부모 세션에는 전달되지 않았다**).
   */
  resultRescued?: boolean;
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
/**
 * §5.5 #17-18 v4.68 — 큐에 든 명령(주로 실행 중에 넣은 "덧말")을 어떻게 꺼낼지.
 *  - `wait`      : 혼자 한 턴 (v4.68 이전 동작)
 *  - `merge`     : 뒤따르는 merge 명령과 한 프롬프트로 합쳐 한 턴에 (기본값)
 *  - `immediate` : 지금 도는 턴을 끊고(중지 + `--resume` 재개) 바로 이어서
 */
export type CommandDispatchMode = 'wait' | 'merge' | 'immediate';

/**
 * §5.5 #17-12 ③ — 명령이 오류로 끝난 **이유**의 분류.
 * 화면이 "오류" 한 단어만 띄우고 원인을 삼키던 것을 막기 위한 표시용 코드 —
 * 서버는 코드·종료코드·원문 꼬리만 싣고, 사람이 읽을 문장은 클라가 로케일로 만든다.
 *  - `spawn`     : CLI 프로세스를 띄우지 못함(경로·권한·실행 실패)
 *  - `stdin`     : 살아있는 자식에 프롬프트를 넣지 못함(파이프가 이미 닫힘)
 *  - `exit`      : CLI 가 0 이 아닌 코드로 종료(사유는 stderr 꼬리)
 *  - `crash`     : 재사용 중이던 자식이 예기치 않게 죽음
 *  - `cli`       : CLI 가 result 라인에서 `is_error` 로 실패를 신고(본문이 사유)
 *  - `maxTurns`  : 설정한 최대 턴에 닿아 우리가 중단
 *  - `agentView` : agent-view 잡이 `failed` 로 끝남
 *  - `orphaned`  : 서버 재기동으로 실행 컨텍스트가 끊김
 */
export type CommandErrorCode =
  | 'spawn' | 'stdin' | 'exit' | 'crash' | 'cli' | 'maxTurns' | 'agentView' | 'orphaned'
  // §5.19 — 로컬 LLM 턴 실패(엔진 미설치·모델 없음·생성 중 오류). CLI 가 없는 경로라 'cli' 와 구분한다.
  | 'local';

/** §5.5 #17-12 ③ — 오류로 끝난 명령의 사유(표시 전용, 실행·판정 로직 미관여). */
export interface CommandError {
  code: CommandErrorCode;
  /** 프로세스 종료 코드(있을 때만). */
  exitCode?: number;
  /** 원문 꼬리 — stderr 마지막 줄·예외 메시지·CLI 오류 본문. **번역하지 않고** 그대로 보여준다. */
  detail?: string;
}

export interface QueuedCommand {
  id: string;
  text: string;
  timestamp: number;
  /** 실행할 subagent ID (null이면 새 세션 자동 생성) */
  subAgentId: string | null;
  /**
   * §5.5 #17-18 ⑥ — 이 명령이 **실제로 나간** 시각(`queued → executing` 전이 시점).
   * `timestamp`(= 큐에 넣은 시각)와 다르다: 실행 중에 넣은 덧말은 둘 사이가 몇 분씩 벌어진다.
   * 화면은 이 값으로 말풍선 자리를 고정해 **턴이 끊긴 자리**를 만든다 — 없으면(이 필드 이전의
   * 옛 명령) 종전대로 `timestamp` 로 정렬한다.
   *
   * ⑥-5 — **한 명령에 한 번만 찍는다.** 앱이 내려가 재개하거나(`restartResumed`) 창구가 닫혀 큐로
   * 되돌린 재시도는 **같은 턴의 이어달리기**라, 다시 찍으면 말풍선이 자기가 이미 뱉어 놓은 출력
   * 아래로 내려앉는다. 값이 있다는 것은 곧 "이 명령은 나간 적이 있다"는 뜻이다.
   */
  startedAt?: number;
  /** 실행 상태 */
  status: 'queued' | 'executing' | 'completed' | 'error';
  /** 실행 결과 (completed 시) */
  result?: string;
  /**
   * §5.5 #17-12 ③ — `status === 'error'` 로 끝난 이유. 없으면 사유를 알 수 없는 옛 명령이다.
   * 하단 상태바·스트림·메인 타임라인이 이걸 읽어 "오류" 한 단어 대신 무슨 오류인지 말한다.
   */
  error?: CommandError;
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
   * v1.79→v1.80 — 서버 재시작으로 끊긴 커스텀 에이전트 명령을 `[orphaned]` 에러로 봉합하지 않고
   * 보존된 세션(sub.sessionId)으로 자동 재개(re-queue)했음을 표시. **게이트가 아니라 진단용
   * 누적 표식이다** — v1.79 의 one-shot 가드는 서버를 두 번 재시작하면 2번째부터 무조건
   * `[orphaned]` 로 떨어뜨려 잘못이었고, 재개는 사용자의 실제 재시작 1건에 대응하므로 횟수 캡이
   * 없다(`projectGraph` reconcile 참조).
   *
   * §5.5 #17-18 ⑥-5 — 이 표식이 붙은 명령은 **이미 한 번 나간** 명령이다. 재개하려고 `status` 가
   * `queued` 로 돌아가 있어도 말풍선 자리는 `startedAt`(처음 나간 시각) 그대로여야 한다 —
   * 재개는 같은 턴의 이어달리기지 새 턴이 아니다.
   */
  restartResumed?: boolean;
  /**
   * §5.5 #17-18 v4.68 — 이 명령의 dispatch 방식. 미지정이면 `DEFAULT_COMMAND_DISPATCH_MODE`(=`merge`).
   * 큐에 있는 동안 `PATCH /api/commands/:sessionId/:commandId/mode` 로 바꿀 수 있다.
   */
  dispatchMode?: CommandDispatchMode;
  /**
   * §5.5 #17-18 v4.68 — 합치기로 이 명령에 흡수된 뒤따른 덧말 수(표시 전용 배지).
   * 0/undefined = 단독 dispatch.
   */
  mergedCount?: number;
}

/**
 * §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 방식.
 * - `count`: `total` 회 채우면 자연 종료.
 * - `infinite`: 사용자가 멈추기 전까지 계속.
 */
export type SessionLoopMode = 'count' | 'infinite';

/**
 * §5.5 #17-11 v3.79 — 루프 진행 상태 (서버가 판정, 클라는 표시만).
 * - `idle`: 설정만 있고 꺼져 있음.
 * - `running`: 지금 한 회차가 세션에서 실행 중.
 * - `waiting`: 회차 사이 대기(`nextRunAt` 까지).
 * - `done`: `count` 목표 도달로 정상 종료.
 * - `stopped`: 사용자 중지(세션 중지/전체 중지/정지 버튼)로 멈춤.
 * - `error`: 회차가 실패했고 `stopOnError` 라서 멈춤.
 * - `budget`: §5.5 #17-11 ⑫(a) 예산(비용·토큰·시간) 상한에 닿아 회차 경계에서 멈춤.
 */
export type SessionLoopStatus = 'idle' | 'running' | 'waiting' | 'done' | 'stopped' | 'error' | 'budget';

/**
 * §5.5 #17-11 ⑫(b) — 회차 사이 컨텍스트 처리.
 * - `none`: 아무것도 하지 않는다(기본 — 종전 동작).
 * - `compact`: `/compact` 로 요약 압축(대화 맥락을 요약으로 남긴다).
 * - `clear`: `/clear` 로 완전 초기화(회차마다 새 컨텍스트 — 기억은 진행 파일·git 에 둔다).
 */
export type SessionLoopContextMode = 'none' | 'compact' | 'clear';

/**
 * §5.5 #17-11 v3.79 — IDE 내부 세션(탭) 하나에 붙는 반복 명령 설정.
 *
 * 소유 단위가 **에이전트가 아니라 세션 탭(subAgentId)** 인 것이 이 기능의 핵심 —
 * 탭마다 다른 명령·다른 횟수를 갖고, 탭을 바꾸면 그 탭의 루프가 보인다.
 * 한 회차는 기존 명령 큐(`QueuedCommand`)에 그대로 얹히므로 dispatch·스트림·중지·아카이브
 * 경로가 사용자가 직접 보낸 명령과 완전히 동일하다(새 실행 레일 없음).
 */
export interface SessionLoop {
  /** 소유 (부모) 에이전트 버블 ID — 프로젝트 필터·영속 분류 키. */
  agentId: string;
  /** 이 루프가 붙은 IDE 내부 세션(탭) ID. 맵의 키와 동일. */
  subAgentId: string;
  /** 매 회차 세션에 넣을 명령 본문. */
  command: string;
  /** 반복 방식. */
  mode: SessionLoopMode;
  /** `mode==='count'` 일 때 목표 횟수 (1 ~ SESSION_LOOP_MAX_ITERATIONS). */
  total?: number;
  /** 지금까지 완료한 회차 수. */
  completed: number;
  /** 켜져 있는가 = 다음 회차를 계속 낼 것인가. */
  enabled: boolean;
  /** 회차 사이 대기(ms). 0 이면 직전 회차 완료 즉시 다음. */
  intervalMs: number;
  /** 회차가 error 로 끝나면 자동 정지할지. */
  stopOnError: boolean;
  /**
   * §5.5 #17-11 ⑪·⑫(b) — 한 회차가 끝날 때마다 다음 회차 **전에** 컨텍스트를 어떻게 할지.
   * 기본 `'none'`(기존 루프 동작 무변경). 이 정리 명령은 회차로 계수하지 않는다.
   */
  contextMode: SessionLoopContextMode;
  /**
   * §5.5 #17-11 ⑫(a) — 누적 비용 상한(USD). 미설정·0 이면 무제한.
   * 넘으면 회차 경계에서 `status='budget'` 으로 정지한다(돌고 있는 회차는 끊지 않는다).
   */
  maxCostUsd?: number;
  /** §5.5 #17-11 ⑫(a) — 누적 토큰(입력+출력) 상한. 미설정·0 이면 무제한. */
  maxTokens?: number;
  /** §5.5 #17-11 ⑫(a) — 사이클 시작(`cycleStartedAt`)부터의 벽시계 상한(ms). 미설정·0 이면 무제한. */
  maxDurationMs?: number;
  /**
   * §5.5 #17-11 ⑫(a) — 이번 사이클에서 지금까지 쓴 **추정** 비용(USD).
   * 명령 단위 토큰 델타에 캐시 읽기/쓰기 구분이 없어 전부 입력가로 환산하므로 실제보다 크게 잡힌다.
   */
  spentCostUsd: number;
  /** §5.5 #17-11 ⑫(a) — 이번 사이클 누적 토큰(입력+출력). */
  spentTokens: number;
  /** §5.5 #17-11 ⑫(a) — 이번 사이클이 시작된 시각(epoch ms) — 벽시계 상한의 기준. */
  cycleStartedAt?: number;
  /**
   * §5.5 #17-11 ⑫(c) — 진행 파일 경로(프로젝트 기준 상대). 설정하면 회차 프롬프트에
   * "시작 전에 읽고 끝나면 갱신하라"는 규약이 붙는다 — 압축·초기화로 대화가 날아가도 이어진다.
   */
  progressFile?: string;
  /** §5.5 #17-11 ⑫(d) — "한 회차엔 한 가지 일만" 규칙을 회차 프롬프트에 주입할지. */
  oneTaskPerRound: boolean;
  /** §5.5 #17-11 ⑫(e) — 회차에서 실제 변경이 있으면 커밋하라는 규약을 주입할지(커밋 주체는 에이전트). */
  commitEachRound: boolean;
  /**
   * §5.5 #17-11 ⑫(f) — 매 회차 본문을 읽어올 파일 경로(프로젝트 기준 상대).
   * 설정하면 루프가 도는 중에 파일만 고쳐도 다음 회차부터 반영된다. 읽기 실패 시 `command` 로 계속.
   */
  commandFile?: string;
  /** 진행 상태 (서버 판정). */
  status: SessionLoopStatus;
  /** 지금 도는 회차의 `QueuedCommand.id` — 완료 대조용(이 id 가 끝나야 다음 회차). */
  pendingCommandId?: string;
  /**
   * §5.5 #17-11 ⑪ — 회차 사이에 끼워 넣은 압축 명령의 `QueuedCommand.id`.
   * 이 명령이 끝나야 다음 회차를 예약한다(런타임 대조용 — 복원 시에는 비운다).
   */
  pendingCompactCommandId?: string;
  /** `waiting` 중일 때 다음 회차 예정 시각 (epoch ms). */
  nextRunAt?: number;
  /** 마지막 회차 시작 시각 (epoch ms). */
  lastRunAt?: number;
  /** 마지막 회차의 오류 요약 (표시용, 성공 시 비움). */
  lastError?: string;
  /** 생성 시각. */
  createdAt: number;
  /** 마지막 변경 시각. */
  updatedAt: number;
}

/**
 * §5.5 #17-17 v4.46 — 세션 목표의 생애 상태.
 * - `active`: 진행 중 — 매 턴 dispatchContext 에 주입돼 세션이 이 목표를 향해 간다.
 * - `achieved`: 사용자가 "달성"으로 닫음(기록은 남되 주입은 멈춘다).
 * - `abandoned`: 사용자가 접음(같은 이유로 주입 멈춤).
 */
export type SessionGoalStatus = 'active' | 'achieved' | 'abandoned';

/**
 * §5.5 #17-17 v4.46 — 진행률이 어디서 왔는가.
 * - `agent`: 주입 지시문을 받은 에이전트가 턴 끝에 스스로 신고.
 * - `user`: 사용자가 목표 패널에서 직접 보정.
 * - `plan`: 아직 아무 신고도 없을 때의 자동 폴백 — `TodoWrite` 계획의 완료/전체.
 */
export type SessionGoalProgressSource = 'agent' | 'user' | 'plan';

/**
 * §5.5 #17-17 v4.47 — 목표 단계 하나의 상태 (todo 와 같은 3단).
 * - `pending`: 아직 안 함.
 * - `in_progress`: 지금 하는 중(화면에서 강조).
 * - `done`: 끝남 — 퍼센트를 올리는 것은 이것뿐이다.
 */
export type SessionGoalStepStatus = 'pending' | 'in_progress' | 'done';

/**
 * §5.5 #17-17 v4.47 — 최종 목표로 가는 단계 하나(체크리스트 항목).
 *
 * 사용자가 직접 적어 넣기도 하고, 에이전트가 진행 신고에 `steps` 를 실어 통째로 갱신하기도 한다.
 * 서버가 본문이 같은 기존 단계의 `id` 를 재사용하므로, 목록이 다시 와도 화면의 체크박스가 튀지 않는다.
 */
export interface SessionGoalStep {
  /** 단계 고유 id — 화면 key·부분 갱신용. */
  id: string;
  /** 단계 본문 (`SESSION_GOAL_STEP_TEXT_MAX` 로 자른다). */
  text: string;
  /** 진행 상태 — `done` 개수가 곧 퍼센트다. */
  status: SessionGoalStepStatus;
  /** 마지막 상태 변경 시각 (epoch ms). */
  updatedAt: number;
}

/** §5.5 #17-17 v4.46 — 진행률 갱신 1건 (ring buffer 로 `SessionGoal.history` 에 쌓인다). */
export interface SessionGoalProgress {
  /** 갱신 시각 (epoch ms). */
  at: number;
  /** 그 시점 진행률 (0~100 정수). */
  percent: number;
  /** 한 줄 근거 ("A/B 끝, C 남음"). 없을 수 있다. */
  note?: string;
  /** 출처 — 화면에 배지로 그대로 보인다(사용자가 "누가 매긴 숫자냐"를 알 수 있게). */
  source: SessionGoalProgressSource;
}

/**
 * §5.5 #17-17 v4.46 — IDE 내부 세션(탭) 하나가 향하는 목표.
 *
 * 소유 단위가 **에이전트가 아니라 세션 탭(subAgentId)** 인 것은 루프(`SessionLoop`)와 같은 축이다.
 * 목표는 명령을 발사하지 않는다 — 매 턴 dispatchContext 에 다시 실려 세션의 *방향*만 잡고,
 * 그 방향으로 얼마나 왔는지를 `percent` 하나로 사용자에게 답한다.
 */
export interface SessionGoal {
  /** 소유 (부모) 에이전트 버블 ID — 프로젝트 필터·영속 분류 키. */
  agentId: string;
  /** 이 목표가 붙은 IDE 내부 세션(탭) ID. 맵의 키와 동일. */
  subAgentId: string;
  /**
   * 지금 이 세션이 향하는 목표 한 문장.
   * §5.5 #17-17 v4.50 — **원칙적으로 세션이 쓴다**(계획을 세우는 순간 자동 생성 / 에이전트가 신고로 다듬음).
   * 사용자도 사이드바에서 고칠 수 있고, 그러면 `authoredBy='user'` 가 되어 자동 교체가 멈춘다.
   */
  text: string;
  /**
   * §5.5 #17-17 v4.50 — 목표 문장을 마지막으로 쓴 주체.
   * - `session`: 세션이 스스로 쓴 것 — 새 명령이 오면 새 목표로 **자동 교체**된다.
   * - `user`: 사용자가 손댄 것 — 세션이 덮어쓰지 않는다(사용자가 준 방향을 다음 명령이 지우면 안 되므로).
   */
  authoredBy: 'session' | 'user';
  /**
   * §5.5 #17-17 v4.50 — 이 목표가 딸려 나온 세션 명령(자동 생성·자동 교체 판단 기준).
   * 세션의 현재 명령이 이것과 달라지면 "새 일을 시작했다"는 뜻이다.
   */
  sourceCommand?: string;
  /**
   * §5.5 #17-17 v4.47 — 최종 목표로 가는 단계 체크리스트(todo 모양).
   * 비어 있을 수 있다(그때만 퍼센트가 신고·계획 폴백에서 온다 — ③).
   */
  steps: SessionGoalStep[];
  /**
   * 현재 진행률 (0~100 정수, 서버 판정).
   * `steps` 가 하나라도 있으면 **항상** `done/전체` 파생값이다(신고 숫자보다 체크리스트가 우선).
   */
  percent: number;
  /** 생애 상태 — `active` 일 때만 주입된다. */
  status: SessionGoalStatus;
  /** 마지막 진행 갱신의 한 줄 근거 (표시용). */
  note?: string;
  /** 진행 갱신 이력 (오래된 것부터, `SESSION_GOAL_HISTORY_MAX` ring buffer). */
  history: SessionGoalProgress[];
  /**
   * 목표 문장이 바뀐 횟수 — "수시로 바꾼다"는 사용 양상을 그대로 드러내는 카운터이자,
   * plan 자동 폴백의 재개통 기준(아래 `lastExplicitRevision` 과 짝).
   */
  revision: number;
  /**
   * 마지막 **명시** 신고(agent·user)가 온 시점의 `revision`. 이 값이 현재 `revision` 과 같으면
   * plan 자동 폴백은 더 이상 퍼센트를 덮지 않는다(§5.5 #17-17 ③ 우선순위).
   * 시각이 아니라 개정 번호로 판정하는 이유 — 목표 수정과 신고가 같은 밀리초에 들어오면
   * 타임스탬프 비교로는 갈리지 않는다(실제로 그렇게 막혔다).
   */
  lastExplicitRevision?: number;
  /** 마지막 명시 신고 시각 (epoch ms, 표시용). */
  lastExplicitAt?: number;
  /** 마지막 진행 갱신 시각 (출처 무관). */
  lastProgressAt?: number;
  /** 생성 시각. */
  createdAt: number;
  /** 마지막 변경 시각. */
  updatedAt: number;
}

// ─── §5.5 #17-28 컨텍스트 주입원 통제 (Context Inventory) ───
//
// "이 세션의 프롬프트에 실제로 무엇이 실리는가"를 **매번 읽어** 목록으로 세우고, 각 줄을 사용자가
// 끄고 켤 수 있게 하는 축. 하드코딩 목록이 아니라 그때그때의 실측이라 프로젝트·세션마다 다르다.
//
// 규율 셋:
//  · **최종 권한** — 여기서 끈 항목은 다른 화면(플러그인 창·에이전트 설정 등)에서 켜져 있어도 안 실린다.
//  · **읽어서 만든다** — 항목·글자수·토큰은 파일과 그 턴의 조립 결과에서 나온다(고정 표 ❌).
//  · **못 끄는 것은 못 끈다고 말한다** — Claude Code 내부 프롬프트처럼 우리가 손댈 수 없는 줄은
//    계측만 하고 토글을 잠근다(`control: 'none'`). 끌 수 있는 척하지 않는다.

/** 주입원 분류 — 화면의 묶음이자 필터 축. */
export type ContextSourceCategory =
  /** Vibisual 이 프롬프트에 직접 조립해 넣는 블록. */
  | 'vibisual'
  /** 지시 파일 — CLAUDE.md · rules · AGENTS.md. */
  | 'instructions'
  /** 기억 — 자동 기억(MEMORY.md) · Project Brain. */
  | 'memory'
  /** 스킬 · 슬래시 커맨드 · 서브에이전트 정의. */
  | 'skills'
  /** 도구 정의 · MCP. */
  | 'tools'
  /** Claude Code 자체 시스템 프롬프트. */
  | 'system'
  /** §5.11 집행 플러그인. */
  | 'plugins';

/**
 * 이 줄을 끄는 수단 — 곧 "언제 반영되는가"이기도 하다.
 * - `session`: 우리가 프롬프트를 조립하며 그 자리에서 뺀다 → **다음 프롬프트부터 즉시**.
 * - `spawn`: CLI 인자·환경변수로 끈다 → 매 턴 새 프로세스를 띄우므로 이 역시 다음 프롬프트부터.
 * - `external`: 여기서 끄는 대신 다른 설정 화면이 주인인 값(예: 도구 목록) — 토글은 잠기고 안내만.
 * - `none`: 끌 수단이 없다(Claude Code 내부). 계측·표시 전용.
 */
export type ContextSourceControl = 'session' | 'spawn' | 'external' | 'none';

/** 한 주입원 안의 내역 한 줄 — 표시 전용(개별 토글 없음). */
export interface ContextSourceChild {
  /** 사람이 읽는 이름(파일명·스킬명 등). */
  title: string;
  /** 절대경로(있으면). 화면이 그대로 보여 준다. */
  path?: string;
  /** 실측 글자 수. */
  chars: number;
  /** 추정 토큰. */
  tokens: number;
  /** 파일 수정 시각(epoch ms) — 날짜 정렬의 근거. */
  updatedAt?: number;
}

/** 주입원 한 줄. */
export interface ContextSourceItem {
  /** 안정 키 — 토글 오버라이드의 저장 키다(파일 경로가 바뀌어도 유지되도록 종류 기반). */
  id: string;
  category: ContextSourceCategory;
  /**
   * i18n 키(고정 항목). 있으면 화면이 이것을 번역해 제목으로 쓴다.
   * 파일·플러그인처럼 실측에서 나온 이름은 `title` 을 그대로 쓴다.
   */
  labelKey?: string;
  /** 실측 제목(번역 대상이 아닌 고유명 — 파일명·플러그인 id 등). */
  title: string;
  /** 부연 한 줄(경로 요약·개수 등). */
  detail?: string;
  /** 대표 경로(있으면). */
  path?: string;
  /** 이 항목이 프롬프트에 더하는 글자 수(실측). 계측 불가면 0. */
  chars: number;
  /** 추정 토큰 — `estimateTokens` 산식. */
  tokens: number;
  /** 토큰이 실측이 아니라 어림값이면 true(화면이 `~` 를 붙인다). */
  estimated?: boolean;
  control: ContextSourceControl;
  /** 오버라이드가 없을 때 실제로 실리는가(= 지금 설정 그대로의 기본값). */
  defaultEnabled: boolean;
  /** 오버라이드까지 반영한 **최종** 결과 — 이 값이 곧 프롬프트에 실리는지 여부다. */
  enabled: boolean;
  /** 오버라이드가 걸려 기본값과 달라졌으면 그 층. 없으면 undefined. */
  overrideScope?: 'project' | 'session';
  /** 가장 최근 변경 시각(파일 mtime 등). 날짜 정렬 기준. */
  updatedAt?: number;
  /** 내역(파일 목록 등) — 접었다 펼치는 자리. */
  children?: ContextSourceChild[];
  /**
   * 끌 때 알아야 할 주의 한 줄의 i18n 키(예: 훅을 끄면 화면 갱신이 끊긴다).
   * 화면이 경고 색으로 보여 준다.
   */
  warnKey?: string;
  /** `external` 일 때 어디서 조절하는지 알려 주는 i18n 키. */
  hintKey?: string;
}

/** 한 세션(또는 프로젝트) 기준의 주입원 전수 목록. */
export interface ContextInventory {
  /** 기준 에이전트 버블. */
  agentId: string;
  /** 기준 세션 탭. 없으면 프로젝트 기준(세션 오버라이드 미적용). */
  subAgentId?: string;
  /** 이 목록을 잰 프로젝트 루트. */
  projectPath: string;
  /** 세션이 실제로 도는 폴더. */
  cwd: string;
  /** 잰 시각(epoch ms). */
  at: number;
  items: ContextSourceItem[];
  /** 전 항목 토큰 합. */
  totalTokens: number;
  /** 켜진 항목만의 토큰 합 — "지금 이 프롬프트가 얼마짜리인가". */
  enabledTokens: number;
}

/** 주입원 id → 켬(true)/끔(false). 없는 키는 오버라이드 없음(= 기본값 따름). */
export type ContextOverrideMap = Record<string, boolean>;

/**
 * 주입원 오버라이드 묶음(영속 대상). 층이 둘인 것은 사용자가 말한 그대로다 —
 * "세션별로 다르고 프로젝트별로 달라야 한다". **세션 층이 프로젝트 층을 이기고**,
 * 둘 다 없으면 그 항목의 기본값을 쓴다.
 *
 * 프로젝트별 체크포인트에 실릴 때는 그 프로젝트의 몫만 담기고(키 하나짜리 `projects`),
 * 스냅샷에는 열려 있는 프로젝트들의 것이 함께 실린다 — 모양이 같으므로 병합이 곧 키 합치기다.
 */
export interface ContextOverrides {
  /** 프로젝트 키(ProjectInfo.name) → 그 프로젝트의 모든 세션에 걸리는 오버라이드. */
  projects: Record<string, ContextOverrideMap>;
  /** subAgentId → 그 세션에만 걸리는 오버라이드(프로젝트 층보다 우선). */
  sessions: Record<string, ContextOverrideMap>;
  /** 마지막 변경 시각. */
  updatedAt: number;
}

/**
 * §5.5 #17-28 ⑦ — 주입원 한 줄의 **상세**(상세창이 받는 것).
 *
 * `text` 는 설명용으로 따로 만든 사본이 아니라 **그 턴에 실제로 조립된 문자열**이다. 사본을 보여 주면
 * 그 순간부터 화면이 프롬프트와 다른 말을 하기 시작하고, 그것이 이 기능의 유일한 실패 방식이다(①).
 */
export interface ContextSourcePreview {
  /** 어느 줄인가 — `ContextSourceItem.id` 와 같다. */
  sourceId: string;
  /** 프롬프트에 실제로 더해지는 본문(또는 `filePath` 로 물었으면 그 파일의 내용). */
  text: string;
  /** 본문이 상한(`CONTEXT_PREVIEW_MAX_CHARS`)을 넘어 앞부분만 담겼는가. */
  truncated: boolean;
  /** 자르기 전 전체 글자 수. */
  chars: number;
  /** 자르기 전 전체 기준 추정 토큰. */
  tokens: number;
  /**
   * 본문을 읽을 수 없는 줄인가(Claude Code 실행본 안에 있어 계측만 하는 것들 — 시스템 프롬프트·
   * 번들 스킬·도구 스키마·MCP·워크플로). 화면은 빈 칸 대신 "왜 못 보여 주는가"를 적는다.
   */
  unreadable: boolean;
  /** 지금 담긴 본문이 파일 하나의 내용이면 그 절대경로. */
  filePath?: string;
  /** 이 줄이 싣는 파일들 — **여기 있는 경로만** 열 수 있다(임의 파일 열람 창구 방지). */
  files: ContextSourceChild[];
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
  | 'agent_status'
  | 'command'
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
  // §9 스코프드 스냅샷 구독 — 창이 "내가 지금 필요한 프로젝트"를 선언(클라→서버, 응답 없음)
  | 'set-project-scope'
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
  | 'claude_setup_progress'
  // §5.19 — 로컬 LLM 엔진 설치 / 모델 내려받기 진행(본체는 graph_snapshot.localLlm)
  | 'local_engine_progress'
  | 'local_model_progress'
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
  | 'agent_list'
  // §4 v3.21 — 에이전트 피드백(좋아요/싫어요) 갱신 신호. 본체는 graph_snapshot.agentFeedbacks
  | 'agent_feedback'
  // §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층의 상태/출력 푸시. 본체는 DebugEventPayload.
  // 세션은 프로세스 수명이라 graph_snapshot 에 싣지 않고 이 메시지로만 흐른다.
  | 'debug_event'
  // §5.5 #17-32 ⑤ — 훅이 방금 발동했다는 순간 신호. 본체는 HookFiredPayload[] (짧은 창으로 모아 한 건).
  //   세션 수명의 표시 전용 신호라 graph_snapshot 에 싣지 않는다(debug_event 와 같은 규약).
  | 'hook_fired';

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
  /**
   * §5.22 — 이 호출의 위험 판정(`classifyToolRisk` 결과). 비었으면 평범한 호출이고,
   * 값이 있으면 승인 카드 위에 위험 배지가 붙는다.
   */
  risk?: AuditRiskKind[];
  /**
   * §5.22 — 모드가 통과시켰을 호출을 감사 경계가 되돌려 물은 것인가.
   * 카드가 "왜 지금 묻는지"를 한 줄로 말할 수 있게 하는 표식.
   */
  escalated?: boolean;
  /** §5.22 — 이 요청이 원장의 어느 줄인지(결정을 그 줄에 적기 위한 키). */
  auditEntryId?: string;
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
 * §4 (첫 실행 설치 온보딩) — `claude` 실행본의 출처. `resolveClaudeBin()` 이 경로 패턴으로 판정.
 *
 * - `'native'` = 공식 네이티브 인스톨러가 깐 위치(`~/.local/bin`, `~/.local/share/claude/versions` 등).
 *   **우리 앱이 직접 설치·관리하는 출처라 우선순위 최상위**(사용자 override 다음).
 * - `'vscode-extension'` = `~/.vscode/extensions/anthropic.claude-code-*` 하위. 마켓플레이스 밖에서
 *   갱신할 수 없어 자동 업데이트 ❌ — 안내만 한다. 우선순위는 native 뒤로 내려간다.
 * - `'path'` = PATH / npm global 등 그 밖의 실제 설치본. `npm install -g` 자동 갱신 가능.
 * - `'unknown'` = 검출 자체 실패(어디에도 없음) — 설치 온보딩 게이트가 뜨는 상태.
 */
export type ClaudeBinSource = 'native' | 'vscode-extension' | 'path' | 'unknown';

/**
 * §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 여부 판정 결과. 글로벌 1건.
 *
 * 앱만 내려받은 사람은 CLI 가 없을 수 있는데, §4 v4.82 로그인 팝업은 `error`(판정 불가)면 뜨지
 * 않도록 설계돼 있어 **아무 안내도 못 받는 구멍**이 있었다. 이 상태가 그 구멍을 메운다 —
 * `phase === 'missing'` 이면 클라가 권장형 설치 게이트를 띄운다(차단 ❌, 닫으면 상단 배너로 잔류).
 *
 * 영속화 ❌ — 설치 여부는 디스크를 보면 알 수 있는 파생 사실이고, 프로젝트가 아니라 기기에
 * 매인 값이라 `ProjectCheckpoint` 에 넣지 않는다(런타임 캐시 + 스냅샷 전달).
 */
export type ClaudeSetupPhase =
  /** 아직 판정 전(부팅 직후) — 게이트를 띄우지 않는다. */
  | 'unknown'
  /** 쓸 수 있는 실행본이 없다 → 설치 권장 게이트. */
  | 'missing'
  /** 네이티브 인스톨러 실행 중. */
  | 'installing'
  /** 설치·검증 완료(또는 처음부터 깔려 있었음). */
  | 'ready'
  /** 설치를 시도했으나 실패 — 수동 명령 안내로 떨어진다. */
  | 'failed';

/** §4 (첫 실행 설치 온보딩) — `GraphSnapshot.claudeSetup` + `GET /api/claude-setup` 응답. */
export interface ClaudeSetupState {
  phase: ClaudeSetupPhase;
  /** 판정된 실행본 절대 경로. `phase==='missing'` 이면 없음. */
  binPath?: string;
  /** 검증된 버전("2.1.211" 등). 검출 실패 시 없음. */
  version?: string;
  /** 실행본 출처 — 배지 표시용. */
  source?: ClaudeBinSource;
  /**
   * 이 플랫폼에서 자동 설치를 시도할 수 있는가. 지원 플랫폼(win32/darwin/linux)이면 true.
   * false 면 게이트는 [설치하기] 대신 수동 명령만 보여준다.
   */
  canAutoInstall: boolean;
  /**
   * 자동 설치가 실행할(또는 사용자가 직접 칠) 공식 네이티브 인스톨러 명령 — **플랫폼별 동적**.
   * 화면의 "직접 설치" 안내와 서버가 실제로 spawn 하는 명령이 **같은 문자열**이어야 안내와 동작이
   * 어긋나지 않으므로 서버가 조립해 내려보낸다.
   */
  installCommand: string;
  /** 공식 설치 문서 URL — 자동 설치가 막혔을 때의 탈출구. */
  docsUrl: string;
  /** 마지막 판정 시각(Date.now()). */
  checkedAt: number;
  /** `phase==='failed'` 일 때 사람 읽기용 원인. */
  error?: string;
}

/**
 * §4 (첫 실행 설치 온보딩) — 네이티브 인스톨러 실행 진행 상황.
 * WS `claude_setup_progress` payload + REST 동기 응답 dual-use
 * (§5.7 #23-1 `ClaudeInstallProgress` 와 같은 모양 — 같은 in-flight 세션 패턴을 쓴다).
 */
export interface ClaudeSetupProgress {
  /** 설치 시도 식별자 — 중복 호출 시 같은 in-flight 작업 ID 반환 */
  setupId: string;
  status: 'starting' | 'running' | 'done' | 'error';
  /** 누적 stdout/stderr 전체 (ANSI 미스트립) */
  output?: string;
  /** done/error 시 spawn exit code */
  exitCode?: number;
  /** done 시 새로 검증된 실행본 경로 */
  binPath?: string;
  /** done 시 새로 검증된 버전 */
  version?: string;
  /** error 시 사람 읽기용 메시지 */
  error?: string;
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
  /** 바이너리 출처 — 판정 규칙은 `ClaudeBinSource` 주석 참고. */
  source: ClaudeBinSource;
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
  source: ClaudeBinSource;
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

/**
 * §9 스코프드 스냅샷 구독 — 클라→서버: **이 창이 지금 필요한 프로젝트 집합**.
 *
 * 메인 창은 활성 탭 하나, Command Center(§5.12 A)는 따라가기/고정 대상 하나를 싣는다.
 * 서버는 붙어 있는 모든 창의 선언을 **합집합**해 그것만 무거운 슬라이스에 담는다.
 *
 * ⚠ 규약 셋 — 어기면 최적화가 아니라 기능 손상이 된다:
 *  1. **아무도 선언하지 않았으면 전부 보낸다.** 침묵(구버전 클라·부팅 직후)이 축소로 해석되면 안 된다.
 *  2. 범위 밖 프로젝트도 **탭·전역 집계는 그대로** 흐른다(`projects`/`stubProjects`/`activeAgentCount` 등).
 *  3. 값은 **표시명**(`GraphSnapshot.projects` 의 키)이다 — 경로가 아니다.
 */
export interface SetProjectScopePayload {
  /** 이 창이 필요한 프로젝트 표시명 목록. 빈 배열 = "지금은 아무것도 안 본다"(탭 0개). */
  projects: string[];
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
  /**
   * §3.2.3 보존 정책 — 저장 데이터를 얼마나 오래/얼마나 많이 들고 있을지.
   *
   * **머신 단위**라 프로젝트 체크포인트가 아니라 여기 산다(같은 사용자가 프로젝트마다 다른 보존일을
   * 원할 이유가 없고, 정리는 부팅 시 모든 프로젝트에 일괄 적용된다). optional — 없으면
   * `DEFAULT_RETENTION_SETTINGS`(구버전 AppState 하위호환).
   */
  retention?: RetentionSettings;
  /** 마지막 업데이트 타임스탬프 (epoch ms). */
  updatedAt: number;
}

/** AppState 부분 업데이트 페이로드 — PATCH /api/app-state 요청 본문. `updatedAt`은 서버가 채움. */
export type AppStatePatch = Partial<Pick<AppState, 'lastActiveProject' | 'defaultProject' | 'pinnedProjects' | 'openProjects'>>;

// ─── 보존 정책 (§3.2.3) ───

/**
 * 저장 데이터 보존 설정 — 전부 사용자가 조절한다.
 *
 * **모든 값에서 `0` = 그 축은 정리하지 않음(무제한).** Claude Code 가 `cleanupPeriodDays` 를 끌 수
 * 없게 만들어 반발을 산 자리(이슈 #59248·#64999)를 의도적으로 비껴간 규약이다.
 *
 * ⚠ `cleanupPeriodDays: 0` 이 문서상 "정리 끄기"인데 실제로는 저장 자체를 꺼 버린 Claude Code 의
 *   버그(#23710)를 반복하지 않는다 — 여기서 `0` 은 **오직 정리만** 끄고 기록은 종전대로 계속한다.
 */
export interface RetentionSettings {
  /** 파일 편집 이력 보존 일수. 0=무제한. */
  fileEditRetentionDays: number;
  /** 편집 이력을 들고 있는 파일 경로 키 개수 상한(LRU). 0=무제한. */
  maxFileEditPaths: number;
  /** 같은 파일 연속 편집 병합창(ms). 0=병합 안 함. */
  fileEditMergeWindowMs: number;
  /** 세션당 완료 명령(말풍선) 보관 상한. 0=무제한. */
  completedCommandMaxPerSession: number;
  /**
   * sub-streams jsonl 보존 일수. 0=무제한.
   *
   * ⚠ **나이와 무관하게 보존되는 것이 둘**이다 — 살아있는 서브에이전트(registry)와
   * **아카이브된 서브에이전트**(탭을 닫아 "다시 열기" 목록에 남은 것). 후자를 빼먹으면 목록에는
   * 항목이 보이는데 누르면 빈 화면이 된다(§3.2.3 규칙 2 · Claude Code #62959 와 같은 형태).
   */
  subStreamRetentionDays: number;
  /**
   * 첨부 파일 보존 일수. 0=무제한.
   *
   * ⚠ **참조되고 있는 첨부는 이 값과 무관하게 보존**한다 — 여기서 세는 나이는 "아무도 참조하지
   * 않게 된 뒤"가 아니라 파일 자체의 나이지만, 삭제 후보는 **고아(참조 0)** 로만 좁힌다.
   * git 이 reachable(90일)/unreachable(30일)을 가르는 것과 같은 갈래이며, 우리는 참조되는 쪽을
   * 무기한으로 둔다(붙여넣은 스크린샷은 클립보드가 사라진 뒤라 유일본이다).
   */
  attachmentRetentionDays: number;
  /**
   * 휴지통 보존 일수 — 정리로 옮겨진 파일을 여기 며칠 두고 나서 실제로 지운다. 0=무제한(안 지움).
   *
   * §3.2.3 규칙 3("되돌릴 수 없는 정리는 사용자가 고른다")을 자동 정리 쪽에도 적용하는 축이다.
   * Claude Code 가 반발을 산 지점이 30일 자체가 아니라 **되돌릴 수단이 없다는 것**이었다.
   */
  trashRetentionDays: number;
}

/**
 * 정리 기록 한 줄 — 무엇을 언제 왜 옮겼는지. §3.2.3 "조용히 지우지 않는다"를 화면까지 잇는다.
 *
 * 삭제가 아니라 **휴지통 이동**이 기본이므로 이 기록은 곧 복원 후보 목록이다.
 */
export interface RetentionLogEntry {
  /** 기록 시각(epoch ms). */
  at: number;
  /** 어느 갈래였는지 — 저장소 사용량 화면의 갈래와 같은 어휘를 쓴다. */
  kind: Extract<StorageUsageKind, 'subStreams' | 'attachments'>;
  /** 어느 프로젝트의 휴지통인지 — 복원 요청이 프로젝트 단위라 함께 실어 보낸다. */
  projectPath: string;
  /** 프로젝트 표시 이름(화면용). */
  projectName: string;
  /** 휴지통 안의 상대 경로(복원 요청에 그대로 실어 보낸다). */
  trashRel: string;
  /** 원래 있던 절대 경로(복원 대상). */
  originalPath: string;
  bytes: number;
  /** 왜 옮겼는지 — `expired`(나이 초과) · `orphan-expired`(참조 0 + 나이 초과). */
  reason: 'expired' | 'orphan-expired';
  /** 휴지통에서 실제 삭제됐는지(복원 불가). */
  purged?: boolean;
}

/** 저장소 사용량 — 한 갈래(체크포인트/스트림/첨부/…)의 실측. */
export interface StorageUsageEntry {
  /** 갈래 식별자 — 클라가 i18n 라벨로 옮긴다(서버는 원문 문자열을 만들지 않는다). */
  kind: StorageUsageKind;
  bytes: number;
  fileCount: number;
}

export type StorageUsageKind =
  | 'checkpoint'
  | 'checkpointBackups'
  | 'activity'
  | 'identity'
  | 'subStreams'
  | 'attachments'
  | 'brain'
  | 'logs'
  | 'video'
  /** 정리로 옮겨진 파일이 대기하는 곳 — 여기 있는 동안은 복원 가능하다(§3.2.3 규칙 3). */
  | 'trash'
  | 'other';

/** 프로젝트 하나의 `.vibisual` 사용량. */
export interface ProjectStorageUsage {
  projectPath: string;
  projectName: string;
  totalBytes: number;
  entries: StorageUsageEntry[];
}

/**
 * 워크트리 사용량 — **자동 삭제 대상이 아니다.**
 * 사용자 산출물이 섞여 있을 수 있어 §3.2.3 대로 화면에 보여 주고 사용자가 고른다.
 */
export interface WorktreeStorageUsage {
  path: string;
  name: string;
  bytes: number;
  /** `.git` 이 살아있는가 — 없으면 이미 `git worktree remove` 된 잔여 폴더(정리 1순위). */
  alive: boolean;
  /** 마지막 수정 시각(epoch ms) — 오래된 것부터 정리 판단. */
  lastModifiedAt: number;
}

/** `GET /api/storage-usage` 응답. */
export interface StorageUsageReport {
  projects: ProjectStorageUsage[];
  worktrees: WorktreeStorageUsage[];
  totalBytes: number;
  scannedAt: number;
}

/** `POST /api/storage-cleanup` 결과 — 무엇을 얼마나 지웠는지 사용자에게 그대로 보여 준다. */
export interface StorageCleanupResult {
  /**
   * 원래 자리에서 치운 파일 수. 기본 경로는 **휴지통 이동**이라 이 숫자가 곧 영구 삭제는 아니다
   * (영구 삭제분은 `purgedFiles`). 사용자에게는 "정리됨"으로 읽히는 축이라 이름을 유지한다.
   */
  removedFiles: number;
  /** 위 파일들의 바이트 합. 휴지통에 있는 동안은 디스크에서 실제로 줄지 않는다. */
  freedBytes: number;
  /** 갈래별 회수량. */
  byKind: Partial<Record<StorageUsageKind, number>>;
  /** 건너뛴 이유(살아있는 세션 등) — 조용히 지우지 않는다는 §3.2.3 요구. */
  skipped: string[];
  /** 휴지통 보존일이 지나 **영구 삭제**된 파일 수(복원 불가). */
  purgedFiles?: number;
  /** 영구 삭제로 디스크에서 실제로 줄어든 바이트. */
  purgedBytes?: number;
  /**
   * 참조가 남아 있어 **나이와 무관하게 보존**한 파일 수 — 첨부 참조 인식·아카이브 보호가
   * 실제로 무엇을 지켰는지 사용자가 볼 수 있게 한다(0 이면 지킨 게 없다는 뜻이 아니라 후보가 없었다는 뜻).
   */
  keptReferenced?: number;
}

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
  /**
   * §5.10 Project Brain — 이 작업에서 배운 것(교훈/결정/함정). 각 문장은 서버가
   * `brainService.saveCard({type:'lesson', scope:'agent'})` 로 개별 기억 카드에 저장한다
   * (중복 검사 창구 경유). 다음에 같은 실수를 반복하지 않기 위한 확실한 것만, 최대 3개.
   */
  learned?: string[];
  /**
   * §5.10 v3.49 랭킹 "도움됨" 신호 — 브리핑/주입으로 받은 기억 카드 id 중 실제 작업에 도움된 것.
   * 브리핑 블록에 `[card-xxxx]` 로 표기된 id 를 그대로 신고한다. 서버가 각 id 에
   * `brainService.markHelpful(id)` 를 호출(helpfulCount++, lastHelpfulAt 갱신) → 랭킹 부스트.
   */
  helpfulMemoryIds?: string[];
  /**
   * §5.10 v3.78 — `helpfulMemoryIds` 의 **대칭 채널**(재검증 1비트 회수). 브리핑으로 받은 카드 중
   * **지금 코드와 어긋나 낡았다**고 판단한 것의 id. 서버가 `brainService.markStale(id)` 를 호출해
   * `verifyState: 'needs-check'` + 대체 후보로 적립하고, 누적이 문턱을 넘으면 자동 보관(삭제 ❌).
   * 반대로 확인 필요 카드가 `helpfulMemoryIds` 로 오면 앵커를 현재 해시로 갱신하고 `ok` 로 복귀한다.
   */
  staleMemoryIds?: string[];
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

// ─── §5.10 Project Brain — 2단 기억(프로젝트/에이전트) ───
//
// 카드 1장 = 마크다운 파일 1개(frontmatter + 본문). 파일이 원본(SSOT 예외 — §3.2 identity·AppState 동격).
// 서버 brainService 가 디스크를 스캔해 in-memory 인덱스로 들고, REST 로만 본문을 내려준다.
// 스냅샷에는 요약(BrainSummary)/주입 신호(BrainInjectionEvent)만 실리고 본문은 절대 타지 않는다(§9 perf).

/** 기억 카드 5종 — 결정/실수/교훈/규칙/사실. */
export type BrainCardType = 'decision' | 'mistake' | 'lesson' | 'rule' | 'fact';

/** 기억 층 — 프로젝트 전체 공유 vs 특정 커스텀 에이전트 개별 기억. */
export type BrainCardScope = 'project' | 'agent' | 'user';

/** 카드 상태 — active(정상)/ghost(연결 파일 소실 → 재검토)/archived(보관). */
export type BrainCardStatus = 'active' | 'ghost' | 'archived';

/**
 * §5.10 v3.78 — 카드 내용이 **지금도 코드와 맞는가**. `status`(파일 존재 여부)와 직교한다.
 *
 * - `ok`: 앵커를 박은 뒤 연결 파일이 바뀌지 않았거나, 바뀐 뒤 사람/에이전트가 "지금도 맞음"으로 재검증했다.
 * - `needs-check`: 연결 파일이 **수정**됐거나 낡음 신고가 들어와 내용이 새 코드와 어긋날 수 있다.
 *   **주입에서 빼지 않는다** — 빼면 아직 유효한 규칙까지 사라진다. 대신 "이 파일이 그 뒤 N회 수정됨"
 *   경고를 카드와 함께 실어 보내 모델이 스스로 대조하게 한다.
 */
export type BrainVerifyState = 'candidate' | 'verified' | 'needs-check' | 'contested' | 'rejected';

/**
 * §5.10 v3.81-D — **권위**. 이 지식이 어디서 왔는가. `BRAIN_AUTHORITY_RANK` 로 서열이 매겨지며
 * **랭크 ≤1(`session-summary`·`ai-inference`)은 `verified` 로 가는 코드 경로 자체가 없다**
 * (출처 없는 AI 추론의 자동 승격 ❌ — 이 프로젝트가 낡은 기억에 속아 온 정확한 지점).
 */
export type BrainAuthority =
  | 'user-explicit'      // 사용자가 명시적으로 승인/교정 (결정·정책·선호의 유일한 승격 경로)
  | 'repository-source'  // 현재 코드/설정과 대조 성공 (앵커 해시 일치)
  | 'tool-result'        // 테스트·빌드·CLI 의 실제 실행 결과
  | 'approved-doc'       // 승인된 프로젝트 문서(SCENARIO 등)
  | 'session-summary'    // 세션 요약 — candidate 상한
  | 'ai-inference';      // AI 추론 — candidate 상한

/**
 * §5.10 v3.81-F — **관찰 1건**. 같은 키+범위에 **같은 값**이 다시 발견되면 카드를 늘리지 않고
 * 여기에 적립한다(요건: "같은 사실이 여러 세션에서 발견되면 카드가 늘지 않고 evidence 만 보강").
 */
export interface BrainObservation {
  /** 관찰 시각. */
  at: number;
  /** 관찰된 세션 id(없으면 수동·시스템). */
  sessionId?: string;
  /** 그 관찰의 권위 — 더 높은 권위가 오면 카드의 authority 가 승격된다. */
  authority: BrainAuthority;
}

/**
 * §5.10 v3.81-E — **적용 범위**. 지식이 어느 조건에서 참인가. 축은 필요한 것만 쓰고 생략 = 전체(`*`).
 * 직렬화는 정렬된 한 줄(`project=vibisual;branch=main`) — 기존 YAML-lite 파서를 건드리지 않기 위함.
 */
export interface BrainAppliesTo {
  project?: string;
  component?: string;
  environment?: string;
  branch?: string;
  platform?: string;
  version?: string;
  agent?: string;
}

/**
 * §5.10 v3.81-B — current 인덱스 1행(REST `GET /api/brain/current` 응답 원소).
 * **파일이 아니라 카드에서 계산된다** — 레지스트리 파일을 따로 두면 카드와 서로 다른 진실을
 * 말하는 이중 구조가 되기 때문(설계 근거는 §5.10 v3.81-B).
 */
export interface BrainCurrentEntry {
  canonicalKey: string;
  /** 정규화된 범위 문자열(빈 문자열 = 전역). */
  scopeKey: string;
  /** 현재 진실 카드 id. 충돌로 정해지지 않았으면 null. */
  cardId: string | null;
  /** 이 슬롯을 다투는 카드들(충돌일 때만 2 이상). */
  contenders: string[];
  /** 슬롯 상태 — `current`(하나로 정해짐) / `contested`(둘 이상이 verified) / `none`(verified 없음). */
  state: 'current' | 'contested' | 'none';
}

/**
 * §5.10 v3.78 — **코드 앵커**. 카드를 저장한 시점의 연결 파일 상태를 못 박아 두는 지문.
 *
 * 시중 메모리 레이어는 코드 변경을 못 보지만 우리는 Edit/Write 훅을 전수로 받는다(§7.4). 편집된
 * 파일에 걸린 카드는 그 자리에서 `editedSince` 가 오르고 해시가 어긋나면 `needs-check` 로 전이한다.
 */
export interface BrainAnchor {
  /** 연결 파일 경로 — 카드 `files` 원소와 같은 문자열(상대/절대 그대로 보존). */
  path: string;
  /** 저장 시점 파일 내용 sha256 앞 `BRAIN_ANCHOR_SHA_LEN` 자. 파일이 없었으면 undefined. */
  sha?: string;
  /** 저장 시점 git HEAD 짧은 해시. git 저장소가 아니면 undefined. */
  commit?: string;
  /** 앵커를 박은(또는 재검증으로 갱신한) 시각. */
  at: number;
  /** 앵커 이후 그 파일이 Edit/Write 된 횟수 — 주입 경고에 그대로 실린다. */
  editedSince?: number;
  /** 마지막으로 편집이 감지된 시각. */
  lastEditedAt?: number;
}

/**
 * §5.10 기억 카드 1장. 디스크의 `.vibisual/brain/{project|agents/<agentId>}/<id>.md` 와 1:1.
 * frontmatter 에 메타, 본문(body)은 마크다운. `files` = 이 카드가 연결된 파일 절대/상대 경로들
 * (파일 접근 경고·ghost 판정의 근거). 사용자가 직접 열어 읽고 고칠 수 있는 파일이 원본.
 */
export interface BrainCard {
  /** 카드 고유 ID (`card-<Date.now(36)>-<rand>`, 파일명과 동일). */
  id: string;
  type: BrainCardType;
  scope: BrainCardScope;
  /** scope==='agent' 일 때 소속 커스텀 에이전트 ID. project 카드는 undefined. */
  agentId?: string;
  /** 한 줄 제목(카드 헤드라인). */
  title: string;
  /** 마크다운 본문. **스냅샷에는 싣지 않는다** — REST getCard 로만 조회. */
  body: string;
  /** 연결 파일 경로들(파일 접근 경고·ghost 판정 근거). */
  files: string[];
  /** 출처 세션 ID(리플렉션/신고 유래). 세션 점프용. 수동 저장은 undefined. */
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
  /** 마지막으로 주입/검색에 참조된 시각(신선도·묻힘 방지). */
  lastReferencedAt?: number;
  /**
   * 누적 **임프레션** 횟수 — 주입(스폰 브리핑/파일 경고)·검색으로 카드가 에이전트에 노출된 횟수.
   * v3.49 랭킹에서 "노출"의 의미로 명확화(유튜브 임프레션). 실제 도움 여부는 `helpfulCount` 로 별도 집계.
   * 많이 노출됐는데 helpfulCount 0 이면 랭킹 강등(낡은 기억 자동 침전).
   */
  refCount: number;
  /**
   * §5.10 v3.49 — 카드가 실제로 **도움됐다**고 신고된 누적 횟수(유튜브 시청시간 대응).
   * 채널 2종: (a) 에이전트 작업 신고 `helpfulMemoryIds`, (b) 사용자 👍 버튼. optional(하위호환 — 없으면 0).
   */
  helpfulCount?: number;
  /** §5.10 v3.49 — 마지막으로 "도움됨" 신고된 시각(신선도 계산에 updatedAt 과 함께 max 로 반영). */
  lastHelpfulAt?: number;
  /** 사용자가 소멸/흐림 금지로 고정. */
  pinned?: boolean;
  status: BrainCardStatus;
  /** 대체(supersede) 시 이전 카드 요지 이력(자가 수정 금지 — 이력 보존). */
  supersededNote?: string;
  /**
   * §5.10 v3.78 — **유효기간의 닫는 축.** 이 카드가 더 이상 현재 사실이 아니게 된 시각
   * (= 이 카드를 대체한 새 카드의 `createdAt`). 여는 축은 `createdAt` 이다.
   *
   * 값이 있으면 **닫힌 카드** — 주입·주제 문서·색인·검색·요약·피드 어디에도 나오지 않고
   * 이력 조회(대체 체인 뷰)에서만 보인다. **삭제가 아니라 닫는 것**이라 과거는 남는다.
   */
  validUntil?: number;
  /** §5.10 v3.78 — 이 카드를 닫은(대체한) 새 카드 id. `validUntil` 과 항상 짝. */
  supersededBy?: string;
  /** §5.10 v3.78 — 이 카드가 닫은 옛 카드 id 목록(대체 체인 역방향). */
  supersedes?: string[];
  /**
   * §5.10 v3.78 — 저장 시점 연결 파일들의 코드 앵커. 프로젝트 층은 사실상 필수(코드에 매인 지식),
   * 에이전트 층은 불필요(사람·역할에 매인 지식). optional — 구버전 카드는 없다.
   */
  anchors?: BrainAnchor[];
  /**
   * §5.10 v3.81-D — 검증 상태. **없으면 `candidate` 로 본다**(구버전 카드 = 아직 검증 안 된 것 —
   * 사용자 결정 2026-07-31 "엄격안": 기존 카드는 전부 candidate 로 시작하고 검증된 것만 올린다).
   * 보관축(`status`)과 섞지 않는다.
   */
  verifyState?: BrainVerifyState;
  /**
   * §5.10 v3.81-E — **안정적인 진실 주소**(`<area>.<subject>[.<aspect>]`). 이 값이 있는 카드만
   * SSOT(Canonical Knowledge) 후보다. 없으면 저장고(Evidence)에만 존재한다 — 검색·주제 문서·이력으로
   * 읽히되 기본 주입 대상이 아니다. `topic`·태그가 바뀌어도 이 값은 불변(진실의 동일성을 여기서 지킨다).
   */
  canonicalKey?: string;
  /** §5.10 v3.81-E — 적용 범위. 없으면 전역(`*`). 서로 다른 범위의 값은 충돌이 아니라 조건부 공존. */
  appliesTo?: BrainAppliesTo;
  /** §5.10 v3.81-D — 이 지식의 권위. 없으면 `ai-inference` 로 본다(가장 낮은 랭크). */
  authority?: BrainAuthority;
  /** §5.10 v3.81 — 정규화된 값(enum 성 사실에만. 예 `pnpm`). 없으면 `title` 이 곧 진술문이다. */
  value?: string;
  /** §5.10 v3.81 — 마지막으로 **검증**된 시각(`updatedAt` 과 분리 — 편집과 검증은 다른 사건이다). */
  verifiedAt?: number;
  /** §5.10 v3.81 — 이 시각이 지나면 자동으로 재검토 대상(없으면 무기한). */
  reviewAfter?: number;
  /** §5.10 v3.81-F — 같은 값이 다시 관찰된 이력(최근 `BRAIN_OBSERVATION_KEEP` 건만 보관). */
  observations?: BrainObservation[];
  /** §5.10 v3.81-F — 누적 관찰 횟수(잘린 `observations` 와 달리 전체를 센다). */
  observedCount?: number;
  /** §5.10 v3.78 — 에이전트가 `staleMemoryIds` 로 "낡음"을 신고한 누적 횟수(대체 후보 적립). */
  staleReports?: number;
  /**
   * §5.10 v3.78 — 승격(에이전트 → 프로젝트) 시 **원 소유 에이전트 id 를 남긴다.**
   * 종전 승격은 순수 이동이라 원 에이전트가 자기 지식을 통째로 잃었다 — 링크를 남겨
   * 그 에이전트 스코프에서도 "내가 올린 기억"으로 되짚을 수 있게 한다.
   */
  promotedFrom?: string;
  /** 대시보드 "최근 저장" 검토 확인 여부(false=미확인 → 배지 카운트). */
  seen?: boolean;
  /**
   * §5.10 v3.74 — **프로젝트 층 주제 slug**(`BRAIN_TOPICS` 의 slug 또는 `BRAIN_TOPIC_MISC`).
   * 저장 시 AI 가 지정하고, 없으면 서버가 제목·본문·파일을 패턴 매칭해 자동 분류한다.
   * 스폰 브리핑은 이 축으로 만든 **색인**만 싣고 카드 본문은 밀어넣지 않는다(무관한 주입 차단).
   * **에이전트 층은 미사용** — 커스텀 에이전트 버블 자체가 이미 주제 단위이기 때문.
   */
  topic?: string;
  /**
   * §5.10 v3.74 — 주제와 무관하게 **어떤 작업에서도** 지켜야 하는 상시 규칙인가(rule 전용, 소수).
   * true 인 카드만 스폰 브리핑에 상시 실린다 — 주제성 규칙은 해당 주제 문서로 내려간다.
   * 종전의 "규칙 카드 전량 주입"(상한 20)을 대체하는 플래그. optional(하위호환 — 없으면 false).
   */
  always?: boolean;
}

/**
 * §5.10 v3.74 — 프로젝트 층 주제 정의(`BRAIN_TOPICS` 원소).
 * 카드를 "무엇에 관한 기억이냐"로 가르는 축. 스폰 브리핑 색인의 한 줄이 이 정의에서 나온다.
 */
export interface BrainTopicDef {
  /** 주제 slug — 카드 `topic` 값 + 주제 문서 파일명(`topics/<slug>.md`). */
  slug: string;
  /** 사람이 읽는 주제명. */
  title: string;
  /** 색인에 싣는 "언제 이 문서를 읽나" 한 줄 — 에이전트가 자기 작업과 대조하는 기준. */
  whenToRead: string;
  /** 자동 분류용 정규식 소스('i' 플래그로 컴파일). 제목·본문·연결 파일 경로에 매칭. */
  match: string;
}

/**
 * §5.10 v3.74 — 스폰 브리핑 색인 한 줄 + 주제 문서 목록 응답 항목.
 * 카드 본문은 담지 않는다(색인은 "어디를 읽을지"만 알려주는 것이 목적).
 */
export interface BrainTopicIndexEntry {
  slug: string;
  title: string;
  whenToRead: string;
  /** 그 주제에 속한 활성 카드 수(archived 제외). 0 인 주제는 색인에서 빠진다. */
  cardCount: number;
  /** 주제 문서 절대 경로 — 에이전트가 Read 로 바로 열 수 있게 색인에 함께 싣는다. */
  docPath: string;
}

/**
 * §5.10 두뇌 요약 — Brain 버블 배지/본체 렌더용 경량 집계. 스냅샷 탑재분(본문 없음).
 */
export interface BrainSummary {
  /** 전체 활성 카드 수(archived 제외). */
  cardCount: number;
  /** 미확인(seen=false) 카드 수 — Brain 버블 점 배지. */
  unseenCount: number;
  /** 최근 저장 카드 제목 1줄(본체 미리보기). */
  recentCardTitle?: string;
  /** 에이전트별 개별 기억 카드 수 (agentId → count). */
  agentCardCounts: Record<string, number>;
  /**
   * §5.10 v3.78 — 연결 파일이 수정돼 **확인 필요**(`verifyState: 'needs-check'`)가 된 열린 카드 수.
   * 기억 화면 주제 레일의 "확인 필요" 특수 항목 배지. optional(하위호환 — 없으면 0).
   */
  needsCheckCount?: number;
  /** §5.10 v3.78 — 예산제로 보관(`archived`)된 카드 수 — "정리됨" 되돌림 목록 배지. */
  archivedCount?: number;
  /** §5.10 v3.81 — **현재 진실**로 확정된 슬롯 수(verified + 유일). 저장 장수가 아니라 SSOT 크기. */
  currentCount?: number;
  /** §5.10 v3.81 — 값이 갈려 current 를 잃은 슬롯 수(검토 큐 배지). */
  contestedCount?: number;
  /** §5.10 v3.81 — 사람의 판단을 기다리는 카드 수(후보·충돌·확인 필요). */
  reviewCount?: number;
}

/**
 * §5.10 주입 이벤트 — 스폰 브리핑/파일 경고/검색으로 카드가 에이전트에 주입된 순간의 신호.
 * IDE "기억 N장 참조" 칩 + Brain→에이전트 일시 엣지 연출용. 카드 id/title 만 나른다(본문 X).
 * 런타임 전용(영속 X).
 */
export interface BrainInjectionEvent {
  /** 이벤트 고유 ID. */
  id: string;
  /** 주입 대상 에이전트 ID. */
  agentId: string;
  /** 주입 시각(epoch ms). */
  at: number;
  /** 주입된 카드 ID 목록. */
  cardIds: string[];
  /** 주입된 카드 제목 목록(칩 펼침 표시용). */
  cardTitles: string[];
  /** 주입 계기 — 스폰 브리핑/파일 접근 경고/능동 검색. */
  trigger: 'spawn' | 'file' | 'search';
  /**
   * §5.10 v3.78 — 같은 계기로 **같은 카드 묶음**이 다시 주입된 누적 횟수(최초 1). 없으면 1로 본다.
   *
   * 스폰 브리핑은 명령 dispatch 마다 돌고 카드 묶음은 대개 그대로라, 종전에는 IDE 스트림에
   * `기억 N장 참조` 칩이 턴 수만큼 쌓였다. 이제 칩은 하나로 두고 이 횟수만 올린다.
   */
  repeatCount?: number;
  /** §5.10 v3.78 — 마지막으로 같은 묶음이 다시 주입된 시각. 정렬 기준인 `at` 은 최초 시각 그대로 둔다. */
  lastAt?: number;
}

/**
 * §5.10 v3.49 — 기억 피드 섹션 키(유튜브 홈 방식). related=지금 작업과 관련(컨텍스트 랭킹) /
 * recent=최근 배운 것(생성 최신) / frequent=자주 쓰는 기억(도움됨 상위) /
 * resurface=오랜만에 다시 볼 기억(재노출 슬롯 — 필터버블 방지, 장기 미참조 우선).
 */
export type BrainFeedSectionKey = 'related' | 'recent' | 'frequent' | 'resurface';

/**
 * §5.10 v3.49 — 우더블클릭 피드 오버레이 응답. 섹션별 랭킹된 소수 카드(각 BRAIN_FEED_SECTION_SIZE 상한)
 * + 전체 풀 크기. 섹션 간 중복은 related>recent>frequent>resurface 우선순위로 제거된다.
 * 카드에는 본문(body)이 포함된다(REST fetch — 스냅샷 아님).
 */
export interface BrainFeed {
  /** 섹션 키 → 그 섹션의 카드 목록(랭킹/정렬 완료, 상한 적용). */
  sections: Record<BrainFeedSectionKey, BrainCard[]>;
  /** 이 스코프 풀의 전체 카드 수(archived/ghost 제외 — "N장 중 상위만 표시" 안내용). */
  totalCount: number;
}

/**
 * §5.10 brainService.saveCard 입력. id/시각/refCount 등은 서버가 채운다.
 * 중복 검사 단일 창구를 통과 — 유사 기존 카드가 있으면 새로 만들지 않고 갱신한다.
 */
export interface BrainCardInput {
  type: BrainCardType;
  scope: BrainCardScope;
  agentId?: string;
  title: string;
  body: string;
  files?: string[];
  sourceSessionId?: string;
  pinned?: boolean;
  seen?: boolean;
  /** §5.10 v3.74 — 프로젝트 층 주제 slug. 미지정이면 서버가 패턴으로 자동 분류(`misc` 폴백). */
  topic?: string;
  /** §5.10 v3.74 — 주제 무관 상시 규칙(rule 전용, 소수). 미지정이면 false. */
  always?: boolean;
  /**
   * §5.10 v3.78 — **이 지식이 뒤집는 기존 카드 id**(리플렉션 프롬프트가 기존 제목 목록을 보고 지목).
   * 주어지면 유사도 계산을 건너뛰고 그 카드를 곧바로 닫는다(모순 판정의 명시 경로).
   */
  contradicts?: string;
  /** §5.10 v3.78 — 승격 원 소유 에이전트 id(승격 경로에서만 채운다). */
  promotedFrom?: string;
  /**
   * §5.10 v3.81 — **진실 주소.** 주면 슬롯 규칙(같은 키+범위엔 현재 진실 하나)이 적용되고,
   * 없으면 종전 유사도 경로로 저장된다(증거 카드). AI 는 리플렉션 출력 스키마로 이 값을 제안한다.
   */
  canonicalKey?: string;
  /** §5.10 v3.81 — 적용 범위. 생략 = 전역. */
  appliesTo?: BrainAppliesTo;
  /** §5.10 v3.81 — 이 지식의 권위. 생략 = `ai-inference`(자동 승격 불가). */
  authority?: BrainAuthority;
  /** §5.10 v3.81 — 정규화된 값(enum 성 사실). 같은 슬롯 안에서 "같은 값인가"를 이걸로 먼저 본다. */
  value?: string;
}

/**
 * §5.10 v3.78 — `saveCard` 가 기존 카드와의 관계를 어떻게 판정했는가(테스트·로그·REST 응답용).
 * `same` = 새 카드를 만들지 않고 기존 카드의 참조 시각만 갱신 / `superseded` = 새 카드가 옛 카드를 닫음 /
 * `new` = 보완(관계 없음 또는 겹침이 약함) → 그냥 새 카드.
 */
export type BrainSaveOutcome = 'same' | 'superseded' | 'new';

/** §5.10 v3.78 — `saveCard` 반환. 카드 + 판정 결과 + 닫힌 옛 카드 id 들. */
export interface BrainSaveResult {
  card: BrainCard;
  outcome: BrainSaveOutcome;
  /** outcome==='superseded' 일 때 이 저장으로 닫힌 옛 카드 id 목록. */
  closedIds: string[];
}

// ─── §5.10 v3.81 — 저장고↔SSOT 이원화 이행을 위한 **읽기 전용** dry-run 감사 ───
//
// 보고서에는 **시각·난수가 들어가지 않는다** — 같은 카드 집합이면 몇 번을 돌려도 같은 결과가 나와야
// 하기 때문(재실행 멱등). 이 단계는 파일을 한 바이트도 쓰지 않으며, 실제 이행은 사용자 승인 후
// frontmatter 필드 **추가만** 수행한다(기존 값 삭제·본문 재작성 ❌).

/** §5.10 v3.81 — dry-run 감사에서 카드 1장에 붙는 지적 사항. */
export interface BrainMigrationNote {
  id: string;
  title: string;
  scope: BrainCardScope;
  agentId?: string;
  /** 기계 판독용 사유 코드(예: `no-source`, `anchor-mismatch`, `experience-layer`). */
  reason: string;
  /** 사람이 읽는 부연(파일명·수치 등). */
  detail?: string;
}

/**
 * §5.10 v3.81 — `canonicalKey` **접두 제안**(자동 확정 ❌ — 사람이 확인해야 SSOT 에 편입된다).
 * `<area>.<subject>` 까지만 기계가 만들 수 있다. area 는 파일의 패키지, subject 는 소스 모듈명에서
 * 나오며, **한국어 제목에서는 어떤 마디도 만들지 않는다**(로마자 변환은 결정적일 수 없다).
 */
export interface BrainMigrationKeySuggestion {
  id: string;
  title: string;
  /** `<area>.<subject>` 형태의 제안 접두. */
  suggestedKey: string;
  /**
   * 같은 접두를 여러 카드가 제안받았는가 — **한 파일에 서로 다른 진실이 여럿**이라는 뜻이다.
   * true 면 이 접두는 그대로 키가 될 수 없고 `<area>.<subject>.<aspect>` 로 갈라야 한다(사람 판단).
   */
  needsAspect: boolean;
  /** 제안 신뢰도 — high=단일 파일+분류된 주제, medium=다중 파일, low=접두 충돌·근거 약함. */
  confidence: 'high' | 'medium' | 'low';
  /** 무엇을 근거로 제안했는지(예: `file=brainService.ts · topic=brain-memory`). */
  basis: string;
}

/** §5.10 v3.81 — 같은 진실일 가능성이 높은 카드 묶음(제목 문자 bigram 기준 — 판정 ❌, 보고 ⭕). */
export interface BrainMigrationDuplicateGroup {
  /** 층 식별자 — `project` 또는 `agent:<agentId>`. 층이 다르면 중복으로 묶지 않는다. */
  layer: string;
  /** 묶음 내 최대 유사도(0~1). */
  similarity: number;
  cards: Array<{ id: string; title: string }>;
}

/** §5.10 v3.81 — 서로 뒤집는 것으로 보이는 카드 쌍(부정 극성 반전). */
export interface BrainMigrationConflictPair {
  layer: string;
  similarity: number;
  reason: 'negation-flip';
  a: { id: string; title: string };
  b: { id: string; title: string };
}

/** §5.10 v3.81 — 감사 집계(목록이 상한에 잘려도 전체 수는 여기로 알 수 있다). */
export interface BrainMigrationCounts {
  total: number;
  /** 열려 있고 보관되지 않은 카드. */
  live: number;
  /** 대체돼 닫힌 카드(`validUntil` 보유). */
  closed: number;
  archived: number;
  project: number;
  agent: number;
  byType: Record<string, number>;
  /** 종류별 — 정본 후보(fact/rule/decision) vs 경험 계층(mistake/lesson). live 기준. */
  canonicalCandidates: number;
  experienceLayer: number;
  /** 현재 `needs-check` 인 live 카드 수. */
  needsCheck: number;
}

/**
 * §5.10 v3.81 — dry-run 감사 보고서 전문. `GET /api/brain/migrate/dry-run` 응답.
 * 목록은 각각 `BRAIN_MIGRATION_LIST_MAX` 로 잘리며, 잘린 뒤에도 `counts` 는 전체를 센다.
 */
export interface BrainMigrationReport {
  /** 감사한 프로젝트 루트(forward-slash 정규화). */
  root: string;
  counts: BrainMigrationCounts;
  /** ① 키를 비교적 안전하게 추론할 수 있는 카드. */
  keySuggestions: BrainMigrationKeySuggestion[];
  /**
   * ①-b **같은 접두를 제안받은 카드 묶음** — 한 파일에 서로 다른 진실이 여럿 걸려 있다는 신호다.
   * 그대로 확정하면 서로 다른 진실이 한 슬롯으로 뭉개지므로, 사람이 `aspect` 마디를 붙여 갈라야 한다.
   * 제목이 안 닮아도 잡힌다는 점에서 `duplicateGroups`(제목 유사도)와 상호 보완이다.
   */
  keyCollisions: Array<{ key: string; cards: Array<{ id: string; title: string }> }>;
  /** ② 중복 후보 묶음. */
  duplicateGroups: BrainMigrationDuplicateGroup[];
  /** ③ 충돌 후보 쌍. */
  conflictPairs: BrainMigrationConflictPair[];
  /** ④ 출처(연결 파일)가 아예 없는 카드 — 무효화 신호가 영구 0 인 불멸 카드. */
  noSource: BrainMigrationNote[];
  /** ⑤ 출처가 깨진 카드 — 파일이 사라졌거나 앵커 해시가 어긋남. */
  brokenSource: BrainMigrationNote[];
  /** ⑥ 적용 범위(branch/env/platform) 분리가 필요해 보이는 카드. */
  needsScopeSplit: BrainMigrationNote[];
  /** ⑦ 출처가 온전해 사람이 확인하면 바로 verified 로 올릴 수 있는 카드. */
  reVerifiable: BrainMigrationNote[];
  /** ⑧ 사람의 판단이 필요한 카드(결정·정책·선호, 키 추론 불가). */
  needsHuman: BrainMigrationNote[];
  /** ⑨ 분류되지 않은 주제·area. */
  unclassified: {
    /** 주제가 `misc` 인 카드. */
    misc: BrainMigrationNote[];
    /** `BRAIN_TOPICS` 에 없는 주제 slug(수기 편집·구버전). */
    unknownTopics: string[];
  };
  /** ⑩ AI 기본 컨텍스트에서 **즉시** 빼야 할 카드(사유 포함). */
  excludeNow: BrainMigrationNote[];
  /** 실제 이행 시 무엇을 하고 무엇을 안 하는지 — 변경 전 사용자에게 보여줄 예정 내역. */
  plan: {
    /** 추가될 frontmatter 필드. */
    willAddFields: string[];
    /** 절대 건드리지 않는 것. */
    willNotTouch: string[];
    /** 이행 직후 모든 기존 카드가 갖게 될 검증 상태(엄격안 — 사용자 결정 2026-07-31). */
    initialVerifyState: 'candidate';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.10 v2 — 학습 루프(브레인 v2).
// 카드(선언적 기억) **위에 얹히는 축**이며 카드를 대체하지 않는다(§5.10 v2 (J)).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §5.10 v2 (H) — 두뇌 축 6개.
 *
 * 마스터(`BrainActivation.enabled`)가 켜진 뒤에도 축별로 다시 끌 수 있다 —
 * 리플렉션만 끄고 스킬 집행은 쓰려는 사용자가 실제로 있기 때문이다.
 */
export type BrainAxisId =
  /** 축 1 — 절차적 기억. 복잡한 작업의 절차를 SKILL.md 로 굳히고 쓰면서 개정한다. */
  | 'skills'
  /** 축 2 — 회상. 카드가 아니라 **과거 세션 본문**을 찾는다. */
  | 'recall'
  /** 축 3 — 넛지. 일하는 에이전트 자신에게 턴 중간에 기억을 남기도록 자극한다. */
  | 'nudge'
  /** 축 4 — 근거 검증. 저장 시 코드와 대조해 통과하면 자동 `verified`. */
  | 'grounding'
  /** 축 5 — 큐레이터. misc·미노출·후보 카드를 입양 대기 레일로 표면화한다. */
  | 'curator'
  /** 축 6 — 운영자 프로필. AI 가 관찰한 사용자 경향을 **로컬에만** 쌓는다. */
  | 'operator';

/**
 * §5.10 v2 (H) — 프로젝트 한 곳의 두뇌 활성화 상태.
 *
 * **키가 없으면 꺼짐**이다(기본 off). 껐을 때 토큰이 0 이어야 의미가 있으므로
 * 서버는 이 값을 **수집·주입·표시·REST 네 겹 모두**에서 관문으로 쓴다.
 * 끄기는 **동작 정지이지 삭제가 아니다** — 카드 파일은 디스크에 그대로 남고
 * 다시 켜면 그 자리에서 이어진다(§5.11 "끄면 지우지 않는다" 승계).
 */
export interface BrainActivation {
  /** 마스터 스위치. 기본 false. */
  enabled: boolean;
  /** 축별 재정의. 미지정 축은 `DEFAULT_BRAIN_AXES` 를 따른다. */
  axes?: Partial<Record<BrainAxisId, boolean>>;
  /** 마지막으로 켠 시각. */
  enabledAt?: number;
  /**
   * 첫 실행 1회 안내("두뇌에 N장이 잠들어 있습니다 — 켤까요?")를 띄운 시각.
   * **값이 있으면 다시 묻지 않는다** — 거절해도 값이 남으므로 반복 질문이 없다.
   */
  promptedAt?: number;
}

/** §5.10 v2 (B) — 스킬 자산의 수명 상태. 카드의 `BrainCardStatus` 와 별개 축이다. */
export type BrainSkillStatus = 'draft' | 'active' | 'superseded' | 'archived';

/**
 * §5.10 v2 (B) — **절차적 기억 한 벌.** 카드 6번째 종류가 아니라 **별도 자산**이다.
 *
 * 실물은 `<projectPath>/.vibisual/brain/skills/<id>/SKILL.md` 이고 frontmatter 는
 * agentskills.io 호환(`name`·`description`)이라 `.claude/skills` 와 같은 문법으로
 * 읽힌다 — 새 규격을 만들지 않는다.
 */
export interface BrainSkill {
  /** 폴더명 = slug. */
  id: string;
  /** frontmatter `name` — 사람이 부르는 이름. */
  name: string;
  /** frontmatter `description` — **집행 매칭에 쓰이는 문장.** "언제 이 절차를 쓰는가"를 적는다. */
  description: string;
  /** SKILL.md 본문(절차 그 자체). */
  body: string;
  scope: BrainCardScope;
  agentId?: string;
  topic?: string;
  /** 이 절차가 닿는 파일들. 근거 검증(축 4)과 파일 경고가 쓴다. */
  files: string[];
  status: BrainSkillStatus;
  /** 개정 횟수. 1 부터 시작한다. */
  version: number;
  /** 이 스킬이 대체한 이전 판 id. §C 쓰기 순서 — **새 판을 먼저 쓴다.** */
  supersedes?: string;
  /** 이 스킬을 대체한 새 판 id. `status: 'superseded'` 와 항상 짝. */
  supersededBy?: string;
  /** 카드와 같은 검증 축을 쓴다 — 스킬도 근거 검증(축 4)을 통과해야 집행된다. */
  verifyState: BrainVerifyState;
  createdAt: number;
  updatedAt: number;
  lastReferencedAt?: number;
  /** 프롬프트에 실린 누적 횟수(카드 `refCount` 와 같은 의미). */
  refCount: number;
  /** 도움됐다고 신고된 누적 횟수 — **스킬 집행 성과가 랭킹의 새 공급원**이다(§5.10 v2 (J)). */
  helpfulCount?: number;
  sourceSessionId?: string;
  /** lesson 승급으로 만들어졌다면 그 출처 카드들 — 209장을 끌어올린 흔적. */
  originCardIds?: string[];
}

/** §5.10 v2 (C) — 회상 결과 한 건. 카드가 아니라 **과거 세션 본문 조각**이다. */
export interface BrainRecallHit {
  sessionId: string;
  /** 그 세션이 돌던 프로젝트 루트. */
  root: string;
  /** 맞은 대목(앞뒤 문맥 포함. 길이 상한은 `BRAIN_RECALL_EXCERPT_CHARS`). */
  excerpt: string;
  /** 세션 안에서의 대략 위치(이벤트 index) — 세션 점프용. */
  index: number;
  /** 그 대목의 시각. */
  at: number;
  score: number;
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
  /**
   * §5.16 — 리뷰·승인 레인 레코드(`ReviewRequest.id`). 서버가 격리 변경분을 붙잡아 만든 카드에만 실린다.
   * 이 값이 있으면 카드가 파일 목록·diff·승인/반려/보류 구획을 함께 그린다. 에이전트가 스스로 보낸
   * 종전 검수 카드에는 없으므로 종전 그대로 렌더된다(회귀 0).
   */
  reviewRequestId?: string;
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

/** §4 v3.21 — 피드백 평가값. 사용자의 좋아요/싫어요. */
export type AgentFeedbackVerdict = 'up' | 'down';

/**
 * §4 v3.21 — 피드백 대상 종류.
 * report=작업 신고 카드, review=검수 요청 카드, result=스트림 턴 완료(result) 메시지.
 */
export type AgentFeedbackTargetType = 'report' | 'review' | 'result';

/**
 * §4 v3.21 — 에이전트 피드백 (사용자 → AI 작업 결과 좋아요/싫어요).
 *
 * 사용자가 작업 신고·검수 카드·스트림 result 에 남긴 평가. 대상(targetId) 별 upsert —
 * 같은 대상 재평가는 verdict 교체, 철회는 제거. `summary` 는 평가 시점의 대상 내용
 * 스냅샷(report=did, review=changes, result=본문 발췌)이라 대상 카드가 ring buffer 로
 * 밀려나도 학습 재료는 보존된다. 되먹임 경로: ① 매 스폰 턴 `buildAgentFeedbackBlock`
 * 다이제스트 주입(즉효), ② distill 증류 → 사용자 승인 시 `AgentConfig.rules` append(승인형).
 * 표시·학습 보조 전용 — 실제 작업/판정 로직 무관.
 */
export interface AgentFeedback {
  /** 피드백 고유 ID (서버가 발급). */
  id: string;
  /** 평가 대상 (부모) 에이전트 ID — Vibisual 관할 custom agent. 렌더 필터 1차 키. */
  agentId: string;
  /** 대상이 속한 sub 인스턴스(IDE 세션 탭) ID. 있으면 그 탭 귀속, 없으면 메인 탭. */
  subAgentId?: string;
  /** 피드백 대상 종류. */
  targetType: AgentFeedbackTargetType;
  /** 대상 식별자 — report/review 는 카드 id, result 는 스트림 아이템 id. */
  targetId: string;
  /** 좋아요/싫어요. */
  verdict: AgentFeedbackVerdict;
  /** 싫어요 사유 (선택 — 학습 재료의 핵심. 좋아요는 보통 생략). */
  reason?: string;
  /** 평가 시점 대상 내용 스냅샷 (report=did, review=changes, result=본문 발췌). */
  summary: string[];
  /** 평가 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/**
 * §9 스코프드 구독 — 프로젝트별 에이전트 집계(탭 배지 전용).
 * 무거운 슬라이스가 구독 범위로 좁혀져도 **이 집계만은 항상 전 프로젝트**가 실린다.
 */
export interface ProjectAgentCounts {
  /**
   * 그 프로젝트에 속한(살아 있고 · 숨김이 아니고 · **휴지통이 아닌**) 에이전트 수.
   * 휴지통 버블은 캔버스가 그리지 않으므로 숫자에도 없어야 한다 — 여기 남으면 화면 어디에도
   * 없는 분모가 만들어진다.
   */
  total: number;
  /** 그중 status==='active' */
  active: number;
  /** 그중 status==='completed' */
  completed: number;
  /**
   * 그 에이전트들이 가진 **세션 수**(IDE 탭 · 내부 뷰의 sub 버블). 세션이 하나도 없는 버블은
   * 자기 자신을 1 로 친다 — 세션 축으로만 세면 훅 에이전트가 통째로 숫자에서 사라진다.
   */
  sessions: number;
  /**
   * 그중 **지금 돌고 있는** 세션 수. 판정은 공용 규약 `isSessionRunning` 한 곳이 한다.
   * 사용자가 "동작 중"으로 세는 단위는 버블이 아니라 세션이라 `active`(버블 수)와 다르다 —
   * 한 버블 안에서 다섯 세션이 돌면 `active=1` 이지만 `running=5` 다.
   */
  running: number;
}

export interface GraphSnapshot {
  /** hydrated 프로젝트 목록 (projectName → ProjectInfo). keys와 stubProjects keys는 겹치지 않음 */
  projects: Record<string, ProjectInfo>;
  /**
   * §9 — 프로젝트별 에이전트 집계 (projectName → 수). **구독 범위와 무관하게 항상 전 프로젝트.**
   * 탭바 배지처럼 "안 보는 프로젝트도 숫자는 보여야 하는" 표시의 SSOT.
   * 미설정(구버전 스냅샷)이면 클라가 `agents` 로 직접 세던 종전 경로로 폴백한다.
   */
  projectAgentCounts?: Record<string, ProjectAgentCounts>;
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
  /**
   * §5.5 #17-9 v3.51 — 지금 백그라운드에서 도는 서브에이전트(Task/Agent 도구) 목록.
   * 키 = 부모(감독관) agentId. §5.3 #12-1 v3.43 대차대조(pendingSubagentTasks)의 스냅샷 투영이라
   * **런타임 전용 — 영속화 ❌**(ProjectCheckpoint 무변경, 서버 재시작 시 리셋).
   * 비어 있으면 필드 자체가 생략된다 → 클라 활동바 항목/배지가 자동으로 사라진다.
   */
  runningSubagentTasks?: Record<string, RunningSubagentTask[]>;
  /**
   * §5.5 #17-9 ⑦(b) — 방금 끝난 백그라운드 서브에이전트(부모별 최근 5건, 새 것이 앞).
   * 도는 것과 같은 대차대조에서 내려온 항목이며, 결과(`PostToolUse(Task|Agent)` 의
   * `tool_response`)가 늦게 붙는다. **런타임 전용 — 영속화 ❌**(⑦(c): 배지 산식에 관여하지 않는다).
   */
  finishedSubagentTasks?: Record<string, FinishedSubagentTask[]>;
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
   * §5.5 #17-20 ⑩ v4.94 — 프로젝트별 중단점 (projectName → 목록).
   * 세션이 없어도 남는 사용자 표식이라 스냅샷으로 흐르고 체크포인트로 저장된다.
   * optional — 구버전 체크포인트 하위호환. 미설정이면 빈 맵으로 취급.
   */
  debugBreakpoints?: Record<string, DebugBreakpoint[]>;
  /**
   * §5.9 화면/프로그램 캡처 버블 목록(전체 프로젝트). CommentBox 처럼 Manager 레벨 필드로,
   * 클라이언트는 `projectName === activeProject` 로 걸러 렌더한다.
   */
  captureBubbles?: CaptureBubble[];
  /** §5.13 v4.45 — 내부 앱 버블 목록. `projectName` 으로 걸러 렌더한다. */
  appBubbles?: AppBubble[];
  /** §5.14 v4.62 — 플레이 버블 목록. `projectName` 으로 걸러 렌더한다. */
  playBubbles?: PlayBubble[];
  /** §5.15 — 스펙 보드 목록. `projectName` 으로 걸러 렌더한다. */
  specDocs?: SpecDoc[];
  /** §5.16 — 리뷰·승인 레인 목록. `projectName`(워크트리) 으로 걸러 렌더한다. */
  reviewRequests?: ReviewRequest[];
  /** §5.18 — 에이전트 랩 목록. `projectName` 으로 걸러 렌더한다. */
  labRuns?: LabRun[];
  /** §5.20 — 스크립트 선반 목록. `projectName` 으로 걸러 렌더한다. */
  shelfBubbles?: ShelfBubble[];
  /**
   * §5.21 — 프로젝트별 비용·토큰 지도. 키 순서 없이 프로젝트당 한 장이며
   * 세션 원장의 `days` 는 여기 실리지 않는다(체크포인트 전용 — 전선 용량).
   */
  costMaps?: ProjectCostMap[];
  /**
   * §5.22 — 프로젝트별 감사 원장(프로젝트당 한 장). 집계(`counts`)는 서버가 접어서 실어 준다.
   */
  auditLogs?: ProjectAuditLog[];
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
  /**
   * §4 — 화면용 사용량. 바로 위 `rateLimits`(statusLine 원천)에서 파생한 표시 모양이다.
   * 글로벌 1건(한도는 사용자 단위). 영속화 ❌ — 런타임 캐시.
   */
  claudeUsage?: ClaudeUsageInfo;
  /**
   * §4 v4.82 — Claude 계정 로그인 상태(`claude auth status`). 글로벌 1건. 영속화 ❌ — 런타임 캐시.
   * 클라는 이 값만 보고 로그인 팝업 노출/옵션창 Account 표시를 결정한다.
   */
  claudeAuth?: ClaudeAuthStatus;

  /**
   * §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 판정. 글로벌 1건. 영속화 ❌ — 런타임 캐시.
   * 클라는 이 값만 보고 설치 게이트/상단 배너 노출을 결정한다(로그인 팝업보다 **앞** 단계).
   */
  claudeSetup?: ClaudeSetupState;

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
   * §5.3 #10-3 v4.98 — 검증 런 (autoAgentId → AutoAgentRun[], 최신순).
   * 클라 `AutoAgentPanel` 의 런 목록·증거 표·지표 렌더 데이터 소스. 미설정 시 빈 맵.
   */
  autoAgentRuns?: Record<string, AutoAgentRun[]>;

  /**
   * §4 v2.38 — 동적 모델 레지스트리. 서버가 부팅 시 시드 + `/v1/models` 머지로 빌드.
   * 클라 AgentConfigPopup 의 버전 sub-드롭다운 데이터 소스. 미설정 시 클라는 시드로 자체 폴백.
   */
  modelRegistry?: ModelRegistry;
  /**
   * §5.19 — 로컬 LLM(엔진 설치 상태 + 받아 둔 모델 + 진행 중 다운로드).
   * `modelRegistry` 와 같은 성격의 **기기 전역** 값이라 프로젝트 체크포인트에 영속하지 않는다
   * — 디스크의 실물이 진실이고, 서버가 부팅·변경 시마다 다시 읽어 싣는다.
   */
  localLlm?: LocalLlmState;
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

  /**
   * §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 설정 (subAgentId → SessionLoop).
   * 키가 세션 탭 ID 라 IDE 가 활성 탭 하나만 바로 집어 쓴다. 미설정 시 빈 맵.
   */
  sessionLoops?: Record<string, SessionLoop>;

  /**
   * §5.5 #17-17 v4.46 — 세션 목표 (subAgentId → SessionGoal).
   * 루프와 같은 키 축(세션 탭)이라 활동바가 활성 탭 하나의 퍼센트만 바로 집어 쓴다. 미설정 시 빈 맵.
   */
  sessionGoals?: Record<string, SessionGoal>;

  /**
   * §5.5 #17-28 — 컨텍스트 주입원 오버라이드(프로젝트 층 + 세션 층).
   * 화면이 "지금 무엇이 꺼져 있는지"를 스냅샷만으로 그릴 수 있게 함께 내려보낸다.
   * 목록(무엇이 있는지)은 조회 API 가 매번 재는 실측이고, 여기 실리는 것은 **사용자의 뜻**뿐이다.
   */
  contextOverrides?: ContextOverrides;

  /**
   * §4 v3.21 — 에이전트 피드백 (agentId → AgentFeedback[], targetId 별 upsert).
   * 사용자가 `POST /api/agent-feedback` 로 남긴 좋아요/싫어요 평가. 미설정 시 빈 맵.
   */
  agentFeedbacks?: Record<string, AgentFeedback[]>;

  /**
   * §5.10 Project Brain — 두뇌 요약(카드 수/미확인 수/최근 카드 1줄/에이전트별 카드 수).
   * Brain 버블 배지·본체 렌더용 **경량 요약만** 스냅샷에 실린다. 카드 본문은 절대 스냅샷을
   * 타지 않는다(§9 perf v3.40/v3.45 — 큰 텍스트는 REST lazy fetch). 미설정 시 클라 폴백.
   *
   * v3.70 — **projectName 1차 키**. 카드는 `<projectPath>/.vibisual/brain/` 로 프로젝트별로
   * 갈라져 저장되므로 요약도 프로젝트별이어야 한다(Brain 버블은 활성 프로젝트의 두뇌를 보여준다).
   * 단일 객체이던 구조에서는 프로젝트 2개 이상이 열렸을 때 `mergeSnapshots` 가 필드를 통째로
   * 떨궈 카드가 있어도 "0장"으로 보였다 — `skillUsageCounts` 와 동형 키로 맞춰 병합-안전하게 만든다.
   */
  brain?: Record<string, BrainSummary>;

  /**
   * §5.10 Project Brain — 주입 발생 이벤트 (agentId → BrainInjectionEvent[], 최신순 append,
   * 에이전트당 BRAIN_INJECTIONS_MAX_PER_AGENT 캡). IDE "기억 N장 참조" 칩 + Brain→에이전트
   * 일시 엣지 연출용 신호(카드 id/title 만). **런타임 전용 — ProjectCheckpoint 에 영속하지
   * 않는다**(agentReports 와 달리 재시작 시 자연 비움; 주입 이력은 카드의 refCount 로 남음).
   */
  brainInjections?: Record<string, BrainInjectionEvent[]>;

  /**
   * §5.11 v4.65 — **집행 플러그인의 실측**(projectPath → pluginId → 실측 한 벌).
   *
   * 집행(`agentPrompt`)은 서버에서 프로젝트 파일을 실제로 훑어 판단하는데, 카드는 클라에 있어 파일을
   * 볼 수 없다. 그래서 v4.57~v4.63 의 `ssot-drift` 는 프롬프트에 `docs/SCENARIO.md` 를 실으면서
   * 화면에는 rules·skills·기억 수를 "진실 공급원"이라 표시했다 — **집행과 카드가 다른 것을 세는**
   * 상태라, 사용자가 켠 결과를 확인할 방법이 없었다. 그 한 칸을 잇는 것이 이 필드다.
   *
   * 키가 projectPath 인 이유: 켬/끔이 프로젝트별(`enabledPluginsByProject`)이므로 실측도 같은 키여야
   * 창·카드·집행이 같은 프로젝트를 말한다. **읽기 전용·영속 0** — 파일에서 언제든 다시 구하므로
   * `ProjectCheckpoint` 4지점에 넣지 않는다. 켠 집행 모듈이 없으면 필드 자체가 없다(종전과 동일).
   */
  pluginFacts?: Record<string, Record<string, PluginFactMap>>;
}

/**
 * 플러그인 실측 한 벌 — 카드가 그대로 그릴 수 있는 얕은 값만.
 *
 * 중첩을 허용하지 않는 이유: 카드는 이 값을 한 줄로 그리는 계기판이고, 구조가 깊어지면 카드마다
 * 다른 해석이 필요해져 "서버가 판단하고 카드는 그린다"는 경계가 흐려진다.
 */
export type PluginFactMap = Record<string, string | number | boolean | string[]>;

// ─── §9 v3.89 — graph_snapshot 무거운 키맵 슬라이스 증분 전송 ────────────────────

/**
 * 키맵 슬라이스(`Record<id, T>`)의 증분 — **바뀐 키만** 싣고 나머지는 수신 측이 이전 값을 유지한다.
 *
 * 왜: `graph_snapshot` 은 전체 그래프를 16~250ms 마다 통째로 실어 보낸다. 그 중 `fileEdits`
 * (edit 마다 oldString/newString 원문)와 `bashHistory`(명령 + 출력 원문)는 **작업할수록 계속 쌓이는
 * 큰 텍스트**여서, 실측 저장소에서 스냅샷 3.2MB 중 2.5MB(78%)를 차지했다. 안 바뀐 파일의 diff 원문이
 * 초당 수 회씩 직렬화·클론·파싱된 셈이고, 이건 "쓸수록 느려진다" 로 직결된다. 이미 SSOT 가 §5.10
 * Brain 카드 본문에 대해 세운 원칙("큰 텍스트는 스냅샷에 태우지 않는다")을 전송 계층에서 일반화한 것.
 *
 * 기능·표시는 그대로다 — 수신 측이 이전 값 위에 증분을 얹어 **같은 전체 맵**을 복원한 뒤 기존 경로로
 * 넘긴다(느린 로딩·별도 요청 없음).
 */
export interface KeyedSliceDelta<T> {
  /** 이번에 값이 바뀐 키들(추가 포함). */
  changed: Record<string, T>;
  /** 이번에 사라진 키들. */
  removed: string[];
}

/** graph_snapshot 에 함께 실리는 증분 묶음. 해당 슬라이스는 본문에서 생략된다. */
export interface GraphSnapshotDeltas {
  fileEdits?: KeyedSliceDelta<FileEdit[]>;
  bashHistory?: KeyedSliceDelta<BashEntry[]>;
}

/**
 * 실제로 전선을 타는 스냅샷 형태 — 증분으로 대체된 슬라이스는 `undefined` 로 빠진다.
 *
 * ⚠ 새로 접속한 클라이언트에는 **항상 전체 스냅샷**(`deltas` 없음)이 먼저 간다
 * (`buildConnectionMessages`). 증분은 그 뒤의 브로드캐스트에만 실린다.
 */
export type GraphSnapshotWire =
  Omit<GraphSnapshot, 'fileEdits' | 'bashHistory'>
  & {
    fileEdits?: Record<string, FileEdit[]>;
    bashHistory?: Record<string, BashEntry[]>;
    deltas?: GraphSnapshotDeltas;
  };

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
 * §5.5 #17-19 v4.71 — IDE 워크스페이스 탐색기의 엔트리 한 개(디렉터리 한 겹).
 *
 * `FolderFileEntry`(위성 선택용)와 달리 **경로를 소문자로 뭉개지 않고** 숨김 항목도 그대로 담는다 —
 * 탐색기는 디스크에 있는 그대로를 보여 주는 것이 목적이라, 위성 매칭용 정규화가 오히려 오표시가 된다.
 */
export interface WorkspaceEntry {
  /** 파일/폴더 이름 (원본 대소문자) */
  name: string;
  /** 트리 루트 기준 상대 경로 (forward slash, 원본 대소문자) */
  relPath: string;
  /** 디렉토리 여부 (심볼릭 링크는 실제 대상 기준) */
  isDirectory: boolean;
  /** 파일 크기 (bytes). 디렉토리이거나 stat 실패 시 생략 */
  size?: number;
  /** 마지막 수정 시각 (ms). stat 실패 시 생략 */
  mtimeMs?: number;
  /**
   * §5.13 (R-7) — 눌러서 **실행**할 수 있는가(파일만).
   *
   * 탐색기에서 누른 것과 본문에서 누른 것이 같은 곳으로 가야 하므로, 스트림 경로 손잡이가 쓰는
   * 판정(`/api/workspace-path` 의 `executable`)을 목록도 그대로 받는다.
   */
  executable?: boolean;
}

/** §5.5 #17-19 v4.71 — 디렉터리 한 겹 조회 응답 (`GET /api/workspace-dir`). */
export interface WorkspaceDirListing {
  /** 트리 루트 절대 경로 (요청한 값 그대로) */
  root: string;
  /** 루트 기준 상대 경로 ('' = 루트 자신) */
  path: string;
  /** 이 디렉터리의 자식들 — 폴더 먼저, 이름순(대소문자 무시) */
  entries: WorkspaceEntry[];
  /** WORKSPACE_DIR_ENTRY_MAX 를 넘어 잘렸으면 true */
  truncated: boolean;
}

/** §5.5 #17-27 ⑬ — 디스크에 있는 경로 하나의 정체. 없으면 응답 자체가 404 라 'missing' 값은 두지 않는다. */
export type WorkspacePathKind = 'file' | 'directory';

/**
 * §5.5 #17-27 ⑬ — 경로 한 개의 정체 조회 응답 (`GET /api/workspace-path`).
 *
 * 스트림 본문에 적힌 경로를 **파일이면 내장 편집창 · 폴더면 시스템 탐색기** 로 갈라 열기 위한 것이다.
 * 목록(`WorkspaceDirListing`)이 아니라 **한 경로의 있음/정체**만 묻는 자리라 응답이 이만큼 작다.
 */
export interface WorkspacePathInfo {
  /** 트리 루트 절대 경로 (요청한 값 그대로) */
  root: string;
  /** 루트 기준 상대 경로 (forward slash, 정규화됨) */
  path: string;
  /** 해석된 절대 경로 — 폴더 열기(`open-node-folder`)에 그대로 실어 보낸다 */
  absPath: string;
  /** 파일인가 폴더인가 (심볼릭 링크는 실제 대상 기준) */
  kind: WorkspacePathKind;
  /**
   * §5.5 #17-27 ⑬ (h) — **눌러서 실행할 수 있는 것인가**.
   *
   * 참이면 화면은 편집창(②)·탐색기(⑩) 대신 **실행**(#17-20 ④ 실행 세션)으로 간다 — 본문에 적힌
   * `.exe` 를 누르는 뜻은 "이 프로그램을 켜라" 이지 "이진 파일을 편집창에 띄워라" 가 아니다.
   * 판정은 디스크를 본 서버가 한다(Windows 확장자 · macOS `.app` 번들 · POSIX 실행 비트) —
   * 글자 모양만 보고 화면이 정하면 플랫폼마다 갈리는 규칙이 두 벌이 된다.
   */
  executable: boolean;
}


// ─── §5.13 (R-8) — 변환기 상태와 변환 작업 ──────────────────────────────────────

/**
 * 이 PC 의 **변환기(ffmpeg)** 상태.
 *
 * "코덱이 깔렸는가"가 아니다(§5.13 (R-8) (a) — Chromium 은 시스템 코덱을 쓰지 않는다).
 * 우리가 배포하지 않고 있으면 쓰는 물건이라, 화면은 이 값을 보고 [변환] 과 [설치] 중 무엇을 낼지 정한다.
 */
export interface MediaToolsInfo {
  readonly available: boolean;
  /** 찾은 실행 파일 절대 경로(없으면 null). */
  readonly ffmpegPath: string | null;
  /** 길이를 재는 데 쓰는 짝(없어도 변환은 되지만 진행률이 안 뜬다). */
  readonly ffprobePath: string | null;
  /** `ffmpeg version` 에서 뽑은 판올림. */
  readonly version: string | null;
  /** 이 OS 에서 설치를 대행할 수 있는 창구. 없으면 화면이 공식 페이지를 안내한다. */
  readonly installer: 'winget' | 'brew' | null;
}

/** 변환 작업의 상태. `done` 이면 `outRel` 이 실제로 디스크에 있다. */
export type MediaConvertStatus = 'queued' | 'running' | 'done' | 'error';

/**
 * 변환 작업 하나.
 *
 * 진실은 **디스크의 캐시 파일**이고 이 레코드는 그 과정을 화면에 보여 주기 위한 휘발성 상태다
 * (체크포인트 미관여 — 앱을 껐다 켜면 사라지지만 결과 파일은 남아 다음엔 변환 없이 열린다).
 */
export interface MediaConvertJob {
  readonly id: string;
  /** 프로젝트 루트 절대 경로. */
  readonly root: string;
  /** 원본(루트 기준 상대 경로). */
  readonly sourceRel: string;
  /** 결과물(루트 기준 상대 경로) — `.vibisual/media-cache/…`. */
  readonly outRel: string;
  readonly kind: MediaConvertKind;
  readonly status: MediaConvertStatus;
  /** 0~100. 길이를 못 재는 파일은 끝날 때까지 0 에 머문다(거짓 진행률을 만들지 않는다). */
  readonly percent: number;
  readonly error?: string;
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** §5.5 #17-27 v4.87 — 파일의 원본 줄바꿈. 저장할 때 이 형식으로 되돌린다(브라우저 textarea 는 항상 `\n`). */
export type WorkspaceEol = 'lf' | 'crlf';

/**
 * §5.5 #17-27 v4.87 — IDE 내장 편집창이 읽은 파일 한 개 (`GET /api/workspace-file`).
 *
 * `truncated`/`binary` 는 **읽기 전용으로 열라는 신호**다 — 잘린 본문이나 깨진 텍스트를 저장하면
 * 원본이 그 자리에서 사라진다. 저장 요청은 이 둘이 false 인 파일에서만 만들어진다.
 */
export interface WorkspaceFileContent {
  /** 트리 루트 절대 경로 (요청한 값 그대로) */
  root: string;
  /** 루트 기준 상대 경로 (forward slash, 원본 대소문자) */
  path: string;
  /** 파일 본문 — 줄바꿈은 항상 `\n` 으로 정규화(원본 형식은 `eol`) */
  text: string;
  /** 파일 전체 크기 (bytes) */
  size: number;
  /** 마지막 수정 시각 (ms) — 저장할 때 되돌려 보내 그 사이 변경을 판정 */
  mtimeMs: number;
  /** WORKSPACE_FILE_MAX_BYTES 를 넘어 앞부분만 담았으면 true (읽기 전용) */
  truncated: boolean;
  /** 텍스트로 읽을 수 없는 파일(NUL 바이트 포함)이면 true (읽기 전용) */
  binary: boolean;
  /**
   * §5.5 #17-27 ⑭ — 이 파일을 **그림으로 열어야 하는가**.
   *
   * `이미지 확장자 && binary` 일 때만 true 다 — 판정을 서버 한 곳에서 끝내 클라이언트가 두 값을
   * 다시 조합하지 않게 한다. SVG 처럼 텍스트로 읽히는 이미지는 false 라 종전대로 소스가 열린다
   * (그쪽은 고칠 수 있는 글자이므로 그림으로 바꿔 편집을 빼앗지 않는다).
   */
  image: boolean;
  /**
   * §5.5 #17-27 ⑫ — 디스크가 쓰기를 막고 있으면 true (Perforce 체크아웃 전 파일·`attrib +r`·권한).
   *
   * `truncated`/`binary` 와 달리 **타이핑을 막는 신호가 아니다** — 내용은 온전하므로 고쳐 두었다가
   * 저장하는 순간 잠금을 푼다(`WorkspaceFileSaveRequest.clearReadOnly`).
   */
  readOnly: boolean;
  /** 원본 줄바꿈 */
  eol: WorkspaceEol;
}

/** §5.5 #17-27 v4.87 — 파일 저장 요청 (`PUT /api/workspace-file`). */
export interface WorkspaceFileSaveRequest {
  root: string;
  path: string;
  /** 저장할 본문 — 줄바꿈은 `\n`, 서버가 `eol` 로 되돌려 쓴다 */
  text: string;
  eol: WorkspaceEol;
  /** 읽을 때 받은 `mtimeMs`. 디스크가 그 사이 바뀌었으면 서버가 409 로 막는다 */
  baseMtimeMs: number;
  /**
   * §5.5 #17-27 ⑫ — 읽기 전용 잠금을 **풀고** 저장한다(사용자가 그 버튼을 눌렀을 때만 true).
   *
   * 서버는 쓰기 비트를 켠 뒤 저장하고, 잠금을 되돌려 걸지 않는다. 버전 관리 명령(`p4 edit` 등)은
   * 실행하지 않는다 — 편집창의 권한은 파일 속성 한 비트까지다.
   */
  clearReadOnly?: boolean;
}

/** §5.5 #17-27 v4.87 — 파일 저장 결과 (덮어쓴 뒤의 크기·수정 시각). */
export interface WorkspaceFileSaveResult {
  root: string;
  path: string;
  size: number;
  mtimeMs: number;
  /** §5.5 #17-27 ⑫ — 저장 뒤에도 여전히 잠겨 있는가(잠금을 풀었으면 false 로 돌아온다). */
  readOnly: boolean;
}

/**
 * §5.5 #17-25 ④-1 — 주석본으로 **그 이미지 파일을 덮어쓰는** 요청 (`PUT /api/workspace-image`).
 *
 * 텍스트 저장(`WorkspaceFileSaveRequest`)과 갈라 두는 이유는 본문이 글자가 아니라 바이트이기
 * 때문이다 — 줄바꿈(`eol`) 규약이 의미가 없고, 본문은 **이미지 바이트 그대로** 싣는다(base64 는 33% 를 부풀리고, 패키징 트랜스포트가 이미 바이너리 본문을 무손실로 나른다). 나머지 규율(읽을 때 본
 * `mtimeMs` 대조 → 409)은 텍스트 쪽과 **같은 것**을 쓴다.
 */
export interface WorkspaceImageSaveRequest {
  root: string;
  path: string;
  /** 읽을 때 받은 `mtimeMs`. 디스크가 그 사이 바뀌었으면 서버가 409 로 막는다. `0` 이면 대조 생략. */
  baseMtimeMs: number;
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
   * §5.9 화면/프로그램 캡처 버블 목록 (이 프로젝트 스코프).
   * optional — 구버전 체크포인트 하위호환. 미설정이면 빈 배열로 복원.
   */
  captureBubbles?: CaptureBubble[];
  /** §5.13 v4.45 — 내부 앱 버블(영속). optional — 구버전 체크포인트 하위호환. */
  appBubbles?: AppBubble[];
  /** §5.14 v4.62 — 플레이 버블(영속). optional — 구버전 체크포인트 하위호환. */
  playBubbles?: PlayBubble[];
  /** §5.15 — 스펙 보드(영속). optional — 구버전 체크포인트 하위호환. */
  specDocs?: SpecDoc[];
  /** §5.16 — 리뷰·승인 레인(영속). optional — 구버전 체크포인트 하위호환. identity 에는 넣지 않는다(diff 는 재계산 가능). */
  reviewRequests?: ReviewRequest[];
  /** §5.18 — 에이전트 랩(영속). optional — 구버전 체크포인트 하위호환. */
  labRuns?: LabRun[];
  /** §5.20 — 스크립트 선반(영속). optional — 구버전 체크포인트 하위호환. */
  shelfBubbles?: ShelfBubble[];
  /**
   * §5.21 — 비용·토큰 지도(영속). optional — 구버전 체크포인트 하위호환.
   * identity 에는 넣지 않는다 — 사용자가 만든 정체성이 아니라 트랜스크립트에서 다시 접을 수 있는 파생이다.
   */
  costMap?: ProjectCostMap;
  /**
   * §5.22 — 권한·감사 원장(영속). optional — 구버전 체크포인트 하위호환.
   * identity 에는 넣지 않지만 **결정 이력은 재계산이 불가능**하므로 여기서 빠지면 영영 없다.
   */
  auditLog?: ProjectAuditLog;
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
   * §5.3 #10-3 v4.98 — 검증 런 (autoAgentId → AutoAgentRun[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * "무엇을 근거로 완료라고 했는가"는 세션을 넘어 남아야 하는 증거라 영속 대상.
   */
  autoAgentRuns?: Record<string, AutoAgentRun[]>;

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
   * §4 v3.21 — 에이전트 피드백 (agentId → AgentFeedback[]) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * 사용자 평가는 세션을 넘어 학습 근거로 쓰이는 사용자 산출물이라 영속 대상.
   */
  agentFeedbacks?: Record<string, AgentFeedback[]>;

  /**
   * §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 설정 (subAgentId → SessionLoop) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * 사용자가 직접 짜 넣은 설정 + 진행 카운트라 재시작 후에도 이어져야 한다.
   */
  sessionLoops?: Record<string, SessionLoop>;

  /**
   * §5.5 #17-17 v4.46 — 세션 목표 (subAgentId → SessionGoal) 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 맵으로 복원.
   * 사용자가 직접 쓴 문장 + 진행 이력이라 재시작 후에도 그대로 이어져야 한다
   * (§3.2.2 정체성 성격이므로 identity.json 에도 함께 실린다).
   */
  sessionGoals?: Record<string, SessionGoal>;

  /**
   * §5.5 #17-28 — 컨텍스트 주입원 오버라이드 영속화.
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 오버라이드(= 전부 기본값).
   * 사용자가 "이건 넣지 마라"라고 정한 뜻이라 재시작 후에도 그대로 지켜져야 한다
   * (잃으면 껐던 것이 조용히 다시 실린다 — 이 기능의 신뢰가 무너지는 지점).
   */
  contextOverrides?: ContextOverrides;

  /**
   * §3.2.1-3 v2.63 — 명시적으로 삭제된 커스텀 에이전트 sessionId 묘비.
   * identity.json 의 `deletedSessionIds` 와 같은 의미·소스. checkpoint 에도 실어
   * deriveIdentity 가 단일 소스에서 파생할 수 있게 한다(필터·왕복 일관성).
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 배열.
   */
  deletedCustomAgentIds?: string[];

  /**
   * §5.5 #17-20 ⑩ v4.94 — 이 프로젝트에 찍어 둔 중단점.
   *
   * 세션이 없어도 존재하는 사용자 표식이라 껐다 켜도 남아야 한다. 반대로 세션·콜스택·변수는
   * 프로세스 수명이므로 여기 넣지 않는다. 다시 찍으면 복구되는 것이라 `identity.json` 미관여
   * (§3.2.2 판단 기준 — "복구 불가한 산출물" 이 아니다).
   * optional — 구버전 체크포인트 하위 호환. 미설정이면 빈 배열.
   */
  debugBreakpoints?: DebugBreakpoint[];
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
  /** §5.9 화면/프로그램 캡처 버블 목록 (이 프로젝트 스코프, 정체성 데이터). */
  captureBubbles: CaptureBubble[];
  /** §5.13 v4.45 — 내부 앱 버블 목록 (정체성 — 잃으면 사용자가 만든 것이 사라진다). */
  appBubbles: AppBubble[];
  /** §5.14 v4.62 — 플레이 버블 목록 (정체성 — 사용자가 놓은 버튼 + 확정한 실행 레시피). */
  playBubbles: PlayBubble[];
  /**
   * §5.15 — 스펙 보드 목록 (정체성 — 사람이 쓴 요구사항 문장이라 잃으면 복구할 길이 없다).
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 배열로 취급.
   */
  specDocs?: SpecDoc[];
  /**
   * §5.18 — 에이전트 랩 목록 (정체성 — 사람이 쓴 과제 문장과 설정 조합은 복구할 길이 없다).
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 배열로 취급.
   */
  labRuns?: LabRun[];
  /**
   * §5.20 — 스크립트 선반 목록 (정체성 — 사람이 모아 둔 명령·프롬프트는 코드에서 되살릴 길이 없다).
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 배열로 취급.
   */
  shelfBubbles?: ShelfBubble[];
  /** 콘티 데이터 (contiId → Conti). */
  contis: Record<string, Conti>;
  /**
   * §5.5 #17-17 v4.46 — 세션 목표 (subAgentId → SessionGoal).
   * 사용자가 직접 쓴 문장이라 잃으면 복구할 길이 없다(§3.2.2 정체성).
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 맵으로 취급.
   */
  sessionGoals?: Record<string, SessionGoal>;
  /**
   * §3.2.1-3 v2.63 — 사용자가 **명시적으로 삭제**한 커스텀 에이전트의 sessionId 묘비.
   * shrink guard 가 "정상 삭제(여기 기록됨)"와 "복원 실패(미기록 소멸)"를 구분하는 신호.
   * 부활(mergeIdentityIntoCheckpoint) 시 이 집합의 sessionId 는 되살리지 않는다 → 유령 부활 차단.
   * optional — 구버전 identity.json 하위호환. 미설정이면 빈 배열로 취급.
   */
  deletedSessionIds?: string[];
}

// §5.10 — 구 RecoverableCustomAgent("지난 커스텀 에이전트 복구" 메타)는 휴지통(trashed BubbleData)이 후신이 되어 제거됨.

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
/**
 * §4 v2.42 / (CMD 터미널 업그레이드 ④) — 알림 기본값.
 * placeholder 였던 `Record<string, unknown>` 을 **인덱스 시그니처를 유지한 채** 넓힌 것이라
 * 기존 저장 파일과 하위 호환된다(모르는 키는 그대로 통과).
 */
export interface UserNotificationDefaults extends Record<string, unknown> {
  /**
   * CMD 세션이 백그라운드에서 `blocked` 로 바뀔 때 OS 알림을 띄울지.
   * undefined = 켬(기본). false 로만 끈다.
   */
  cmdBlocked?: boolean;
}

/**
 * §4 v2.42 / (CMD 터미널 업그레이드 ③) — 고급 기본값.
 * 위와 같은 이유로 인덱스 시그니처를 유지한다.
 */
export interface UserAdvancedDefaults extends Record<string, unknown> {
  /**
   * 임베디드 터미널 scrollback 줄 수. undefined = `TERMINAL_SCROLLBACK_LINES`.
   * 이 한 값이 xterm `scrollback` 과 desktop PTY 링버퍼 상한을 **동시에** 정한다.
   */
  terminalScrollbackLines?: number;
}

export interface UserDefaults {
  /** §4 v2.42 — 신규 에이전트 기본 설정. Partial — 미설정 필드는 `DEFAULT_AGENT_CONFIG` 사용. */
  agentConfig?: Partial<AgentConfig>;
  /** §4 v2.42 — 외관. 1차는 uiLocale 만. */
  appearance?: {
    uiLocale?: UiLocale;
  };
  /** §4 v2.42 — 알림. 1차 placeholder. */
  notifications?: UserNotificationDefaults;
  /** §4 v2.42 — 권한 승인 UX. 1차 placeholder. */
  permissions?: Record<string, unknown>;
  /** §4 v2.42 — 고급(API 키·bin 경로·debug). 1차 placeholder. */
  advanced?: UserAdvancedDefaults;
  /**
   * §5.13 (N) v4.46 — **설치된 내부 앱 id 목록**.
   *
   * 내부 앱은 플러그인이 아니라 자기 창·자기 데이터를 가진 독립 애플리케이션이고,
   * 무거워서 기본 번들에 넣지 않는 것들이 여기로 온다. 앱마다 전용 필드를 만들면
   * 앱이 늘 때마다 `UserDefaults` 가 같이 자라므로 **목록 하나**로 받는다
   * (`enabledPlugins` 와 같은 모양).
   *
   * 전역 1건인 이유는 설치가 프로젝트가 아니라 이 기기에 매이기 때문이다.
   */
  installedApps?: string[];
  /**
   * §5.10 v2 (H) — **프로젝트별 두뇌 활성화.** 키 없음 = 꺼짐(기본 off).
   *
   * `enabledPluginsByProject` 와 **같은 모양**을 의도한 것이다 — 활성 단위가 프로젝트인 이유도
   * 같다(두뇌 데이터가 `<projectPath>/.vibisual/brain` 에 있다). 다만 브레인은 플러그인이
   * **아니다**: §5.11 v3.88 결정 ④(기존 기능은 플러그인으로 만들지 않는다)를 유지한 채
   * 코어에 두고 게이트만 신설한 것이므로, 빌려온 것은 **UX 문법**뿐이다(§5.10 v2 (I)).
   */
  brainByProject?: Record<string, BrainActivation>;
  /**
   * @deprecated v4.46 에서 `installedApps` 로 일반화됐다. 읽기 전용 하위호환 —
   * 이 값이 있으면 Vibistudio 가 설치된 것으로 본다. 새로 쓰지 않는다.
   */
  videoStudio?: {
    installed: boolean;
    installedAt?: number;
    assetPackVersion?: string;
  };
  /**
   * §4 v2.43 — 옵션창 Version 탭에서 사용자가 선택한 `claude` 바이너리 절대 경로(override).
   * 미설정/빈 문자열 = 자동 탐색(`resolveClaudeBin` 기본 우선순위). 설정 시 `resolveClaudeBin` 이
   * 최우선 반환(파일 존재 검증 후). `subAgentManager` 가 모듈 로드 시 1회 캡처하므로 변경은 다음 실행에 적용.
   */
  claudeBinPath?: string;
  /**
   * §4 (Claude Code CLI 자동 업데이트) — **CLI 를 앱 켤 때마다 최신으로 유지할지**.
   *
   * **미설정 = 켬**(`enabled !== false` 로 판정). 켜져 있으면 부팅 시 1회
   * `getClaudeVersionInfo` → `isOutdated` 면 `installLatestClaude()` 를 조용히 돌린다.
   * 끄면 그 자동 경로만 멈추고 옵션창 Version 탭의 [지금 업데이트] 수동 버튼은 그대로 쓴다.
   *
   * ⚠ **§4 v2.44 Vibisual 앱 자동 업데이트(electron-updater)와는 무관한 별개 축**이다 —
   * 갱신 대상(CLI vs 앱)도 주체(우리 spawn vs electron-updater)도 다르므로 토글을 공유하지 않고,
   * 앱 업데이트는 종전대로 항상 자동이다.
   */
  claudeAutoUpdate?: {
    enabled?: boolean;
  };
  /**
   * §5.11 v4.54 — **프로젝트별** 활성 플러그인 목록. 키 = 프로젝트 루트 절대경로(`ProjectInfo.path` = projectId).
   *
   * 플러그인 켬/끔은 프로젝트마다 따로다(사용자 지시). 표시명(`ProjectInfo.name`)은 basename 충돌 시
   * 세션 간 바뀔 수 있어 키로 쓰지 않는다 — 이름으로 키를 잡으면 프로젝트를 하나 더 여는 것만으로
   * 남의 설정을 물려받는다.
   *
   * - 프로젝트 키가 없음 = 그 프로젝트는 아직 손대지 않음 → 구 전역 `enabledPlugins` 시드 → `enabledByDefault`.
   * - 배열이면 **그 배열이 진실** — 목록에 없는 id 는 전부 비활성(기본값 무시).
   * - 비활성은 "기여 미등록"일 뿐, **그 플러그인의 데이터를 지우지 않는다**(§5.11 끄면 숨김).
   *
   * 판정은 반드시 `resolveEnabledPluginsFor`/`isPluginEnabledFor`(@vibisual/plugins) 를 거친다 —
   * 창·클라 호스트·서버 관문이 각자 해석하면 세 곳이 조용히 갈린다.
   */
  enabledPluginsByProject?: Record<string, string[]>;
  /**
   * §5.11 v3.88 — 활성화된 플러그인 id 목록 (구 **전역** 값).
   *
   * @deprecated v4.54 에서 `enabledPluginsByProject` 로 대체됐다. **읽기 전용 하위호환** — 아직
   * 프로젝트별 설정이 없는 프로젝트의 시드로만 쓰이고, 새로 쓰지 않는다(이미 켜 둔 것이 판올림에서
   * 조용히 꺼지는 것을 막기 위해 남긴다).
   */
  enabledPlugins?: string[];
  /** §4 v2.42 — 마지막 갱신 시각 (ms). PUT 응답·broadcast 디버그용. */
  updatedAt: number;
}

// ─── 플러그인 커널 (§5.11 v3.88) ───

/**
 * 플러그인이 선언할 수 있는 기여 종류 — §4 확장 포인트 표를 그대로 옮긴 것.
 *
 * **v1 개통은 3종뿐**(`bubbleBadge` / `panelSection` / `settingsSection`). 나머지는 이름만 예약이며
 * 호스트가 아직 슬롯을 열지 않았다 — 선언하면 PluginsWindow 가 "이 버전에서 미지원"으로 표시한다.
 * 슬롯은 한 번 열면 되돌리기 어려우므로 실제 수요가 생긴 것만 연다(점진적 공개).
 */
export type PluginContributionKind =
  | 'bubbleBadge'
  | 'panelSection'
  | 'settingsSection'
  /**
   * §5.11 v4.57 — **집행(execution) 슬롯**. 이 프로젝트에서 켜져 있으면 그 플러그인이 만든 지시 블록이
   * **에이전트의 매 턴 프롬프트에 실린다** = 켜면 화면 한 칸이 아니라 **에이전트가 실제로 그렇게 일한다**.
   *
   * 표시 슬롯 3종과 결정적으로 다르다 — 여기 붙은 플러그인은 `clientOnly: false` 이고 서버가 조립한다.
   * 그래도 "임의 코드"는 아니다: 플러그인이 돌려주는 것은 **문자열 한 덩어리**뿐이고, 파일 접근조차
   * 호스트가 넘긴 좁은 탐침(`fileExists`/`readFile`, 프로젝트 루트 밖 금지)으로만 한다.
   */
  | 'agentPrompt'
  | 'ideView'
  | 'headerItem'
  | 'contextMenuItem'
  | 'hookSubscriber'
  | 'restRoute'
  | 'wsMessage'
  | 'agentConfigField'
  | 'brainCardKind'
  | 'bubbleType'
  | 'edgeKind';

/** 플러그인 분류 — PluginsWindow 좌측 그룹 라벨. */
export type PluginCategory = 'security' | 'observability' | 'workflow' | 'experimental';

/**
 * 플러그인 선언(매니페스트) — **순수 데이터**. React·node 에 의존하지 않는다.
 *
 * 매니페스트와 구현 모듈을 나누는 이유: PluginsWindow 가 **비활성 플러그인의 코드를 건드리지 않고도**
 * 목록·설명·기여 종류를 보여줄 수 있어야 하기 때문.
 */
export interface PluginManifest {
  /** kebab-case. 네임스페이스 키 — REST `/api/plugins/<id>/*`, WS `plugin:<id>:*`, 버블 `plugin:<id>:<name>`. */
  id: string;
  /** 표시명(브랜드성 고유명. i18n 대상 아님 — 설명문만 번역한다). */
  name: string;
  version: string;
  category: PluginCategory;
  /** 설명 i18n 키. 로케일 파일의 기존 6 네임스페이스 안에 둔다(§ i18n 규칙 — `plugin.*` 신규 네임스페이스 ❌). */
  descriptionKey: string;
  /** 사용자가 한 번도 손대지 않았을 때의 기본 활성 여부. */
  enabledByDefault: boolean;
  /** 선언한 기여 종류 — 호스트는 여기 없는 기여를 받아주지 않는다. */
  contributes: PluginContributionKind[];
  /** true = 서버 기여 없음(라우트·훅 구독 0). */
  clientOnly: boolean;
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
 * Claude Code CLI 내장 슬래시 명령 한 개 — `/` 자동완성 드롭다운(§5.5 #17-2)의 표시 단위.
 *
 * 목록 자체는 constants.ts 의 `BUILTIN_SLASH_COMMANDS` 이며 출처는 Anthropic 공개 문서다.
 * **표시 전용** — 서버는 사용자가 친 텍스트를 그대로 세션에 넘기므로, 이 목록에 없는 명령도
 * 사용자가 직접 치면 CLI 가 처리한다(반대로 여기 있어도 CLI 가 모르면 CLI 가 거절한다).
 */
export interface BuiltinSlashCommand {
  /** 슬래시를 뗀 이름 (예: `compact`). */
  name: string;
  /** 한 줄 설명 — 공개 문서 표의 첫 문장. */
  description: string;
  /** 같은 명령을 부르는 다른 이름들 (예: `clear` 의 `reset`·`new`). */
  aliases: readonly string[];
}

/**
 * §4 (슬래시 명령 가용성) — 이 명령이 **화면 있는 터미널을 요구하는가**.
 *
 * 판정 근거는 CLI 를 실제로 돌려 본 **공개 동작**이다: 헤드리스 세션에서 이런 명령을 보내면
 * CLI 가 `"/X isn't available in this environment."` 한 줄로 답하고 턴을 끝낸다(API 호출 0).
 * 누구든 그 명령을 한 번 쳐 보면 같은 답을 받는다.
 */
export type SlashCommandAvailability = 'anywhere' | 'terminal-only';

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
   * - 'seed' = Anthropic 공개 문서에서 옮겨 둔 `AVAILABLE_AGENT_MODEL_FULL_IDS` (기본 소스).
   * - 'api' = `/v1/models` API 응답 머지(`ANTHROPIC_API_KEY` 가 있을 때 — 최신을 자동 추종).
   *
   * (구 'cli-scan' = CLI 실행본 raw scan 은 폐기했다. 약관상 역설계에 닿을 소지가 있었고,
   *  공개 문서 시드로 옮겨도 목록은 유지된다.)
   */
  source: 'seed' | 'api';
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
 * - 'seed-only' = 공개 문서 시드만. `ANTHROPIC_API_KEY` 가 없을 때의 표준 경로.
 * - 'api-merged' = 시드 + `/v1/models` 머지(키가 있을 때).
 *
 * 클라 AgentConfigPopup 버전 sub-드롭다운의 데이터 소스. WS `model_registry_updated` 로 갱신.
 * 영속화 ❌ (서버 측 `.vibisual/model-registry.json` 캐시는 별개 — TTL 기반).
 */
export interface ModelRegistry {
  entries: ModelRegistryEntry[];
  updatedAt: number;
  sourceMix: 'seed-only' | 'api-merged';
  /**
   * §4 — 설치된 `claude` CLI 가 실제로 받아들이는 `--effort` 값 목록(예: `['low','medium','high','xhigh','max']`).
   * 서버 `modelRegistryService` 가 부팅 시 `claude --help` 출력의 `--effort <level> (...)` 를 파싱해 채운다(0 하드코딩).
   * 'default'(=오버라이드 없음)는 포함하지 않는다 — UI 가 맨 앞에 별도로 붙인다.
   * 파싱 실패/CLI 미발견 시 undefined → 클라 `listEffortLevels` 가 `AVAILABLE_EFFORT_LEVELS` 폴백.
   * WS `model_registry_updated` 로 entries 와 함께 전파(별도 메시지·store 필드 없이 재사용).
   */
  effortLevels?: string[];
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
  /**
   * §5.5 #17-20 ⑥ v4.74 — 이 에이전트에 붙일 MCP 서버 프리셋 id 목록(`MCP_SERVER_PRESETS`).
   * 켜면 `buildConfigArgs` 가 `--mcp-config <생성 파일>` + `--allowedTools mcp__<id>` 를 싣는다.
   * 헤드리스·CMD 두 스폰 경로가 같은 함수를 공유하므로 한 번 켜면 양쪽에 적용된다.
   */
  mcpServers?: string[];
  /**
   * §5.3 v4.89 — 이 에이전트가 세션을 넘어 유지하는 **자기 기억**의 범위.
   *
   * v4.89 이전에는 타입에만 있고 어디서도 읽지 않는 죽은 필드였다(서버 스폰·클라 UI 모두 미배선).
   * 이제 `buildConfigArgs` 가 이 값으로 `--settings <생성 파일>`(`autoMemoryDirectory`)을 실어
   * 에이전트마다 다른 기억 폴더를 쓰게 한다. `'off'` 면 대신 환경변수로 자동 기억을 끈다.
   *
   *  - `undefined` = 기본(레포 공용 기억) · `'off'` = 자동 기억 끔
   *  - `'user'`    = `~/.claude/agent-memory/<이름>/`            (모든 프로젝트에서 같은 기억)
   *  - `'project'` = `<프로젝트>/.claude/agent-memory/<이름>/`   (프로젝트 한정)
   *  - `'local'`   = `<프로젝트>/.claude/agent-memory-local/<이름>/`
   */
  memory?: AgentMemoryScope;
  /**
   * §5.3 v4.89 — 이 에이전트 **아래로** 몇 층까지 서브에이전트를 스폰할 수 있는지.
   * 스폰 시 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 로 전달. `1` 이면 중첩 없음,
   * `undefined` 면 CLI 기본값(3층)을 그대로 쓴다.
   */
  subagentDepth?: number;
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
   * §4 (CMD 터미널 업그레이드 ⑧) — CMD(`executionMode:'interactive-terminal'`) 버블이 띄울 CLI.
   * `executionMode` 와 **직교**하지만 의미는 CMD 경로에서만 있다(헤드리스는 이 값을 무시).
   * undefined = `'claude'` — 지금까지의 동작과 바이트 단위로 같다.
   * `'claude'` 가 아니면(`CMD_CLI_KINDS[].managed === false`) `--resume`·rules `--add-dir`·
   * `VIBISUAL_OWNER_AGENT_ID` 태그를 걸지 않는다 — 우리 훅의 자식이 아니기 때문이며,
   * §5.5 #17-20 ④ v4.74 실행 런처가 같은 이유로 그 셋을 건너뛰는 것과 같은 규율이다.
   */
  cliKind?: CmdCliKind;
  /**
   * §5.19 — 이 에이전트가 말을 거는 상대. `executionMode` 와 **직교하는 축**이다.
   *
   * **undefined = 지금까지의 claude 경로 그대로.** 기존 동작 무변경의 근거가 이 한 줄이며,
   * 서버의 갈림도 이 값 하나로만 판정한다(스폰 경로·인자 조립·훅 수신은 손대지 않는다).
   */
  provider?: AgentProvider;
  /**
   * §4 v2.88 — API 비용 상한(달러). 헤드리스 `claude -p` 스폰에 `--max-budget-usd <n>` 로 전달돼
   * 해당 금액 초과 시 런이 중단된다(2026.06.15 Agent SDK 크레딧 풀 분리 대응 — 폭주 방어).
   * undefined 또는 0 = **무제한**(기존 동작 보존). 양수일 때만 상한 적용.
   * CLI 제약상 `--max-budget-usd` 는 `--print` 전용 → 설정 시 persistent 재사용/Agent View 를 끄고
   * 매 턴 fresh `--print` 스폰으로 보내 상한이 실제 적용되게 한다(서버 subAgentManager).
   * interactive-terminal(구독 과금) 경로에는 적용하지 않는다(프로그래매틱 과금이 아님).
   */
  maxBudgetUsd?: number;
  /**
   * §4 (CLI 사양 추종) — 기본 모델이 과부하/불가일 때 대신 쓸 모델(`--fallback-model`).
   * 콤마로 여러 개를 주면 순서대로 시도하며, CLI 는 매 턴 시작에 1순위를 다시 시도한다.
   * **`--print` 전용 플래그**라 `maxBudgetUsd` 와 같은 자리(printFlags)에서만 붙는다.
   * undefined/빈 문자열 = 미설정(폴백 없음, 기존 동작).
   */
  fallbackModel?: string;
  /**
   * §4 (CLI 사양 추종) — 컨텍스트 자동 압축 창(`--autocompact`).
   * `'auto'` = CLI 판단, 그 외에는 토큰 수 문자열(CLI 허용 범위 100k~1M, 예: `'200000'`).
   * undefined = 미설정(플래그 없음 = CLI 기본).
   */
  autoCompact?: string;
  /**
   * §4 (CLI 사양 추종) — `--exclude-dynamic-system-prompt-sections`.
   * cwd·환경·기억 경로·git 상태 같은 **기기마다 다른 절**을 시스템 프롬프트에서 첫 사용자 메시지로
   * 옮겨 프롬프트 캐시 재적중률을 올린다. 기본 false(플래그 없음 = 종전과 바이트 단위로 같음).
   */
  excludeDynamicSystemPromptSections?: boolean;
  /**
   * §4 (CLI 사양 추종) — `--setting-sources`. 어떤 설정 계층을 읽을지 제한한다.
   * 값은 `'user' | 'project' | 'local'` 의 부분집합. undefined/빈 배열 = 미설정(CLI 기본, 전부 로드).
   */
  settingSources?: string[];
  /**
   * §4 (CLI 사양 추종) — `--safe-mode`. CLAUDE.md·스킬·플러그인·훅·MCP·커스텀 에이전트 등
   * **모든 사용자 커스터마이즈를 끈 채** 실행(설정이 깨졌을 때의 진단용). 기본 false.
   * ⚠ 훅이 꺼지므로 이 에이전트의 활동은 버블맵에 실시간으로 안 잡힌다 — 진단 목적으로만 켠다.
   */
  safeMode?: boolean;
  /**
   * §4 (CLI 사양 추종) — `--betas`. API 요청에 실을 베타 헤더 목록.
   * **API 키 사용자 전용** — 구독 인증에서는 CLI 가 경고 한 줄과 함께 무시한다.
   * undefined/빈 배열 = 미설정.
   */
  betas?: string[];
  /**
   * §4 (CLI 사양 추종) — Bash 도구가 `timeout` 을 지정하지 않은 명령에 쓰는 기본 제한(ms).
   * 스폰 env `BASH_DEFAULT_TIMEOUT_MS` 로 전달. undefined = 미설정(CLI 기본 2분).
   * 인자가 아니라 환경변수 축이라 헤드리스·인터랙티브 두 스폰 경로에 동시에 실린다.
   */
  bashDefaultTimeoutMs?: number;
  /**
   * §4 (CLI 사양 추종) — Bash 도구가 허용하는 `timeout` 의 **상한**(ms).
   * 스폰 env `BASH_MAX_TIMEOUT_MS` 로 전달. undefined = 미설정(CLI 기본 10분 = 600,000ms).
   * 긴 빌드·테스트가 10분에서 잘리는 것을 푸는 축이며, `bashDefaultTimeoutMs` 와 직교.
   */
  bashMaxTimeoutMs?: number;
  /**
   * §4 (Fast 모드) — 같은 Opus 를 **출력 속도만 빠르게** 돌리는 모드. 작은 모델로 낮추는 게 아니다.
   *
   * ⚠ **CLI 플래그가 아니다.** 설치본에 `--fast` 계열은 없고, 실체는 대화형 REPL 의 `/fast` 와
   * settings 키 `fastMode` 둘뿐이다. 게다가 우리 헤드리스 스폰은 CLI 가 **Agent SDK 세션으로 분류**해
   * Fast 를 스스로 막는다(`fast_mode_disabled_reason: 'sdk_opt_in_required'`) — 유일한 해제 창구가
   * `--settings` 가 만드는 `flagSettings` 층이라 이 값은 **인자가 아니라 설정 파일**로 나간다
   * (`buildConfigArgs` → `prepareAgentSettings`). `userSettings` 에 같은 키를 넣어도 안 풀린다.
   *
   * Opus 계열(`supportsFastMode`)에서만 의미가 있고 그 밖에서는 CLI 가 사유도 없이 조용히 무시한다.
   * undefined/false = 미설정(종전 동작과 바이트 단위로 같음).
   */
  fastMode?: boolean;
  /**
   * §4 (스트림 3종 ①) — `--forward-subagent-text`. 중첩 서브에이전트(Task)의 말·사고를
   * `parent_tool_use_id` 를 달아 부모 스트림으로 흘려 준다.
   *
   * **기본 켬**(undefined = 켬). 끄려면 명시 `false` — 터미널에서는 보이던 것이 우리 화면에서만
   * 안 보이는 쪽이 결함이므로 기본값을 그렇게 잡았다(`contextWindow` 의 "기본 1M, 명시 opt-out"과 같은 규율).
   * `--print` 전용이라 인터랙티브 CMD 경로에는 붙지 않는다.
   */
  forwardSubagentText?: boolean;
  /**
   * §4 (스트림 3종 ②) — `--replay-user-messages`. 우리가 stdin 으로 보낸 사용자 메시지를
   * `isReplay: true` 로 되돌려 준다. "명령이 실제로 CLI 에 접수됐다"는 **유일한 스트림 신호**다.
   * undefined/false = 미설정(플래그 없음, 종전 동작).
   */
  replayUserMessages?: boolean;
  /**
   * §4 (스트림 3종 ③) — `--prompt-suggestions`. 턴마다 다음 사용자 프롬프트 예측을
   * `prompt_suggestion` 메시지로 보낸다. undefined/false = 미설정.
   * ⚠ 이 계정 probe 에서는 실제 메시지가 관측되지 않았다(서버 측 게이팅 추정) — 수신 쪽은
   * payload 모양을 단정하지 않고 방어적으로 훑는다.
   */
  promptSuggestions?: boolean;
}

/**
 * §4 v2.63 — 커스텀 에이전트 실행(스폰) 모드.
 * 'headless' = 기존 `claude -p` 백그라운드 스폰. 'interactive-terminal' = IDE 임베디드 PTY REPL.
 */
export type ExecutionMode = 'headless' | 'interactive-terminal';

/**
 * §4 (CMD 터미널 업그레이드 ⑧) — CMD(인터랙티브 터미널) 버블이 띄울 CLI 종류.
 * undefined = `'claude'`(종전 동작 그대로). 실제 실행 파일·인자·훅 귀속 여부는
 * `CMD_CLI_KINDS` 테이블이 정한다(§3.3 하드코딩 금지) — 새 CLI 는 그 표에 한 줄 추가로 끝난다.
 */
export type CmdCliKind = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'aider' | 'shell';

/**
 * §4 (CMD 터미널 업그레이드 ①) — 터미널 출력에서 읽어 낸 세션 상태.
 * `SubAgentStatus` 와 **다른 축**이다 — 서버가 이 값을 `SubAgent.blocked` 플래그와
 * `lastActivityAt` 로 번역해 받아들이며, 상태 유니온을 늘리지 않는다(§2.4 '잠듦' 선례).
 */
export type CmdTerminalState = 'working' | 'idle' | 'blocked';

/**
 * §4 (CMD 터미널 업그레이드 ①) — 클라(터미널 뷰)가 서버에 올리는 감지 신호 1건.
 * **판정이 아니라 신호다** — 상태 쓰기와 broadcast 는 서버가 한다(§3.1 서버 = SSOT).
 */
export interface CmdTerminalSignal {
  /** `term:<agentId>:<session>` 또는 pane 포함 `term:<agentId>:<session>#<paneId>`. */
  termId: string;
  /** 감지된 상태. */
  state: CmdTerminalState;
  /** blocked 로 본 근거 한 줄(마지막 화면 꼬리 발췌, 최대 120자). */
  reason?: string;
  /** PTY 전경 프로세스명(②). 표본되지 않았으면 생략. */
  foregroundProcess?: string;
}

/** §4 (CMD 터미널 업그레이드 ⑤) — pane 트리의 잎(터미널 1개). */
export interface CmdPaneLeaf {
  type: 'leaf';
  /** termId 의 `#` 뒤 토큰. 루트 단일 pane 은 `'0'`. */
  id: string;
}

/** §4 (CMD 터미널 업그레이드 ⑤) — pane 트리의 분할 노드(항상 이진 — tmux 와 같은 모양). */
export interface CmdPaneSplit {
  type: 'split';
  /** `'row'` = 좌우 분할(세로 경계선), `'column'` = 상하 분할(가로 경계선). */
  dir: 'row' | 'column';
  /** 첫 자식이 차지하는 비율. 드래그 리사이즈가 갱신하며 `CMD_PANE_RATIO_MIN`~`MAX` 로 clamp. */
  ratio: number;
  /** 항상 2개 — 더 쪼개려면 자식이 다시 split 이 된다. */
  children: [CmdPaneNode, CmdPaneNode];
}

/** §4 (CMD 터미널 업그레이드 ⑤) — pane 분할 트리. */
export type CmdPaneNode = CmdPaneLeaf | CmdPaneSplit;

// ─── Conti Mode (§5.3 #28 v1.47) ───

/** 커스텀 에이전트의 Vibisual Custom Mode 값. undefined=비활성. 'conti' 만 본 라운드에서 동작. */
export type ContiCustomMode = 'conti' | 'review' | 'debug';

/**
 * §5.3 v4.89 — 커스텀 에이전트의 자기 기억 범위(`AgentConfig.memory`).
 * `'off'` 는 "이 에이전트는 아무것도 기억하지 않는다", 나머지 셋은 기억 폴더의 위치를 정한다.
 */
export type AgentMemoryScope = 'off' | 'user' | 'project' | 'local';

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
  /**
   * §5.13 (Q) — 이 콘티가 어디서 왔는가. 없으면 `'agent'`(기존 콘티 전부).
   * 대본에서 만들어진 콘티만 히스토리에서 칩으로 구분된다.
   */
  source?: ContiSource;
  /** §5.13 (Q) — 대본에서 만들어졌을 때 그 대본의 앞부분(`CONTI_SCRIPT_EXCERPT_MAX` 상한). */
  scriptExcerpt?: string;
  /**
   * §5.13 (Q) — 출력 프리셋. 없으면 `DEFAULT_STORYBOARD_PRESET_ID`.
   * 컷의 좌표계(320×180)와는 무관하다 — 이것은 *출력* 판형이다.
   */
  presetId?: StoryboardPresetId;
  /** §5.13 (Q) — 마지막으로 이 콘티를 받아 간 앱의 문서·작업. 없으면 아직 넘긴 적이 없다. */
  render?: ContiRenderLink;
}

/** §5.13 (Q) — 콘티의 출처. `'agent'` = 에이전트가 자기 작업을 돌아본 것, `'script'` = 대본에서 끊은 것. */
export type ContiSource = 'agent' | 'script';

/**
 * §5.13 (Q) — 콘티를 받아 간 내부 앱의 산출물 한 줄.
 *
 * **`appId` 는 코어가 뜻을 모르는 데이터다**(§5.13 (P-4)). 코어 파일에 앱 이름을 박지
 * 않기 위해, 넘긴 앱이 스스로 자기 id 를 돌려주고 우리는 그것을 그대로 적는다.
 */
export interface ContiRenderLink {
  /** 받은 앱의 id. 코어는 해석하지 않고 저장·표시만 한다. */
  appId: string;
  /** 그 앱 안에서 만들어진 문서 id. */
  docId: string;
  /** 렌더 작업 id. 문서만 만들고 렌더를 안 걸었으면 없다. */
  jobId?: string;
  /** 넘길 때 적용한 출력 프리셋. */
  presetId: StoryboardPresetId;
  /** 넘긴 시각 (ms) */
  startedAt: number;
  /** 마지막으로 확인된 작업 상태. 앱이 알려 준 값 그대로. */
  status?: ContiRenderStatus;
  /** 실패 사유 한 줄. */
  error?: string;
}

/** §5.13 (Q) — 렌더 작업 상태. 앱의 job 상태를 그대로 받는다. */
export type ContiRenderStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

/** §5.13 (Q) — 출력 프리셋 id. 표는 `STORYBOARD_PRESETS`(constants) 한 곳에만 있다. */
export type StoryboardPresetId = 'landscape' | 'portrait' | 'webtoon';

/**
 * §5.13 (Q) — 출력 프리셋 한 벌.
 *
 * **컷의 좌표계(`CONTI_DEFAULTS.viewBox*`)는 여기 없다.** 프리셋은 출력 판형이지
 * 스케치 판형이 아니며, 좌표계를 프리셋마다 갈면 이미 그려 둔 콘티가 프리셋을
 * 바꾸는 순간 전부 어긋난다.
 */
export interface StoryboardPreset {
  readonly id: StoryboardPresetId;
  /** 렌더 출력 화면 크기(px). */
  readonly output: { readonly width: number; readonly height: number };
  readonly fps: number;
  /** 컷 하나가 화면에 머무는 시간(초). */
  readonly secondsPerFrame: number;
  /**
   * 판넬을 위에 두고 아래에 행동을 인쇄하는 판형인가(웹툰).
   * `false` 면 판넬이 화면을 채우고 행동은 자막으로 간다.
   */
  readonly stacked: boolean;
  /** i18n 키. 표시 문구를 상수에 적지 않는다. */
  readonly labelKey: string;
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
  /**
   * **턴 세대 도장** — 이 줄을 낳은 명령(`QueuedCommand.id`).
   *
   * 종전에는 이 값이 없어 클라가 이벤트를 **오직 도착 시각**으로 명령 블록에 갈랐다. 그래서
   * 사용자가 [중지]·덧말로 새 명령을 넣으면, 앞 턴이 백단에 띄워 둔 작업이 뒤늦게 뱉는 줄이
   * **새 명령 블록 아래**에 그려져 "뭐가 어떤 작업인지" 알 수 없었다. 이제 각 줄이 자기 턴을 들고
   * 다니므로 늦게 와도 제 블록으로 돌아간다.
   *
   * 백그라운드 작업의 끝 통지(`task_notification`)는 **그 작업을 시작한 턴**의 도장을 물려받는다 —
   * 통지가 도착한 시점의 턴이 아니라 그 일을 시킨 턴이 주인이기 때문이다.
   *
   * 서버 재시작 전 버퍼나 훅 경로 이벤트에는 없을 수 있다(그때는 종전 시각 기준으로 폴백).
   */
  turnId?: string;
  /**
   * §4 (스트림 3종) — 이 줄이 **어느 Task 호출 아래에서 나온 것인지**.
   *
   * `--forward-subagent-text` 를 켜면 중첩 서브에이전트(Task)의 말·사고가 부모 스트림에 섞여 오는데,
   * 원문이 `parent_tool_use_id` 로 소속을 알려 준다. 그 값을 그대로 실어 클라가 해당 `tool_use`
   * 아래에 접어 그린다 — 없으면 부모가 한 말과 구분되지 않아 대화록이 뒤섞인다.
   *
   * `toolUseId` 와 **다른 축**이다: `toolUseId` 는 "이 줄이 가리키는 호출", 이 필드는 "이 줄을 낳은
   * 바깥 호출". 미설정 = 부모 자신이 한 말(종전 그대로).
   */
  nestedUnderToolUseId?: string;
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
  /**
   * §5.3 #10-3 v4.98 — 지금 진행 중인 검증 런의 `runId`.
   * Summary 는 `autoAgentId` 가 키라 새 요청이 이전 기록을 덮으므로, 증거·수용 기준·예산은
   * `AutoAgentRun` 쪽에 두고 여기에는 **포인터 한 줄만** 둔다(기존 필드·화면 불변).
   */
  currentRunId?: string;
}

/**
 * §5.3 #10-3 v4.98 — 검증 증거 한 건.
 *
 * "무엇을 실행했고 그 결과가 무엇이었나"를 담는다. 자연어 서술은 증거가 아니다.
 * `ok` 는 **서버가 `exitCode === 0` 으로 계산**한다 — 에이전트가 스스로 통과를 주장할 수 없다.
 */
export interface VerificationAttempt {
  id: string;
  /** 어떤 종류의 검증인가 */
  kind: VerificationKind;
  /** 실제로 실행한 명령 (예: `pnpm typecheck`) */
  command: string;
  /** 종료 코드 — 0 이 아니면 실패 */
  exitCode: number;
  /** 검증 대상 revision (git rev-parse HEAD 등). 모르면 생략 */
  revision?: string;
  /** 실행 시각(ms) */
  startedAt: number;
  /** 소요 시간(ms). 모르면 생략 */
  durationMs?: number;
  /** 서버가 계산한 통과 여부 (= exitCode === 0) */
  ok: boolean;
  /** 로그 발췌·경로 등 부가 설명 (선택) */
  detail?: string;
}

export type VerificationKind = 'build' | 'typecheck' | 'test' | 'run' | 'custom';

/**
 * §5.3 #10-3 v4.98 — 검수자 판정.
 * `held` = 판정 불명(스키마 위반·증거 없는 approve) → **승인으로 흘리지 않는다**(fail-closed).
 */
export type VerificationVerdict = 'approve' | 'reject' | 'held';

/** §5.3 #10-3 v4.98 — 런이 사람을 부르는 이유 */
export type EscalationReason =
  | 'budget-exhausted'
  | 'verification-failed'
  | 'irreversible-action'
  | 'no-evidence';

/**
 * §5.3 #10-3 v4.98 — 런 상태.
 * `verified` 는 **통과 증거가 1개 이상**일 때만 붙는다(서버 판정).
 */
export type AutoAgentRunStatus = 'running' | 'verified' | 'escalated' | 'abandoned';

/**
 * §5.3 #10-3 v4.98 — 검증 런. 요청 1건 = 런 1개.
 *
 * 완료를 LLM 이 쓴 문장이 아니라 서버가 보관한 증거로 판정하기 위한 단위이며,
 * `AutoAgentSummary`(autoAgentId 키, 새 요청이 덮음)와 달리 `runId` 키라 이력이 남는다.
 */
export interface AutoAgentRun {
  runId: string;
  /** 이 런을 소유한 auto-agent 버블의 sessionId */
  autoAgentId: string;
  /** 사용자가 보낸 원본 요청 */
  userRequest: string;
  /**
   * 수용 기준. **기계로 환원 가능한 것만 판정에 쓴다**(§10 의도 불일치 감지 불변) —
   * 자연어 항목은 표시만 하고 `verified` 판정에 관여하지 않는다.
   */
  acceptanceCriteria: string[];
  /** 작업 시작 시점의 revision (git HEAD). 모르면 생략 */
  baselineRevision?: string;
  /** 검증 증거 목록 (시간순) */
  attempts: VerificationAttempt[];
  /** 마지막 검수 판정 (없으면 아직 판정 전) */
  lastVerdict?: VerificationVerdict;
  /** 판정 사유 한 줄 (선택) */
  lastVerdictReason?: string;
  /** 이 런에서 지금까지 쓴 재작업 횟수 (엣지별 ❌ — 런 전체 합산) */
  reworkUsed: number;
  /** 이 런의 재작업 예산 */
  reworkBudget: number;
  status: AutoAgentRunStatus;
  /** 사람을 부른 이유 (status==='escalated' 일 때만) */
  escalation?: EscalationReason;
  /** 게이트 자가진단으로 만들어진 가짜 런이면 true — 실제 작업 런과 배지로 구분 */
  selfTest?: boolean;
  startedAt: number;
  endedAt?: number;
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

// ─── §4 v3.16 모바일 웹 접속 모드 ────────────────────────────────────────────
// desktop shell 상태 — main 프로세스 mobileAccess 매니저가 SSOT, renderer 는 표시만.
// UpdateState(§4 v2.63) 선례대로 GraphSnapshot/ProjectCheckpoint 미관여, 전용 IPC 로 흐른다.

/**
 * §4 v3.20 UPnP 외부 개방 상태.
 * - `idle`        : 외부 개방 꺼짐(LAN 전용).
 * - `mapping`     : 공유기에 포트 개방 요청 중.
 * - `active`      : 외부 접속 가능(공인 IP + HTTPS 매핑 성공).
 * - `unavailable` : 구조적으로 불가 — CGNAT/사설 IP 라 외부에서 닿을 수 없음(수동으로도 불가, VPN 필요).
 * - `error`       : UPnP 미지원/꺼짐 등 — 수동 포트포워딩으로 우회 가능.
 */
export type MobileExternalStatus = 'idle' | 'mapping' | 'active' | 'unavailable' | 'error';

/** 외부 개방 실패/불가의 원인 — UI 가 원인별 안내 문구를 고른다. */
export type MobileExternalReason = 'cgnat' | 'upnp' | 'no-public-ip' | null;

/** 모바일 웹 접속 리스너의 현재 상태 (`vibisual:mobile:*` IPC 페이로드). */
export interface MobileAccessState {
  /** 리스너 on/off (opt-in — 기본 false, userData 에 영속). */
  enabled: boolean;
  /** 실제 바인드된 LAN 포트 (꺼져 있으면 null). */
  port: number | null;
  /** 폰 브라우저에서 열 접속 URL 후보들 (LAN IPv4 인터페이스별 1개). */
  urls: string[];
  /** 현재 유효한 페어링 코드 (꺼져 있으면 null — 켤 때마다/재생성 시 새로 발급). */
  pairingCode: string | null;
  /** 현재 연결된 모바일 WebSocket 클라이언트 수. */
  clientCount: number;
  /** 페어링 실패 누적으로 잠긴 IP 가 하나라도 있는지 (코드 재생성으로 전체 해제). */
  pairingLocked: boolean;

  // ─── §4 v3.20 UPnP 외부 개방 ──────────────────────────────────────────────
  /** 외부 접속 허용 토글 (opt-in — 기본 false, userData 영속). */
  externalEnabled: boolean;
  /** 외부 개방 진행/결과 상태. */
  externalStatus: MobileExternalStatus;
  /**
   * 집 밖에서 열 외부 접속 URL(https). 공인 IP 를 확보했고 CGNAT 가 아니면 채워진다 —
   * UPnP 자동 개방 성공(active)이든, 자동 실패(error, 수동 포트포워딩 대상)든 접속에 쓸
   * 주소는 동일하므로 두 경우 모두 제공한다(수동 포워딩 사용자가 이 주소로 접속).
   */
  externalUrl: string | null;
  /** 실패/불가 원인 — 상태가 unavailable/error 일 때 UI 안내 분기용. */
  externalReason: MobileExternalReason;
  /** 공유기가 보고한 공인 IP (진단·수동 포트포워딩 안내에 표시). */
  publicIp: string | null;
  /** 외부에 열린 공인 포트 (수동 포트포워딩 안내에 표시). */
  externalPort: number | null;
  /** 수동 포트포워딩 시 공유기에서 이 LAN IP:포트(HTTPS)로 연결하도록 안내. */
  httpsPort: number | null;

  // ─── §4 v3.66 QR 페어링 ───────────────────────────────────────────────────
  /**
   * 현재 살아 있는 QR 페어링 티켓(없거나 만료됐으면 null).
   * 발급 즉시 3분(`MOBILE_QR_TICKET_TTL_MS`) 동안만 유효하며 메모리에만 존재한다.
   */
  qrTicket: MobileQrTicket | null;
}

/**
 * §4 v3.66 — QR 페어링 티켓. 폰 카메라로 스캔하면 코드 입력 없이 세션 쿠키를 받는
 * 시한부 딥링크 묶음. 토큰 자체는 URL 안에만 실려 나가고 별도 필드로는 노출하지 않는다.
 */
export interface MobileQrTicket {
  /** 이 티켓으로 접속되는 딥링크 URL 들(LAN 인터페이스별 + 외부 https). QR 로 그릴 원문. */
  urls: string[];
  /** 만료 시각(epoch ms) — 남은 시간 카운트다운에 사용. */
  expiresAt: number;
  /** 이 티켓으로 페어링을 마친 기기 수(표시용). */
  usedCount: number;
}

// ─── §4 v3.33 모바일 임베디드 터미널 — /ws 다중화 프레임 ───────────────────────
//
// §4 v2.63 임베디드 인터랙티브 터미널의 I/O 는 데스크톱에선 전용 IPC(`vibisual:term:*`)로
// 흐르지만, 모바일 웹 접속(§4 v3.16, `window.api` 부재)에선 그 IPC 가 없으므로 **기존 모바일
// `/ws` 브리지에 터미널 프레임을 다중화**해 나른다(새 소켓/레이어 발명 ❌). 클라 →(제어) /
// 서버 →(출력) 두 방향의 프레임 payload 계약. WSMessageType 유니온에는 넣지 않고 양끝
// (`mobileAccess.ts`·`useWebSocket`)에서 `type` prefix `term_` 로 out-of-band 분기한다.
//
// 보안(§4 v3.33): 셸 프레임은 **LAN 접속에서만** 처리하고, 외부(공인 IP·UPnP) 접속의
// `term_create` 는 거부 → `term_unavailable(reason:'external')` 회신한다.

/** 클라 → 서버: 셸+claude prefill PTY 생성/재부착 요청. */
export interface TermCreateFrame {
  termId: string;
  cwd: string;
  config: AgentConfig;
  cols?: number;
  rows?: number;
  /** §5.5 #17-20 ④ v4.74 — 있으면 claude prefill 대신 이 명령을 띄운다(실행 런처). */
  command?: string;
  /** command 를 사용자 Enter 없이 바로 실행할지. 실행 런처는 true, claude 경로는 언제나 false. */
  autoRun?: boolean;
}
/** 클라 → 서버: xterm 키 입력 → PTY stdin. */
export interface TermWriteFrame {
  termId: string;
  data: string;
}
/** 클라 → 서버: xterm 리사이즈 → PTY. */
export interface TermResizeFrame {
  termId: string;
  cols: number;
  rows: number;
}
/** 클라 → 서버: PTY 종료(탭 명시 닫기). */
export interface TermKillFrame {
  termId: string;
}
/** 서버 → 클라: PTY 출력 바이트. */
export interface TermDataFrame {
  termId: string;
  data: string;
}
/** 서버 → 클라: PTY 종료 통지. */
export interface TermExitFrame {
  termId: string;
  exitCode: number;
}
/** 서버 → 클라: `term_create` 결과(재부착 포함). */
export interface TermAckFrame {
  termId: string;
  ok: boolean;
  error?: string;
}
/** 서버 → 클라: 셸을 열 수 없는 접속(외부/인터넷). reason='external' = LAN 아닌 원격. */
export interface TermUnavailableFrame {
  termId: string;
  reason: 'external';
}

// ─── §5.5 #17-20 v4.74 디버그·실행 런처 ────────────────────────────────────

/**
 * 실행 구성이 어디서 왔는지. 화면에 그대로 출처 배지로 뜬다 — 사용자가 "이건 내 launch.json
 * 이고 저건 우리가 추측한 것" 을 구분해서 누르게 하기 위함(§5.14 "추측을 확신처럼 굴지 않는다").
 */
export type RunConfigSource = 'launch.json' | 'tasks.json' | 'package.json' | 'vibisual' | 'unreal' | 'detected';

/** 디버그 인자 변환표(`DEBUG_LAUNCH_RECIPES`)를 고르는 키. 못 알아보면 'other'. */
export type RunRuntime = 'node' | 'python' | 'go' | 'rust' | 'dotnet' | 'java' | 'unreal' | 'other';

/** 이 구성이 무엇을 하는 것인지 — 목록 그룹 머리로 쓰인다. */
export type RunConfigKind = 'run' | 'build' | 'test' | 'attach';

/**
 * §5.5 #17-20 ② — 실행 구성 하나. 새 설정 포맷을 발명하지 않고 사용자가 이미 가진 파일에서 읽는다.
 * 디스크가 SSOT 라 영속(체크포인트) 대상이 아니며, 매번 스캔해서 만든다.
 */
export interface RunConfig {
  /** 안정 id — `<source>:<name>` 기반이라 다시 스캔해도 같은 구성은 같은 id. */
  id: string;
  /** 목록에 보이는 이름(launch.json 의 `name`, script 이름 등). */
  name: string;
  /** 셸 한 줄 그대로. PTY 에 이 문자열이 실행된다(화면에도 이 원문이 그대로 보인다). */
  command: string;
  /** 없으면 `buildDebugCommand` 가 runtime 별 변환표로 만든다. 있으면 이것이 우선. */
  debugCommand?: string;
  /** 실행 디렉터리(미지정 = 프로젝트 루트). */
  cwd?: string;
  /** 추가 환경변수. */
  env?: Record<string, string>;
  source: RunConfigSource;
  kind: RunConfigKind;
  runtime: RunRuntime;
  /** 어디서 이 구성을 얻었는지 한 줄 근거(`.vscode/launch.json › Launch Server`). */
  reason: string;
  /** 알아낸 서비스 포트(있으면 프리뷰 열기에 쓴다). */
  port?: number;
  /** 디버거가 붙을 포트 — 디버그 모드로 켤 때 채워진다. */
  debugPort?: number;
  /** launch.json `request: 'attach'` 처럼 우리가 프로세스를 띄우지 않는 구성. */
  attachOnly?: boolean;
}

/** `GET /api/run-configs` 응답. */
export interface RunConfigScanResult {
  projectPath: string;
  configs: RunConfig[];
  /** 스캔하면서 읽은 파일들(없으면 빈 배열) — 화면에 "어디를 봤는지" 로 뜬다. */
  scanned: string[];
}

/** MCP 프리셋 분류 — 목록 그룹 머리. */
export type McpPresetCategory = 'debug' | 'browser' | 'engine' | 'native';

/**
 * §5.5 #17-20 ⑥ — "디버거 본체는 전부 가져다 쓴다" 의 목록. 우리가 구현하는 것이 아니라
 * **남이 만든 MCP 서버를 에이전트에 꽂아 주는 것**이라 여기 있는 것은 실행법(command/args)뿐이다.
 */
export interface McpServerPreset {
  /** MCP 서버 이름 = 도구 접두사(`mcp__<id>__<tool>`). 파일 키로도 그대로 쓴다. */
  id: string;
  /** i18n 키(`ide.debug.mcp.<id>.label`). 브랜드명은 번역 대상이 아니라 `name` 으로 따로 둔다. */
  labelKey: string;
  /** 패키지·제품 이름(번역 ❌). */
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  category: McpPresetCategory;
  /** 공식 문서 — 화면의 [문서] 링크. */
  docsUrl: string;
  /** 사전 조건 안내 i18n 키(예: 크롬을 원격 디버깅 포트로 띄워야 함). 없으면 조건 없음. */
  requiresKey?: string;
}

// ─── §5.5 #17-31 — 이 프로젝트에서 쓸 수 있는 MCP 인벤토리 ───────────────────────────
//
// #17-20 ⑥ 은 **우리가 아는 프리셋 4종**을 에이전트에 꽂는 축이고, 여기는 그보다 넓다 —
// 사용자가 `claude mcp add` 로 직접 붙인 것까지 포함해 "지금 이 프로젝트에서 무엇을 쓸 수
// 있는가" 를 Claude Code 의 실제 설정에서 읽어 세운다. 우리 나름의 켜짐 개념을 새로 만들지
// 않는다(화면과 실제가 갈리지 않도록).

/** MCP 가 어디에 적혀 있는가. 화면의 묶음 머리이자 토글이 어느 키를 만질지 가르는 축. */
export type McpServerScope =
  /** `~/.claude.json` 최상위 `mcpServers` — 모든 프로젝트에서 보인다. */
  | 'global'
  /** `~/.claude.json` 의 `projects[<경로>].mcpServers` — 이 프로젝트에서만. */
  | 'local'
  /** `<루트>/.mcp.json` — 레포에 커밋되는 공유 자산(읽기 전용). */
  | 'project'
  /** `MCP_SERVER_PRESETS` — 우리가 꽂아 주는 것(#17-20 ⑥, 축이 에이전트 단위). */
  | 'preset';

/**
 * 켜짐 / 꺼짐 / **승인 대기** — 셋은 서로 다른 상태다.
 * `pending` 은 `.mcp.json` 에 적혀 있으나 아직 승인하지 않은 것(`claude mcp list` 의 `⏸`)이고,
 * 사용자가 해야 할 일이 `disabled` 와 다르므로 한 색으로 뭉개지 않는다.
 */
export type McpServerState = 'enabled' | 'disabled' | 'pending';

/** 붙는 방식. `stdio` 는 프로세스, 나머지는 원격 주소(로그인이 필요할 수 있다). */
export type McpServerTransport = 'stdio' | 'http' | 'sse';

/** 켜기까지 남은 일의 종류 — 화면은 이 종류로 문구를 고르고 `detail` 을 끼워 넣는다. */
export type McpRequirementKind =
  /** `.mcp.json` 서버가 승인 대기 — [켜기] 한 번이 곧 승인이다. */
  | 'approval'
  /** stdio 실행 파일이 PATH 에 없다(Windows 는 `PATHEXT` 까지 본다). */
  | 'missing-command'
  /** `env` 값이 비었거나 `${VAR}` 가 풀리지 않았다. */
  | 'missing-env'
  /** 원격 서버 — `claude mcp login <이름>` 이 필요할 수 있다. */
  | 'auth'
  /** 관리자 정책(`deniedMcpServers`)이 막았다 — 여기서 풀 수 없다(남의 정책 파일을 고쳐 뚫지 않는다). */
  | 'policy';

export interface McpRequirement {
  kind: McpRequirementKind;
  /**
   * 문구에 끼워 넣을 값(명령 이름 · 환경변수 **이름** 목록 · 서버 이름).
   * 값 자체는 비밀이므로 서버가 클라이언트로 내보내지 않는다.
   */
  detail?: string;
}

/** 목록의 한 줄. */
export interface McpServerEntry {
  /** 목록 키 = `<scope>:<name>` — 범위가 다르면 같은 이름이 함께 설 수 있다. */
  id: string;
  /** 설정에 적힌 서버 이름(번역 ❌ — 도구 접두사 `mcp__<name>__` 가 여기서 나온다). */
  name: string;
  scope: McpServerScope;
  transport: McpServerTransport;
  state: McpServerState;
  /** stdio 실행 명령(원문 그대로). */
  command?: string;
  args?: string[];
  /** 원격 서버 주소. */
  url?: string;
  /** `env` 의 **키 이름만**. */
  envKeys?: string[];
  /** 이 설정이 적힌 파일의 절대 경로 — 화면이 "어디서 왔는지" 를 적는다. */
  sourceFile: string;
  /** 켜기까지 남은 일. 비어 있으면 지금 그대로 쓸 수 있다. */
  requirements: McpRequirement[];
  /** 프리셋일 때만(#17-20 ⑥) — 토글이 `AgentConfig.mcpServers` 를 타게 하는 표식. */
  presetId?: string;
  docsUrl?: string;
  /** 프리셋 사전 조건 안내 i18n 키. */
  requiresKey?: string;
  /** false 면 화면은 토글 대신 이유를 적는다. */
  toggleable: boolean;
}

/** `GET /api/mcp-servers` 의 응답. 매 조회마다 디스크를 다시 읽어 만든다(캐시 ❌). */
export interface McpInventory {
  projectPath: string;
  servers: McpServerEntry[];
  /** 들여다본 파일들(없는 파일 포함) — 화면의 "어디를 봤는지". */
  scanned: string[];
  /**
   * `enableAllProjectMcpServers` — 참이면 `.mcp.json` 서버가 전부 자동 승인이다.
   * 이 사실을 화면이 말해 주지 않으면 "승인 대기가 왜 하나도 없지" 가 된다.
   */
  autoApproveProject: boolean;
  scannedAt: number;
}

// ─── §5.5 #17-32 — 이 세션에 적용되는 Claude Code 훅 인벤토리 ─────────────────────
//
// #17-31 이 "이 프로젝트에 MCP 가 무엇이 붙어 있나" 를 답했다면, 여기는 같은 물음을 **훅**에
// 대해 답한다 — 지금 이 세션이 도는 동안 **실제로 실행되는 명령**이 무엇이고, 그게 어디에
// 적혀 있으며, 방금 무엇이 발동했는가. 훅은 사용자 컴퓨터에서 조용히 명령을 실행하는데
// 앱 안에서는 그 존재조차 보이지 않았다(설정 파일을 직접 열어야만 알 수 있었다).
//
// 축은 **세션별**이다(통합 목록 ❌ — 사용자 명시). 훅은 세션이 열린 프로젝트 경로로 갈리므로
// 그 세션의 프로젝트에서 읽은 것만 세우고, 발동 표시도 그 세션이 낸 것만 센다.

/** 훅이 어느 설정 파일에 적혀 있는가. 화면의 묶음 머리이자 "이 프로젝트만인지" 를 가르는 축. */
export type HookScope =
  /** `~/.claude/settings.json` — 모든 프로젝트에서 도는 글로벌 훅. */
  | 'user'
  /** `<루트>/.claude/settings.json` — 레포에 커밋되는 이 프로젝트 전용 훅. */
  | 'project'
  /** `<루트>/.claude/settings.local.json` — 커밋되지 않는 내 컴퓨터 전용 훅. */
  | 'local'
  /** 관리자 정책(managed-settings.json) — 읽기만 한다(우리가 풀지 않는다). */
  | 'managed';

/**
 * 그 훅 줄을 우리가 켜고 끌 수 있는가, 없다면 왜인가.
 *  - `vibisual` — Vibisual 자신이 깐 블록(`_vibisualManaged`). 이걸 끄면 이 앱이 눈을 감는다.
 *  - `managed`  — 관리자 정책 파일. 남의 정책을 고쳐 뚫지 않는다(#17-31 ③ 과 같은 규율).
 */
export type HookLockReason = 'vibisual' | 'managed';

/** 목록의 한 줄 = **명령 하나**(한 matcher 블록에 명령이 여럿이면 줄도 여럿이다). */
export interface HookEntry {
  /**
   * 목록 키 = `<scope>:<event>:<matcher>:<명령 해시>`.
   * 배열 인덱스를 쓰지 않는다 — 파일이 바뀌면 인덱스는 다른 훅을 가리키지만 이 키는 안 그렇다.
   */
  id: string;
  /** 어느 이벤트에 걸려 있는가(`PreToolUse` · `Stop` · `UserPromptSubmit` …). 원문 그대로. */
  event: string;
  /**
   * 도구 이름 대조 문자열. 비었거나 `*` 면 그 이벤트의 **모든** 호출에 걸린다.
   * 도구가 없는 이벤트(`Stop`·`SessionStart` 등)에서는 의미가 없다.
   */
  matcher: string;
  /** 실제로 실행되는 명령 원문. 이 한 줄이 이 화면의 존재 이유다(무엇이 도는지 보여 준다). */
  command: string;
  /** 초 단위 타임아웃(설정에 적혀 있을 때만). */
  timeout?: number;
  scope: HookScope;
  /** 이 훅이 적힌 파일의 절대 경로 — "어디서 왔는지". */
  sourceFile: string;
  /** 지금 켜져 있는가. 꺼진 줄은 파일에 남아 있되 실행되지 않는다(④). */
  enabled: boolean;
  /** false 면 화면은 토글 대신 이유(`lockReason`)를 적는다. */
  toggleable: boolean;
  lockReason?: HookLockReason;
}

/** `GET /api/hooks` 의 응답. 매 조회마다 디스크를 다시 읽어 만든다(캐시 ❌ — 새로고침이 곧 재조회). */
export interface HookInventory {
  projectPath: string;
  hooks: HookEntry[];
  /** 실제로 들여다본 파일들(없는 파일은 담지 않는다). */
  scanned: string[];
  scannedAt: number;
}

/**
 * §5.5 #17-32 ⑤ — **훅이 방금 발동했다**는 신호(서버→클라, 표시 전용).
 *
 * 계측을 새로 만들지 않는다: Vibisual 자신의 훅이 같은 이벤트에 함께 걸려 있으므로, 우리 훅이
 * 울렸다는 것은 **그 이벤트에 걸린 다른 훅들도 같은 순간에 돌았다**는 뜻이다. 그래서 이벤트
 * 이름과 도구 이름만 흘려보내고, 어느 줄이 켜질지는 화면이 `hookMatcherMatches` 로 고른다.
 *
 * 세션 수명의 순간 신호라 `graph_snapshot` 에 싣지 않고 이 메시지로만 흐른다(`debug_event` 와
 * 같은 규약) — 체크포인트·영속화 미관여. 짧은 창으로 모아 배열 한 건으로 보낸다(훅은 도구를
 * 쓸 때마다 울리므로 건건이 밀면 그게 곧 §9 v3.45 가 고친 그 폭주다).
 */
export interface HookFiredPayload {
  /** 그 훅을 낸 세션의 에이전트(버블) id. 화면은 자기 것만 골라 쓴다. */
  agentId?: string;
  /** 세션 탭(sub) id — 알 수 있을 때만. 없으면 화면은 에이전트 단위로만 대조한다. */
  subAgentId?: string;
  /** 발동한 이벤트 이름(`PreToolUse` …). */
  event: string;
  /** 그 순간의 도구 이름(도구 이벤트일 때만) — matcher 대조에 쓴다. */
  toolName?: string;
  at: number;
}

// ─── §5.5 #17-33 — Claude Code 플러그인 인벤토리 + 마켓플레이스 ────────────────────
//
// **우리 관측 플러그인(`packages/plugins`, §5.11)과는 다른 물건이다.** 그쪽은 Vibisual 이 만든
// 것이고 이쪽은 Claude Code 자신의 플러그인 체계(`claude plugin`)다 — 명령·에이전트·스킬·훅·MCP 를
// 한 묶음으로 배포하는 그 단위. 앱 안에는 그것을 볼 자리가 없어, 무엇이 깔려 있고 무엇이 켜져
// 있는지 알려면 터미널로 나가야 했다.
//
// 진실의 출처는 **Claude Code 자신의 답**이다(`claude plugin list --json --available`) — #17-31·#17-32 가
// 세운 "새 설정 포맷을 발명하지 않는다" 규율의 세 번째 적용. 우리가 `installed_plugins.json` 을
// 직접 해석하기 시작하면 CLI 가 포맷을 바꾸는 날 조용히 어긋난다.

/** 플러그인이 어느 범위에 깔렸는가. CLI 의 `--scope` 와 같은 축(그대로 되돌려 준다). */
export type ClaudePluginScope = 'user' | 'project' | 'local';

/**
 * **이 세션에 적용되는가** — 화면의 묶음 머리. 사용자가 물은 "글로벌 / 우리 프로젝트 전용" 이 이 축이다.
 *  - `global`        — `user` 범위. 모든 프로젝트에서 돈다.
 *  - `this-project`  — `project`/`local` 범위이고 그 경로가 지금 이 프로젝트다.
 *  - `other-project` — 깔려 있지만 **다른 프로젝트**에 매여 있어 이 세션에는 오지 않는다.
 *    숨기지 않고 따로 세운다 — 안 보이면 "깔았는데 왜 없지" 가 되고, 섞어 놓으면 "왜 안 먹지" 가 된다.
 */
export type ClaudePluginPlacement = 'global' | 'this-project' | 'other-project';

/** 설치된 플러그인 한 줄 — `claude plugin list --json` 의 항목 그대로 + 우리가 판정한 자리. */
export interface ClaudePluginEntry {
  /** `<이름>@<마켓플레이스>` — CLI 가 쓰는 그 식별자(enable/disable/uninstall 인자로 그대로 들어간다). */
  id: string;
  /** `id` 에서 갈라낸 표시용 이름. */
  name: string;
  /** 어느 마켓플레이스에서 왔는가. */
  marketplace: string;
  version: string;
  scope: ClaudePluginScope;
  /** 우리가 판정한 자리(위 세 갈래). */
  placement: ClaudePluginPlacement;
  /** 켜져 있는가 — `settings.json` 의 `enabledPlugins` 가 진실이고 CLI 가 이미 풀어서 준다. */
  enabled: boolean;
  installPath?: string;
  /** `project`/`local` 범위일 때 매여 있는 프로젝트 경로. */
  projectPath?: string;
  installedAt?: string;
  lastUpdated?: string;
}

/** 마켓에 있으나 아직 안 깔린(또는 깔린) 플러그인 한 줄. */
export interface ClaudeMarketPlugin {
  /** `<이름>@<마켓플레이스>` — 설치 인자로 그대로 쓴다. */
  id: string;
  name: string;
  description?: string;
  marketplace: string;
  version?: string;
  /** 마켓이 밝힌 설치 수 — 무엇을 고를지의 유일한 단서라 그대로 보여 준다. */
  installCount?: number;
  /** 이미 깔려 있으면 true — 마켓 목록에서 [설치] 대신 그렇게 적는다. */
  installed: boolean;
}

/** 알고 있는 마켓플레이스 한 줄. */
export interface ClaudeMarketplaceEntry {
  name: string;
  /** `owner/repo` · URL · 로컬 경로 — 원문 그대로. */
  source?: string;
  /** 이 마켓이 내놓는 플러그인 수(집계). */
  pluginCount: number;
}

/** `GET /api/claude-plugins` 의 응답. 매 조회마다 CLI 에 다시 묻는다(캐시 ❌). */
export interface ClaudePluginInventory {
  projectPath: string;
  installed: ClaudePluginEntry[];
  market: ClaudeMarketPlugin[];
  marketplaces: ClaudeMarketplaceEntry[];
  /**
   * CLI 에 묻지 못했으면(미설치·타임아웃) 그 사유. 화면은 빈 목록 대신 이 말을 띄운다 —
   * "플러그인이 없다" 와 "물어보지 못했다" 는 다른 상태다.
   */
  unavailable?: string;
  scannedAt: number;
}

/** C층 — 우리가 라이선스상 못 하는 디버깅을 넘길 외부 도구. */
export type ExternalDebuggerId = 'visual-studio' | 'rider' | 'vscode' | 'unreal-editor';

/** `GET /api/external-debuggers` 의 항목. `available=false` 면 버튼 대신 "설치되어 있지 않음". */
export interface ExternalDebuggerInfo {
  id: ExternalDebuggerId;
  /** 제품 이름(번역 ❌ — 실제 설치본에서 읽은 이름). */
  name: string;
  available: boolean;
  /** 실행 파일 절대경로(available 일 때만). */
  execPath?: string;
  /** 열 대상(.sln / .uproject / 프로젝트 폴더). 없으면 프로젝트 루트를 연다. */
  target?: string;
  /** 왜 이 도구가 이 프로젝트에 맞는지 한 줄(`MyGame.uproject`). */
  reason?: string;
}

// ─── §5.5 #17-20 ⑩⑪⑫ v4.94 공통 디버그 층 ──────────────────────────────────
//
// 여기 있는 타입들의 규율은 하나다 — **화면은 어느 백엔드로 붙었는지 몰라야 한다.**
// CDP(Node 내장 인스펙터)로 붙든 DAP(남의 어댑터)로 붙든 위로 올라오는 모양이 같아야
// 런타임이 늘어날 때 UI 를 다시 짜지 않는다(언리얼 전용 분기 ❌ — 표의 한 줄일 뿐).

/**
 * 붙는 방법의 종류.
 * - `cdp`       : 런타임 자체가 인스펙터를 갖고 있다(Node 계열) — **설치가 필요 없다**.
 * - `dap`       : 남이 만든 디버그 어댑터를 띄워 Debug Adapter Protocol 로 말한다.
 * - `delegated` : 우리가 실을 수 없는 디버그 엔진(언리얼 C++ `cppvsdbg`) — ⑦ 로 넘긴다.
 */
export type DebugBackendKind = 'cdp' | 'dap' | 'delegated';

/** DAP 어댑터와 말하는 통로. stdio = 자식 프로세스의 표준입출력, tcp = 어댑터가 연 포트. */
export type DebugAdapterTransport = 'stdio' | 'tcp';

/** 디버기(debuggee)에 닿는 방식. 네이티브는 포트가 아니라 pid 로 붙는다. */
export type DebugAttachKind = 'port' | 'pid' | 'none';

/**
 * §5.5 #17-20 ⑩ — 런타임 → 디버거 연결법 표의 한 줄.
 *
 * `DEBUG_LAUNCH_RECIPES`(③ 인자 얹기)와 짝을 이룬다: 그쪽이 "붙을 수 있게 띄우는" 법이라면
 * 이쪽은 "실제로 붙는" 법이다. **새 언어 지원 = 이 표에 한 줄**(§3.3 설정과 로직 분리).
 */
export interface DebugAdapterSpec {
  runtime: RunRuntime;
  backend: DebugBackendKind;
  /** `backend==='dap'` 일 때 어댑터 실행법. 없으면 사용자가 직접 갖춰야 한다. */
  adapter?: {
    command: string;
    args: string[];
    transport: DebugAdapterTransport;
  };
  attach: DebugAttachKind;
  /**
   * 표시용 라이선스. **상업적 사용이 가능한 것만 이 표에 올린다** — Microsoft `vsdbg`·
   * `cppvsdbg` 처럼 자사 IDE 전용으로 묶인 엔진은 여기 들어오지 못하고 `delegated` 가 된다.
   */
  licence: string;
  /** 사전 조건·설치 안내 i18n 키(`ide.debug.adapter.<runtime>`). */
  installKey: string;
  docsUrl: string;
}

/** 디버그 세션의 생애. `paused` 일 때만 콜스택·변수를 물을 수 있다. */
export type DebugSessionStatus = 'connecting' | 'running' | 'paused' | 'ended' | 'error';

/** 왜 멈췄는지 — 화면이 "중단점에서 멈춤"/"예외" 를 구분해 적는다. */
export type DebugStoppedReason = 'breakpoint' | 'step' | 'exception' | 'pause' | 'entry' | 'other';

/**
 * 중단점 한 개. **세션이 없어도 존재한다** — 미리 찍어 두면 세션이 열리는 순간 밀어 넣는다.
 * 경로는 프로젝트 루트 기준 상대 경로를 `/` 구분자로 정규화해 둔다(OS 가 달라도 같은 키).
 */
export interface DebugBreakpoint {
  file: string;
  /** 1-based 줄 번호(에디터 줄 번호와 같은 축). */
  line: number;
  enabled: boolean;
  /** 어댑터가 실제로 이 자리에 걸었는지. false 면 화면이 빈 원으로 그린다. */
  verified?: boolean;
}

/** 콜스택 한 칸. `file` 이 없으면 소스가 없는 프레임(내장 함수 등). */
export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line: number;
  column?: number;
}

/** 변수 한 개. `variablesReference > 0` 이면 펼칠 수 있다(자식 조회 핸들). */
export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

/** 변수 묶음(Local·Closure·Global 등). */
export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
}

/** 살아 있는 디버그 세션 하나 — 서버가 소유하고 클라는 이 모양 그대로 그린다. */
export interface DebugSessionState {
  sessionId: string;
  /** 어느 실행에 붙었는지(`run:<agentId>:<configId>`). 실행 카드와 이어 붙이는 열쇠. */
  runId: string;
  /** 프로젝트 루트 — 상대 경로 중단점을 절대 경로로 펴는 기준. */
  projectPath: string;
  runtime: RunRuntime;
  backend: DebugBackendKind;
  status: DebugSessionStatus;
  /** 붙은 포트(`attach==='port'` 일 때). */
  port?: number;
  stoppedReason?: DebugStoppedReason;
  /** 멈춘 스레드(DAP). CDP 는 단일 스레드라 1 고정. */
  threadId?: number;
  /** `paused` 일 때의 콜스택(위가 현재 프레임). */
  frames?: DebugStackFrame[];
  /** 실패 사유 — 화면이 그대로 적는다(추측 문구로 덮지 않는다). */
  error?: string;
  startedAt: number;
}

/** 서버 → 클라 `debug_event` payload. 상태는 통째로 보내고 출력만 조각으로 흐른다. */
export interface DebugEventPayload {
  sessionId: string;
  kind: 'state' | 'output' | 'terminated';
  state?: DebugSessionState;
  /** `kind==='output'` 일 때 어댑터/디버기가 낸 출력 한 덩어리. */
  output?: string;
  category?: 'stdout' | 'stderr' | 'console';
}

/** ⑪ 출력 한 줄의 심각도. */
export type ProblemSeverity = 'error' | 'warning' | 'info';

/**
 * §5.5 #17-20 ⑪ — 출력 한 줄에서 뽑아낸 문제 하나.
 * 어느 표에도 안 걸리면 `null` 이고, 그 줄은 평문 그대로 남는다(아는 척 ❌).
 */
export interface ProblemMatch {
  severity: ProblemSeverity;
  /** 원문 그대로의 경로(상대일 수 있다 — 여는 쪽이 프로젝트 루트로 편다). */
  file?: string;
  line?: number;
  column?: number;
  message: string;
  /** 어느 매처가 잡았는지(테스트·진단용 — 화면에는 안 뜬다). */
  matcher: string;
}

// ─── §3.2.4 런타임 메모리 자정작용 — 진단 ───

/**
 * 힙 표본 한 장. `process.memoryUsage()` + `v8.getHeapStatistics()` 에서 뽑는다.
 *
 * 서버에 이 계측이 **한 곳도 없어서** 3GB 진단을 프로세스 I/O 카운터와 소거법으로 해야 했다.
 * 다음에는 그러지 않도록 표본을 남긴다.
 */
export interface MemorySample {
  /** 표본 시각(epoch ms). */
  at: number;
  /** 프로세스 전체 상주 크기(바이트) — OS 가 보는 값. */
  rss: number;
  /** V8 힙에서 실제로 쓰고 있는 바이트. */
  heapUsed: number;
  /** V8 이 OS 로부터 확보해 둔 힙 바이트(줄어들지 않는 쪽 — 3GB 의 정체). */
  heapTotal: number;
  /** C++ 바인딩이 잡은 바이트. */
  external: number;
  /** `Buffer` 등 ArrayBuffer 계열 바이트. */
  arrayBuffers: number;
  /** 이 프로세스의 힙 상한(`heap_size_limit`). */
  heapLimit: number;
  /** `heapUsed / heapLimit` (0~1). 압력 판정의 유일한 기준. */
  ratio: number;
}

/** 힙 압력 단계 — 임계는 `MEMORY_PRESSURE_*_RATIO`. */
export type MemoryPressureLevel = 'normal' | 'high' | 'critical';

/** 진단 화면이 읽는 캐시 한 개의 상태. */
export interface MemoryCacheStat {
  name: string;
  entries: number;
  bytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

/** `GET /api/diagnostics/memory` 응답. */
export interface MemoryDiagnosticsReport {
  /** 가장 최근 표본. 아직 한 장도 없으면 null. */
  current: MemorySample | null;
  /** 오래된 것부터. 최대 `MEMORY_SAMPLE_HISTORY` 장. */
  history: MemorySample[];
  level: MemoryPressureLevel;
  caches: MemoryCacheStat[];
  /** 압력 대응으로 캐시를 비운 횟수. */
  reliefCount: number;
  /** 마지막 압력 대응 시각(없으면 null). */
  lastReliefAt: number | null;
  /** 압력 대응으로 지금까지 회수한 캐시 바이트 총합(추정). */
  reliefFreedBytes: number;
  /** 프로세스가 뜬 뒤 지난 시간(ms) — 표본을 읽을 때의 맥락. */
  uptimeMs: number;
}

// ─── §7.11 프리뷰 조작 (판올림 번호 발급 대기) — 디바이스 폭 프리셋 + 요소 클릭 ───

/**
 * 프리뷰에서 집은 화면 요소 한 개.
 *
 * 프록시가 주입한 picker 가 `postMessage` 로 올리고, 클라가 받아 명령으로 조립한다.
 * **DOM 을 읽기만 한 결과**이며 네트워크·저장소 정보는 담지 않는다(§7.11 (F) 경계).
 */
export interface PreviewPickPayload {
  /** 문서 안에서 그 요소를 다시 찾을 수 있는 CSS 선택자. */
  selector: string;
  /** 태그 이름(소문자). */
  tagName: string;
  /** id 속성(없으면 생략). */
  id?: string;
  /** class 목록(없으면 빈 배열). */
  classes: string[];
  /** `data-testid` — 있으면 코드에서 찾기 가장 쉬운 실마리라 따로 싣는다. */
  testId?: string;
  /** 화면에 보이는 글 일부(최대 `PREVIEW_PICK_TEXT_MAX`자). */
  textSnippet: string;
  /** 그 요소의 화면 위치·크기(px). */
  rect: { x: number; y: number; width: number; height: number };
  /** 그 요소가 있던 페이지 주소(프록시 경로가 아니라 원본 주소). */
  pageUrl: string;
}

/** 프리뷰 폭 프리셋 한 칸. `width: null` = Auto(가득 채움). */
export interface PreviewDevicePreset {
  id: 'auto' | 'mobile' | 'tablet' | 'desktop' | 'compare';
  /** i18n 키 — 라벨을 코드에 박지 않는다(§3.3). */
  labelKey: string;
  width: number | null;
}

/**
 * §5.17 (B) — 프리뷰에서 그은 사각형 한 개. `getBoundingClientRect()` 와 같은 **CSS px**,
 * 원점은 그 창의 문서 좌상단이다(Electron `capturePage(rect)` 가 받는 좌표계와 같다).
 */
export interface PreviewSnipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** §5.17 (B) — 우리 창의 그 사각형을 찍은 결과. 실패해도 던지지 않고 사유를 담아 돌려준다. */
export interface PageRegionCapture {
  ok: boolean;
  /** `data:image/png;base64,…` — `ok` 일 때만. */
  dataUrl?: string;
  /** 실패 사유 한 줄(화면에 그대로 보여 준다). */
  error?: string;
}

// ─── §5.19 All Model — 내 PC 에서 도는 로컬 LLM ───
//
// 이 블록의 어떤 타입도 claude 경로를 건드리지 않는다. `AgentConfig.provider` 가 undefined 면
// 지금까지의 흐름 그대로이고, 아래 상태들은 그 축을 켠 버블에서만 쓰인다.

/** §5.19 — 프로바이더 종류. 원격 API 키 경로는 경계 밖((I))이라 지금은 로컬 하나다. */
export type AgentProviderKind = 'local-llama';

/**
 * §5.19 (C) — 로컬 LLM 프로바이더 설정. `AgentConfig` 안에 살므로 **체크포인트 영속이 공짜**다
 * (agentConfigs 가 이미 저장·복원되는 길을 탄다 — 새 영속 4지점 작업이 필요 없다).
 */
export interface AgentProvider {
  kind: AgentProviderKind;
  /** `LocalModelEntry.id`. 아직 모델을 안 고른 버블은 빈 문자열. */
  modelId: string;
  /** 표시용 이름 — 모델 파일이 지워져도 버블 라벨이 무엇이었는지는 남는다. */
  modelName?: string;
  /** 컨텍스트 길이(토큰). 미설정 = 엔진 기본값. */
  contextSize?: number;
  /** 샘플링 온도. 미설정 = 엔진 기본값. */
  temperature?: number;
  /**
   * §5.19 (H) — 이 모델이 **도구 호출을 하는가**. 실제로 물어보고서야 알 수 있다
   * (모델의 채팅 서식이 도구를 모르면 엔진이 요청 자체를 거절한다).
   *
   * - `undefined`/`'unknown'` — 아직 안 물어봤다. 다음 턴에 도구를 실어 보내 본다.
   * - `'ok'` — 도구를 쓴다. 파일을 읽고 고칠 수 있다.
   * - `'none'` — 못 쓴다. **도구 없는 대화 모드로 낮춘다** — 못 하는 일을 하는 척하지
   *   않는다. 버블이 이 값을 보고 그 사실을 표시한다.
   *
   * `AgentConfig` 안에 사니 체크포인트 영속은 따라온다(새 영속 필드 발명 ❌).
   */
  toolSupport?: 'unknown' | 'ok' | 'none';
  /**
 * §5.19 (D) — 직전 왕복에서 **프롬프트가 실제로 몇 토큰이었나**. 엔진이 응답에 실어 주는 값을
 * 그대로 옮긴 것이라 우리가 세지 않는다. 창이 얼마나 찼는지를 **넘치기 전에** 보여 주는 자리.
 */
  contextUsed?: number;
  /**
 * §5.19 (D) — 그 왕복에서 창이 **실제로** 몇 토큰이었나. `contextSize` 요청값과 다를 수 있다
 * — 모델의 학습 문맥보다 크게 잡으면 엔진이 깎기 때문에, 게이지의 분모는 이 값이어야 사실이다.
 */
  contextLimit?: number;
  /**
 * §5.19 (D) — 이 세션이 지금까지 **먹인 토큰**의 합(프롬프트). 왕복마다 더해진다.
 * 로컬은 청구가 0이지만 양과 속도의 감각은 필요하다 — 그게 없으면 "왜 이렇게 느리지"에 답할 수 없다.
 */
  tokensIn?: number;
  /** §5.19 (D) — 이 세션이 지금까지 **뱉은 토큰**의 합(답 + 생각). */
  tokensOut?: number;
}

/** §5.19 (D) — 로컬 추론 백엔드. 릴리스 자산 선택과 실행 양쪽에서 같은 이름을 쓴다. */
export type LocalEngineBackend = 'vulkan' | 'cpu' | 'cuda';

/**
 * §5.19 (B) — 엔진 설치 진행 상황.
 * WS `local_engine_progress` payload + REST 동기 응답 dual-use
 * (§5.7 #23-1 `ClaudeInstallProgress` 와 같은 in-flight 세션 모양 — 새 패턴 발명 ❌).
 */
export interface LocalEngineProgress {
  /** 설치 시도 식별자 — 중복 호출 시 같은 in-flight 작업 id 를 돌려준다. */
  installId: string;
  status: 'starting' | 'downloading' | 'extracting' | 'verifying' | 'done' | 'error';
  /** 지금 받고 있는 릴리스 자산 이름(예: `llama-b10502-bin-win-vulkan-x64.zip`). */
  asset?: string;
  receivedBytes?: number;
  /** 서버가 Content-Length 를 안 주면 0 — 그때는 막대 대신 받은 양만 보여 준다. */
  totalBytes?: number;
  /** 자산을 여러 벌 받을 때 몇 번째인지(1-base). */
  step?: number;
  stepCount?: number;
  /** 사람이 그대로 읽을 실패 사유. */
  error?: string;
}

/**
 * §5.19 (B) — 설치된 엔진 상태.
 *
 * **플래그가 아니라 실물 존재가 진실이다.** `UserDefaults.installedApps` 에 id 가 있어도
 * 사용자가 폴더를 지웠으면 `installed=false` 여야 한다 — 안 그러면 첫 대화에서 죽는다.
 */
export interface LocalEngineState {
  installed: boolean;
  /** 설치된 llama.cpp 릴리스 태그(예: `b10502`). 미설치면 null. */
  build: string | null;
  /** 실물이 확인된 백엔드들. */
  backends: LocalEngineBackend[];
  /** `llama-server` 실행 파일 절대 경로. 미설치면 null. */
  serverBin: string | null;
  /** 엔진이 설치되는 폴더(설치 팝업이 "어디에 받는지"를 이 값으로 보여 준다). */
  dir: string;
  /** 진행 중인 설치가 있으면 그 상황. 끝나면 남겨 둔 채 status 로 판정한다. */
  progress?: LocalEngineProgress;
}

/** §5.19 (E) — 받아 둔 로컬 모델 한 개. 디스크를 훑어 만든다(별도 색인 파일 ❌). */
export interface LocalModelEntry {
  /** 파일명 기준의 안정 id. `AgentProvider.modelId` 가 이 값을 가리킨다. */
  id: string;
  /** 사람이 읽는 이름(확장자 뗀 파일명). */
  name: string;
  /** GGUF 파일 절대 경로. */
  path: string;
  sizeBytes: number;
  /** 파일명에서 읽은 양자화 라벨(예: `Q4_K_M`). 못 읽으면 생략. */
  quant?: string;
  /** 파일 mtime. */
  downloadedAt: number;
  /**
   * 큰 모델은 `…-00001-of-00003.gguf` 처럼 쪼개져 배포된다. 그 조각들은 **한 모델**이므로
   * 목록에서도 하나로 묶고, `path` 는 엔진에 줄 첫 조각을 가리킨다(엔진은 첫 조각만 받으면
   * 나머지를 스스로 따라간다 — 다른 조각을 주면 그대로 죽는다).
   *
   * 전체 조각 수. 쪼개지지 않은 모델이면 생략한다.
   */
  partCount?: number;
  /**
   * 아직 없는 조각의 파일명들. 비어 있지 않으면 **이 모델은 쓸 수 없다** — 고르기 전에
   * 화면이 말해 줘야 한다(2026-08-20 실측: 두 조각 중 **둘째 것만** 받힌 채로도 고를 수
   * 있어서, 엔진이 `code=1` 로 죽는 것 말고는 사용자가 알 길이 없었다).
   */
  missingParts?: string[];
  /**
   * 이 GGUF 는 **단독으로 돌릴 수 있는 모델이 아니다**(예: `mmproj-…` 시각 투영기,
   * `mtp-…` 투기적 디코딩용 보조 헤드). 본체 모델과 함께 쓰라고 있는 부속 파일이라,
   * 혼자 열면 엔진이 뻗는다(2026-08-20 실측: 텐서 18개짜리 MTP 헤드를 물려
   * `0xC0000005` 액세스 위반). 고를 수 없게 막고 이유를 보여 준다.
   */
  companion?: boolean;
  /**
   * 받은 직후 실제로 몇 마디 시켜 본 결과. **파일이 멀쩡한 것과 말을 하는 것은 다르다** —
   * 깨진 양자화는 엔진이 읽기는 해도 뜻 없는 글자만 뱉는다(2026-08-21 실측:
   * `Qwen3.5-9B-IQ4_XS.gguf` 가 GPU·CPU·최신 빌드에서 모두 한 글자 반복 / 기호 나열.
   * 같은 구조의 공식 Q4_K_M 은 멀쩡했으므로 **구조가 아니라 그 파일**의 문제였다). 그 사실을
   * 사용자가 프롬프트를 치고 빈 답을 받은 뒤에 알게 두지 않는다.
   *
   * `broken` 은 **막는 근거가 아니라 알리는 근거**다(넘겨짚은 판정으로 멀쩡한 모델을
   * 못 쓰게 만들지 않는다).
   */
  outputCheck?: 'ok' | 'broken';
}

/** §5.19 (E) — 모델 내려받기 진행 상황. WS `local_model_progress` payload. */
export interface LocalModelDownloadProgress {
  downloadId: string;
  /** 받는 중인 파일의 예정 id(`LocalModelEntry.id` 와 같은 규칙). */
  modelId: string;
  /** 화면에 보여 줄 이름. */
  name: string;
  status: 'starting' | 'downloading' | 'done' | 'canceled' | 'error';
  receivedBytes: number;
  /** 모르면 0. */
  totalBytes: number;
  error?: string;
}

/**
 * §5.19 (E) — 카탈로그 검색 결과 한 줄(= 아직 안 받은, 받을 수 있는 것).
 *
 * **목록을 코드에 박지 않는다** — 서버가 그때그때 조회해 만든다. 박아 두면 그 항목이
 * 사라진 날 화면이 거짓말을 한다(§5.19 (D) 빌드 번호와 같은 이유).
 */
export interface LocalModelCatalogEntry {
  /** 받은 뒤 갖게 될 id(= 파일명 기준). */
  id: string;
  /** 저장소 이름(예: `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF`). */
  repo: string;
  /** 저장소 안의 파일 경로. */
  file: string;
  /** 내려받을 직링크. */
  url: string;
  /** 모르면 0 — 화면은 "크기 미상"으로 그린다. 쪼개진 모델이면 **조각 전체의 합**. */
  sizeBytes: number;
  /** 파일명에서 읽은 양자화 라벨. */
  quant?: string;
  /**
   * 쪼개져 배포된 모델의 **모든 조각** 경로(`file` 은 그중 첫 조각). 한 조각만 받으면 그
   * 모델은 못 쓰므로, 받을 때는 이 목록을 통째로 받는다. 쪼개지지 않았으면 생략한다.
   */
  partFiles?: string[];
  /**
   * GGUF 머리에서 읽은 모델 구조(`general.architecture`, 예: `qwen2` · `gemma3` · `qwen35`).
   * 받기 전에 앞 몇 바이트만 읽어 알아낸다 — 수 GB 를 받아 보고 알 일이 아니다.
   */
  arch?: string;
  /**
   * 그 구조가 **지금 엔진에서 실제로 도는지**. 우리가 돌려 본 기록에서 나온다(하드코딩한
   * 화이트리스트가 아니다). `broken` 이면 받기를 막는다 — 받아 봐야 못 쓴다.
   */
  archVerdict?: 'ok' | 'broken' | 'unknown';
  /** `broken` 일 때 사람에게 보여 줄 한 줄. */
  archReason?: string;
}

/** §5.19 (E) — 엔진이 보고한 가속 장치 한 대. */
export interface LocalDeviceInfo {
  /** 엔진이 쓰는 이름 그대로(예: `Vulkan0: NVIDIA GeForce RTX 4090`). */
  name: string;
  totalBytes: number;
  freeBytes: number;
}

/**
 * §5.19 (E) — 이 PC 가 감당할 수 있는 크기를 판정하기 위한 실측치.
 *
 * **우리가 하드웨어를 알아맞히지 않는다** — 실제로 모델을 돌릴 그 엔진에게 물어서 받는다
 * (`llama-server --list-devices`). 새 의존성도, 벤더별 분기도 필요 없고, 엔진이 못 쓰는
 * 장치는 애초에 목록에 안 나오므로 "보이는데 못 쓰는" 어긋남이 생기지 않는다.
 */
export interface LocalHardwareInfo {
  devices: LocalDeviceInfo[];
  /** 가장 여유가 큰 장치의 남은 메모리(장치가 없으면 0). 판정의 기준. */
  vramFreeBytes: number;
  totalRamBytes: number;
  freeRamBytes: number;
  /** 잰 시각. 엔진을 깔기 전에는 잴 수 없으므로 0 이면 "아직 모름". */
  measuredAt: number;
}

/**
 * 모델 하나가 이 PC 에서 어떻게 돌지.
 * - `gpu`: 통째로 가속 장치에 올라간다 — 빠르다.
 * - `ram`: GPU 에는 안 들어가지만 시스템 메모리로는 돌아간다 — 느리다.
 * - `too-big`: 이 PC 로는 무리다.
 * - `unknown`: 아직 잴 수 없다(엔진 미설치 등). **모르면 모른다고 한다.**
 */
export type LocalModelFit = 'gpu' | 'ram' | 'too-big' | 'unknown';

/**
 * §5.19 (E) — 카탈로그 목록을 줄 세우는 축.
 * - `downloads`: 많이 받아 간 순 — 무난한 것을 찾을 때.
 * - `likes`: 하트가 많은 순 — 써 본 사람들이 좋다고 한 것.
 * - `trending`: 요즘 뜨는 순 — 갓 나온 모델이 여기 먼저 보인다.
 * - `recent`: 최근에 갱신된 순.
 */
export type LocalModelCatalogSort = 'downloads' | 'likes' | 'trending' | 'recent';

/** §5.19 (E) — 카탈로그에서 고른 저장소 하나(그 안에 양자화가 여럿). */
export interface LocalModelCatalogRepo {
  repo: string;
  /** 저장소 내려받기 수 — 인기순 정렬 표시용. 모르면 0. */
  downloads: number;
  /**
   * 저장소에 달린 하트 수. 모르면 0.
   * 내려받기 수와 다른 것을 말한다 — 받아 본 사람이 아니라 **좋다고 남긴** 사람의 수다.
   */
  likes: number;
  /** 카탈로그가 매긴 트렌딩 점수(요즘 얼마나 뜨는가). 모르면 0. */
  trending: number;
  /** 마지막으로 갱신된 시각(ms). 모르면 0 — 화면은 그때 날짜를 적지 않는다. */
  updatedAt: number;
  /** 이 저장소가 들고 있는 GGUF 파일들. 비어 있을 수 있다. */
  files: LocalModelCatalogEntry[];
}

/**
 * §5.19 — 클라이언트에 내려보내는 로컬 LLM 전체 상태.
 * 영속화 ❌ — 디스크의 실물이 진실이라 서버가 매번 다시 읽어 싣는다.
 */
export interface LocalLlmState {
  engine: LocalEngineState;
  /** 받아 둔 모델들(이름순). */
  models: LocalModelEntry[];
  /** 진행 중이거나 방금 끝난 내려받기들. */
  downloads: LocalModelDownloadProgress[];
  /** 지금 메모리에 올라가 있는 모델 id 들(§5.19 (F) 동시 로드 상한 표시용). */
  loaded: string[];
  /** 이 PC 의 실측 사양 — 목록이 "이건 돌아갑니다/느립니다/무리입니다"를 말하는 근거. */
  hardware?: LocalHardwareInfo;
}
