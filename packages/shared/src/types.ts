import type { MediaConvertKind } from './constants.js';
import type { KeymapOverrides } from './keymap.js';
import type { MobileAddressEntry } from './mobileAddress.js';
import type { UsageLimitStop } from './usageLimitStop.js';
import type { TurnStopReason } from './turnStopReason.js';
import type { BubbleSkin, BubbleEdgeStyle } from './bubbleAppearance.js';
import type { CommandAppTarget } from './commandApps.js';
import type { ApiCreditPersisted, ApiCreditRoute, ApiCreditState } from './apiCredit.js';
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
  /** Notification 서브타입(permission_prompt · idle_prompt · auth_success · elicitation_dialog 등). 구버전 SDK 엔 없다 — 없으면 `message` 휴리스틱. */
  type?: string;
  /** §4 — PostToolUse(Failure) 도구 실행 시간(ms). 구버전 SDK 엔 없다. */
  duration_ms?: number;
  /** Stop 이벤트의 중단 사유 */
  stop_reason?: string;
  /**
   * 서브에이전트(Task/Agent) 식별자 — 서브 컨텍스트 이벤트에만 있다. 이것(또는 `parent_tool_use_id`)이 있는 Stop 은 자식의 종료라
   * 부모 버블을 완료(markStop)시키지 않는다.
   */
  agent_id?: string;
  /** 서브에이전트 이름(예: `Explore`, `general-purpose`, 커스텀 에이전트명). 서브 컨텍스트에만 존재. */
  agent_type?: string;
  /** 이 이벤트가 부모의 어느 Task/Agent tool_use 아래에서 났는지. 서브에이전트 컨텍스트 이벤트에 존재. */
  parent_tool_use_id?: string;
  /** UserPromptSubmit 이벤트의 프롬프트 본문 */
  prompt?: string;
  /**
   * §5.5 #17-9 ⑦(b) — `Stop`/`SubagentStop` 의 마지막 assistant 텍스트. 서브 종료에선 자식의 최종 보고라
   * `PostToolUse(Task).tool_response` 가 빠질 때 결과 폴백이 된다.
   */
  last_assistant_message?: string;
  /**
   * §4 — CMD 에이전트 소유자 태그(env `VIBISUAL_OWNER_AGENT_ID` → handler.mjs → /api/hook-event). 서버가 그 CMD 버블 세션으로 귀속해
   * 별개 Hook 버블을 안 만든다. 명시 토큰이라 cwd 휴리스틱(§17 Hook≠Custom)과 달리 외부 세션을 잘못 흡수하지 않는다.
   */
  _vibisualOwnerAgentId?: string;
  /**
   * §4 — CMD 소유자 termId(`term:<agentId>:<session>`, PTY env `VIBISUAL_OWNER_TERM_ID`). 서버가 termId 별 sessionId 를 적어
   * 재시작 후 `claude --resume <id>` 로 잇는다.
   */
  _vibisualOwnerTermId?: string;
  /**
   * §5.1 #1-1 (D) — 이 이벤트를 낸 우리 sub(세션 탭). env `VIBISUAL_SUBAGENT_ID` 를 훅이 헤더 `x-vibisual-subagent-id`·본문으로 싣고,
   * 없으면 라우트가 찾아 둔 sub 로 채운다(코덱스·로컬은 방출기). `session_id` 가 주인 버블 키로 바뀐 뒤에도 앱 작업 귀속(§5.1 #2-1 (F))이
   * sub 를 잃지 않게 하는 명시 id — 이 에이전트의 sub 일 때만 쓴다.
   */
  _vibisualSubAgentId?: string;
  /** §5.26 (B) — 트랜스크립트(JSONL) 절대경로. 압축 직전 상태를 뜨는 열쇠다(특히 `PreCompact`). 없으면 세션 id 로 `~/.claude/projects` 를 되짚는다(폴백). */
  transcript_path?: string;
  /** §5.26 (B) — `PreCompact` 가 자동압축인지 `/compact` 인지 — (F) 미발동 감시의 유일한 증거. 없으면 `auto`(틀려도 감시가 한 번 더 볼 뿐). */
  trigger?: string;
  /** §5.26 (D) — `/compact <지시>` 로 사용자가 준 요약 지침. 기록만 하고 우리가 고치지 않는다(§5.26 (J)). */
  custom_instructions?: string;
}

/** §4 — 도구 실행 시간 ring buffer 엔트리(agent 별 최근 5건, 영속 ❌). */
export interface ToolDurationEntry {
  ts: number;
  tool: string;
  durationMs: number;
}

/** §4 — 진단 에러 로그 1건(§7.7). `source` = renderer/main/server. 서버 ring buffer(`DIAGNOSTIC_LOG_MAX`), 영속 ❌. */
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

/** §4 — agent 별 PreCompact 횟수 + 마지막 시각(`ProjectCheckpoint.compactCounts` 로 영속). */
export interface CompactCount {
  count: number;
  lastAt: number;
}

/** §4 — Claude.ai 한도 사용률(statusline 스크립트가 푸시). 사용자 단위라 글로벌 1건, 영속 ❌. */
export interface RateLimitInfo {
  /** **퍼센트(0~100).** 0~1 비율 ❌ — 값 1 이 1%인지 100%인지 갈리지 않는다. */
  used5h?: number;
  resetAt5h?: number;
  used7d?: number;
  resetAt7d?: number;
  updatedAt: number;
}

/**
 * §4 — 사용량 수집기(statusLine) 설치 상태. 한도 사용률은 statusLine stdin JSON(`rate_limits.five_hour…`)으로만 나와
 * `~/.claude/settings.json` 의 `statusLine` 에 핸들러를 걸어야 한다(opt-in). `foreign` = 이미 다른 statusLine 을 쓰는 중 —
 * `_vibisualPrevStatusLine` 에 보존하고 passthrough 실행한다(해제 시 원복).
 */
/**
 * §4 — 화면용 Claude 사용량(`buildClaudeUsage` 가 `RateLimitInfo` 를 옮긴다). 수집기가 꺼지면 `error: 'no-credentials'`.
 * `GET /api/oauth/usage` 직접 호출 ❌ — 문서에 없는 엔드포인트라 약관에 걸린다(그래서 `weekly_scoped`·`extraCredits` 는 비어 있다).
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
 * 값의 원천 — 더 최근 것을 쓴다. `'cli'` = `claude -p "/usage"`(0턴·과금 0 실측) 뒤 CLI 가 적는 `~/.claude.json` 의
 * `cachedUsageUtilization` 을 읽는다(공개 인터페이스 + 로컬 파일). `'statusline'` = 대화형 세션이 밀어 주는 값(더 빨리 올 때가 있다).
 * 내부 엔드포인트 조회는 약관 문제로 ❌.
 */
export type ClaudeUsageSource = 'statusline' | 'cli';

/**
 * no-credentials 수집기 꺼짐(mac 키체인 포함) · awaiting-statusline 켜졌는데 첫 값 전(대화형 세션이 한 번 그려져야 온다 —
 * "켜라"가 아니라 "기다리는 중") · cli-unavailable `claude` 없음·`/usage` probe 실패 · unauthorized/network 는 지금 안 나지만 화면 문구가 있어 남긴다.
 */
export type ClaudeUsageError =
  | 'no-credentials'
  | 'awaiting-statusline'
  | 'cli-unavailable'
  | 'unauthorized'
  | 'network';

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

/** §4 — Claude 로그인 상태(`claude auth status --json` 그대로). 자격증명을 직접 읽거나 쓰지 않는다 — 판정·로그인·로그아웃 전부 CLI. 글로벌 1건, 영속 ❌. */
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
  /**
   * 판정 못 한 탐침이 덮기 전의 마지막 정상 판정. "모름"이 이것까지 지우면 다음 폴링(10분)까지 준비 판정이 막히므로,
   * 준비만 보는 쪽(오케스트라)은 `error` 가 있어도 이걸 쓴다.
   */
  staleLoggedIn?: boolean;
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
 * idle → active → completed(에이전트만) → disappearing. awaiting_permission = 권한을 묻는 중(시각 신호만, PreToolUse 차단과 별개).
 * 입력 대기 상태는 두지 않는다 — `--resume` 으로 늘 이어지고, 두면 재시작 때 모래시계가 떠 끊겨 보인다.
 */
export type NodeStatus =
  | 'idle'
  | 'active'
  | 'completed'
  /** 소속 세션이 실패로 끝났다 — `SubAgentStatus` 와 값 집합을 맞춘다(없으면 실패가 `completed` 로 내려가 완료음까지 울린다). */
  | 'error'
  | 'disappearing'
  | 'awaiting_permission';

/** 버블 타입 — 시각 카테고리 */
/**
 * `bundle` 은 화면만 짓는 종류(§2.2 · §5.1 #2-1 (B)) — 서버는 만들지도 저장하지도 않는다.
 * 파일을 묶음의 부모로 세우지 마라 — png·mp4 가 폴더처럼 읽힌다.
 */
export type BubbleType = 'agent' | 'internal_folder' | 'external_folder' | 'file' | 'bash' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'worktree' | 'conti' | 'auto' | 'trash' | 'video' | 'spec' | 'lab' | 'shelf' | 'domain' | 'bundle';

/**
 * §5.1 #2-1 (A) — 파일 버블의 얼굴(`BubbleType` 은 여전히 `file`, 그리는 법만). 앞의 넷(영상·사진·소리·3D)은 미리보기를 굽는 미디어.
 * 판정은 `fileFaceKindOf` 한 곳 · 굽고 여는 앱은 레지스트리가 정한다(§5.13 (R-1), 코어에 확장자→앱 표 ❌).
 */
export type FileFaceKind =
  | 'video'
  | 'image'
  | 'audio'
  | 'model'
  | 'code'
  | 'data'
  | 'doc'
  | 'subtitle'
  | 'font'
  | 'other';

/**
 * §5.1 #2-1 (G) ⑤ — 종류 안의 갈래: 미리보기가 없을 때 아이콘만 정한다(별자리·역할은 종류가 — `.musicxml` 은 데이터 종류·악보 아이콘).
 * 판정 `fileFaceFamilyOf` 한 곳, 표에 없으면 기본 갈래.
 */
export type FileFaceFamily =
  // 영상
  | 'video' | 'videoRaw' | 'motion' | 'videoProject'
  // 그림
  | 'image' | 'vector' | 'photoRaw' | 'hdr' | 'texture' | 'material' | 'layered' | 'icon'
  // 소리
  | 'audio' | 'sequence' | 'soundfont' | 'daw' | 'score'
  // 3D
  | 'model' | 'scene' | 'modelSource' | 'cad' | 'avatar' | 'pointCloud' | 'splat' | 'motionData'
  // 자막 · 글꼴
  | 'subtitle' | 'lyrics' | 'font'
  // 코드
  | 'code' | 'shader' | 'shell' | 'notebook' | 'web'
  // 데이터
  | 'data' | 'table' | 'database' | 'config' | 'lut' | 'timeline' | 'weights'
  // 문서
  | 'doc' | 'pdf' | 'slides' | 'screenplay' | 'log'
  // 기타
  | 'archive' | 'other';

/**
 * §5.1 #2-1 (F) ① — 이 파일이 생긴 앱 작업(앱 노드 id 마다). 서버가 훅 귀속으로 단다(`QueuedCommand.appNodeIds`, 없으면 같은 세션 마지막 앱 명령).
 * 노드째 체크포인트, 화면은 앱 작업 보기(§5.4 #36 (I))에서만 읽는다.
 */
export interface AppWorkMark {
  /** 그 작업 중에 쓴 횟수(사후 이벤트 기준 · 되짚기는 노드의 `writeCount`). */
  w: number;
  /** 마지막으로 쓴 시각(ms). */
  at: number;
  /** 스크립트가 만든 파일 — 작업 폴더 훑기가 올렸다(§5.1 #2-1 (F) ③). */
  script?: boolean;
  /** 이미 떠 있던 캔버스를 되짚어 단 표식(§5.1 #2-1 (F) ②). */
  retro?: boolean;
}

/**
 * §5.1 #2-1 (F) ⑤ — 앱 작업 위성 역할, 위쪽 반원에 왼쪽부터 이 순서(`APP_WORK_ROLES`). result 담긴 파일 ·
 * sibling 같은 종류인데 안 담긴 것 · material 다른 미디어·자막·글꼴 · code · data · memo · other.
 */
export type AppWorkRole = 'result' | 'sibling' | 'material' | 'code' | 'data' | 'memo' | 'other';

/**
 * §5.1 #2-1 (B) — 파일이 별자리 중심을 도는 이유(툴팁 — 판정 안 한 사실은 단정 ❌). 점수 `CONSTELLATION.score`, 판정 `planConstellations`.
 * appResult/appPart 앱 노드 선언 · mention/mentioned 서로 이름을 적음 · chain 묶인 재료가 적음 · sameStem/stemFamily 이름 같음/낱말 공유 ·
 * sameFolder 같은 폴더 곁 파일·종류 묶음 구성(파일은 중심 ❌) · appWork 앱 작업 중 생김(앱 작업 보기에서만).
 */
export type ConstellationReason =
  | 'appResult'
  | 'appPart'
  | 'appWork'
  | 'mention'
  | 'mentioned'
  | 'chain'
  | 'sameStem'
  | 'stemFamily'
  | 'sameFolder';

/** §5.4 #33 — 정리 때 앉는 띠(버블 타입과 별개 축 — 같은 `agent` 도 running/attention/waiting 으로 갈린다). 순서 정본 `TIDY_BAND_ORDER`. */
export type TidyBand = 'running' | 'attention' | 'waiting' | 'folder' | 'other';

/** §5.4 #33 (I) — 정리 기준. 띠 순서는 "지금 뭐가 도나"에만 답하므로 기준을 코드에 박지 않는다. 정본 `TIDY_SORTS`(§3.3), 판정 `tidySort.ts` 한 곳. */
export type TidySort = 'status' | 'kind' | 'heat' | 'recent' | 'lineage';

/**
 * §5.4 #33 (I) — 정리 기하(`TidySort` 와 별개 축). `rows` = 순위 있는 기준(`status`·`heat`·`recent`), 위→아래·왼→오.
 * `clusters` = 순위 없는 분류(`kind`·`lineage`), 무리별 구역을 동심으로(줄로 세우면 뜻 없는 서열이 생긴다).
 * 동심 띠(`rings`)로 되돌리지 마라 — 시작점이 없어 칸 수조차 안 세어진다.
 */
export type TidyGeometry = 'rows' | 'clusters';

// §5.9 화면/프로그램 캡처 — CommentBox 처럼 캔버스에 직접 만드는 독립 요소('captureNode', parent/child 없이 절대좌표).
// 라이브 영상은 렌더러가 getUserMedia 로 붙이고, 이 타입은 위치·크기·소스만 나른다.

/** 캡처 대상 종류 — 전체 화면 vs 개별 창/프로그램(OBS/디스코드식 소스 선택). */
export type CaptureSourceKind = 'screen' | 'window';

/** `desktopCapturer.getSources()` 한 항목의 IPC 계약(main → preload `window.api.capture` → picker). 썸네일은 data URL(PNG). */
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

// §5.9 Phase B — 렌더러→main 입력 주입 계약. 정규화 좌표(u,v ∈ [0,1])를 main 이 소스 실제 좌표로 옮겨 nut.js 로 주입한다.

/**
 * u,v 는 캡처 콘텐츠 기준 정규화 좌표. **주입은 물리 버튼을 뗀 뒤 한 번에** — Windows 는 누르는 순간 우리 창에 SetCapture 를 걸어,
 * 눌린 동안 SendInput 한 마우스 이벤트가 우리 창으로 되돌아온다(나눠 주입하면 클릭·드래그가 먹통).
 */
export interface CaptureMouseInput {
  type: 'mouse';
  sourceId: string;
  sourceKind: CaptureSourceKind;
  sourceName: string;
  /** 실사용은 `click`/`dblclick`/`drag`/`wheel`(원자적·커서 반납). `move`/`down`/`up` 은 남은 계약 — 렌더러는 안 쓴다. */
  action: 'move' | 'down' | 'up' | 'click' | 'dblclick' | 'drag' | 'wheel';
  u: number;
  v: number;
  /** `drag` 의 도착 지점(정규화). 없으면 u,v 와 같은 자리에서 누르고 뗀다. */
  u2?: number;
  v2?: number;
  button?: 'left' | 'right' | 'middle';
  /** wheel 델타(양수=아래로 스크롤). */
  deltaY?: number;
  /** 주입 후 커서를 제자리로 돌릴지. OS 커서는 하나라 두면 대상 화면으로 끌려가 갇힌다 — 원자적 동작은 늘 반납한다. */
  restoreCursor?: boolean;
  /** u,v 로 옮기지 않고 지금 커서 자리에서 버튼만(남은 계약, 원자 경로는 안 쓴다). */
  inPlace?: boolean;
  /** "커서 안 움직이기" — 대상 창에 마우스 메시지를 직접 넣는다. 게임·보호된 창은 무시하므로 그땐 커서 경로로 돌아가 `fallback` 으로 알린다. */
  preferBackgroundClick?: boolean;
}

/**
 * 캡처 대상 실제 사각형 — 드래그 중 손 움직임만 뽑는다. 커서가 대상 위라 브라우저 좌표가 대상 기준이므로 기대 좌표와의 차이만 센다
 * (안 그러면 주입한 이동이 되먹여 폭주). `dip` = 계산용(`screenX/Y` 와 같은 공간) · `physical` = nut.js 픽셀(진단용).
 */
/** 주입 결과 — 렌더러가 실패 이유를 오버레이 칩으로 알린다. */
export interface CaptureInjectResult {
  ok: boolean;
  /** 'nut-unavailable'=주입 엔진 로드 실패, 'target-not-found'=대상 화면/창 못 찾음, 'error'=주입 중 예외. */
  reason?: 'nut-unavailable' | 'target-not-found' | 'error';
  /** 'background' = 커서 없이 대상 창에 메시지 직접 · 'cursor' = 커서를 잠깐 빌리는 기본 경로. */
  method?: 'cursor' | 'background';
  /**
   * 배경 클릭을 못 해 커서 경로로 돌아간 사유. 'message-deaf-app' 합성 메시지를 무시(게임·보호된 창) · 'no-window' 그 지점에 창 없음 ·
   * 'ffi-unavailable' 배경 클릭 경로 자체 불가.
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
 * §5.13 — 내부 앱 버블(캔버스에 직접 만드는 독립 요소). 앱마다 타입·영속 필드·REST 를 늘리지 않는다 — 범용 한 벌에 `appId` 만 다르다.
 * 더블클릭하면 클라 레지스트리가 아는 전용 창이 열린다.
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
  /** §2.4 — 사용자 preserve-pin. 소멸·삭제 경로를 막는다. */
  preservePinned?: boolean;
  /**
   * §5.4 #36 (B) — 참조하는 에이전트들(위성줄 출발점, 중복 없이 `APP_BUBBLE_LINK_MAX` 개). 에이전트가 사라져도 지우지 않는다 —
   * 휴지통에서 되살리면 선도 돌아온다.
   */
  linkedAgentIds?: string[];
  /**
   * §5.4 #36 (C) — 담긴 결과 파일(프로젝트 루트 기준 상대, `/`). `POST /api/app-bubbles/:id/output` 으로 넣고(프로젝트 안 실제 파일만),
   * 노드를 열면 이 파일로 앱이 열린다(§5.13 (R-2)).
   */
  file?: string;
  /** §5.4 #36 (F) — 결과의 판본(그 파일 mtime, ms). 같은 이름으로 다시 보내도 미리보기가 바뀌게 하는 열쇠 — `file` 과 함께 적고 함께 지운다. */
  fileAt?: number;
  /**
   * §5.4 #36 (G) — 크기를 정한 형태('nameplate'/'screen'). 지금 형태와 같을 때만 `width`/`height` 가 렌더 치수, 아니면 앱 선언 크기
   * (정한 적 없는 버블의 치수는 생성 때 값일 뿐). 형태가 바뀌어도 남고 [기본 크기로] 가 지운다.
   */
  sizedForm?: 'nameplate' | 'screen';
  /** §5.4 #36 (H) ① — 위성줄·구슬 줄을 감췄다(연결·결과 전달은 그대로). 없거나 false 면 보인다. */
  linksHidden?: boolean;
  /**
   * §5.4 #36 (H) ③ — 지난 결과: `/output` 이 `file` 을 바꾸기 전 파일들(최근 것부터, `APP_BUBBLE_PAST_FILE_MAX` 까지, 같은 파일 재전송은 안 쌓는다).
   * 노드 아래 구슬 줄에 뜬다.
   */
  pastFiles?: AppBubblePastFile[];
}

/** §5.4 #36 (H) ③ — 지난 결과 한 건. `at` 은 그때의 결과 버전(그 파일의 수정 시각, ms — 모르면 없다). */
export interface AppBubblePastFile {
  file: string;
  at?: number;
}

/** §5.4 #36 (H) ② — 연결 버블 보기('linked' 기본 · 'files'). 저장값은 `'files'` 뿐(`BubbleData.linkLens`) — 이 유니온은 판정·창구 사이 말이다. */
export type LinkLens = 'linked' | 'files';

/**
 * §5.4 #36 (H) ①-2 — [이전 연결 다시 보기]가 다시 세울 버블 한 장(연결을 걷는 순간 서버가 적는다). 노드째 두지 않는다 —
 * 다시 세우기는 훅 라우팅을 타고, 여기엔 라우팅이 모르는 칸(횟수·자리·표식·상한)만.
 */
export interface AgentLinkEntry {
  /** 그래프 노드 키(경로 키). 다시 세운 뒤 이 키로 찾아 칸을 되돌린다. */
  key: string;
  /** 걷기 전의 종류 — 파일·내부 폴더·외부 폴더·도메인·명령 앱(`bash` + `commandApp`). */
  bubbleType: BubbleType;
  /** 파일·폴더는 절대 경로, 도메인은 호스트. 명령 앱에는 없다. */
  target?: string;
  /** 외부 파일이 붙어 있던, 직속 부모가 아닌 외부 폴더의 절대 경로(§2.1 평탄화). 다시 세울 때 그 밑에 다시 붙인다. */
  folders?: string[];
  /** 직속 부모(또는 휘발 접기 자리) 밑에는 없었다 — `folders` 밑으로만 다시 선다. */
  folderOnly?: boolean;
  /** 명령 앱이면 그 앱과 소속 탭 프로젝트(노드 키가 둘로 지어진다). */
  commandApp?: CommandAppTarget;
  project?: string;
  /** 도메인이면 그 버블의 웹 이력(버블이 사라질 때 함께 사라지므로 여기 남긴다). */
  webEntries?: WebEntry[];
  lastTool?: string;
  lastActivity?: number;
  activity?: number;
  readCount?: number;
  writeCount?: number;
  position?: { x: number; y: number };
  appWork?: Record<string, AppWorkMark>;
  maxSatellites?: number;
  maxWebEntries?: number;
}

/** §5.4 #36 (H) ①-2 — 한 에이전트의 마지막으로 걷힌 연결. `at` 은 적은 시각(ms), 줄은 오래된 것부터. */
export interface AgentLinkRecord {
  at: number;
  entries: AgentLinkEntry[];
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

// §5.14 — 플레이 버블(이 프로젝트를 켜는 버튼)

/** `static` = loopback 정적 호스트가 폴더를 그대로 서빙(HTML 앱) · `command` = 셸 명령(dev 서버 등). */
export type PlayRecipeKind = 'static' | 'command';

/** 이 레시피를 누가 정했나 — 화면에 그대로 보여 사용자가 "무엇이 실행되는지" 알게 한다. */
export type PlayRecipeSource = 'detected' | 'observed' | 'agent' | 'user';

/** 플레이 버블의 실행 상태. 버튼 색·아이콘이 이것만 보고 결정된다. */
export type PlayBubbleStatus = 'idle' | 'starting' | 'running' | 'failed';

/** 버블 하나에 레시피 하나(웹·스토리북·API 를 따로 켜려면 버블을 여럿 놓는다). */
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

/** §5.14 — 플레이 버블(독립 캔버스 요소). 레코드 하나가 버튼(x/y/width/height)과 프리뷰 iframe(preview*) 둘로 그려진다 — 프리뷰를 닫아도 버튼은 남는다. */
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
  /** §2.4 — 사용자 preserve-pin. 삭제 경로를 막는다. */
  preservePinned?: boolean;
  /** §5.17 (C) — 실행법을 알아내 준 에이전트. 프리뷰가 열려 있으면 여기로 점선을 긋는다(캔버스에 없으면 안 긋는다). */
  ownerAgentId?: string;
}

// ─── §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드 → 실행) ───

/** 수용 기준 한 줄. 카드를 만들면 `taskAgentId`/`taskSessionId` 가 채워지고 그때 스펙 개정 번호가 `generatedRevision` 에 박힌다 — 이후 번호가 다르면 낡은 카드다. */
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

/** §5.15 — 스펙 한 장(독립 캔버스 요소). 표지로 그려지고 더블클릭하면 전체 화면 보드. */
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
  /** `body`·`items[].text` 가 실제로 달라질 때만 서버가 +1(좌표·크기·제목·`done` 은 ❌). */
  bodyRevision: number;
  createdAt: number;
  updatedAt: number;
  /** §2.4 — 사용자 preserve-pin. 삭제 경로를 막는다. */
  preservePinned?: boolean;
}

// ─── §5.16 — 리뷰·승인 레인 (머지 전에 사람이 붙잡는 자리) ───

/** 변경 파일 한 줄의 변경 종류. git 의 status 문자를 우리 말로 옮긴 것. */
export type ReviewFileChangeType = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';

/** §5.16 — 리뷰 변경 파일 한 줄(`merge-base` 기준 커밋분 + 미커밋분). 증감은 `git diff --numstat` 그대로 — 바이너리는 둘 다 0. */
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

/** §5.16 — 결정 한 건(이력으로 쌓인다). 승인은 그 자리에서 §7.6 병합을 시도해 결과를 같은 레코드에 남긴다. */
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
 * §5.16 — 리뷰 한 건: 워크트리 커스텀 에이전트가 턴을 끝냈고 변경분이 있을 때 서버가 만든다.
 * 표시는 §4 검수 카드(`AgentReview.reviewRequestId`), 승인은 §7.6 merge, 반려는 기존 명령 큐.
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

/** §5.18 — 변형이 흔드는 설정 축(`AgentConfig` 부분집합 넷 + 덧말). 나머지는 기준 에이전트 설정을 물려받는다 — 랩은 설정 창을 새로 짓지 않는다. */
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

/** §5.18 — 변형 실행 결과. **못 읽은 값은 비워 둔다**(화면 `—`) — 0 이면 "공짜"·"안 고쳤다"는 거짓이 되고 그 위의 승격이 무의미해진다. */
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

/** §5.18 — 설정 조합 한 벌 = 표 한 줄. 실행하면 전용 워크트리·에이전트 카드가 생겨 `agentId`/`sessionId`/`worktreePath` 가 차고, 턴이 끝나면 `result`. */
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

/** §5.18 — 랩 한 장 = 과제 + 설정 조합 N개(독립 캔버스 요소, 더블클릭하면 보드 — §7.17). */
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
  /** 기준 에이전트 id(선택) — 그 `AgentConfig` 전량 위에 변형 축만 덮고, 승격 기본 대상도 이것. */
  baseAgentId?: string;
  /** 마지막으로 승격한 변형 id — 표에 `기본값` 배지로 남는다. */
  promotedVariantId?: string;
  /** 마지막 실행 시작·종료 시각. */
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
  /** §2.4 — 사용자 preserve-pin. 삭제 경로를 막는다. */
  preservePinned?: boolean;
}


// ─── §5.20 — 스크립트 선반 (자주 쓰는 명령·프롬프트를 캔버스에 고정) ───

/** §5.20 — 갈래는 둘뿐: `command` 끝나는 셸 한 줄(출력이 결과, 서버 띄우기는 §5.14 몫) · `prompt` 기존 명령 큐로 가는 프롬프트. */
export type ShelfItemKind = 'command' | 'prompt';

/** 선반 항목 한 번의 실행 결과 상태. 판정은 서버만 한다(§3.1). */
export type ShelfRunStatus = 'running' | 'success' | 'failed';

/** §5.20 — 마지막 실행 결과만(§9 무한 성장 금지). 못 읽은 소요·종료 코드는 비워 둔다(§5.18 과 같은 규율). */
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
 * §5.20 — 글리프 이름 고정 목록(`SHELF_ICONS`, 클라가 stroke SVG 로 그림). 이모지·임의 문자열 ❌ — OS·폰트마다 다르고,
 * 남의 선반 파일이 아무 글리프나 그리는 통로가 된다.
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

/** §5.20 — 선반 항목 한 줄(클릭 한 번에 실행). 아이콘·색은 고정 목록(`SHELF_ICONS`/`SHELF_ITEM_COLORS`) 값만. */
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

/** §5.20 — 선반 한 장(독립 캔버스 요소). 표지가 아니라 선반 자체가 그려지고 줄을 누르면 실행된다(§7.18). */
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
  /** §2.4 — 사용자 preserve-pin. 삭제 경로를 막는다. */
  preservePinned?: boolean;
}

/**
 * §5.20 — 내보내기 스키마(공유는 파일까지 — 계정·동기화 ❌). 런타임 필드(id·lastRun·에이전트 id·절대 cwd)는 담지 않는다.
 * 가져오기는 반드시 `normalizeShelfImport()` 를 거친다.
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

/** §5.21 — 토큰 4종 + 비용. 입력을 뭉개지 마라 — 캐시 읽기 1/10·생성 1.25배라 합치면 청구액과 자릿수가 어긋난다. */
export interface CostTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** `calculateTokenCost` 로 4종을 각각 환산한 합(USD). */
  costUsd: number;
  /**
   * 단가 미상 모델 몫이 섞였나(화면 "추정"). `measured`(턴을 읽었나)와 직교 — 읽었지만 단가가 없어 `DEFAULT_PRICING` 등으로 환산한 것
   * (`/v1/models` 는 가격을 안 준다). `addCostTotals` 가 OR 로 전파하니 접는 자리마다 따로 세지 마라.
   */
  estimated?: boolean;
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

/** §5.21 — 원장 한 줄 = 세션 하나. 에이전트·프로젝트 합은 여기서 접은 파생 — 따로 누적하지 마라(어긋나면 진실을 못 가린다). */
export interface CostSessionEntry extends CostTotals {
  /** Claude Code 세션 ID 또는 Codex thread ID. */
  sessionId: string;
  /** 기록을 수집한 엔진. 이전 체크포인트에서는 생략될 수 있다. */
  provider?: 'claude' | 'codex';
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
  /**
   * 이 세션이 쓴, 단가 표에 없던 모델(`COST_MAP_UNSEEDED_MODELS_MAX` 로 자름) — 툴팁이 ID 를 보여 무엇을 고칠지 말한다.
   * 원장에 싣는다 — 스윕이 증분이라 되살아난 세션은 읽은 턴을 다시 안 읽는다.
   */
  unseededModels?: string[];
  /** 읽어들인 턴 수. 0 이면 `measured:false`. */
  turns: number;
  firstAt: number;
  lastAt: number;
  /** 턴을 하나라도 읽었는가. false 면 화면은 `$0.00` 이 아니라 "측정 없음"을 쓴다. */
  measured: boolean;
  /** 날짜 키(`YYYY-MM-DD`) → 그 날 몫. 체크포인트에만(스냅샷 생략), 캡에 밀리면 `retired` 로 접힌다. */
  days?: Record<string, CostTotals>;
}

/** §5.21 — 에이전트 버블 한 장의 합(배지가 읽는 값). 세션 원장에서 접는다. */
export interface CostAgentTotal extends CostTotals {
  agentId: string;
  /** 가장 최근 세션을 수집한 엔진. */
  provider?: 'claude' | 'codex';
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

/** §5.21 — 프로젝트 지도(`ProjectCheckpoint.costMap` 영속 · `GraphSnapshot.costMaps` 전선, 스냅샷엔 세션 `days` 없음). */
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
  /**
   * 이 프로젝트에서 마주친 **단가 미상 모델** 전부(세션 원장의 합집합, 캡 적용).
   * 금액이 왜 추정인지 화면이 이름을 대고 답하는 근거다.
   */
  unseededModels?: string[];
  updatedAt: number;
}

// ─── 권한·감사 경계 (§5.22) ───

/**
 * §5.22 — 위험 동작 4종: delete · network(루프백 ❌) · config 설정 파일 수정 · outside 프로젝트 밖 읽기·고치기(읽기도 센다).
 * 다섯째는 정말 "실행 전에 사람을 세울 일"일 때만.
 */
export type AuditRiskKind = 'delete' | 'network' | 'config' | 'outside';

/** §5.22 — 결정 출처. `policy` = 모드·목록·세션 기억이 답함 · `cancelled` = 답할 곳이 사라져 닫힘(§5.3 #12-1-B) — `deny` 로 적되 거부 수엔 안 센다. */
export type AuditDecisionSource = 'user' | 'timeout' | 'policy' | 'cancelled';

/** §5.22 — 감사 원장 한 줄(도구·대상·사람의 답). 도구 입력 전문은 담지 않는다 — 두 번째 트랜스크립트가 된다. */
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

/** §5.22 — 프로젝트별 경계: 위험 동작을 실행 전에 물을지만. 기록 끄기 스위치는 두지 않는다. */
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

/** §5.22 — 감사 원장(`ProjectCheckpoint.auditLog` 영속 · `GraphSnapshot.auditLogs` 전선). */
export interface ProjectAuditLog {
  projectName: string;
  /** 최신 순. `AUDIT_ENTRIES_MAX_PER_PROJECT` 로 자른다. */
  entries: AuditEntry[];
  boundary: AuditBoundaryConfig;
  counts: AuditCounts;
  retired?: AuditRetired;
  updatedAt: number;
}

// ─── 컨텍스트 보험 (§5.26 Context Insurance) ───

/** §5.26 (B) — 압축이 날릴 수 있는 것. 그 순간 그래프가 이미 아는 것만 담는다(새 수집기 ❌, 모르면 빈 배열). */
export interface CompactWorkingSet {
  /** 그 세션이 만지고 있던 파일 경로(최근 우선). */
  openFiles: string[];
  /** 최근 수정한 파일 경로. `openFiles` 와 겹칠 수 있다(읽기와 쓰기는 다른 사실이다). */
  recentEdits: string[];
  /** 진행 중인 백그라운드 작업 제목. */
  runningTasks: string[];
  /** 아직 안 나간 명령 큐 길이. */
  queuedCommands: number;
  /** §5.5 #17-17 세션 목표 한 줄. */
  goal?: string;
  /** 그 목표의 단계들(끝난 것 포함 — 무엇이 남았는지가 복원의 핵심이다). */
  goalSteps: string[];
  /** §3.6 `TeammateIdle` 팀원 이름(압축이 팀 구성을 날린다). 신고가 없으면 빈 배열. */
  teammates: string[];
  /** 마지막으로 쓴 도구 이름. */
  lastTool?: string;
  /** 마지막 assistant 텍스트 꼬리(`INSURANCE_TAIL_MAX_CHARS` 로 자른다). */
  lastAssistantTail?: string;
}

/** §5.26 (D) — 요약 본문에 나타나지 않은 것("잃었다"가 아니다 — 요약이 바꿔 말했을 수 있다). */
export interface CompactNotCarried {
  openFiles: string[];
  recentEdits: string[];
  runningTasks: string[];
  goal?: string;
  goalSteps: string[];
  teammates: string[];
}

/** §5.26 (D) — 압축이 끝난 뒤 되돌려 적는 결과. 대조가 불가능하면 **적지 않는다**. */
export interface CompactOutcome {
  at: number;
  /** 요약 레코드 한 줄의 바이트 수. 마커 뒤 자란 총량으로 재지 마라 — `attachment`(실측 86KB) 등이 섞여 요약 유무까지 오탐한다. */
  summaryBytes: number;
  notCarried: CompactNotCarried;
  /** 요약이 실제로 실은 항목 수(전부 실렸으면 `notCarried` 가 빈다). */
  carriedCount: number;
  /**
   * `PostCompact` 도 성장도 없이 시간이 지남 = 압축 실패 교착 — 이유를 담는다(§7.23, 재시도/되살리기 선택).
   * ⚠ `PostCompact` 가 온 마커엔 쓰지 마라 — CLI 의 완료 신고라 멀쩡한 압축을 교착으로 부른다(그땐 `summaryUnreadable`).
   */
  failed?: CompactFailReason;
  /**
   * 완료 훅은 왔는데 요약을 못 읽음 — 파서 한계라 실패와 가른다(합치면 멀쩡한 세션을 되살리려 든다).
   * 이때 빈 `notCarried` 는 "모름"이라 (E) 브리핑에 싣지 않는다.
   */
  summaryUnreadable?: boolean;
}

/** §5.26 (D) — 압축을 실패로 볼 이유. 값이 없으면 정상이다. */
export type CompactFailReason =
  /** 요약 항목이 끝내 붙지 않았다(트랜스크립트가 자라지 않음 또는 자랐는데 본문이 비었음). */
  | 'no-summary'
  /** 대조할 트랜스크립트 파일 자체가 사라졌다(외부 정리·프로젝트 이동). */
  | 'transcript-gone';

/** §5.26 (B) — 압축 한 번의 마커. 바이트는 저장고에, 이 줄은 체크포인트에. */
export interface CompactMarker {
  id: string;
  at: number;
  projectName: string;
  sessionId: string;
  agentId?: string;
  subAgentId?: string;
  /** 훅 payload 원문. 자동압축이 실제로 도는지를 (F) 가 판정하는 유일한 사실 증거. */
  trigger: 'auto' | 'manual';
  transcriptPath: string;
  /** 압축 직전의 바이트 오프셋 — 이 뒤가 요약 구간이다. */
  transcriptBytes: number;
  transcriptMtime: number;
  /** 앞 `INSURANCE_HEAD_HASH_BYTES` 바이트의 sha256 — 파일이 갈아치워졌는지 판정. */
  headHash?: string;
  /** 그 시점 컨텍스트(마지막 턴 하나의 입력 크기 — §5.5 정의 그대로). */
  contextUsed?: number;
  contextMax?: number;
  model?: string;
  /** 미러가 **실제로** 있는가. 없는데 있다고 적지 않는다(§5.26 (A) 마지막 항목). */
  mirrored: boolean;
  workingSet: CompactWorkingSet;
  outcome?: CompactOutcome;
  /** (E) 복원 브리핑을 실은 턴이 있었는가 — 두 번 싣지 않기 위한 표식. */
  briefedAt?: number;
  /** §5.26 (D) — `PostCompact` 도착 시각(CLI 의 완료 신고). 없으면 "요약 못 읽음"과 "압축 안 됨"(`/clear` 뿐인 교착)을 성장만으로 가려야 한다. */
  postCompactAt?: number;
  /** §5.26 (G) — `--resume` 으로 되살렸고 문맥 확인 전. #43696: 성공한 얼굴로 빈 문맥을 준다 — 첫 턴 입력 크기가 죽기 전보다 한참 작은지로만 가린다. */
  resumeArmedAt?: number;
  /** 확인이 끝난 시각. 있으면 다시 재지 않는다(첫 턴 한 번만 유효한 비교다). */
  resumeCheckedAt?: number;
  /** 확인 결과 — 되살아났는데 문맥이 안 실렸다. 화면이 이 사실을 그대로 적는다. */
  resumeShortfall?: boolean;
}

/** §5.26 (C) — 사본을 뜨지 못한 이유. 조용히 건너뛰지 않는다. */
export type PreimageSkipReason = 'too-large' | 'unreadable' | 'budget';

/** §5.26 (C) — 쓰기 직전 파일 사본 한 줄. 바이트는 `blobs/<sha256>`. */
export interface FilePreimage {
  id: string;
  at: number;
  projectName: string;
  /** 원본 절대경로(화면에 그대로 뜬다). */
  path: string;
  /** 플랫폼 규칙을 지킨 비교용 키 — `pathKey(p, platform)`. `toLowerCase()` ❌. */
  pathKey: string;
  /** 사본 내용의 sha256. **없으면 "그 시점에 파일이 없었다"** = 되돌리기는 삭제다. */
  sha256?: string;
  size: number;
  sessionId: string;
  agentId?: string;
  subAgentId?: string;
  /** 이 사본을 뜨게 만든 도구(`Bash` / `Write` / `Edit` / `MultiEdit` / `NotebookEdit`). */
  toolName: string;
  toolUseId?: string;
  /** 사본을 못 뜬 경우의 사유. 있으면 되돌리기 손잡이가 아예 없다. */
  skipped?: PreimageSkipReason;
  /** 이 줄로 되돌린 적이 있는가(되돌리기 직전 내용도 한 벌 떠 두므로 되돌리기를 되돌릴 수 있다). */
  restoredAt?: number;
}

/** §5.26 (H) — 캡에 밀려 원장에서 빠진 몫. 숫자는 줄지 않는다(§9). */
export interface InsuranceRetired {
  markers: number;
  preimages: number;
  bytes: number;
}

/** §5.26 (F) — 자동압축 미발동 감시(증거만, 모델 ❌). `overdue`·`stalled` 는 예측, `rejected` 는 일어난 실패(`/compact` 를 보냈는데 `PreCompact` 가 안 옴). */
export type CompactWatchLevel = 'ok' | 'overdue' | 'stalled' | 'rejected';

/** §5.26 (F) — 세션 하나에 대한 감시 판정. 서버가 접어서 실어 준다(§3.1). */
export interface CompactWatchState {
  sessionId: string;
  subAgentId?: string;
  agentId?: string;
  level: CompactWatchLevel;
  /** 판정에 쓴 비율(0~1). 모르면 생략. */
  ratio?: number;
  /** 마지막 `PreCompact` 이후 흐른 시간(ms). 압축이 한 번도 없었으면 세션 나이. */
  sinceCompactMs?: number;
  /** 그 사이 트랜스크립트가 자란 바이트 — "아직 일하는 중"의 증거. */
  grownBytes?: number;
  /** §5.26 (F)(b) — 우리가 `/compact` 를 보낸 뒤 흐른 시간(ms). `rejected` 의 근거. */
  sinceSentMs?: number;
  /** 우리가 프롬프트를 보낼 수 있는 세션인가(= [압축 보내기] 손잡이를 그릴지). */
  canSendCompact: boolean;
}

/** §5.26 (G) — 부활 가능한 죽은 세션 한 줄. */
export interface ResurrectableSession {
  sessionId: string;
  projectName: string;
  agentId?: string;
  subAgentId?: string;
  label?: string;
  cwd: string;
  /** 마지막으로 움직인 시각. */
  lastActivityAt: number;
  /** 트랜스크립트 크기(원본 우선, 없으면 미러). */
  transcriptBytes: number;
  /** 원본이 사라지고 미러만 남았는가. */
  mirroredOnly: boolean;
  /** 죽기 직전 컨텍스트 — 부활 후 실렸는지 대조하는 기준값. */
  contextUsed?: number;
  /** `--resume` 이 크래시할 만큼 큰가(`INSURANCE_RESUME_RISK_BYTES` 초과). */
  resumeRisky: boolean;
}

/**
 * §5.26 (I) — 세션별 실패 압축 집계. 프로젝트 합(`counts`)을 읽으면 모든 탭에 같은 숫자가 남는다 — 서버가 세션 단위로 접어 주고
 * 클라는 다시 세지 않는다(§3.1). 읽는 곳은 보험 창 칩(§5.26 (I) ⑤). 0 인 세션은 싣지 않고 체크포인트 ❌(파생).
 */
export interface InsuranceSessionCounts {
  /** CLI 세션 UUID(= `CompactMarker.sessionId` · `SubAgent.sessionId`). */
  sessionId: string;
  /** 우리 세션 탭 id(= `SubAgent.id`). 훅 세션에는 없다. */
  subAgentId?: string;
  /** 그 세션이 속한 버블 id. */
  agentId?: string;
  /** 이 세션에서 압축이 실패로 끝난 횟수(`outcome.failed`). */
  failedCompacts: number;
  /** 이 세션의 마커 수 — 자르기 전 **전체**에서 센다(전선 목록 길이가 아니다). */
  markers: number;
}

/** §5.26 — 서버가 접어서 실어 주는 집계(클라이언트에서 원장을 다시 세지 않는다 — §3.1). */
export interface InsuranceCounts {
  markers: number;
  preimages: number;
  /** 저장고가 디스크에서 차지하는 바이트(blobs + transcripts). */
  vaultBytes: number;
  /** 압축이 실패로 끝난 횟수. */
  failedCompacts: number;
  /** 되돌릴 수 있는 사본 수(`skipped` 아닌 것). */
  restorable: number;
}

/** §5.26 — 보험 원장(`ProjectCheckpoint.contextInsurance` 영속 · 전선엔 최근 몫만). 두 배열을 합치지 마라 — 압축과 파일 쓰기는 캡·나이·복원 수단이 다르다. */
export interface ProjectInsuranceLedger {
  projectName: string;
  /** 최신 순. `INSURANCE_MARKERS_MAX_PER_PROJECT` 로 자른다. */
  markers: CompactMarker[];
  /** 최신 순. `INSURANCE_PREIMAGES_MAX_PER_PROJECT` 로 자른다. */
  preimages: FilePreimage[];
  counts: InsuranceCounts;
  /**
   * (I) 세션별 집계 — 보험 창 칩이 세는 유일한 근거(§5.26 (I) ⑤). `markers` 는 잘려 있어 클라가 세면 어긋난다 — 자르기 전 전체에서 접는다.
   * 0 인 세션 생략, 체크포인트 ❌.
   */
  sessionCounts?: InsuranceSessionCounts[];
  retired?: InsuranceRetired;
  /** (F) 지금 감시에 걸린 세션들. 파생이라 체크포인트에는 넣지 않는다. */
  watch?: CompactWatchState[];
  /** (G) 부활 가능한 세션(파생, 체크포인트 ❌). ⚠ 방송 스냅샷엔 싣지 마라 — 디스크를 훑어야 해서 안 연 사용자도 매 프레임 치른다. `GET /api/insurance` 에만. */
  resurrectable?: ResurrectableSession[];
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

/** command 지시(기본) · artifact 결과물 전달 · request 역요청(막힌 부분) · critique 리뷰(감사·레드팀). */
export type TaskEdgeKind = 'command' | 'artifact' | 'request' | 'critique';

/** Task Edge 메시지 형식 — 자유 작문 vs 정해진 양식 (schema는 structured payload 기대) */
export type TaskEdgeMessageFormat = 'free' | 'schema';

/** Task Edge 반환 형식 — 결과를 어떤 형태로 받을지 */
export type TaskEdgeReturnFormat = 'artifact' | 'summary' | 'both';

/** Task Edge 우선순위 — 동시 실행 시 순서 */
export type TaskEdgePriority = 'low' | 'normal' | 'high';

/** kind='critique' 만. intermediate(기본) 중간 milestone 마다 · final 완료 후 한 번. */
export type TaskEdgeCritiqueTiming = 'intermediate' | 'final';

/** kind='critique' 만. force-rework 재작업 의무(maxReworkCount 초과 시 comment-only 강등 + 에스컬레이션) · comment-only 참고만. */
export type TaskEdgeCritiqueAuthority = 'force-rework' | 'comment-only';

/**
 * kind='command' 만 — 부모·자식의 도구 분배(`delegationPolicy` 와 직교). shared(기본) 공유·박탈 ❌ ·
 * tool-delegation 부모에서 자식.tools ∩ 부모.tools 박탈 · mode-delegation 모드만 다름 — 박탈 없이 시스템 프롬프트로 강제.
 * 값이 없으면 `delegationPolicy==='strict'` → tool-delegation, 그 외 shared.
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
  /** 탭 프로젝트 이름(생성 때 소스 세션 cwd). 끝점 버블이 소멸해도 `toProjectCheckpoint` 가 이걸로 엣지를 남긴다(§3.5). 없으면 양끝 생존으로 폴백. */
  projectId?: string;
  /** 없으면 'command'. */
  kind?: TaskEdgeKind;
  /** 기본 'free'. */
  messageFormat?: TaskEdgeMessageFormat;
  /** `messageFormat='schema'` 일 때 source 가 따를 양식(자유 텍스트). 비었거나 'free' 면 강제 없음. */
  messageSchema?: string;
  /** 기본 'summary'. */
  returnFormat?: TaskEdgeReturnFormat;
  /** ms — 없으면 무제한. */
  timeoutMs?: number;
  /** 기본 0. */
  retryCount?: number;
  /** 같은 입력이면 이전 결과 재사용 — 기본 false. */
  cacheEnabled?: boolean;
  /** 기본 'normal'. */
  priority?: TaskEdgePriority;
  /** 소스 에이전트의 마지막 결과 (컨텍스트 전달용) */
  lastSourceResult?: string;
  /** 실행 결과 요약 */
  lastResult?: string;
  /** 에러 메시지 (status='error'일 때) */
  errorMessage?: string;
  /**
   * 자매 엣지가 공유하는 Bundle ID(단독이면 undefined). command + returnFormat='both' → command ↔ auto-artifact ·
   * critique + force-rework → critique ↔ auto-rework.
   */
  bundleId?: string;
  /**
   * 'primary' 사용자가 만든 엣지(지우면 자매도) · 'auto-artifact' command 의 결과 반환 채널(반대 방향, 편집·삭제 잠금) ·
   * 'auto-rework' critique 의 재작업 명령 채널(같은 방향, kind='command', 잠금, 본문은 서버 표준 라벨).
   */
  bundleRole?: 'primary' | 'auto-artifact' | 'auto-rework';
  /** 엣지별 위임 정책(없으면 'strict'). strict 맞는 작업은 반드시 위임(소스 자체 Read/Grep ❌) · auto 탐색 비용이 클 때만. */
  delegationPolicy?: 'strict' | 'auto';
  /** kind='critique' 만. 기본 'intermediate'. */
  critiqueTiming?: TaskEdgeCritiqueTiming;
  /** kind='critique' 만. 기본 'force-rework'. */
  critiqueAuthority?: TaskEdgeCritiqueAuthority;
  /** force-rework 최대 재작업(기본 3) — 넘으면 comment-only 강등 + 에스컬레이션. */
  maxReworkCount?: number;
  /** 이번 사이클 누적 재작업 — 타겟이 새로 완료하면 0, auto-rework 발사마다 +1, `maxReworkCount` 초과 시 강등. critique primary 에서만. */
  reworkCount?: number;
  /** kind='command' 만. 없으면 delegationPolicy='strict' → 'tool-delegation', 그 외 'shared'. */
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
  /** 없으면 'command'. */
  defaultKind?: TaskEdgeKind;
  defaultMessageFormat?: TaskEdgeMessageFormat;
  defaultReturnFormat?: TaskEdgeReturnFormat;
  defaultPriority?: TaskEdgePriority;
  /** kind='critique' 프리셋용. */
  defaultCritiqueTiming?: TaskEdgeCritiqueTiming;
  /** kind='critique' 프리셋용. */
  defaultCritiqueAuthority?: TaskEdgeCritiqueAuthority;
  /** kind='critique' + force-rework 프리셋용. */
  defaultMaxReworkCount?: number;
  /** kind='command' 프리셋용. 없으면 TASK_EDGE_DEFAULTS.commandMode. */
  defaultCommandMode?: TaskEdgeCommandMode;
  /** 없으면 TASK_EDGE_DEFAULTS.delegationPolicy. */
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
  icon: 'agent' | 'folder' | 'file' | 'terminal' | 'root' | 'back' | 'ghost' | 'iframe' | 'pipeline' | 'conti' | 'auto' | 'trash' | 'video' | 'spec' | 'lab' | 'shelf' | 'globe' | 'bundle';
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
  /** External executable identified from a shell invocation; never an internal app registry id. */
  commandApp?: CommandAppTarget;
  childCount?: number;
  /** §2.1 — 위성으로 매달린 파일 수. 외부 폴더는 평탄화로 직속 child 가 없어 이 값이 만진 외부 파일 수다(UI 는 `childCount` 우선). */
  satelliteFileCount?: number;
  /** 폴더 위성 표시 상한(§7.5, 없으면 `DEFAULT_MAX_SATELLITES`). 넘으면 `registerSatellite` 가 오래된 것부터 뺀다. 노드째 영속. */
  maxSatellites?: number;
  /** diff 무한 보관(§7.4). 없거나 false 면 `MAX_FILE_EDITS`(=20) 상한. `file` 만, 노드째 영속. */
  unlimitedFileEdits?: boolean;
  /**
   * §5.1 명령 앱 · §7.3 — 남은 기록을 `MAX_COMMAND_APP_HISTORY` 로 줄이지 않고 다 보인다(`unlimitedFileEdits` 와 같은 규칙).
   * 보이는 수만 — 보관 상한(세션당 50)은 그대로. `bash` 만, 노드째 영속.
   */
  unlimitedCommandHistory?: boolean;
  /** 도메인 버블 항목 표시 상한(§5.23 · §7.22, 없으면 `DEFAULT_MAX_WEB_ENTRIES`=20). 넘으면 `appendWebEntry` 가 오래된 것부터. 노드째 영속. */
  maxWebEntries?: number;
  /** §5.24 — 읽기 도구 누적 횟수(읽기 히트맵의 유일한 축). `activity`(합)와 따로 둔다 — 합으로는 읽은 것과 고친 것이 같아진다. 판정 `toolAxis()`. */
  readCount?: number;
  /** §5.24 — 쓰기 도구가 이 버블을 건드린 누적 횟수. `readCount` 와 한 쌍. */
  writeCount?: number;
  /**
   * §2.1 (A) — 이 외부 폴더 아래에서 만진 폴더 수(자기 ❌). 접합은 스스로 만져지지 않아 직속 자식 수로는 규모를 못 말한다.
   * 표시 전용 — `rebuildExternalFolderTree` 가 매번 다시 내고 체크포인트 ❌.
   */
  externalDescendantFolders?: number;
  /** §2.1 (A) — 그 아래에서 만진 **파일** 수(중복 제거). 표시 전용 파생값. */
  externalDescendantFiles?: number;
  /**
   * §2.1 (A) — 접촉 많은 순 **자손 이름 칩**(`EXTERNAL_SUMMARY_CHIPS` 개까지).
   * "그 안에 무엇이 있나"를 말하는 유일한 글자다. 표시 전용 파생값.
   */
  externalSummaryChips?: string[];
  /** §2.1 (A) — 자손 `readCount` 합. 접합은 `quiet` 라 자기 히트가 0 — 없으면 §5.24 히트맵에서 늘 회색이다. 표시 전용. */
  externalRollupReadCount?: number;
  /** §2.1 (A) — 자손의 `writeCount` 합. `externalRollupReadCount` 와 한 쌍. 표시 전용 파생값. */
  externalRollupWriteCount?: number;
  /** §2.1 (C) — 흡수한 휘발 자리 수("세션 N곳" — `…/<세션UUID>/tasks` 는 비휘발 조상에 모인다). 표시 전용. */
  externalFoldedPlaces?: number;
  /** §2.1 (D) — `EXTERNAL_PLACE_PATTERNS` 에 걸린 i18n 키 접미사(클라가 `canvas.externalPlace.<키>` — 서버엔 i18n 없음). 없으면 기본 라벨. 표시 전용. */
  externalPlaceKey?: string;
  /** §2.1 (B) — 예산제 승격으로 최상위에 선 폴더인가(조상 접합에서 활동 점수로 나옴). 표시 전용 — 핀은 `preservePinned` 가 말한다. */
  externalPromoted?: boolean;
  /**
   * §5.23 웹 버블 묶기 — 묶인 버블이면 그 내역(`scope`). `AppState.webGroup` 이 낼 때만 `getSnapshot` 이 호스트 버블 대신 싣는다.
   * 표시 전용 — 기록(`domainEntries`)은 호스트 노드에 남는다.
   */
  webFold?: WebFoldInfo;
  fileSize?: number;
  /** §5.1 #2-1 (A) — 디스크 mtime(ms) = 미리보기 판본(다시 만들면 다시 굽는다). 스냅샷 사본에만, 체크포인트 ❌. */
  fileMtime?: number;
  /**
   * §5.1 #2-1 (C) — 이 글 파일이 이름으로 적은 다른 파일 노드 id(별자리의 가장 강한 근거). 앞부분만 비동기로 읽어 같은 프로젝트 안에서 푼다.
   * 스냅샷 사본에만, 체크포인트 ❌.
   */
  mentions?: string[];
  /**
   * §5.1 #2-1 (B) — 이 위성이 도는 폴더(위성 무리의 주인) 노드 id — 바로 위 폴더가 아니다. 묶음 안이 이 폴더를 범위로 선언해
   * 위성 상한으로 빠진 같은 종류 파일까지 보인다. 묶음이 될 종류의 위성 사본에만, 체크포인트 ❌.
   */
  folderNodeId?: string;
  /**
   * §5.1 #2-1 (B) — 그 폴더 아래(모든 깊이)에서 확인 안 한 턴에 쓴 같은 종류 파일 수(위성 + 구성의 합집합).
   * 묶음 버블의 `종류 묶음 · 수` 가 이것이다. 표시 전용, 체크포인트 ❌.
   */
  folderKindCount?: number;
  /** §5.1 #2-1 (B) — 그 파일들이 함께 든 가장 가까운 폴더(`kindBundleCommonDir`) — 묶음 버블 이름·툴팁. 표시 전용. */
  folderKindDir?: string;
  /**
   * §5.1 #2-1 (B) — 확인 안 한 턴(에이전트의 마지막 명령 — 새 명령이나 캔버스·IDE 확인이 닫는다)에 쓰였다.
   * 서버가 `nodeAgentRefs` 와 휴지통 아닌 에이전트의 이번 턴 장부 둘 다에 있을 때만 `true`. 캔버스 묶음은 이 파일만 담는다(`openTurnOnly`).
   * 표시 전용, 체크포인트 ❌.
   */
  inOpenTurn?: boolean;
  /** §5.1 #2-1 (F) ① — 이 파일이 생긴 앱 작업(앱 노드 id → 표식 — 훅 귀속·되짚기·작업 폴더 훑기). 노드째 영속, 파일 노드만. */
  appWork?: Record<string, AppWorkMark>;
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
   * §2.4 preserve-pin. true 면 setDisappear·자동 'disappearing' 을 건너뛰고, DELETE /api/bubble/:nodeId 는 409, convertToGhost 때 ghostInfo.pinned=true 로
   * fade 를 막는다(ghostInfo.pinned 와는 독립 축).
   */
  preservePinned?: boolean;
  /** 캔버스에서 사용자가 직접 생성한 에이전트 (훅 이벤트가 아닌 UI 생성) */
  customCreated?: boolean;
  /** §5.4 #36 (A) — 캔버스 형태. `'card'` = 원 옆 입력 말풍선, 없으면 버블(되돌릴 땐 칸을 지운다). 서버 소유, 노드째 영속, identity ❌. */
  agentForm?: 'card';
  /** 연결된 파일·위성 버블만 감춘다(연결·작업 기록은 그대로). 서버 소유, 노드째 영속. */
  bubblesHidden?: boolean;
  /** §5.4 #36 (H) ① — 이 에이전트의 연결선을 감췄다(표시만 — 엣지·`linkedAgentIds`·결과 전달은 그대로). 서버 소유, 노드째 영속, identity ❌. */
  linksHidden?: boolean;
  /** §5.4 #36 (H) ② — `'files'` = 작업 파일 위주(활동 선 또렷·구슬 줄 접음), 없으면 연결된 것 위주. 앱 노드가 안 이어진 에이전트엔 뜻이 없다. */
  linkLens?: 'files';
  /**
   * §5.4 #36 (H) ①-2 — 연결 버블 고정: 확인 dismiss·자동 유휴·5분 TTL 이 걷지 않는다(삭제는 그대로).
   * 풀 때 실행 중이 아니면 서버가 바로 걷는다. 노드째 영속.
   */
  linksPinned?: boolean;
  /** §5.4 #36 (H) ①-2 — 다시 세운 연결을 다음 확인 클릭까지 붙든다(TTL·자동 유휴 ❌). 확인·고정 풀기가 지운다. */
  linksReplay?: boolean;
  /** §5.4 #36 (H) ①-2 — 다시 세울 이전 연결 버블 수(`agentLinkRecords` 줄 수 — 메뉴 활성 판정). 스냅샷 사본에만, 체크포인트 ❌. */
  prevLinkCount?: number;
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
  /** §7.11 — `iframeAlive` 가 false 가 된 시각(ms, 서버 전용). `IFRAME_DEAD_GRACE_MS` 가 지나면 위성을 지우고, 살아나면 비운다. */
  iframeDeadAt?: number;
  /** 에이전트 영구 위성 (bash/iframe) — 에이전트와 함께 체크포인트 저장/복원 */
  persistSatellites?: BubbleData[];
  /** §5.7 #26 — worktree 생성 실패 표식(클라 전용, 2.2초). 성공 진행 연출은 두지 마라 — 스탠드인과 실물이 겹쳐 새 버블이 튀어 보인다. */
  creatingStatus?: 'error';
  /** 파이프라인 부모 버블: 실행 전략 타입 — bubbleType='pipeline'일 때만 */
  pipelineType?: PipelineType;
  /** 파이프라인 자식 에이전트: 역할 — pipelineParentId가 있을 때만 */
  agentRole?: AgentRole;
  /** 파이프라인 자식 에이전트 → 부모 파이프라인 ID 참조 */
  pipelineParentId?: string;
  /** Hook 부모 에이전트: 더블클릭 진입 가능 여부 (서브에이전트 보유 시 true) */
  isParentAgent?: boolean;
  /** §5.7 #23-2 — Agent View short id(8 hex, `claude --bg` 의 `backgrounded · <short>`). `claude stop|respawn|rm <short>` 에 쓴다. `-p` 경로엔 없다. */
  agentViewShort?: string;
  /** §5.7 #23-2 — Agent View 가 발급한 sessionId(UUID) — jsonl 경로·reconcile 키. `-p` 경로는 우리가 지정한 id 라 채우지 않는다(발급 주체가 다르다). */
  agentViewSessionId?: string;
  /** `claude -p --session-id <id>` 활성 체크(10초마다, debugMode 표시). inUse=true 면 다른 Claude Code 가 점유 중이라 유지, false 면 이번 주기에 제거. */
  lastLivenessCheck?: {
    timestamp: number;
    inUse: boolean;
    durationMs: number;
  };
  /** §5.10 — 커스텀 에이전트 휴지통(identity 보존). 묘비(`deletedCustomAgents`)는 영구 삭제 때만(§3.2.1 급감 가드). 노드째 영속. */
  trashed?: boolean;
  /** §5.10 — 휴지통 이동 시각(epoch ms). trashed=true 일 때만 의미. */
  trashedAt?: number;
}

/** §5.5 #17-12 — IDE 스트림 표시 밀도(compact 가장 많이 접음 · raw 안 접음). 클라 localStorage 만 — store·컴포넌트가 함께 쓰려고 shared 에 둔다. */
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
  /** Unknown legacy outcomes are not evidence of a successful procedure. */
  status?: 'running' | 'success' | 'error';
  cwd?: string;
  startedAt?: number;
  endedAt?: number;
  /** Command evidence, not a claim that every conditional command actually ran. */
  apps?: CommandAppTarget[];
  /** Exact graph node membership; histories are stored once, under the originating session. */
  appNodeIds?: string[];
  commandTruncated?: boolean;
  outputTruncated?: boolean;
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

// ─── 도메인 버블 (§5.23) ───

/** 셋째 갈래를 늘리기 전에 "에이전트가 웹을 읽은 일"인지 §5.23 경계와 대조한다(브라우저가 아니다). */
export type WebEntryKind = 'search' | 'fetch';

/** §5.23 — 도메인 버블 한 줄 = 그 호스트에서 한 번. 파싱 실패면 `result` 를 비워 둔다(화면 `—` — 빈 값은 "결과 없음"이라는 거짓). */
export interface WebEntry {
  id: string;
  kind: WebEntryKind;
  /** `kind='search'` — 에이전트가 넣은 검색어. */
  query?: string;
  /** `kind='fetch'` — 요청 URL 전문(호스트는 버블이 들고, 여기는 경로·쿼리까지). */
  url?: string;
  /** `kind='fetch'` — 그 페이지에 무엇을 물었나(`prompt` 인자). */
  prompt?: string;
  /** 결과 본문 요약 꼬리. `WEB_ENTRY_TEXT_MAX` 로 잘린다. */
  result?: string;
  /** 잘렸으면 true — 화면이 "…(잘림)"을 말한다. */
  resultTruncated?: boolean;
  /** `kind='search'` — 결과 건수(못 세면 미설정). */
  resultCount?: number;
  /** `kind='search'` — 결과에 나온 대표 호스트들. **이걸로 버블을 만들지 않는다**(§5.23). */
  resultHosts?: string[];
  /** 일어난 시각(ms). */
  at: number;
  /** 실패했으면 그 사유 한 줄. 웹은 파일과 달리 막히는 일이 잦아 "왜 못 읽었나"가 정보다. */
  error?: string;
  /** 이 항목을 만든 에이전트 버블 ID. */
  agentId?: string;
}

/** §5.23 접어 보기 — 접힌 웹 버블 안의 호스트 한 곳. */
export interface WebFoldHost {
  /** 실제 호스트 노드 id — 패널이 `domainEntries[id]` 와 고정 REST 를 이 id 로 부른다. */
  id: string;
  host: string;
  /** 그 호스트에 쌓인 항목 수. */
  entryCount: number;
  status: NodeStatus;
  lastActivity?: number;
  /** 그 호스트 버블의 항목 표시 상한 — 접힌 호스트는 스냅샷에 따로 실리지 않아 여기로 전한다. */
  maxWebEntries?: number;
}

/** §5.23 웹 버블 묶기 (B) — 비슷한 종류. 판정 `webHostKind.ts` 한 곳, 표는 §3.3 `WEB_KIND_HOSTS` 등, 화면 낱말은 `canvas.webFold.kind.<종류>`. */
export type WebKind = 'search' | 'docs' | 'code' | 'package' | 'qa' | 'spec' | 'article' | 'video';

/** §5.23 — 묶인 기준(제목이 말한다). agent 그 에이전트가 읽은 전부 · site 같은 등록 도메인 · kind 비슷한 종류 · rest 나머지("그 밖의 웹"). */
export type WebFoldScope = 'agent' | 'site' | 'kind' | 'rest';

/** §5.23 접어 보기 — 접힌 웹 버블의 내역. `hosts` 는 최신 호스트가 앞이다. */
export interface WebFoldInfo {
  /** 이 접힌 버블의 주인 에이전트 id. */
  agentId: string;
  hosts: WebFoldHost[];
  /** 무엇으로 묶었나. 없으면 `'agent'`(종전 접어 보기와 같은 뜻). */
  scope?: WebFoldScope;
  /** `scope === 'site'` 일 때 그 사이트(`github.com`) — 제목이 된다. */
  site?: string;
  /** `scope === 'kind'` 일 때 그 종류 — 제목이 된다. */
  kind?: WebKind;
}

/** §5.23 — 호스트 묶기 설정(기계 단위 `AppState.webGroup`), 정규화 `normalizeWebGroupSettings` 한 곳. */
export interface WebGroupSettings {
  /** (A) 같은 사이트 — 등록 도메인이 같은 호스트를 버블 하나로(`docs.github.com` + `github.com`). */
  sameSite: boolean;
  /** (B) 비슷한 종류 — 넘친 것을 문서·코드·패키지… 종류끼리 묶는다. */
  byKind: boolean;
  /** (C) 에이전트마다 따로 세울 웹 버블 수. `0` = 상한 없음, `1` = 에이전트마다 하나(종전 접어 보기). */
  maxPerAgent: number;
}

/** §5.23 — 더블클릭 때 여는 곳: `external` 바깥 브라우저(기본) · `iframe` 탭 줄 iframe(인터넷은 격리 웹뷰). `AppState.webOpenTarget`, 정규화 `normalizeWebOpenTarget`. */
export type WebOpenTarget = 'external' | 'iframe';

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
   * §7.11 — 에이전트 신고로만 알게 된 서버: `command` 는 신고 URL 이고 Restart/Start 불가(Stop 은 `killByPort`).
   * watcher 나 포트 인계가 기동 명령을 읽으면 승격되어 사라진다.
   */
  reportedOnly?: boolean;
  /** §7.11 — 포트 인계에서 기동 명령을 못 읽음(권한·도구 부족). 툴팁 구분용이고 재시도를 막지 않는다. */
  takeoverFailed?: boolean;
  /**
   * §7.11 — 인계로 알아낸 실제 cwd(respawn 때 세션 cwd 보다 우선 — 하위 폴더 서버는 세션 cwd 면 즉시 죽는다).
   * Windows 는 공개 API 가 없어 비어 있다(세션 cwd 폴백).
   */
  cwd?: string;
}

/**
 * §5.5 #17-36 ⑫ — 메모 링크 대상(종류·순서 `SESSION_MEMO_LINK_KINDS`). stream = 대화 한 자리(북마크 #17-7 처럼 항목 id + 그 자리 글,
 * `sessionId` null = 메인) · session = 세션 탭(`label` 은 걸 때 이름 — 닫혀도 무엇이었나 말한다) · file = 본문 경로 링크(#17-27 ⑬) 규칙 · url = http(s) 만.
 */
export type SessionMemoLinkTarget =
  | { kind: 'stream'; sessionId: string | null; anchorId?: string; text: string }
  | { kind: 'session'; sessionId: string | null; label?: string }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

/** §5.5 #17-36 ⑫ — 링크 종류 이름(`SessionMemoLinkTarget['kind']`). */
export type SessionMemoLinkKind = SessionMemoLinkTarget['kind'];

/** §5.5 #17-36 ⑫ — 메모 본문 토막 링크. 범위는 본문 오프셋(UTF-16, `selectionStart/End` 단위) — 본문에 표식을 박으면 `[글](주소)` 가 그대로 보인다. */
export interface SessionMemoLink {
  /** 링크 고유 id(메모 안에서 유일). 클라이언트가 발급한다. */
  id: string;
  /** 시작 오프셋(포함). */
  start: number;
  /** 끝 오프셋(제외). 늘 `start` 보다 크다 — 빈 링크는 없다. */
  end: number;
  target: SessionMemoLinkTarget;
}

/**
 * §5.5 #17-36 — 스티키 메모. 세션 탭의 소지품이라 `SubAgent` 안에 산다(닫기·아카이브엔 보존, 최종 삭제 때 함께).
 * 메인 탭 메모만 `ProjectGraph.agentMemos`. 좌표는 스트림 본문 좌상단(px), 스크롤과 무관.
 */
export interface SessionMemo {
  /** 메모 고유 id (예: `memo-lz3k9-a1b2`). 낙관 표시를 위해 클라이언트가 발급한다. */
  id: string;
  /** 본문. 상한 `SESSION_MEMO.TEXT_MAX`. */
  text: string;
  /** 이름(없으면 본문 첫 줄 → 라벨 — 지우는 것이 곧 자동 제목). `SESSION_MEMO.NAME_MAX` 까지, 비면 필드를 남기지 않는다. */
  name?: string;
  /** 컨테이너 좌상단 기준 위치(px). */
  x: number;
  y: number;
  /** 크기(px). `SESSION_MEMO.MIN_*` ~ `MAX_*` 로 clamp 된다. */
  w: number;
  h: number;
  /** 종이색 hex(`#RRGGBB`). 실제로 보이는 색은 아래 `alpha` 와 섞은 결과다. */
  color: string;
  /** 불투명도(0.2~1), 없으면 `DEFAULT_ALPHA`(기본값은 저장 ❌). 글자색은 섞인 실제 색 기준(`memoSurface`) — 낮춰도 대비가 산다. */
  alpha?: number;
  /** 제목줄만 남기고 접은 상태. */
  collapsed?: boolean;
  /** 닫은 시각(ms). 있으면 화면 대신 이 세션의 다시 열기 목록에 보관하며, 세션 최종 삭제 때 함께 지운다. */
  closedAt?: number;
  /**
   * 합쳐진 묶음 이름표(같은 값 = 한 카드, 제목줄이 탭 줄). `MemoGroup` 레코드를 따로 두지 마라 — 마지막 장이 빠지면 빈 묶음이 체크포인트에 남는다.
   * 장수 1 이면 정화가 지운다.
   */
  groupId?: string;
  /**
   * 그 묶음에서 **지금 보이는** 장(= 활성 탭). 묶음당 정확히 하나이며, 정화가 그 사실을 보정한다.
   * 혼자인 장에는 없다.
   */
  groupActive?: boolean;
  /** §5.5 #17-36 ⑫ — 본문 링크(오프셋 — 편집만큼 옮긴다, `memoLinks.ts`). 시작 순·겹침 없음, 비면 필드 ❌. 묶음에서도 장마다 따로. */
  links?: SessionMemoLink[];
  createdAt: number;
  updatedAt: number;
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
  /** 마지막 턴에서 확인된 실제 추론 강도. Codex turn_context 에서 읽는 표시용 값. */
  reasoningEffort?: string;
  /** 현재 컨텍스트 사용량 (토큰) — JSONL에서 읽음, 스냅샷마다 재계산 */
  contextUsed?: number;
  /** 모델 최대 컨텍스트 (토큰) */
  contextMax?: number;
  /**
   * §4 (CLI 사양 추종) (5) — 시작 문맥(첫 응답 문맥 크기, 토큰). 스냅샷 조립 때 JSONL 로 다시 잰다(영속 ❌).
   * 화면은 스폰과 같은 `applyAutoCompactFloor` 로 압축 창을 적는다.
   */
  contextFloor?: number;
  /** §2.4 (잠듦) — 유휴로 claude 자식을 회수한 상태. `status` 와 직교(회수돼도 `idle`). 다음 명령 스폰 때 걷히고 `--resume` 으로 잇는다. */
  dormant?: boolean;
  /** 잠든 시각(ms). `dormant` 가 false 면 의미 없다. */
  dormantSince?: number;
  /**
   * §4 (CMD 터미널 업그레이드 ①) — 입력을 기다리며 멈췄나(`status` 와 직교, `dormant` 와 같은 꼴). PTY 무출력 `CMD_BLOCKED_IDLE_MS` + 꼬리가 `CMD_BLOCK_PATTERNS` 일 때
   * 세우고 바이트가 흐르면 걷는다. 살아 있는 세션이라 dormant 회수 ❌.
   */
  blocked?: boolean;
  /** blocked 로 바뀐 시각(ms). `blocked` 가 false 면 의미 없다. */
  blockedSince?: number;
  /** blocked 로 본 근거 한 줄(마지막 화면 꼬리 발췌). 표시·진단 전용. */
  blockedReason?: string;
  /** §4 (CMD 터미널 업그레이드 ②) — PTY 전경 프로세스명. 탭 라벨 보조 표기만(rename 이 우선). */
  foregroundProcess?: string;
  /** §4 (CMD 터미널 업그레이드 ⑤) — pane 분할 트리(undefined = 단일). 체크포인트에 실린다. */
  paneTree?: CmdPaneNode;
  /** §5.7 #23-2 — Agent View short id(`--bg` 경로일 때). */
  agentViewShort?: string;
  /** §5.7 #23-2 — Agent View sessionId(`sessionId` 와 같지만 발급 주체 구분). `-p` 경로엔 없다. */
  agentViewSessionId?: string;
  /** §5.5 #17-36 — 열린 메모와 닫은 기록. 체크포인트에 실리고 아카이브해도 남는다 — 소유자가 최종 제거될 때 함께 지운다. */
  memos?: SessionMemo[];
  /** §2.4 — "실행중…" 진위 판정. 영속 ❌ — 재시작하면 그 세션은 돌지 않으니 옛 판정은 거짓이 된다. */
  probe?: SessionLivenessProbeResult;
  /** 지금 그 판정을 물어보는 중인가 — 화면에 "확인 중"을 곧바로 세우기 위한 런타임 플래그. */
  probing?: boolean;
  /** §5.5 #17-24 ⑥ — 압축 중이면 시작 시각(ms, 라이브 `압축 중`). 세우고 걷는 곳은 `noteCompactionLine` 한 곳. 영속 ❌(부팅 땐 압축하는 자식이 없다). */
  compactingSince?: number;
  /**
   * §2.4 (한도 정지) — 한도에 끊긴 채 아직 안 돌았다(`status` 와 직교). 세우는 곳 `detectUsageLimitStop`, 걷는 곳 다음 명령(`execute`)뿐.
   * 시간으로 만료시키지 마라 — 풀려도 세션은 끊긴 자리다. 그래서 체크포인트를 왕복해도 산다(지난 턴의 사실).
   */
  usageLimit?: UsageLimitStop;
}

/**
 * §5.5 #17-9 ⑭ — 표식 없이 오래 조용한 작업의 판정. 조용함은 죽음이 아니고(⑩) 전형이 `until …; do sleep 10; done` 같은 정당한 대기라
 * 이 축만은 모델이 판정한다.
 */
export type BackgroundTaskVerdict = 'alive' | 'finished' | 'unknown';

/** 판정 1회의 결과. 항목에 붙어 화면에 그대로 적힌다. */
export interface BackgroundTaskProbeResult {
  /** 판정을 받은 시각(ms epoch). */
  at: number;
  verdict: BackgroundTaskVerdict;
  /** 한 줄 사유 — 모델이 쓴 문장 그대로(최대 `BG_TASK_PROBE_REASON_MAX` 자). */
  reason: string;
  /** 모델이 읽은 스스로 끝나는 조건. "쓸모 있나"로 묻지 마라 — 정당한 대기를 `finished` 로 오판했다(⑭(c)). */
  exitCondition?: string;
  /** 어느 모델이 냈는가 — 나중에 "왜 이렇게 판정했나"를 되짚는 유일한 단서. */
  model?: string;
}

/** §5.5 #17-9 ⑭(g) — 켜기·세기 손잡이. 머신 단위라 `AppState`(§3.2.3). */
export interface BackgroundTaskProbeSettings {
  /** 꺼 두면 조사 자체를 하지 않는다(모델 호출 0). */
  enabled: boolean;
  /** 이만큼 출력이 없으면 **조사 착수**. 0 이면 끔. 시간은 착수 조건일 뿐 판정 근거가 아니다. */
  quietMinutes: number;
  /** `finished` 판정을 실제로 반영해 목록에서 내릴지. 끄면 판정만 화면에 적고 그대로 둔다. */
  autoClose: boolean;
  /** 내릴 때 그 작업의 **프로세스 트리까지** 끊을지. 끄면 장부만 정리한다(유령 프로세스는 남는다). */
  killProcess: boolean;
  /** 판정에 쓸 모델 별칭. 실측에서 `haiku`·`sonnet` 둘 다 5/5 였으므로 싼 쪽이 기본이다. */
  model: string;
}

/**
 * §5.3 #9-2 — 에이전트 프로세스 보호(`AppState.processGuard`). 자동으로 끊으니 끌 수 있어야 한다.
 * 세기 순: 끄기 → 하나의 상한 → 압박 때 가장 큰 것 → 끝나면 정리.
 */
export interface ProcessGuardSettings {
  /** 끄면 묶음을 만들지 않고 감시·정리도 하지 않는다(이 기능이 생기기 전과 같은 동작). */
  enabled: boolean;
  /** 프로세스 하나의 메모리 상한(실메모리 %, 0 = 없음). `PROCESS_MEMORY_CAP_FLOOR_BYTES` 아래로는 안 내린다. */
  memoryCapPercent: number;
  /** 시스템 메모리 여유가 바닥나면 우리 묶음에서 가장 큰 프로세스 하나를 끊는다. */
  pressureKill: boolean;
  /** 에이전트 본체가 내려가거나 하니스가 작업을 끊었다고 적으면 남은 자손을 정리한다. */
  reapOnSessionEnd: boolean;
}

/** §5.3 #9-2 — 프로세스를 멈춘 이유. */
export type ProcessGuardNoticeReason =
  /** 프로세스 하나가 상한을 넘었다. */
  | 'cap'
  /** 시스템 메모리 여유가 바닥나 가장 큰 것을 끊었다. */
  | 'pressure'
  /** 에이전트 본체가 내려간 뒤 남은 자손을 정리했다. */
  | 'session-end'
  /** 하니스가 끊었다고 적은 작업의 남은 프로세스를 거뒀다. */
  | 'task-killed';

/** §5.3 #9-2 — 알림 한 줄의 사실(숫자·이름만, 문장은 클라 로케일). */
export interface ProcessGuardNotice {
  reason: ProcessGuardNoticeReason;
  /** `kernel` = Windows 묶음이 할당을 거부했다(프로세스가 스스로 끝난다) · `watchdog` = 우리가 끊었다. */
  enforcedBy: 'kernel' | 'watchdog';
  /** 실행본 이름(`grep.exe`). 여럿을 정리한 줄(session-end·task-killed)은 비울 수 있다. */
  image?: string;
  pid?: number;
  /** 그 프로세스가 쓰던 메모리(바이트). */
  memBytes?: number;
  /** 걸린 상한(바이트) — `cap`. */
  capBytes?: number;
  /** 그때의 시스템 여유(바이트) — `pressure`. */
  availBytes?: number;
  /** 정리한 프로세스 수 — `session-end`·`task-killed`. */
  count?: number;
}

/** §2.4 — "실행중…" 진위 판정. `isSessionRunning` 근거는 다 우리 깃발이라 끄기가 실패하면 영영 도는 것처럼 보인다 — 깃발 밖의 유일한 답. */
export type SessionLivenessVerdict =
  /** 지금도 일하는 중 — 그대로 둔다. */
  | 'working'
  /** 할 일이 끝났는데 표시만 남았다 — 종료한다. */
  | 'finished'
  /** 멈췄거나 답을 기다린다 — **종료하지 않고** 사용자에게 세운다. */
  | 'stuck'
  /** 증거로 못 가린다 — 그대로 둔다. */
  | 'unknown';

/** 세션 판정 1회의 결과. 세션에 붙어 화면에 그대로 적힌다. */
export interface SessionLivenessProbeResult {
  /** 판정을 받은 시각(ms epoch). */
  at: number;
  verdict: SessionLivenessVerdict;
  /** 모델이 읽은 세션이 기다리는 것. 열어 묻지 마라("아직 도나") — 값싼 모델이 정당한 대기를 끝난 것으로 본다. */
  waitingFor?: string;
  /** 한 줄 사유 — 모델이 쓴 문장 그대로(최대 `SESSION_PROBE_REASON_MAX` 자). */
  reason: string;
  /** 어느 모델이 냈는가 — 나중에 "왜 이렇게 판정했나"를 되짚는 유일한 단서. */
  model?: string;
}

/** §2.4 — 세션 생존 판정 설정. `AppState.sessionProbe` 로 영속된다. */
export interface SessionLivenessProbeSettings {
  /** 꺼 두면 판정 자체를 하지 않는다(모델 호출 0). */
  enabled: boolean;
  /** 대화록이 이만큼(분) 조용해야 판정한다. 0 이면 주기마다(방금 출력한 세션까지 물으면 토큰만 탄다). */
  quietMinutes: number;
  /** `finished` 판정을 실제로 반영해 세션을 내릴지. 끄면 판정만 화면에 적고 그대로 둔다. */
  autoClose: boolean;
  /** 판정에 쓸 모델 별칭. */
  model: string;
}

/** §5.5 #17-9 — 백그라운드 서브에이전트 1건. PreToolUse 의 `tool_use_id`·`tool_input` 에서 뽑는다(§5.3 #12-1 대차대조 — 새 수집 ❌). 런타임 전용. */
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
   * 잡은 곳(없으면 `'hook'`). hook = `PreToolUse(Task|Agent)` · stream = `task_started` — `run_in_background`·`Monitor` 처럼
   * 훅에 안 보이는 작업(안 띄우면 기다리는 세션이 끝난 듯 보인다).
   */
  origin?: 'hook' | 'stream';
  /** §5.5 #17-9 ⑦(a) — 훅 공통 `agent_id`(서브 안에서만 붙는다 — 자식이 도구를 쓰기 시작했다는 뜻, 각인 키). */
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

  /**
   * §5.5 #17-9 ⑭ — 출력 파일 마지막 변경(ms). `lastActivityAt`(훅의 도구 사용 — 셸엔 없음)과 다르다.
   * "N분째 조용"과 조사 착수가 함께 쓰는 단 하나의 시계, 없으면 조사 ❌.
   */
  lastOutputAt?: number;
  /** 지금 판정 에이전트가 돌고 있는가 — 화면에 "확인 중" 한 줄이 선다. */
  probing?: boolean;
  /** 마지막 판정. alive/unknown 이면 항목에 이 줄만 붙고, finished 면 아래칸으로 간다. */
  probe?: BackgroundTaskProbeResult;
}

/** §5.5 #17-9 ⑦(b) — 방금 끝난 백그라운드 서브에이전트(대차대조에서 내려온 항목 + 뒤따르는 `tool_response`). 런타임 전용. */
export interface FinishedSubagentTask {
  /** 내려온 항목의 키(부모 Task 의 `tool_use_id` 또는 합성 키) 그대로. */
  id: string;
  parentAgentId: string;
  /** 이 Task 를 띄운 세션 탭(sub.id). 도는 항목과 같은 범위 산식을 쓰기 위해 함께 옮긴다. */
  subAgentId?: string;
  description?: string;
  subagentType?: string;
  agentType?: string;
  /** 도는 항목의 `origin` 을 물려받는다 — 없으면 끝난 칸만 종류를 못 말한다. */
  origin?: 'hook' | 'stream';
  /** 시작·종료 시각(ms epoch) — 둘의 차가 소요 시간이다. */
  startedAt: number;
  endedAt: number;
  /** 끝날 때까지 쓴 도구 호출 수. */
  toolCount?: number;
  /** §5.5 #17-9 ⑬ — 출력 파일 끝의 종료 코드. 끝 통지 없이 파일 표식으로 회수한 셸에만(결과 칸이 비어 이것으로만 안다). */
  exitCode?: number;
  /** 표식이 `[killed]` 였는가 — 스스로 끝난 것이 아니라 **끊긴** 것이다(종료 코드 없음). */
  killed?: boolean;
  /** §5.5 #17-9 ⑭ — 내려간 이유. 다 "끝남"으로 보이면 자동 닫힘과 스스로 끝남이 안 갈려 자동 정리가 신뢰를 잃는다. */
  closedBy?: 'notification' | 'process-gone' | 'end-marker' | 'probe' | 'user';
  /** `closedBy==='probe'` 일 때 그 판정(사유·끝나는 조건·모델)을 그대로 들고 내려온다. */
  probe?: BackgroundTaskProbeResult;
  /** 정리하며 함께 끊은 프로세스 수. 0 이면 이미 없었다는 뜻이다. */
  killedProcesses?: number;
  /** 부모가 받아 든 자식의 최종 보고 발췌(최대 1,200자). 아직 안 붙었으면 undefined. */
  result?: string;
  /**
   * 트랜스크립트에서 건진 `result` 인가(`subagentResultRescue.ts`). 트리가 끊기면 훅이 안 와 결과가 비지만 일은 트랜스크립트에 남는다 —
   * 부모 세션엔 전달되지 않은 보고다.
   */
  resultRescued?: boolean;
}

/** §5.7 #23-2 — `~/.claude/daemon/roster.json` worker 항목. 스키마가 흔들려 쓰는 필드만 잡는다. */
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

/** §5.7 #23-2 — `~/.claude/jobs/<short>/state.json` 의 아는 필드만. */
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
/** §5.5 #17-18 — 덧말을 꺼내는 법. wait 혼자 한 턴 · merge(기본) 뒤따르는 merge 와 한 프롬프트 · immediate 도는 턴을 끊고(중지 + `--resume`) 바로. */
export type CommandDispatchMode = 'wait' | 'merge' | 'immediate';

/**
 * §5.5 #17-12 ③ — 오류 사유 코드(표시용 — 서버는 코드·종료 코드·꼬리만, 문장은 클라 로케일). stdin = 살아 있는 자식의 파이프가 닫힘 ·
 * crash = 재사용 중 자식이 죽음 · cli = result 줄 `is_error` · orphaned = 서버 재기동으로 끊김 · dispatchResult = 받아야 할 위임 결과(§5.3 #10-2) 없이 턴 끝 ·
 * usageLimit = 한도(§2.4), 실패로 마감되는 경로만 — exit 0 엔진은 `completed` + `stopReason:'usage_limit'`.
 */
export type CommandErrorCode =
  | 'spawn' | 'stdin' | 'exit' | 'crash' | 'cli' | 'maxTurns' | 'agentView' | 'orphaned'
  // §5.19 — 로컬 LLM 턴 실패(엔진 미설치·모델 없음·생성 중 오류). CLI 가 없는 경로라 'cli' 와 구분한다.
  | 'local'
  | 'dispatchResult'
  // §2.4 — 한도 정지. 코덱스는 한도를 `{"type":"error"}` 로 신고해(§5.25 (F)) 실패 경로로 들어오는데,
  //   그것을 `cli` 로 적으면 화면이 "CLI 가 실패를 알렸습니다" 라고 말한다. 멈춘 이유는 실패가 아니라 한도다.
  | 'usageLimit'
  // §4 API 크레딧 — Anthropic 이 크레딧 경로를 거절(Console 잔액·월 한도). 앱 한도가 아니다 — 앱은 금액을 세지도 막지도 않는다.
  | 'creditCap';

/** §5.5 #17-12 ③ — 오류로 끝난 명령의 사유(표시 전용, 실행·판정 로직 미관여). */
export interface CommandError {
  code: CommandErrorCode;
  /**
   * §5.25 (J) — 실패를 낸 엔진. 사유 코드는 엔진 중립이라 문장이 엔진을 알아야 이름을 부른다(못박으면 GPT 버블에 "Claude CLI" 가 뜬다).
   * 모르면 비워 두고 `CLI` 라고만 — 봉합분을 클로드로 단정 ❌.
   */
  engine?: AgentEngineKind;
  /** 프로세스 종료 코드(있을 때만). */
  exitCode?: number;
  /** 원문 꼬리 — stderr 마지막 줄·예외 메시지·CLI 오류 본문. **번역하지 않고** 그대로 보여준다. */
  detail?: string;
}

/** Per-command capabilities declared by an app; never changes the saved agent profile. */
export interface CommandExecutionRequirements {
  localTransport?: boolean;
}

export interface QueuedCommand {
  id: string;
  text: string;
  timestamp: number;
  /** 실행할 subagent ID (null이면 새 세션 자동 생성) */
  subAgentId: string | null;
  /**
   * §5.5 #17-18 ⑥ — 실제로 나간 시각(`queued → executing`). 말풍선 자리를 이걸로 고정한다(덧말은 `timestamp` 와 몇 분씩 벌어진다, 없으면 `timestamp`).
   * ⑥-5 한 번만 찍어라 — 재개·재시도는 같은 턴이라 다시 찍으면 말풍선이 자기 출력 아래로 간다.
   */
  startedAt?: number;
  /** 실행 상태 */
  status: 'queued' | 'executing' | 'completed' | 'error';
  /** 실행 결과 (completed 시) */
  result?: string;
  /** §5.5 #17-12 ③ — error 로 끝난 사유(없으면 옛 명령). 상태바·스트림·타임라인이 무슨 오류인지 말한다. */
  error?: CommandError;
  /**
   * §5.5 #17-12 ③-6 — 턴이 끝난 이유(`resolveTurnStopReason`, `status`·`error` 와 직교 — 중지 = completed + cancelled,
   * 상한 = error(maxTurns) + max_turns). 없으면 옛 명령이거나 이유 모름.
   */
  stopReason?: TurnStopReason;
  /** §4 API 크레딧 — 나간 결제 경로(크레딧 기능이 켜진 Claude 헤드리스만). 표시·자동 이어가기용 — 금액은 Console 이 센다. */
  billingRoute?: ApiCreditRoute;
  /** §4 API 크레딧 — 자동 이어가기 명령이면 원래 명령 id. 이게 있으면 다시 멈춰도 또 잇지 않는다(연쇄 ❌). */
  autoContinueOf?: string;
  /** 이 명령 실행에 사용된 입력 토큰 (이전 누적 대비 증분) */
  inputTokens?: number;
  /** 이 명령 실행에 사용된 출력 토큰 (이전 누적 대비 증분) */
  outputTokens?: number;
  /** Task Edge dispatch 명령의 엣지 ID(완료 때 대기 promise 해제 + 엣지 status 동기화). */
  edgeId?: string;
  /** paste 이미지 절대경로(`.vibisual/attachments/<sessionId>/…`). dispatch 때 프롬프트 끝에 붙이고, 끝나면 `setOnComplete` 가 지운다(아카이브엔 없음). */
  attachments?: string[];
  /**
   * 재시작으로 끊긴 명령을 `[orphaned]` 대신 sub.sessionId 로 다시 큐에 넣었다는 진단 표식 — one-shot 가드로 쓰지 마라(두 번째 재시작부터 다 orphaned).
   * ⑥-5: 이미 나간 명령이라 `queued` 로 돌아가도 말풍선은 `startedAt` 그대로.
   */
  restartResumed?: boolean;
  /** §5.5 #17-18 — dispatch 방식(없으면 `merge`). 큐에 있는 동안 `PATCH /api/commands/:sessionId/:commandId/mode`. */
  dispatchMode?: CommandDispatchMode;
  /** Server-captured unfinished commands that preceded a new task. Later submissions never extend this wait. */
  waitForCommandIds?: string[];
  /** §5.5 #17-18 — 흡수된 덧말 수(배지). 0/undefined = 단독. */
  mergedCount?: number;
  /**
   * §5.3 #9-1 (P) — 끼워 넣은 조용한 내부 명령(자동 압축). 실행은 같고 그리지만 않는다(친 `/compact` 와 글자로 못 가른다).
   * ⚠ "도는가" 판정에서 빼지 마라 — 압축 내내 멈춘 듯 보인다.
   */
  silent?: boolean;
  /** §5.3 #10-4 — 오케스트라 런(`OrchestraRun.runId`). 지휘 명령·킥오프(`?orchestraRunId=`)에 찍히고, 덧말 합치기의 경계다. */
  orchestraRunId?: string;
  /** §5.13 (R-10) — 명령 한 건의 턴·시간 상한. 에이전트 상한과 겹치면 좁은 쪽, 끊을 수 있는 엔진만(`runLimitsApplied`), 비용 약속 ❌. */
  runLimits?: { maxTurns?: number; maxMinutes?: number };
  /** Optional app capability requirements for this command only. */
  executionRequirements?: CommandExecutionRequirements;
  /** §5.1 #2-1 (F) ① — 이 명령의 앱 노드(`APP_WORK.commandNodeMax` 까지) — 쓴 파일에 `appWork` 를 다는 열쇠. 없으면 본문의 앱 노드 id(옛 명령). */
  appNodeIds?: string[];
  /** §5.1 #2-1 (F) ① — 이어진 앱을 모두 뺀 명령 — 꼬리표도 폴백(이어진 앱·마지막 앱 명령)도 없다. `appNodeIds` 가 있으면 싣지 않는다. */
  appNodesOff?: true;
  /** 서버가 실제로 건 상한(없으면 이 엔진은 상한을 지원하지 않았다). 화면은 이것만 "적용됨"으로 말한다. */
  runLimitsApplied?: { maxTurns?: number; maxMinutes?: number };
  /** 시간 상한에 닿아 서버가 멈춘 명령(턴 상한은 기존 `error.code === 'maxTurns'` 가 말한다). */
  runLimitHit?: 'maxMinutes';
  /** §5.3 #12-4 (C) — 열린 검증 범위(서버만 찍는다 — 요청 본문 칸은 무시). 없으면 검증 실행 권한 ❌. `executing` 동안만 유효. */
  verificationScope?: VerificationScope;
  /** §5.3 #12-4 (F) — 검증 횟수·막음·고침. 통과 여부는 담지 않는다(돌렸다 ≠ 통과했다). */
  verification?: CommandVerificationSummary;
}

/** §5.3 #12-4 — 검증으로 세는 실행 종류(요청한 명령에서만 열린다). `VerificationKind` 는 증거(`VerificationAttempt.kind`)가 쓰는 이름이다. */
export type VerificationPolicyKind = 'test' | 'lint' | 'typecheck' | 'build' | 'e2e' | 'browser' | 'screenshot' | 'agent';

/** §5.3 #12-4 (C) — 범위가 어디서 왔나. 사용자 문장 · [검증 실행] 버튼 · 보낸 명령에서 물려받음. */
export type VerificationScopeSource = 'user-prompt' | 'button' | 'inherited';

/** §5.3 #12-4 (C) — 한 명령에 열린 검증 범위. **서버만 만든다.** */
export interface VerificationScope {
  /** 열린 종류. 비면 권한 없음(부정만 기록된 범위). */
  kinds: VerificationPolicyKind[];
  /** 그 명령에서 사용자가 부정한 종류 — 합치기 덧말에서 다른 명령의 요청을 지운다(거부가 이긴다). */
  negated?: VerificationPolicyKind[];
  /** `test` 의 범위. `related`(변경과 관련된 것만 — 기본) · `all`(전체 스위트). */
  testScope?: 'related' | 'all';
  source: VerificationScopeSource;
  /** 권한을 세운 사용자 문장(표시·근거용, 상한 `VERIFICATION_EVIDENCE_MAX`). */
  evidence?: string;
  /** `inherited` 일 때 보낸 명령의 id. */
  parentCommandId?: string;
  /** `inherited` 일 때 넘겨받은 남은 실행 횟수. 없으면 기본 상한(`VERIFICATION_GRANT_RUNS_TOTAL`). */
  runsRemaining?: number;
}

/** §5.3 #12-4 (F) — 한 명령의 검증 기록. 횟수는 종류별·호출별로 센다. */
export interface CommandVerificationSummary {
  /** 범위 안이라 실행을 허락한 호출 수(종류별). */
  ran?: Partial<Record<VerificationPolicyKind, number>>;
  /** 범위 안이라 실행을 허락한 호출 수(합계 — 한 호출이 여러 종류일 수 있다). */
  ranCalls?: number;
  /** 범위 밖이라 실행 전에 막은 호출 수(종류별). */
  blocked?: Partial<Record<VerificationPolicyKind, number>>;
  /** 범위 밖이라 실행 전에 막은 호출 수(합계). */
  blockedCalls?: number;
  /** 이 명령에서 파일을 고치는 호출이 있었다(표시 여부 판단용). */
  edited?: boolean;
}

/** §5.5 #17-11 — `count` = `total` 회면 끝 · `infinite` = 멈출 때까지. */
export type SessionLoopMode = 'count' | 'infinite';

/**
 * §5.5 #17-11 — 루프 상태(서버 판정). waiting = 회차 사이(`nextRunAt`) · stopped = 사용자 중지 · error = 실패 + `stopOnError` ·
 * budget = ⑫(a) 예산 상한(회차 경계에서 멈춤).
 */
export type SessionLoopStatus = 'idle' | 'running' | 'waiting' | 'done' | 'stopped' | 'error' | 'budget';

/** §5.5 #17-11 ⑫(b) — 회차 사이 컨텍스트: none(기본) · compact(`/compact`) · clear(`/clear` — 기억은 진행 파일·git 에). */
export type SessionLoopContextMode = 'none' | 'compact' | 'clear';

/** §5.5 #17-11 — 세션 탭(subAgentId) 단위 반복 명령. 회차는 기존 명령 큐(`QueuedCommand`)에 얹힌다 — 새 실행 레일 ❌. */
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
  /** §5.5 #17-11 ⑪·⑫(b) — 회차 전 컨텍스트 처리(기본 'none'). 이 정리 명령은 회차로 세지 않는다. */
  contextMode: SessionLoopContextMode;
  /** §5.5 #17-11 ⑫(a) — 누적 비용 상한(USD, 0 = 무제한). 넘으면 회차 경계에서 'budget'(도는 회차는 안 끊는다). */
  maxCostUsd?: number;
  /** §5.5 #17-11 ⑫(a) — 누적 토큰(입력+출력) 상한. 미설정·0 이면 무제한. */
  maxTokens?: number;
  /** §5.5 #17-11 ⑫(a) — 사이클 시작(`cycleStartedAt`)부터의 벽시계 상한(ms). 미설정·0 이면 무제한. */
  maxDurationMs?: number;
  /** §5.5 #17-11 ⑫(a) — 이번 사이클 추정 비용(USD). 캐시 구분 없이 입력가로 환산해 실제보다 크다. */
  spentCostUsd: number;
  /** §5.5 #17-11 ⑫(a) — 이번 사이클 누적 토큰(입력+출력). */
  spentTokens: number;
  /** §5.5 #17-11 ⑫(a) — 이번 사이클이 시작된 시각(epoch ms) — 벽시계 상한의 기준. */
  cycleStartedAt?: number;
  /** §5.5 #17-11 ⑫(c) — 진행 파일(프로젝트 상대). 회차 프롬프트에 "읽고 시작, 끝나면 갱신" 규약이 붙어 압축·초기화 뒤에도 잇는다. */
  progressFile?: string;
  /** §5.5 #17-11 ⑫(d) — "한 회차엔 한 가지 일만" 규칙을 회차 프롬프트에 주입할지. */
  oneTaskPerRound: boolean;
  /** §5.5 #17-11 ⑫(e) — 회차에서 실제 변경이 있으면 커밋하라는 규약을 주입할지(커밋 주체는 에이전트). */
  commitEachRound: boolean;
  /** §5.5 #17-11 ⑫(f) — 회차 본문 파일(프로젝트 상대, 고치면 다음 회차부터). 읽기 실패면 `command`. */
  commandFile?: string;
  /** 진행 상태 (서버 판정). */
  status: SessionLoopStatus;
  /** 지금 도는 회차의 `QueuedCommand.id` — 완료 대조용(이 id 가 끝나야 다음 회차). */
  pendingCommandId?: string;
  /** §5.5 #17-11 ⑪ — 끼워 넣은 압축 명령 id. 끝나야 다음 회차를 예약한다(런타임 — 복원 때 비운다). */
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

/** §5.5 #17-17 — active 일 때만 매 턴 주입(achieved·abandoned 는 기록만 남는다). */
export type SessionGoalStatus = 'active' | 'achieved' | 'abandoned';

/** §5.5 #17-17 — agent 턴 끝 신고 · user 직접 보정 · plan 신고가 없을 때 `TodoWrite` 완료/전체. */
export type SessionGoalProgressSource = 'agent' | 'user' | 'plan';

/** §5.5 #17-17 — 퍼센트를 올리는 것은 `done` 뿐(`in_progress` 는 강조). */
export type SessionGoalStepStatus = 'pending' | 'in_progress' | 'done';

/** §5.5 #17-17 — 목표 단계. 서버가 본문이 같은 단계의 `id` 를 재사용해 목록이 다시 와도 체크박스가 안 튄다. */
export interface SessionGoalStep {
  /** 단계 고유 id — 화면 key·부분 갱신용. */
  id: string;
  /** 단계 본문 (`SESSION_GOAL_STEP_TEXT_MAX` 로 자른다). */
  text: string;
  /** 진행 상태 — `done` 개수가 곧 퍼센트다. */
  status: SessionGoalStepStatus;
  /** 마지막 상태 변경 시각 (epoch ms). */
  updatedAt: number;
  /** §5.5 #17-17 ⑪(a) — 단계의 성격(`VisualKindCard.key`) — 유니온이 아니라 자유 키(에이전트가 종류를 만든다). 없으면 중립 점. */
  kind?: string;
  /** §5.5 #17-17 ⑪(d) — 단계를 쓴 주체(없으면 session). `user` 단계는 세션 목록에 없어도 지우지 마라 — 끼워 넣은 일을 에이전트가 덮어 지운다. */
  authoredBy?: 'session' | 'user';
  /** §5.5 #17-17 ⑪(d) — 사용자가 끼워 넣은 시각 (epoch ms). `authoredBy==='user'` 일 때만 의미. */
  injectedAt?: number;
  /** §5.5 #17-17 ⑪(e) — 확신(이진). `low` 는 빗금 테두리, 퍼센트 산식엔 관여 ❌. */
  confidence?: 'high' | 'low';
  /**
   * §5.5 #17-17 ⑰(a) — 앞 단계와 같은 행(병렬). 목록 위 표식일 뿐 그래프 구조 ❌(id·`mergeGoalSteps`·왕복이 그대로).
   * 주입엔 `∥`(⑰(b)), 첫 단계 표식은 무시.
   */
  parallel?: boolean;
}

/** §5.5 #17-17 ⑪(c) — dormant = 노출은 많은데 도움 된 적 없음(중립 점) · trashed = 안 그림(꺼내거나 같은 키를 다시 쓰면 산다). */
export type VisualKindStatus = 'active' | 'dormant' | 'trashed';

/**
 * §5.5 #17-17 ⑪(i) — 종류가 펴는 화면 골격. 여기만은 유한 유니온 — 종류는 늘어도 그릴 줄 아는 화면은 만든 만큼이다.
 * ㉒(a) 산출물 넷은 기존 내부 앱(§5.13 `vibi3d`·`vibistudio`·`vibisound`)을 `AppShellHost fill` 로 편다(`image` 는 편집창 그림 칸) — 새 뷰어·새 창 ❌.
 */
export type VisualKindSurface =
  | 'source'
  | 'log'
  | 'diff'
  | 'web'
  | 'terminal'
  | 'docs'
  | 'image'
  | 'model3d'
  | 'video'
  | 'audio'
  | 'none';

/**
 * §5.5 #17-17 ⑪(a) — 단계 종류 카드. 유니온이면 리터럴마다 shared·서버·클라·12 로케일이 움직여 확장이 멈춘다 — 데이터로 두고 안 쓰이면 시든다.
 * ⑪(i) 그 종류가 펴는 화면(`scene`·`surface`·`blurb`)까지 카드가 든다.
 */
export interface VisualKindCard {
  /** 안정 키 — 단계의 `kind` 가 이것을 가리킨다. 에이전트가 짓는다(`shader`·`migration` …). */
  key: string;
  /** 화면에 뜨는 이름. */
  label: string;
  /** stroke path(`viewBox 0 0 24 24`). 에이전트가 그린다 — 웹 이미지 ❌(출처 불명 라이선스). `sanitizeGlyphPath`·`SVG_PATH_MAX`, 벗어나면 글리프만 버린다. */
  glyph?: string;
  /** 아이콘 색 (`#RRGGBB`). 없으면 중립색. */
  color?: string;
  /** §5.5 #17-17 ⑪(i) — 무대 배경 장면 path 들(`viewBox 0 0 96 96`). `glyph` 와 같은 규율(웹 이미지 ❌·`sanitizeGlyphPath`), 개수 `VISUAL_SCENE_PATHS_MAX`. */
  scene?: string[];
  /** §5.5 #17-17 ⑪(i) — 펴는 골격(없거나 모르면 `none`). 무대가 이 값으로 아래 칸을 고른다. */
  surface?: VisualKindSurface;
  /** §5.5 #17-17 ⑪(i) — 단계에 들어서 손대기 전에 뜨는 한 줄(`VISUAL_KIND_BLURB_MAX` 로 자른다). */
  blurb?: string;
  /**
   * 씨앗 카드인가 — `locate`/`change`/`verify` 셋. **시들지도 지워지지도 않는다**
   * (전부 사라지면 지도가 백지가 되므로).
   */
  seed?: boolean;
  /** §5.5 #17-17 ⑪(i) — 시작 카드(`git`·`github`·`source`·`log`·`build`·`test`). 씨앗과 달리 보통 카드처럼 시들고 휴지통으로 간다. */
  starter?: boolean;
  /** 이 종류가 단계에 붙어 화면에 나온 누적 횟수(§5.10 랭킹의 임프레션과 같은 뜻). */
  refCount: number;
  /** 실제로 도움됐다고 신고된 누적 횟수. 노출만 쌓이고 이것이 0이면 침전한다. */
  helpfulCount?: number;
  /** 마지막으로 "도움됨" 신고된 시각 (epoch ms). */
  lastHelpfulAt?: number;
  /** 사용자가 고정 — 시들지 않는다. */
  pinned?: boolean;
  status: VisualKindStatus;
  /** 휴지통으로 간 시각 (epoch ms). `status==='trashed'` 일 때만 의미. */
  trashedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** §5.5 #17-17 ⑫(a) — 팔레트 출처(skill `skillUsageCounts` · command `bashHistory` · step 사용자 단계) — 이미 세는 것만, 새 수집 ❌. */
export type GoalActionSource = 'skill' | 'command' | 'step';

/** §5.5 #17-17 ⑫(b) — 팔레트 한 칸. 그림·색은 `kind` 카드에서 빌린다(제 색을 가지면 무대와 어긋난다). 저장 ❌(`pinned` 만) — 집계는 파생. */
export interface GoalActionCard {
  /** 원천 접두 안정 키(`skill:<이름>`) — 같은 이름의 스킬과 명령이 한 칸을 다투지 않게. */
  id: string;
  /** 화면에 뜨는 이름. */
  label: string;
  /** 떨궜을 때 단계 본문(스킬 `/이름` · 명령줄 · 문장). 스킬 카드는 이것이 곧 실시간 스킬 제어다(⑫(e)). */
  payload: string;
  source: GoalActionSource;
  /** 가리키는 `VisualKindCard.key` — 그림·색을 여기서 빌린다. 없으면 중립. */
  kind?: string;
  /** 배운 횟수(정렬 기준). 고정된 카드는 0 이어도 맨 앞에 남는다. */
  useCount: number;
  /** 마지막으로 그 일이 있었던 시각 (epoch ms). */
  lastUsedAt?: number;
  /** 사용자가 고정 — 시들지 않는다(⑪(c) 의 `pinned` 와 같은 규칙). */
  pinned?: boolean;
}

/** §5.5 #17-17 — 진행률 갱신 1건(ring buffer 로 `SessionGoal.history` 에 쌓인다). */
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

/** §5.5 #17-35 — 검증 상태(`error` = 애초에 못 보냄). 전이는 서버만(§3.1). */
export type VerificationRunStatus = 'queued' | 'running' | 'done' | 'stopped' | 'error';

/** §5.5 #17-35 ⑤ — fail-closed: `pass` 는 실제 시도(attempts)가 있을 때만, 증거 없는 approve·해석 불가는 `held`(§5.3 #10-3). */
export type VerifyVerdict = 'pass' | 'fail' | 'held' | 'unknown';

/** §5.5 #17-35 ④ — 레시피 출처: §5.14 플레이 버블 · 리포의 `.claude/skills/verify/SKILL.md` · 없으면 `/verify` 에 맡김. */
export type VerificationRecipeSource = 'play-recipe' | 'recorded-skill' | 'none';

/** A connection explicitly selected by the user; desktop handles are rechecked on every run. */
export type VerificationTarget =
  | { kind: 'browser'; url: string; playBubbleId?: string }
  | { kind: 'desktop'; sourceId: string; sourceName: string; sourceKind: 'window' | 'screen' };

/** Coordinates are fractions of the captured viewport, never host desktop coordinates. */
export type VerificationAction =
  | { kind: 'click' | 'double-click'; selector?: string; x?: number; y?: number }
  | { kind: 'fill'; selector?: string; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; deltaX: number; deltaY: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'navigate'; url: string };

export type VerificationCheck =
  | { kind: 'visible'; selector: string }
  | { kind: 'text' | 'value'; selector?: string; expected: string }
  | { kind: 'url'; expected: string }
  | { kind: 'screenshot'; referenceFrame: number; region?: { x: number; y: number; width: number; height: number } };

export interface VerificationElement {
  selector: string;
  role: string;
  name: string;
  value?: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface VerificationEvidence {
  id: string;
  /** Path relative to the project's .vibisual/verify-runs directory. */
  rel: string;
  capturedAt: number;
  sha256: string;
  width: number;
  height: number;
  url?: string;
  title?: string;
}

export interface VerificationToolEvent {
  id: string;
  operation: 'observe' | 'act' | 'check';
  at: number;
  durationMs: number;
  stepIndex?: number;
  action?: VerificationAction;
  check?: VerificationCheck;
  ok: boolean;
  detail: string;
  evidenceId?: string;
}

export interface VerificationTargetAvailability {
  available: boolean;
  reason?: string;
  actions: string[];
  checks: string[];
}

/** §5.5 #17-35 ⑤ — 에이전트가 "실제로 돌린 것" 한 줄. exitCode 가 곧 증거다. */
export interface VerificationAttemptRecord {
  /** build | typecheck | test | run | custom — 자유 문자열(모르는 값도 그대로 보관). */
  kind: string;
  /** 실제로 실행한 명령 원문. */
  command: string;
  /** 실제 프로세스 종료 코드. 없으면 "돌렸다고 말했지만 코드가 없다"는 뜻이라 증거로 세지 않는다. */
  exitCode?: number;
  /** 한 줄 부연(선택). */
  detail?: string;
}

/** §5.5 #17-35 — 검증 한 건(세션 탭 단위). 실행은 기존 명령 큐에 한 건 넣기뿐(새 레일 ❌) — 이 레코드가 시작·판정·증거를 든다. */
export interface VerificationRun {
  /** New runs use the app-owned tools; legacy records have no target. */
  target?: VerificationTarget;
  evidence?: VerificationEvidence[];
  toolEvents?: VerificationToolEvent[];
  requiredSteps?: number;
  procedure?: VerificationDemoStep[];
  expected?: string;
  /** 이 검증 한 건의 ID(`ver-<ts>-<rand>`). */
  id: string;
  /** 소유 (부모) 에이전트 버블 ID — 프로젝트 필터·영속 분류 키. */
  agentId: string;
  /** 이 검증이 붙은 IDE 내부 세션(탭) ID. 맵의 키와 동일. */
  subAgentId: string;
  /** 이 검증이 속한 프로젝트 이름(표시명). */
  projectName: string;
  /** 사용자가 적어 넣은 "무엇을 확인할지" 한 줄(선택). */
  focus?: string;
  /** 실행법을 어디서 얻었나 — 사용자가 보내기 전에 화면에서 먼저 읽는다. */
  recipeSource: VerificationRecipeSource;
  /** 그 레시피를 한 줄로 요약한 표시용 문자열(예: `pnpm dev · http://127.0.0.1:5173`). */
  recipeLabel?: string;
  /** 진행 상태. */
  status: VerificationRunStatus;
  /** 결론. `status !== 'done'` 이면 `unknown`. */
  verdict: VerifyVerdict;
  /** 판정 사유 한 줄(에이전트가 적은 것 그대로, 상한 `VERIFICATION_REASON_MAX`). */
  reason?: string;
  /** 실제로 돌린 시도 목록(상한 `VERIFICATION_ATTEMPTS_MAX`). */
  attempts: VerificationAttemptRecord[];
  /** §5.5 #17-35 ⑨-4 — 실어 보낸 시연 id(없으면 시연 없는 프롬프트). */
  demoId?: string;
  /** 그 시연의 이름 한 줄(시연이 나중에 지워져도 "무엇을 실어 보냈는지"는 이 줄로 남는다). */
  demoLabel?: string;
  /** 이 검증이 큐에 넣은 명령 ID — 완료 대조용(루프의 같은 이름 필드와 같은 규약). */
  pendingCommandId?: string;
  /** 큐에 넣은 시각. */
  startedAt: number;
  /** 판정이 난 시각. */
  finishedAt?: number;
  /** 소요(ms) — `finishedAt - startedAt`. 서버가 계산해 실어 보낸다(클라 계산 ❌). */
  durationMs?: number;
}

/** §5.5 #17-35 ⑨-3 — `atMs` 는 클립 안 시각(벽시계 ❌) — `(0:03)` 으로 찍혀 프레임과 같은 순간을 가리킨다. */
export interface VerificationDemoStep {
  action?: VerificationAction;
  check?: VerificationCheck;
  /** 클립 시작으로부터의 경과(ms). */
  atMs: number;
  /** 그 순간 사람이 무엇을 했는지 한 줄(상한 `VERIFICATION_DEMO_STEP_TEXT_MAX`). */
  text: string;
}

/** §5.5 #17-35 ⑨-3 — 디스크에 남긴 프레임(다음 검증에도 실린다). `rel` 은 `.vibisual/verify-demos/` 기준 — 절대 경로면 다른 PC·경로에서 깨진다. */
export interface VerificationDemoFrame {
  /** `.vibisual/verify-demos/` 기준 상대 경로(`<demoId>/0.png`). */
  rel: string;
  /** 이 그림을 뽑은 클립 안 시각(ms). */
  atMs: number;
}

/** §5.5 #17-35 ⑨ — 한 번 해 보인 재현 절차(`/verify` 가 매번 추론하는 "무엇을 어떤 순서로"를 다음 검증부터 싣는다). 세션 탭 단위. */
export interface VerificationDemo {
  target?: VerificationTarget;
  /** 이 시연의 ID(`demo-<ts>-<rand>`). 프레임 폴더 이름이기도 하다. */
  id: string;
  /** 소유 (부모) 에이전트 버블 ID — 프로젝트 필터·영속 분류 키. */
  agentId: string;
  /** 이 시연이 붙은 IDE 내부 세션(탭) ID. 맵의 키와 동일. */
  subAgentId: string;
  /** 이 시연이 속한 프로젝트 이름(표시명). */
  projectName: string;
  /** 사람이 읽는 이름 한 줄(상한 `VERIFICATION_DEMO_LABEL_MAX`). */
  label: string;
  /** 무엇을 찍었나 — 캡처 소스 이름(창 제목·화면 이름). */
  sourceName: string;
  /** 재현 절차(상한 `VERIFICATION_DEMO_STEPS_MAX`). 비어 있어도 저장은 된다(그림만 있는 시연). */
  steps: VerificationDemoStep[];
  /** 기대 결과 한 줄(상한 `VERIFICATION_DEMO_EXPECTED_MAX`) — "무엇이 보이면 통과인가". */
  expected?: string;
  /** 남긴 프레임(상한 `VERIFICATION_DEMO_FRAMES_MAX`). */
  frames: VerificationDemoFrame[];
  /** 고른 구간의 길이(ms) — 표시·단계 시각 검증용. */
  durationMs: number;
  /** 녹화를 마친 시각(목록 정렬). */
  recordedAt: number;
}

/** §5.5 #17-17 — 세션 탭의 목표. 명령을 쏘지 않는다 — 매 턴 dispatchContext 에 실려 방향만 잡고 `percent` 로 답한다. */
export interface SessionGoal {
  /** 소유 (부모) 에이전트 버블 ID — 프로젝트 필터·영속 분류 키. */
  agentId: string;
  /** 이 목표가 붙은 IDE 내부 세션(탭) ID. 맵의 키와 동일. */
  subAgentId: string;
  /** 목표 한 문장 — 원칙적으로 세션이 쓴다(§5.5 #17-17). 사용자가 고치면 `authoredBy='user'` 가 되어 자동 교체가 멈춘다. */
  text: string;
  /** §5.5 #17-17 — session 은 새 명령에 자동 교체, user 는 세션이 덮어쓰지 않는다. */
  authoredBy: 'session' | 'user';
  /** §5.5 #17-17 — 목표가 나온 명령(자동 생성·교체 기준 — 현재 명령이 다르면 새 일). */
  sourceCommand?: string;
  /** §5.5 #17-17 — 단계 체크리스트. 비어 있을 때만 퍼센트가 신고·계획 폴백(③). */
  steps: SessionGoalStep[];
  /** 진행률(0~100 정수, 서버). `steps` 가 있으면 늘 `done/전체`(신고보다 우선). */
  percent: number;
  /** 생애 상태 — `active` 일 때만 주입된다. */
  status: SessionGoalStatus;
  /** 마지막 진행 갱신의 한 줄 근거 (표시용). */
  note?: string;
  /** 진행 갱신 이력 (오래된 것부터, `SESSION_GOAL_HISTORY_MAX` ring buffer). */
  history: SessionGoalProgress[];
  /** 목표 문장 변경 횟수 — plan 폴백 재개통 기준(`lastExplicitRevision` 과 짝). */
  revision: number;
  /** 마지막 명시 신고 때의 `revision` — 같으면 plan 폴백이 퍼센트를 덮지 않는다(③). 시각으로 판정하지 마라 — 같은 밀리초면 안 갈린다. */
  lastExplicitRevision?: number;
  /** 마지막 명시 신고 시각 (epoch ms, 표시용). */
  lastExplicitAt?: number;
  /** 마지막 진행 갱신 시각 (출처 무관). */
  lastProgressAt?: number;
  /** §5.5 #17-17 ⑰(c) — 지난 목표 문장(오래된 것이 앞, `SESSION_GOAL_PAST_TEXT_MAX` 넘으면 앞부터 버림). */
  pastTexts?: string[];
  /** 생성 시각. */
  createdAt: number;
  /** 마지막 변경 시각. */
  updatedAt: number;
}

// §5.5 #17-28 컨텍스트 주입원 통제 — 프롬프트에 실리는 것을 매번 읽어 세운다(고정 표 ❌).
// 여기서 끄면 다른 화면에서 켜져 있어도 안 실린다. 못 끄는 줄(CLI 내부)은 계측만 하고 잠근다(`control: 'none'`).

/** 주입원 분류 — 화면의 묶음이자 필터 축. */
export type ContextSourceCategory =
  /** Vibisual 이 프롬프트에 직접 조립해 넣는 블록. */
  | 'vibisual'
  /** 지시 파일 — CLAUDE.md · rules · AGENTS.md. */
  | 'instructions'
  /** 기억 — 자동 기억(MEMORY.md). */
  | 'memory'
  /** 스킬 · 슬래시 커맨드 · 서브에이전트 정의. */
  | 'skills'
  /** 도구 정의 · MCP. */
  | 'tools'
  /** Claude Code 자체 시스템 프롬프트. */
  | 'system'
  /** §5.11 집행 플러그인. */
  | 'plugins';

/** 끄는 수단 = 반영 시점. session·spawn 은 다음 프롬프트부터 · external 다른 화면이 주인(잠금·안내) · none 못 끔(CLI 내부). */
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
  /** 고정 항목 i18n 키(실측 이름은 `title` 그대로). */
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
  /** 최종 값을 정한 층(= 그 층에 명시값이 걸려 있다). 아무 층에도 없으면 undefined. */
  overrideScope?: ContextScopeLevel;
  /** 층마다 물려받은 값까지 반영한 켜짐. 스위치는 이걸로 그린다 — `enabled` 로 그리면 아래층 명시값 때문에 위층 스위치가 안 움직인다. */
  scopeStates?: Record<ContextScopeLevel, boolean>;
  /** 층마다 명시값(없으면 상속 중). 위와 같은 값으로 되돌리면 명시값을 지운다(쌓이지 않게). */
  scopeOverrides?: Partial<Record<ContextScopeLevel, boolean>>;
  /** 가장 최근 변경 시각(파일 mtime 등). 날짜 정렬 기준. */
  updatedAt?: number;
  /** 내역(파일 목록 등) — 접었다 펼치는 자리. */
  children?: ContextSourceChild[];
  /** 끌 때 주의 i18n 키(예: 훅을 끄면 화면 갱신이 끊긴다), 경고 색으로 보인다. */
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

/** 주입원 층: project → agent → session, 좁은 쪽이 이긴다. 제 값이 없으면 위를 따르고, 한 번 정하면 위를 무시한다. */
export type ContextScopeLevel = 'project' | 'agent' | 'session';

/** 주입원 오버라이드(영속, 셋 다 없으면 그 항목 기본값). 체크포인트엔 그 프로젝트 몫만, 스냅샷엔 열린 프로젝트들 것 — 모양이 같아 병합 = 키 합치기. */
export interface ContextOverrides {
  /** 프로젝트 키(ProjectInfo.name) → 그 프로젝트의 모든 에이전트·세션에 걸리는 오버라이드. */
  projects: Record<string, ContextOverrideMap>;
  /** 에이전트 버블 id → 그 버블의 모든 세션에 걸리는 오버라이드(프로젝트보다 우선, 세션보다 아래). */
  agents: Record<string, ContextOverrideMap>;
  /** subAgentId → 그 세션 탭에만 걸리는 오버라이드(가장 좁고 가장 우선). */
  sessions: Record<string, ContextOverrideMap>;
  /** 마지막 변경 시각. */
  updatedAt: number;
}

/** §5.5 #17-28 ⑦ — 상세. `text` 는 그 턴에 실제로 조립된 문자열이다 — 사본을 보이면 화면이 프롬프트와 다른 말을 한다. */
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
  /** 본문을 못 읽는 줄(CLI 실행본 안 — 시스템 프롬프트·번들 스킬·도구 스키마·MCP·워크플로). 화면은 이유를 적는다. */
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

// Comment Box(블프식 주석 컨테이너) — 버블을 감싸는 배경 레이어. parent/child 없이 offset 으로 함께 움직인다.

/** Comment Box — 영역 선택 + C 키로 생성되는 주석 컨테이너. */
export interface CommentBox {
  /** 고유 ID — `comment-<timestamp36>-<rand>` 포맷 */
  id: string;
  /** 소속 프로젝트 이름 (탭 필터링용). ProjectInfo.name 기준. */
  projectName: string;
  /** 메인 캔버스 좌표 — 폴더 내부 배치 ❌(Task Edge 처럼 메인 뷰 전용, §5.3 #12). */
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
  /** 감싼 버블 ID(드래그 동반). parent/child 를 쓰지 않는다 — 폴더/위성 계층과 꼬인다. */
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
  // §5.3 #12-1 — 권한 승인 UX
  | 'permission_request'
  | 'permission_resolved'
  // §7.11 — iframe 서버 로그 스트리밍(lazy pub/sub)
  | 'subscribe_iframe_log'
  | 'unsubscribe_iframe_log'
  | 'iframe_log_init'
  | 'iframe_log_append'
  // §7.7 — 서버 코어 로그 스트리밍(lazy pub/sub)
  | 'subscribe_server_log'
  | 'unsubscribe_server_log'
  | 'server_log_init'
  | 'server_log_append'
  // §5.3 #28 — 콘티모드 토스트 신호(식별자만, 본체는 다음 snapshot)
  | 'conti_generated'
  | 'conti_patched'
  // §5.3 #28 (L) — 같은 workId 의 후속 응답으로 Conti.frames 가 교체됐다
  | 'conti_updated'
  // §5.7 #23-1 — Claude Code 업데이트 설치 진행 푸시
  | 'claude_install_progress'
  | 'claude_setup_progress'
  /** §5.25 (D) — 코덱스 설치 진행. 클로드 쪽과 같은 모양(새 전달 방식 발명 없음). */
  | 'codex_setup_progress'
  // §5.19 — 로컬 LLM 엔진 설치 / 모델 내려받기 진행(본체는 graph_snapshot.localLlm)
  | 'local_engine_progress'
  | 'local_model_progress'
  // §5.5 #17-38 ⑫ — 오프라인 받아쓰기: 설치 진행 / 인식 결과(중간·확정)
  | 'voice_asr_progress'
  | 'voice_asr_transcript'
  // §5.3 #12-2 — AskUserQuestion IDE 인라인 카드
  | 'ask_user_question'
  | 'ask_user_question_resolved'
  // §5.3 #10-2 — Auto Agent 진행/완료(요약은 graph_snapshot.autoAgentSummaries)
  | 'auto_agent_progress'
  // §4 — 모델 레지스트리 갱신(시드 + /v1/models). payload = ModelRegistry
  | 'model_registry_updated'
  // §4 — Options 창 글로벌 디폴트 갱신. payload = UserDefaults
  | 'user_defaults_updated'
  // §4 앱 테마 — 사용자 테마 폴더를 다시 읽었다(바뀐 것이 있을 때만). payload = AppThemeCatalog
  | 'app_themes_updated'
  // §5.13 (Y) 40-7 ② — 내부 앱 서버 몫의 알림(문서 판이 올랐다 등). payload = AppEventPayload. 코어는 뜻을 모르고 나른다.
  | 'app_event'
  // §6 — 단축키 재매핑. payload = KeymapOverrides. 창이 여럿이면 다른 창도 즉시 같은 키를 쓴다.
  | 'keymap_updated'
  // §5.23 「더블클릭」 — 도메인 버블 더블클릭이 여는 곳이 바뀌었다. payload = WebOpenTarget. 단축키와 같은 이유로
  //   창이 여럿이면 다른 창도 즉시 같은 곳에서 연다(창마다 다른 곳에서 열리면 그게 곧 버그 신고다).
  | 'web_open_target_updated'
  // §5.5 #16-1 — IDE 활동바 구성(순서·제외) 변경. payload = IDEActivityBarPrefs. 단축키와 같은 이유로
  //   창이 여럿이면 다른 창도 즉시 같은 배치를 쓴다(창마다 항목 순서가 다르면 그게 곧 버그 신고다).
  | 'ide_activity_bar_updated'
  // §4 — 작업 신고(did/userActions). 본체는 graph_snapshot.agentReports
  | 'agent_report'
  // §4 — 질문 카드. 본체는 graph_snapshot.agentQuestions
  | 'agent_questions'
  // §4 — 검수 요청 카드. 본체는 graph_snapshot.agentReviews
  | 'agent_review'
  // §4 — 번호 목록 정렬 카드. 본체는 graph_snapshot.agentLists
  | 'agent_list'
  // §4 — 피드백(좋아요/싫어요). 본체는 graph_snapshot.agentFeedbacks
  | 'agent_feedback'
  // §5.5 #17-20 ⑩ — 공통 디버그 층 상태/출력(DebugEventPayload). 프로세스 수명이라 graph_snapshot 에 싣지 않는다.
  | 'debug_event'
  // §5.5 #17-32 ⑤ — 훅이 방금 발동했다는 순간 신호. 본체는 HookFiredPayload[] (짧은 창으로 모아 한 건).
  //   세션 수명의 표시 전용 신호라 graph_snapshot 에 싣지 않는다(debug_event 와 같은 규약).
  | 'hook_fired';

/** §5.3 #28 — 콘티 생성/패치 완료 토스트 페이로드(본체는 graph_snapshot). */
export interface ContiEventPayload {
  contiId: string;
  agentId: string;
  /** patch 인 경우만 */
  frameId?: string;
  elementId?: string;
  /** §5.3 #28 (L) — `conti_generated`/`conti_updated` 에만(patch 엔 없다). */
  workId?: string;
}

/** §5.3 #12-3 — `folder` 는 그 아래 전부, `host` 는 하위 도메인까지. */
export type PathLockKind = 'file' | 'folder' | 'host';

/** §5.3 #12-3 — 잠글 대상. `id`·`lockedAt` 은 서버가 짓는다(메뉴·REST 바디가 이 모양으로 보낸다). */
export interface PathLockTarget {
  kind: PathLockKind;
  /** 파일·폴더 = 절대경로(슬래시 모양 · 대소문자 보존), 호스트 = `webHostFromUrl` 모양(소문자 · `www.` 없음). */
  target: string;
  /** 화면에 쓸 이름(버블 라벨). 없으면 `target`. */
  label?: string;
}

/** §5.3 #12-3 — 자물쇠(손으로 건 보호라 체크포인트·`identity.json` 양쪽). `id` = 종류 + 플랫폼 경로 키(`pathLockId`) — 같은 대상은 한 번만. */
export interface PathLock extends PathLockTarget {
  id: string;
  /** 잠근 시각(ms). */
  lockedAt: number;
}

/** §5.3 #12-3 — 닿은 방식(카드가 무엇을 하려는지 말한다). `search` 는 잠긴 곳을 덮는 범위 검색, `shell` 은 경로를 가리키거나 폴더째 다루는 명령. */
export type PathLockAccess = 'read' | 'write' | 'list' | 'search' | 'shell' | 'network';

/** §5.3 #12-3 — 한 호출이 한 자물쇠에 닿은 사실(판정은 shared `findToolLockHits` 한 곳). */
export interface PathLockHit {
  lockId: string;
  kind: PathLockKind;
  /** 자물쇠 대상(경로·호스트). */
  target: string;
  label?: string;
  /** 그 자물쇠를 건 프로젝트(표시 이름). 다른 탭이 건 자물쇠일 수 있다 — 경로는 프로젝트를 가리지 않는다. */
  projectName: string;
  access: PathLockAccess;
  /** 호출 안에서 걸린 경로·주소(정규화한 모양). */
  matched: string;
}

/** §5.3 #12-1 — 권한 승인 요청(서버→클라 브로드캐스트). */
export interface PermissionRequest {
  /** 요청 고유 ID (서버가 발급, UUID) */
  requestId: string;
  /** 요청한 에이전트 ID (Vibisual 관할 subagent id 또는 hook agent id) */
  agentId: string;
  /** §5.3 #12-1 — 호출 sub(env `VIBISUAL_SUBAGENT_ID`) — 결정을 합성할 stream 의 키. 비어 오면(외부 호출) 합성을 건너뛴다. */
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
  /** §5.22 — 위험 판정(`classifyToolRisk`). 있으면 카드에 위험 배지. */
  risk?: AuditRiskKind[];
  /** §5.22 — 모드는 통과시켰을 호출을 감사 경계가 되물었나(카드가 이유를 말한다). */
  escalated?: boolean;
  /** §5.22 — 이 요청이 원장의 어느 줄인지(결정을 그 줄에 적기 위한 키). */
  auditEntryId?: string;
  /** §5.3 #12-1-A — 확인 목록에 넣은 도구라 뜬 카드인가(§5.22 `escalated` 와 같은 자리). 모드가 원래 묻는 호출엔 안 붙는다. */
  askedByTool?: boolean;
  /** §5.3 #12-1-B — [항상 허용]이 적히는 곳(서버가 정한다, 없으면 버튼 없음). session = 런타임 기억(영속 ❌) · codex-tools = 그 묶음(`codexToolGroup`)을 allow. */
  alwaysAllow?: PermissionAlwaysAllowScope;
  /** §5.3 #12-1-B — [항상 거절]이 적히는 곳(없으면 버튼 없음). disallowed-tools 는 확인 목록에서도 뺀다. */
  alwaysReject?: PermissionAlwaysRejectScope;
  /** §5.3 #12-1-B — `codex-tools` 범위일 때 그 도구가 속한 묶음 id(`CODEX_TOOL_GROUPS`). */
  codexToolGroup?: string;
  /** §5.3 #12-3 — 카드를 세운 자물쇠(`PATH_LOCK_CARD_HITS_MAX` 까지). 자물쇠 카드는 무응답 = 거부, [항상 허용] = `unlock` 뿐. */
  lockHits?: PathLockHit[];
}

/** §5.3 #12-1-B — 카드의 답 넷. `decision` 은 서버가 접는다(`allow_*`→allow, `reject_*`→deny). */
export type PermissionChoice = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

/**
 * §5.3 #12-1-B — [항상 허용]이 적히는 자리.
 * §5.3 #12-3 — `unlock` 은 카드를 세운 자물쇠를 그 주인 프로젝트에서 걷는다([잠금 풀고 허용]).
 */
export type PermissionAlwaysAllowScope = 'ask-tools' | 'session' | 'codex-tools' | 'unlock';

/** §5.3 #12-1-B — [항상 거절]이 적히는 자리. */
export type PermissionAlwaysRejectScope = 'disallowed-tools' | 'codex-tools';

/** §5.3 #12-1-B — 답할 곳이 사라져 닫힌 이유. agent-stopped [중지]·[즉시] 덧말로 세션이 멈춤 · caller-gone 기다리던 요청 연결이 닫힘. */
export type PermissionCancelReason = 'agent-stopped' | 'caller-gone';

/** §5.3 #12-1 — 권한 승인 결정(클라→서버 REST 바디 + 서버→클라 broadcast). */
export interface PermissionDecision {
  requestId: string;
  decision: 'allow' | 'deny';
  /** 거부 시 이유 (선택) — UI 에서 입력받아 훅으로 전달, Claude 에게 표시됨 */
  reason?: string;
  /** §5.3 #12-1-B — 고른 답(없으면 `decision` 을 한 번짜리로 — 옛 클라·모바일). 어긋나면 `choice` 가 이긴다. */
  choice?: PermissionChoice;
  /** §5.3 #12-1-B — 아무도 답하지 않고 닫혔다(그때 `decision` 은 `deny`). 서버만 싣는다. */
  cancelled?: PermissionCancelReason;
}

/** §5.3 #12-2 — AskUserQuestion 옵션 한 개. */
export interface AskUserQuestionOption {
  /** 사용자에게 보이는 라벨. 모델에게 답으로 회신될 식별자. */
  label: string;
  /** 라벨 아래 작은 설명 (optional) */
  description?: string;
}

/** §5.3 #12-2 — AskUserQuestion 요청(서버→클라 브로드캐스트). 한 호출에 질문이 여럿일 수 있다. */
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
  /** 질문 batch(claude-code v2.1.145+ `tool_input.questions` 배열) — 카드에서 차례로 답한다. 길이 ≥ 1. */
  items: AskUserQuestionItem[];
  /** 요청 생성 시각 (Date.now()) */
  createdAt: number;
  /** 타임아웃 만료 시각 (서버 계산, UI countdown 용) */
  expiresAt: number;
}

/** §5.3 #12-2 — AskUserQuestion 한 질문의 답. */
export interface AskUserQuestionAnswer {
  /** 고른 라벨(단일 1개·다중 1+). Other 면 입력 문구가 라벨, 타임아웃이면 빈 배열. */
  selectedLabels: string[];
  /** Other 가 아닐 때 supplemental 메모 (optional) */
  note?: string;
}

/** §5.3 #12-2 — AskUserQuestion 결정(클라→서버 REST 바디 + 서버→클라 broadcast). */
export interface AskUserQuestionDecision {
  requestId: string;
  /** request.items 와 1:1 길이/순서 매칭되는 답 배열. timeout 이면 빈 배열. */
  answers: AskUserQuestionAnswer[];
  /** 결정 출처: 사용자 명시 답 / 60s 타임아웃 자동 차단 */
  reason?: 'user' | 'timeout';
}

/** §5.3 #12-2 — AskUserQuestion 질문 한 개. */
export interface AskUserQuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
}

/** §5.3 #12-2 — AskUserQuestion 입력 스키마(claude-code v2.1.145+). 한 호출에 질문이 여럿이라 `questions` 는 배열. */
export interface AskUserQuestionToolInput {
  questions: AskUserQuestionItem[];
}

/**
 * §4 — `claude` 실행본 출처(`resolveClaudeBin()` 경로 패턴). 우선순위: override → managed → native, vscode-extension 은 native 뒤.
 * vscode-extension 은 마켓플레이스 밖에서 못 갱신(자동 업데이트 ❌, 안내만) · path 는 `npm install -g` 로 갱신 · unknown = 설치 온보딩.
 * managed = 앱 전용 엔진(`~/.vibisual/cli-engines/claude`) — 판 전환은 앱이, 자체 갱신은 끈 채 띄운다.
 */
export type ClaudeBinSource = 'native' | 'vscode-extension' | 'path' | 'unknown' | 'managed';

/**
 * §4 (앱 전용 엔진) — 앱이 받아 깔고 판을 맡는 CLI 엔진.
 * 로그인·설정 홈(`~/.claude` · `~/.codex`)은 사용자 것을 그대로 쓰고, 따로 두는 것은 실행 파일뿐이다.
 */
export type ManagedEngineId = 'claude' | 'codex';

/** §4 (앱 전용 엔진) — 앱 전용 폴더에 깔린 판 하나(`versions/<판>/`). 폴더가 진실이라 매번 훑어 만든다. */
export interface ManagedEngineVersionEntry {
  /** 판("2.1.310" · "0.164.0"). */
  version: string;
  /** 그 판의 실행본 절대 경로. */
  binPath: string;
  /** 깐 시각(설치 메타, 없으면 폴더 시각). */
  installedAt: number;
  /** 사용자가 [이전 판으로] 로 물린 판 — 자동 업데이트가 다시 가지 않는다. */
  rolledBack?: boolean;
}

/**
 * §4 (앱 전용 엔진) — 엔진 하나의 앱 전용 사본 상태(화면엔 `ClaudeInstallsInfo.managed`·`CodexSetupState.managed` 로 간다, 새 창구 ❌).
 * 영속 ❌ — 판은 폴더가, 스위치는 `UserDefaults` 가 기억한다.
 */
export interface ManagedEngineStatus {
  engine: ManagedEngineId;
  /** 앱 전용 폴더(`~/.vibisual/cli-engines/<engine>`). */
  root: string;
  /** 지금 쓰는 판 — 아직 안 받았으면 null. */
  active: ManagedEngineVersionEntry | null;
  /** 바로 앞 판(되돌릴 자리) — 없으면 null. */
  previous: ManagedEngineVersionEntry | null;
  /** 깔린 판 전부(새 판 먼저). */
  installed: ManagedEngineVersionEntry[];
  /** 공식 배포처의 최신 판 — 마지막 확인 값. 확인 전·실패면 null. */
  latest: string | null;
  /** 마지막으로 배포처를 확인한 시각(ms). 확인 전이면 null. */
  checkedAt: number | null;
  /** 이 기기의 배포 식별자(Claude `win32-x64` · 코덱스 `x86_64-pc-windows-msvc`). 지원 밖이면 null. */
  platformTarget: string | null;
  /** 받기·대조·점검이 도는 중인가. */
  updating: boolean;
  /** 마지막 실패 사유(받기·대조·점검) — 성공하면 비운다. */
  lastError: string | null;
  /** 마지막 점검에서 떨어진 플래그(있을 때만). */
  failedProbes?: string[];
  /** 자동 업데이트 스위치(`UserDefaults.<engine>AutoUpdate.enabled`, 미설정 = 켬). */
  autoUpdate: boolean;
  /** 받기를 미뤄 둔 이유 — 그 엔진을 쓰지 않는 PC 면 `'not-in-use'`(사용자가 [설치]를 누르면 받는다). */
  deferred?: 'not-in-use';
  /** 받기가 오류로 끝나 다시 해 볼 시각(ms) — 예약이 있을 때만(`MANAGED_ENGINE_RETRY_BACKOFF_MS`). */
  nextRetryAt?: number;
}

/** §4 (앱 전용 엔진) ④ — 코덱스 실행본 출처: `managed` = 앱 전용 사본(기본) · `standalone` = 공식 독립 설치(install.ps1/sh) · `path` = PATH(npm 전역 등). */
export type CodexBinSource = 'managed' | 'standalone' | 'path';

/** Version 탭 코덱스 칸의 설치본 한 줄 — Claude 의 `ClaudeInstall` 과 같은 모양. */
export interface CodexInstall {
  binPath: string;
  source: CodexBinSource;
  /** `codex --version` 으로 확인한 판 — 못 읽었으면 null. */
  version: string | null;
  detectError?: string;
  /** 지금 이 실행본이 쓰이는가. */
  active: boolean;
  /** 사용자가 보조로 고른 실행본인가(`UserDefaults.codexBinPath`). */
  selected: boolean;
}

/** `GET /api/codex-installs` — 코덱스 칸의 고르기 목록. */
export interface CodexInstallsInfo {
  installs: CodexInstall[];
  /** 사용자가 고른 경로(`UserDefaults.codexBinPath`) — 없으면 null(= 기본). */
  overridePath: string | null;
  managed?: ManagedEngineStatus;
  scannedAt: number;
}

/**
 * §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 판정(글로벌 1건). 로그인 팝업은 `error` 면 안 뜨므로 CLI 가 없는 사람에겐 이것이 유일한 안내다 —
 * `missing` 이면 권장형 설치 게이트(차단 ❌, 닫으면 상단 배너). 영속 ❌ — 디스크로 아는 기기 값이라 `ProjectCheckpoint` 밖이다.
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
  /** 자동 설치를 시도할 수 있는 플랫폼(win32/darwin/linux)인가. false 면 게이트가 [설치하기] 대신 수동 명령만 보인다. */
  canAutoInstall: boolean;
  /** 자동 설치가 실행할 공식 인스톨러 명령(플랫폼별). 화면의 "직접 설치" 안내와 실제 spawn 이 같은 문자열이어야 해서 서버가 조립한다. */
  installCommand: string;
  /** 공식 설치 문서 URL — 자동 설치가 막혔을 때의 탈출구. */
  docsUrl: string;
  /** 마지막 판정 시각(Date.now()). */
  checkedAt: number;
  /** `phase==='failed'` 일 때 사람 읽기용 원인. */
  error?: string;
}

/** §4 — 네이티브 인스톨러 진행 상황. WS `claude_setup_progress` + REST 동기 응답 겸용(§5.7 #23-1 `ClaudeInstallProgress` 와 같은 in-flight 패턴). */
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

/** §5.7 #23-1 — CLI 현재/최신 버전 비교(`claudeVersionService` 발급, `GET /api/claude-version`). */
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

/** §5.7 #23-1 — `npm install -g @anthropic-ai/claude-code` 진행. WS `claude_install_progress` + REST 동기 응답 겸용. */
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

/** §4 — 발견된 `claude` 설치본 하나(Version 탭 목록 항목). `discoverAllClaudeBins()` 가 후보(VS Code 변종 확장·PATH·알려진 위치)를 realpath 로 겹침 제거하고 각각 `--version` probe 한다. */
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

/** §4 — `GET /api/claude-installs` = Version 탭 전체 데이터. 하드코딩 없이 전부 런타임(probe·package.json·process·npm registry). */
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
  /** §4 (앱 전용 엔진) — Claude Code 앱 전용 사본의 상태(Version 탭 "앱 전용" 칸). */
  managed?: ManagedEngineStatus;
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
 * §9 스코프드 구독 — 클라→서버: 이 창이 지금 필요한 프로젝트(메인 창은 활성 탭, Command Center(§5.12 A)는 따라가기/고정 대상). 서버는 합집합만 무거운 슬라이스에 담는다.
 * ⚠ 어기면 기능이 깨진다: ① 아무도 선언하지 않았으면 전부 보낸다(침묵 ≠ 축소) ② 범위 밖도 탭·전역 집계(`projects`/`stubProjects`/`activeAgentCount`)는 흐른다 ③ 값은 표시명이지 경로가 아니다.
 */
export interface SetProjectScopePayload {
  /** 이 창이 필요한 프로젝트 표시명 목록. 빈 배열 = "지금은 아무것도 안 본다"(탭 0개). */
  projects: string[];
  /**
   * §9 폴더 스코프 — 이 창이 열어 둔 폴더의 내비 경로(조상 → 현재, 노드 id). 폴더 밖이면 빈 배열. 프로젝트 축과 늘 함께 바뀌어 한 메시지(한 왕복)에 싣는다.
   * ⚠ optional 이 계약이다 — 안 보내는 창(구버전)이 하나라도 있으면 폴더 범위를 적용하지 않는다(= 전량). 침묵을 축소로 읽으면 그 창의 폴더가 빈 채로 굳는다.
   */
  folders?: string[];
  /**
   * §9 슬라이스 스코프 — 이 창이 읽는 `SliceScopeGroup` 이름(뜻·목록은 `sliceScope.ts` 소유, 전선 값이라 서버가 `isSliceScopeGroup` 으로 거른다). 서버는 합집합만 싣는다.
   * ⚠ optional 이 계약이다(`folders` 와 같은 규칙) — 안 보내는 창이 있으면 전량(침묵을 축소로 읽으면 그 창 데이터가 영영 안 온다). `[]` 은 "하나도 안 읽는다"는 유효한 선언이다.
   */
  slices?: string[];
}

// ─── §7.11 Iframe 서버 로그 스트리밍 ───

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

/** 클라→서버 dev server 로그 구독. 스트림 키는 `(shellId, port)` — 같은 포트(예: Vite 5173)라도 셸이 다르면 갈린다(§7.11). `shellId` 미상(레거시 위성)이면 `port` 만. */
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

// ─── §7.7 서버 코어 로그 스트리밍 ───

/** `IframeLogLevel` 과 달리 추론이 아니라 `logger.*` 호출이 준 정확한 레벨 — undefined 없음. */
export type ServerLogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * §7.7 — ServerLogPopup 배지·필터 축. 캡처 때 `level`+메시지 패턴으로 1회 판정: `error`/`warn` = level 그대로 · `hook` = 훅 수신·처리 · `event` = 그 외.
 * 분류를 늘리면 `serverLogService` 분류기 패턴도 함께 고친다.
 */
export type ServerLogCategory = 'error' | 'warn' | 'hook' | 'event';

/** 서버 코어 로그 한 줄. `serverLogService` 가 모든 `logger.*` 호출을 ring buffer(`SERVER_LOG_BUFFER_MAX`)에 모은다 — 영속 ❌. */
export interface ServerLogEntry {
  /** monotonic seq (서버 전역 증가) — 클라 dedupe/순서 보장 + 리스트 key. */
  seq: number;
  /** epoch ms */
  ts: number;
  level: ServerLogLevel;
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
 * 앱 전역 상태(`~/.vibisual/app-state.json`) — 프로젝트 탭 라이프사이클 SSOT(§3.2 / §3.5 / §5.7 #24).
 * 프로젝트 키는 전부 정규화 절대경로(projectId) — basename 을 키로 쓰면 같은 이름 다른 경로가 한 슬롯을 공유해 한쪽이 사라진다. 표시 이름은 basename(비식별).
 * 부팅: `openProjects` 만 stub 등록 → `lastActiveProject` hydrate(무효면 `defaultProject`). `pinnedProjects` 는 Close Others/Right/All 에서 뺀다.
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
  /** projectId → 표시 이름 캐시. hydrate 전(project.json 을 못 읽을 때) 탭 라벨용 — 식별엔 쓰지 않는다. 키는 `ProjectInfo.path` 포맷, 값은 basename(중복 가능). `registerProject` 때 갱신. */
  projectNames?: Record<string, string>;
  /**
   * @deprecated v1.63 이전: 이름 → 절대경로 매핑. 부팅 마이그레이션 입력으로만 1회 읽고 더는 쓰지 않음.
   */
  projectPaths?: Record<string, string>;
  /**
   * §5.5 #17-4 — SkillsView 고정 순서(type 별 스킬명 배열, 머신 단위). 없는(새) 스킬은 기본 정렬(count desc → name asc)로 뒤에 붙고, 한 번 끌면 그 타입의 가시 순서 전체를 저장한다.
   * §5.5 #17-5 — `global` = `~/.claude/skills/`·`~/.claude/commands/`(모든 프로젝트 공통).
   */
  skillOrder?: { project?: string[]; global?: string[]; plugin?: string[] };
  /** §5.5 #17-4 — SkillsView 즐겨찾기(머신 단위, 출처와 무관한 스킬명 키). 별 누른 순서로 최상단 "Favorites" 에 그리고 출처 그룹에서 뺀다. */
  skillFavorites?: string[];
  /** §5.5 #17-33 ⑦ — Claude Code 플러그인 자동 갱신 설정 + 마지막 결과. 머신 단위(마켓 클론 `~/.claude/plugins` 은 하나뿐). 없으면 `CLAUDE_PLUGIN_REFRESH_DEFAULTS`. */
  claudePluginRefresh?: ClaudePluginRefreshState;
  /** §3.2.3 보존 정책. 머신 단위(정리는 부팅 때 모든 프로젝트에 일괄). 없으면 `DEFAULT_RETENTION_SETTINGS`. */
  retention?: RetentionSettings;
  /** §5.3 #9-1 — 토큰 절약 설정(머신 단위). 없으면 `DEFAULT_TOKEN_SAVER_SETTINGS`(전 축 끔). */
  tokenSaver?: TokenSaverSettings;
  /** §5.5 #17-9 ⑭(g) — 표식 없이 조용한 백그라운드 작업을 스스로 판정할지(머신 단위). 없으면 `DEFAULT_BG_TASK_PROBE_SETTINGS`. */
  bgTaskProbe?: BackgroundTaskProbeSettings;
  /** §2.4 — "실행중…"이 진짜인지 에이전트에게 물어 확인할지(머신 단위). 없으면 `DEFAULT_SESSION_PROBE_SETTINGS`. */
  sessionProbe?: SessionLivenessProbeSettings;
  /** §4 API 크레딧 — 사용 설정·OS 보안 저장소로 암호화한 두 키(실행용·지출 읽기용)·Anthropic 거절 기억(머신 단위). 금액은 담지 않는다(Console 이 센다). 없으면 꺼짐(`API_CREDIT_DEFAULTS`). */
  apiCredits?: ApiCreditPersisted;
  /** §5.3 #9-2 — 에이전트가 띄운 프로세스의 묶음·메모리 상한·정리(머신 단위). 없으면 `DEFAULT_PROCESS_GUARD_SETTINGS`(켬). */
  processGuard?: ProcessGuardSettings;
  /** §2.1 (B) — 최상위에 동시에 세울 외부 폴더 예산(머신 단위). 없으면 `EXTERNAL_TOP_BUDGET_DEFAULT`(=12). 핀은 세지 않는다. */
  externalTopBudget?: number;
  /** §5.23 — 종전 "에이전트마다 웹 버블 하나로 접기". 읽기만 한다: `webGroup` 이 저장된 적 없고 이 값이 `true` 면 `webGroup.maxPerAgent = 1` 로 이주. 새로 쓰지 않는다. */
  webFoldPerAgent?: boolean;
  /**
   * §3.6 「수명」 · §5.7 #24-3 — 사용량 수집기(`statusLine`·`subagentStatusLine`)를 켜 두었는가. 앱을 끌 때 원래 상태 줄로 되돌리므로 `settings.json` 으로는 알 수 없어 여기 기억한다.
   * 없으면 첫 부팅에 지금 깔려 있는지로 옮겨 적는다.
   */
  usageCollector?: boolean;
  /**
   * §3.6 「수명」 · §5.25 (I) — 코덱스 전역 훅(앱 밖 코덱스 세션 표시)을 켜 두었는가. 끌 때 `hooks.json` 의 우리 항목을 걷으므로 파일로는 알 수 없다.
   * 없으면 첫 부팅에 지금 깔려 있는지로 옮겨 적는다.
   */
  codexHooks?: boolean;
  /** §5.23 웹 버블 묶기 — 같은 사이트 · 비슷한 종류 · 에이전트마다 최대 N개(머신 단위). 없으면 `WEB_GROUP_DEFAULTS`(켬), 종전 `webFoldPerAgent: true` 만 있으면 최대 1개. */
  webGroup?: WebGroupSettings;
  /** §5.23 「더블클릭」 — 도메인 버블 더블클릭이 마지막 주소를 여는 곳(머신 단위). 없으면 `WEB_OPEN_TARGET_DEFAULT`(바깥 브라우저). */
  webOpenTarget?: WebOpenTarget;
  /** §6 — 사용자가 바꾼 단축키만(머신 단위). 안 건드린 칸은 없고 `defaultKeymap()` 을 따른다. `null` = 해제(키보드에서 내림) — 키 삭제(기본값으로 되돌림)와 다르다. */
  keymap?: KeymapOverrides;
  /** §5.5 #16-1 — IDE 좌측 활동바 구성(순서 + 내려놓은 항목). 머신 단위(`keymap` 과 같은 결). 없으면 기본 순서로 전부 보인다. */
  ideActivityBar?: IDEActivityBarPrefs;
  /** §5.4 #14-4 — 최근에 닫은 탭(최신이 index 0). `openProjects` 등 탭 여닫기 상태와 같은 축이라 여기 산다 — 닫은 탭은 어느 프로젝트의 것도 아니다. 없으면 빈 목록. */
  recentlyClosedTabs?: ClosedTabEntry[];
  /** 마지막 업데이트 타임스탬프 (epoch ms). */
  updatedAt: number;
}

/** §5.5 #16-1 — IDE 활동바 배치. **서버는 항목 이름을 모른다** — 문자열 배열만 담고 뷰 목록·기본 순서는 클라 `ideActivityItems.ts` 소유(`skillOrder` 와 같은 규약). 항목을 늘려도 서버를 안 고치게. */
export interface IDEActivityBarPrefs {
  /** 사용자가 끌어 만든 순서(뷰 이름). 여기 없는(새) 항목은 버리지 않고 기본 순서 자리에 끼운다 — 늘어난 칸이 조용히 사라지면 안 된다. */
  order?: string[];
  /** 내려놓은 항목 — 지운 게 아니라 접은 것(구성 패널 "제외됨" 칸에서 도로 올린다). */
  hidden?: string[];
}

/**
 * §5.4 #14-4 — 닫은 탭 한 건. 프로젝트·iframe 탭을 한 스택에 섞는다 — 나누면 "가장 최근"이 둘이 되어 Ctrl+Shift+T 가 무엇을 열지 모른다.
 * ⚠ 분리(detach)는 닫기가 아니다(§5.4 #14-1 (F)) — 별창 탭은 들어오지 않는다(`detachedTabKeys` 는 표시 라우팅, 이 스택은 `hiddenProjects` 진입의 짝).
 */
export interface ClosedTabEntry {
  /** 탭바 키와 같은 형식(`p:<표시명>` · `i:<탭 id>`). 같은 탭을 두 번 닫으면 최신 1건만 남기는 중복 제거 키이기도 하다. */
  key: string;
  kind: 'project' | 'iframe';
  /** 메뉴에 그릴 이름(프로젝트 표시명 · iframe 라벨). */
  label: string;
  /** 닫은 시각(epoch ms). 정렬 + "몇 분 전" 표시. */
  closedAt: number;
  /** `kind: 'project'` — 되열 때 `registerProject` 에 넘길 절대경로(projectId). 표시명을 쓰면 같은 basename 다른 경로가 한 슬롯을 공유한다. */
  path?: string;
  /** `kind: 'iframe'` — 되열 때 그대로 복원할 주소. */
  url?: string;
  /** `kind: 'iframe'` — 되열 때 그대로 복원할 서버 종류(탭 배지 색). */
  serverKind?: ServerKind;
  /**
   * `kind: 'iframe'` — 그 프리뷰를 연 프로젝트의 절대경로. 되연 탭도 이 프로젝트 기준으로 소속을 물어, 그 사이 다른 프로젝트 서버가 주소를 잡았으면 열지 않는다(§7.11 / §3.5).
   * 없으면(옛 항목) 위성 id 로만 찾는다.
   */
  projectPath?: string;
}

/**
 * §7.11 / §3.5 — 프리뷰 탭이 그 주소를 지금 보여도 되는가(`GET /api/iframe-tab-check`). 탭 목록은 공유되는데 스냅샷은 구독 프로젝트만 실어 클라가 판정할 수 없다.
 * `show` = 그대로(판정 불가도 막지 않는다) · `follow` = 대신 `url` 을 연다(위성 이동·같은 포트 별칭) · `block` = 다른 열린 프로젝트의 서버에 닿는다 — 열지 않는다.
 */
export type IframeTabVerdict =
  | { action: 'show' }
  | { action: 'follow'; url: string }
  | { action: 'block' };

/** AppState 부분 업데이트 페이로드 — PATCH /api/app-state 요청 본문. `updatedAt`은 서버가 채움. */
export type AppStatePatch = Partial<Pick<AppState, 'lastActiveProject' | 'defaultProject' | 'pinnedProjects' | 'openProjects'>>;

// ─── 보존 정책 (§3.2.3) ───

/**
 * 저장 데이터 보존 설정(전부 사용자가 조절). **`0` = 그 축은 정리하지 않음(무제한)** — 정리만 끄고 기록은 계속한다.
 * Claude Code 는 정리를 끌 수 없게 했고(#59248·#64999) `cleanupPeriodDays: 0` 이 저장까지 꺼 버렸다(#23710) — 둘 다 피한 규약이다.
 */
/** §5.3 #9-1 — 토큰 절약 프리셋. 값을 채우는 손일 뿐 — 진실은 값이고 한 칸이라도 손대면 `custom`. 이 문자열로 동작을 가르지 마라. */
export type TokenSaverPreset = 'off' | 'balanced' | 'saver' | 'custom';

/** §5.3 #9-1 — 토큰 절약 설정(머신 단위 · `AppState.tokenSaver`) — 스폰 정책이라 체크포인트가 아니다. 숫자 축의 `0` 은 "그 축 끄기"(무제한, §3.2.3 규칙 1). */
export interface TokenSaverSettings {
  /** 지금 걸린 프리셋(표시 전용). 값과 어긋나면 `custom` 으로 내려온다. */
  preset: TokenSaverPreset;
  /** (J) Bash 출력 문자 상한 → `BASH_MAX_OUTPUT_LENGTH`. 0 = 끔(CLI 기본 30,000). */
  bashMaxOutputChars: number;
  /** (J) MCP 출력 토큰 상한 → `MAX_MCP_OUTPUT_TOKENS`. 0 = 끔. */
  mcpMaxOutputTokens: number;
  /** (K) 한 턴 출력 토큰 상한 → `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. 0 = 끔. */
  maxOutputTokens: number;
  /** (K) 사고 토큰 상한 → `MAX_THINKING_TOKENS`. 0 = 끔. */
  maxThinkingTokens: number;
  /** (L) 자동 압축 발동 점유율(%) → `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. 0 = 끔. */
  autoCompactPct: number;
  /** (M) 제목·요약용 비필수 배경 모델 호출을 끌지 → `DISABLE_NON_ESSENTIAL_MODEL_CALLS`. */
  disableNonEssentialModelCalls: boolean;
  /**
   * (Q) 자동 압축 창을 이 값까지 조인다. `''` = 미설정. 실측(2026-09-11): 200k 넘는 구간이 입력 토큰의 62% — 400k → 200k 면 입력 27%, 100k 면 59% 준다(압축 비용 별도).
   * ⚠ 조이는 방향으로만 — 설정 창·에이전트가 더 작은 값이면 그쪽이 이긴다. 값은 `AVAILABLE_AUTOCOMPACT_VALUES` 안이어야 한다(밖이면 정규화가 `''` 로 — 잘못된 값은 스폰을 죽인다).
   */
  autoCompactWindow: string;
  /** (N) 동시에 턴을 처리하는 세션 수. 0 = 무제한. 넘친 명령은 버리지 않고 큐에서 기다린다. 사람이 직접 치는 CMD(PTY) 세션은 세지 않는다. */
  maxConcurrentAgents: number;
  /**
   * (O) 첫 스폰(세션 없는 명령) 사이 최소 간격(ms). 0 = 끔. 동시에 뜬 새 세션은 서로의 접두 캐시를 못 타 각자 `cache_write`(입력가 1.25배)를 낸다
   * (실측: 서브에이전트 호출당 주 대화의 26배). `--resume` 턴은 대상이 아니다.
   */
  spawnStaggerMs: number;
  /** (P) 한 세션이 이 턴 수를 넘기면 다음 명령 앞에 `/compact` 를 한 번 넣는다(새 세션은 강제하지 않는다). 0 = 끔. 압축 자체가 큰 요청이라 하한(`TOKEN_SAVER_LIMITS`)을 둔다. */
  sessionTurnBudget: number;
}

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
   * sub-streams jsonl 보존 일수(0=무제한). ⚠ 살아 있는 서브에이전트와 아카이브된(닫아서 "다시 열기"에 남은) 서브에이전트는 나이와 무관하게 보존한다 —
   * 빼면 목록을 눌렀을 때 빈 화면이 된다(§3.2.3 규칙 2).
   */
  subStreamRetentionDays: number;
  /** 첨부 파일 보존 일수(0=무제한). ⚠ 삭제 후보는 고아(참조 0)뿐 — 참조되는 첨부는 나이와 무관하게 보존한다(붙여넣은 스크린샷은 유일본). */
  attachmentRetentionDays: number;
  /** §5.22 감사 원장이 프로젝트당 보관하는 줄 수(0=무제한). 잘린 줄은 `retired` 합계로 접혀 집계는 줄지 않고 내역만 사라진다. `AUDIT_SNAPSHOT_ENTRIES` 보다 크게 두면 화면 변화가 없다. */
  auditEntryMaxPerProject: number;
  /** 휴지통 보존 일수 — 정리로 옮긴 파일을 며칠 두었다가 지운다(0=안 지움). 자동 정리도 되돌릴 수 있게 하는 축(§3.2.3 규칙 3). */
  trashRetentionDays: number;
  /** §5.26 — 압축 마커·파일 사본 보존 일수(0=무제한). 살아 있는 세션의 마커와 참조되는 blob 은 나이와 무관하게 보존한다(§3.2.3 규칙 2). */
  insuranceRetentionDays: number;
  /** §5.26 (A) — 보험 저장고의 프로젝트당 최대 MB(0=무제한). 넘치면 미러부터 LRU 로 버리고 마커는 남긴다(수백 바이트이고, 마커만으로 옛 JSONL 복구가 된다). */
  insuranceVaultMaxMB: number;
  /** §5.26 (B) — 트랜스크립트 미러를 뜰지(끄면 마커만). 미러는 원본 JSONL 이 사라졌을 때(`cleanupPeriodDays` 정리·사용자 삭제)의 유일한 답 — 기본 켬, 위 예산 안에서. */
  insuranceMirror: boolean;
}

/** 정리 기록 한 줄(무엇을 언제 왜 옮겼나, §3.2.3). 기본이 휴지통 이동이라 곧 복원 후보 목록이다. */
export interface RetentionLogEntry {
  /** 기록 시각(epoch ms). */
  at: number;
  /** 어느 갈래였는지 — 저장소 사용량 화면의 갈래와 같은 어휘를 쓴다. */
  kind: Extract<StorageUsageKind, 'subStreams' | 'attachments' | 'insurance'>;
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
  /** §5.26 저장고 — 프로젝트 폴더에 우리가 쓰는 것 중 **가장 커질 수 있는** 물건이라 따로 세운다. */
  | 'insurance'
  /** §5.10 — 자동 목표가 굳힌 절차(`.vibisual/skills`). 폐기된 `.vibisual/brain` 도 이 칸에서 센다 — 빼면 총합이 까닭 없이 줄고, 옛 스킬을 아직 읽는 자리다. */
  | 'skills'
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

/** 워크트리 사용량 — 자동 삭제 대상이 아니다. 사용자 산출물이 섞일 수 있어 보여 주고 사용자가 고른다(§3.2.3). */
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
  /** 원래 자리에서 치운 파일 수 — 기본이 휴지통 이동이라 영구 삭제가 아니다(영구분은 `purgedFiles`). 화면에 "정리됨"으로 읽히는 축이라 이름을 유지한다. */
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
  /** 참조가 남아 나이와 무관하게 보존한 파일 수(0 = 후보가 없었다). */
  keptReferenced?: number;
}

/** boot 시 메타만 로드, hydrate 시 채워짐 */
export interface ProjectMetaSnapshot {
  project: ProjectInfo;
  lastSavedAt: number;
  createdAt: number;
  /** `<projectPath>/.vibisual/save/checkpoint.json` 절대경로 — lazy load 용. */
  checkpointPath: string;
  /** discriminator — 항상 false. hydrated 인스턴스와 union 분기에 사용 */
  isHydrated: false;
  /** §3.2.1-4 — 부팅 hydrate 실패로 읽기 전용 격리된 stub. 자동 저장 동결 + 빈 인스턴스 생성 거부. */
  readOnly?: boolean;
  /** 격리 사유(디버그/UI 표기용). */
  readOnlyReason?: 'load-error';
}

/** 에이전트 전체 상태 (서버에서 계산, 클라이언트는 읽기만) */
export type AgentPhase = 'waiting' | 'working' | 'completed';

/** 세션을 감지한 층: `hook`(초록, SessionStart — PID/cwd 완전) · `jsonl`(노랑, 훅 미설치 폴백) · `process`(회색, tasklist/pgrep — 최후 수단). */
export type SessionSource = 'hook' | 'jsonl' | 'process';

/** `active` = 최근 활동(펄스) · `idle` = 30초 이상 무활동(반투명). `dead` 는 제거되므로 스냅샷에 없다. */
export type SessionLifeStatus = 'active' | 'idle';

/** 그래프 스냅샷 — 클라이언트 초기 연결 시 전체 상태 전달 */
/**
 * §4 — 에이전트 작업 신고(커스텀/스폰 전용). did·userActions 를 완료 때 loopback `POST /api/agent-report` 로 보내고(§5.3 #10-2 curl 패턴) IDE 가 색 구분 카드로 그린다.
 * Hook 에이전트는 rules 를 우리가 통제하지 않아 신고 지시가 안 들어가므로 텍스트 렌더만. `agentId` 가 1차 렌더 필터 키.
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
  /** §5.10 — 이 작업에서 배운 것(확실한 것만, 최대 3개). 서버가 문장마다 `brainService.saveCard({type:'lesson', scope:'agent'})` 로 기억 카드에 저장한다. */
  learned?: string[];
  /** §5.10 — 브리핑으로 받은 카드 중 도움된 id(`[card-xxxx]` 그대로). 서버가 `brainService.markHelpful` 로 랭킹을 올린다. */
  helpfulMemoryIds?: string[];
  /**
   * §5.10 — `helpfulMemoryIds` 의 대칭: 지금 코드와 어긋나 낡은 카드 id. `brainService.markStale` → `needs-check`, 누적이 문턱을 넘으면 자동 보관(삭제 ❌).
   * 확인 필요 카드가 helpful 로 오면 앵커를 현재 해시로 갱신하고 `ok` 로 되돌린다.
   */
  staleMemoryIds?: string[];
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/* §5.10 — 기억 카드 타입은 기억·브레인 축과 함께 걷었다. 되풀이를 절차로 굳히는 일은 `AutoGoalCandidate`·`AutoGoalSkillSummary`·`AutoGoalSummary` 가 맡는다(파일이 원본, 상태 기계 없이 횟수 문턱만). */

/** §4 — 질문 카드의 질문 하나: 자연어 질문 + 제안 응답 프롬프트(0~N). "즉시 전송"은 그 프롬프트를 해당 세션에 새 명령으로 보낸다. */
export interface AgentQuestionItem {
  /** 질문 본문 (자연어). */
  question: string;
  /** 선택: 짧은 헤더 라벨 (질문 요지). */
  header?: string;
  /** 제안 응답 프롬프트 — 카드의 본체라 규칙은 질문마다 2~4개를 요구한다. 빈 배열도 받는다(옛 카드·규칙 위반) — 그때는 접힌 직접 입력만 남는다. */
  prompts: string[];
}

/**
 * §4 — 에이전트 질문 신고(커스텀/스폰 전용). AgentReport 골격 — 작업 끝에 loopback `POST /api/agent-questions`(토큰 인증).
 * AskUserQuestion(선택지 + 60초 동기 hold)과 별개인 비차단 카드 — 제안 프롬프트를 복사하거나 "즉시"로 새 명령을 보내 답한다. `agentId` 가 1차 필터 키.
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

/** §4 — 에이전트 검수 요청(커스텀/스폰 전용, `POST /api/agent-review`, 토큰 인증). 할 일(`userActions`)이 아니라 마친 작업의 결과가 맞는지 확인을 청하는 카드. `agentId` 가 1차 필터 키. */
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
  /** §5.16 — 리뷰·승인 레인 레코드(`ReviewRequest.id`). 서버가 격리 변경분을 붙잡아 만든 카드에만 있고, 있으면 파일 목록·diff·승인/반려/보류를 함께 그린다. */
  reviewRequestId?: string;
  /** 자유 메모 / 전체 맥락 한 줄 (선택). */
  note?: string;
  /** 신고 시각 (서버 stamp, Date.now()). */
  createdAt: number;
}

/** §4 — 번호 목록 카드(커스텀/스폰 전용, `POST /api/agent-list`, 토큰 인증). 나열·체크리스트·단계를 본문 대신 배열로 보내면 IDE 가 번호를 매겨 정렬한다 — 항목 텍스트만 보낸다. */
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

/** §4 — 피드백 평가값(좋아요/싫어요). */
export type AgentFeedbackVerdict = 'up' | 'down';

/** §4 — 피드백 대상: report=작업 신고, review=검수 요청, result=스트림 턴 완료 메시지. */
export type AgentFeedbackTargetType = 'report' | 'review' | 'result';

/**
 * §4 — 작업 결과에 대한 사용자 좋아요/싫어요. targetId 별 upsert(재평가 = 교체, 철회 = 제거). `summary` 는 평가 시점의 대상 스냅샷이라 카드가 ring buffer 에서 밀려나도 남는다.
 * 되먹임: ① 매 스폰 턴 `buildAgentFeedbackBlock` 주입 ② distill → 사용자 승인 시 `AgentConfig.rules` append. 작업·판정 로직과 무관하다.
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

/** §9 — 프로젝트별 에이전트 집계(탭 배지 전용). 구독 범위가 좁아도 이것만은 항상 전 프로젝트. */
export interface ProjectAgentCounts {
  /** 살아 있고 숨김·휴지통이 아닌 에이전트 수. 휴지통 버블은 캔버스가 안 그리므로 숫자에서도 뺀다(화면에 없는 분모가 생긴다). */
  total: number;
  /** 그중 status==='active' */
  active: number;
  /** 그중 status==='completed' */
  completed: number;
  /** 그 에이전트들의 세션 수(IDE 탭 · sub 버블). 세션 없는 버블은 1 로 친다 — 아니면 훅 에이전트가 숫자에서 사라진다. */
  sessions: number;
  /** 그중 도는 세션 수(`isSessionRunning`). 버블 수 `active` 와 다르다 — 한 버블에서 다섯 세션이 돌면 `active=1`, `running=5`. */
  running: number;
  /**
   * §2.4 — 그중 요금제 한도로 끊긴 채 다시 돌지 않은 세션 수(`running` 과 겹치지 않음). 헤더 배지가 이 수로 주황불을 켠다 — 끝난 게 아니라 멈춘 것.
   * 옛 스냅샷엔 없어 `?? 0` 으로 읽는다.
   */
  limited: number;
}

export interface GraphSnapshot {
  /** hydrated 프로젝트 목록 (projectName → ProjectInfo). keys와 stubProjects keys는 겹치지 않음 */
  projects: Record<string, ProjectInfo>;
  /** §9 — 프로젝트별 에이전트 집계(projectName → 수). 구독 범위와 무관하게 항상 전 프로젝트(탭바 배지의 SSOT). 없으면(구버전) 클라가 `agents` 로 센다. */
  projectAgentCounts?: Record<string, ProjectAgentCounts>;
  /**
   * §9 — 이 스냅샷에 실제로 적용한 구독 범위(표시명). `undefined` = 전량(선언한 창 없음 · 구버전 서버).
   * 클라가 "아직 안 온 것"과 "원래 빈 것"을 가르는 데 쓴다 — 없으면 탭을 옮긴 직후 빈 캔버스가 "빈 프로젝트"로 보인다. 판정은 `canvasLoading.ts` 단독 소유.
   */
  scopedProjects?: string[];
  /**
   * §9 — 이 스냅샷에 적용한 폴더 범위(창 선언의 합집합). `undefined` = 전량. 있으면 `children`/`innerEdges`·폴더 위성은 그리는 폴더와 한 칸 앞만 실린다.
   * 쓰임은 `scopedProjects` 와 같다. 실제 싣는 집합은 더 넓어도 되돌리는 것은 **선언 그대로**다(클라가 묻는 것은 "내 폴더를 알고 만들었나" 하나).
   */
  scopedFolders?: string[];
  /**
   * §9 — 이 스냅샷이 실어 온 스코프 대상 슬라이스. `undefined` = 전량. 있으면 `SCOPABLE_SLICE_KEYS` 중 여기 없는 것은 "아직 안 온 것"이라 클라가 직전 값을 이어받는다(§9 ⑥ · `carryForwardScopedSlices`).
   * **필수** — 없으면 클라의 `?? {}` 폴백이 걸려 데이터가 날아간 것으로 보인다.
   */
  scopedSlices?: string[];
  /** §9 — 범위와 무관하게 전량으로 잰 파일 버블 크기 척도(바이트). 받은 스냅샷에서 재면 폴더를 드나들 때마다 크기가 바뀐다. 없으면(구버전) 클라가 잰다. */
  fileSizeRange?: { min: number; max: number };
  /** §9 — 전량으로 잰 §5.24 히트맵 척도(표시명 → 최대 `readCount`, 바닥은 늘 0). 없으면 클라가 잰다. */
  readCountMaxByProject?: Record<string, number>;
  /** §5.24 — 쓰기 축 척도(표시명 → 최대 `writeCount`). 축마다 따로 잰다 — 한 자를 쓰면 읽기가 큰 세션에서 쓰기 지도가 통째로 차갑게 눌린다. */
  writeCountMaxByProject?: Record<string, number>;
  /**
   * §5.24 `quantile` 곡선용 읽기 분포 표본(표시명 → 오름차순 `HEAT_QUANTILE_BINS + 1` 칸). 전량으로 잰다 — 좁혀 재면 폴더를 드나들 때마다 색이 바뀐다.
   * 등간격 표본인 것은 §9 전선 부피 규약(33칸이면 보간으로 충분). 없으면 기본 곡선.
   */
  readCountQuantilesByProject?: Record<string, number[]>;
  /** §5.24 — 위와 한 쌍인 **쓰기 축** 분포 표본. 축마다 따로 재는 이유는 최대값 쪽과 같다. */
  writeCountQuantilesByProject?: Record<string, number[]>;
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
  /** 도메인 버블별 웹 이력(domain node ID → 최신순, §5.23). 키가 노드 ID 인 것은 `fileEdits` 와 같은 규약. */
  domainEntries: Record<string, WebEntry[]>;
  /** 에이전트별 명령 대기열 (agent ID → queued/executing만, 서버가 관리) */
  commandQueues: Record<string, QueuedCommand[]>;
  /** 에이전트별 완료/에러 명령 아카이브 (agent ID → completed/error, Results 표시용) */
  completedCommands: Record<string, QueuedCommand[]>;
  /** 에이전트별 subagent 목록 (agent ID → SubAgent[]) */
  subAgents: Record<string, SubAgent[]>;
  /** §5.5 #17-9 — 백그라운드에서 도는 서브에이전트(부모 agentId 키). §5.3 #12-1 대차대조의 투영이라 런타임 전용(영속 ❌). 비면 필드가 생략돼 활동바 항목/배지가 사라진다. */
  runningSubagentTasks?: Record<string, RunningSubagentTask[]>;
  /** §5.5 #17-9 ⑦(b) — 방금 끝난 백그라운드 서브에이전트(부모별 최근 5건, 새 것이 앞). 결과(`tool_response`)는 늦게 붙는다. 런타임 전용 — 배지 산식에 관여하지 않는다(⑦(c)). */
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
  /** 언리얼 블프 스타일 Comment Box(메인 캔버스 전용). 클라가 `projectName === activeProject` 로 거른다. */
  commentBoxes?: CommentBox[];
  /** §5.5 #17-20 ⑩ — 프로젝트별 중단점. 세션 없이도 남는 사용자 표식이라 스냅샷·체크포인트를 탄다. 없으면 빈 맵. */
  debugBreakpoints?: Record<string, DebugBreakpoint[]>;
  /** §5.9 캡처 버블(전체 프로젝트). 클라가 `projectName === activeProject` 로 거른다. */
  captureBubbles?: CaptureBubble[];
  /** §5.13 — 내부 앱 버블. `projectName` 으로 거른다. */
  appBubbles?: AppBubble[];
  /** §5.14 — 플레이 버블. `projectName` 으로 거른다. */
  playBubbles?: PlayBubble[];
  /** §5.15 — 스펙 보드 목록. `projectName` 으로 걸러 렌더한다. */
  specDocs?: SpecDoc[];
  /** §5.16 — 리뷰·승인 레인 목록. `projectName`(워크트리) 으로 걸러 렌더한다. */
  reviewRequests?: ReviewRequest[];
  /** §5.18 — 에이전트 랩 목록. `projectName` 으로 걸러 렌더한다. */
  labRuns?: LabRun[];
  /** §5.20 — 스크립트 선반 목록. `projectName` 으로 걸러 렌더한다. */
  shelfBubbles?: ShelfBubble[];
  /** §5.21 — 프로젝트별 비용·토큰 지도. 세션 원장의 `days` 는 싣지 않는다(체크포인트 전용 — 전선 용량). */
  costMaps?: ProjectCostMap[];
  /**
   * §5.22 — 프로젝트별 감사 원장(프로젝트당 한 장). 집계(`counts`)는 서버가 접어서 실어 준다.
   */
  auditLogs?: ProjectAuditLog[];
  /** §5.3 #12-3 — 프로젝트별 자물쇠. 표시명 키라 `mergeSnapshots`·이름 바꾸기 relabel 을 함께 탄다. */
  pathLocks?: Record<string, PathLock[]>;
  /**
   * §5.26 — 프로젝트별 보험 원장. 전선엔 최근 `INSURANCE_SNAPSHOT_MARKERS`·`INSURANCE_SNAPSHOT_PREIMAGES` 줄만, 전량은 체크포인트·`GET /api/insurance`.
   * `watch`/`resurrectable` 은 여기만 실리는 파생(체크포인트 ❌).
   */
  contextInsurance?: ProjectInsuranceLedger[];
  /** 프로젝트별 루트 캔버스 바운딩 박스 반폭/반높이(LAYOUT_CENTER_X/Y 중심). 없으면 클라 기본값. */
  layoutBoundsByProject?: Record<string, { hw: number; hh: number }>;
  /** §5.3 #28 — 콘티(contiId → Conti). 클라가 활성 에이전트·활성 conti 로 걸러 패널에 그린다. 없으면 빈 맵. */
  contis?: Record<string, Conti>;

  /** §5.3 #28 (L) — 콘티 in-flight 작업(agentId 키). workId 발급 뒤 LLM 응답 전 상태를 보이고, 응답 뒤에도 같은 workId 의 후속 수정을 받으려 남는다. 영속 ❌. */
  activeContiWork?: Record<string, ActiveContiWork>;

  /** §4 — 세션별 최근 도구 실행 시간(ring buffer, 최대 5건). */
  recentToolDurations?: Record<string, ToolDurationEntry[]>;
  /** §4 — 세션별 컨텍스트 컴팩션 누적 수 + 마지막 시각. */
  compactCounts?: Record<string, CompactCount>;
  /** §4 — Claude.ai 한도 사용률(글로벌 1건, 외부 statusline 스크립트가 푸시). */
  rateLimits?: RateLimitInfo;
  /** §4 — `rateLimits`(statusLine 원천)에서 파생한 화면용 사용량. 글로벌 1건(한도는 사용자 단위), 런타임 캐시. */
  claudeUsage?: ClaudeUsageInfo;
  /** §4 API 크레딧 — 설정·경로·Anthropic 거절·Console 이번 달 지출(공식 cost_report 그대로). 머신 단위, 키 본문은 싣지 않는다. */
  apiCredits?: ApiCreditState;
  /** §4 — `claude auth status` 결과(글로벌 1건, 런타임 캐시). 클라는 이것만 보고 로그인 팝업·옵션창 Account 를 정한다. */
  claudeAuth?: ClaudeAuthStatus;

  /** §4 — `claude` CLI 설치 판정(글로벌, 런타임 캐시). 설치 게이트·상단 배너를 이것만 보고 정한다(로그인 팝업보다 앞 단계). */
  claudeSetup?: ClaudeSetupState;

  /** §5.25 (E) — `codex login status`(글로벌, 런타임 캐시). 클로드와 같은 규칙: `error` 면 "로그아웃"이 아니라 "모름"이라 창을 띄우지 않는다. */
  codexAuth?: CodexAuthStatus;

  /** §5.25 (D) — `codex` CLI 설치 판정(글로벌, 런타임 캐시). 코덱스를 안 골라도 돈다(우클릭 메뉴가 "준비 안 됨"을 말해야 한다). */
  codexSetup?: CodexSetupState;

  /** §5.25 (I) — 코덱스 훅 설치 상태. 글로벌 1건. 영속화 ❌ — 디스크를 보면 아는 파생 사실. */
  codexHooks?: CodexHookState;
  /** §5.25 (G) — 코덱스가 캐시한 모델 목록(우리 표가 없어 읽어 싣는다). 없음 = 아직 못 읽음(화면도 그렇게 그린다). */
  codexModels?: CodexModelCatalog;
  /** §5.25 (M) — 코덱스의 MCP·스킬·플러그인·훅·`AGENTS.md`(IDE 활동바 코덱스 갈래). 디스크 파생이라 영속 ❌, 없음 = 아직 못 읽음. */
  codexInventory?: CodexInventory;
  /** §5.25 (N) — 코덱스 리뷰 이력(최근이 앞, 화면이 `agentId` 로 거른다). 영속 ❌ — 다시 부르는 비용은 사용자가 정한다. */
  codexReviews?: CodexReviewRun[];

  /** §4 — 진단 에러 로그(글로벌 ring buffer, 최신순, 런타임 캐시). */
  diagnosticLog?: DiagnosticEntry[];

  /** §5.5 #17-4 — 프로젝트별 스킬 사용 수(projectName → skillName → count). `POST /api/commands/:sessionId` 가 줄머리 `/skill-name` 마다 올린다. */
  skillUsageCounts?: Record<string, Record<string, number>>;

  /** §5.3 #10-2 — Auto Agent 가 spawn 한 에이전트 군의 메타(auto-agent sessionId 키, 버블의 진행/요약 슬롯용). 없으면 빈 맵. */
  autoAgentSummaries?: Record<string, AutoAgentSummary>;

  /** §5.3 #10-3 — 검증 런(autoAgentId → 최신순, `AutoAgentPanel` 데이터 소스). 없으면 빈 맵. */
  autoAgentRuns?: Record<string, AutoAgentRun[]>;

  /** §4 — 동적 모델 레지스트리(부팅 때 시드 + `/v1/models` 머지). AgentConfigPopup 버전 드롭다운 소스 — 없으면 클라가 시드로 폴백. */
  modelRegistry?: ModelRegistry;
  /** §5.19 — 로컬 LLM(엔진 설치·받은 모델·진행 중 다운로드). 기기 전역 값이라 체크포인트에 넣지 않는다 — 디스크가 진실이고 서버가 다시 읽어 싣는다. */
  localLlm?: LocalLlmState;
  /** §4 — 사용자 글로벌 옵션(Options 창). 없으면 빈 객체. 신규 spawn 때 서버가 `agentConfig` 머지에 쓴다. */
  userDefaults?: UserDefaults;

  /** §4 — 작업 신고(agentId → 최신순 append, `POST /api/agent-report`). IDE 가 agentId/subAgentId 로 거른다. 없으면 빈 맵. */
  agentReports?: Record<string, AgentReport[]>;

  /** §5.5 #17-36 — 세션을 고르지 않은 메인 탭의 스티키 메모(agentId 키). 세션 탭 메모는 `subAgents[].memos` 에 있다. 에이전트 제거 때 함께 정리(`removeAgent`). */
  agentMemos?: Record<string, SessionMemo[]>;

  /** §4 — 질문 카드(agentId → 최신순 append, `POST /api/agent-questions`). 없으면 빈 맵. */
  agentQuestions?: Record<string, AgentQuestions[]>;

  /** §4 — 검수 요청 카드(agentId → 최신순 append, `POST /api/agent-review`). 없으면 빈 맵. */
  agentReviews?: Record<string, AgentReview[]>;

  /** §4 — 번호 목록 카드(agentId → 최신순 append, `POST /api/agent-list`). 없으면 빈 맵. */
  agentLists?: Record<string, AgentList[]>;

  /** §5.5 #17-11 — 세션 루프 설정(subAgentId 키 — IDE 가 활성 탭 하나를 바로 집는다). 없으면 빈 맵. */
  sessionLoops?: Record<string, SessionLoop>;

  /** §5.5 #17-35 — 검증 실행 이력(subAgentId → 최신 우선, 세션당 `VERIFICATION_RUNS_MAX_PER_SESSION`). 없으면 빈 맵. */
  verificationRuns?: Record<string, VerificationRun[]>;

  /** §5.5 #17-35 ⑨ — 시연 목록(subAgentId → 최신 우선, 세션당 `VERIFICATION_DEMO_MAX_PER_SESSION`). 영상은 없고 단계 문장·프레임 경로만(⑨-2). */
  verificationDemos?: Record<string, VerificationDemo[]>;

  /** §5.5 #17-17 — 세션 목표(subAgentId 키). 없으면 빈 맵. */
  sessionGoals?: Record<string, SessionGoal>;
  /** §5.5 #17-17 ⑪(a) — 단계 "종류" 카드(`key` → 카드). 목표와 달리 프로젝트에 한 벌이다. */
  visualKinds?: Record<string, VisualKindCard>;
  /** §5.5 #17-17 ⑫(a) — 무대 팔레트의 배운 행동(`useCount` 내림차순, `GOAL_ACTION_MAX`). 스킬 사용수·되풀이 명령·되풀이 단계에서 스냅샷마다 파생 — 저장은 `pinnedGoalActions` 만. */
  goalActions?: GoalActionCard[];

  /** §5.5 #17-28 — 컨텍스트 주입원 오버라이드(프로젝트·세션 층). 사용자의 뜻만 싣는다 — 무엇이 있는지는 조회 API 가 매번 잰다. */
  contextOverrides?: ContextOverrides;

  /** §4 — 피드백(agentId → targetId 별 upsert, `POST /api/agent-feedback`). 없으면 빈 맵. */
  agentFeedbacks?: Record<string, AgentFeedback[]>;

  /**
   * §5.10 자동 목표 경량 요약 — 본문(스킬 내용)은 스냅샷을 타지 않는다(REST 로만, §9). 꺼진 프로젝트엔 없다(기본 off).
   * projectName 키 — 절차가 프로젝트별 `.vibisual/skills/` 에 있어, 단일 객체면 프로젝트가 둘 이상일 때 `mergeSnapshots` 가 떨궈 "0개"로 보인다.
   */
  autoGoal?: Record<string, AutoGoalSummary>;

  /** §5.3 #10-4 — 오케스트라(projectName → 설정 + 최근 런). 설정·런 없는 프로젝트는 빠진다(= 기본·꺼짐). 런은 `ORCHESTRA_RUN_SNAPSHOT_MAX` 건만, 나머지는 체크포인트에. */
  orchestra?: Record<string, OrchestraSummary>;

  /** §5.3 #10-5 — 설정 덜어내기(projectName → 설정 + 최근 런). 없음 = 기본·꺼짐. 런은 `CONFIG_TRIM_RUN_SNAPSHOT_MAX` 건만, 나머지는 체크포인트에. */
  configTrim?: Record<string, ConfigTrimSummary>;

  /**
   * §5.11 — 집행 플러그인의 실측(projectPath → pluginId → 값). 집행은 서버가 파일을 훑는데 카드는 파일을 못 보므로, 카드가 집행과 같은 것을 세게 하는 다리다.
   * 켬/끔(`enabledPluginsByProject`)과 같은 projectPath 키. 읽기 전용·영속 0(파일에서 다시 구한다). 켠 집행 모듈이 없으면 필드도 없다.
   */
  pluginFacts?: Record<string, Record<string, PluginFactMap>>;

  /** §5.11 · §5.5 #17-44 — 세션별 정독 상태(`SubAgent.id` 키, `verificationRuns`·`sessionLoops` 와 같은 축). 영속 0 — 세션 계측이라 앱을 끄면 사라지는 게 맞다. 없으면 필드도 없다. */
  specReading?: Record<string, SpecReadingState>;
}

/** 플러그인 실측 — 카드가 한 줄로 그릴 얕은 값만. 중첩을 허용하면 카드마다 해석이 갈려 "서버가 판단, 카드는 그린다" 경계가 흐려진다. */
export type PluginFactMap = Record<string, string | number | boolean | string[]>;

// ─── §5.11 정독 게이트 · §5.5 #17-44 ───
// 단위는 파일이 아니라 절(節) — 파일 단위로는 "열었는데 그 절은 안 봤다"를 못 가른다. 원장(`SpecReadingState`)은 영속하지 않고 설정만 영속한다.

/** 게이트 강도 — 알림(아무것도 막지 않음) · 경고(`Stop` 되돌림) · 차단(`Edit`/`Write` deny). */
export type SpecGateStrength = 'observe' | 'warn' | 'enforce';

/** 절 상태(제약 원장 4상태). `satisfied` 는 증거가 있을 때만, `waived` 는 사용자만 준다 — 에이전트가 스스로 면제하면 게이트가 무의미하다. */
export type SpecUnitStatus = 'open' | 'satisfied' | 'blocked' | 'waived';

/** 기획 문서에서 잘라 낸 절 하나. */
export interface SpecUnit {
  /** 본문의 `REQ-\d+`·`SPEC-…` 토큰이 있으면 그것, 없으면 `<pathKey>#<헤딩 슬러그>`. */
  id: string;
  title: string;
  /**
   * 라우팅이 견주는 **자르지 않은** 제목(없으면 `title`). `title` 은 `SPEC_ITEM_LABEL_MAX` 에서 잘려 꼬리 낱말이 색인에서 사라진다
   * (실측: §5.5 #17-44 조각 54개가 `정독` 을 잃어 그 낱말로 찾는 요청이 자기 절을 못 찾았다). 보이는 것과 찾는 것을 나눈다.
   */
  matchText?: string;
  /** 프로젝트 루트 기준 상대경로(표시·열기용 원본 그대로 — 비교 키는 `pathKey()`). */
  file: string;
  /** 1-based, 헤딩 줄. */
  startLine: number;
  /** 1-based, 다음 헤딩 직전 줄. */
  endLine: number;
  chars: number;
  /** `SHALL`·`해야`·`한다`·`금지` 류 문장 수 — 절의 무게를 재는 값(라우팅 우선순위). */
  requirementCount: number;
  mtimeMs?: number;
  /** 추정 토큰(`estimateTokens`). 프롬프트 목록이 절마다 비용을 적는 재료. */
  tokens?: number;
  /** 항목·문단으로 다시 잘라도 `SPEC_UNIT_TOKEN_MAX` 를 넘는 절 — 통째 Read 대신 Grep 으로 좁혀 열라고 시킨다. */
  oversized?: boolean;
}

/** 이 프로젝트의 기획 절 전집 — "다 봐야 할 목록"의 닫힌 집합. */
export interface SpecIndex {
  units: SpecUnit[];
  docCount: number;
  /** `SPEC_UNIT_MAX` 로 잘렸는가 — 잘렸으면 화면이 그렇게 말해야 한다(없는 것을 다 봤다고 하면 안 된다). */
  truncated: boolean;
  /** 실제로 훑은 뿌리들(설정·자동 탐색 결과). */
  roots: string[];
  builtAt: number;
  /** 상한(`SPEC_DOC_FILE_MAX`·`SPEC_UNIT_MAX`) 밖으로 밀린 문서 — 앞 `SPEC_INDEX_SKIPPED_LIST_MAX` 개만(화면용). */
  skippedDocs: string[];
  /** 상한 밖으로 밀린 문서 수 전부. */
  skippedCount: number;
  /** 백업·아카이브·임시 폴더라서 일부러 뺀 문서 수. */
  excludedCount: number;
}

/** 이 세션이 실제로 연 구간 하나 — 훅의 `Read`/`Grep` 에서만 나온다(`Glob` 은 열람이 아니다). */
export interface SpecReadSpan {
  file: string;
  fromLine: number;
  toLine: number;
  tool: 'Read' | 'Grep';
  /** 통째 Read 강등·Grep 문맥처럼 "본 것은 맞으나 정독으로 치지 않는" 구간. */
  partial: boolean;
  at: number;
}

/** 에이전트가 낸 인용 한 건과 그 대조 결과 — 이 기능에서 유일하게 참·거짓이 기계로 갈리는 축. */
export interface SpecCitation {
  unitId: string;
  file: string;
  fromLine: number;
  toLine: number;
  quote: string;
  verified: boolean;
  checkedAt: number;
  /** 왜 실패했는가 — `not-found`(그 구간에 그 문장이 없다) · `out-of-range` · `file-missing`. */
  failure?: 'not-found' | 'out-of-range' | 'file-missing';
  /** 그 줄 범위의 파일 원문(공백 접음, `SPEC_CITATION_ACTUAL_MAX` 자, 맞은 자리를 가운데로) — 인용과 나란히 놓는다(§5.5 #17-44 ③(b)). 범위 밖·파일 없음이면 없다. */
  actual?: string;
}

/** 이번 턴에 필수로 걸린 절 하나의 판정. */
export interface SpecRequiredEntry {
  unitId: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  status: SpecUnitStatus;
  /** 정독으로 인정된 줄 비율(0~1). 부분 열람(통째 Read 강등·Grep 문맥)은 빠진다 — `satisfied` 판정과 같은 자를 써야 화면과 게이트가 안 갈린다. */
  covered: number;
  /** 열긴 열었으나 부분 열람으로 강등된 구간만 있는가. */
  partial: boolean;
  citation?: SpecCitation;
  /** `blocked` 사유(되돌림 상한 도달 등). */
  reason?: string;
  /** 왜 이 절이 필수로 걸렸는가 — `prompt` · `path` · `route`. */
  via: 'prompt' | 'path' | 'route';
  /** 절의 추정 토큰 — 목록·화면이 비용을 적는다. */
  tokens?: number;
  /** 다시 잘라도 상한을 넘는 절 — 화면은 칩을, 프롬프트는 "Grep 으로 좁혀라"를 단다. */
  oversized?: boolean;
}

/** 신뢰도 — 한 점수로 뭉개지 않는다(무엇이 부족한지 말하지 못한다). 넷은 각각 0~1. */
export interface SpecTrust {
  /** 필수 절 중 열람된 비율. */
  coverage: number;
  /** 낸 인용 중 파일과 일치한 비율(인용이 없으면 0). */
  citation: number;
  /** 절 구간을 얼마나 덮었는가 — `offset` 밖 읽기·통째 Read 강등이 깎는다. */
  depth: number;
  /** 문서가 열람 뒤 수정되지 않았는가. */
  freshness: number;
  requiredTotal: number;
  satisfied: number;
  citationsVerified: number;
  citationsFailed: number;
  /** 열람 뒤 수정된 문서 수. */
  staleDocs: number;
}

/** 게이트가 실제로 무엇을 했는지 한 줄 — 막은 적이 없으면 빈 배열이고 화면이 "막은 적 없음"이라 적는다. */
export interface SpecGateEvent {
  at: number;
  kind: 'stop-block' | 'write-deny' | 'retry-exhausted';
  unitIds: string[];
  detail?: string;
}

/** 한 세션의 정독 상태. 키는 `SubAgent.id`(= 클라 `activeSessionId`) — 훅 세션(CLI UUID)은 서버가 `findSubBySessionId` 로 이 키에 옮겨 담는다. */
export interface SpecReadingState {
  strength: SpecGateStrength;
  indexUnits: number;
  indexDocs: number;
  indexTruncated: boolean;
  indexedAt: number;
  required: SpecRequiredEntry[];
  /** 히트맵 — 파일별 열람 구간(파일당 `SPEC_SPANS_PER_FILE_MAX`). */
  spans: Record<string, SpecReadSpan[]>;
  /** 히트맵 축척 — 파일별 총 줄 수. 모르면 그 막대는 그리지 않는다(없는 축척으로 그리면 거짓이 된다). */
  fileLines: Record<string, number>;
  trust: SpecTrust;
  gate: SpecGateEvent[];
  /** 이 세션에서 `Stop` 을 되돌린 횟수 — 상한에 닿으면 더 막지 않는다. */
  stopRetries: number;
  updatedAt: number;
  /** 상한 밖으로 밀린 문서 수 — "120장을 색인했다"만으로는 무엇이 빠졌는지 알 수 없다. */
  indexSkipped: number;
  /** 그 목록(앞 `SPEC_INDEX_SKIPPED_LIST_MAX` 개). */
  indexSkippedDocs: string[];
  /** 백업·아카이브·임시 폴더라서 일부러 뺀 문서 수. */
  indexExcluded: number;
  /** 실제로 훑은 뿌리 — 뷰가 보여 주고 같은 자리에서 고친다. */
  roots: string[];
}

/** 코드 경로 ↔ 기획 절 명시 매핑(사용자가 적는 것이 가장 정확하다). */
export interface SpecReadingRoute {
  glob: string;
  specs: string[];
}

/** 프로젝트별 설정 — **영속하는 것은 이것뿐**이다(원장은 휘발). */
export interface SpecReadingSettings {
  strength: SpecGateStrength;
  /** 기획 문서 뿌리. 비면 자동 탐색(`SPEC_DOC_ROOT_CANDIDATES`). */
  roots?: string[];
  /** 절 id 토큰 정규식. 비면 `SPEC_ID_PATTERN_DEFAULT`. */
  idPattern?: string;
  maxRequired?: number;
  stopRetries?: number;
  routes?: SpecReadingRoute[];
  /** 사용자가 면제한 절 id — 에이전트는 여기에 손댈 수 없다. */
  waived?: string[];
  /** §5.5 #17-44 ⑧ — 프로젝트 층 스위치(없으면 꺼짐). 판정은 `resolveSpecReadingEnabled` 하나로 — 직접 읽는 판정을 따로 만들면 화면과 집행이 갈린다. */
  enabledProject?: boolean;
  /** **에이전트 층** 덮어쓰기 — `agentId` → 켬/끔. 칸이 없으면 프로젝트 층을 물려받는다. */
  enabledAgents?: Record<string, boolean>;
  /** **세션 층** 덮어쓰기 — `SubAgent.id` → 켬/끔. 칸이 없으면 에이전트 층을 물려받는다. */
  enabledSessions?: Record<string, boolean>;
  updatedAt?: number;
}

/** §5.5 #17-44 ⑧ — 정독 켬/끔 층(아래가 위를 덮는다). 새 축이 아니라 #17-28 의 `ContextScopeLevel` 그대로라 두 축이 갈라질 수 없다. 순서는 `SPEC_SCOPE_ORDER`. */
export type SpecReadingScope = ContextScopeLevel;

// ─── §5.10 — 자동 목표(되풀이한 일을 스킬로 굳힌다) ──────────────────────

/** 자동 목표 켬/끔 층(아래가 위를 덮는다) — 정독(#17-44 ⑧)과 같은 3층·같은 손짓·같은 저장 규약. 순서는 `AUTO_GOAL_SCOPE_ORDER`. */
export type AutoGoalScope = ContextScopeLevel;

/**
 * 되풀이 원천: `command` = 셸 명령의 연속 묶음이 되풀이됨 · `step` = 무대에 거듭 꽂은 단계 묶음(#17-17 ⑫(a)ⓒ).
 * 스킬 호출은 원천이 아니다 — 이미 스킬이고, 잦은 스킬은 팔레트(⑫(a)ⓐ)가 앞에 세운다.
 */
export type AutoGoalSource = 'command' | 'step';

export type AutoGoalSkillStatus = 'candidate' | 'active' | 'needs-review' | 'retired' | 'superseded';

/** Server counts, based on actual reviewed procedures and acknowledged outcomes. */
export interface AutoGoalMetrics {
  activeCount: number;
  reviewCount: number;
  retiredCount: number;
  reuseCount: number;
  skipCount: number;
  failureCount: number;
  revisionCount: number;
}

/** 절차 후보 한 건(스킬 전). 단계는 실제로 돌던 명령 원문이다 — 요약하면 그 절차를 다시 돌릴 수 없다. */
export interface AutoGoalCandidate {
  /** 안정 키 — 같은 절차는 언제 세어도 같은 id 다(단계 본문에서 만든다). */
  id: string;
  /** 사람이 읽는 이름 — 첫 단계에서 뽑는다. */
  title: string;
  /** 이 절차를 이루는 단계(실제로 돌던 명령·행동 원문). */
  steps: string[];
  /** 이 묶음이 통째로 되풀이된 횟수. */
  runs: number;
  /** 마지막으로 관찰된 시각. */
  lastSeenAt: number;
  source: AutoGoalSource;
  /** 이 절차가 만졌던 파일 — 스킬 frontmatter 의 `files` 앵커와 본문 목록 양쪽이 된다. */
  files?: string[];
  /** 이미 스킬로 굳었으면 그 스킬 id. 있으면 후보 목록이 아니라 "굳음"으로 그린다. */
  skillId?: string;
}

/** 자동 목표가 지은 스킬 한 장의 요약 — 화면이 읽는 것(본문은 파일에 있다). */
export interface AutoGoalSkillSummary {
  id: string;
  name: string;
  description: string;
  status?: AutoGoalSkillStatus;
  /** Actual project-relative location, including legacy storage. */
  path?: string;
  /** Current file revision required by review and assessment requests. */
  revision?: string;
  reason?: string;
  applicability?: string;
  reviewedAt?: number;
  supersededBy?: string;
  reuseCount?: number;
  skipCount?: number;
  failureCount?: number;
  revisionCount?: number;
  /** 절차 단계 수. */
  steps: number;
  /** 굳을 때 관찰됐던 되풀이 횟수. */
  runs: number;
  createdAt: number;
  updatedAt: number;
  /** 이 스킬을 낳은 후보 id — 화면이 후보와 스킬을 한 줄로 잇는다. */
  candidateId?: string;
  /** 절차가 만지는 파일 — frontmatter `files` 앵커에서 읽는다(본문 목록은 사람이 고치는 자리라 세지 않는다). §5.11 그라운딩 카드가 앵커를 센다. */
  files?: string[];
  /** 이 절차가 어디서 자랐나 — frontmatter `origin`. 파일에 적혀 있어 분석 창 밖에서도 읽힌다. */
  origin?: AutoGoalSource;
}

/** 자동 목표 뷰가 그리는 전부. 여기서 다시 세지 않는다(§3.1) — 서버가 스킬을 굳히는 판단과 같은 함수에서 낸 값이다. */
export interface AutoGoalState {
  /** 3층을 접은 결론 — 이 자리에서 도는가. */
  enabled: boolean;
  /** 아직 문턱을 못 넘은 것 + 막 넘어 굳은 것(굳은 것은 `skillId` 가 있다). */
  candidates: AutoGoalCandidate[];
  /** 지금까지 자동으로 지어진 스킬. */
  skills: AutoGoalSkillSummary[];
  /** 스킬이 되는 문턱(되풀이 횟수) — 진행 막대의 분모다. */
  minRuns: number;
  /** 훑은 행동 수 — 0 이면 "아직 볼 것이 없다"이지 "고장"이 아니다. */
  observed: number;
  /** 마지막으로 분석이 돈 시각. 0 이면 아직 안 돌았다. */
  analyzedAt: number;
  metrics?: AutoGoalMetrics;
}

/**
 * §5.10 — 스냅샷용 경량 요약(숫자 몇 개). 목록을 든 `AutoGoalState` 를 매 브로드캐스트에 태우지 않으려 따로 둔다.
 * §5.11 카드가 프롬프트와 같은 숫자를 말하도록 서버가 센 값 하나만 내려보낸다. 없음 = 켠 층이 없다(0 과 구분 — "아직 없다" vs "안 쓴다").
 */
export interface AutoGoalSummary extends Partial<AutoGoalMetrics> {
  /** 프로젝트 층 결론. `false` 여도 요약이 올 수 있다(아래 층이 덮는다) — 도는지는 `agentEnabled` 까지 본다. */
  enabled: boolean;
  /** 에이전트 층까지 접은 결론 — 값이 적힌 자리만 담는다(없는 키는 `enabled`). 매 브로드캐스트 맵이라 에이전트 수만큼 자라면 안 된다. */
  agentEnabled?: Record<string, boolean>;
  /** 굳어 파일(`SKILL.md`)로 선 절차 수. */
  skillCount: number;
  /** 아직 문턱을 못 넘은 되풀이 후보 수. */
  candidateCount: number;
  /** 사용자가 물려 둔 후보 수 — 지운 것이 아니라 덮은 것이다(§5.10 "끄기는 삭제가 아니다" 승계). */
  dismissedCount: number;
  /** 파일 앵커(`files`)가 붙은 절차 수 — 그 절차가 만졌던 원본으로 되짚을 수 있다는 뜻. */
  anchoredCount: number;
  /** 에이전트가 스스로 친 명령에서 자란 수(`source: 'command'`). */
  fromCommand: number;
  /** 사용자가 무대에 꽂은 단계에서 자란 수(`source: 'step'`). */
  fromStep: number;
  /** 훑은 행동 수(분석 표본 크기). 0 이면 아직 볼 것이 없었다는 뜻. */
  observed: number;
  /** 스킬이 되는 문턱(되풀이 횟수) — 후보 진행률의 분모. */
  minRuns: number;
  /** 가장 많이 되풀이된 절차 하나의 횟수 — "한 번 보고 끝"과 "계속 이어짐"을 가른다. */
  topRuns: number;
  /** 되풀이 횟수의 총합(굳은 것 포함). `totalRuns - (skillCount + candidateCount)` 가 순 재발 횟수다. */
  totalRuns: number;
  /** 가장 최근에 굳은 절차 이름. 하나도 없으면 생략. */
  recentSkillName?: string;
}

/** 자동 목표 설정 — 영속은 `ProjectCheckpoint.autoGoalSettings` 한 칸(§3.2). 칸 없음 = 위 층을 물려받음, 아무 층도 안 정하면 꺼짐. */
export interface AutoGoalSettings {
  /** **프로젝트 층** 스위치. 없으면 "안 정함" = 꺼짐. */
  enabledProject?: boolean;
  /** **에이전트 층** 덮어쓰기 — `agentId` → 켬/끔. */
  enabledAgents?: Record<string, boolean>;
  /** **세션 층** 덮어쓰기 — `SubAgent.id` → 켬/끔. */
  enabledSessions?: Record<string, boolean>;
  /** 물린 후보 id — 다시 굳히지 않는다. 지우지 않고 덮는다(관찰은 계속, 제안만 멈춤). */
  dismissed?: string[];
  updatedAt?: number;
}

// ─── §5.3 #10-4 — 오케스트라(지휘 모드) ────────────────────────────────────────

/** 오케스트라 켬/끔 층은 프로젝트 → 에이전트 둘뿐 — 세션마다 지휘가 갈리면 어느 탭의 명령이 편성될지 예측할 수 없다. */
export type OrchestraScope = 'project' | 'agent';

/** 절감 방안 id — 토큰 감사 표 13행과 순서까지 같다(`no` = 행 번호). 원문은 `ORCHESTRA_STRATEGIES`, 계획 신고엔 이 id 를 담는다. */
export type OrchestraStrategyId =
  | 'subagents'
  | 'output'
  | 'autoCompact'
  | 'read'
  | 'memoryFiles'
  | 'prevOutput'
  | 'shell'
  | 'systemPrompt'
  | 'subagentReports'
  | 'web'
  | 'reminders'
  | 'preamble'
  | 'other';

/** 편성: `none` = 지휘자가 직접 답함(작은 질문에 머릿수는 낭비) · `single` = 멤버 하나 · `pipeline` = 차례로 잇는다(엣지로 앞 결과가 다음 입력) · `parallel` = 나눠 동시에, 한 멤버가 모은다. */
export type OrchestraTopology = 'none' | 'single' | 'pipeline' | 'parallel';

/** IntentGate 분류(§5.3 #10-2 표) + 편성 없이 답할 질문. */
export type OrchestraIntent = 'question' | 'quick-fix' | 'feature' | 'research' | 'debug' | 'refactor';

/** 멤버를 어느 엔진으로 만드나. `auto` = 지휘자가 역할마다 고르고 그 이유를 적는다. */
export type OrchestraMemberEngine = 'claude' | 'codex' | 'auto';

/**
 * 멤버가 태어날 때의 작업 폴더 격리(`worktree` → `buildConfigArgs` 의 `--worktree`). `parallel` 에서 같은 워킹트리 동시 수정을 막는 유일한 축이라 사용자 스위치다.
 * Claude 멤버만 — Codex CLI 엔 대응 플래그가 없다.
 */
export type OrchestraMemberIsolation = 'none' | 'worktree';

/** 지휘 턴 권한. `bypass`(기본) = loopback REST 를 curl 로 쳐야 해서(#10-2 빌더와 같은 이유) · `inherit` = 그 에이전트의 권한 그대로(승인 카드가 뜬다). */
export type OrchestraConductorPermission = 'bypass' | 'inherit';

/**
 * 오케스트라 설정 — 영속은 `ProjectCheckpoint.orchestraSettings` 한 칸. 재작업 예산 칸은 일부러 없다(엣지마다 `TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT` 이 있어 읽히지 않는 스위치가 된다).
 * 모델·강도의 빈 값 = 안 정함(지휘자 = 그 에이전트 설정, 멤버 = 지휘자가 고름).
 */
export interface OrchestraSettings {
  /** **프로젝트 층** 스위치. 없으면 "안 정함" = 꺼짐. */
  enabledProject?: boolean;
  /** **에이전트 층** 덮어쓰기 — `agentId` → 켬/끔. 지휘자가 만든 멤버는 여기 `false` 로 적힌다(재귀 방지). */
  enabledAgents?: Record<string, boolean>;
  /** 지휘자(Claude 엔진일 때) 모델. */
  conductorClaudeModel?: string;
  /** 지휘자(Claude 엔진일 때) effort. */
  conductorClaudeEffort?: string;
  /** 지휘자(Codex 엔진일 때) 모델 slug. */
  conductorCodexModel?: string;
  /** 지휘자(Codex 엔진일 때) 추론 강도. */
  conductorCodexReasoning?: string;
  /** 지휘 턴 권한. 없으면 `bypass`. */
  conductorPermission?: OrchestraConductorPermission;
  /** 켜면 지휘 턴에 `AskUserQuestion` 을 더한다. 없으면 꺼짐. */
  askQuestions?: boolean;
  /** 멤버 엔진. 없으면 지휘자 엔진을 따른다. */
  memberEngine?: OrchestraMemberEngine;
  memberClaudeModel?: string;
  memberClaudeEffort?: string;
  memberCodexModel?: string;
  memberCodexReasoning?: string;
  /** 한 런에서 새로 만들 수 있는 멤버 수. 없으면 `ORCHESTRA_DEFAULT_MAX_MEMBERS`. */
  maxMembers?: number;
  /**
   * 멤버가 태어날 때 받는 작업 폴더 격리. 없으면 `none`(지휘자와 같은 워킹트리 — 이 기능이 없던 때와 같다).
   */
  memberIsolation?: OrchestraMemberIsolation;
  /**
   * 멤버의 도구 목록 템플릿 id(`AGENT_TOOL_TEMPLATES`, 없으면 설정 창 기본값). 지휘자는 못 바꾼다 — `tools` 는 loopback 유입에서 얼려 있고(§5.3 #12-1) 멤버는 빈 오버라이드로 태어난다.
   * 최소 권한은 사용자가 고르고 서버가 생성 때 박는 길뿐이다.
   */
  memberToolTemplate?: string;
  /** 지휘자에게 주지 않는 방안 — 규칙에서 빠지고, 계획 신고에 담기면 400. */
  disabledStrategies?: OrchestraStrategyId[];
  updatedAt?: number;
}

/** `conducting` 지휘 중 · `dispatched` 멤버에 넘기고 회수 대기 · `completed` 회수 후 최종 답 · `answered` 편성 없이 직접 답 · `unreported` 계획 신고 없이 끝남(성공으로 그리지 않는다) · `error` 실패. */
export type OrchestraRunPhase = 'conducting' | 'dispatched' | 'completed' | 'answered' | 'unreported' | 'error';

/** 지휘자가 고르거나 건너뛴 방안 하나와 그 이유. */
export interface OrchestraPlanChoice {
  id: OrchestraStrategyId;
  reason: string;
}

/** 지휘자가 `POST /api/orchestra/runs/:runId/plan` 으로 신고한 계획. */
export interface OrchestraPlan {
  intent: OrchestraIntent;
  topology: OrchestraTopology;
  chosen: OrchestraPlanChoice[];
  skipped?: OrchestraPlanChoice[];
  /** 킥오프를 받은 멤버. */
  entryAgentId?: string;
  /** 사용자에게 남기는 말(엔진을 auto 로 고른 이유·참고 전용 방안 권고 등). */
  note?: string;
}

/** 요청 1건 = 런 1개. 같은 에이전트에 새 요청을 넣어도 이전 런은 덮이지 않는다. */
export interface OrchestraRun {
  runId: string;
  projectPath: string;
  /** 지휘한 에이전트(버블 id). */
  agentId: string;
  /** 지휘 명령 id(`QueuedCommand.id`). */
  commandId: string;
  /** 요청 원문(≤ `ORCHESTRA_RUN_REQUEST_MAX`). */
  userRequest: string;
  engine: 'claude' | 'codex';
  phase: OrchestraRunPhase;
  startedAt: number;
  planAt?: number;
  endedAt?: number;
  plan?: OrchestraPlan;
  /** 이 런이 만든 멤버 + 계획에서 재사용한다고 밝힌 멤버. */
  memberAgentIds: string[];
  /** 이 런이 새로 만든 멤버 수 — `maxMembers` 는 이 값으로 잰다(`memberAgentIds` 길이로 재면 재사용이 새 자리를 깎는다). 없으면 0. */
  createdMemberCount?: number;
  /** 지휘·킥오프·멤버의 엣지/오케스트라 명령 입력 토큰 합. */
  inputTokens: number;
  outputTokens: number;
}

/** 스냅샷 한 프로젝트분 — 설정 + 최근 런(`ORCHESTRA_RUN_SNAPSHOT_MAX`). */
export interface OrchestraSummary {
  settings: OrchestraSettings;
  runs: OrchestraRun[];
}

// ─── §5.3 #10-5 — 설정 덜어내기(Config Trim) ──────────────────────────────────

/** 범위 3단 — 바깥(넓음) -> 안(좁음). 좁은 단이 이긴다. */
export type ConfigTrimScope = 'project' | 'agent' | 'session';

/** 규칙 표(`CONFIG_TRIM_RULES`) 한 줄의 이름 — 줄을 늘리면 여기와 `ide.configTrim.rule.<id>` 번역 키도 같이 늘린다. */
export type ConfigTrimRuleId =
  | 'preset-meta'
  | 'custom-mode-placeholder'
  | 'model-version-gone'
  | 'effort-gone'
  | 'effort-default'
  | 'max-turns-default'
  | 'max-budget-unlimited'
  | 'fallback-model-empty'
  | 'thinking-on-default'
  | 'forward-subagent-text-on-default'
  | 'fast-mode-off-default'
  | 'permission-timeout-default'
  | 'betas-empty'
  | 'agent-definitions-empty'
  | 'context-window-non-opus'
  | 'fast-mode-unsupported'
  | 'betas-subscription'
  | 'cli-kind-headless'
  | 'mcp-output-without-mcp'
  | 'agent-definitions-without-task'
  | 'permission-timeout-moot';

/** 덜어낸 까닭 갈래 — 화면이 덜어낸 목록을 이 값으로 묶는다. */
export type ConfigTrimReason =
  /** 지금 고른 모델/CLI 가 받지 않는다(죽은 플래그·사라진 모델 id). */
  | 'not-accepted'
  /** 값이 기본값과 같다 — 붙여 봐야 결과가 같다. */
  | 'same-as-default'
  /** 저장만 되고 본체가 없다(타입 주석에 그렇게 적혀 있다). */
  | 'not-implemented'
  /** 그 칸이 걸리는 길이 이 턴에 없다. */
  | 'no-effect-here';

/** 덜어내지 않고 남긴 까닭 — 배제 목록이 이 값으로 사유를 적는다. */
export type ConfigTrimKeepReason =
  /** 타입이 요구하는 네 칸 — 없으면 설정이 아니다. */
  | 'required'
  /** 사용자가 손으로 정한 값 — 우리가 무를 자리가 아니다. */
  | 'user-set'
  /** 건드리면 이 턴이 실제로 다르게 돈다(권한·도구·격리·엔진). */
  | 'unsafe'
  /** 판정 재료가 이 턴에 없다 — 모르면 둔다. */
  | 'unknown'
  /** 사용자가 그 규칙을 꺼 뒀다. */
  | 'rule-off';

/** 이 턴 사본에서 실제로 덜어낸 칸 하나. */
export interface ConfigTrimRemoval {
  /** `AgentConfig` 의 칸 이름. */
  field: string;
  /** 어느 규칙이 덜어냈나. */
  ruleId: ConfigTrimRuleId;
  /** 덜어낸 까닭 갈래. */
  reason: ConfigTrimReason;
  /** 덜어내기 **전** 값의 사람이 읽는 사본(`CONFIG_TRIM_VALUE_MAX` 로 자른다). */
  before: string;
}

/** 덜어내지 않고 남긴 칸 하나. */
export interface ConfigTrimExclusion {
  /** `AgentConfig` 의 칸 이름. */
  field: string;
  /** 남긴 까닭. */
  keep: ConfigTrimKeepReason;
  /** `keep` 이 `'unknown'`·`'rule-off'` 일 때 그 판단을 낸 규칙. */
  ruleId?: ConfigTrimRuleId;
}

/** 설정 덜어내기 설정(프로젝트별). ⚠ 켬/끔 세 칸은 `withConfigTrimScope` 로만 바뀐다 — `applyConfigTrimSettingsPatch` 는 받지 않는다(두 창구가 같은 칸을 덮지 않게). */
export interface ConfigTrimSettings {
  /** 프로젝트 전체 단. 없음 = 안 정함(= 끔). */
  enabledProject?: boolean;
  /** 에이전트 단 — 커스텀 에이전트 id -> 켬/끔. */
  enabledAgents?: Record<string, boolean>;
  /** 이 세션만 단 — 서브에이전트(세션) id -> 켬/끔. */
  enabledSessions?: Record<string, boolean>;
  /** 사용자가 꺼 둔 규칙 id. 꺼 두면 그 칸은 덜어내지 않고 배제 목록에 `'rule-off'` 로 선다. */
  disabledRules?: ConfigTrimRuleId[];
  /** 마지막으로 바뀐 시각(ms) — 두 창이 같은 설정을 볼 때 최신이 이긴다. */
  updatedAt?: number;
}

/** 한 턴에 무엇을 덜어냈고 무엇을 남겼나 — 화면이 두 목록을 이 기록에서 읽는다. */
export interface ConfigTrimRun {
  /** 기록 id — 명령 id 에서 낸다(같은 턴이 두 번 적히지 않게). */
  runId: string;
  /** 동작주 커스텀 에이전트 id. */
  agentId: string;
  /** 동작주 세션(서브에이전트) id. */
  subAgentId: string;
  /** 그 턴의 명령 id. */
  commandId: string;
  /** 그 턴이 돈 엔진. */
  engine: 'claude' | 'codex';
  startedAt: number;
  /** 사본에서 실제로 덜어낸 칸들. 비어 있으면 사본을 쓰지 않았다는 뜻이다. */
  trimmed: ConfigTrimRemoval[];
  /** 덜어내지 않고 남긴 칸들과 사유. */
  excluded: ConfigTrimExclusion[];
}

/** 스냅샷 한 프로젝트분 — 설정 + 최근 런(`CONFIG_TRIM_RUN_SNAPSHOT_MAX`). */
export interface ConfigTrimSummary {
  settings: ConfigTrimSettings;
  runs: ConfigTrimRun[];
}

// ─── §9 graph_snapshot 키맵 슬라이스 증분 전송 ───

/**
 * 키맵 슬라이스 증분 — 바뀐 키만 싣고 수신 측이 이전 값 위에 얹어 전체 맵을 복원한다.
 * `fileEdits`·`bashHistory` 원문은 쓸수록 쌓여(실측 스냅샷 3.2MB 중 78%) 16~250ms 마다 통째로 보내면 쓸수록 느려진다.
 */
export interface KeyedSliceDelta<T> {
  /** 이번에 값이 바뀐 키들(추가 포함). */
  changed: Record<string, T>;
  /** 이번에 사라진 키들. */
  removed: string[];
}

/** graph_snapshot 에 함께 실리는 증분 묶음. 해당 슬라이스는 본문에서 생략된다. */
/** 증분으로 대체된 슬라이스. 어느 슬라이스인지는 `DELTA_SLICE_KEYS` 단독(서버·클라 한 벌) — 필드를 늘리면 거기도 같은 이름을 넣어라. */
export interface GraphSnapshotDeltas {
  fileEdits?: KeyedSliceDelta<FileEdit[]>;
  bashHistory?: KeyedSliceDelta<BashEntry[]>;
  agentReports?: KeyedSliceDelta<AgentReport[]>;
  agentMemos?: KeyedSliceDelta<SessionMemo[]>;
  agentQuestions?: KeyedSliceDelta<AgentQuestions[]>;
  agentReviews?: KeyedSliceDelta<AgentReview[]>;
  agentLists?: KeyedSliceDelta<AgentList[]>;
  sessionGoals?: KeyedSliceDelta<SessionGoal>;
  visualKinds?: KeyedSliceDelta<VisualKindCard>;
  agentFeedbacks?: KeyedSliceDelta<AgentFeedback[]>;
  agentEvents?: KeyedSliceDelta<AgentEvent[]>;
  nodeProjects?: KeyedSliceDelta<string>;
  specReading?: KeyedSliceDelta<SpecReadingState>;
  orchestra?: KeyedSliceDelta<OrchestraSummary>;
  configTrim?: KeyedSliceDelta<ConfigTrimSummary>;
}

/** 전선 위 스냅샷 — 증분 대체 슬라이스는 `undefined`. ⚠ 새 클라에는 항상 전체 스냅샷이 먼저 간다(`buildConnectionMessages`), 증분은 그 뒤 브로드캐스트에만. */
export type GraphSnapshotWire =
  Omit<GraphSnapshot, 'fileEdits' | 'bashHistory' | 'agentEvents' | 'nodeProjects'>
  & {
    fileEdits?: Record<string, FileEdit[]>;
    bashHistory?: Record<string, BashEntry[]>;
    /** 증분으로 빠질 수 있어 optional(`GraphSnapshot` 에선 필수). 클라가 델타를 풀어 전체 맵을 되돌린다. */
    agentEvents?: Record<string, AgentEvent[]>;
    nodeProjects?: Record<string, string>;
    deltas?: GraphSnapshotDeltas;
  };

/**
 * 폴더 한 겹의 엔트리(§7.5). ⚠ `children` 이 없는 것은 설계다 — 하위는 펼칠 때 `relativePath` 로 다시 조회한다.
 * 재귀를 넣지 마라(홈이 외부 폴더 버블로 뜨면 61만 항목에 창이 멈춘다).
 */
export interface FolderFileEntry {
  /** 파일/폴더 이름 */
  name: string;
  /** 프로젝트 루트 기준 상대 경로 */
  relativePath: string;
  /** 디렉토리 여부 */
  isDirectory: boolean;
  /** 현재 위성으로 표시 중인지 */
  isSatellite: boolean;
}

/** `GET /api/folder-files` — 한 겹의 한 페이지(§7.5). 바닥에 닿으면 `nextCursor` 로 다음 장, `total` 로 남은 양을 말한다. */
export interface FolderFilePage {
  /** 이번 장의 엔트리 — 폴더 먼저, 그다음 이름순. */
  entries: FolderFileEntry[];
  /** 다음 장을 가리키는 커서. `null` 이면 이 겹은 끝이다. */
  nextCursor: string | null;
  /** 이 겹의 전체 항목 수(무시 목록·숨김 폴더를 걸러 낸 뒤). */
  total: number;
}

/** §5.5 #17-19 — IDE 탐색기 엔트리(한 겹). `FolderFileEntry` 와 달리 경로를 소문자로 뭉개지 않고 숨김도 담는다(디스크 그대로가 목적). */
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
  /** §5.13 (R-7) — 눌러서 실행할 수 있는가(파일만). 본문 경로와 같은 곳으로 가도록 `/api/workspace-path` 의 `executable` 판정을 그대로 받는다. */
  executable?: boolean;
}

/** §5.5 #17-19 — `GET /api/workspace-dir` 응답(디렉터리 한 겹). */
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

/** §5.5 #17-27 ⑬ — `GET /api/workspace-path` 응답: 본문 경로가 파일(내장 편집창)인지 폴더(시스템 탐색기)인지만 묻는다. */
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
   * §5.5 #17-27 ⑬ (h) — 눌러서 실행할 것인가. 참이면 편집창·탐색기 대신 실행(#17-20 ④)으로 간다(`.exe` 를 누르면 "켜라"다).
   * 판정은 디스크를 본 서버가 한다(Windows 확장자 · macOS `.app` · POSIX 실행 비트) — 화면이 글자로 정하면 플랫폼 규칙이 두 벌이 된다.
   */
  executable: boolean;
}

/**
 * §5.5 #17-27 ⑬ (d) — 루트 밖 절대 경로의 정체(`GET /api/external-path`). 루트 밖은 시스템 탐색기로만 연다 —
 * `executable`·`root`/`path` 를 두면 본문 글자로 임의 경로를 실행하는 길이 열리므로 **필드를 두지 않는다**.
 */
export interface ExternalPathInfo {
  /** 해석된 절대 경로 — `POST /api/reveal-path` 에 그대로 실어 보낸다. */
  absPath: string;
  /** 파일인가 폴더인가 (심볼릭 링크는 실제 대상 기준). 파일이면 **상위 폴더**가 열린다. */
  kind: WorkspacePathKind;
}

/** §5.5 #17-27 ⑱ — 우측 판이 파일을 무엇으로 그리나. 판정은 `editorPaneKindOf`(shared) 한 곳. */
export type EditorPaneFileKind = 'code' | 'html' | 'image' | 'pdf';

/** §5.5 #17-27 ⑱ — `GET /api/workspace-find`: 프로젝트 전체에서 그 갈래 파일만 모은다(빈 탭이 "이 프로젝트의 HTML" 을 한 목록으로 보이게). */
export interface WorkspaceFindResult {
  /** 트리 루트 절대 경로 (요청한 값 그대로) */
  root: string;
  /** 찾은 갈래 */
  kind: EditorPaneFileKind;
  /** 찾은 파일들 — 최근 고친 순(같으면 경로순). 폴더는 없다. */
  entries: WorkspaceEntry[];
  /** 고른 파일 수(상한으로 자르기 전) */
  total: number;
  /** 훑기·시간·담기 상한에서 잘렸는가. 참이면 화면이 적는다 — 조용히 자르면 없는 줄 알고 찾기를 그만둔다. */
  truncated: boolean;
}


// ─── §5.13 (R-8) — 변환기 상태와 변환 작업 ──────────────────────────────────────

/** 이 PC 의 변환기(ffmpeg) 상태 — 코덱 설치 여부가 아니다(Chromium 은 시스템 코덱을 안 쓴다, §5.13 (R-8) (a)). 화면이 [변환]·[설치] 중 무엇을 낼지 정한다. */
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

/** 변환 작업 하나 — 휘발성(체크포인트 ❌). 진실은 디스크 캐시 파일이라 껐다 켜도 결과는 남는다. */
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

/** §5.5 #17-27 — 원본 줄바꿈. 저장 때 되돌린다(textarea 는 항상 `\n`). */
export type WorkspaceEol = 'lf' | 'crlf';

/** §5.5 #17-27 — `GET /api/workspace-file` 결과. `truncated`/`binary` 면 읽기 전용으로 연다 — 잘린·깨진 본문을 저장하면 원본이 사라진다. */
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
  /** 읽은 원본 바이트의 지문 — 같은 수정 시각의 외부 변경도 저장 시 대조한다. */
  revision?: string;
  /** WORKSPACE_FILE_MAX_BYTES 를 넘어 앞부분만 담았으면 true (읽기 전용) */
  truncated: boolean;
  /** 텍스트로 읽을 수 없는 파일(NUL 바이트 포함)이면 true (읽기 전용) */
  binary: boolean;
  /** §5.5 #17-27 ⑭ — 그림으로 열지(`이미지 확장자 && binary`, 서버 한 곳에서 판정). SVG 처럼 텍스트로 읽히는 이미지는 false — 고칠 수 있는 글자라 편집을 빼앗지 않는다. */
  image: boolean;
  /** §5.5 #17-27 ⑫ — 디스크가 쓰기를 막음(Perforce 체크아웃 전·`attrib +r`·권한). 타이핑은 막지 않는다 — 저장 순간 잠금을 푼다(`clearReadOnly`). */
  readOnly: boolean;
  /** §5.5 #17-27 ⑥ — 루트 밖 파일이라 보기만 한다(§5.1 #2-1 (A)). `readOnly` 와 달리 풀 수 없다 — `PUT` 은 루트 안만. */
  outside?: boolean;
  /** 원본 줄바꿈 */
  eol: WorkspaceEol;
}

/** §5.5 #17-27 — `PUT /api/workspace-file` 요청. */
export interface WorkspaceFileSaveRequest {
  root: string;
  path: string;
  /** 저장할 본문 — 줄바꿈은 `\n`, 서버가 `eol` 로 되돌려 쓴다 */
  text: string;
  eol: WorkspaceEol;
  /** 읽을 때 받은 `mtimeMs`. 디스크가 그 사이 바뀌었으면 서버가 409 로 막는다 */
  baseMtimeMs: number;
  /** 읽을 때 받은 원본 바이트 지문. baseMtimeMs=0 강제 저장은 대조를 생략한다. */
  baseRevision?: string;
  /** §5.5 #17-27 ⑫ — 읽기 전용 잠금을 풀고 저장(사용자가 그 버튼을 눌렀을 때만). 쓰기 비트만 켜고 되걸지 않는다 — `p4 edit` 등 VCS 명령은 돌리지 않는다. */
  clearReadOnly?: boolean;
}

/** §5.5 #17-27 — 저장 결과(덮어쓴 뒤 크기·수정 시각). */
export interface WorkspaceFileSaveResult {
  root: string;
  path: string;
  size: number;
  mtimeMs: number;
  revision?: string;
  /** §5.5 #17-27 ⑫ — 저장 뒤에도 여전히 잠겨 있는가(잠금을 풀었으면 false 로 돌아온다). */
  readOnly: boolean;
}

/**
 * §5.5 #17-25 ④-1 — 주석본으로 이미지 파일을 덮어쓴다(`PUT /api/workspace-image`). 본문은 바이트 그대로(base64 는 33% 부풀고, 트랜스포트가 바이너리를 무손실로 나른다).
 * `eol` 은 없고, `mtimeMs` 대조 → 409 는 텍스트와 같다.
 */
export interface WorkspaceImageSaveRequest {
  root: string;
  path: string;
  /** 읽을 때 받은 `mtimeMs`. 디스크가 그 사이 바뀌었으면 서버가 409 로 막는다. `0` 이면 대조 생략. */
  baseMtimeMs: number;
  baseRevision?: string;
}

/**
 * §5.5 #17-19 ⑦ — 탐색기 우클릭의 만들기·이름 바꾸기·삭제. 되돌릴 수 없는 쓰기라 이름 판정(`workspaceEntryNameError`)·겹침 검사를 반드시 지난다.
 * 경로 가드는 읽기와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`.
 */
export interface WorkspaceEntryCreateRequest {
  root: string;
  /** **부모 폴더**의 루트 기준 상대 경로('' = 루트 바로 아래) */
  path: string;
  /** 새로 만들 이름 한 조각(경로 ❌) */
  name: string;
  kind: WorkspacePathKind;
}

/** §5.5 #17-19 ⑦ — 이름 바꾸기(`PATCH /api/workspace-entry`). 옮기지 않는다 — 부모 폴더는 그대로다. */
export interface WorkspaceEntryRenameRequest {
  root: string;
  /** 바꿀 대상의 루트 기준 상대 경로(루트 자신 ❌) */
  path: string;
  /** 새 이름 한 조각(경로 ❌) */
  name: string;
}

/** §5.5 #17-19 ⑧ — 옮기기(`POST /api/workspace-entry/move`). 이름 바꾸기와 다른 창구 — 이름은 두고 사는 곳만 바뀌며 되물음도 다르다. */
export interface WorkspaceEntryMoveRequest {
  root: string;
  /** 옮길 대상의 루트 기준 상대 경로(루트 자신 ❌) */
  path: string;
  /** 새로 들어갈 **폴더**의 루트 기준 상대 경로('' = 루트 바로 아래) */
  toDir: string;
}

/** §5.5 #17-19 ⑦ — 삭제(`DELETE /api/workspace-entry`). 폴더는 안의 것까지 함께 사라진다. */
export interface WorkspaceEntryDeleteRequest {
  root: string;
  path: string;
}

/** §5.5 #17-19 ⑦ — 만들기·이름 바꾸기의 결과(그 자리에서 화면을 갱신할 수 있게 새 좌표를 그대로 돌려준다). */
export interface WorkspaceEntryResult {
  root: string;
  /** 만들어졌거나 새 이름을 받은 항목의 루트 기준 상대 경로 */
  path: string;
  /** 그 항목의 부모 폴더 상대 경로('' = 루트) — 탐색기가 **이 한 겹만** 다시 읽는다 */
  parent: string;
  name: string;
  isDirectory: boolean;
}

/** §5.5 #17-19 ⑦ — 삭제 결과. */
export interface WorkspaceEntryDeleteResult {
  root: string;
  path: string;
  parent: string;
  /** 휴지통(true)인가 영구 삭제(false)인가. 데스크톱은 `shell.trashItem` 이라 늘 true, 브라우저로 띄운 개발 서버는 영구 삭제 — 화면이 그 차이를 말한다. */
  trashed: boolean;
}

/**
 * 프로젝트 정보(에이전트 cwd 로 자동 등록). 식별자는 정규화한 `path`(projectId) — `name` 은 표시용이고 basename 이 겹치면 경로 파생 접두로 전역 유일화된다("client" / "client (other)").
 * `name` 으로 식별·영속하지 마라.
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
      /** §5.1 #2-1 (B) — 에이전트별 이번 턴 장부(bubble id → 만진 node key). 새 명령이 열고 캔버스·IDE 확인이 닫는다. 없으면(옛 저장분) 빈 장부 — 지난 턴이 묶음에 되살아나지 않는다. */
      agentTurnNodes?: Record<string, string[]>;
    };
  };

  activity: {
    bashHistory: Record<string, BashEntry[]>;
    runningServers: Record<string, ServerEntry[]>;
    fileEdits: Record<string, FileEdit[]>;
    /** 도메인 버블 웹 이력(§5.23) — 정체성이 아니라 이력이라 `fileEdits`·`bashHistory` 처럼 `activity.json` 으로 흐른다(`identity.json` ❌, §3.2.2). */
    domainEntries?: Record<string, WebEntry[]>;
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
  /**
   * 에이전트별 설정. §4 (설정 3층) — 세 층을 겹친 **완성본 사본**이고 권위는 `agentConfigOverrides`.
   * 지우지 마라 — 구버전 앱은 이 필드만 읽는다(§3.2.1-5). 없애면 다운그레이드한 사용자의 에이전트가 모두 내장 기본으로 돌아간다.
   */
  agentConfigs?: Record<string, AgentConfig>;
  /** §4 (설정 3층) — 에이전트가 자기 것으로 못 박은 칸만. 없으면(구버전) 복원이 `agentConfigs` 를 기본값과 대조해 만든다 — 갈라진 칸은 남고 같던 칸은 위층을 따라간다. */
  agentConfigOverrides?: Record<string, Partial<AgentConfig>>;
  /** §4 — 에이전트별 컴팩션 누적 수(영속). 도구 시간·한도는 런타임이라 영속 ❌. */
  compactCounts?: Record<string, CompactCount>;
  /** 에이전트(session)별 관측된 도구 목록 (session_id → tool names). 훅에서 자동 수집. */
  observedTools?: Record<string, string[]>;
  /** 사용자가 수동 편집한 에이전트 ID 목록. 수동 편집 시 자동 동기화 비활성화. */
  manuallyConfigured?: string[];
  /** 에이전트 간 작업 흐름 엣지 (TaskEdge ID → TaskEdge). optional로 하위호환 유지. */
  taskEdges?: Record<string, TaskEdge>;
  /** Delete 로 지운 iframe 버블(sessionId → ports). 재시작 후 rehydrate 로 되살아나지 않게 막고, 같은 포트로 새 `run_in_background` 가 오면 풀린다. */
  dismissedIframes?: Record<string, number[]>;
  /** §5.7 #24 — `lifecycle.onDead` 로 빠진(VSCode 창 닫힘 등) 에이전트 스냅샷. 같은 cwd 의 SessionStart 가 오면 `restoreDormantForCwd` 로 되살린다 — 재시작을 넘어야 해서 영속. */
  dormantAgents?: Record<
    string,
    { agent: BubbleData; cwd: string; pid: number; removedAt: number }
  >;
  /** UI 표시 언어 (서버 SSOT). optional — 구버전 체크포인트 하위호환. 미설정 시 DEFAULT_UI_LOCALE 적용 */
  uiLocale?: UiLocale;
  /** Comment Box(이 프로젝트). 없으면 빈 배열. */
  commentBoxes?: CommentBox[];
  /** §5.9 캡처 버블(이 프로젝트). 없으면 빈 배열. */
  captureBubbles?: CaptureBubble[];
  /** §5.13 — 내부 앱 버블(영속). */
  appBubbles?: AppBubble[];
  /** §5.14 — 플레이 버블(영속). */
  playBubbles?: PlayBubble[];
  /** §5.15 — 스펙 보드(영속). optional — 구버전 체크포인트 하위호환. */
  specDocs?: SpecDoc[];
  /** §5.16 — 리뷰·승인 레인(영속). optional — 구버전 체크포인트 하위호환. identity 에는 넣지 않는다(diff 는 재계산 가능). */
  reviewRequests?: ReviewRequest[];
  /** §5.18 — 에이전트 랩(영속). optional — 구버전 체크포인트 하위호환. */
  labRuns?: LabRun[];
  /** §5.20 — 스크립트 선반(영속). optional — 구버전 체크포인트 하위호환. */
  shelfBubbles?: ShelfBubble[];
  /** §5.21 — 비용·토큰 지도(영속). identity ❌ — 트랜스크립트에서 다시 접을 수 있는 파생이다. */
  costMap?: ProjectCostMap;
  /** §5.22 — 권한·감사 원장(영속). identity 엔 없지만 **결정 이력은 재계산 불가** — 여기서 빠지면 영영 없다. */
  auditLog?: ProjectAuditLog;
  /** §5.3 #12-3 — 사용자가 건 자물쇠. 손으로 건 보호라 `identity.json` 에도 산다 — 조용히 사라지면 AI 가 그대로 연다. */
  pathLocks?: PathLock[];
  /**
   * §5.26 — 보험 원장(영속). ⚠ 빠지면 껐다 켤 때 색인이 사라지고 `insurance/blobs` 가 고아가 된다 — `toProjectCheckpoint` 를 특히 확인할 것.
   * 파생 `watch`/`resurrectable` 은 저장하지 않는다(복원 후 같은 스윕이 같은 답을 낸다).
   */
  contextInsurance?: ProjectInsuranceLedger;
  /** 루트 캔버스에서 부모 버블이 못 나가는 바운딩 박스 반폭/반높이(LAYOUT_CENTER_X/Y 중심, 사용자가 핸들로 조절). 없으면 클라 기본값(1500/1100). ProjectCheckpoint 로만 영속(§3.2). */
  layoutBoundsHalfWidth?: number;
  layoutBoundsHalfHeight?: number;
  /** §5.3 #28 — 콘티(영속). 에이전트 삭제 때 cascade. */
  contis?: Record<string, Conti>;

  /** §5.5 #17-4 — 스킬 사용 수(skillName → count). 줄머리 `/skill-name` 마다 증분. 없으면 빈 맵. */
  skillUsageCounts?: Record<string, number>;

  /** §5.3 #10-2 — Auto Agent 군 요약 메타(auto-agent sessionId 키). 사용자 산출물 트레이스라 영속한다. */
  autoAgentSummaries?: Record<string, AutoAgentSummary>;

  /** §5.3 #10-3 — 검증 런(영속) — "무엇을 근거로 완료라 했나"는 세션을 넘어 남아야 할 증거다. */
  autoAgentRuns?: Record<string, AutoAgentRun[]>;

  /** §4 — 작업 신고(영속) — 세션을 넘어 남는 산출물 트레이스. */
  agentReports?: Record<string, AgentReport[]>;

  /** §5.4 #36 (H) ①-2 — 에이전트마다 마지막으로 걷힌 연결([이전 연결 다시 보기]용). 껐다 켠 뒤에도 "방금 걷은 것"을 되돌리려 싣는다. 없으면 빈 맵. identity ❌. */
  agentLinkRecords?: Record<string, AgentLinkRecord>;

  /** §5.5 #17-36 — 메인 탭 스티키 메모(영속). 사용자가 쓴 글이라 복구 불가 자산이다. */
  agentMemos?: Record<string, SessionMemo[]>;

  /** §4 — 질문 카드(영속). */
  agentQuestions?: Record<string, AgentQuestions[]>;

  /** §4 — 검수 요청 카드(영속) — 세션을 넘어 남는 산출물 트레이스. */
  agentReviews?: Record<string, AgentReview[]>;

  /** §4 — 번호 목록 카드(영속). */
  agentLists?: Record<string, AgentList[]>;

  /** §4 — 피드백(영속) — 세션을 넘어 학습 근거로 쓰는 사용자 산출물. */
  agentFeedbacks?: Record<string, AgentFeedback[]>;

  /** §5.5 #17-11 — 세션 루프(영속). 사용자가 짠 설정 + 진행 카운트라 재시작 후에도 이어진다. */
  sessionLoops?: Record<string, SessionLoop>;

  /** §5.5 #17-35 — 검증 실행 이력(영속) — 무엇이 언제 돌아 통과했나는 남아야 할 근거다. identity ❌ — 실행 기록이지 사람이 만든 정체성이 아니다(§5.16 과 같은 판단). */
  verificationRuns?: Record<string, VerificationRun[]>;

  /**
   * §5.11 정독 — 설정만 영속한다(원장은 세션 계측). 사용자가 정한 강도·기획 뿌리·경로 매핑·면제 목록 — `waived` 는 사용자만 주므로 잃으면 다시 손으로 넣어야 한다.
   * 없으면 `DEFAULT_SPEC_READING_SETTINGS`.
   */
  specReadingSettings?: SpecReadingSettings;

  /** §5.10 자동 목표 — 설정(3층 켬/끔·물린 후보)만 영속. 후보는 이력(`bashHistory`·`sessionGoals`·`skillUsageCounts`)에서 매번 세는 파생이고 스킬은 `SKILL.md` 가 원본이다. 없으면 꺼짐. */
  autoGoalSettings?: AutoGoalSettings;

  /** §5.3 #10-4 — 오케스트라 설정(2층 켬/끔·지휘자·멤버·꺼둔 방안) + 런 기록(`ORCHESTRA_RUN_MAX_PER_PROJECT` ring). 없으면 꺼짐·기록 없음. */
  orchestraSettings?: OrchestraSettings;
  orchestraRuns?: OrchestraRun[];

  /** §5.3 #10-5 — 설정 덜어내기 범위 3단 켬/끔·꺼 둔 규칙 + 기록(`CONFIG_TRIM_RUN_MAX_PER_PROJECT` ring). 없으면 꺼짐·기록 없음. */
  configTrimSettings?: ConfigTrimSettings;
  configTrimRuns?: ConfigTrimRun[];

  /** §5.5 #17-35 ⑨ — 시연(영속). 사람이 만든 것이지만 identity ❌ — 프레임 PNG(`.vibisual/verify-demos/`) 없이 레코드만 살아나면 반쪽이라, 둘은 `.vibisual` 아래서 함께 산다. */
  verificationDemos?: Record<string, VerificationDemo[]>;

  /** §5.5 #17-17 — 세션 목표(영속). 사용자가 쓴 문장 + 진행 이력이라 identity.json 에도 실린다(§3.2.2). */
  sessionGoals?: Record<string, SessionGoal>;
  /** §5.5 #17-17 ⑪(h) — 시각 종류 카드. 에이전트가 만들고 사용자가 고정한 것이라 재계산 불가 → 정체성(§3.2.2). */
  visualKinds?: Record<string, VisualKindCard>;
  /** §5.5 #17-17 ⑫(b) — 팔레트에서 고정한 행동 카드 id. 팔레트는 파생이지만 고정은 사용자가 고른 것 → 정체성(§3.2.2). */
  pinnedGoalActions?: string[];

  /** §5.5 #17-28 — 주입원 오버라이드(영속, 없으면 전부 기본). 잃으면 껐던 것이 조용히 다시 실린다. */
  contextOverrides?: ContextOverrides;

  /** §3.2.1-3 — 명시 삭제한 커스텀 에이전트 sessionId 묘비(identity `deletedSessionIds` 와 같은 것). checkpoint 에도 실어 deriveIdentity 가 한 소스에서 파생한다. */
  deletedCustomAgentIds?: string[];

  /** §5.5 #17-20 ⑩ — 중단점(영속). 세션·콜스택·변수는 프로세스 수명이라 넣지 않는다. 다시 찍으면 되므로 identity ❌(§3.2.2). */
  debugBreakpoints?: DebugBreakpoint[];
}

/**
 * §3.2.2 — 잃으면 안 되는 정체성 데이터(`identity.json`, 저빈도·고신뢰). 휘발성 런타임 상태는 `checkpoint.json` 에만 산다.
 * 복원: checkpoint 전체 → identity 로 빠진 정체성만 보충(있으면 덮지 않는다). checkpoint 가 깨져도 커스텀 에이전트는 identity 에서 살아난다. 파일이 없으면(구버전) 단일 파일 동작.
 */
export interface ProjectIdentity {
  /** 전방 호환 — 미래 구조 변경 대비. 현재 1. 로드 시 `>= 1` 이면 수용. */
  version: number;
  project: ProjectInfo;
  /** 저장 시각 (epoch ms). */
  savedAt: number;
  /** 라벨 생성 번호 유지 (checkpoint.graph.agentCounter 와 최대값 동기). */
  agentCounter: number;
  /** 사용자가 만든 커스텀 에이전트(Auto Agent·파이프라인 합성 포함, `customCreated=true`)의 정체성 버블(sessionId 키). 런타임 필드는 복원 때 정규화되고 id/label/생성·position 은 여기가 권위다. */
  customAgents: Record<string, BubbleData>;
  /** 에이전트별 설정 (agent id → AgentConfig). §4 (설정 3층) 이후로는 세 층을 겹친 **완성본 사본** — 권위는 `agentConfigOverrides`. */
  agentConfigs: Record<string, AgentConfig>;
  /** §4 (설정 3층) — 에이전트가 자기 것으로 못 박은 칸만. 없으면 위 완성본에서 되만든다(구버전 저장분 하위 호환). */
  agentConfigOverrides?: Record<string, Partial<AgentConfig>>;
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
  /** §5.13 — 내부 앱 버블(정체성 — 사용자가 만든 것). */
  appBubbles: AppBubble[];
  /** §5.14 — 플레이 버블(정체성 — 놓은 버튼 + 확정한 실행 레시피). */
  playBubbles: PlayBubble[];
  /** §5.15 — 스펙 보드(정체성 — 사람이 쓴 요구사항). 없으면 빈 배열. */
  specDocs?: SpecDoc[];
  /** §5.18 — 에이전트 랩(정체성 — 사람이 쓴 과제·설정 조합). 없으면 빈 배열. */
  labRuns?: LabRun[];
  /** §5.20 — 스크립트 선반(정체성 — 사람이 모은 명령·프롬프트). 없으면 빈 배열. */
  shelfBubbles?: ShelfBubble[];
  /** 콘티 데이터 (contiId → Conti). */
  contis: Record<string, Conti>;
  /** §5.5 #17-17 — 세션 목표(정체성 — 사용자가 쓴 문장). 없으면 빈 맵. */
  sessionGoals?: Record<string, SessionGoal>;
  /** §5.5 #17-17 ⑪(h) — 시각 종류 카드(정체성, §3.2.2). */
  visualKinds?: Record<string, VisualKindCard>;
  /** §5.5 #17-17 ⑫(b) — 고정한 행동 카드 id(정체성, §3.2.2). */
  pinnedGoalActions?: string[];
  /** §5.5 #17-36 — 메인 탭 스티키 메모(정체성). 세션 탭 메모는 세션(`subAgents`)의 소지품이라 여기 없다. 없으면 빈 맵. */
  agentMemos?: Record<string, SessionMemo[]>;
  /** §5.3 #12-3 — 사용자가 건 자물쇠(정체성 — 잃으면 AI 가 그대로 연다). 복원 보충은 id 합집합이라 어긋나도 잠긴 쪽으로 남는다. */
  pathLocks?: PathLock[];
  /** §3.2.1-3 — 명시 삭제한 커스텀 에이전트 sessionId 묘비. shrink guard 가 정상 삭제와 복원 실패(미기록 소멸)를 가르고, `mergeIdentityIntoCheckpoint` 는 이 id 를 되살리지 않는다(유령 부활 차단). */
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

// ─── 앱 테마 (§4 앱 테마 — 판올림 번호 발급 대기) ───

/** 테마의 밝기 계열. `color-scheme`(네이티브 컨트롤)과 옵션창의 묶음(다크/라이트)이 이 값을 따른다. */
export type AppThemeKind = 'dark' | 'light';

/** 팔레트 계열 — Tailwind 색 이름 그대로. 앱 색 클래스는 전부 `--color-<계열>-<칸>` 변수로 칠해지므로 테마의 본체는 이 표의 값 교체다. */
export type AppThemeFamily =
  | 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
  | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green' | 'emerald' | 'teal' | 'cyan'
  | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose';

/** 팔레트 칸 — 50(가장 밝음) ~ 950(가장 어두움). */
export type AppThemeShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

/** 계열 하나의 11칸. 값은 CSS 색 문자열(우리가 다시 쓴 것). */
export type AppThemeRamp = Record<AppThemeShade, string>;

/**
 * 의미 토큰 — Tailwind 클래스로 못 칠하는 자리의 이름. 기본값·CSS 변수 이름의 정본은
 * `APP_THEME_TOKEN_SPECS`(constants). **이 이름이 곧 사용자 테마 파일의 `colors` 키다** —
 * 바꾸면 사람들이 써 둔 파일이 조용히 안 먹으므로, 늘리기만 하고 고치거나 지우지 않는다.
 */
export type AppThemeToken =
  | 'window.background'
  | 'titleBar.background'
  | 'titleBar.foreground'
  | 'canvas.background'
  | 'canvas.dots'
  | 'surface.raised'
  | 'surface.card'
  | 'surface.inset'
  | 'surface.sunken'
  | 'ide.titleBar'
  | 'ide.tabBar'
  | 'code.background'
  | 'code.foreground'
  | 'code.border'
  | 'code.inlineBackground'
  | 'code.inlineForeground'
  | 'find.match'
  | 'find.matchForeground'
  | 'find.matchAll'
  | 'terminal.background'
  | 'terminal.panel'
  | 'terminal.foreground'
  | 'terminal.cursor'
  | 'terminal.cursorAccent'
  | 'terminal.selection'
  | 'terminal.black'
  | 'terminal.red'
  | 'terminal.green'
  | 'terminal.yellow'
  | 'terminal.blue'
  | 'terminal.magenta'
  | 'terminal.cyan'
  | 'terminal.white'
  | 'terminal.brightBlack'
  | 'terminal.brightRed'
  | 'terminal.brightGreen'
  | 'terminal.brightYellow'
  | 'terminal.brightBlue'
  | 'terminal.brightMagenta'
  | 'terminal.brightCyan'
  | 'terminal.brightWhite';

/**
 * 팔레트 계열 하나를 다시 짓는 지시. 기본 테마도 사용자 테마도 같은 모양이다.
 * 적용 순서: `from` 계열(없으면 같은 계열)의 **물려받은 값**에서 출발 → `mirror` → 색조·채도 이동 → `shades`.
 */
export interface AppThemeRampSpec {
  /** 출발 계열. 없으면 같은 이름의 계열에서 출발한다. */
  from?: AppThemeFamily;
  /** 명도 사다리를 뒤집는다(50↔950, 500 은 그대로). */
  mirror?: boolean;
  /** OKLCH 색상각(0~360)으로 통째로 돌린다. */
  hue?: number;
  /** OKLCH 채도를 이 값으로 고정한다(0~0.4). */
  chroma?: number;
  /** OKLCH 채도에 곱한다(0~4). `chroma` 와 함께 오면 `chroma` 가 이긴다. */
  chromaScale?: number;
  /** 칸별 직접 지정 — 위 변환 뒤에 덮어쓴다. */
  shades?: Partial<Record<AppThemeShade, string>>;
}

/** 테마 정의 — 기본(`BUILTIN_APP_THEMES`)·사용자 파일(`~/.vibisual/themes/*.json`)이 같은 모양. 해석은 shared `resolveAppTheme` 한 곳(서버 창 바탕과 클라가 같은 답). */
export interface AppThemeDefinition {
  schemaVersion: number;
  /** 기본 테마는 맨 이름(`midnight`), 사용자 테마는 `custom:` 접두 — 기본 테마를 가리지 못한다. */
  id: string;
  name: string;
  /** 없으면 물려받는다(`extends` 의 kind). */
  kind?: AppThemeKind;
  /** 출발 테마 id. 없으면 kind 가 light 면 `light`, 아니면 기본 테마. */
  extends?: string;
  description?: string;
  author?: string;
  /** 물려받은 팔레트의 모든 계열을 뒤집는다 — 다크 테마를 라이트로 옮기는 가장 짧은 길. */
  mirrorPalette?: boolean;
  /** 계열 → 별칭(다른 계열 이름) 또는 다시 짓는 지시. 특별 키 `white`·`black` 은 색 문자열. */
  palette?: Partial<Record<AppThemeFamily, string | AppThemeRampSpec>> & { white?: string; black?: string };
  /** 의미 토큰 → 색 또는 팔레트 참조(`{gray.900}` · `{sky.400}/50` · `{white}`). */
  colors?: Partial<Record<AppThemeToken, string>>;
  /** 기본 테마 이름·설명의 번역 키 꼬리(`panel.options.theme.builtin.<i18nKey>`). 사용자 테마엔 없다. */
  i18nKey?: string;
  /** 사용자 테마를 읽어 온 파일 이름(경로 아님 · 표시용). 기본 테마엔 없다. */
  file?: string;
}

/** 테마 파일 문제 — 문장이 아니라 코드로 남긴다(화면이 번역). `error` = 그 파일을 못 쓴다 · `warning` = 그 칸만 버린다. */
export type AppThemeIssueCode =
  | 'tooMany'
  | 'tooLarge'
  | 'readFailed'
  | 'invalidJson'
  | 'notObject'
  | 'unsupportedVersion'
  | 'missingName'
  | 'duplicateId'
  | 'unknownBase'
  | 'extendsCycle'
  | 'invalidColor'
  | 'unknownToken'
  | 'unknownFamily'
  | 'invalidRamp'
  /** 최상위 칸의 모양이 틀렸다(`kind` 가 dark/light 가 아님 · `palette` 가 객체가 아님 …). 그 칸만 버린다. */
  | 'invalidField';

export interface AppThemeIssue {
  /** 파일 이름(경로 아님) — 화면에 그대로 뜬다. 해석 단계 문제면 테마 id. */
  file: string;
  level: 'error' | 'warning';
  code: AppThemeIssueCode;
  /** 어느 칸·어떤 값인가(원문은 잘라서). */
  detail?: string;
}

/** `GET /api/app-themes` 응답이자 WS `app_themes_updated` 페이로드. */
export interface AppThemeCatalog {
  /** 사용자 테마 폴더 절대경로 — 표시·[폴더 열기]용. */
  dir: string;
  /** 읽어 낸 사용자 테마(검증·정규화 끝). */
  themes: AppThemeDefinition[];
  issues: AppThemeIssue[];
  scannedAt: number;
}

/** 해석이 끝난 테마 — 화면은 `cssVars` 를, 터미널·창 바탕은 `tokens`·`palette` 를 쓴다. */
export interface ResolvedAppTheme {
  /** 실제로 칠한 테마 id — 고른 id 를 못 찾으면 기본 테마 id 가 된다. */
  id: string;
  /** 고른 id 를 못 찾아 기본 테마로 떨어졌는가. */
  fellBack: boolean;
  name: string;
  kind: AppThemeKind;
  source: 'builtin' | 'custom';
  i18nKey?: string;
  description?: string;
  author?: string;
  file?: string;
  /** 팔레트 칸(`gray-950` · `white` · `black`) → CSS 색. */
  palette: Record<string, string>;
  /** 의미 토큰 → CSS 색. */
  tokens: Record<AppThemeToken, string>;
  /** 의미 토큰 → 풀기 전 원문(`{gray.900}` 참조 그대로). "지금 테마로 새로 만들기"가 이것으로 견본을 써서 팔레트만 바꿔도 참조 칸이 따라온다. */
  tokenSources: Record<AppThemeToken, string>;
  /** CSS 변수 이름(`--color-…`) → 값. `<html>`(또는 미리보기 칸)에 그대로 싣는다. */
  cssVars: Record<string, string>;
  /** 해석하다 버린 값들. */
  issues: AppThemeIssue[];
}

/** 데스크톱 창 바탕·제목줄 버튼에 칠할 색 — 전부 불투명 sRGB `#rrggbb`. */
export interface AppThemeChrome {
  themeId: string;
  kind: AppThemeKind;
  background: string;
  titleBar: string;
  titleBarSymbol: string;
}

/** §3.7 · §9 스플래시 — 서버 코어 부팅 진척(서버는 사실만, 문구는 main 의 표). 프로젝트 복원이 메인 스레드를 붙잡아도 main 이 메시지 포트로 흘려 "몇 번째 복원 중"이 뜬다. */
export type BootProgress =
  /** 열어 둔 프로젝트를 복원하는 중 — `done` 개를 끝냈고 지금 `label` 을 읽는다(끝나면 `done === total`). */
  | { phase: 'projects'; done: number; total: number; label?: string }
  /** 프로젝트 복원을 마치고 세션·감시·정리 같은 나머지 기동을 하는 중. */
  | { phase: 'services' };

// ─── User Defaults (§4) ───

/** §4 — 사용자 글로벌 옵션(Options 창, `~/.vibisual/user-defaults.json` 1건). `agentConfig` 는 `DEFAULT_AGENT_CONFIG` 위에 덮이는 프리셋 — 신규 spawn 에만, 기존 에이전트엔 영향 ❌. */
/** §4 (CMD 터미널 업그레이드 ④) — 알림 기본값. 인덱스 시그니처를 유지한다(옛 저장 파일 호환 · 모르는 키 통과). */
export interface UserNotificationDefaults extends Record<string, unknown> {
  /** CMD 세션이 백그라운드에서 `blocked` 가 되면 OS 알림. undefined = 켬, false 로만 끈다. */
  cmdBlocked?: boolean;
}

/** §4 (CMD 터미널 업그레이드 ③) — 고급 기본값. 같은 이유로 인덱스 시그니처 유지. */
export interface UserAdvancedDefaults extends Record<string, unknown> {
  /** 터미널 scrollback 줄 수(undefined = `TERMINAL_SCROLLBACK_LINES`). xterm `scrollback` 과 desktop PTY 링버퍼 상한을 함께 정한다. */
  terminalScrollbackLines?: number;
  /** §4 엔진 다리 — 우리가 띄우는 클로드 세션(헤드리스·CMD)에 동봉 모드(`vibisual-bridge`)를 실어 턴·생존·사용량을 엔진이 신고하게 할지. undefined = 켬. 다음에 뜨는 세션부터. */
  engineBridge?: boolean;
}

/** §4 · §5.3 #12-4 (J) — 권한 기본값(옵션창 권한 탭). 같은 이유로 인덱스 시그니처 유지. */
export interface UserPermissionDefaults extends Record<string, unknown> {
  /**
   * §5.3 #12-4 (J) — 검증 정책(undefined = 끔, `VERIFICATION_GATE_DEFAULT_ENABLED`). true 일 때만 Codex·Claude Code 에 제한 안내 + 실행 전 차단 — 끄면 주입도 거부도 없다(실행한 것으로만 센다).
   * 주입원 창은 켜진 정책의 안내만 숨긴다. 판정은 `isVerificationGateEnabled` 한 곳 — 저장 뒤 차단은 다음 도구 호출, 안내는 다음 턴부터.
   */
  verificationGate?: boolean;
}

/**
 * §4 (설정 3층) — 설정 창이 PUT 으로 보내는 모양. `null` = 이 칸을 지워라 — 서버가 부분 머지하므로 `undefined` 는 `JSON.stringify` 가 키째 버려 한 번 켠 기본값을 끌 수 없다.
 * 저장분엔 `null` 이 남지 않는다.
 */
export type AgentConfigPatch = { [K in keyof AgentConfig]?: AgentConfig[K] | null };

/** 카테고리의 `null` 필드는 저장값을 지워 내장 기본값으로 돌아간다. */
export type UserDefaultsPatch = Omit<Partial<UserDefaults>, 'agentConfig' | 'appearance'> & {
  agentConfig?: AgentConfigPatch;
  appearance?: { [K in keyof NonNullable<UserDefaults['appearance']>]?: NonNullable<UserDefaults['appearance']>[K] | null };
};

export interface UserDefaults {
  engineConfigs?: Partial<Record<AgentEngineKind, Partial<AgentConfig>>>;
  projectEngineConfigs?: Record<string, Partial<Record<AgentEngineKind, Partial<AgentConfig>>>>;
  /** §4 — 신규 에이전트 기본 설정(미설정 필드는 `DEFAULT_AGENT_CONFIG`). */
  agentConfig?: Partial<AgentConfig>;
  /** §4 — 외관. 미설정 값은 각 공통 resolver의 내장 기본값을 사용한다. */
  appearance?: {
    uiLocale?: UiLocale;
    /** §4 앱 테마 id(없으면 `DEFAULT_APP_THEME_ID`, 사용자 테마는 `custom:` 접두). 파일이 사라져도 지우지 않는다 — 기본 테마로 떨어질 뿐, 파일을 되돌리면 돌아온다. */
    themeId?: string;
    /** 원형 버블의 표면 표현. 미설정 = `DEFAULT_BUBBLE_SKIN`. */
    bubbleSkin?: BubbleSkin;
    /** 연결선의 표면 표현. 미설정 = `DEFAULT_BUBBLE_EDGE_STYLE`. */
    edgeStyle?: BubbleEdgeStyle;
  };
  notifications?: UserNotificationDefaults;
  /** §4 — 권한. 첫 칸은 §5.3 #12-4 (J) 검증 실행 전 차단 스위치. */
  permissions?: UserPermissionDefaults;
  /** §4 — 고급(API 키·bin 경로·debug). */
  advanced?: UserAdvancedDefaults;
  /** §5.25 (C) — 첫 진입에서 고른 엔진. 없으면 관문이 뜨고 있으면 다시 묻지 않는다. 기본 엔진은 `agentConfig.provider` 가 들고, 이 값은 "물어봤다"와 고른 것의 기록이다. */
  engineChoice?: EngineChoice;
  /** §5.13 (N) — 설치된 내부 앱 id(무거워 기본 번들에 없는 독립 앱). 앱마다 필드를 두면 `UserDefaults` 가 같이 자라 목록 하나로 받는다(`enabledPlugins` 와 같은 모양). 설치는 기기에 매여 전역 1건. */
  installedApps?: string[];
  /* §5.10 — `brainByProject` 는 걷었다. 자동 목표 켬/끔은 체크포인트 `autoGoalSettings`(3층)가 든다 — 사는 곳·층수가 달라 옛 값을 옮겨 읽지 않는다. */
  /**
   * @deprecated v4.46 에서 `installedApps` 로 일반화됐다. 읽기 전용 하위호환 —
   * 이 값이 있으면 Vibistudio 가 설치된 것으로 본다. 새로 쓰지 않는다.
   */
  videoStudio?: {
    installed: boolean;
    installedAt?: number;
    assetPackVersion?: string;
  };
  /** §4 — Version 탭에서 고른 `claude` 실행본 경로(빈 값 = `resolveClaudeBin` 자동 탐색). 파일이 있으면 최우선. `subAgentManager` 가 모듈 로드 때 1회 캡처하므로 변경은 다음 실행부터. */
  claudeBinPath?: string;
  /**
   * §4 — Claude Code CLI 를 앱 켤 때마다 최신으로 둘지(**미설정 = 켬**, `enabled !== false`). 부팅 때 1회 `getClaudeVersionInfo` → `isOutdated` 면 `installLatestClaude()` 를 조용히 돌린다.
   * 끄면 자동만 멈추고 [지금 업데이트]는 그대로. ⚠ 앱 자동 업데이트(electron-updater)와 별개 축이라 토글을 공유하지 않는다 — 앱 업데이트는 항상 자동.
   */
  claudeAutoUpdate?: {
    enabled?: boolean;
  };
  /** §4 (앱 전용 엔진) — 코덱스 앱 전용 사본을 켤 때 + 6시간마다 최신으로 둘지. `claudeAutoUpdate` 와 같은 규칙(미설정 = 켬), 끄면 자동만 멈춘다. */
  codexAutoUpdate?: {
    enabled?: boolean;
  };
  /**
   * §4 (앱 전용 엔진) ④ — Version 탭 코덱스 칸에서 보조로 고른 `codex` 경로. 빈 값 = 기본(앱 전용 사본 → PATH·공식 독립 설치).
   * `claudeBinPath` 와 같은 규칙 — 파일이 있을 때만, 앱 전용 폴더 안이면 기본과 같다. 고른 설치본의 갱신은 그 주인 몫이다.
   */
  codexBinPath?: string;
  /**
   * §5.11 — 프로젝트별 활성 플러그인(키 = 프로젝트 루트 절대경로). 표시명 키면 basename 충돌로 남의 설정을 물려받는다.
   * 키 없음 = 구 전역 `enabledPlugins` → `enabledByDefault`. 배열이면 그게 진실(없는 id 는 비활성). 비활성은 기여 미등록일 뿐 데이터는 지우지 않는다.
   * 판정은 반드시 `resolveEnabledPluginsFor`/`isPluginEnabledFor`(@vibisual/plugins) — 창·클라 호스트·서버 관문이 각자 해석하면 조용히 갈린다.
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
  /** §4 — 마지막 갱신 시각(ms). PUT 응답·broadcast 디버그용. */
  updatedAt: number;
}

// ─── 플러그인 커널 (§5.11) ───

/**
 * 기여 종류(§4 확장 포인트 표). 호스트가 슬롯을 열지 않은 이름은 예약일 뿐이라 선언하면 PluginsWindow 가 "이 버전에서 미지원"으로 표시한다.
 * 슬롯은 되돌리기 어려워 실제 수요가 있는 것만 연다.
 */
export type PluginContributionKind =
  | 'bubbleBadge'
  | 'panelSection'
  | 'settingsSection'
  /**
   * §5.11 — 집행 슬롯: 켜면 그 플러그인의 지시 블록이 에이전트의 매 턴 프롬프트에 실린다. 표시 슬롯과 달리 `clientOnly: false`, 서버가 조립한다.
   * 임의 코드는 아니다 — 돌려주는 것은 문자열 한 덩어리, 파일 접근은 호스트가 넘긴 `fileExists`/`readFile`(루트 밖 금지)뿐이다.
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

/** 플러그인 매니페스트 — 순수 데이터(React·node 의존 ❌). 구현과 나눠 PluginsWindow 가 비활성 플러그인 코드를 건드리지 않고 목록을 보인다. */
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
  /**
   * §5.11 노출 게이트 — `true` = 그 폴더 `enforce.ts` 가 `probe`(훑어 규칙을 보탬) 또는 `survey`(훑은 근거를 카드에)를 가졌다. 없으면 켜도 고정 문장만 실리고 Plugins 목록엔 §7.7 디버그 모드에서만 선다.
   * 켬/끔(`enabledPluginsByProject`)과 다른 축 — 숨겨져도 켜져 있으면 집행은 실린다. `readiness.test.ts` 가 매니페스트와 집행 모듈을 대조한다.
   */
  enforcesProject?: boolean;
  /**
   * §5.5 #17-44 ⑧(d) — 켬/끔 손잡이가 그 기능 자신의 화면에 있는가. `true` 면 Plugins 목록(디버그 모드 포함)·켠 개수에서 빠지고 집행 배럴(`activePromptModules`)·카드 호스트가 켬 집합을 묻지 않는다
   * (그 기능의 스위치가 판정 — 관문이 둘이면 "켰는데 안 돈다"가 숨는다). `enforcesProject: true` 인 카드만 쓸 수 있다 — 손잡이 없는 카드가 들면 어디서도 못 끄는데 프롬프트에 실리는 유령이 된다(`readiness.test.ts` 가 대조).
   */
  ownToggle?: boolean;
}

// ─── Model Registry (§4) ───

/**
 * 모델 패밀리 alias(UI 드롭다운 + `--model`). known 은 `MODEL_FAMILY_DEFAULTS`(가격·컨텍스트)가 있는 패밀리, 그 밖은 `(string & {})` 로 받아 `DEFAULT_PRICING`/`DEFAULT_CONTEXT_LIMIT` 로 폴백한다.
 * 이 유니온은 `MODEL_FAMILY_DEFAULTS` 키와 같아야 한다(`Record<KnownModelFamily,…>` 라 빌드가 잡는다) — 출시된 패밀리가 빠지면 단가·컨텍스트가 폴백값이 된다.
 */
export type KnownModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'mythos';
export type ModelFamily = KnownModelFamily | (string & {});

/** CLI 내장 슬래시 명령(`/` 자동완성, §5.5 #17-2). 목록은 `BUILTIN_SLASH_COMMANDS`(Anthropic 공개 문서). 표시 전용 — 서버는 친 텍스트를 그대로 넘기고 받을지는 CLI 가 정한다. */
export interface BuiltinSlashCommand {
  /** 슬래시를 뗀 이름 (예: `compact`). */
  name: string;
  /** 한 줄 설명 — 공개 문서 표의 첫 문장. */
  description: string;
  /** 같은 명령을 부르는 다른 이름들 (예: `clear` 의 `reset`·`new`). */
  aliases: readonly string[];
}

/** §4 — 이 명령이 화면 있는 터미널을 요구하는가. 근거는 CLI 의 공개 동작: 헤드리스에 보내면 `"/X isn't available in this environment."` 로 답하고 턴을 끝낸다(API 호출 0). */
export type SlashCommandAvailability = 'anywhere' | 'terminal-only';

/** 모델 풀ID 레지스트리 항목. 같은 id 면 `api` 가 displayName/createdAt 등을 덮되 시드의 pricing/contextWindow 는 보존한다(API 는 가격을 주지 않는다). */
export interface ModelRegistryEntry {
  /** Anthropic 풀 모델 ID (예: `claude-opus-4-8`). */
  id: string;
  /** 패밀리 — id 접두(`claude-<family>-`)로 추론, 임의 패밀리 수용. */
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
   * `seed` = 공개 문서에서 옮긴 `AVAILABLE_AGENT_MODEL_FULL_IDS`(기본) · `api` = `/v1/models` 머지(`ANTHROPIC_API_KEY` 있을 때) · `observed` = 이 PC 대화록의 실제 API 응답에 찍힌 ID(§4 상태바 모델 칸 ③(다)) — 키 없는 사용자의 api 대신, 가격을 몰라 "추정".
   * CLI 실행본 raw scan 은 쓰지 않는다 — 약관상 역설계 소지가 있고 공개 문서 시드로 충분하다.
   */
  source: 'seed' | 'api' | 'observed';
  /** `source === 'observed'` 일 때 처음 본 시각(ms). 캐시 상한을 넘으면 오래된 것부터 버린다. */
  observedAt?: number;
}

/** 모델 가격표 (per 1M tokens, USD). */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /**
   * 프롬프트 길이 구간 요금 — 한 요청의 프롬프트(입력 + 캐시 읽기·쓰기)가 `aboveTokens` 를 넘으면 요청 전체가 이 단가다(공개 가격표 "Long context pricing" — 지금은 Haiku 5.5 의 10만 토큰뿐, §4 ⑧).
   * 요청 단위로만 가를 수 있어 `calculateTokenCost(…, { singleRequest: true })` 에서만 적용된다.
   */
  longPrompt?: {
    aboveTokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/** 부팅 때 지어 클라에 보내는 레지스트리. `seed-only` = 시드만(키 없을 때의 표준) · `api-merged` = 시드 + `/v1/models`. WS `model_registry_updated` 로 갱신, 영속 ❌(서버 `.vibisual/model-registry.json` TTL 캐시는 별개). */
export interface ModelRegistry {
  entries: ModelRegistryEntry[];
  updatedAt: number;
  /** §4 — 출처(시드·`/v1/models`·실행본 강도 등급)를 마지막으로 확인한 시각(ms). `updatedAt` 은 관측 한 건에도 바뀌므로 "목록 확인 N분 전"은 이 값(없으면 `updatedAt`). */
  checkedAt?: number;
  sourceMix: 'seed-only' | 'api-merged';
  /**
   * §4 — 설치된 `claude` 가 받는 `--effort` 값. 부팅 때 `claude --help` 의 `--effort <level> (...)` 를 파싱한다(하드코딩 ❌). `'default'` 는 넣지 않는다(UI 가 앞에 붙인다).
   * 파싱 실패면 undefined → `listEffortLevels` 가 `AVAILABLE_EFFORT_LEVELS` 로 폴백. `model_registry_updated` 로 함께 간다(별도 메시지 ❌).
   */
  effortLevels?: string[];
}

/**
 * §4 — `--agents` 로 나가는 세션 한정 서브에이전트 정의. 이름을 필드로 든 배열로 들고(순서·이름 수정) CLI 로 나갈 때만 `{ "<이름>": {...} }` 객체로 뒤집는다(`buildAgentsFlagJson`).
 * CLI 는 `description`·`prompt` 를 둘 다 요구한다 — 하나라도 비면 그 항목은 버린다(반쯤 찬 정의는 스폰을 죽인다).
 */
export interface AgentDefinition {
  /** 서브에이전트 이름 = `--agents` JSON 의 키. 소문자·하이픈만(CLI 규칙). */
  name: string;
  /** 언제 이 서브에이전트에게 맡길지 — 모델이 위임을 판단하는 근거다. 필수. */
  description: string;
  /** 시스템 프롬프트. 필수. */
  prompt: string;
  /** 쓸 수 있는 도구. 비우면 부모 도구를 물려받는다. */
  tools?: string[];
  /** 모델 — alias(`opus`/`sonnet`/`haiku`/`fable`)·풀ID·`inherit`. 비우면 CLI 기본 해소 순서. */
  model?: string;
}

/** 에이전트 설정 — 디테일 패널에서 편집, ProjectCheckpoint에 저장 */
export interface AgentConfig {  /** 사용 모델 (예: "sonnet", "opus", "haiku") */
  model: string;
  /** 허용 도구 목록 (예: ["Read", "Write", "Edit", "Bash"]) */
  tools: string[];
  /** §4 — 도구 백필이 적용된 세대(없으면 0). `AGENT_TOOLS_BACKFILL_GEN` 보다 낮으면 새 내장 도구를 한 번 채우고 올린다 — 도장 없이 매 복원 백필하면 사용자가 끈 도구가 재시작마다 되살아난다. */
  toolsBackfillGen?: number;  /**
   * 퍼미션 모드 — **우리 저장값**(default/acceptEdits/auto/dontAsk/plan/bypassPermissions).
   * CLI 로 나갈 때는 `toCliPermissionMode` 를 거친다(`default` → `--permission-mode manual`).
   * 저장값을 그대로 CLI 에 넘기지 마라 — 2026-08-14 부터 무플래그 기본이 `auto` 라 "Manual" 이
   * 자동 승인으로 둔갑한다(§4 CLI 사양 추종 규약 2).
   * §5.3 #12-1 v1.87 — 권한 승인의 **유일 축**. 서버 `/api/permission-check` 게이트가 이 값+도구타입으로
   * Vibisual 승인 팝업 발동을 결정(default=가변도구 확인 / bypassPermissions=무확인 / acceptEdits=편집자동 / plan=실행없음).
   */
  permissionMode: string;  /**
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
   * §5.3 #12-1-A — 도구별 확인 목록: `permissionMode` 가 무엇이든(`bypassPermissions` 포함) 실행 전에 승인 카드(`PermissionPromptStack`)를 만난다. `tools`·`disallowedTools` 와 직교("쓸 수 있되 물어보고").
   * 비면 꺼짐(고른 모드를 말없이 무르지 않는다). 판정은 `shouldAskForTool` 한 곳(훅·로컬 경로 공용).
   */
  askTools?: string[];
  /** §5.5 #17-20 ⑥ — MCP 서버 프리셋 id(`MCP_SERVER_PRESETS`). `buildConfigArgs` 가 `--mcp-config <생성 파일>` + `--allowedTools mcp__<id>` 를 싣는다(헤드리스·CMD 공용). */
  mcpServers?: string[];
  /**
   * §5.3 — 세션을 넘는 자기 기억 범위. `buildConfigArgs` 가 `--settings <생성 파일>`(`autoMemoryDirectory`)로 폴더를 가르고, `'off'` 는 환경변수로 자동 기억을 끈다.
   * undefined = 레포 공용 · `'user'` = `~/.claude/agent-memory/<이름>/` · `'project'` = `<프로젝트>/.claude/agent-memory/<이름>/` · `'local'` = `<프로젝트>/.claude/agent-memory-local/<이름>/`.
   */
  memory?: AgentMemoryScope;
  /** §5.3 — 이 아래로 서브에이전트를 몇 층까지(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). `1` = 중첩 없음, undefined = CLI 기본(3층). */
  subagentDepth?: number;
  /** 에이전트 개별 규칙 (마크다운). 실행 시 프롬프트에 주입 */
  rules?: string;
  /**
   * §5.3 #28 (K) — Rules 변경 히스토리(실제로 바뀌었을 때만 push, `RULES_HISTORY_MAX` FIFO). label: `auto:conti-on`/`auto:conti-off` = 콘티 모드 진입·해제 직전 · `manual` = 직접 편집.
   * 쓰기는 서버 `PUT /api/agent-config/:id` 만 — 클라가 직접 고치지 않는다.
   */
  rulesHistory?: RulesHistoryEntry[];
  /** §5.3 #28 — Custom Mode 축(permissionMode 와 직교). undefined = 비활성 · `conti` = 콘티모드 · `review`/`debug` = 저장만(본체 미구현). */
  customMode?: ContiCustomMode;
  /** §4 — Opus 1M 컨텍스트(기본 = 1M, `'200k'` 만 opt-out 으로 저장). Opus 일 때만 `buildConfigArgs` 가 alias 를 `claude-opus-4-7[1m]` 로 매핑하고, 다른 모델은 무시한다. */
  contextWindow?: '1m' | '200k';
  /** §4 — 초기화에 쓴 프리셋 트레이스(배지용). 폼을 고쳐도 무효화하지 않는다. undefined = 수동 구성. */
  presetId?: string;
  /** §4 — 모델 풀ID 핀. undefined = `model` alias 의 현재 latest. 있으면 `buildConfigArgs` 가 resolveAliasToLatest 를 건너뛰고 그대로 넘긴다. */
  modelVersion?: string;
  /**
   * §4 — 실행 모드(`permissionMode`/`customMode` 와 직교). undefined/`'headless'` = `claude -p`(프로그래매틱 과금) · `'interactive-terminal'` = IDE 안 PTY 에서 사용자가 직접 모는 REPL(구독 과금).
   * 위장 우회 ❌ — 사람이 루프 안에 있는 진짜 인터랙티브 세션 전용(Anthropic ToS 합법선).
   */
  executionMode?: ExecutionMode;
  /**
   * §4 (CMD 터미널 업그레이드 ⑧) — CMD 버블이 띄울 CLI(헤드리스는 무시, undefined = `'claude'`). `'claude'` 가 아니면(`managed === false`) `--resume`·rules `--add-dir`·`VIBISUAL_OWNER_AGENT_ID` 를 걸지 않는다 —
   * 우리 훅의 자식이 아니다(§5.5 #17-20 ④ 실행 런처와 같은 규율).
   */
  cliKind?: CmdCliKind;
  /** §5.19 — 말을 거는 상대(`executionMode` 와 직교). **undefined = claude 경로 그대로** — 서버는 이 값 하나로만 가른다. */
  provider?: AgentProvider;
  /**
   * §4 — API 비용 상한(달러, 초과 시 런 중단, 0/undefined = 무제한). `--max-budget-usd` 는 `--print` 전용이라 설정하면 persistent 재사용/Agent View 를 끄고 매 턴 fresh `--print` 로 스폰한다.
   * 구독 과금(interactive-terminal) 경로엔 걸지 않는다.
   */
  maxBudgetUsd?: number;
  /** §4 — 기본 모델이 과부하/불가일 때의 `--fallback-model`(콤마로 여럿, 순서대로 — CLI 는 매 턴 1순위부터). `--print` 전용이라 `maxBudgetUsd` 와 같은 printFlags 자리에서만 붙는다. */
  fallbackModel?: string;
  /** §4 — `--autocompact`: `'auto'` = CLI 판단, 그 외는 토큰 수 문자열(100k~1M, 예: `'200000'`). undefined = 플래그 없음. */
  autoCompact?: string;
  /**
   * §4 — 에이전트가 스스로 압축을 요청하게 할지. 켜면 프롬프트에 `POST /api/agent-compact` 안내가 실리고, 압축은 그 턴이 끝난 뒤 큐에서 돌아 작업이 잘리지 않는다.
   * 서버 경유인 이유: 헤드리스엔 `SlashCommand` 도구가 없어(실측 2.1.247) `/compact` 를 직접 못 부른다. 끄면 안내도 안 실린다.
   */
  agentCanCompact?: boolean;
  /** §4 — `--exclude-dynamic-system-prompt-sections`: 기기마다 다른 절(cwd·환경·기억 경로·git 상태)을 첫 사용자 메시지로 옮겨 프롬프트 캐시 적중을 올린다. 기본 false. */
  excludeDynamicSystemPromptSections?: boolean;
  /** §4 — `--setting-sources`: `'user' | 'project' | 'local'` 부분집합. 비면 CLI 기본(전부 로드). */
  settingSources?: string[];
  /** §4 — `--safe-mode`: CLAUDE.md·스킬·플러그인·훅·MCP·커스텀 에이전트를 모두 끄고 실행(진단용). ⚠ 훅이 꺼져 버블맵에 실시간으로 안 잡힌다. */
  safeMode?: boolean;
  /**
   * §4 (CLI 사양 추종) — `--betas`. API 요청에 실을 베타 헤더 목록.
   * **API 키 사용자 전용** — 구독 인증에서는 CLI 가 경고 한 줄과 함께 무시한다.
   * undefined/빈 배열 = 미설정.
   */
  betas?: string[];
  /**
   * §4 (CLI 사양 추종) — `--include-hook-events`. 훅 생명주기를 스트림에도 시간순으로 끼운다(settings 훅 통로로는 대화록의 어느 자리인지 모른다).
   * `system` 줄 `hook_started`·`hook_progress`·`hook_response` 로 온다 — 파서 `hookEvents` 옵션과 한 쌍(플래그만으론 변화 없음). stream-json 전용.
   */
  includeHookEvents?: boolean;
  /**
   * §4 (CLI 사양 추종) — `--agents`. 이 세션에만 있는 서브에이전트 정의(디스크에 안 남아 다른 프로젝트에 새지 않는다). 빈 배열/undefined = 미설정.
   * ⚠ `Task` 가 `tools` 에 없으면 정의해도 부를 수 없다(§4 규약 (3)).
   */
  agentDefinitions?: AgentDefinition[];
  /**
   * §4 (CLI 사양 추종) — `--plugin-dir`. 폴더나 `.zip` 을 이 세션에만 플러그인으로 얹는다(반복 가능). 빈 배열/undefined = 미설정.
   * ⚠ Vibisual 플러그인(§5.11, 매 턴 프롬프트 집행 블록)과 무관하다 — 이쪽은 Claude Code 자신의 형식(`.claude-plugin/plugin.json`).
   */
  pluginDirs?: string[];  /**
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
   * §5.3 #9-1 (J축) — Bash 출력이 문맥에 들어올 때의 문자 수 상한(env `BASH_MAX_OUTPUT_LENGTH`). undefined = CLI 기본 30,000자.
   * 입력 토큰의 96.5%가 `cache_read`(실측)라 한 번 실린 큰 출력은 세션 끝까지 턴마다 되읽힌다 — 자를 자리는 들어올 때뿐이다.
   */
  bashMaxOutputChars?: number;
  /**
   * §5.3 #9-1 (J축) — MCP 도구 출력의 토큰 상한. 스폰 env `MAX_MCP_OUTPUT_TOKENS`.
   * undefined = 미설정. MCP 서버를 안 붙인 에이전트에는 아무 효과가 없다(§5.5 #17-31 과 직교).
   */
  mcpMaxOutputTokens?: number;
  /**
   * §5.3 #9-1 (K축) — 모델이 **한 턴에 쓰는** 출력 토큰 상한. 스폰 env `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
   * undefined = 미설정(모델 기본). 출력은 입력의 5배 단가라 긴 답을 자주 쓰는 에이전트에서 의미가 있다.
   */
  maxOutputTokens?: number;
  /**
   * §5.3 #9-1 (K축) — 확장 사고에 쓸 토큰 상한. 스폰 env `MAX_THINKING_TOKENS`.
   * undefined = 미설정. `thinking`(켜고 끔)·`effort`(깊이 등급)와 **직교**하는 양의 축이다.
   */
  maxThinkingTokens?: number;
  /**
   * §5.3 #9-1 (L축) — 자동 압축 발동 점유율(1~100, env `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`). undefined = CLI 기본. 낮추는 쪽만 먹는다.
   * `autoCompact`(어느 창 크기에서)와 다른 축(그 크기의 몇 %에서). 압축 자체가 큰 요청이라 너무 낮추면 손해다.
   */
  autoCompactPct?: number;
  /**
   * §5.3 #9-1 (M축) — 제목 생성·요약 같은 비필수 배경 모델 호출을 끈다(env `DISABLE_NON_ESSENTIAL_MODEL_CALLS`). undefined/false = 미설정.
   * 탭 제목은 `deriveTabTitle` 이 무과금으로 뽑아 이 호출로 얻는 것이 거의 없다.
   */
  disableNonEssentialModelCalls?: boolean;
  /**
   * §4 (Fast 모드) — 같은 Opus 를 출력 속도만 빠르게(작은 모델이 아니다). Opus 계열(`supportsFastMode`) 밖에선 CLI 가 조용히 무시. undefined/false = 미설정.
   * ⚠ CLI 플래그가 아니다 — 헤드리스 스폰은 SDK 세션으로 분류돼 막히고(`sdk_opt_in_required`) 해제 창구는 `--settings` 의 `flagSettings` 층뿐이라
   * 설정 파일로 나간다(`buildConfigArgs` → `prepareAgentSettings`). `userSettings` 에 넣어도 안 풀린다.
   */
  fastMode?: boolean;
  /**
   * §4 (Thinking on/off) — 확장 사고를 켜고 끄는 축(`effort` 와 직교). CLI 플래그가 아니라 settings 키 `alwaysThinkingEnabled` 라 설정 파일로 나간다.
   * Fast 모드와 같은 한 장에 싣는다 — `--settings` 를 두 번 주면 뒤엣것이 앞엣것을 통째로 덮는다.
   * 기본 켬(undefined). 명시 `false` 일 때만 싣는다 — 켬에 `true` 를 쓰면 사용자가 `~/.claude/settings.json` 에서 꺼 둔 것을 되켠다.
   */
  thinking?: boolean;
  /**
   * §4 (스트림 3종 ①) — `--forward-subagent-text`. 중첩 서브에이전트(Task)의 말·사고를 `parent_tool_use_id` 를 달아 부모 스트림으로 흘린다.
   * 기본 켬(undefined), 끄려면 명시 `false` — 터미널에선 보이는데 우리 화면에서만 안 보이면 결함이다. `--print` 전용(CMD 경로엔 안 붙는다).
   */
  forwardSubagentText?: boolean;
  /** §4 (스트림 3종 ②) — `--replay-user-messages`. stdin 으로 보낸 사용자 메시지를 `isReplay: true` 로 되돌려 준다 — "CLI 가 명령을 접수했다"는 유일한 스트림 신호. undefined/false = 미설정. */
  replayUserMessages?: boolean;
  /**
   * §4 (스트림 3종 ③) — `--prompt-suggestions`. 턴마다 다음 프롬프트 예측을 `prompt_suggestion` 으로 보낸다. undefined/false = 미설정.
   * ⚠ probe 에서 관측되지 않았다(서버 측 게이팅 추정) — 수신 쪽은 payload 모양을 단정하지 않는다.
   */
  promptSuggestions?: boolean;
}

/** §4 — 커스텀 에이전트 실행(스폰) 모드. 'headless' = `claude -p` 백그라운드 스폰, 'interactive-terminal' = IDE 임베디드 PTY REPL. */
export type ExecutionMode = 'headless' | 'interactive-terminal';

/** §4 (CMD 터미널 ⑧) — CMD 버블이 띄울 CLI 종류(undefined = `'claude'`). 실행 파일·인자·훅 귀속은 `CMD_CLI_KINDS` 표가 정한다 — 새 CLI 는 표에 한 줄(§3.3). */
export type CmdCliKind = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'aider' | 'shell';

/** §4 (CMD 터미널 ①) — 터미널 출력에서 읽은 세션 상태. `SubAgentStatus` 와 다른 축 — 서버가 `blocked`·`lastActivityAt` 로 옮기고 상태 유니온은 늘리지 않는다(§2.4). */
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

// Conti Mode (§5.3 #28)

/** 커스텀 에이전트의 Vibisual Custom Mode 값. undefined=비활성. 'conti' 만 본 라운드에서 동작. */
export type ContiCustomMode = 'conti' | 'review' | 'debug';

/** §5.3 — 커스텀 에이전트의 자기 기억 범위. `'off'` = 기억하지 않음, 나머지는 기억 폴더 위치. */
export type AgentMemoryScope = 'off' | 'user' | 'project' | 'local';

/** §5.3 #28 (K) — Rules 변경 히스토리 1건. */
export interface RulesHistoryEntry {
  /** 변경 시각 (ms) */
  ts: number;
  /** 이 항목 시점의 rules 본문 (덮어쓰기 직전 값) */
  rules: string;
  /** 변경 사유 라벨 — 자동 분류, 사용자 편집 ❌ */
  label: 'auto:conti-on' | 'auto:conti-off' | 'manual';
}

/**
 * 콘티 element 의 형태. SVG 직렬화 ❌ — 정형 JSON 이라야 patch·diff 가 안전하다.
 * `'stamp'`(§5.3 #28) = STAMP_CATALOG 컴포넌트를 이름으로 고른다(LLM 이 좌표를 계산하지 않게). 나머지 4종은 stamp 로 안 되는 도형·주석용.
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
  /** §5.3 #28 — `type==='stamp'` 일 때 필수인 STAMP_CATALOG 키. 없는 이름이면 서버 coerce 가 그 element 째 버린다. */
  stampName?: string;
  /** §5.3 #28 — stamp variant. STAMP_CATALOG[name].variants 의 키만 허용, 미지정 = 기본 모양. */
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
  /** §5.3 #28 (L) — 작업 ID. 같은 work 의 후속 응답이 같은 workId 로 와 서버가 신규/수정을 가른다. 트리거 측이 발급, 빈 문자열 허용(옛 체크포인트 호환). */
  workId: string;
  /** §5.3 #28 (L) — 마지막 수정 시각(생성 직후엔 createdAt, 같은 workId 후속 응답이 frames 를 바꾸면 갱신). */
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

/** §5.13 (Q) — 콘티를 받아 간 내부 앱의 산출물 한 줄. `appId` 는 코어가 해석하지 않는다(§5.13 (P-4)) — 코어에 앱 이름을 박지 않도록 앱이 준 id 를 그대로 적는다. */
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

/** §5.13 (Q) — 출력 프리셋 한 벌(출력 판형). 컷 좌표계(`CONTI_DEFAULTS.viewBox*`)는 여기 두지 않는다 — 프리셋마다 갈면 프리셋을 바꾸는 순간 그려 둔 콘티가 어긋난다. */
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

/** §5.3 #28 (L) — 콘티 작업 발급 출처: `user_new` = `POST /api/conti/generate` · `task_edge` = Task Edge 가 conti-mode 에이전트로 dispatch · `agent_session` = 외부 트리거 없는 LLM 자체 발화. */
export type ContiWorkSource = 'user_new' | 'task_edge' | 'agent_session';

/** §5.3 #28 (L) — 콘티 인플라이트 작업(agentId 당 0~1건). 첫 응답이 Conti 를 만들면 `contiId` 가 채워지고 같은 workId 후속 응답이 그것을 갱신한다. 영속화 ❌. */
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

/** Codex CLI recovery progress parsed from diagnostics, without changing terminal status. */
export type CodexTransportNotice =
  | { kind: 'reconnecting'; attempt: number; maxAttempts: number }
  | { kind: 'fallback' };

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
  /** tool_use ↔ tool_result 짝짓기 키(API 의 tool_use_id). 재시작 전 버퍼 이벤트엔 없을 수 있어 선택적 — 클라는 있으면 ID, 없으면 FIFO 로 짝짓는다. */
  toolUseId?: string;
  /**
   * §5.25 (O) — 이 줄이 그림 한 장이면 그 파일의 절대경로. 새 `StreamEventType` 대신 `text` 에 얹는다 — 종류를 열거하는 자리(턴 봉인·검색·영속…) 하나만 놓쳐도 그 턴이 어긋난다.
   * 경로는 화면으로 나가지 않는다 — 클라는 이벤트 `id` 로 청하고 서버가 자기 기록에서 읽는다. `content` 엔 파일 이름을 적는다(그림 못 그리는 자리에서 빈 턴으로 읽히지 않게).
   */
  imagePath?: string;
  /**
   * **턴 세대 도장** — 이 줄을 낳은 명령(`QueuedCommand.id`). 도착 시각으로 블록을 가르면 [중지]·덧말 뒤 늦게 온 앞 턴의 줄이 새 블록에 그려진다.
   * `task_notification` 은 그 작업을 시작한 턴의 도장을 물려받는다. 재시작 전 버퍼·훅 경로엔 없을 수 있다(시각 기준 폴백).
   */
  turnId?: string;
  /**
   * §4 (스트림 3종) — 이 줄을 낳은 바깥 Task 호출(`--forward-subagent-text` 원문의 `parent_tool_use_id`). 클라가 그 `tool_use` 아래에 접어 그린다.
   * `toolUseId`(이 줄이 가리키는 호출)와 다른 축. 미설정 = 부모 자신이 한 말.
   */
  nestedUnderToolUseId?: string;
}

// Canvas Clipboard (§5.4 #29) — 내부 클립보드 페이로드(localStorage 단일 슬롯 + POST /api/canvas/paste). 시스템 클립보드와 분리.

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
  // Task Edge 옵션 전부를 그대로 옮긴다.
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

// §5.3 #10-2 — Auto Agent (메타 에이전트)

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

/** 들어온 요청의 복잡도 휴리스틱 판정값 */
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
  /** §5.3 #10-3 — 진행 중인 검증 런의 `runId`. Summary 는 새 요청이 덮으므로 증거·기준·예산은 `AutoAgentRun` 에 두고 여기엔 포인터만. */
  currentRunId?: string;
}

/** §5.3 #10-3 — 검증 증거 한 건(실행한 것과 결과 — 자연어는 증거가 아니다). `ok` 는 서버가 `exitCode === 0` 으로 계산한다(에이전트가 주장할 수 없다). */
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

/** §5.3 #10-3 — 검수자 판정. `held` = 판정 불명(스키마 위반·증거 없는 approve) → **승인으로 흘리지 않는다**(fail-closed). */
export type VerificationVerdict = 'approve' | 'reject' | 'held';

/** §5.3 #10-3 — 런이 사람을 부르는 이유 */
export type EscalationReason =
  | 'budget-exhausted'
  | 'verification-failed'
  | 'irreversible-action'
  | 'no-evidence';

/** §5.3 #10-3 — 런 상태. `verified` 는 통과 증거가 1개 이상일 때만 붙는다(서버 판정). */
export type AutoAgentRunStatus = 'running' | 'verified' | 'escalated' | 'abandoned';

/** §5.3 #10-3 — 검증 런(요청 1건 = 런 1개). 완료를 LLM 의 문장이 아니라 서버가 보관한 증거로 판정한다. `runId` 키라 이력이 남는다(Summary 는 새 요청이 덮는다). */
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

// §4 — 자동 업데이트(electron-updater + GitHub Releases). 그래프 데이터가 아니라 Electron shell 상태라 server 코어를 거치지 않고
// main↔renderer 전용 IPC(`vibisual:update:*`)로만 흐른다(§5.4 #14-1 선례). 아래는 그 페이로드 계약.

/**
 * 자동 업데이트 진행 단계. `available` 은 autoDownload 라 곧 `downloading`(`percent`/`bytesPerSecond`)으로 넘어가고,
 * `downloaded` 는 재시작하면 적용(사용자 대기), `error` 는 체크/다운로드 실패(`error` 메시지).
 */
/**
 * §4 — 업데이트 전달 방식(판정·이유는 `updateDelivery.ts`). `auto-install` = electron-updater 가 받아 재시작 시 적용(Windows·Linux·서명된 macOS),
 * `self-install` = 우리가 직접 받아 교체(무서명 macOS). 릴리스 페이지 열기는 전달 방식이 아니라 실패 때의 복구 손잡이다.
 */
export type UpdateDelivery = 'auto-install' | 'self-install';

/**
 * `self-install` 이 중단된 이유. **화면 문구는 이 코드로 고른다** — main 이 만든 영어
 * 문장을 그대로 그리면 12개 로케일이 한꺼번에 영어가 된다(i18n `header.update.failed.*`).
 * 사람이 읽을 원문은 `UpdateState.error` 에 따로 남아 진단 로그로 간다.
 */
export type UpdateErrorCode =
  | 'download-failed'
  | 'checksum-mismatch'
  | 'arch-mismatch'
  | 'mount-failed'
  | 'not-writable'
  | 'install-failed';

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
  /**
   * **지금 설치하면 깔리는 버전**(다 받아 디스크에 있는 것). 설치의 유일한 근거다(`quitAndInstall`).
   * `newVersion` 과 따로 둔다 — 0.1.19 를 받아 둔 채 0.1.20 을 받는 동안 둘은 다르고, 겸하면 실패 때 되돌아갈 곳을 잃는다. 없으면(구버전 main 포함) 받아 둔 것이 없다.
   */
  readyVersion?: string;
  /** 다운로드 진행률 0~100 (downloading 일 때). */
  percent?: number;
  /** 다운로드 속도 (bytes/sec, downloading 일 때). */
  bytesPerSecond?: number;
  /** 릴리스 노트 (available/downloaded 일 때, 있으면). */
  releaseNotes?: string;
  /** 에러 메시지 (phase==='error' 일 때). */
  error?: string;
  /**
   * 실패 사유 코드 (phase==='error' 이고 self-install 경로일 때). optional —
   * 구버전 main 이 보낸 상태에는 없다(§3 하위 호환). 없으면 UI 는 일반 실패 문구를 쓴다.
   */
  errorCode?: UpdateErrorCode;
  /** 마지막 체크 완료 시각 (ms). */
  checkedAt?: number;
  /**
   * 이 플랫폼에서 업데이트가 어떻게 적용되는지. **미설정이면 `'auto-install'` 로 읽는다**
   * — 신규 전송 필드는 항상 optional + 기본값 폴백(§3 하위 호환 규칙).
   */
  delivery?: UpdateDelivery;
}

// §4 모바일 웹 접속 — desktop shell 상태(main 의 mobileAccess 매니저가 SSOT, renderer 는 표시만). 그래프 데이터에 관여하지 않고 전용 IPC 로 흐른다.

/**
 * §4 UPnP 외부 개방 상태. `idle` 꺼짐(LAN 전용) · `mapping` 공유기에 개방 요청 중 · `active` 외부 접속 가능(공인 IP + HTTPS 매핑).
 * `unavailable` = CGNAT/사설 IP 라 구조적으로 불가(수동도 불가, VPN 필요) · `error` = UPnP 미지원/꺼짐 등(수동 포트포워딩으로 우회 가능).
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
  /** 폰에서 열 접속 주소 후보(IPv4 인터페이스별 1개)와 그 정체. `mobileAddress.ts` 가 랜·Tailscale·WSL 을 판정해 되는 순서로 정렬·추천한다 — 클라는 가공하지 않는다. */
  addresses: MobileAddressEntry[];
  /** 현재 유효한 페어링 코드 (꺼져 있으면 null — 켤 때마다/재생성 시 새로 발급). */
  pairingCode: string | null;
  /** 현재 연결된 모바일 WebSocket 클라이언트 수. */
  clientCount: number;
  /** 페어링 실패 누적으로 잠긴 IP 가 하나라도 있는지 (코드 재생성으로 전체 해제). */
  pairingLocked: boolean;

  // §4 UPnP 외부 개방
  /** 외부 접속 허용 토글 (opt-in — 기본 false, userData 영속). */
  externalEnabled: boolean;
  /** 외부 개방 진행/결과 상태. */
  externalStatus: MobileExternalStatus;
  /** 집 밖에서 열 외부 URL(https). 공인 IP 가 있고 CGNAT 가 아니면 채운다 — UPnP 가 성공(active)이든 실패(error, 수동 포워딩)든 주소는 같다. */
  externalUrl: string | null;
  /** 실패/불가 원인 — 상태가 unavailable/error 일 때 UI 안내 분기용. */
  externalReason: MobileExternalReason;
  /** 공유기가 보고한 공인 IP (진단·수동 포트포워딩 안내에 표시). */
  publicIp: string | null;
  /** 외부에 열린 공인 포트 (수동 포트포워딩 안내에 표시). */
  externalPort: number | null;
  /** 수동 포트포워딩 시 공유기에서 이 LAN IP:포트(HTTPS)로 연결하도록 안내. */
  httpsPort: number | null;
  /**
   * 외부 HTTPS 자체 서명 인증서의 SHA-256 지문(`AB:CD:…`). 외부 리스너가 없으면 null. userData 에 영속해 재시작해도 같다.
   * 경고에 "계속"을 누르는 습관은 중간자 인증서도 넘긴다 — 대조할 값을 데스크톱에 띄워야 그 경고가 우리 것인지 가린다.
   */
  certFingerprint: string | null;
  /**
   * 껐는데도 공유기에 남아 있을 수동 포워딩 규칙이 있는가. UPnP 매핑은 임대라 저절로 닫히지만 손으로 만든 규칙은 영원히 남아 그 포트를 잡는 프로그램이 노출된다.
   * 수동 안내를 띄운 적이 있으면 영속해 두고 외부를 끈 뒤 "규칙을 지우세요"를 남긴다 — 끄는 것만으로는 안 사라지고 사용자가 확인해야 사라진다.
   */
  manualForwardPending: boolean;

  // §4 QR 페어링
  /**
   * 현재 살아 있는 QR 페어링 티켓(없거나 만료됐으면 null).
   * 발급 즉시 3분(`MOBILE_QR_TICKET_TTL_MS`) 동안만 유효하며 메모리에만 존재한다.
   */
  qrTicket: MobileQrTicket | null;
}

/** §4 — QR 페어링 티켓: 스캔하면 코드 입력 없이 세션 쿠키를 받는 시한부 딥링크 묶음. 토큰은 URL 안에만 실린다(별도 필드 ❌). */
export interface MobileQrTicket {
  /** 이 티켓으로 접속되는 딥링크들(인터페이스별 + 외부 https, QR 원문은 `url`). `addresses` 와 같은 모양이라 칩이 진짜 정체(Tailscale·WSL…)를 말한다. */
  targets: MobileAddressEntry[];
  /** 만료 시각(epoch ms) — 남은 시간 카운트다운에 사용. */
  expiresAt: number;
  /** 이 티켓으로 페어링을 마친 기기 수(표시용). */
  usedCount: number;
  /** 이 티켓으로 붙을 수 있는 기기 수 상한(`MOBILE_QR_MAX_USES`) — 화면이 "n/N 대"로 말한다. */
  maxUses: number;
}

// §4 모바일 임베디드 터미널 — /ws 다중화 프레임. 모바일 웹엔 데스크톱 IPC(`vibisual:term:*`)가 없어 기존 모바일 `/ws` 에 터미널 프레임을 싣는다(새 소켓 ❌).
// WSMessageType 에 넣지 않고 양끝(`mobileAccess.ts`·`useWebSocket`)이 `type` prefix `term_` 로 가른다.
// 보안: 셸은 LAN 접속에서만 — 외부 접속의 `term_create` 는 `term_unavailable(reason:'external')` 로 거부한다.

/** 클라 → 서버: 셸+claude prefill PTY 생성/재부착 요청. */
export interface TermCreateFrame {
  termId: string;
  cwd: string;
  config: AgentConfig;
  cols?: number;
  rows?: number;
  /** §5.5 #17-20 ④ — 있으면 claude prefill 대신 이 명령을 띄운다(실행 런처). */
  command?: string;
  /** command 를 사용자 Enter 없이 바로 실행할지. 실행 런처는 true, claude 경로는 언제나 false. */
  autoRun?: boolean;
  /** Same environment additions as desktop PTY launchers (login paths, optional email, etc.). */
  env?: Record<string, string>;
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

// §5.5 #17-20 디버그·실행 런처

/** 실행 구성의 출처 — 화면에 배지로 뜬다(사용자의 launch.json 과 우리가 추측한 것을 구분하게, §5.14 "추측을 확신처럼 굴지 않는다"). */
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

// §5.5 #17-31 — 이 프로젝트에서 쓸 수 있는 MCP 인벤토리. #17-20 ⑥ 프리셋보다 넓게, `claude mcp add` 로 붙인 것까지 Claude Code 실제 설정에서 읽는다.
// 켜짐 개념을 따로 만들지 않는다(화면과 실제가 갈리지 않게).

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

/** 켜짐 / 꺼짐 / 승인 대기는 서로 다른 상태다 — `pending` 은 `.mcp.json` 에 있으나 미승인(`claude mcp list` 의 `⏸`)이라 할 일이 `disabled` 와 다르다. */
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

// §5.5 #17-32 — 이 세션에 적용되는 Claude Code 훅 인벤토리(실제로 도는 명령·적힌 곳·방금 발동한 것).
// 세션별이다(통합 목록 ❌) — 훅은 세션의 프로젝트 경로로 갈리므로 그 프로젝트에서 읽은 것과 그 세션이 낸 발동만 센다.

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
 * §5.5 #17-32 ⑤ — 훅이 방금 발동했다는 표시용 신호. 우리 훅이 울렸으면 같은 이벤트의 다른 훅도 돌았으므로 이벤트·도구 이름만 보내고 줄은 `hookMatcherMatches` 로 고른다.
 * `graph_snapshot`·영속에 싣지 않는다(`debug_event` 규약). 짧은 창으로 모아 배열 한 건으로 보낸다 — 건건이 밀면 폭주한다(§9).
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

// §5.5 #17-33 — Claude Code 플러그인 인벤토리 + 마켓플레이스. 우리 관측 플러그인(`packages/plugins`, §5.11)과 다른 물건이다.
// 진실은 CLI 의 답(`claude plugin list --json --available`) — `installed_plugins.json` 을 직접 해석하면 CLI 가 포맷을 바꾸는 날 조용히 어긋난다.

/** 플러그인이 어느 범위에 깔렸는가. CLI 의 `--scope` 와 같은 축(그대로 되돌려 준다). */
export type ClaudePluginScope = 'user' | 'project' | 'local';

/**
 * 이 세션에 적용되는가(화면의 묶음 머리). `global` = `user` 범위 · `this-project` = `project`/`local` 이고 지금 이 프로젝트.
 * `other-project` = 다른 프로젝트에 매여 이 세션엔 안 온다 — 숨기지 않고 따로 세운다(안 보이면 "왜 없지", 섞으면 "왜 안 먹지").
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
  /** §5.5 #17-33 ⑦ — 마켓에 더 새 판이 있는가(CLI 는 두 판을 나란히 줄 뿐이라 우리가 대조). 판정은 `pluginsNeedingUpdate` 한 곳 — 배지와 자동 갱신이 같은 함수를 읽는다. */
  updateAvailable?: boolean;
  /** 마켓이 내놓은 최신 판(대조 대상). `updateAvailable` 이 참일 때만 뜻이 있다. */
  latestVersion?: string;
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

/** 마켓의 갈래 — 판단이 아니라 출처의 사실(§5.5 #17-42 ⑤). `official` Anthropic 선정 · `community` 제출·자동 보안 검사를 통과한 제3자 · `custom` 사용자가 붙인 곳(보증 없음, 칩 없음). */
export type ClaudeMarketplaceKind = 'official' | 'community' | 'custom';

/** 알고 있는 마켓플레이스 한 줄. */
export interface ClaudeMarketplaceEntry {
  name: string;
  /** `owner/repo` · URL · 로컬 경로 — 원문 그대로. */
  source?: string;
  /** 이 마켓이 내놓는 플러그인 수(집계). */
  pluginCount: number;
  /**
   * 어느 갈래인가(§5.5 #17-42 ⑤) — 공식 / 커뮤니티 / 사용자가 붙인 것.
   * **판단이 아니라 출처의 사실**이라 화면은 이것을 칩 한 개로만 적는다.
   */
  kind: ClaudeMarketplaceKind;
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
  /** §5.5 #17-33 ⑦ — 마켓 클론을 마지막으로 끌어온 시각(epoch ms). 우리가 부른 시각을 적는다(`known_marketplaces.json` 은 CLI 내부라 ② 가 막는다). 없음/0 = 갱신한 적 없다. */
  marketRefreshedAt?: number;
  /** 마지막 마켓 갱신이 실패했다면 그 사유(CLI 출력 400자 상한). 성공하면 지운다. */
  marketRefreshError?: string;
}

/** §5.5 #17-33 ④⑦ — `POST /api/claude-plugins/action` 의 동작(전부 CLI 위임). 뒤의 셋(`marketplace-update`·`update`·`update-all`)이 앱 안 갱신이다. */
export type ClaudePluginActionKind =
  | 'enable'
  | 'disable'
  | 'install'
  | 'uninstall'
  | 'marketplace-add'
  | 'marketplace-remove'
  /** 마켓 클론을 원본에서 다시 끌어온다(`name` 없으면 전부). 새 공식 스킬이 보이기 시작하는 자리. */
  | 'marketplace-update'
  /** 설치본 하나를 최신 판으로. */
  | 'update'
  /** 뒤처진 설치본 전부를 최신 판으로. */
  | 'update-all';

/** §5.5 #17-33 ⑦ — Claude Code 플러그인 자동 갱신 설정. 임의 코드라 끌 수 있게 두되 기본은 둘 다 켬 — 켤 자리를 못 찾아 36일 멈춰 있던 쪽보다 낫다. */
export interface ClaudePluginAutoRefreshSettings {
  /** 마켓 클론을 주기적으로 다시 끌어올지. 목록만 바뀌고 도는 코드는 안 바뀐다. */
  market: boolean;
  /** 뒤처진 설치본을 주기적으로 최신 판으로 올릴지. 이쪽은 **도는 코드가 바뀐다**. */
  plugins: boolean;
  /** 주기(시간). `CLAUDE_PLUGIN_REFRESH_MIN/MAX_INTERVAL_HOURS` 로 죈다. */
  intervalHours: number;
}

/**
 * §5.5 #17-33 ⑦ — 자동 갱신의 설정 + 마지막 결과. **머신 단위**라 `AppState` 에 산다
 * (어느 프로젝트를 열든 `~/.claude/plugins` 하나를 보므로 프로젝트마다 다른 주기를 둘 이유가 없다).
 */
export interface ClaudePluginRefreshState {
  settings?: ClaudePluginAutoRefreshSettings;
  /** 마켓 갱신에 마지막으로 성공한 시각(epoch ms). 주기 판정의 기준점. */
  lastMarketAt?: number;
  /** 설치본 갱신을 마지막으로 훑은 시각(epoch ms) — 올릴 것이 없었어도 훑었으면 찍는다. */
  lastPluginAt?: number;
  /** 마지막 훑기에서 실제로 올라간 플러그인 id 들(화면 한 줄 요약용, 최근 것만). */
  lastUpdatedIds?: string[];
  /** 마지막 시도가 실패했다면 그 사유(400자 상한, CLI 출력 그대로). 성공하면 지운다. */
  lastError?: string;
}

/** §5.5 #17-33 ⑦ — 갱신 한 번의 결과. 실패해도 어디까지 갔는지 담는다 — 마켓은 됐고 설치본에서 막힌 것과 아예 못 부른 것은 다시 누를 곳이 다르다. */
export interface ClaudePluginRefreshResult {
  /** 마켓 갱신을 시도했는가 / 됐는가. 설정이 꺼져 있으면 `attempted=false`. */
  market: { attempted: boolean; ok: boolean; reason?: string };
  /** 설치본 갱신 — 올린 것과 못 올린 것을 나눠 담는다. */
  plugins: { attempted: boolean; updated: string[]; failed: { id: string; reason: string }[] };
  /** 이번 훑기가 끝난 시각(epoch ms). */
  at: number;
}

/** 스킬이 어디서 왔는가 — `project` = 그 프로젝트 `.claude`, `global` = 홈 `~/.claude`, `plugin` = 설치 플러그인. */
export type AvailableSkillSource = 'project' | 'global' | 'plugin';

/**
 * §5.5 #17-2/#17-4 — `GET /api/available-skills` 의 스킬 한 줄. `plugin` 항목은 CLI 가 실제로 푸는 것이어야 한다 — 마켓 클론 폴더만 훑으면 안 깔린 스킬의 `/이름` 이 안 풀린다.
 * 못 쓰는 것은 지우지 않고 상태로 표시한다. 세 칸(`installed`/`enabled`/`placement`)은 날것 — 화면 세 곳은 `resolveSkillPluginState` 하나만 읽는다(각자 접으면 말이 갈린다).
 */
export interface AvailableSkill {
  name: string;
  description: string;
  source: AvailableSkillSource;
  /** 플러그인 스킬일 때 소속 플러그인 이름(예: `frontend-design`). */
  pluginName?: string;
  /**
   * §5.5 #17-33 ⑦ — `<이름>@<마켓플레이스>`. 이 자리에서 바로 깔 때 CLI 에 넘길 식별자다.
   * `source==='plugin'` 일 때만 있다.
   */
  pluginId?: string;
  /** 깔려 있는가. `source!=='plugin'` 이면 늘 `true`. 플러그인 스킬은 마켓 클론에 파일이 있어도 안 깔렸을 수 있다. */
  installed?: boolean;
  /**
   * 이 세션에서 **켜져 있는가**(= 슬래시가 실제로 풀리는가). 깔림과 켜짐은 다른 상태다
   * (#17-33 ③ — 실측 7개가 전부 깔린 채 꺼져 있었다). 남의 프로젝트에 매인 것도 여기서 `false`.
   */
  enabled?: boolean;
  /**
   * §5.5 #17-33 ⑦ — 어느 자리에 깔렸는가. **`enabled:false` 만으로는 처방을 못 고른다** —
   * 사용자가 끈 것(`plugin enable` 이 답)과 남의 프로젝트에 매인 것(여기엔 설치본이 없어
   * `install --scope user` 가 답)이 같은 `false` 로 접히기 때문이다. 그 둘을 가르는 칸이다.
   */
  placement?: ClaudePluginPlacement;
}

/**
 * §5.5 #17-33 ⑦ — 플러그인 스킬의 지금 상태. 처방이 각자 다르다: `disabled` → `enable`, `other-project`(켜져 있어도 이 세션엔 안 옴)·`not-installed` → `install --scope user`.
 * `ready` = 슬래시가 실제로 풀린다. `unknown` = CLI 에 못 물었다 — 태그를 달지 않는다(멀쩡한 스킬에 "미설치" 를 붙이는 쪽이 더 나쁘다).
 */
export type SkillPluginState = 'ready' | 'disabled' | 'other-project' | 'not-installed' | 'unknown';

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

// §5.5 #17-20 ⑩⑪⑫ 공통 디버그 층 — 화면은 어느 백엔드(CDP·DAP)로 붙었는지 몰라야 한다. 올라오는 모양이 같아야 런타임이 늘어도 UI 를 다시 짜지 않는다.

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

/** §5.5 #17-20 ⑩ — 런타임 → 디버거 연결법 표의 한 줄(`DEBUG_LAUNCH_RECIPES` 는 띄우는 법, 이쪽은 붙는 법). 새 언어 = 이 표에 한 줄(§3.3). */
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

/** 힙 표본 한 장(`process.memoryUsage()` + `v8.getHeapStatistics()`). 이게 없으면 메모리 진단을 I/O 카운터와 소거법으로 해야 한다. */
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

/** 프리뷰에서 집은 화면 요소 한 개(주입된 picker 가 `postMessage` 로 올린다). DOM 을 읽기만 한 결과 — 네트워크·저장소 정보는 담지 않는다(§7.11 (F)). */
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

// §5.19 All Model — 내 PC 의 로컬 LLM. claude 경로를 건드리지 않는다 — `AgentConfig.provider` 가 undefined 면 흐름 그대로이고 아래는 그 축을 켠 버블에서만 쓰인다.

/**
 * §5.19 · §5.25 — 프로바이더 종류(우리가 프로세스로 띄우는 엔진만, 원격 API 키 경로는 경계 밖 §5.19 (I)·§5.25 (K)).
 * `local-llama` = GGUF, 턴 루프를 우리가 돈다(§5.19 (D)) · `codex-cli` = 설치된 `codex`, 턴 루프는 CLI 이고 우리는 이벤트를 옮긴다(§5.25 (F)).
 */
export type AgentProviderKind = 'local-llama' | 'codex-cli';

/**
 * §5.19 (C) · §5.25 (B) — 프로바이더 설정. `AgentConfig` 안에 살아 체크포인트 영속은 그대로 따라온다.
 * 뜻이 같은 칸은 두 프로바이더가 한 벌로 쓰고 한쪽 전용 칸만 optional — 타입을 갈라 놓으면 `AgentConfig` 를 만지는 수십 곳이 유니온 좁히기를 해야 한다.
 */
export interface AgentProvider {
  kind: AgentProviderKind;
  /**
   * 이 버블이 문 모델. 아직 안 고른 버블은 빈 문자열.
   * - `local-llama` → `LocalModelEntry.id`(파일명 기준)
   * - `codex-cli` → 모델 slug(`CodexModelEntry.slug` · `codex exec -m <값>` 에 그대로 실린다)
   */
  modelId: string;
  /** 표시용 이름 — 모델 파일이 지워져도 버블 라벨이 무엇이었는지는 남는다. */
  modelName?: string;
  /** 컨텍스트 길이(토큰). 미설정 = 엔진 기본값. */
  contextSize?: number;
  /** 샘플링 온도. 미설정 = 엔진 기본값. */
  temperature?: number;
  /**
   * §5.19 (H) — 도구 호출을 하는가(물어봐야 안다 — 채팅 서식이 도구를 모르면 엔진이 요청을 거절한다).
   * `undefined`/`'unknown'` = 아직 모름(다음 턴에 실어 본다) · `'ok'` = 쓴다 · `'none'` = 도구 없는 대화 모드로 낮추고 버블에 표시한다(하는 척 ❌).
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
  /**
   * §5.25 (G) — 코덱스 추론 강도(`model_reasoning_effort`). 목록을 우리가 들지 않고 그 모델이 신고한 단계(`CodexModelEntry.reasoningLevels`)만 고른다.
   * 미설정 = 그 모델의 `defaultReasoningLevel`. `local-llama` 는 안 쓴다.
   */
  reasoningEffort?: string;
  /** Codex per-turn overrides; absent values inherit config.toml. */
  webSearch?: 'disabled' | 'cached' | 'live';
  networkAccess?: boolean;
  modelVerbosity?: 'low' | 'medium' | 'high';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  personality?: 'none' | 'friendly' | 'pragmatic';
  serviceTier?: string;
  autoCompactTokenLimit?: number;
  /** App-enforced Codex tool permissions. Empty object resets to no extra restrictions. */
  codexTools?: import('./codexToolPolicy.js').CodexToolPolicy;
}

// §5.25 Codex — 같은 지도 위의 두 번째 엔진. 클로드 쪽(`ClaudeAuthStatus`·`ClaudeSetupState`)과 같은 모양이라 화면이 같은 컴포넌트 규칙으로 그린다.

/** cli-missing = codex 실행 불가, timeout = 응답 없음, parse = 출력 형식 불명 */
export type CodexAuthProbeError = 'cli-missing' | 'timeout' | 'parse';

/** §5.25 (E) — `codex login status` 판정(자격증명 파일은 읽지 않는다). `error` 가 있으면 `loggedIn:false` 는 "모름"이라 로그인 창을 자동으로 띄우지 않는다. */
export interface CodexAuthStatus {
  loggedIn: boolean;
  /** 예: 'chatgpt' | 'apiKey' — CLI 가 말한 방식을 좁힌 값. 못 읽으면 생략. */
  authMethod?: string;
  /** CLI 가 계정/이메일을 함께 말해 주면 표시용으로만 싣는다. */
  account?: string;
  error?: CodexAuthProbeError;
  /** 판정 실패가 덮어쓰기 전의 마지막 정상 판정(클로드와 같은 규칙). */
  staleLoggedIn?: boolean;
  checkedAt: number;
}

/** §5.25 (E) — 로그인 방식. browser = `codex login`(브라우저 왕복), device = `--device-auth`(코드 표시). */
export type CodexAuthLoginMode = 'browser' | 'device';

/** §5.25 (D) — 설치 판정 단계. `ClaudeSetupPhase` 와 같은 다섯 칸(새 상태 발명 ❌). */
export type CodexSetupPhase = 'unknown' | 'missing' | 'installing' | 'ready' | 'failed';

/** §5.25 (D) — `GraphSnapshot.codexSetup` + `GET /api/codex-setup` 응답. */
export interface CodexSetupState {
  phase: CodexSetupPhase;
  /** 판정된 실행본 절대 경로. `phase==='missing'` 이면 없음. */
  binPath?: string;
  /** 검증된 버전("0.152.1" 등). 검출 실패 시 없음. */
  version?: string;
  /** 이 플랫폼에서 자동 설치를 시도할 수 있는가(npm 이 있는가). */
  canAutoInstall: boolean;
  /**
   * 자동 설치가 실행할(또는 사용자가 직접 칠) 명령 — 화면의 안내와 서버가 실제로 spawn 하는
   * 문자열이 **같아야** 하므로 서버가 조립해 내려보낸다(§5.25 (D)).
   */
  installCommand: string;
  /** 공식 설치 문서 URL — 자동 설치가 막혔을 때의 탈출구. */
  docsUrl: string;
  checkedAt: number;
  /** `phase==='failed'` 일 때 사람 읽기용 원인. */
  error?: string;
  /** §4 (앱 전용 엔진) — 코덱스 앱 전용 사본의 상태(Version 탭 코덱스 칸). */
  managed?: ManagedEngineStatus;
}

/** §5.25 (D) — 설치 진행 상황. `ClaudeSetupProgress` 와 같은 in-flight 세션 모양. */
export interface CodexSetupProgress {
  setupId: string;
  status: 'starting' | 'running' | 'done' | 'error';
  output?: string;
  exitCode?: number;
  binPath?: string;
  version?: string;
  error?: string;
}

/**
 * §5.25 (G) — Codex model/list가 신고한 모델. 로컬 캐시는 조회 실패 시에만 대체한다.
 * 목록에 있는 것은 실행 권한이나 성공을 보증하지 않는다. 실제 실행 결과가 최종 판정이다.
 */
export interface CodexModelEntry {
  /** `codex exec -m <slug>` 에 그대로 실리는 값. */
  slug: string;
  /** 사람이 읽는 이름. 없으면 slug 를 그대로 쓴다. */
  displayName: string;
  description?: string;
  /** 이 모델이 받는 추론 강도 단계(예: low/medium/high). 없으면 강도 칸을 그리지 않는다. */
  reasoningLevels: string[];
  /** 기본 강도. `reasoningLevels` 안의 값이거나 생략. */
  defaultReasoningLevel?: string;
  /** §5.25 (G-2) — 이 모델이 답변 길이(`model_verbosity`) 조절을 받는가(`support_verbosity`). 모르면 생략. */
  supportsVerbosity?: boolean;
  /** §5.25 (G-2) — 답변 길이를 아무도 안 정했을 때 이 모델이 쓰는 값(`default_verbosity`). */
  defaultVerbosity?: string;
  /** 공식 목록의 권장 기본값. 저장된 사용자의 모델 선택을 바꾸지는 않는다. */
  isDefault?: boolean;
  inputModalities?: string[];
  supportsPersonality?: boolean;
  /** 공식 목록이 제안한 교체 모델. 자동으로 저장하거나 선택하지 않는다. */
  upgrade?: string;
}

/** §5.25 (G) — `GET /api/codex-models` 응답. */
export interface CodexModelCatalog {
  models: CodexModelEntry[];
  /** 마지막 조회 시도 시각. 실패해도 갱신하며 목록 자체의 나이는 fetchedAt과 구분한다. */
  checkedAt: number;
  /** 마지막 공식 조회 성공 시각. 캐시 파일로만 얻은 목록이면 생략한다. */
  fetchedAt?: number;
  source?: 'app-server' | 'cache';
  /** 공식 재조회 실패로 이전 목록/로컬 캐시를 보여 주고 있는가. */
  stale?: boolean;
  /** 못 읽었으면 사유(사람 읽기용). */
  error?: string;
}

/** §5.25 (G-2) — 코덱스 설정 파일 한 겹에서 읽은 값 중 **우리 설정 창과 겹치는 키 + 스폰 판정에 쓰는 키만**. 없는 키는 생략. */
export interface CodexConfigLayerValues {
  /** `model_reasoning_effort` */
  reasoningEffort?: string;
  /** `model_verbosity` */
  modelVerbosity?: string;
  /** `web_search` */
  webSearch?: string;
  /** `sandbox_workspace_write.network_access` */
  networkAccess?: boolean;
  /**
   * `[windows] sandbox` — 설정 창의 칸이 아니라 **스폰 판정용**이다. Windows 에서 이 키가 어느 겹에도 없으면
   * 코덱스는 `-s workspace-write` 를 읽기 전용으로 내려 돌린다(0.159.2 실측). 적혀 있으면 우리는 손대지 않는다.
   */
  windowsSandbox?: string;
}

/**
 * §5.25 (G-2) — 그 값이 적힌 곳. `project` 는 신뢰한 프로젝트의 `.codex/config.toml`,
 * `profile` 은 `profile = "<이름>"` 이 고른 `<이름>.config.toml` 또는 옛 `[profiles.<이름>]` 표다.
 */
export type CodexConfigLayerSource = 'profile' | 'project' | 'user' | 'system';

export interface CodexConfigLayer {
  source: CodexConfigLayerSource;
  /** 읽은 파일의 절대 경로(화면의 설명 줄에 그대로 적는다). */
  path: string;
  values: CodexConfigLayerValues;
  /** `source === 'profile'` 일 때 그 프로필 이름. */
  profile?: string;
}

/** §5.25 (G-2) — `GET /api/codex-config` 응답: 이 작업 폴더에서 코덱스가 읽을 설정 파일들. `layers` 는 이기는 순서(프로필 → 프로젝트 → 사용자 → 시스템) — 화면은 키가 있는 첫 겹을 쓴다. */
export interface CodexEffectiveConfig {
  cwd: string;
  layers: CodexConfigLayer[];
  checkedAt: number;
}

/** §5.25 (G-2) — 로컬 모델의 온도를 비워 두었을 때 실제로 쓰이는 값과 그 출처. */
export type LocalSamplingSource =
  /** 지금 올라가 있는 엔진이 `/props` 로 알려 준 값 — 가장 확실하다. */
  | 'loaded'
  /** 모델 파일(GGUF)의 `general.sampling.temp` — 엔진이 올릴 때 이 값을 쓴다. */
  | 'model'
  /** 설치된 `llama-server --help` 가 적어 둔 `--temp` 값. */
  | 'engine';

/** §5.25 (G-2) — `GET /api/local-llm/models/:id/sampling` 응답. 알 수 없으면 `temperature: null`. */
export interface LocalSamplingInfo {
  temperature: number | null;
  source: LocalSamplingSource | null;
  /** 문맥 칸을 비워 두었을 때 실제로 뜨는 크기. 모델 조회 전 응답(순수 판정)에는 없다. */
  context?: LocalContextInfo;
}

/** §5.25 (G-2) — 로컬 문맥 칸을 비워 두었을 때 실제로 쓰이는 크기의 출처. */
export type LocalContextSource =
  /** 이미 올라가 있는 엔진이 뜬 크기 — 내리기 전까지는 칸 값과 무관하게 이 크기로 돈다. */
  | 'loaded'
  /** 우리가 쓰는 크기(`LOCAL_DEFAULT_CONTEXT_SIZE`)가 모델의 학습 문맥보다 커서 학습 문맥으로 깎인 값. */
  | 'model'
  /** `LOCAL_DEFAULT_CONTEXT_SIZE` 그대로. */
  | 'builtin';

export interface LocalContextInfo {
  tokens: number;
  source: LocalContextSource;
}

/**
 * §5.25 (M) — 코덱스가 실제로 들고 있는 것들(활동바 코덱스 갈래). §5.19 (G) "클로드 CLI 항목은 프로바이더 IDE 에 안 뜬다"는 로컬 모델용이다 —
 * 코덱스는 MCP·플러그인·스킬·훅·`AGENTS.md` 를 다 갖고 있어 감추면 거짓말이 된다. 읽기 전용(설치·제거는 코덱스 몫), 예외는 `hooks.json` 의 우리 항목뿐(§5.25 (I)).
 */
export interface CodexMcpServerEntry {
  name: string;
  /** `stdio` · `streamable_http` 등 — 코덱스가 신고한 값을 그대로 쓴다(우리가 표를 들지 않는다). */
  transport: string;
  enabled: boolean;
  /** 꺼져 있으면 코덱스가 준 사유. 우리가 지어내지 않는다. */
  disabledReason?: string;
  /** `unsupported` · `logged_in` 등 코덱스가 신고한 값. 모르면 생략. */
  authStatus?: string;
  /** stdio 면 실행 명령, http 면 URL. **환경변수·토큰은 담지 않는다.** */
  target?: string;
}

/**
 * §5.25 (M-1) — 스킬의 출처. 코덱스 스킬 루트는 홈 하나가 아니다(실측: 15개 중 홈 것은 3개).
 * `user` = `~/.codex/skills/<이름>/` · `system` = `~/.codex/skills/.system/<이름>/`(코덱스 기본, `imagegen` 등) · `plugin` = 플러그인 캐시(실은 플러그인은 `pluginName`).
 */
export type CodexSkillSource = 'user' | 'system' | 'plugin';

/** §5.25 (M) — 코덱스 스킬 하나. 코덱스의 스킬은 폴더가 곧 스킬이다. */
export interface CodexSkillEntry {
  name: string;
  path: string;
  /** `SKILL.md` 앞머리에서 읽은 한 줄. 없으면 생략하고 화면은 이름만 적는다. */
  description?: string;
  /** §5.25 (M-1) — 출처 루트. 옛 스냅샷엔 없어(그때는 홈만 읽었다) 선택 필드이고, 없으면 `user` 로 읽는다. */
  source?: CodexSkillSource;
  /** `plugin` 출처일 때 그것을 실은 플러그인 이름. 다른 출처에는 없다. */
  pluginName?: string;
}

/** §5.25 (M) — `codex plugin list --json` 한 항목. */
export interface CodexPluginEntry {
  name: string;
  marketplace?: string;
  version?: string;
  /** 코덱스가 신고한 상태(예: `installed, enabled`). 우리가 해석해 다시 쓰지 않는다. */
  status?: string;
  installed: boolean;
  enabled: boolean;
  path?: string;
}

/** §5.25 (M) — `~/.codex/hooks.json` 에 실제로 들어 있는 훅 한 줄. */
export interface CodexHookEntry {
  event: string;
  command: string;
  /** 우리가 넣은 항목인가(§5.25 (I) 의 서명으로 판정). 남의 훅은 읽기만 하고 손대지 않는다. */
  ours: boolean;
}

/** §5.25 (M) — 코덱스의 `AGENTS.md`(클로드의 `CLAUDE.md` 자리). 홈과 프로젝트 두 곳. */
export interface CodexAgentsDocEntry {
  scope: 'home' | 'project';
  path: string;
  exists: boolean;
  /** 파일이 있을 때만. 화면이 "몇 줄짜리가 실려 있다"를 말하는 데 쓴다. */
  bytes?: number;
  lines?: number;
}

/**
 * §5.25 (N) — `codex review` 가 무엇을 볼지.
 * - `uncommitted` — 스테이지·미스테이지·미추적 변경(`--uncommitted`). 기본값이자 안전한 쪽.
 * - `base` — 기준 브랜치와의 차이(`--base <BRANCH>`).
 * - `commit` — 커밋 하나(`--commit <SHA>`).
 */
export type CodexReviewMode = 'uncommitted' | 'base' | 'commit';

/** §5.25 (N) — 코덱스 리뷰 한 번. `VerificationRun`(§5.5 #17-35)과 자리는 같지만 "변경분에 문제가 있나"를 묻는 것이라 pass/fail 판정 칸을 빌려 오지 않는다. */
export interface CodexReviewRun {
  id: string;
  agentId: string;
  mode: CodexReviewMode;
  /** `base`/`commit` 일 때의 값. `uncommitted` 면 없다. */
  target?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  /** 코덱스가 뱉은 그대로. 우리가 요약하거나 판정으로 바꾸지 않는다. */
  output?: string;
  error?: string;
}

/** §5.25 (M) — `GET /api/codex-inventory` 응답 · `GraphSnapshot.codexInventory`. */
export interface CodexInventory {
  mcpServers: CodexMcpServerEntry[];
  skills: CodexSkillEntry[];
  plugins: CodexPluginEntry[];
  hooks: CodexHookEntry[];
  agentsDocs: CodexAgentsDocEntry[];
  /** 읽은 시각. 한 갈래를 못 읽어도 나머지는 채운다(전부 아니면 무 ❌). */
  checkedAt: number;
  /** 갈래별 실패 사유(사람 읽기용). 성공한 갈래는 여기 없다. */
  errors?: Partial<Record<'mcp' | 'skills' | 'plugins' | 'hooks' | 'agents', string>>;
}

/**
 * §5.25 (I) — 코덱스 훅 설치 상태.
 *
 * **기본 꺼짐이다.** 앱을 깔았다고 남의 전역 설정에 우리 훅이 말없이 들어가 있으면 안 된다.
 */
export interface CodexHookState {
  /** 코덱스 훅 파일에 우리 표식이 붙은 항목이 있는가. */
  installed: boolean;
  /** 훅 파일 절대 경로(없어도 "여기에 만든다"를 화면이 말할 수 있어야 한다). */
  hooksPath: string;
  /** 설치돼 있으면 우리가 넣은 이벤트 이름들. */
  events: string[];
  checkedAt: number;
  /** 읽기/쓰기가 실패했으면 사람 읽기용 사유. */
  error?: string;
}

/**
 * §5.25 (C) — 첫 진입에서 고르는 엔진. `AgentProviderKind` 와 일부러 따로 둔다 — 클로드는 provider 가 `undefined` 라 그 유니온에 이름이 없는데(§5.19 (C)) 관문은 셋을 이름으로 말해야 한다.
 * 둘을 잇는 곳은 `providerForEngine()` 하나.
 */
export type AgentEngineKind = 'claude' | 'codex' | 'local';

/** §5.25 (C) — 첫 진입에서 고른 엔진(`UserDefaults`). 기본값이지 잠금이 아니다 — 관문을 다시 묻지 않고 새 에이전트의 기본이 될 뿐, 다른 엔진 기능을 끄지 않는다. */
export interface EngineChoice {
  kind: AgentEngineKind;
  chosenAt: number;
}

/** §5.19 (D) — 로컬 추론 백엔드. 릴리스 자산 선택과 실행 양쪽에서 같은 이름을 쓴다. */
export type LocalEngineBackend = 'vulkan' | 'cpu' | 'cuda';

/** §5.19 (B) — 엔진 설치 진행. WS `local_engine_progress` payload 와 REST 응답 겸용(§5.7 #23-1 `ClaudeInstallProgress` 와 같은 모양). */
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

/** §5.19 (B) — 설치된 엔진 상태. 플래그가 아니라 실물이 진실 — `installedApps` 에 있어도 폴더가 없으면 `installed=false`(아니면 첫 대화에서 죽는다). */
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
  /** 쪼개져 배포된 모델(`…-00001-of-00003.gguf`)의 전체 조각 수(아니면 생략). 목록에선 한 모델로 묶고 `path` 는 첫 조각 — 엔진은 첫 조각만 받아 나머지를 따라가고 다른 조각이면 죽는다. */
  partCount?: number;
  /** 없는 조각의 파일명. 비어 있지 않으면 못 쓰는 모델이라 고르기 전에 말해야 한다(2026-08-20 실측: 둘째 조각만 있어도 골라져 엔진이 `code=1` 로 죽었다). */
  missingParts?: string[];
  /** 단독으로 못 도는 부속 GGUF(`mmproj-…` 시각 투영기, `mtp-…` 투기적 디코딩 헤드) — 혼자 열면 엔진이 뻗는다(2026-08-20 실측: `0xC0000005`). 고를 수 없게 막고 이유를 보인다. */
  companion?: boolean;
  /**
   * 받은 직후 몇 마디 시켜 본 결과 — 깨진 양자화는 읽혀도 뜻 없는 글자만 뱉는다(2026-08-21 실측: `Qwen3.5-9B-IQ4_XS.gguf` 한 글자 반복, 같은 구조 공식 Q4_K_M 은 멀쩡).
   * `broken` 은 막는 근거가 아니라 알리는 근거다(넘겨짚은 판정으로 멀쩡한 모델을 막지 않는다).
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

/** §5.19 (E) — 카탈로그 검색 결과 한 줄(받을 수 있는 것). 목록을 코드에 박지 않고 서버가 그때그때 조회한다 — 박으면 항목이 사라진 날 화면이 거짓말을 한다. */
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
 * §5.19 (E) — 이 PC 가 감당할 크기를 판정할 실측치. 가속 장치는 모델을 돌릴 엔진에게 묻는다(`llama-server --list-devices` — 못 쓰는 장치는 안 나온다).
 * CPU·램은 엔진 유무와 무관해 `node:os` 에서 읽는다 — `measuredAt` 이 0(장치 모름)이어도 유효하다.
 */
export interface LocalHardwareInfo {
  devices: LocalDeviceInfo[];
  /** 가장 여유가 큰 장치의 남은 메모리(장치가 없으면 0). 판정의 기준. */
  vramFreeBytes: number;
  totalRamBytes: number;
  freeRamBytes: number;
  /** CPU 모델명(첫 논리 코어 기준 — 이 PC 에 한 종류라고 보고 적는다). 못 읽으면 빈 문자열. */
  cpuModel: string;
  /** 논리 코어 수. 0 이면 이 OS 에서 코어 목록을 못 읽었다는 뜻(일부 리눅스가 빈 목록을 준다). */
  cpuCores: number;
  /** 직전 표본 이후 CPU 점유율(0~100). 누적 시간의 차이라 첫 표본은 `-1`(모름) — 화면은 이것을 0% 로 그리면 안 된다(노는 것과 모르는 것은 다르다). */
  cpuUsagePercent: number;
  /** 장치 목록을 잰 시각. 엔진을 깔기 전에는 잴 수 없으므로 0 이면 "가속 장치는 아직 모름". */
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

/** §5.19 (E) — 카탈로그 정렬 축: `downloads` 받은 수 · `likes` 하트 수 · `trending` 요즘 뜨는 순(갓 나온 모델이 먼저) · `recent` 최근 갱신. */
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

// §4 메신저 원격제어 브리지 — 메신저는 드라이버다: 새 메신저 = `ChatChannelKind` 한 줄 + 드라이버 파일 하나(페어링·라우팅·전송량 정책은 공용).
// 포트를 열지 않고 나가서 받아온다(텔레그램 long-poll · 디스코드 Gateway WS) — 공유기·인증서·CGNAT 이 무관하고 노출면이 0이다.

/** 지원 메신저 종류. 새 드라이버는 여기 한 줄 + 드라이버 파일 하나. */
export type ChatChannelKind = 'telegram' | 'discord';

/**
 * 폰으로 나가는 전송량 정책. `cards`(기본) = 카드/요약만(스트림 원문·diff·bash 출력 ❌, 필요하면 `/log [n]` 명시 요청), `full` = 스트림 텍스트까지(모달에서 직접 올릴 때만).
 * 기본이 좁은 이유: 제3자(메신저) 서버를 통과한다.
 */
export type ChatVerbosity = 'cards' | 'full';

/** 채널 연결 상태. `error` 의 사유는 `ChatChannelError` 가 나눈다. */
export type ChatChannelStatus = 'off' | 'connecting' | 'online' | 'error';

/**
 * 연결 실패 사유 — UI 가 원인별 안내를 고른다.
 * - `token`      : 토큰이 틀렸거나 폐기됨(텔레그램 401 / 디스코드 4004).
 * - `intent`     : 디스코드에서 Message Content Intent 가 꺼져 IDENTIFY 거부(4014).
 * - `network`    : 인터넷이 없거나 메신저 API 에 닿지 못함(재시도 중).
 * - `rate-limit` : 메신저가 우리를 잠시 제한함(백오프 중).
 */
export type ChatChannelError = 'token' | 'intent' | 'network' | 'rate-limit' | null;

/**
 * 페어링을 마친 대화 하나. **여기 없는 발신자는 조용히 무시**한다(응답조차 하지 않아
 * 봇의 존재를 알리지 않는다 — 화이트리스트가 봇 토큰 유출에 대한 2차 방어선이다).
 */
export interface ChatPeer {
  /** 어느 메신저의 대화인지. */
  kind: ChatChannelKind;
  /** 그 메신저 안의 대화 식별자(텔레그램 chat.id / 디스코드 channel.id). 문자열로 통일. */
  chatId: string;
  /** 화면에 보여줄 이름(사용자명·채널명). 표시 전용이라 없으면 chatId 를 쓴다. */
  label: string;
  /** 페어링 시각(epoch ms). */
  pairedAt: number;
  /** 마지막으로 이 대화에서 명령이 온 시각(epoch ms). */
  lastSeenAt: number;
  /** 이 대화가 겨누는 프로젝트(표시명, 3단계 선택의 첫 칸) — 있으면 `/agents` 가 그 프로젝트 에이전트만 보인다. 하나뿐이면 브리지가 자동으로 채운다. */
  targetProject?: string;
  /**
   * 이 대화가 지금 겨누고 있는 에이전트. `/agents` 로 고르면 정해지고, 이후 평문은
   * 이 에이전트의 명령 큐로 간다. 없으면 평문을 무시하고 `/agents` 를 안내한다.
   */
  targetAgentId?: string;
  /**
   * 이 대화가 겨누는 세션(3단계 선택의 마지막 칸) — `POST /api/commands/:sessionId` 의 `subAgentId` 로 그대로 실려 IDE 탭 하나와 같은 대화가 된다.
   * 없으면 서버가 정한다(커스텀 에이전트는 정규 sub 재사용).
   */
  targetSubAgentId?: string;
  /**
   * 1:1 DM 인가(텔레그램 `chat.type === 'private'` / 디스코드 `guild_id` 부재). 새 페어링은 DM 에서만 받는다(§4 ④) —
   * 길드·그룹에서 묶으면 화이트리스트가 방 구성원 전원인데 목록엔 한 사람만 떠 범위를 잘못 말한다. 값 없는 옛 peer 는 끊지 않고 `false` 로 읽어 경고를 붙인다.
   */
  direct?: boolean;
}

/**
 * 딥링크 페어링 티켓(메모리 전용·미영속 — 앱을 끄면 사라진다).
 * 이 축의 설계 목적은 하나다: **사용자가 chat id 를 손으로 알아내지 않게 하는 것.**
 */
export interface ChatPairTicket {
  /** 어느 채널용 티켓인지. */
  kind: ChatChannelKind;
  /**
   * QR 로 그릴 원문. 텔레그램은 `https://t.me/<botname>?start=<token>` 딥링크,
   * 디스코드는 봇 초대 URL(스캔 후 `!vibisual pair <token>` 한 줄로 마무리).
   */
  url: string;
  /** 디스코드처럼 URL 만으로 끝나지 않는 채널이 화면에 함께 띄울 명령문(없으면 null). */
  command: string | null;
  /** 만료 시각(epoch ms) — 남은 시간 카운트다운에 사용. */
  expiresAt: number;
  /** 이 티켓으로 페어링을 마친 대화 수(표시용). */
  usedCount: number;
}

/** 채널 하나의 현재 상태(모달의 탭 하나에 대응). */
export interface ChatChannelState {
  kind: ChatChannelKind;
  /** 이 채널 on/off (opt-in — 기본 false, userData 영속). */
  enabled: boolean;
  /** 봇 토큰이 저장돼 있는지. **토큰 자체는 renderer 로 절대 보내지 않는다.** */
  hasToken: boolean;
  status: ChatChannelStatus;
  error: ChatChannelError;
  /** 토큰 검증(`getMe`/`users/@me`)으로 확인한 봇 표시 이름 — 성공을 눈으로 확인시키는 값. */
  botName: string | null;
  /** 봇 username(텔레그램 딥링크 조립에 필요, 디스코드는 표시용). */
  botUsername: string | null;
  /** 디스코드 봇 초대 URL 조립에 필요한 application id(텔레그램은 null). */
  appId: string | null;
  /** 이 채널로 페어링된 대화 수. */
  peerCount: number;
  /** 현재 살아 있는 페어링 티켓(없거나 만료면 null). */
  pairTicket: ChatPairTicket | null;
}

/** 메신저 브리지 전체 상태 (`vibisual:chat:*` IPC 페이로드). */
export interface ChatBridgeState {
  /** 채널별 상태(현재 telegram·discord 둘). */
  channels: ChatChannelState[];
  /** 페어링된 대화 목록(모든 채널 합산). */
  peers: ChatPeer[];
  /** 폰으로 나가는 전송량 정책(채널 공통). */
  verbosity: ChatVerbosity;
  /** 페어링 실패 누적으로 차단된 발신자가 하나라도 있는지(티켓 재발급으로 해제). */
  pairLocked: boolean;
}

/**
 * §4 메신저 브리지 — 폰에서 고를 수 있는 **세션 한 칸**(= IDE 탭 하나).
 * 표시에 필요한 것만 담는다(스트림·토큰 원문은 이 목록을 타지 않는다).
 */
export interface ChatCommandSession {
  /** `POST /api/commands/:sessionId` 의 `subAgentId` 로 그대로 실린다. */
  id: string;
  /** 화면에 보여줄 이름(예: "Sub #1"). */
  label: string;
  status: SubAgentStatus;
  /** 이 세션에서 마지막으로 실행한 명령 한 줄(목록에서 "어느 대화였는지" 알아보는 단서). */
  lastCommand?: string;
  /** §2.4 — 자식 프로세스가 회수된 상태(고르면 `--resume` 으로 이어진다). */
  dormant?: boolean;
  /** §4 — 사용자 입력을 기다리며 멈춰 있는 상태(폰에서 먼저 봐야 하는 칸). */
  blocked?: boolean;
}

/** §4 메신저 브리지 — 폰에서 고를 에이전트 한 칸과 그 세션들. 범위와 무관하게 전량이다 — §9 스코프드 스냅샷을 쓰면 PC 에 열린 탭에 따라 폰 목록이 달라진다. */
export interface ChatCommandTarget {
  agentId: string;
  label: string;
  /** 이 에이전트의 Claude 세션 ID(= 버블 `path`). 명령 REST 의 경로 조각. */
  sessionId: string;
  /** 이 에이전트가 속한 프로젝트 표시명(3단계 선택의 첫 칸). */
  project: string;
  /** 지금 대기 중인 명령 수(고르기 전에 "밀려 있는지"를 보여 준다). */
  queued: number;
  sessions: ChatCommandSession[];
}

/** 카드에 붙는 버튼 하나. 누르면 `actionId` 가 그대로 돌아온다. */
export interface ChatAction {
  /** 이 버튼의 식별자 — 브리지가 대기 중인 동작(권한 요청 등)과 짝짓는 열쇠. */
  actionId: string;
  /** 버튼에 쓸 글자. */
  label: string;
  /** 강조(디스코드 버튼 style / 텔레그램은 글자만). */
  style?: 'primary' | 'danger' | 'default';
}

/**
 * 폰으로 나가는 한 장. WSMessage 를 이 모양으로 **줄여서** 보낸다 —
 * 줄이는 지점이 한 곳이라 전송량 정책(`ChatVerbosity`)이 새는 구멍이 생기지 않는다.
 */
export interface ChatCard {
  /** 카드 종류 — 아이콘/머리글 선택과 `cards` 정책 통과 여부를 함께 결정한다. */
  kind: 'report' | 'question' | 'review' | 'permission' | 'goal' | 'stream' | 'text';
  /** 머리글 한 줄. */
  title: string;
  /** 본문 줄들(이미 상한 안으로 잘린 상태). */
  lines: string[];
  /** 버튼(없으면 생략). */
  actions?: ChatAction[];
  /** 어느 에이전트의 일인지(있으면 머리글에 함께 적는다). */
  agentLabel?: string;
}

/** User-owned SKILL.md folders offered by the other local engine. */
export interface SkillSharingEntry {
  id: string;
  name: string;
  description: string;
  sourceProvider: 'claude' | 'codex';
  scope: 'project' | 'global';
  sourcePath: string;
  status: 'available' | 'shared' | 'conflict' | 'unsupported';
  /** Stable issue codes, translated by the client. */
  issues: string[];
}

export interface SkillSharingResult {
  status: 'shared' | 'exists' | 'conflict' | 'unsupported';
  name: string;
  path: string;
  issues?: string[];
}
