/**
 * streamItems.ts — SubAgent 스트림 이벤트 → 표시 아이템 파생(순수 로직).
 *
 * StreamRenderer 에서 분리한 이유:
 *  1) React/virtuoso 의존 없는 순수 함수라 Vitest 로 단독 검증 가능.
 *  2) **증분 파서**(IncrementalStreamParser)를 전체 재구축(buildBaseItems)과 나란히 두고
 *     "증분 == 전체" 등가성을 테스트로 못박기 위함.
 *
 * 핵심 성능 배경: 종전엔 스트림이 갱신될 때마다 활성 세션 버퍼 전체(최대 4000개)를 처음부터
 * 다시 파싱(buildBaseItems 3패스)해 O(전체 길이) 비용이 매 틱 발생 → 길수록 느려지는 구조였다.
 * IncrementalStreamParser 는 **새로 도착한 이벤트만** 처리하고, 변경된 항목만 새 객체로 교체해
 * (참조 안정) 갱신 비용을 O(신규 이벤트)로 낮춘다. VS Code 터미널처럼 길이와 무관하게 일정.
 *
 * 증분이 성립하지 않는 변화(세션 전환 / commands 변경 / 버퍼 앞쪽 절단 / 재로드)에는 전체
 * 재구축으로 안전 폴백한다 — 정확성은 항상 buildBaseItems 와 동일, 증분은 흔한 append 의 빠른 길.
 */
import type {
  SubAgentStreamEvent,
  QueuedCommand,
  AgentReport,
  AgentQuestions,
  AgentReview,
  AgentList,
  AskUserQuestionRequest,
  TodoItem,
  CommandDispatchMode,
  CommandError,
} from '@vibisual/shared';
import { THINKING_PULSE_SUBTYPE, HIDDEN_SYSTEM_SUBTYPES, isHiddenSystemSubtype } from '@vibisual/shared';
import { parseSystemSubtype } from './SystemNode.js';
import { shouldTraceThinking, type ThinkRun } from './turnSteps.js';

// ─── 계획(TodoWrite) 인식 (§5.5 #17-12) ───

/** 계획 블록으로 승격할 도구 이름. 이 도구의 tool_use 는 일반 도구 상자가 아니라 `plan` 아이템이 된다. */
export const PLAN_TOOL_NAME = 'TodoWrite';

const TODO_STATUSES = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed']);

/**
 * TodoWrite tool_use 의 input(JSON 문자열)에서 계획 항목을 뽑는다.
 * 형식이 다르거나(모델 판본 차이) 파싱이 안 되면 null → 호출측이 일반 도구 상자로 폴백한다.
 */
export function parsePlanTodos(input: string): TodoItem[] | null {
  if (!input) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = (parsed as Record<string, unknown>)['todos'];
  if (!Array.isArray(raw)) return null;
  const todos: TodoItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const content = rec['content'];
    const status = rec['status'];
    if (typeof content !== 'string' || typeof status !== 'string') continue;
    if (!TODO_STATUSES.has(status as TodoItem['status'])) continue;
    todos.push({ content, status: status as TodoItem['status'] });
  }
  return todos.length > 0 ? todos : null;
}

/** 지금 진행 중인 계획 단계 — 하단 상태바가 "무엇을 하는 중"으로 쓴다. 없으면 null. */
export interface PlanProgress {
  /** in_progress 항목(없으면 첫 미완료 항목). */
  current: string;
  done: number;
  total: number;
}

/** 계획 항목들에서 진행 상태 요약을 뽑는다(완료만 남았으면 null — 표시할 "지금"이 없다). */
export function planProgressOf(todos: TodoItem[]): PlanProgress | null {
  const done = todos.filter((td) => td.status === 'completed').length;
  const active = todos.find((td) => td.status === 'in_progress') ?? todos.find((td) => td.status === 'pending');
  if (!active) return null;
  return { current: active.content, done, total: todos.length };
}

/**
 * 이벤트 버퍼 끝에서부터 가장 최근 TodoWrite 를 찾아 진행 상태를 반환.
 * 뒤에서부터 훑으므로 보통 몇 개만 보고 끝난다(계획이 없으면 전체 1회 스캔).
 */
export function latestPlanProgress(events: SubAgentStreamEvent[]): PlanProgress | null {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k]!;
    if (e.eventType !== 'tool_use' || e.toolName !== PLAN_TOOL_NAME) continue;
    const todos = parsePlanTodos(e.content);
    if (todos) return planProgressOf(todos);
  }
  return null;
}

// ─── system subtype 필터 (펄스/숨김) ───

// §5.5 v4.92 — 이 두 목록(펄스·숨김)은 **서버가 복원 예산에서 뺄 대상을 고르는 근거**이기도 하다.
//   두 벌로 두면 한쪽만 늘어난 순간 "안 그리는데 저장은 하는" 또는 그 반대가 된다 — shared 가 원본.
//   기존 호출부가 이 모듈에서 그대로 가져가도록 여기서 다시 내보낸다.
export { THINKING_PULSE_SUBTYPE, HIDDEN_SYSTEM_SUBTYPES, isHiddenSystemSubtype };

export function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

/**
 * §5.5 #17-15 — "지금 생각하고 있다"를 뜻하는 이벤트(SDK 펄스 + 실제 thinking 델타).
 * 사고 원문은 어느 밀도에서도 그리지 않으므로, 이 이벤트들의 유일한 표면은 라이브 1줄이다.
 */
export function isThinkingActivity(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'thinking' || isThinkingPulse(evt);
}

/**
 * §5.5 #17-13 ⑤ — `[task_started]` 처럼 **subtype 단독 패턴**인 SDK 상태 표식인가.
 * 이런 줄은 내용이 없고 레일 점 한 줄만 먹어, 간결/표준 밀도에서는 표시 단계에서 걸러낸다.
 * 내용이 있는 system 본문(권한 결정, 짝 없는 `[ToolName] …` 결과)은 여기에 걸리지 않는다.
 */
export function isSystemSubtypeChip(content: string): boolean {
  return parseSystemSubtype(content) !== null;
}

/**
 * IDE 에서 아예 숨길 system subtype(노드 점도 라벨도 그리지 않음). 판정은 shared 가 들고 있다 —
 * §5.5 #17-13 ⑤-4 부터 이름표(`status`)뿐 아니라 살림성 통지(`*_changed`)도 여기에 걸린다.
 */
export function isHiddenSystem(evt: { eventType: string; content: string }): boolean {
  if (evt.eventType !== 'system') return false;
  const subtype = parseSystemSubtype(evt.content);
  return subtype !== null && isHiddenSystemSubtype(subtype);
}

// ─── 타입 ───

export interface StreamGroup {
  kind: 'tool';
  id: string;
  toolName: string;
  input: string;
  output: string;
  timestamp: number;
  isActive: boolean;
  /** §4 (스트림 3종 ①) — 중첩 서브에이전트가 부른 도구면 그 바깥 Task 호출의 id. */
  nestedUnderToolUseId?: string;
}

