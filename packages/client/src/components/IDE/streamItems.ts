/**
 * SubAgent 스트림 이벤트 → 표시 아이템 파생(순수). 증분 파서는 새 이벤트만 처리하고 바뀐 항목만 새 객체로 바꾼다(O(신규), 참조 안정).
 * 증분이 안 되는 변화(세션 전환·commands 변경·앞쪽 절단·재로드)는 전체 재구축(buildBaseItems)으로 — 둘은 항상 같아야 한다.
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
import { THINKING_PULSE_SUBTYPE, HIDDEN_SYSTEM_SUBTYPES, isHiddenSystemSubtype, extractStageBlocks, readCodexTransportNotice } from '@vibisual/shared';
import { parseSystemSubtype } from './SystemNode.js';
import { shouldTraceThinking, type ThinkRun } from './turnSteps.js';
import { TransportRecoveryAccumulator, sameTransportRecovery, type StreamTransportRecovery } from './streamTransportRecovery.js';
import { StreamErrorAccumulator } from './streamErrorDedup.js';
import { turnStopLabelKey } from './turnStopLabel.js';
import { liveLineActivityAt, liveLineMode, sessionTurnStartedAt, type LiveLineMode } from '../../utils/sessionActivity.js';

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

/** 가장 최근 TodoWrite 의 진행 상태(뒤에서 훑는다). */
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

// §5.5 — 두 목록(펄스·숨김)은 서버가 복원 예산에서 뺄 대상을 고르는 근거이기도 해 원본은 shared 한 벌이다(두 벌이면 그리기와 저장이 어긋난다).
export { THINKING_PULSE_SUBTYPE, HIDDEN_SYSTEM_SUBTYPES, isHiddenSystemSubtype };

export function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

/**
 * §5.5 #17-13 ⑤ — `[task_started]` 처럼 **subtype 단독 패턴**인 SDK 상태 표식인가.
 * 이런 줄은 내용이 없고 레일 점 한 줄만 먹어, 간결/표준 밀도에서는 표시 단계에서 걸러낸다.
 * 내용이 있는 system 본문(권한 결정, 짝 없는 `[ToolName] …` 결과)은 여기에 걸리지 않는다.
 */
export function isSystemSubtypeChip(content: string): boolean {
  return parseSystemSubtype(content) !== null;
}

/** IDE 에서 아예 숨길 system subtype(이름표 `status`·살림성 통지 `*_changed`, §5.5 #17-13 ⑤-4). 판정은 shared 에 있다. */
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
  /**
   * §5.5 #17-39 ⑪ — 짝 `tool_result` 가 **도착한 시각**. `timestamp`(호출이 나간 시각)와의 차이가 곧
   * "이 도구가 쓴 시간"이다. 결과가 아직 없으면(진행 중·중지·거부) 미설정 — 잴 수 없는 것을 0 으로 적지 않는다.
   */
  endedAt?: number;
  isActive: boolean;
  /** §4 (스트림 3종 ①) — 중첩 서브에이전트가 부른 도구면 그 바깥 Task 호출의 id. */
  nestedUnderToolUseId?: string;
}

/** §5.5 #17-12 — 계획 블록(TodoWrite 승격, 짝 tool_result 는 소비). `superseded` 는 streamDensity 가 채운다(같은 턴의 옛 계획). */
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
  /** §4 (스트림 3종 ①) — 중첩 서브에이전트(Task)의 말이면 그 Task 호출의 id. 미설정 = 이 에이전트 자신. */
  nestedUnderToolUseId?: string;
}

/**
 * §5.5 #17-39 — 단계 자국: 끝난 사고 런의 한 줄(`1분 13초 동안 사고함 · 4,182자`). 원문은 담지 않는다(길이·시각뿐, #17-15 ②).
 * **봉인된 런에만** 생긴다(자라는 자국 ❌ — 지금 도는 일은 라이브 1줄).
 */
export interface StreamStep {
  kind: 'step';
  id: string;
  phase: 'thinking';
  /** 런이 시작한 시각 = 이 자국이 설 자리(사고가 있던 그 자리). */
  timestamp: number;
  /**
   * 런이 끝난 시각. `timestamp` 와의 차이가 걸린 시간.
   * ⚠ 간결에서 합친 자국(§5.5 #17-39 ⑩)은 `timestamp + 사고 시간의 합`이라 시각이 아니다 — **차이로만** 읽어라.
   */
  endedAt: number;
  /** 그동안 흘러나온 사고 분량(글자 수). 원문은 어디에도 남기지 않는다. */
  chars: number;
  /**
   * §4 (스트림 3종 ①) — 이 사고가 **중첩 서브에이전트(Task)** 의 것이면 그 Task 호출의 id. 미설정 = 이 에이전트 자신.
   * §5.5 #17-39 ⑩ — 간결에서 이어 붙은 자국을 합칠 때 주인이 다르면 섞지 않으려고 든다.
   */
  nestedUnderToolUseId?: string;
}

export interface StreamSystem {
  kind: 'system';
  id: string;
  content: string;
  timestamp: number;
  transportRecovery?: StreamTransportRecovery;
}

export interface StreamResult {
  kind: 'result';
  id: string;
  content: string;
  timestamp: number;
}

/** §5.5 #17-12 ③ — 턴이 실패로 끝난 자리의 오류 줄(`[code:exit] 원문`, 문장은 렌더가 `describeCommandError` 로). 시스템 줄로 흘리면 회색 잡음에 묻힌다. */
export interface StreamError {
  kind: 'error';
  id: string;
  /** 서버 원문(`[code:exit] detail`). 파싱은 표시 시점에 한다(저장 형태는 서버가 준 그대로). */
  content: string;
  timestamp: number;
}

/**
 * 라이브 1줄 — 에이전트가 작동하는 **내내** 본문 하단에 1개 떠 있다(#17-24 ② 상시 표시). 마지막 이벤트
 * 종류는 켜고 끄는 스위치도, 라벨을 고르는 값도 아니다(#17-24 ⑦ — 작동 중이면 늘 `작업 중`).
 */
export interface StreamThinkingLive {
  kind: 'thinking-live';
  id: string;
  /**
   * `working` 작동 중 · `waiting` 줄만 서 있고 아무것도 안 돈다(§5.5 #17-18 ⑪) · `compacting` CLI 가 접는 중(#17-24 ⑥). 라벨·색만 가른다(생멸 ❌).
   * 사고 전용 모드는 두지 않는다(#17-24 ⑦ — 멈춘 것으로 읽힌다). 도는 것과 줄 선 것이 같은 낱말이면 멈춘 `queued` 덧말도 "작업 중"이 된다.
   */
  mode: LiveLineMode;
  timestamp: number;
  /** §2.4 (무응답) — 마지막으로 무언가 온 시각. 무응답 판정(`liveLineStalled`)과 "마지막 업데이트 N 전"에만 쓴다(`timestamp` 는 정렬용). 근거가 없으면 `null`(0 ❌). */
  lastActivityAt: number | null;
  /** §5.5 #17-10 ⑥-6 (턴 시계) — 지금 일이 시작된 시각(대기면 줄 선 시각). 평소 경과의 시작점이다(위 시계면 줄마다 0 으로 되감긴다). 없으면 `null`. */
  turnStartedAt: number | null;
  /**
   * §5.3 #9-1 (P) — 감춘 턴(조용한 사전 압축)이 도는 중. 그 턴의 줄은 오지 않으므로 이 줄은 경과만
   * 적고 무응답으로 뒤집지 않는다(`liveLineStalled` · §5.5 #17-10 ⑥-6). 아니면 키 자체가 없다.
   */
  hiddenTurn?: true;
  /**
   * §5.5 #17-24 ⑥ — 넷째 모드(`compacting`)일 때만 — CLI 가 접기 시작한 시각. 그 모드의 경과는 턴 시작이
   * 아니라 이 시각부터 잰다(`liveLineClockFrom`). 아니면 키 자체가 없다.
   */
  compactingSince?: number;
}

