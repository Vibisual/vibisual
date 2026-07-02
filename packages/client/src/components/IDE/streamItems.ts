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
} from '@vibisual/shared';
import { parseSystemSubtype } from './SystemNode.js';

// ─── system subtype 필터 (펄스/숨김) ───

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
export const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
export function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

/** IDE 에서 아예 숨길 system subtype(노드 점도 라벨도 그리지 않음). 현재 'status' 노드를 가린다. */
export const HIDDEN_SYSTEM_SUBTYPES = new Set(['status']);
export function isHiddenSystem(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && HIDDEN_SYSTEM_SUBTYPES.has(parseSystemSubtype(evt.content) ?? '');
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
}

export interface StreamText {
  kind: 'text';
  id: string;
  content: string;
  timestamp: number;
}

export interface StreamThinking {
  kind: 'thinking';
  id: string;
  content: string;
  timestamp: number;
  /** 아직 생각 중(에이전트 작동 중 + 마지막 항목) → 도트 애니메이션 */
  isActive?: boolean;
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

/** 생각 중 라이브 1줄 — 실제 thinking 중일 때만 본문 하단에 1개 등장 */
export interface StreamThinkingLive {
  kind: 'thinking-live';
  id: string;
  timestamp: number;
}

/** §4 v2.53 — 작업 신고 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamReport {
  kind: 'report';
  id: string;
  report: AgentReport;
  timestamp: number;
}

/** §4 v2.60 — 질문 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamQuestion {
  kind: 'question';
  id: string;
  questions: AgentQuestions;
  timestamp: number;
}

/** §4 v2.70 — 검수 요청 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamReview {
  kind: 'review';
  id: string;
  review: AgentReview;
  timestamp: number;
}

/** §4 v2.84 — 번호 목록 정렬 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
export interface StreamList {
  kind: 'list';
  id: string;
  list: AgentList;
  timestamp: number;
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
  /** v2.61 — 전송한 paste 이미지 첨부의 절대경로(완료 후에도 보존). basename 으로 blob preview 조회. */
  attachments?: string[];
}

export type StreamItem =
  | StreamText | StreamThinking | StreamGroup | StreamSystem | StreamResult
  | StreamThinkingLive | StreamReport | StreamQuestion | StreamReview | StreamList | StreamAsk;

export type StreamItemFull = StreamItem | StreamCommand;

/** 1단계 결과 — events + commands 만으로 만든 base 아이템과, events 로 결정되는 라이브 상태. */
export interface BaseItemsResult {
  items: StreamItemFull[];
  agentBusy: boolean;
  thinkingLive: StreamThinkingLive | null;
}

// ─── 공통 헬퍼(전체·증분이 공유) ───

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
        timestamp: cmd.timestamp,
        attachments: cmd.attachments,
      });
    }
  }
  return items;
}

function computeAgentBusy(commands: QueuedCommand[] | undefined): boolean {
  return !!commands && commands.some((c) => c.status === 'executing' || c.status === 'queued');
}

/** 라이브 "생각 중 …" 1줄 후보 — 마지막 raw 이벤트가 thinking 펄스이고 에이전트 작동 중일 때만. */
function computeThinkingLive(events: SubAgentStreamEvent[], agentBusy: boolean): StreamThinkingLive | null {
  const lastRaw = events[events.length - 1];
  return (agentBusy && lastRaw && isThinkingPulse(lastRaw))
    ? { kind: 'thinking-live', id: 'thinking-live', timestamp: lastRaw.timestamp }
    : null;
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

  const sortedCmdTs = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  function crossesCommand(prevTs: number, nextTs: number): boolean {
    for (const t of sortedCmdTs) {
      if (t > prevTs && t <= nextTs) return true;
      if (t > nextTs) break;
    }
    return false;
  }

  let textBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number } | null = null;
  let thinkBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number } | null = null;

  function flushText(): void {
    if (!textBuf) return;
    items.push({ kind: 'text', id: textBuf.ids[0]!, content: textBuf.chunks.join(''), timestamp: textBuf.ts });
    textBuf = null;
  }
  function flushThink(): void {
    if (!thinkBuf) return;
    items.push({ kind: 'thinking', id: thinkBuf.ids[0]!, content: thinkBuf.chunks.join(''), timestamp: thinkBuf.ts });
    thinkBuf = null;
  }
  function flushAll(): void { flushThink(); flushText(); }

  let i = 0;
  while (i < events.length) {
    const evt = events[i]!;

    if (isThinkingPulse(evt)) { i++; continue; }
    if (isHiddenSystem(evt)) { i++; continue; }

    if (evt.eventType === 'text') {
      flushThink();
      if (textBuf && crossesCommand(textBuf.lastTs, evt.timestamp)) flushText();
      if (!textBuf) textBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp };
      else { textBuf.ids.push(evt.id); textBuf.chunks.push(evt.content); textBuf.lastTs = evt.timestamp; }
      i++;
      continue;
    }

    if (evt.eventType === 'thinking') {
      flushText();
      if (thinkBuf && crossesCommand(thinkBuf.lastTs, evt.timestamp)) flushThink();
      if (!thinkBuf) thinkBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp };
      else { thinkBuf.ids.push(evt.id); thinkBuf.chunks.push(evt.content); thinkBuf.lastTs = evt.timestamp; }
      i++;
      continue;
    }

    flushAll();

    if (evt.eventType === 'tool_use') {
      const resultIdx = resultByToolIdx.get(i);
      if (resultIdx !== undefined) {
        const resultEvt = events[resultIdx]!;
        items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: resultEvt.content, timestamp: evt.timestamp, isActive: false });
      } else {
        items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: '', timestamp: evt.timestamp, isActive: agentBusy && i > lastNonToolIdx });
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

    items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
    i++;
  }

  flushAll();

  const thinkingLive = computeThinkingLive(events, agentBusy);
  return { items, agentBusy, thinkingLive };
}