/**
 * §5.5 #17-12 — 계획 블록(TodoWrite 승격). 짝 tool_result 는 종전처럼 소비되어 별도 줄을 만들지 않는다.
 * `superseded` 는 표시 단계(streamDensity)가 채운다 — 같은 턴에서 뒤에 더 새로운 계획이 온 옛 계획.
 */
export interface StreamPlan {
  kind: 'plan';
  id: string;
  todos: TodoItem[];
  timestamp: number;
  superseded?: boolean;
}

export interface StreamText {
  kind: 'text';
  id: string;
  content: string;
  timestamp: number;
  /**
   * §5.5 #17-39 — 이 말풍선의 **마지막 델타가 도착한 시각**. `timestamp`(첫 델타) 와의 차이가 곧
   * "이만큼 쓰는 데 걸린 시간" 이다. 델타가 하나뿐이면 `timestamp` 와 같다(= 걸린 시간 0).
   */
  endedAt?: number;
  /**
   * §4 (스트림 3종 ①) — 이 말풍선이 **중첩 서브에이전트(Task)** 가 한 말이면 그 Task 호출의 id.
   * 미설정 = 이 에이전트 자신이 한 말(종전 그대로).
   */
  nestedUnderToolUseId?: string;
}

/**
 * §5.5 #17-39 — **단계 자국**. 끝난 사고 런 하나가 남기는 한 줄(`1분 13초 동안 사고함 · 4,182자`).
 *
 * #17-15 가 없앤 것은 사고 **원문**을 보여 주는 표면이다. 이 항목은 원문을 담지 않는다 —
 * 길이(`chars`)와 시각 둘뿐이라, 사고를 버퍼에 쌓지 않는다는 #17-15 ② 는 그대로다.
 * 자국은 **봉인된 런에만** 생긴다(자라는 자국 ❌ — 지금 생각 중은 라이브 1줄이 맡는다).
 */
export interface StreamStep {
  kind: 'step';
  id: string;
  phase: 'thinking';
  /** 런이 시작한 시각 = 이 자국이 설 자리(사고가 있던 그 자리). */
  timestamp: number;
  /** 런이 끝난 시각. `timestamp` 와의 차이가 걸린 시간. */
  endedAt: number;
  /** 그동안 흘러나온 사고 분량(글자 수). 원문은 어디에도 남기지 않는다. */
  chars: number;
}

export interface StreamSystem {
  kind: 'system';
  id: string;
  content: string;
  timestamp: number;
}

export interface StreamResult {
  kind: 'result';
  id: string;
  content: string;
  timestamp: number;
}

/**
 * §5.5 #17-12 ③ — 턴이 **실패로 끝난 자리**에 서는 오류 줄. 서버가 `error` 스트림 이벤트로 보낸
 * `[code:exit] 원문` 을 그대로 담고, 문장은 렌더가 로케일로 만든다(`describeCommandError`).
 * 시스템 줄로 흘리지 않는 이유는 하나다 — 사용자가 읽어야 할 유일한 실패 원인이 회색 잡음에 섞이면
 * "오류라고만 나온다"는 그 문제가 자리만 바꿔 남는다.
 */
export interface StreamError {
  kind: 'error';
  id: string;
  /** 서버 원문(`[code:exit] detail`). 파싱은 표시 시점에 한다(저장 형태는 서버가 준 그대로). */
  content: string;
  timestamp: number;
}

/**
 * 라이브 1줄 — 에이전트가 작동하는 **내내** 본문 하단에 1개 떠 있다(§5.5 #17-15 사고의 유일한 표면,
 * #17-24 ② 상시 표시). 마지막 이벤트 종류는 켜고 끄는 스위치가 아니라 **라벨을 고르는 값**이다.
 */
export interface StreamThinkingLive {
  kind: 'thinking-live';
  id: string;
  /** `thinking` = 사고 중, `working` = 도구·본문 등 그 외 작업 중. 라벨·색만 가른다(항목은 그대로). */
  mode: 'thinking' | 'working';
  timestamp: number;
}

/**
 * §4 v2.53 — 작업 신고 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류).
 * §5.5 #17-12 — 같은 턴에 온 검수 요청은 별도 카드가 아니라 이 카드 **안쪽 구획**으로 흡수된다(`review`).
 */
export interface StreamReport {
  kind: 'report';
  id: string;
  report: AgentReport;
  review?: AgentReview;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 **아직 도는 중**(헤더에 `작업 중` 배지). 턴이 끝나면 사라진다. */
  live?: boolean;
}

/** §4 v2.60 — 질문 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamQuestion {
  kind: 'question';
  id: string;
  questions: AgentQuestions;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중. */
  live?: boolean;
}

/** §4 v2.70 — 검수 요청 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamReview {
  kind: 'review';
  id: string;
  review: AgentReview;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중. */
  live?: boolean;
}

/** §4 v2.84 — 번호 목록 정렬 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamList {
  kind: 'list';
  id: string;
  list: AgentList;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중. */
  live?: boolean;
}

/** §5.3 #12-2 — pending AskUserQuestion 카드 (createdAt 을 timestamp 로 삼아 스트림 끝에 합류) */
export interface StreamAsk {
  kind: 'ask';
  id: string;
  request: AskUserQuestionRequest;
  timestamp: number;
}

/** 명령어 프롬프트 블록 */
export interface StreamCommand {
  kind: 'command';
  id: string;
  prompt: string;
  result: string;
  status: string;
  timestamp: number;
  /**
   * **내가 보낸 시각**(`QueuedCommand.timestamp` = 큐 투입). 위 `timestamp` 는 §5.5 #17-18 ⑥ 대로
   * 말풍선이 설 자리(= 나간 시각 · 대기 중이면 `PENDING_COMMAND_TS` 꼬리 표식)라 **시각 표기에
   * 쓸 수 없다** — 대기 중 덧말이 서기 275760년에 보낸 글이 된다. 말풍선의 `오늘 14:32` 는 이 값이다.
   */
  submittedAt?: number;
  /** v2.61 — 전송한 paste 이미지 첨부의 절대경로(완료 후에도 보존). basename 으로 blob preview 조회. */
  attachments?: string[];
  /** §5.5 #17-18 v4.68 — 이 프롬프트에 함께 실려 나간 덧말 수(합치기). 0/undefined = 단독. */
  mergedCount?: number;
  /**
   * 앱/서버가 내려가 이 명령의 실행이 끊겼고, 보존된 세션으로 **다시 이어 돌린** 건인가.
   * 서버는 이미 그렇게 재개하고 있었지만 화면에 한 글자도 안 떠서, 사용자에겐 그냥 "멈춰 있다"로
   * 보였다(사용자 보고 — "멈춰있길래 물어보니 끊겼다더라"). 끊겼다는 사실은 말해 줘야 한다.
   */
  restartResumed?: boolean;
  /**
   * §5.5 #17-18 ⑤ v4.77 — 큐의 원본 명령 id(`cmd-` 접두어 없는 raw). 말풍선 안의 [대기|합치기|즉시]·
   * 삭제가 이 id 로 큐를 직접 손댄다(옛 대기 줄이 하던 일).
   */
  commandId?: string;
  /** §5.5 #17-18 ⑤ v4.77 — 대기 중인 덧말의 dispatch 방식(말풍선 색·칩 활성 표시). */
  dispatchMode?: CommandDispatchMode;
  /**
   * §5.5 #17-12 ③ — 오류로 끝난 이유. `result` 와 같은 규약으로 **스트림이 없을 때만** 싣는다 —
   * 스트림이 있으면 실패한 그 자리에 `error` 항목이 이미 서 있어 두 번 읽게 된다.
   */
  error?: CommandError;
}