/** §4 — 작업 신고 카드(createdAt 을 timestamp 로 시간순 합류). §5.5 #17-12 — 같은 턴의 검수 요청은 이 카드 안쪽 구획(`review`)으로 흡수된다. */
export interface StreamReport {
  kind: 'report';
  id: string;
  report: AgentReport;
  review?: AgentReview;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 **아직 도는 중**(헤더에 `작업 중` 배지). 턴이 끝나면 사라진다. */
  live?: boolean;
}

/** §4 — 질문 카드(createdAt 을 timestamp 로 시간순 합류). */
export interface StreamQuestion {
  kind: 'question';
  id: string;
  questions: AgentQuestions;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중. */
  live?: boolean;
}

/** §4 — 검수 요청 카드(createdAt 을 timestamp 로 시간순 합류). */
export interface StreamReview {
  kind: 'review';
  id: string;
  review: AgentReview;
  timestamp: number;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중. */
  live?: boolean;
}

/** §4 — 번호 목록 정렬 카드(createdAt 을 timestamp 로 시간순 합류). */
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
  /** 내가 보낸 시각(큐 투입) — 말풍선의 `오늘 14:32` 는 이 값이다. 위 `timestamp` 는 말풍선 자리(대기면 `PENDING_COMMAND_TS`)라 표기에 쓰면 서기 275760년이 된다. */
  submittedAt?: number;
  /** 전송한 paste 이미지 첨부의 절대경로(완료 후에도 보존). basename 으로 blob preview 를 찾는다. */
  attachments?: string[];
  /** §5.5 #17-18 — 함께 실려 나간 덧말 수(합치기). 0/undefined = 단독. */
  mergedCount?: number;
  /** 앱/서버가 내려가 끊긴 명령을 보존된 세션으로 다시 이어 돌린 건인가 — 표시하지 않으면 재개 중에도 그냥 멈춘 것으로 보인다. */
  restartResumed?: boolean;
  /** §5.5 #17-18 ⑤ — 큐의 원본 명령 id(`cmd-` 접두어 없음). 말풍선의 [대기|합치기|즉시]·삭제가 이 id 로 큐를 손댄다. */
  commandId?: string;
  /** §5.5 #17-18 ⑤ — 대기 중인 덧말의 dispatch 방식(말풍선 색·칩 활성 표시). */
  dispatchMode?: CommandDispatchMode;
  /**
   * §5.5 #17-12 ③ — 오류로 끝난 이유. `result` 와 같은 규약으로 **스트림이 없을 때만** 싣는다 —
   * 스트림이 있으면 실패한 그 자리에 `error` 항목이 이미 서 있어 두 번 읽게 된다.
   */
  error?: CommandError;
}

/**
 * §5.25 (O) — 엔진이 대화에 내건 그림 한 장. 전선에선 `text` 지만 따로 선다(말풍선 런에 섞이면 그림이 사라진다).
 * `src` 는 두지 않는다 — 주소는 `id`·세션으로 화면이 만든다(경로는 서버 밖으로 나가지 않는다).
 */
export interface StreamImage {
  kind: 'image';
  id: string;
  /** 파일 이름. 그림이 못 뜨는 자리에서도 무엇인지는 말해야 한다. */
  content: string;
  timestamp: number;
  /** §4 (스트림 3종 ①) — 중첩 서브에이전트가 낸 그림이면 그 Task 호출의 id. */
  nestedUnderToolUseId?: string;
}

/**
 * §5.5 #17-12 ③-6 (g) — 이 턴이 왜 멈췄는지 말하는 한 줄. 말풍선 안이 아니라 자기 항목으로 턴의 꼬리에 선다(말풍선 자리는 나간 시각이라 출력보다 위다).
 * 낱말은 `turnStopLabelKey`(하단 상태바와 같은 함수)가 정한다.
 */
export interface StreamTurnStop {
  kind: 'turnstop';
  id: string;
  /** i18n 키. 여기까지 왔다는 것 자체가 "말할 것이 있다"는 판정을 통과했다는 뜻이다. */
  labelKey: string;
  timestamp: number;
}

export type StreamItem =
  | StreamText | StreamGroup | StreamSystem | StreamResult | StreamError | StreamPlan | StreamStep
  | StreamThinkingLive | StreamReport | StreamQuestion | StreamReview | StreamList | StreamAsk
  | StreamImage | StreamTurnStop;

export type StreamItemFull = StreamItem | StreamCommand;

/** 1단계 결과 — events + commands 만으로 만든 base 아이템과, events 로 결정되는 라이브 상태. */
export interface BaseItemsResult {
  items: StreamItemFull[];
  agentBusy: boolean;
  thinkingLive: StreamThinkingLive | null;
  /** 턴 도장으로 보정한 표시 순서. 실제 시각·소요 시간은 각 항목의 timestamp/endedAt에 남긴다. */
  sortTimestamps?: ReadonlyMap<string, number>;
}

// ─── 공통 헬퍼(전체·증분이 공유) ───

/**
 * §5.5 #17-18 ⑥ — 아직 안 나간 말풍선의 정렬 키. 어떤 실제 시각보다도 크므로 **항상 꼬리**에 선다
 * (실제 꼬리 배치는 `mergeCardsIntoItems` 가 정렬 밖으로 빼서 확정한다 — 이 값은 그 전 단계의 정렬용).
 */
export const PENDING_COMMAND_TS = Number.MAX_SAFE_INTEGER;

/**
 * §5.5 #17-18 ⑥-5 — 한 번이라도 나갔는가. `status !== 'queued'` 만 보면 안 된다 — 부팅 reconcile 이 끊긴 명령을 재개하려고 `queued` 로 되돌린다
 * (§5.3 #12-1). `startedAt` 이 있으면 나간 적이 있으니 처음 나간 시각에 남는다.
 */
export function hasDispatched(cmd: QueuedCommand): boolean {
  return cmd.status !== 'queued' || cmd.startedAt !== undefined;
}

/** §5.5 #17-18 ⑥ — 말풍선이 설 자리: 안 나간 `queued` 는 꼬리, 그 외는 나간 시각(`startedAt` — 턴 경계선), `startedAt` 없는 옛 명령은 큐 투입 시각. */
export function commandAnchorTs(cmd: QueuedCommand): number {
  if (!hasDispatched(cmd)) return PENDING_COMMAND_TS;
  return cmd.startedAt ?? cmd.timestamp;
}

/**
 * §5.5 #17-18 ⑥ — 턴 경계로 쓰이는 시각들(오름차순). **이미 나간 명령만** 경계가 된다 —
 * 대기 중 덧말은 아직 아무것도 끊지 않았으므로 본문 런도 카드 자리도 가르지 않는다.
 * (재개 대기 중인 명령은 이미 한 번 끊었으므로 ⑥-5 규칙대로 경계에 남는다.)
 */
function dispatchedAnchorsAsc(commands: readonly QueuedCommand[] | undefined): number[] {
  const out: number[] = [];
  for (const c of commands ?? []) {
    if (!hasDispatched(c)) continue;
    out.push(commandAnchorTs(c));
  }
  return out.sort((a, b) => a - b);
}

/**
 * §5.5 #17-12 ③-6 (g) — 그 턴의 마지막 일이 설 자리: 다음 경계 바로 앞(`-0.5`) = 그 턴 마지막 줄 아래·다음 말풍선 위.
 * 마지막 턴이면 꼬리에 서되 대기 말풍선·라이브 1줄(`PENDING_COMMAND_TS`)보다 한 칸 위다(§5.3 #12-2 물음 카드와 같은 규약).
 */
export function turnTailSortTs(anchor: number, dispatchedAsc: readonly number[]): number {
  for (const ts of dispatchedAsc) { if (ts > anchor) return ts - 0.5; }
  return PENDING_COMMAND_TS - 1;
}

// ─── 턴 단위 결과 폴백 (§5.5 #17-12 ③-3) ───

/** 나간 명령의 (경계 시각, 명령 id) — 도장 없는 줄을 시각으로 제 턴에 귀속시킬 때 쓴다. */
export interface TurnAnchor { ts: number; id: string }

/**
 * 나간 명령의 경계를 (시각, id) 쌍으로 오름차순 정렬. `dispatchedAnchorsAsc` 와 같은 명령·같은 시각을
 * 쓰되 **어느 명령인지**까지 든다 — 시각만으로는 그 자리에 무엇을 채워 넣을지 알 수 없다.
 */