// ─── 2단계: 카드 합류 + 정렬 (증분과 무관 — base 위에서만 동작) ───

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
  const items: StreamItemFull[] = [...base.items];

  const cmdTsAsc = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  const turnEndSortTs = (createdAt: number): number => {
    for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
    return Number.MAX_SAFE_INTEGER;
  };
  for (const r of reports ?? []) items.push({ kind: 'report', id: `report-${r.id}`, report: r, timestamp: turnEndSortTs(r.createdAt) });
  for (const q of questions ?? []) items.push({ kind: 'question', id: `question-${q.id}`, questions: q, timestamp: turnEndSortTs(q.createdAt) });
  for (const rv of reviews ?? []) items.push({ kind: 'review', id: `review-${rv.id}`, review: rv, timestamp: turnEndSortTs(rv.createdAt) });
  for (const ls of lists ?? []) items.push({ kind: 'list', id: `list-${ls.id}`, list: ls, timestamp: turnEndSortTs(ls.createdAt) });
  for (const req of askRequests ?? []) items.push({ kind: 'ask', id: `ask-${req.requestId}`, request: req, timestamp: turnEndSortTs(req.createdAt) });

  items.sort((a, b) => a.timestamp - b.timestamp);

  // 마지막 항목이 thinking 이고 에이전트 작동 중이면 활성(도트 애니메이션). base.items 객체 mutate 대신 교체.
  let lastIsActiveThinking = false;
  if (base.agentBusy) {
    const lastIdx = items.length - 1;
    const last = items[lastIdx];
    if (last && last.kind === 'thinking') {
      if (!last.isActive) items[lastIdx] = { ...last, isActive: true };
      lastIsActiveThinking = true;
    }
  }

  // 라이브 1줄 — 정렬에 참여시키지 않고 항상 맨 끝. 활성 thinking 블록이 이미 인디케이터를 맡으면 중복 생략.
  if (base.thinkingLive && !lastIsActiveThinking) items.push(base.thinkingLive);

  return items;
}

// ─── identity 안정화 비교(v3.09) ───

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
    case 'text':
    case 'system':
    case 'result':
      return (a as StreamText | StreamSystem | StreamResult).content === b.content;
    case 'thinking': {
      const x = a as StreamThinking;
      return x.content === b.content && !!x.isActive === !!b.isActive;
    }
    case 'tool': {
      const x = a as StreamGroup;
      return x.toolName === b.toolName && x.input === b.input && x.output === b.output && x.isActive === b.isActive;
    }
    case 'command': {
      const x = a as StreamCommand;
      return x.prompt === b.prompt && x.result === b.result && x.status === b.status && sameAttachments(x.attachments, b.attachments);
    }
    case 'thinking-live':
      return true;
    case 'report':   return (a as StreamReport).report === b.report;
    case 'question': return (a as StreamQuestion).questions === b.questions;
    case 'review':   return (a as StreamReview).review === b.review;
    case 'list':     return (a as StreamList).list === b.list;
    case 'ask':      return (a as StreamAsk).request === b.request;
  }
}

// ─── 증분 파서 ───