export type StreamItem =
  | StreamText | StreamGroup | StreamSystem | StreamResult | StreamError | StreamPlan | StreamStep
  | StreamThinkingLive | StreamReport | StreamQuestion | StreamReview | StreamList | StreamAsk;

export type StreamItemFull = StreamItem | StreamCommand;

/** 1단계 결과 — events + commands 만으로 만든 base 아이템과, events 로 결정되는 라이브 상태. */
export interface BaseItemsResult {
  items: StreamItemFull[];
  agentBusy: boolean;
  thinkingLive: StreamThinkingLive | null;
}

// ─── 공통 헬퍼(전체·증분이 공유) ───

/**
 * §5.5 #17-18 ⑥ — 아직 안 나간 말풍선의 정렬 키. 어떤 실제 시각보다도 크므로 **항상 꼬리**에 선다
 * (실제 꼬리 배치는 `mergeCardsIntoItems` 가 정렬 밖으로 빼서 확정한다 — 이 값은 그 전 단계의 정렬용).
 */
export const PENDING_COMMAND_TS = Number.MAX_SAFE_INTEGER;

/**
 * §5.5 #17-18 ⑥-5 — 이 명령이 **한 번이라도 나갔는가**(= 시간축 위에 자기 자리가 있는가).
 *
 * 종전 판정은 `status !== 'queued'` 하나였다. 그런데 앱이 내려가 끊긴 명령은 부팅 reconcile 이
 * 보존된 세션으로 재개하려고 **다시 `queued` 로 되돌린다**(§5.3 #12-1 `restartResumed`) — 이미
 * 출력을 한참 뱉어 놓은 명령인데도 "아직 안 나간 글"로 읽혀 말풍선이 화면 꼬리로 끌려 내려갔다.
 * `startedAt` 이 찍혀 있다는 것은 그 명령이 실제로 나간 적이 있다는 뜻이므로, 지금 큐에 되돌아가
 * 있더라도 자리는 처음 나간 그 시각에 남는다.
 */
export function hasDispatched(cmd: QueuedCommand): boolean {
  return cmd.status !== 'queued' || cmd.startedAt !== undefined;
}

/**
 * §5.5 #17-18 ⑥ — 이 명령의 말풍선이 설 자리.
 *  - 아직 안 나간 `queued`: 꼬리(출력이 자라는 동안 계속 아래로 밀린다).
 *  - 그 외: **나간 시각**(`startedAt`). 그 뒤 도착한 스트림이 전부 아래에 쌓여 턴 경계선이 된다.
 *  - `startedAt` 이 없는 옛 명령은 종전대로 큐 투입 시각(`timestamp`).
 */
export function commandAnchorTs(cmd: QueuedCommand): number {
  if (!hasDispatched(cmd)) return PENDING_COMMAND_TS;
  return cmd.startedAt ?? cmd.timestamp;
}

/**
 * §5.5 #17-18 ⑥ — 턴 경계로 쓰이는 시각들(오름차순). **이미 나간 명령만** 경계가 된다 —
 * 대기 중 덧말은 아직 아무것도 끊지 않았으므로 본문 런도 카드 자리도 가르지 않는다.
 * (재개 대기 중인 명령은 이미 한 번 끊었으므로 ⑥-5 규칙대로 경계에 남는다.)
 */
function dispatchedAnchorsAsc(commands: QueuedCommand[] | undefined): number[] {
  const out: number[] = [];
  for (const c of commands ?? []) {
    if (!hasDispatched(c)) continue;
    out.push(commandAnchorTs(c));
  }
  return out.sort((a, b) => a - b);
}

/** commands → 사용자 프롬프트 블록. 결과는 스트림이 있으면 스트림에서 렌더하므로 비운다. */
function buildCommandItems(commands: QueuedCommand[] | undefined, hasStream: boolean): StreamCommand[] {
  const items: StreamCommand[] = [];
  if (commands && commands.length > 0) {
    for (const cmd of commands) {
      items.push({
        kind: 'command',
        id: `cmd-${cmd.id}`,
        prompt: cmd.text,
        result: hasStream ? '' : (cmd.result ?? ''),
        status: cmd.status,
        // §5.5 #17-18 ⑥ — 큐에 넣은 시각이 아니라 **나간 시각**(대기 중이면 꼬리).
        timestamp: commandAnchorTs(cmd),
        // 말풍선이 "언제 보낸 글인가"를 말할 때 쓰는 값은 그 꼬리 표식이 아니라 실제 투입 시각이다.
        submittedAt: cmd.timestamp,
        attachments: cmd.attachments,
        mergedCount: cmd.mergedCount,
        restartResumed: cmd.restartResumed,
        commandId: cmd.id,
        dispatchMode: cmd.dispatchMode,
        error: hasStream ? undefined : cmd.error,
      });
    }
  }
  return items;
}

function computeAgentBusy(commands: QueuedCommand[] | undefined): boolean {
  return !!commands && commands.some((c) => c.status === 'executing' || c.status === 'queued');
}

/**
 * §5.5 #17-39 — 봉인된 사고 런 → 자국 항목. 문턱(`shouldTraceThinking`)을 못 넘으면 `null` —
 * 순간 사고마다 한 줄을 내주면 그 줄이 곧 소음이 된다.
 *
 * 전체 재구축·증분 파서가 **같은 함수**를 쓴다. 두 벌이 되면 한쪽만 문턱이 바뀌어 같은 대화가
 * 경로에 따라 다르게 그려진다(등가성 테스트가 그 순간 걸린다).
 */
function thinkRunToStep(run: ThinkRun): StreamStep | null {
  if (!shouldTraceThinking(run)) return null;
  return {
    kind: 'step',
    id: `step-${run.firstId}`,
    phase: 'thinking',
    timestamp: run.startedAt,
    endedAt: run.endedAt,
    chars: run.chars,
  };
}

/** 사고 이벤트 하나를 열린 런에 보탠다(없으면 연다). **원문은 담지 않고 길이만 센다.** */
function extendThinkRun(open: ThinkRun | null, evt: SubAgentStreamEvent): ThinkRun {
  if (!open) {
    return {
      firstId: evt.id, startedAt: evt.timestamp, endedAt: evt.timestamp, chars: evt.content.length,
      ...(evt.nestedUnderToolUseId ? { nested: evt.nestedUnderToolUseId } : {}),
    };
  }
  open.endedAt = evt.timestamp;
  open.chars += evt.content.length;
  return open;
}