export function dispatchedTurnAnchorsAsc(commands: readonly QueuedCommand[] | undefined): TurnAnchor[] {
  const out: TurnAnchor[] = [];
  for (const c of commands ?? []) {
    if (!hasDispatched(c)) continue;
    out.push({ ts: commandAnchorTs(c), id: c.id });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

interface TurnSortBounds { start: number; tail: number }

/** 늦은 출력도 다음 명령과 중지 표시를 넘지 않도록, 이미 나간 턴의 표시 구간을 만든다. */
function turnSortBounds(anchors: readonly TurnAnchor[]): Map<string, TurnSortBounds> {
  const times = anchors.map((anchor) => anchor.ts);
  return new Map(anchors.map((anchor) => [anchor.id, {
    start: anchor.ts, tail: turnTailSortTs(anchor.ts, times),
  }]));
}

/** 버퍼의 삽입 순서는 마지막 시간순 정렬에서 사라진다. 도장이 있는 줄은 별도 정렬키로 제 턴에 남긴다. */
function recordEventSortTimestamp(
  keys: Map<string, number>, evt: SubAgentStreamEvent, bounds: ReadonlyMap<string, TurnSortBounds>,
): void {
  const turn = evt.turnId ? bounds.get(evt.turnId) : undefined;
  if (!turn) return;
  const timestamp = Math.max(turn.start, Math.min(evt.timestamp, turn.tail));
  if (timestamp === evt.timestamp) return;
  keys.set(evt.id, timestamp);
  if (evt.eventType === 'thinking') keys.set(`step-${evt.id}`, timestamp);
}

/**
 * 이 줄이 속한 턴의 명령 id. 턴 세대 도장(`turnId`)이 있으면 그것, 없으면 **나간 시각**으로 —
 * `crossesCommand` 와 같은 경계(`anchor <= ts` 면 그 명령의 턴)라 본문 런이 갈리는 자리와 귀속이
 * 어긋나지 않는다. 첫 명령보다 앞선 복원 본문은 짝지을 말풍선이 없으므로 `null`.
 */
export function turnOfEvent(evt: SubAgentStreamEvent, anchors: readonly TurnAnchor[]): string | null {
  if (evt.turnId) return evt.turnId;
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[mid]!.ts <= evt.timestamp) lo = mid + 1; else hi = mid;
  }
  return lo === 0 ? null : anchors[lo - 1]!.id;
}

/**
 * 어느 턴의 말이 **버퍼에 실제로 남아 있는가**.
 *  - `answered`: 그 턴의 AI 본문(`text` — 부모 자신의 말, 그림·중첩 Task 의 말 ❌) 또는 `result` 줄이 하나라도 있다.
 *  - `failed`: 그 턴의 `error` 줄이 있다.
 */
export interface TurnCoverage {
  answered: Set<string>;
  failed: Set<string>;
}

export function emptyTurnCoverage(): TurnCoverage {
  return { answered: new Set(), failed: new Set() };
}

/** 이 줄이 "그 턴이 답했다"의 증거인가 — 부모 자신의 본문이거나 CLI 의 결과 줄. 그림·중첩 Task 의 말은 아니다. */
function isTurnAnswer(evt: SubAgentStreamEvent): boolean {
  if (evt.eventType === 'result') return true;
  return evt.eventType === 'text' && !evt.imagePath && !evt.nestedUnderToolUseId;
}

/** 줄 하나를 커버리지에 보탠다 — 전체 재구축·증분 파서가 **같은 함수**를 쓴다(등가성 시험이 대칭을 못박는다). */
export function coverTurn(cov: TurnCoverage, evt: SubAgentStreamEvent, anchors: readonly TurnAnchor[]): void {
  const answer = isTurnAnswer(evt);
  const failure = evt.eventType === 'error' && !readCodexTransportNotice(evt);
  if (!answer && !failure) return;
  const turn = turnOfEvent(evt, anchors);
  if (turn === null) return;
  if (answer) cov.answered.add(turn);
  if (failure) cov.failed.add(turn);
}

/** 버퍼 전체에서 턴 커버리지를 만든다(O(전체) — 전체 재구축 경로 전용). */
export function turnCoverageOf(events: readonly SubAgentStreamEvent[], anchors: readonly TurnAnchor[]): TurnCoverage {
  const cov = emptyTurnCoverage();
  for (const evt of events) coverTurn(cov, evt, anchors);
  return cov;
}

/**
 * commands → 사용자 프롬프트 블록. §5.5 #17-12 ③-3 — 저장된 `result`·`error` 는 **그 턴의** 말·오류 줄이 스트림에 남아 있을 때만 비운다.
 * 세션 단위로 비우면 복원 창 밖으로 밀린 턴은 말풍선만 남는다.
 */
function buildCommandItems(commands: readonly QueuedCommand[] | undefined, coverage: TurnCoverage): StreamItemFull[] {
  const items: StreamItemFull[] = [];
  if (commands && commands.length > 0) {
    // §5.5 #17-12 ③-6 (g) — 멈춤 한 줄을 그 턴의 꼬리에 놓으려면 **다음 턴 경계**가 필요하다.
    const cmdTsAsc = dispatchedAnchorsAsc(commands);
    for (const cmd of commands) {
      // §5.3 #9-1 (P) — 우리가 사용자 명령 앞에 끼운 조용한 압축은 **말풍선이 되지 않는다.**
      //   사용자가 친 적이 없는 글이라, 뜨면 자기 대화에 `/compact` 가 섞여 보인다. 그 명령이
      //   도는 동안 화면이 "작업 중"인 것은 `isSessionRunning` 이 따로 맡는다(그쪽은 안 거른다).
      if (cmd.silent) continue;
      items.push({
        kind: 'command',
        id: `cmd-${cmd.id}`,
        prompt: cmd.text,
        result: coverage.answered.has(cmd.id) ? '' : (cmd.result ?? ''),
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
        error: coverage.failed.has(cmd.id) ? undefined : cmd.error,
      });
      // §5.5 #17-12 ③-6 (g) — 멈춘 이유는 말풍선 안(= 나간 시각, 출력 전부보다 위)이 아니라
      //   **그 턴의 꼬리**에 자기 항목으로 선다. 만드는 곳이 여기 하나뿐이라 전체 재구축·증분 파서가
      //   같은 항목을 같은 자리에 낸다(등가성 시험이 그 대칭을 못박는다).
      const stopLabelKey = turnStopLabelKey(cmd.stopReason, cmd.status);
      if (stopLabelKey) {
        items.push({
          kind: 'turnstop',
          id: `turnstop-${cmd.id}`,
          labelKey: stopLabelKey,
          timestamp: turnTailSortTs(commandAnchorTs(cmd), cmdTsAsc),
        });
      }
    }
  }
  return items;
}

/**
 * 이 스트림이 작동 중인가(라이브 1줄·도구 블록 `isActive`). ⚠ `override` 가 오면 **그것이 답이다**(호출부가 `hasSessionWork` 로 원본 큐 위에서 냈다).
 * 목록은 표시용 사본이라 압축을 감추고 대기 명령을 `executing` 으로 그리며, 되살아난 세션은 명령이 아카이브에 있다 — 없을 때만 추정한다.
 */
function computeAgentBusy(commands: readonly QueuedCommand[] | undefined, override?: boolean): boolean {
  if (override !== undefined) return override;
  return !!commands && commands.some((c) => c.status === 'executing' || c.status === 'queued');
}

/**
 * 줄만 서 있는가(§5.5 #17-18 ⑪ · `isSessionWaiting`). `override` 규약은 `computeAgentBusy` 와 같다.
 * 추정은 표시 사본이라 `waiting` 이 안 켜지는 쪽으로만 틀린다(없는 대기를 지어내지 않는다).
 */
function computeAgentWaiting(commands: readonly QueuedCommand[] | undefined, override?: boolean): boolean {
  if (override !== undefined) return override;
  if (!commands) return false;
  return !commands.some((c) => c.status === 'executing') && commands.some((c) => c.status === 'queued');
}

/**
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄 경과의 시작점. 부모 값(`useSessionLivenessFacts`)이 오면 그것이 답이고 `null` 도 답이다.
 * 안 오는 자리(Auto Agent 패널)만 목록으로 추정한다 — 빼면 그 자리의 줄이 경과를 잃는다.
 */