/** commands 로 파생되는, 증분 유효성에 영향 주는 컨텍스트(정렬된 명령 타임스탬프 + agentBusy). */
function cmdTsKey(commands: QueuedCommand[] | undefined): string {
  const ts = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  return ts.join(',');
}

/** 열린 text/thinking 블록의 증분 상태 — items[idx] 를 제자리 교체하며 자란다. */
interface OpenBuf {
  idx: number;
  firstId: string;
  firstTs: number;
  lastTs: number;
  chunks: string[];
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
  private openThink: OpenBuf | null = null;
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
  private sealThink(): void { this.openThink = null; }

  /** 비-도구 이벤트 도착 → 마지막 비-도구 경계가 갱신되므로 그 앞의 미페어 tool 은 전부 비활성. */
  private deactivatePending(): void {
    for (const p of this.pending) {
      const it = this.items[p] as StreamGroup;
      if (it.isActive) this.items[p] = { ...it, isActive: false };
    }
  }

  private processOne(evt: SubAgentStreamEvent): void {
    if (isThinkingPulse(evt) || isHiddenSystem(evt)) return;

    const type = evt.eventType;
    const isNonTool = type !== 'tool_use' && type !== 'tool_result';
    if (isNonTool) this.deactivatePending();

    if (type === 'text') {
      this.sealThink();
      if (this.openText && this.crossesCommand(this.openText.lastTs, evt.timestamp)) this.sealText();
      if (!this.openText) {
        const idx = this.items.length;
        this.items.push({ kind: 'text', id: evt.id, content: evt.content, timestamp: evt.timestamp });
        this.openText = { idx, firstId: evt.id, firstTs: evt.timestamp, lastTs: evt.timestamp, chunks: [evt.content] };
      } else {
        const b = this.openText;
        b.chunks.push(evt.content);
        b.lastTs = evt.timestamp;
        this.items[b.idx] = { kind: 'text', id: b.firstId, content: b.chunks.join(''), timestamp: b.firstTs };
      }
      return;
    }

    if (type === 'thinking') {
      this.sealText();
      if (this.openThink && this.crossesCommand(this.openThink.lastTs, evt.timestamp)) this.sealThink();
      if (!this.openThink) {
        const idx = this.items.length;
        this.items.push({ kind: 'thinking', id: evt.id, content: evt.content, timestamp: evt.timestamp });
        this.openThink = { idx, firstId: evt.id, firstTs: evt.timestamp, lastTs: evt.timestamp, chunks: [evt.content] };
      } else {
        const b = this.openThink;
        b.chunks.push(evt.content);
        b.lastTs = evt.timestamp;
        this.items[b.idx] = { kind: 'thinking', id: b.firstId, content: b.chunks.join(''), timestamp: b.firstTs };
      }
      return;
    }

    // 이하 tool_use / tool_result / result / system — 두 버퍼 모두 봉인.
    this.sealText();
    this.sealThink();

    if (type === 'tool_use') {
      const idx = this.items.length;
      this.items.push({ kind: 'tool', id: evt.id, toolName: evt.toolName ?? 'Tool', input: evt.content, output: '', timestamp: evt.timestamp, isActive: this.agentBusy });
      this.pending.push(idx);
      return;
    }

    if (type === 'tool_result') {
      const j = this.pending.shift();
      if (j !== undefined) {
        const tool = this.items[j] as StreamGroup;
        this.items[j] = { ...tool, output: evt.content, isActive: false };
      } else {
        this.items.push({ kind: 'system', id: evt.id, content: `${evt.toolName ? `[${evt.toolName}] ` : ''}${evt.content}`, timestamp: evt.timestamp });
      }
      return;
    }

    if (type === 'result') {
      this.items.push({ kind: 'result', id: evt.id, content: evt.content, timestamp: evt.timestamp });
      return;
    }

    // system 등 나머지
    this.items.push({ kind: 'system', id: evt.id, content: evt.content, timestamp: evt.timestamp });
  }

  /** 매 틱 호출 — 이벤트 파생 base 를 반환(BaseItemsResult 형태). */
  sync(events: SubAgentStreamEvent[], commands?: QueuedCommand[]): BaseItemsResult {
    const cmdKey = cmdTsKey(commands);
    const agentBusy = computeAgentBusy(commands);

    if (!this.canAppend(events, cmdKey)) {
      // 전체 재구축 — commands 컨텍스트 갱신 후 처음부터.
      this.resetState();
      this.cmdKey = cmdKey;
      this.agentBusy = agentBusy;
      this.sortedCmdTs = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
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