/** §4 (스트림 3종 ①) — 이 사고가 열린 런과 **주인이 다른가**(부모 ↔ 중첩 Task). 다르면 런을 끊는다. */
function thinkOwnerChanged(open: ThinkRun | null, evt: SubAgentStreamEvent): boolean {
  return !!open && open.nested !== evt.nestedUnderToolUseId;
}

/**
 * 라이브 "생각 중 …/작업 중 …" 1줄 — **에이전트가 작동하는 동안 항상** 켠다.
 *
 * §5.5 #17-24 ② — 종전엔 `agentBusy && 마지막 이벤트가 사고` 였다. 그래서 사고 → 도구 → 본문으로
 * 이벤트 종류가 바뀔 때마다 이 줄이 사라졌다 다시 나타나 화면이 깜빡였다. 이제 발화 조건은 `agentBusy`
 * 하나이고, 마지막 이벤트 종류는 **라벨(mode)** 만 고른다 — 항목 id 가 고정이라 라벨만 바뀌고 항목은
 * 생멸하지 않는다(가상 리스트 remount ❌).
 */
function computeThinkingLive(events: SubAgentStreamEvent[], agentBusy: boolean): StreamThinkingLive | null {
  if (!agentBusy) return null;
  const lastRaw = events[events.length - 1];
  const mode = lastRaw && isThinkingActivity(lastRaw) ? 'thinking' : 'working';
  // 정렬에 참여하지 않고 항상 맨 끝이라 timestamp 는 표시 순서에 영향을 주지 않는다(없으면 0).
  return { kind: 'thinking-live', id: 'thinking-live', mode, timestamp: lastRaw?.timestamp ?? 0 };
}

// ─── 1단계: 전체 재구축(참조 구현) ───

/**
 * events + commands 만으로 base 아이템을 빌드(카드 제외). O(전체 길이).
 * IncrementalStreamParser 의 정답지이자, 증분이 불가능한 변화의 폴백 경로.
 */
export function buildBaseItems(events: SubAgentStreamEvent[], commands?: QueuedCommand[]): BaseItemsResult {
  const hasStream = events.length > 0;
  const items: StreamItemFull[] = buildCommandItems(commands, hasStream);
  const agentBusy = computeAgentBusy(commands);

  // 1차 패스: tool_use ↔ tool_result FIFO 페어링 (서버가 tool_use_id를 노출하지 않으므로 발생 순서 기반)
  const resultByToolIdx = new Map<number, number>();
  const pendingToolIdxs: number[] = [];
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (e.eventType === 'tool_use') {
      pendingToolIdxs.push(k);
    } else if (e.eventType === 'tool_result') {
      const toolIdx = pendingToolIdxs.shift();
      if (toolIdx !== undefined) resultByToolIdx.set(toolIdx, k);
    }
  }
  const consumedResultIdxs = new Set<number>(resultByToolIdx.values());

  // "지금 실행 중" 판정 경계 — 마지막 비-도구 이벤트 이후의 짝 없는 tool_use 만 활성.
  let lastNonToolIdx = -1;
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (isThinkingPulse(e) || isHiddenSystem(e)) continue;
    if (e.eventType !== 'tool_use' && e.eventType !== 'tool_result') lastNonToolIdx = k;
  }

  const sortedCmdTs = dispatchedAnchorsAsc(commands);
  function crossesCommand(prevTs: number, nextTs: number): boolean {
    for (const t of sortedCmdTs) {
      if (t > prevTs && t <= nextTs) return true;
      if (t > nextTs) break;
    }
    return false;
  }

  let textBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number; nested?: string } | null = null;
  // §5.5 #17-39 — 열린 사고 런(원문 ❌ 길이만). 봉인될 때 자국 한 줄이 된다.
  let thinkBuf: ThinkRun | null = null;

  function flushText(): void {
    if (!textBuf) return;
    items.push({
      kind: 'text',
      id: textBuf.ids[0]!,
      content: textBuf.chunks.join(''),
      timestamp: textBuf.ts,
      endedAt: textBuf.lastTs,
      ...(textBuf.nested ? { nestedUnderToolUseId: textBuf.nested } : {}),
    });
    textBuf = null;
  }

  /** 사고 런이 끝났다 — 자국을 그 자리에 세운다(뒤이어 올 본문·도구보다 먼저 push 되어야 순서가 맞는다). */
  function flushThink(): void {
    if (!thinkBuf) return;
    const step = thinkRunToStep(thinkBuf);
    thinkBuf = null;
    if (step) items.push(step);
  }

  let i = 0;
  while (i < events.length) {
    const evt = events[i]!;

    if (isThinkingPulse(evt)) { i++; continue; }
    if (isHiddenSystem(evt)) { i++; continue; }

    // §5.5 #17-15 — 사고 원문은 아이템으로 만들지 않는다(라이브 1줄이 유일한 표면).
    //   다만 **텍스트 런의 경계**로는 남긴다 — 사고를 사이에 둔 앞뒤 설명은 종전처럼 두 말풍선.
    // §5.5 #17-39 — 원문 대신 **얼마나 걸렸고 얼마나 나왔는지**만 런에 모은다(원문 버퍼 ❌).
    if (evt.eventType === 'thinking') {
      flushText();
      // 주인이 바뀌면 런을 끊는다 — 부모와 자식의 사고를 한 덩어리로 재면 아무도 안 쓴 시간이 적힌다.
      if (thinkOwnerChanged(thinkBuf, evt)) flushThink();
      thinkBuf = extendThinkRun(thinkBuf, evt);
      i++;
      continue;
    }

    // 사고가 아닌 이벤트가 왔다 = 사고 런이 끝났다. 자국은 뒤이어 올 항목보다 **먼저** 선다.
    flushThink();

    if (evt.eventType === 'text') {
      if (textBuf && crossesCommand(textBuf.lastTs, evt.timestamp)) flushText();
      // §4 (스트림 3종 ①) — **주인이 바뀌면 말풍선을 끊는다.** 중첩 서브에이전트의 말과 부모의 말이
      //   한 덩어리로 붙으면 누가 한 말인지 사라진다(전달을 켜는 순간 대화록이 섞이는 자리).
      if (textBuf && textBuf.nested !== evt.nestedUnderToolUseId) flushText();
      if (!textBuf) {
        textBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp, nested: evt.nestedUnderToolUseId };
      } else { textBuf.ids.push(evt.id); textBuf.chunks.push(evt.content); textBuf.lastTs = evt.timestamp; }
      i++;
      continue;
    }

    flushText();

    if (evt.eventType === 'tool_use') {
      // §5.5 #17-12 — TodoWrite 는 계획 블록으로 승격(짝 tool_result 는 위 consumedResultIdxs 로 소비됨).
      const planTodos = evt.toolName === PLAN_TOOL_NAME ? parsePlanTodos(evt.content) : null;
      if (planTodos) {
        items.push({ kind: 'plan', id: evt.id, todos: planTodos, timestamp: evt.timestamp });
        i++;
        continue;
      }
      const resultIdx = resultByToolIdx.get(i);
      if (resultIdx !== undefined) {
        const resultEvt = events[resultIdx]!;
        items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: resultEvt.content, timestamp: evt.timestamp, isActive: false, ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}) });
      } else {
        items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: '', timestamp: evt.timestamp, isActive: agentBusy && i > lastNonToolIdx, ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}) });
      }
      i++;
      continue;
    }

    if (evt.eventType === 'tool_result') {
      if (consumedResultIdxs.has(i)) { i++; continue; }
      items.push({ kind: 'system', id: evt.id, content: `${evt.toolName ? `[${evt.toolName}] ` : ''}${evt.content}`, timestamp: evt.timestamp });
      i++;
      continue;
    }

    if (evt.eventType === 'result') {
      items.push({ kind: 'result', id: evt.id, content: evt.content, timestamp: evt.timestamp });
      i++;
      continue;
    }

    // §5.5 #17-12 ③ — 실패 사유는 시스템 잡음으로 섞지 않고 전용 항목으로(증분 파서와 같은 규약).
    if (evt.eventType === 'error') {
      items.push({ kind: 'error', id: evt.id, content: evt.content, timestamp: evt.timestamp });
      i++;
      continue;
    }

    items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
    i++;
  }

  flushText();

  const thinkingLive = computeThinkingLive(events, agentBusy);
  return { items, agentBusy, thinkingLive };
}