function resolveTurnStartedAt(
  commands: readonly QueuedCommand[] | undefined,
  agentWaiting: boolean,
  override?: number | null,
): number | null {
  if (override !== undefined) return override;
  return sessionTurnStartedAt(commands ?? [], [], null, agentWaiting);
}

/** §5.5 #17-39 — 봉인된 사고 런 → 자국. 문턱(`shouldTraceThinking`)을 못 넘으면 `null`. 전체 재구축·증분 파서가 **같은 함수**를 쓴다(두 벌이면 경로마다 달라진다). */
function thinkRunToStep(run: ThinkRun): StreamStep | null {
  if (!shouldTraceThinking(run)) return null;
  return {
    kind: 'step',
    id: `step-${run.firstId}`,
    phase: 'thinking',
    timestamp: run.startedAt,
    endedAt: run.endedAt,
    chars: run.chars,
    ...(run.nested ? { nestedUnderToolUseId: run.nested } : {}),
  };
}

/** 사고 이벤트 하나를 열린 런에 보탠다(없으면 연다). **원문은 담지 않고 길이만 센다.** */
type TurnThinkRun = ThinkRun & { turnId: string | null };

function extendThinkRun(open: TurnThinkRun | null, evt: SubAgentStreamEvent, turnId: string | null): TurnThinkRun {
  if (!open) {
    return {
      firstId: evt.id, startedAt: evt.timestamp, endedAt: evt.timestamp, chars: evt.content.length, turnId,
      ...(evt.nestedUnderToolUseId ? { nested: evt.nestedUnderToolUseId } : {}),
    };
  }
  open.endedAt = evt.timestamp;
  open.chars += evt.content.length;
  return open;
}

/** §4 (스트림 3종 ①) — 이 사고가 열린 런과 **주인이 다른가**(부모 ↔ 중첩 Task). 다르면 런을 끊는다. */
function thinkOwnerChanged(open: TurnThinkRun | null, evt: SubAgentStreamEvent, turnId: string | null): boolean {
  return !!open && (open.nested !== evt.nestedUnderToolUseId || open.turnId !== turnId);
}

/**
 * 라이브 "작업 중 …" 1줄 — 작동하는 동안 항상 켠다(§5.5 #17-24 ② — 조건은 `agentBusy` 하나, id 고정이라 생멸·깜빡임이 없다).
 * §5.5 #17-24 ⑦ — 마지막 이벤트로 라벨을 고르지 않는다(시계 재료로만) — 사고면 `생각 중`이라 적으면 큰 `Write` 입력 중에도 멈춘 것으로 읽힌다.
 */
function computeThinkingLive(
  events: SubAgentStreamEvent[],
  agentBusy: boolean,
  agentWaiting = false,
  sessionActivityAt: number | null = null,
  activityHidden = false,
  turnStartedAt: number | null = null,
  compactingSince: number | null = null,
): StreamThinkingLive | null {
  if (!agentBusy) return null;
  const lastRaw = events[events.length - 1];
  // §5.5 #17-18 ⑪ — 줄 선 것이 먼저다(도는 것이 없으면 마지막 이벤트는 잔상이다). 규칙은 메인 탭과 같은 함수 한 곳(대기 > 압축 > 작업, #17-24 ⑥ ⑦).
  const mode = liveLineMode(agentWaiting, compactingSince !== null);
  // 정렬에 참여하지 않고 늘 맨 끝이라 timestamp 는 순서에 영향이 없다(없으면 0).
  // §2.4 — 무응답 시계는 마지막 활동 시각(`liveLineActivityAt`, 메인 탭과 같은 함수), 감춘 턴 중엔 안 뒤집는다. 평소 경과는 `turnStartedAt` 부터(§5.5 #17-10 ⑥-6).
  return {
    kind: 'thinking-live', id: 'thinking-live', mode,
    timestamp: lastRaw?.timestamp ?? 0,
    lastActivityAt: liveLineActivityAt(lastRaw?.timestamp, sessionActivityAt),
    turnStartedAt,
    ...(mode === 'compacting' && compactingSince !== null ? { compactingSince } : {}),
    ...(activityHidden ? { hiddenTurn: true as const } : {}),
  };
}

// ─── 1단계: 전체 재구축(참조 구현) ───

/**
 * events + commands 만으로 base 아이템을 빌드(카드 제외). O(전체 길이).
 * IncrementalStreamParser 의 정답지이자, 증분이 불가능한 변화의 폴백 경로.
 */
export function buildBaseItems(
  events: SubAgentStreamEvent[],
  commands?: readonly QueuedCommand[],
  /** §2.4 — 호출부가 공유 술어로 낸 생존 판정. 주면 이것이 답이다(`computeAgentBusy` 주석 참조). */
  agentBusyOverride?: boolean,
  /** §5.5 #17-18 ⑪ — 같은 규약의 "줄만 서 있는가"(`isSessionWaiting`). */
  agentWaitingOverride?: boolean,
  /** §2.4 (무응답) — 세션이 마지막으로 움직인 시각(명령 시작 포함). 라이브 1줄 시계의 바닥. */
  sessionActivityAt?: number | null,
  /** §5.3 #9-1 (P) — 감춘 턴(조용한 사전 압축)이 도는 중이면 라이브 줄은 무응답으로 안 뒤집는다. */
  activityHidden?: boolean,
  /** §5.5 #17-10 ⑥-6 (턴 시계) — 지금 턴(대기면 줄 선) 시작 시각. 라이브 1줄이 평소 적는 경과의 시작점. */
  turnStartedAt?: number | null,
  /** §5.5 #17-24 ⑥ — CLI 가 접는 중이면 그 시작 시각(`useSessionLivenessFacts().compactingSince`). */
  compactingSince?: number | null,
): BaseItemsResult {
  // §5.5 #17-12 ③-3 — 말풍선의 저장된 결과는 **그 턴의 말이 버퍼에 남아 있는지**로 턴마다 갈린다.
  const turnAnchors = dispatchedTurnAnchorsAsc(commands);
  const sortBounds = turnSortBounds(turnAnchors);
  const sortTimestamps = new Map<string, number>();
  const items: StreamItemFull[] = buildCommandItems(commands, turnCoverageOf(events, turnAnchors));
  const agentBusy = computeAgentBusy(commands, agentBusyOverride);
  const agentWaiting = computeAgentWaiting(commands, agentWaitingOverride);

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

  let textBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number; nested?: string; turnId: string | null } | null = null;
  // §5.5 #17-39 — 열린 사고 런(원문 ❌ 길이만). 봉인될 때 자국 한 줄이 된다.
  let thinkBuf: TurnThinkRun | null = null;
  const recovery = new TransportRecoveryAccumulator();
  const errors = new StreamErrorAccumulator();

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
    recordEventSortTimestamp(sortTimestamps, evt, sortBounds);
    const turnId = turnOfEvent(evt, turnAnchors);

    if (readCodexTransportNotice(evt)) {
      flushText();
      flushThink();
    }
    if (recovery.consume(evt, turnId, items)) { i++; continue; }

    if (isThinkingPulse(evt)) { i++; continue; }
    if (isHiddenSystem(evt)) { i++; continue; }

    // §5.5 #17-15 — 사고 원문은 아이템으로 만들지 않는다(라이브 1줄이 유일한 표면).
    //   다만 **텍스트 런의 경계**로는 남긴다 — 사고를 사이에 둔 앞뒤 설명은 종전처럼 두 말풍선.
    // §5.5 #17-39 — 원문 대신 **얼마나 걸렸고 얼마나 나왔는지**만 런에 모은다(원문 버퍼 ❌).
    if (evt.eventType === 'thinking') {
      flushText();
      // 주인이 바뀌면 런을 끊는다 — 부모와 자식의 사고를 한 덩어리로 재면 아무도 안 쓴 시간이 적힌다.
      if (thinkOwnerChanged(thinkBuf, evt, turnId)) flushThink();
      thinkBuf = extendThinkRun(thinkBuf, evt, turnId);
      i++;
      continue;
    }

    // 사고가 아닌 이벤트가 왔다 = 사고 런이 끝났다. 자국은 뒤이어 올 항목보다 **먼저** 선다.
    flushThink();

    // §5.25 (O) — 그림은 말풍선 런에 섞지 않는다. 합치는 순간 `imagePath` 가 버려져
    //   그림은 사라지고 파일 이름만 문장 중간에 끼어든다. 앞 런을 닫고 한 장씩 선다.
    //   (증분 파서에도 같은 규약이 있다 — 등가성 시험이 둘의 대칭을 못박는다.)
    if (evt.eventType === 'text' && evt.imagePath) {
      flushText();
      items.push({
        kind: 'image',
        id: evt.id,
        content: evt.content,
        timestamp: evt.timestamp,
        ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}),
      });
      i++;
      continue;
    }

    if (evt.eventType === 'text') {
      if (textBuf && crossesCommand(textBuf.lastTs, evt.timestamp)) flushText();
      if (textBuf && textBuf.turnId !== turnId) flushText();
      // §4 (스트림 3종 ①) — **주인이 바뀌면 말풍선을 끊는다.** 중첩 서브에이전트의 말과 부모의 말이
      //   한 덩어리로 붙으면 누가 한 말인지 사라진다(전달을 켜는 순간 대화록이 섞이는 자리).
      if (textBuf && textBuf.nested !== evt.nestedUnderToolUseId) flushText();
      if (!textBuf) {
        textBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp, nested: evt.nestedUnderToolUseId, turnId };
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
        // §5.5 #17-39 ⑪ — 결과가 도착한 시각까지 든다(도구 상자 머리줄의 걸린 시간 — 증분 파서와 같은 값).
        items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: resultEvt.content, timestamp: evt.timestamp, endedAt: resultEvt.timestamp, isActive: false, ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}) });
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
      const makeError = (event: SubAgentStreamEvent): StreamError => ({ kind: 'error', id: event.id, content: event.content, timestamp: event.timestamp });
      if (!errors.consume(evt, turnId, items, makeError)) items.push(makeError(evt));
      i++;
      continue;
    }

    items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
    i++;
  }

  flushText();

  recovery.projectStopped(items, commands, agentBusy && !agentWaiting);

  const thinkingLive = computeThinkingLive(events, agentBusy, agentWaiting, sessionActivityAt ?? null, activityHidden ?? false, resolveTurnStartedAt(commands, agentWaiting, turnStartedAt), compactingSince ?? null);
  return { items, agentBusy, thinkingLive, sortTimestamps };
}

// ─── 2단계: 카드 합류 + 정렬 (증분과 무관 — base 위에서만 동작) ───

/**
 * §5.5 #17-18 ⑦-5 — 카드 발행 직후의 "보냈습니다" 한 줄인가(카드 curl 이 턴의 마지막 도구라 에이전트가 무언가 말해야 턴이 닫힌다 — 정보량 0 이 결론 자리를 먹는다).
 * 판정은 **좁게**(결론을 지우는 쪽이 훨씬 나쁘다): 한 줄 · 짧음(`CARD_ECHO_MAX_LEN`) · 문장 하나 · 카드 낱말 + 발행 동사 둘 다. 자리 조건은 `dropCardEchoTexts`.
 * ⑦-6 — 닫는 문장 "카드를 확인해 주세요." 와 흔한 변형(`CARD_CLOSING_*_RE`)만 함께 뺀다. 판정은 목표 창 블록을 걷은 보이는 글로(적용은 서버가 원문으로).
 */
const CARD_ECHO_MAX_LEN = 200;
/** "무엇을" — 카드를 가리키는 낱말. 이게 없으면 발송 보고가 아니다. */
const CARD_ECHO_NOUN_RE = /카드|card/i;
/** "어떻게 했다" — 발행·전송 동사(한국어 종결 변형 + 영어). */
const CARD_ECHO_VERB_RE = /보냈|보냅니다|보내 ?[드두]|올렸|올립니다|올려 ?[드두]|띄웠|띄웁니다|띄워 ?[드두]|발행|신고했|신고합니다|전송했|전송합니다|남겼|담아 ?[드두]|정리해 ?[드보]|sent|posted|filed|submitted|published/i;
/** 목록·인용·헤딩·코드로 시작하는 줄은 본문 구조물이므로 대상에서 뺀다. */
const CARD_ECHO_STRUCTURAL_RE = /^[-*#>|`\d]/;
/** ⑦-6 — 지시문이 정해 준 닫는 문장(끝 종결부호를 뗀 몸통). 앞에는 자리("위")·카드 종류 낱말만 받는다 — "결제 카드를 확인해 주세요"는 남는다. */
const CARD_CLOSING_KO_RE = /^(?:(?:위|아래)의? ?)?(?:(?:검수|질문|작업 ?신고|신고|목록) ?)?카드를? ?확인(?:해 ?주세요|해 ?주십시오| ?부탁드립니다)$/;
const CARD_CLOSING_EN_RE = /^(?:please )?(?:check|review|see) the (?:(?:review|questions?|report|list) )?card(?: above| below)?$/i;
/** 무대 블록을 걷어 볼 본문 길이 상한 — 목표 창 블록은 길어도 수 KB 라, 이보다 길면 닫는 한 줄일 수 없다(매 렌더 전체 훑기 방지). */
const CARD_ECHO_SCAN_MAX = 8_000;

/** 렌더가 숨기는 무대 블록(```vibisual 등)을 걷어 낸, 화면에 실제로 보이는 글. */
function visibleProseOf(content: string): string {
  if (content.length > CARD_ECHO_SCAN_MAX || (!content.includes('```') && !content.includes('~~~'))) return content.trim();
  const spans = extractStageBlocks(content);
  if (spans.length === 0) return content.trim();
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += content.slice(at, span.start);
    at = span.end;
  }
  return (out + content.slice(at)).trim();
}

/** ⑦-6 — 화면에 아무것도 그리지 않는 본문인가(비었거나 무대 블록뿐). 뒤로 훑을 때 "말"로 치지 않는다. */
export function isInvisibleStreamText(content: string): boolean {
  return visibleProseOf(content).length === 0;
}

export function isCardEchoText(content: string): boolean {
  const s = visibleProseOf(content);
  if (s.length === 0 || s.length > CARD_ECHO_MAX_LEN) return false;
  if (s.includes('\n')) return false;
  if (CARD_ECHO_STRUCTURAL_RE.test(s)) return false;
  // 끝의 종결부호는 떼고 본다 — 남은 몸통에 또 있으면 문장이 둘 이상(= 정보가 더 담겼다).
  const body = s.replace(/[.!?。！？]+\s*$/, '');
  if (/[.!?。！？]/.test(body)) return false;
  if (CARD_CLOSING_KO_RE.test(body) || CARD_CLOSING_EN_RE.test(body)) return true;
  return CARD_ECHO_NOUN_RE.test(s) && CARD_ECHO_VERB_RE.test(s);
}

/** 뒤로 훑을 때 건너뛰는 항목 — 그 자체로는 에이전트가 "한 말"이 아니다(도구 줄·회색 잡음·라이브 1줄). */
const CARD_ECHO_SKIP_KINDS: ReadonlySet<StreamItemFull['kind']> = new Set(['tool', 'system', 'thinking-live', 'step']);
/** 이 항목 바로 뒤에 붙은 한 줄이라야 발송 보고로 본다. */
const CARD_ECHO_HOST_KINDS: ReadonlySet<StreamItemFull['kind']> = new Set(['report', 'question', 'review', 'list']);