// ─── 2단계: 카드 합류 + 정렬 (증분과 무관 — base 위에서만 동작) ───

/**
 * §5.5 #17-18 ⑦-5 — 카드를 발행한 **직후**에 붙는 "보냈습니다" 한 줄인가.
 *
 * ⑦-4 가 "발행한 뒤에는 본문을 더 붙이지 마라"를 지시문에 못 박았는데도 카드 바로 아래에는
 * **"검수 카드로 확인 지점을 정리해 보냈습니다"** 같은 줄이 매번 따라붙었다. 지시를 어긴 게 아니라
 * **턴의 모양**이 그렇다 — 카드 curl 이 그 턴의 마지막 도구라, 결과를 받은 에이전트는 무언가 말해야
 * 턴이 닫힌다. 이미 화면에 뜬 카드를 다시 말할 뿐이라 정보량은 0 인데, 카드마다 반복돼 #17-21 ② 가
 * 유일하게 펼쳐 두는 자리(마지막 본문 = 결론)를 잡아먹는다.
 *
 * 판정은 **좁게** — 실제 결론 문장을 지우는 쪽이 훨씬 나쁘기 때문이다:
 *  ① 줄바꿈 없는 한 줄, ② 짧다(`CARD_ECHO_MAX_LEN`), ③ 문장 하나(중간에 종결부호가 또 있으면 뒤에
 *  정보가 붙은 것이므로 건드리지 않는다), ④ 카드를 가리키는 낱말 + 발행·전송 동사가 **둘 다** 있다.
 * 여기에 호출측이 "바로 앞이 카드"라는 자리 조건을 더한다(`dropCardEchoTexts`).
 */
const CARD_ECHO_MAX_LEN = 200;
/** "무엇을" — 카드를 가리키는 낱말. 이게 없으면 발송 보고가 아니다. */
const CARD_ECHO_NOUN_RE = /카드|card/i;
/** "어떻게 했다" — 발행·전송 동사(한국어 종결 변형 + 영어). */
const CARD_ECHO_VERB_RE = /보냈|보냅니다|보내 ?[드두]|올렸|올립니다|올려 ?[드두]|띄웠|띄웁니다|띄워 ?[드두]|발행|신고했|신고합니다|전송했|전송합니다|남겼|담아 ?[드두]|정리해 ?[드보]|sent|posted|filed|submitted|published/i;
/** 목록·인용·헤딩·코드로 시작하는 줄은 본문 구조물이므로 대상에서 뺀다. */
const CARD_ECHO_STRUCTURAL_RE = /^[-*#>|`\d]/;

export function isCardEchoText(content: string): boolean {
  const s = content.trim();
  if (s.length === 0 || s.length > CARD_ECHO_MAX_LEN) return false;
  if (s.includes('\n')) return false;
  if (CARD_ECHO_STRUCTURAL_RE.test(s)) return false;
  // 끝의 종결부호는 떼고 본다 — 남은 몸통에 또 있으면 문장이 둘 이상(= 정보가 더 담겼다).
  const body = s.replace(/[.!?。！？]+\s*$/, '');
  if (/[.!?。！？]/.test(body)) return false;
  return CARD_ECHO_NOUN_RE.test(s) && CARD_ECHO_VERB_RE.test(s);
}

/** 뒤로 훑을 때 건너뛰는 항목 — 그 자체로는 에이전트가 "한 말"이 아니다(도구 줄·회색 잡음·라이브 1줄). */
const CARD_ECHO_SKIP_KINDS: ReadonlySet<StreamItemFull['kind']> = new Set(['tool', 'system', 'thinking-live', 'step']);
/** 이 항목 바로 뒤에 붙은 한 줄이라야 발송 보고로 본다. */
const CARD_ECHO_HOST_KINDS: ReadonlySet<StreamItemFull['kind']> = new Set(['report', 'question', 'review', 'list']);

/** `sofar[0..end)` 의 마지막 "말" 이 카드인가(도구·시스템 줄은 건너뛴다). */
function precededByCard(sofar: readonly StreamItemFull[], end: number): boolean {
  for (let k = end - 1; k >= 0; k--) {
    const kind = sofar[k]!.kind;
    if (CARD_ECHO_SKIP_KINDS.has(kind)) continue;
    return CARD_ECHO_HOST_KINDS.has(kind);
  }
  return false;
}

/**
 * §5.5 #17-18 ⑦-5 — 카드 바로 뒤의 발송 보고 한 줄을 표시에서 뺀다.
 * 지울 게 하나도 없으면 **입력 배열을 그대로 돌려준다**(항목 참조 안정 = 재측정 없음).
 */
export function dropCardEchoTexts(items: StreamItemFull[]): StreamItemFull[] {
  let out: StreamItemFull[] | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (
      it.kind === 'text'
      && isCardEchoText(it.content)
      && precededByCard(out ?? items, out ? out.length : i)
    ) {
      if (!out) out = items.slice(0, i);
      continue;
    }
    if (out) out.push(it);
  }
  return out ?? items;
}

/**
 * §5.5 #17-18 ⑥-1·⑥-5 — 정렬 밖 **꼬리**로 뺄 말풍선인가(= 아직 한 번도 안 나간 명령).
 * 판정을 `status === 'queued'` 가 아니라 앵커 값으로 하는 이유: 자리 계산은 `commandAnchorTs`
 * 한 곳이 하고 있으므로, "꼬리인가"도 그 결과를 그대로 읽어야 두 판정이 어긋나지 않는다
 * (재개 대기 중인 명령은 앵커가 제 시각이라 여기 걸리지 않고 제자리에 남는다).
 */
export function isPendingCommandItem(item: StreamItemFull): item is StreamCommand {
  return item.kind === 'command' && item.timestamp === PENDING_COMMAND_TS;
}

/**
 * base 아이템에 카드(reports/questions/reviews/lists/ask)를 시간순 합류 + 정렬.
 * base.items 배열은 새로 복사(원본 mutate 방지). 항목 객체 참조는 그대로 유지(정렬은 포인터만).
 */
export function mergeCardsIntoItems(
  base: BaseItemsResult,
  commands?: QueuedCommand[],
  reports?: AgentReport[],
  questions?: AgentQuestions[],
  reviews?: AgentReview[],
  lists?: AgentList[],
  askRequests?: AskUserQuestionRequest[],
): StreamItemFull[] {
  // §5.5 #17-18 ⑥ — 대기 중(`queued`) 말풍선은 정렬에 참여시키지 않고 **맨 끝**에 붙인다.
  //   아직 안 나간 글이라 시간축 위에 자리가 없다 — 출력이 자라는 동안 계속 아래로 밀리며
  //   "다음에 나갈 것"으로 남아 있다가, dispatch 되는 순간 그 시각으로 정렬에 합류(=자리 고정)한다.
  const items: StreamItemFull[] = [];
  const pendingCommands: StreamCommand[] = [];
  for (const it of base.items) {
    if (isPendingCommandItem(it)) pendingCommands.push(it);
    else items.push(it);
  }

  const cmdTsAsc = dispatchedAnchorsAsc(commands);
  // §5.5 #17-18 ⑦-1 — 카드가 설 자리는 **신고된 그 시각**(`createdAt`)이다. 옛 `turnEndSortTs`(그 턴 끝으로
  //   미루기)는 지금 도는 턴에 뒤에 올 명령이 없어 MAX_SAFE_INTEGER 로 떨어졌고, 그 결과 카드가 화면 바닥에
  //   붙박여 **이후 출력이 전부 카드 위로** 들어갔다 — 사용자에겐 "안 끝났는데 카드부터 나와 끝난 줄 착각",
  //   "중간 카드와 완료 카드가 바닥에서 뒤섞여 언제 뭐가 끝난지 모름"으로 보였다. 이제 카드는 그 자리에
  //   못 박히고 그 뒤 출력은 카드 **아래**로 쌓인다(자리 자체가 시점을 말한다).
  // §5.5 #17-18 ⑦-3 — 턴 식별은 정렬과 분리한다: dispatch 경계를 **몇 개 지났는가**가 곧 턴 번호다.
  const turnIndexOf = (createdAt: number): number => {
    let n = 0;
    for (const ts of cmdTsAsc) { if (ts <= createdAt) n += 1; else break; }
    return n;
  };
  // §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중인가(= 뒤에 나간 명령이 없고 지금 실행 중).
  //   대기(`queued`)만 있는 상태는 앞 턴이 이미 끝난 것이므로 도는 중이 아니다(agentBusy 와 기준이 다르다).
  const lastAnchor = cmdTsAsc[cmdTsAsc.length - 1];
  const turnRunning = (commands ?? []).some((c) => c.status === 'executing');
  const isLive = (createdAt: number): boolean =>
    turnRunning && !(lastAnchor !== undefined && lastAnchor > createdAt);
  // §5.3 #12-2 — 답을 기다리는 AskUserQuestion 만은 종전대로 **그 턴 끝**(없으면 꼬리)에 둔다. 카드와 달리
  //   이건 지나간 보고가 아니라 60초 안에 답해야 하는 요청이라, 눈앞에서 밀려 올라가면 안 된다.
  const pendingAskSortTs = (createdAt: number): number => {
    for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
    return Number.MAX_SAFE_INTEGER;
  };
  // §5.5 #17-12 — 같은 턴에 작업 신고와 검수 요청이 함께 오면 카드 두 장이 겹쳐 무엇이 중요한지 묻힌다.
  //   검수는 그 턴의 신고 카드 **안쪽 구획**으로 흡수하고, 짝이 없는 검수만 독립 카드로 남긴다.
  const reportIdxByTurn = new Map<number, number>();
  for (const r of reports ?? []) {
    reportIdxByTurn.set(turnIndexOf(r.createdAt), items.length);
    items.push({ kind: 'report', id: `report-${r.id}`, report: r, timestamp: r.createdAt, live: isLive(r.createdAt) });
  }
  for (const q of questions ?? []) items.push({ kind: 'question', id: `question-${q.id}`, questions: q, timestamp: q.createdAt, live: isLive(q.createdAt) });
  for (const rv of reviews ?? []) {
    const hostIdx = reportIdxByTurn.get(turnIndexOf(rv.createdAt));
    const host = hostIdx === undefined ? undefined : items[hostIdx];
    if (host && host.kind === 'report' && !host.review) {
      items[hostIdx!] = { ...host, review: rv };
      continue;
    }
    items.push({ kind: 'review', id: `review-${rv.id}`, review: rv, timestamp: rv.createdAt, live: isLive(rv.createdAt) });
  }
  for (const ls of lists ?? []) items.push({ kind: 'list', id: `list-${ls.id}`, list: ls, timestamp: ls.createdAt, live: isLive(ls.createdAt) });
  for (const req of askRequests ?? []) items.push({ kind: 'ask', id: `ask-${req.requestId}`, request: req, timestamp: pendingAskSortTs(req.createdAt) });

  items.sort((a, b) => a.timestamp - b.timestamp);

  // §5.5 #17-18 ⑦-5 — 카드 바로 뒤에 붙는 "~카드로 보냈습니다" 한 줄은 화면에서 뺀다(카드가 이미 하는 말).
  //   정렬 **뒤**에 걷는 이유: "바로 앞이 카드"라는 자리 조건은 시간순으로 놓인 뒤에야 성립한다.
  const visible = dropCardEchoTexts(items);

  // 라이브 1줄 — 정렬에 참여시키지 않고 항상 맨 끝.
  // §5.5 #17-15 — 활성 thinking 블록이 인디케이터를 겸하던 중복 회피는 사라졌다(블록 자체가 없다).
  if (base.thinkingLive) visible.push(base.thinkingLive);

  // §5.5 #17-18 ⑥-1 — 대기 중 말풍선은 라이브 1줄보다도 아래, 화면 맨 끝(= 다음에 나갈 것).
  for (const pending of pendingCommands) visible.push(pending);

  return visible;
}

// ─── identity 안정화 비교(v3.09) ───

/** §5.5 #17-12 ③ — 사유가 붙거나 바뀌면 말풍선을 다시 그려야 한다(렌더에 영향 주는 필드). */
function sameCommandError(a?: CommandError, b?: CommandError): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.code === b.code && a.exitCode === b.exitCode && a.detail === b.detail;
}