/** `sofar[0..end)` 의 마지막 "말" 이 카드인가(도구·시스템 줄은 건너뛴다). */
function precededByCard(sofar: readonly StreamItemFull[], end: number): boolean {
  for (let k = end - 1; k >= 0; k--) {
    const it = sofar[k]!;
    if (CARD_ECHO_SKIP_KINDS.has(it.kind)) continue;
    // ⑦-6 — 목표 창 블록만 담긴 본문은 화면에 안 그려진다(렌더가 숨긴다) — 카드와 닫는 문장 사이에 끼어도 말이 아니다.
    if (it.kind === 'text' && isInvisibleStreamText(it.content)) continue;
    return CARD_ECHO_HOST_KINDS.has(it.kind);
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

/** §5.5 #17-18 ⑥-1·⑥-5 — 꼬리로 뺄 말풍선인가. `status` 가 아니라 앵커 값으로 본다 — `commandAnchorTs` 와 어긋나지 않게(재개 대기 명령은 제자리). */
export function isPendingCommandItem(item: StreamItemFull): item is StreamCommand {
  return item.kind === 'command' && item.timestamp === PENDING_COMMAND_TS;
}

// ─── §5.5 #17-18 ⑦-7: 카드는 자기를 보낸 도구 줄 아래에 선다 ───

/** 도구 호출로 신고되는 카드 종류. AskUserQuestion 은 CLI 가 띄우는 요청이라 대상이 아니다. */
export type SentCardKind = 'report' | 'question' | 'review' | 'list';

/**
 * 카드 종류 → 그 카드를 신고하는 창구(서버 라우트 `POST /api/agent-*`). 지시문 판본(curl·PowerShell)이
 * 부르는 경로 그대로다. 뒤에 낱말이 더 붙으면(`agent-reviews` 등) 다른 경로라 걸지 않는다.
 */
const CARD_ENDPOINT_RE: Readonly<Record<SentCardKind, RegExp>> = {
  report: /\/api\/agent-report(?![\w-])/,
  question: /\/api\/agent-questions(?![\w-])/,
  review: /\/api\/agent-review(?![\w-])/,
  list: /\/api\/agent-list(?![\w-])/,
};
/** 네 창구의 공통 앞부분 — 도구 입력을 정규식에 넣기 전에 거르는 값싼 첫 관문. */
const CARD_ENDPOINT_PREFIX = '/api/agent-';
/** 파일을 읽고 쓰는 도구 — 본문에 창구 경로가 적혀 있어도(그 경로를 다루는 코드·문서를 고칠 때) 신고한 것이 아니다. */
const NON_SENDER_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob', 'TodoWrite', 'WebFetch', 'WebSearch',
]);

/**
 * 엔진이 도구 시작을 **카드보다 늦게** 알리는 폭의 상한. 코덱스는 명령 시작 줄(`item.started`)을 그 명령이
 * 이미 카드를 보낸 뒤에 내보내는 일이 잦다(실측 2026-10-08: 코덱스 카드 47장 중 32장 · 최대 294ms).
 * 관측 최대의 열 배로 넉넉히 잡되, 다음 도구 호출(모델이 새로 말해야 하므로 초 단위)과는 겹치지 않는 폭.
 */
export const CARD_SENDER_LATE_START_MS = 3_000;

/** 카드 발신 후보 — 창구 경로가 입력에 적힌 도구 호출 하나. 두 탭이 자기 항목에서 이 모양으로 뽑아 넘긴다. */
export interface CardSenderCall {
  /** 엔진이 알린 호출 시작 시각 — 카드 신고 시각과의 거리를 잰다. */
  at: number;
  /** 그 호출이 화면에 서는 자리(정렬 키). 묶음 안이면 묶음의 자리. */
  sortTs: number;
  /** 도구 입력 원문(명령). */
  input: string;
  /** 결과 원문(아직 안 왔으면 ''). 서버가 돌려준 카드 id(`{ ok, id }`)가 찍혀 있으면 그 호출이 곧 발신자다. */
  output: string;
}

/** 이 도구 호출이 카드를 보냈을 **수 있는가**(창구 경로가 적혀 있고, 파일 도구가 아니다). 두 탭이 같은 관문을 쓴다. */
export function isCardSenderCandidate(toolName: string | undefined, input: string): boolean {
  return !NON_SENDER_TOOLS.has(toolName ?? '') && input.includes(CARD_ENDPOINT_PREFIX);
}

/** 신고 시각 앞의 마지막 후보(`prev`)와 뒤 상한 안의 첫 후보(`next`) 중 발신자. */
function pickCardSender(
  card: { id: string; createdAt: number },
  prev: CardSenderCall | undefined,
  next: CardSenderCall | undefined,
): CardSenderCall | undefined {
  if (!next || !prev) return next ?? prev;
  // 결과에 서버가 돌려준 카드 id 가 찍혀 있으면 그 호출이 발신자다 — 가장 확실한 근거.
  if (next.output.includes(card.id)) return next;
  if (prev.output.includes(card.id)) return prev;
  // 결과가 아직 안 왔거나 id 를 찍지 않는 명령 — 신고 시각에 더 가까운 쪽.
  return next.at - card.createdAt < card.createdAt - prev.at ? next : prev;
}

/**
 * §5.5 #17-18 ⑦-7 — 카드 정렬 키. 기본은 신고 시각(⑦-1), **카드를 보낸 도구 줄이 더 뒤일 때만** 그 줄 바로 아래로(코덱스는 시작 줄이 늦게 온다).
 * `calls` 는 카드와 같은 세션 후보만. 옮기는 것은 표시 순서뿐 — `createdAt`·턴 귀속·`작업 중` 배지는 신고 시각 그대로다.
 */
export function cardPlacementTs(
  kind: SentCardKind,
  card: { id: string; createdAt: number },
  calls: readonly CardSenderCall[] | undefined,
): number {
  if (!calls || calls.length === 0) return card.createdAt;
  const endpoint = CARD_ENDPOINT_RE[kind];
  let prev: CardSenderCall | undefined;
  let next: CardSenderCall | undefined;
  for (const call of calls) {
    if (!endpoint.test(call.input)) continue;
    if (call.at <= card.createdAt) {
      if (!prev || call.at >= prev.at) prev = call;
    } else if (call.at - card.createdAt <= CARD_SENDER_LATE_START_MS) {
      if (!next || call.at < next.at) next = call;
    }
  }
  const sender = pickCardSender(card, prev, next);
  // 바로 아래 — 같은 밀리초의 다른 줄보다는 뒤, 다음 밀리초보다는 앞(`turnTailSortTs` 의 -0.5 와 같은 결).
  return sender ? Math.max(card.createdAt, sender.sortTs + 0.5) : card.createdAt;
}

/** Sub 탭 항목에서 카드 발신 후보를 뽑는다(한 세션의 스트림이라 세션은 가를 필요가 없다). */
function cardSenderCallsOf(
  items: readonly StreamItemFull[],
  sortTimestamps: ReadonlyMap<string, number> | undefined,
): CardSenderCall[] {
  const calls: CardSenderCall[] = [];
  for (const it of items) {
    if (it.kind !== 'tool' || !isCardSenderCandidate(it.toolName, it.input)) continue;
    calls.push({ at: it.timestamp, sortTs: sortTimestamps?.get(it.id) ?? it.timestamp, input: it.input, output: it.output });
  }
  return calls;
}

/**
 * base 아이템에 카드(reports/questions/reviews/lists/ask)를 시간순 합류 + 정렬.
 * base.items 배열은 새로 복사(원본 mutate 방지). 항목 객체 참조는 그대로 유지(정렬은 포인터만).
 */