function sameAttachments(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) return false; }
  return true;
}

/** 같은 id 의 두 항목이 렌더 결과에 영향 주는 모든 필드까지 동일한가(timestamp 는 렌더 미사용 → 제외). */
export function sameStreamItem(a: StreamItemFull, b: StreamItemFull): boolean {
  if (a.kind !== b.kind) return false;
  switch (b.kind) {
    // §5.5 #17-39 — 본문 말풍선은 끝난 시각도 렌더(작성 자국)에 쓰이므로 비교에 넣는다.
    case 'text': {
      const x = a as StreamText;
      return x.content === b.content && x.endedAt === b.endedAt;
    }
    case 'system':
    case 'result':
    case 'error':
      return (a as StreamSystem | StreamResult | StreamError).content === b.content;
    // §5.5 #17-39 — 단계 자국. 봉인된 뒤로는 안 바뀌지만, 앞쪽 절단·재구축으로 같은 id 가 다시 오면 비교된다.
    case 'step': {
      const x = a as StreamStep;
      return x.phase === b.phase && x.endedAt === b.endedAt && x.chars === b.chars;
    }
    case 'tool': {
      const x = a as StreamGroup;
      return x.toolName === b.toolName && x.input === b.input && x.output === b.output && x.isActive === b.isActive;
    }
    case 'command': {
      const x = a as StreamCommand;
      // §5.5 #17-18 ⑤ v4.77 — dispatchMode 도 렌더(말풍선 색·활성 칩)에 영향 → 비교에 포함.
      return x.prompt === b.prompt && x.result === b.result && x.status === b.status
        && x.dispatchMode === b.dispatchMode && sameCommandError(x.error, b.error)
        && sameAttachments(x.attachments, b.attachments);
    }
    case 'plan': {
      const x = a as StreamPlan;
      if (!!x.superseded !== !!b.superseded) return false;
      if (x.todos.length !== b.todos.length) return false;
      for (let k = 0; k < b.todos.length; k++) {
        const p = x.todos[k]!; const q = b.todos[k]!;
        if (p.content !== q.content || p.status !== q.status) return false;
      }
      return true;
    }
    // §5.5 #17-24 ② — 라벨(mode)이 바뀌면 다시 그려야 한다(생각 중 ↔ 작업 중).
    case 'thinking-live':
      return (a as StreamThinkingLive).mode === b.mode;
    // §5.5 #17-18 ⑦-2 — `live`(작업 중 배지)는 렌더에 영향 → 비교에 포함. 빼면 턴이 끝나도
    //   identity 안정화가 옛 객체를 그대로 재사용해 배지가 영영 안 사라진다.
    case 'report':   return (a as StreamReport).report === b.report && (a as StreamReport).review === b.review && !!(a as StreamReport).live === !!b.live;
    case 'question': return (a as StreamQuestion).questions === b.questions && !!(a as StreamQuestion).live === !!b.live;
    case 'review':   return (a as StreamReview).review === b.review && !!(a as StreamReview).live === !!b.live;
    case 'list':     return (a as StreamList).list === b.list && !!(a as StreamList).live === !!b.live;
    case 'ask':      return (a as StreamAsk).request === b.request;
  }
}

// ─── 증분 파서 ───

/**
 * commands 로 파생되는, 증분 유효성에 영향 주는 컨텍스트(정렬된 턴 경계 + agentBusy).
 *
 * §5.5 #17-18 ⑥ — 경계는 **나간 시각**이므로 대기 중 덧말이 dispatch 되면(=경계가 하나 늘면)
 * 이 키가 바뀌어 전체 재구축으로 안전하게 떨어진다(그 자리에서 본문 런이 끊겨야 하기 때문).
 *
 * ⚠ `agentBusy` 를 **반드시 키에 넣는다** — 파서는 tool_use 를 만드는 순간의 `this.agentBusy` 로
 * `isActive` 를 정하는데, 그 값은 리셋될 때만 갱신된다. 경계 목록이 그대로인 채 상태만 바뀌는 경우
 * (대기 덧말 추가 → busy, 실행 끝 → idle)에 키가 같으면 파서가 **낡은 busy** 로 계속 판정해
 * 전체 재구축과 결과가 갈린다(등가성 테스트가 잡아낸 구멍).
 */
function cmdTsKey(commands: QueuedCommand[] | undefined, agentBusy: boolean): string {
  return `${agentBusy ? '1' : '0'}|${dispatchedAnchorsAsc(commands).join(',')}`;
}

/** 열린 text 블록의 증분 상태 — items[idx] 를 제자리 교체하며 자란다. */
interface OpenBuf {
  idx: number;
  firstId: string;
  firstTs: number;
  lastTs: number;
  chunks: string[];
  /** §4 (스트림 3종 ①) — 이 런의 주인(중첩 Task 호출 id). 값이 바뀌면 런을 끊는다. */
  nested?: string;
}

/**
 * 온라인 증분 파서. `sync(events, commands)` 를 매 틱 호출하면:
 *  - 이전 소비분의 순수 꼬리-확장이면 **신규 이벤트만** 처리(O(신규)).
 *  - 그렇지 않으면(세션 전환/commands 변경/앞쪽 절단/재로드) 전체 재구축으로 리셋.
 * 반환 = 이벤트 파생 StreamItem[] (command 아이템·카드는 호출측이 buildCommandItems/mergeCards 로 합침).
 *
 * 불변식: 어느 시점에 반환한 배열의 내용은 buildBaseItems(consumedEvents).items 에서 command 아이템을
 * 뺀 것과 **항상 동일**(streamItems.test.ts 가 랜덤 시퀀스로 못박음). 변경된 항목만 새 객체가 되어
 * 참조가 안정하므로 memo/virtuoso 가 자란 항목 1개만 재렌더한다.
 */
export class IncrementalStreamParser {
  /** 이벤트 파생 아이템(command 제외). */
  private items: StreamItem[] = [];
  private consumed = 0;
  private lastId: string | null = null;
  private cmdKey = '';
  private agentBusy = false;
  private sortedCmdTs: number[] = [];

  private openText: OpenBuf | null = null;
  /** §5.5 #17-39 — 열린 사고 런(원문 ❌ 길이만). 봉인될 때 자국 한 줄이 된다. */
  private openThink: ThinkRun | null = null;
  /** 짝 없는 tool_use 아이템의 items 인덱스(FIFO). */
  private pending: number[] = [];

  /** 이번 events 가 이전 소비분의 순수 꼬리-확장인지(commands 동일 포함). */
  private canAppend(events: SubAgentStreamEvent[], cmdKey: string): boolean {
    if (cmdKey !== this.cmdKey) return false;
    if (events.length < this.consumed) return false;
    if (this.consumed === 0) return true;
    return events[this.consumed - 1]?.id === this.lastId;
  }

  private resetState(): void {
    this.items = [];
    this.consumed = 0;
    this.lastId = null;
    this.openText = null;
    this.openThink = null;
    this.pending = [];
  }