export function mergeCardsIntoItems(
  base: BaseItemsResult,
  commands?: readonly QueuedCommand[],
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
  // §5.5 #17-18 ⑦-1 — 카드 자리는 신고된 시각(`createdAt`)이다. 턴 끝으로 미루면 도는 턴엔 뒤 명령이 없어 MAX_SAFE_INTEGER 가 되어 이후 출력이 카드 위로 간다.
  // ⑦-3 — 턴 식별은 정렬과 분리한다: dispatch 경계를 몇 개 지났는가가 턴 번호다.
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
  // §5.5 #17-18 ⑦-7 — 카드를 보낸 도구 줄이 카드보다 뒤에 정렬되면(코덱스는 명령 시작을 카드 뒤에 알린다)
  //   카드를 그 줄 바로 아래로 옮긴다. 항목 `timestamp` 는 신고 시각 그대로 두고 **정렬 키만** 따로 든다.
  const senderCalls = cardSenderCallsOf(items, base.sortTimestamps);
  const cardSortKeys = new Map<string, number>();
  const placeCard = (itemId: string, kind: SentCardKind, card: { id: string; createdAt: number }): void => {
    const sortTs = cardPlacementTs(kind, card, senderCalls);
    if (sortTs !== card.createdAt) cardSortKeys.set(itemId, sortTs);
  };
  // §5.5 #17-12 — 같은 턴에 작업 신고와 검수 요청이 함께 오면 카드 두 장이 겹쳐 무엇이 중요한지 묻힌다.
  //   검수는 그 턴의 신고 카드 **안쪽 구획**으로 흡수하고, 짝이 없는 검수만 독립 카드로 남긴다.
  const reportIdxByTurn = new Map<number, number>();
  for (const r of reports ?? []) {
    reportIdxByTurn.set(turnIndexOf(r.createdAt), items.length);
    items.push({ kind: 'report', id: `report-${r.id}`, report: r, timestamp: r.createdAt, live: isLive(r.createdAt) });
    placeCard(`report-${r.id}`, 'report', r);
  }
  for (const q of questions ?? []) {
    items.push({ kind: 'question', id: `question-${q.id}`, questions: q, timestamp: q.createdAt, live: isLive(q.createdAt) });
    placeCard(`question-${q.id}`, 'question', q);
  }
  for (const rv of reviews ?? []) {
    const hostIdx = reportIdxByTurn.get(turnIndexOf(rv.createdAt));
    const host = hostIdx === undefined ? undefined : items[hostIdx];
    if (host && host.kind === 'report' && !host.review) {
      items[hostIdx!] = { ...host, review: rv };
      continue;
    }
    items.push({ kind: 'review', id: `review-${rv.id}`, review: rv, timestamp: rv.createdAt, live: isLive(rv.createdAt) });
    placeCard(`review-${rv.id}`, 'review', rv);
  }
  for (const ls of lists ?? []) {
    items.push({ kind: 'list', id: `list-${ls.id}`, list: ls, timestamp: ls.createdAt, live: isLive(ls.createdAt) });
    placeCard(`list-${ls.id}`, 'list', ls);
  }
  for (const req of askRequests ?? []) items.push({ kind: 'ask', id: `ask-${req.requestId}`, request: req, timestamp: pendingAskSortTs(req.createdAt) });

  // 경계로 옮겨 온 출력은 command 뒤·turnstop 앞에 둔다. 같은 구간의 늦은 줄끼리는 실제 시각순이다.
  const boundaryRank = (item: StreamItemFull): number => item.kind === 'command' ? -1 : item.kind === 'turnstop' ? 1 : 0;
  const sortKeyOf = (item: StreamItemFull): number =>
    cardSortKeys.get(item.id) ?? base.sortTimestamps?.get(item.id) ?? item.timestamp;
  items.sort((a, b) =>
    sortKeyOf(a) - sortKeyOf(b)
    || boundaryRank(a) - boundaryRank(b)
    || a.timestamp - b.timestamp);

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

// identity 안정화 비교

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

/**
 * 같은 id 의 두 항목이 렌더 결과에 영향 주는 모든 필드까지 동일한가.
 * timestamp 는 본문·도구만 렌더한다(§5.5 #17-39 ⑫ 오른쪽 끝 시각) — 그 밖의 종류는 렌더 미사용이라 제외.
 */
export function sameStreamItem(a: StreamItemFull, b: StreamItemFull): boolean {
  if (a.kind !== b.kind) return false;
  switch (b.kind) {
    // §5.5 #17-39 — 본문 말풍선은 끝난 시각도 렌더(작성 자국)에 쓰이므로 비교에 넣는다.
    //   ⑫ — 시작 시각도 글 위 오른쪽 끝 시각으로 렌더된다.
    case 'text': {
      const x = a as StreamText;
      return x.content === b.content && x.endedAt === b.endedAt && x.timestamp === b.timestamp;
    }
    case 'system': {
      const x = a as StreamSystem;
      return x.content === b.content && sameTransportRecovery(x.transportRecovery, b.transportRecovery);
    }
    case 'result':
    case 'error':
      return (a as StreamSystem | StreamResult | StreamError).content === b.content;
    // §5.25 (O) — 그림은 봉인된 뒤 바뀌지 않는다(같은 id = 같은 파일). 이름만 대조하면 충분하다.
    case 'image':
      return (a as StreamImage).content === b.content;
    // §5.5 #17-39 — 단계 자국. 봉인된 뒤로는 안 바뀌지만, 앞쪽 절단·재구축으로 같은 id 가 다시 오면 비교된다.
    case 'step': {
      const x = a as StreamStep;
      return x.phase === b.phase && x.endedAt === b.endedAt && x.chars === b.chars;
    }
    // §5.5 #17-39 ⑪ — 결과 시각도 렌더(머리줄의 걸린 시간)에 쓰이므로 비교에 넣는다.
    //   ⑫ — 호출 시각도 머리줄 오른쪽 끝 시각으로 렌더된다.
    case 'tool': {
      const x = a as StreamGroup;
      return x.toolName === b.toolName && x.input === b.input && x.output === b.output && x.isActive === b.isActive
        && x.endedAt === b.endedAt && x.timestamp === b.timestamp;
    }
    case 'command': {
      const x = a as StreamCommand;
      // §5.5 #17-18 ⑤ — dispatchMode 도 렌더(말풍선 색·활성 칩)에 영향 → 비교에 포함.
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
    // §5.5 #17-24 ② — mode 가 바뀌면 다시 그린다. §2.4 — `lastActivityAt`·감춘 턴 표식도 넣는다(빼면 옛 객체 재사용으로 멀쩡한 턴이 "N 전"이 된다).
    // §5.5 #17-10 ⑥-6 — `turnStartedAt` 도(빼면 다음 명령이 나가도 앞 턴부터 센다).
    case 'thinking-live': {
      const x = a as StreamThinkingLive;
      // §5.5 #17-24 ⑥ — 압축 시작 시각도 렌더에 쓰인다(넷째 모드의 경과). 빼면 압축이 두 번째로 시작해도 옛 시각에서 센다.
      return x.mode === b.mode && x.lastActivityAt === b.lastActivityAt
        && x.turnStartedAt === b.turnStartedAt && !!x.hiddenTurn === !!b.hiddenTurn
        && x.compactingSince === b.compactingSince;
    }
    // §5.5 #17-18 ⑦-2 — `live`(작업 중 배지)는 렌더에 영향 → 비교에 포함. 빼면 턴이 끝나도
    //   identity 안정화가 옛 객체를 그대로 재사용해 배지가 영영 안 사라진다.
    case 'report':   return (a as StreamReport).report === b.report && (a as StreamReport).review === b.review && !!(a as StreamReport).live === !!b.live;
    case 'question': return (a as StreamQuestion).questions === b.questions && !!(a as StreamQuestion).live === !!b.live;
    case 'review':   return (a as StreamReview).review === b.review && !!(a as StreamReview).live === !!b.live;
    case 'list':     return (a as StreamList).list === b.list && !!(a as StreamList).live === !!b.live;
    case 'ask':      return (a as StreamAsk).request === b.request;
    // §5.5 #17-12 ③-6 (g) — 낱말이 바뀌면 다시 그린다. 자리는 정렬이 정하므로 timestamp 는 여기 안 넣는다
    //   (재사용된 옛 객체가 자리를 붙잡지 못한다 — 정렬은 매번 새 객체로 다시 계산된 배열에서 일어난다).
    case 'turnstop': return (a as StreamTurnStop).labelKey === b.labelKey;
  }
}

// ─── 증분 파서 ───

/**
 * 증분 유효성을 가르는 commands 파생 키(턴 경계 + agentBusy). 대기 덧말이 dispatch 되면 경계가 늘어 전체 재구축으로 떨어진다(§5.5 #17-18 ⑥).
 * ⚠ `agentBusy` 를 **반드시 넣는다** — 파서는 tool_use 를 만들 때의 `this.agentBusy` 로 `isActive` 를 정해, 빼면 낡은 busy 로 전체 재구축과 갈린다.
 */
function cmdTsKey(commands: readonly QueuedCommand[] | undefined, agentBusy: boolean): string {
  // §5.5 #17-12 ③-3 — 경계 시각뿐 아니라 **명령 id** 까지 키에 넣는다. 턴 커버리지는 id 로 쌓이므로
  //   시각이 같은 채 id 만 바뀌면(명령 교체) 리셋 없이는 옛 id 에 쌓인 판정이 새 명령에 붙는다.
  return `${agentBusy ? '1' : '0'}|${dispatchedTurnAnchorsAsc(commands).map((a) => `${a.ts}:${a.id}`).join(',')}`;
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
  turnId: string | null;
}

/**
 * 온라인 증분 파서. `sync(events, commands)` 매 틱 — 꼬리 확장이면 신규만(O(신규)), 아니면 전체 재구축. command 아이템·카드는 호출측이 합친다.
 * 불변식: 반환은 buildBaseItems(consumedEvents).items 에서 command 를 뺀 것과 **항상 같다**(streamItems.test.ts). 바뀐 항목만 새 객체다.
 */
export class IncrementalStreamParser {
  /** 이벤트 파생 아이템(command 제외). */
  private items: StreamItem[] = [];
  private consumed = 0;
  private lastId: string | null = null;
  private cmdKey = '';
  private agentBusy = false;
  private sortedCmdTs: number[] = [];
  /** §5.5 #17-12 ③-3 — 턴 귀속용 경계(시각·id). `sortedCmdTs` 와 같은 명령에서, 리셋 때만 갱신. */
  private turnAnchors: TurnAnchor[] = [];
  private sortBounds = new Map<string, TurnSortBounds>();
  private sortTimestamps = new Map<string, number>();
  /** §5.5 #17-12 ③-3 — 소비한 이벤트로 쌓인 턴 커버리지(O(신규) 로 자란다). */
  private coverage: TurnCoverage = emptyTurnCoverage();
  private recovery = new TransportRecoveryAccumulator();
  private errors = new StreamErrorAccumulator();

  private openText: OpenBuf | null = null;
  /** §5.5 #17-39 — 열린 사고 런(원문 ❌ 길이만). 봉인될 때 자국 한 줄이 된다. */
  private openThink: TurnThinkRun | null = null;
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
    this.coverage = emptyTurnCoverage();
    this.recovery = new TransportRecoveryAccumulator();
    this.errors = new StreamErrorAccumulator();
    this.sortTimestamps = new Map();
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
    // §5.5 #17-12 ③-3 — 숨김 판정보다 먼저, 모든 줄을 커버리지에 보탠다(전체 재구축 `turnCoverageOf` 와 같은 범위).
    coverTurn(this.coverage, evt, this.turnAnchors);
    recordEventSortTimestamp(this.sortTimestamps, evt, this.sortBounds);
    const turnId = turnOfEvent(evt, this.turnAnchors);

    if (readCodexTransportNotice(evt)) {
      this.sealText();
      this.sealThink();
    }
    if (this.recovery.consume(evt, turnId, this.items)) {
      this.deactivatePending();
      return;
    }
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
      if (thinkOwnerChanged(this.openThink, evt, turnId)) this.sealThink();
      this.openThink = extendThinkRun(this.openThink, evt, turnId);
      return;
    }

    // 사고 런이 끝났다 — 자국은 뒤이어 올 항목보다 **먼저** 선다(전체 재구축과 같은 순서).
    this.sealThink();

    // §5.25 (O) — 전체 재구축과 같은 규약: 그림은 런에 섞지 않고 한 장씩 선다.
    if (type === 'text' && evt.imagePath) {
      this.sealText();
      this.items.push({
        kind: 'image',
        id: evt.id,
        content: evt.content,
        timestamp: evt.timestamp,
        ...(evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {}),
      });
      return;
    }

    if (type === 'text') {
      if (this.openText && this.crossesCommand(this.openText.lastTs, evt.timestamp)) this.sealText();
      if (this.openText && this.openText.turnId !== turnId) this.sealText();
      // §4 (스트림 3종 ①) — 주인이 바뀌면 말풍선을 끊는다(buildBaseItems 와 같은 규약 —
      //   등가성 테스트가 이 대칭을 못박으므로 한쪽만 고치면 즉시 걸린다).
      if (this.openText && this.openText.nested !== evt.nestedUnderToolUseId) this.sealText();
      const nest = evt.nestedUnderToolUseId ? { nestedUnderToolUseId: evt.nestedUnderToolUseId } : {};
      if (!this.openText) {
        const idx = this.items.length;
        this.items.push({ kind: 'text', id: evt.id, content: evt.content, timestamp: evt.timestamp, endedAt: evt.timestamp, ...nest });
        this.openText = { idx, firstId: evt.id, firstTs: evt.timestamp, lastTs: evt.timestamp, chunks: [evt.content], nested: evt.nestedUnderToolUseId, turnId };
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
        // §5.5 #17-39 ⑪ — 결과가 도착한 시각까지 든다(buildBaseItems 와 같은 값 — 등가성 테스트가 못박는다).
        if (pendingItem.kind === 'tool') this.items[j] = { ...pendingItem, output: evt.content, endedAt: evt.timestamp, isActive: false };
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
      const makeError = (event: SubAgentStreamEvent): StreamError => ({ kind: 'error', id: event.id, content: event.content, timestamp: event.timestamp });
      if (!this.errors.consume(evt, turnId, this.items, makeError)) this.items.push(makeError(evt));
      return;
    }

    // system 등 나머지
    this.items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
  }

  /** 매 틱 호출 — 이벤트 파생 base 를 반환(BaseItemsResult 형태). */
  sync(
    events: SubAgentStreamEvent[],
    commands?: readonly QueuedCommand[],
    /** §2.4 — 호출부가 공유 술어로 낸 생존 판정(`buildBaseItems` 와 같은 뜻·같은 자리). */
    agentBusyOverride?: boolean,
    /** §5.5 #17-18 ⑪ — "줄만 서 있는가"(`buildBaseItems` 와 같은 뜻·같은 자리). */
    agentWaitingOverride?: boolean,
    /** §2.4 (무응답) — 라이브 1줄 시계의 바닥(`buildBaseItems` 와 같은 뜻·같은 자리). */
    sessionActivityAt?: number | null,
    /** §5.3 #9-1 (P) — 감춘 턴이 도는 중(`buildBaseItems` 와 같은 뜻·같은 자리). */
    activityHidden?: boolean,
    /** §5.5 #17-10 ⑥-6 — 턴 시계의 시작점(`buildBaseItems` 와 같은 뜻·같은 자리). */
    turnStartedAt?: number | null,
    /** §5.5 #17-24 ⑥ — 접는 중이면 그 시작 시각(`buildBaseItems` 와 같은 뜻·같은 자리). */
    compactingSince?: number | null,
  ): BaseItemsResult {
    const agentBusy = computeAgentBusy(commands, agentBusyOverride);
    const agentWaiting = computeAgentWaiting(commands, agentWaitingOverride);
    const cmdKey = cmdTsKey(commands, agentBusy);

    if (!this.canAppend(events, cmdKey)) {
      // 전체 재구축 — commands 컨텍스트 갱신 후 처음부터.
      this.resetState();
      this.cmdKey = cmdKey;
      this.agentBusy = agentBusy;
      this.sortedCmdTs = dispatchedAnchorsAsc(commands);
      this.turnAnchors = dispatchedTurnAnchorsAsc(commands);
      this.sortBounds = turnSortBounds(this.turnAnchors);
    }
    // (canAppend 이면 cmdKey/agentBusy/sortedCmdTs 는 이미 이전과 동일 — 그대로 둔다)

    for (let k = this.consumed; k < events.length; k++) this.processOne(events[k]!);
    this.consumed = events.length;
    this.lastId = events.length ? events[events.length - 1]!.id : null;

    // §5.5 #17-12 ③-3 — 커버리지는 소비하며 쌓였으므로 여기서 다시 훑지 않는다(O(명령 수)).
    const commandItems = buildCommandItems(commands, this.coverage);
    const eventItems = this.items.slice();
    this.recovery.projectStopped(eventItems, commands, agentBusy && !agentWaiting);
    const items: StreamItemFull[] = commandItems.length > 0 ? [...commandItems, ...eventItems] : eventItems;
    const thinkingLive = computeThinkingLive(events, agentBusy, agentWaiting, sessionActivityAt ?? null, activityHidden ?? false, resolveTurnStartedAt(commands, agentWaiting, turnStartedAt), compactingSince ?? null);
    return { items, agentBusy, thinkingLive, sortTimestamps: this.sortTimestamps };
  }
}