  private crossesCommand(prevTs: number, nextTs: number): boolean {
    for (const t of this.sortedCmdTs) {
      if (t > prevTs && t <= nextTs) return true;
      if (t > nextTs) break;
    }
    return false;
  }

  private sealText(): void { this.openText = null; }

  /**
   * §5.5 #17-39 — 사고 런 봉인 → 자국 한 줄. **끝에 push** 하므로 `pending`·`openText.idx` 가 가리키는
   * 기존 인덱스는 밀리지 않는다(전체 재구축의 `flushThink` 와 같은 자리·같은 순서).
   */
  private sealThink(): void {
    if (!this.openThink) return;
    const step = thinkRunToStep(this.openThink);
    this.openThink = null;
    if (step) this.items.push(step);
  }

  /** 비-도구 이벤트 도착 → 마지막 비-도구 경계가 갱신되므로 그 앞의 미페어 tool 은 전부 비활성. */
  private deactivatePending(): void {
    for (const p of this.pending) {
      const it = this.items[p]!;
      // 계획 블록도 pending 에 올라오지만(짝 소비용) 활성 상태가 없다 — 도구만 비활성화.
      if (it.kind === 'tool' && it.isActive) this.items[p] = { ...it, isActive: false };
    }
  }

  private processOne(evt: SubAgentStreamEvent): void {
    if (isThinkingPulse(evt) || isHiddenSystem(evt)) return;

    const type = evt.eventType;
    const isNonTool = type !== 'tool_use' && type !== 'tool_result';
    if (isNonTool) this.deactivatePending();

    // §5.5 #17-15 — 사고 원문은 아이템으로 만들지 않는다. 텍스트 런의 경계 역할만 남긴다
    //   (buildBaseItems 와 동일 규약 — 등가성 테스트가 이 대칭을 못박는다).
    // §5.5 #17-39 — 원문 대신 걸린 시간·분량만 런에 모은다.
    if (type === 'thinking') {
      this.sealText();
      // 주인이 바뀌면 런을 끊는다(buildBaseItems 와 같은 규약 — 등가성 테스트가 이 대칭을 못박는다).
      if (thinkOwnerChanged(this.openThink, evt)) this.sealThink();
      this.openThink = extendThinkRun(this.openThink, evt);
      return;
    }

    // 사고 런이 끝났다 — 자국은 뒤이어 올 항목보다 **먼저** 선다(전체 재구축과 같은 순서).
    this.sealThink();

    if (type === 'text') {
      if (this.openText && this.crossesCommand(this.openText.lastTs, evt.timestamp)) this.sealText();
      // §4 (스트림 3종 ①) — 주인이 바뀌면 말풍선을 끊는다(buildBaseItems 와 같은 규약 —
      //   등가성 테스트가 이 대칭을 못박으므로 한쪽만 고치면 즉시 걸린다).
      if (this.openText && this.openText.nested !== evt.nestedUnderToolUseId) this.sealText();
      const nest = evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {};
      if (!this.openText) {
        const idx = this.items.length;
        this.items.push({ kind: 'text', id: evt.id, content: evt.content, timestamp: evt.timestamp, endedAt: evt.timestamp, ...nest });
        this.openText = { idx, firstId: evt.id, firstTs: evt.timestamp, lastTs: evt.timestamp, chunks: [evt.content], nested: evt.nestedUnderToolUseId };
      } else {
        const b = this.openText;
        b.chunks.push(evt.content);
        b.lastTs = evt.timestamp;
        // §5.5 #17-39 — 마지막 델타 시각까지 갱신한다(전체 재구축의 `flushText` 와 같은 값).
        this.items[b.idx] = { kind: 'text', id: b.firstId, content: b.chunks.join(''), timestamp: b.firstTs, endedAt: b.lastTs, ...nest };
      }
      return;
    }

    // 이하 tool_use / tool_result / result / system — 텍스트 버퍼 봉인.
    this.sealText();

    if (type === 'tool_use') {
      const idx = this.items.length;
      // §5.5 #17-12 — TodoWrite 는 계획 블록으로. 짝 tool_result 를 소비해야 하므로 pending 에는 그대로 올린다.
      const planTodos = evt.toolName === PLAN_TOOL_NAME ? parsePlanTodos(evt.content) : null;
      if (planTodos) this.items.push({ kind: 'plan', id: evt.id, todos: planTodos, timestamp: evt.timestamp });
      else this.items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: '', timestamp: evt.timestamp, isActive: this.agentBusy, ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}) });
      this.pending.push(idx);
      return;
    }

    if (type === 'tool_result') {
      const j = this.pending.shift();
      if (j !== undefined) {
        const pendingItem = this.items[j]!;
        // 계획 블록은 결과 본문을 쓰지 않는다(짝을 소비만 하고 화면은 계획 그대로).
        if (pendingItem.kind === 'tool') this.items[j] = { ...pendingItem, output: evt.content, isActive: false };
      } else {
        this.items.push({ kind: 'system', id: evt.id, content: `${evt.toolName ? `[${evt.toolName}] ` : ''}${evt.content}`, timestamp: evt.timestamp });
      }
      return;
    }

    if (type === 'result') {
      this.items.push({ kind: 'result', id: evt.id, content: evt.content, timestamp: evt.timestamp });
      return;
    }

    // §5.5 #17-12 ③ — buildBaseItems 와 동일 규약(등가성 테스트가 이 대칭을 못박는다).
    if (type === 'error') {
      this.items.push({ kind: 'error', id: evt.id, content: evt.content, timestamp: evt.timestamp });
      return;
    }

    // system 등 나머지
    this.items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
  }

  /** 매 틱 호출 — 이벤트 파생 base 를 반환(BaseItemsResult 형태). */
  sync(events: SubAgentStreamEvent[], commands?: QueuedCommand[]): BaseItemsResult {
    const agentBusy = computeAgentBusy(commands);
    const cmdKey = cmdTsKey(commands, agentBusy);

    if (!this.canAppend(events, cmdKey)) {
      // 전체 재구축 — commands 컨텍스트 갱신 후 처음부터.
      this.resetState();
      this.cmdKey = cmdKey;
      this.agentBusy = agentBusy;
      this.sortedCmdTs = dispatchedAnchorsAsc(commands);
    }
    // (canAppend 이면 cmdKey/agentBusy/sortedCmdTs 는 이미 이전과 동일 — 그대로 둔다)

    for (let k = this.consumed; k < events.length; k++) this.processOne(events[k]!);
    this.consumed = events.length;
    this.lastId = events.length ? events[events.length - 1]!.id : null;

    const hasStream = events.length > 0;
    const commandItems = buildCommandItems(commands, hasStream);
    const items: StreamItemFull[] = commandItems.length > 0 ? [...commandItems, ...this.items] : this.items.slice();
    const thinkingLive = computeThinkingLive(events, agentBusy);
    return { items, agentBusy, thinkingLive };
  }
}
