/**
 * StreamRenderer — Sub 탭 전용 CLI 스타일 스트림 렌더러.
 *
 * Hook 에이전트의 Agent 탭(기존 TerminalLine)과 분리.
 * assistant text → 마크다운 렌더링, tool_use/tool_result → 접이식 그룹.
 */
import { memo, useState, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement } from './bookmarkScroll.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { SystemNode, parseSystemSubtype } from './SystemNode.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { ThinkingDots, ThinkingLiveLine } from './ThinkingIndicator.js';
import { AgentReportCard } from './AgentReportCard.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { CollapsiblePrompt, AiSpeakerGlyph } from './CollapsiblePrompt.js';

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

// ─── 타입 ───

interface StreamRendererProps {
  events: SubAgentStreamEvent[];
  /** 완료된 명령 (스트림 없을 때 폴백 표시용) */
  commands?: QueuedCommand[];
  /** §4 v2.53 — 이 세션의 작업 신고. createdAt 기준으로 스트림에 인라인 합류(맨 아래 고정 ❌). */
  reports?: AgentReport[];
  /** §4 v2.60 — 이 세션의 질문 카드. reports 와 동일하게 턴 끝에 합류. */
  questions?: AgentQuestions[];
  /** §4 v2.70 — 이 세션의 검수 요청 카드. reports/questions 와 동일하게 턴 끝에 합류. */
  reviews?: AgentReview[];
  /** §4 v2.84 — 이 세션의 번호 목록 정렬 카드. reports/questions/reviews 와 동일하게 턴 끝에 합류. */
  lists?: AgentList[];
  /**
   * §5.3 #12-2 — 이 세션의 pending AskUserQuestion(클로드 네이티브 질문) 카드.
   * 다른 카드와 달리 옛 코드는 가상 리스트 **밖 trailing 형제**로 렌더했는데, customScrollParent 가상화에서
   * 마지막 항목(활성 AskUserQuestion tool 블록)의 높이 측정이 늦으면 예약 높이가 한 항목만큼 모자라
   * 이 카드가 그 위에 겹쳐 그려졌다. 다른 카드들처럼 **가상 리스트 안으로** 합류시켜 정확한 높이를 예약 → 겹침 제거.
   */
  askRequests?: AskUserQuestionRequest[];
  /**
   * v2.99 — Virtuoso 가 자기 내부 스크롤러를 **단독 소유**하고, 그 스크롤러 DOM 을 이 콜백으로 부모에
   * 올린다. 부모(IDEMainArea)는 이걸 받아 StreamStatusBar·북마크 이동·Select All 을 그 컨테이너 한정으로
   * 작동시킨다(옛 외부 customScrollParent 컨테이너 공유를 대체 — 스크롤 소유권을 virtuoso 한 곳으로).
   */
  onScrollerRef?: (el: HTMLElement | null) => void;
  /**
   * v2.99 — 세션 전환 복원 스냅샷. virtuoso `getState` 로 떠날 때 저장한 측정 항목 높이 + 스크롤 위치를
   * 담는다. 마운트 시 `restoreStateFrom` 으로 넘기면 재측정 출렁임 없이 보던 위치로 즉시 복원된다.
   */
  restoreState?: StateSnapshot;
  /**
   * v2.99 — 바닥 추종 여부 변화 통지. virtuoso `atBottomStateChange` 를 그대로 올려, 부모가 세션별
   * 추종 의도 저장·StreamStatusBar 판정에 쓴다(옛 수동 scrollTop 비교·제스처 추적을 대체).
   */
  onAtBottomChange?: (atBottom: boolean) => void;
}

/** §5.5 #17-7 — 북마크 "이동" 시 부모(IDEMainArea)가 호출하는 명령형 핸들. */
export interface StreamRendererHandle {
  /** 출처 항목(anchorId)으로 가상 리스트를 스크롤하고 그 항목/텍스트를 하이라이트. */
  scrollToBookmark: (anchorId: string | undefined, text: string) => void;
  /**
   * 하단 StreamStatusBar 의 "프롬프트로 이동" 점프 — 해당 명령(cmd-${id}) 항목으로 스크롤.
   * 가상 리스트(virtuoso)는 뷰포트 밖 항목을 렌더하지 않으므로, scrollToIndex 로 먼저 그 항목을
   * 렌더시킨 뒤 컨테이너 한정으로 상단 정렬(-16px 여백)한다. DOM querySelector 단독은 미렌더 항목에서
   * 실패(바닥에서 눌러도 안 올라가던 버그)하므로 인덱스 스크롤이 필수.
   */
  scrollToCommand: (cmdId: string) => void;
  /** 마지막 항목으로 즉시 스크롤(사용자가 방금 엔터로 보낸 메시지를 항상 보이게). */
  scrollToBottom: () => void;
  /** v2.99 — 세션 떠날 때 부모가 현재 스크롤/측정 상태 스냅샷을 가져가 저장(다음 복귀 때 restoreState 로 전달). */
  getState: (cb: (snap: StateSnapshot) => void) => void;
}

interface StreamGroup {
  kind: 'tool';
  id: string;
  toolName: string;
  input: string;
  output: string;
  timestamp: number;
  isActive: boolean;
}

interface StreamText {
  kind: 'text';
  id: string;
  content: string;
  timestamp: number;
}

interface StreamThinking {
  kind: 'thinking';
  id: string;
  content: string;
  timestamp: number;
  /** 아직 생각 중(에이전트 작동 중 + 마지막 항목) → 도트 애니메이션 */
  isActive?: boolean;
}

interface StreamSystem {
  kind: 'system';
  id: string;
  content: string;
  timestamp: number;
}

interface StreamResult {
  kind: 'result';
  id: string;
  content: string;
  timestamp: number;
}

/** 생각 중 라이브 1줄 — 실제 thinking 중일 때만 본문 하단에 1개 등장 */
interface StreamThinkingLive {
  kind: 'thinking-live';
  id: string;
  timestamp: number;
}

/** §4 v2.53 — 작업 신고 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamReport {
  kind: 'report';
  id: string;
  report: AgentReport;
  timestamp: number;
}

/** §4 v2.60 — 질문 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamQuestion {
  kind: 'question';
  id: string;
  questions: AgentQuestions;
  timestamp: number;
}

/** §4 v2.70 — 검수 요청 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamReview {
  kind: 'review';
  id: string;
  review: AgentReview;
  timestamp: number;
}

/** §4 v2.84 — 번호 목록 정렬 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamList {
  kind: 'list';
  id: string;
  list: AgentList;
  timestamp: number;
}

/** §5.3 #12-2 — pending AskUserQuestion 카드 (createdAt 을 timestamp 로 삼아 스트림 끝에 합류) */
interface StreamAsk {
  kind: 'ask';
  id: string;
  request: AskUserQuestionRequest;
  timestamp: number;
}

type StreamItem = StreamText | StreamThinking | StreamGroup | StreamSystem | StreamResult | StreamThinkingLive | StreamReport | StreamQuestion | StreamReview | StreamList | StreamAsk;

// ─── 이벤트 → 아이템 변환 ───

/** 명령어 프롬프트 블록 */
interface StreamCommand {
  kind: 'command';
  id: string;
  prompt: string;
  result: string;
  status: string;
  timestamp: number;
  /** v2.61 — 전송한 paste 이미지 첨부의 절대경로(완료 후에도 보존). basename 으로 blob preview 조회. */
  attachments?: string[];
}

type StreamItemFull = StreamItem | StreamCommand;

/** 1단계 결과 — events + commands 만으로 만든 base 아이템과, events 로 결정되는 라이브 상태. */
interface BaseItemsResult {
  items: StreamItemFull[];
  agentBusy: boolean;
  thinkingLive: StreamThinkingLive | null;
}

/**
 * 1단계 — events + commands 만으로 base 아이템을 빌드(카드 제외).
 * 토큰 스트리밍으로 events 가 바뀔 때만 재계산되고, 카드(reports/questions/…)만 바뀌면 재실행되지 않는다.
 */
function buildBaseItems(events: SubAgentStreamEvent[], commands?: QueuedCommand[]): BaseItemsResult {
  const items: StreamItemFull[] = [];

  // 사용자 프롬프트(완료/진행/큐 전부) → 각 명령마다 프롬프트 블록으로 앞부분에 삽입.
  // 결과(result)는 스트림 이벤트로 별도 표시되므로 여기선 prompt만 보여준다.
  // 스트림이 전혀 없는 레거시 세션(서버 restart 전 생성분)은 cmd.result를 폴백으로 보여줌.
  const hasStream = events.length > 0;
  if (commands && commands.length > 0) {
    for (const cmd of commands) {
      items.push({
        kind: 'command',
        id: `cmd-${cmd.id}`,
        prompt: cmd.text,
        result: hasStream ? '' : (cmd.result ?? ''), // 스트림이 있으면 결과는 스트림에서 렌더
        status: cmd.status,
        timestamp: cmd.timestamp,
        attachments: cmd.attachments,
      });
    }
  }

  // 에이전트 작동 중인지 — executing/queued 명령이 하나라도 있으면 "live", 아니면 모든 미페어 tool_use를 비활성으로 표시
  const agentBusy = !!commands && commands.some((c) => c.status === 'executing' || c.status === 'queued');

  // 1차 패스: tool_use ↔ tool_result FIFO 페어링 (서버가 tool_use_id를 노출하지 않으므로 발생 순서 기반)
  const resultByToolIdx = new Map<number, number>(); // tool_use 인덱스 → tool_result 인덱스
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

  // "지금 실행 중" 판정 경계 — Anthropic 턴은 (assistant text/thinking) → tool_use 배치 → tool_result 배치
  // 순으로 흐른다. 따라서 실제로 돌고 있을 수 있는 도구는 **마지막 비-도구 이벤트(text/thinking/result/
  // system) 이후에 나온, 짝 없는 tool_use(= 현재 배치)뿐**이다. 그 경계 앞의 미페어 tool_use 는 (서버가
  // tool_result 에 toolUseId 를 안 실어 FIFO 페어링이 어긋났거나 결과가 유실돼) 남은 잔여물 → 비활성.
  // 이 경계가 없으면 과거에 끝난 도구들까지 agentBusy 동안 전부 스피너가 돌고, 정지→재실행 시 한꺼번에
  // 다시 "동작중"으로 살아난다. 펄스(thinking_tokens)는 투명 처리해 경계로 치지 않는다(스트레이 펄스가
  // 실제로 도는 도구의 스피너를 꺼뜨리지 않도록).
  let lastNonToolIdx = -1;
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (isThinkingPulse(e)) continue;
    if (e.eventType !== 'tool_use' && e.eventType !== 'tool_result') lastNonToolIdx = k;
  }

  let i = 0;
  // 연속 text 이벤트를 하나의 블록으로 합치기 — thinking도 동일. 단 사용자 프롬프트(command)
  // 타임스탬프가 버퍼 사이에 끼어들면 거기서 끊어 별도 블록으로 분리한다(프롬프트별 응답 구분).
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

  while (i < events.length) {
    const evt = events[i]!;

    // 생각 중 펄스(thinking_tokens)는 본문에 쌓지 않는다. text/thinking 버퍼도 끊지 않아
    // 펄스를 사이에 두고도 앞뒤 텍스트가 한 블록으로 유지된다. 라이브 1줄은 아래에서 별도 처리.
    if (isThinkingPulse(evt)) {
      i++;
      continue;
    }

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
        items.push({
          kind: 'tool',
          id: evt.id,
          toolName: evt.toolName ?? 'Tool',
          input: evt.content,
          output: resultEvt.content,
          timestamp: evt.timestamp,
          isActive: false,
        });
      } else {
        // 미페어 tool_use — 에이전트 작동 중이고 **현재 배치(마지막 비-도구 이벤트 이후)** 에 속할 때만
        // 활성. 그 앞쪽 미페어 tool_use 는 이미 끝났는데 결과가 못 짝지어진 잔여물이므로 비활성(orphaned).
        items.push({
          kind: 'tool',
          id: evt.id,
          toolName: evt.toolName ?? 'Tool',
          input: evt.content,
          output: '',
          timestamp: evt.timestamp,
          isActive: agentBusy && i > lastNonToolIdx,
        });
      }
      i++;
      continue;
    }

    if (evt.eventType === 'tool_result') {
      // 1차 패스에서 짝지어진 tool_result는 tool 블록 내부로 흡수됨 → 별도 표시 생략
      if (consumedResultIdxs.has(i)) {
        i++;
        continue;
      }
      // 짝 없는 tool_result (드문 케이스)
      items.push({
        kind: 'system',
        id: evt.id,
        content: `${evt.toolName ? `[${evt.toolName}] ` : ''}${evt.content}`,
        timestamp: evt.timestamp,
      });
      i++;
      continue;
    }

    if (evt.eventType === 'result') {
      items.push({
        kind: 'result',
        id: evt.id,
        content: evt.content,
        timestamp: evt.timestamp,
      });
      i++;
      continue;
    }

    // system 등 나머지
    items.push({
      kind: 'system',
      id: evt.id,
      content: evt.content,
      timestamp: evt.timestamp,
    });
    i++;
  }

  flushAll();

  // 라이브 "생각 중 …" 1줄 후보 — 에이전트 작동 중이고 가장 최근 스트림 이벤트가 thinking 펄스면
  // (= 지금 실제로 생각 중) 본문 하단에 1개만 띄운다. 출력이 시작되면(최근 이벤트가 text 등) 사라진다.
  // 펄스가 아무리 쏟아져도 화면엔 항상 이 1줄만. events 만으로 결정되므로 base 단계에서 계산.
  const lastRaw = events[events.length - 1];
  const thinkingLive: StreamThinkingLive | null = (agentBusy && lastRaw && isThinkingPulse(lastRaw))
    ? { kind: 'thinking-live', id: 'thinking-live', timestamp: lastRaw.timestamp }
    : null;

  return { items, agentBusy, thinkingLive };
}

/**
 * 2단계 — base 아이템에 카드(reports/questions/reviews/lists)를 시간순 합류 + 정렬.
 * 카드만 바뀌면 events 재파싱(buildBaseItems) 없이 이 단계만 재실행된다.
 */
function mergeCardsIntoItems(
  base: BaseItemsResult,
  commands?: QueuedCommand[],
  reports?: AgentReport[],
  questions?: AgentQuestions[],
  reviews?: AgentReview[],
  lists?: AgentList[],
  askRequests?: AskUserQuestionRequest[],
): StreamItemFull[] {
  // base.items 객체는 공유하되 배열은 새로 복사(원본 mutate 방지 — base 재사용 시 오염 차단).
  const items: StreamItemFull[] = [...base.items];

  // §4 v2.53/v2.57 — 작업 신고 카드 배치. createdAt 위치에 그대로 꽂으면 같은 턴의 최종 답변(신고 직후
  //   이어 오는 text/result)보다 카드가 위에 와 "작업 중간에 갑자기 낀" 모양이 된다. 대신 **그 신고가
  //   속한 턴의 끝**(= createdAt 이후 첫 사용자 프롬프트 직전, 없으면 현재 맨 끝)으로 민다. 다음 턴 대화가
  //   오면 그 프롬프트 경계 덕에 카드가 이전 턴 끝에 고정돼 자연스럽게 위로 밀려 올라간다.
  const cmdTsAsc = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  const turnEndSortTs = (createdAt: number): number => {
    for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
    return Number.MAX_SAFE_INTEGER;
  };
  for (const r of reports ?? []) {
    items.push({ kind: 'report', id: `report-${r.id}`, report: r, timestamp: turnEndSortTs(r.createdAt) });
  }
  // §4 v2.60 — 질문 카드도 동일하게 턴 끝 배치.
  for (const q of questions ?? []) {
    items.push({ kind: 'question', id: `question-${q.id}`, questions: q, timestamp: turnEndSortTs(q.createdAt) });
  }
  // §4 v2.70 — 검수 요청 카드도 동일하게 턴 끝 배치.
  for (const rv of reviews ?? []) {
    items.push({ kind: 'review', id: `review-${rv.id}`, review: rv, timestamp: turnEndSortTs(rv.createdAt) });
  }
  // §4 v2.84 — 번호 목록 정렬 카드도 동일하게 턴 끝 배치.
  for (const ls of lists ?? []) {
    items.push({ kind: 'list', id: `list-${ls.id}`, list: ls, timestamp: turnEndSortTs(ls.createdAt) });
  }
  // §5.3 #12-2 — pending AskUserQuestion 카드도 동일하게 턴 끝 배치(가상 리스트 밖 형제 렌더 → 겹침 제거).
  for (const req of askRequests ?? []) {
    items.push({ kind: 'ask', id: `ask-${req.requestId}`, request: req, timestamp: turnEndSortTs(req.createdAt) });
  }

  // 타임스탬프 기준 안정 정렬 — 프롬프트(command)가 항상 최상단에 오도록 유지하되,
  // 스트림 이벤트들끼리는 발생 순서 유지.
  items.sort((a, b) => a.timestamp - b.timestamp);

  // 마지막 항목이 thinking 이고 에이전트가 작동 중이면 = 아직 생각 중 → 활성(도트 애니메이션).
  // 이후 text/tool 이 따라붙으면 생각이 끝난 것이므로 정적 1줄(접힘)로 남는다.
  // (base.items 객체 mutate 대신 교체 — base 재사용 시 isActive 오염 방지.)
  let lastIsActiveThinking = false;
  if (base.agentBusy) {
    const lastIdx = items.length - 1;
    const last = items[lastIdx];
    if (last && last.kind === 'thinking') {
      if (!last.isActive) items[lastIdx] = { ...last, isActive: true };
      lastIsActiveThinking = true;
    }
  }

  // 라이브 1줄은 정렬에 참여시키지 않고 항상 맨 끝에 붙인다.
  // v3.07 — 단, 활성 thinking 블록이 이미 "생각 중 …"(점 애니메이션 + 생각 텍스트 보존)을 안정적으로
  //   보여주는 동안엔 같은 의미의 standalone 1줄을 또 띄우지 않는다. 익스텐디드 띵킹 중에는 실제 thinking
  //   토큰과 thinking_tokens 펄스가 번갈아 와서 lastRaw 가 펄스↔비펄스로 튀는데, 이 1줄은 "lastRaw 가 펄스일
  //   때만" 붙어 매 프레임 붙었다 떨어지며 ① 생각 표시가 깜빡이고 ② 그 1줄 높이만큼 본문이 출렁여(바닥 고정과
  //   맞물려 위아래 흔들림) 보였다. 활성 블록이 단일·안정 인디케이터를 맡으므로 중복 1줄을 끈다.
  if (base.thinkingLive && !lastIsActiveThinking) items.push(base.thinkingLive);

  return items;
}

/** v3.09 — 같은 id 의 두 항목이 렌더 결과에 영향 주는 모든 필드까지 동일한가(= 객체 참조를 재사용해도
 *  화면이 같은가). timestamp 는 렌더에 안 쓰여(정렬은 배열 순서로 이미 반영) 비교에서 제외한다. */
function sameAttachments(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) return false; }
  return true;
}
function sameStreamItem(a: StreamItemFull, b: StreamItemFull): boolean {
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

// ─── 마크다운 커스텀 렌더러 ───

/** 펜스드/인덴트 코드 블록 — 우상단 호버 시 복사 버튼.
 *  react-markdown 의 `pre` 슬롯 교체. 내부 `<code>` 는 그대로 children 으로 받는다.
 *  텍스트 추출은 ref 의 `textContent` 로 — 중첩 syntax 토큰까지 한 번에 잡힌다. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const onCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, []);

  return (
    <div className="group/code relative">
      <pre ref={preRef} {...rest}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        className={`absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-opacity ${
          copied
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 opacity-100'
            : 'border-white/10 bg-gray-900/70 text-gray-300 opacity-0 group-hover/code:opacity-100 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100 focus:opacity-100'
        }`}
      >
        {copied ? (
          // check
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          // copy (overlapping squares)
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </div>
  );
}

/** 본문 링크 — 밑줄 + sky 색으로 "클릭 가능한 주소"임을 표식. 클릭 시 앱 안 iframe(느림) 대신
 *  외부 브라우저로 연다(window.open → Electron main 이 shell.openExternal 로 가로챔).
 *  드래그 선택은 그대로 가능(텍스트 선택을 막지 않음). */
const MarkdownLink = memo(function MarkdownLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
  if (!href) return <span>{children}</span>;
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ } }}
      className="cursor-pointer break-all text-sky-400 underline decoration-sky-400/40 underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-300"
    >
      {children}
    </a>
  );
});

const mdComponents: Components = { pre: CodeBlock, a: MarkdownLink };

/** remark-gfm — `[text](url)` 마크다운 링크뿐 아니라 본문에 그대로 박힌 `http(s)://…` bare URL 도
 *  자동으로 링크(autolink literal)로 만들어 MarkdownLink 가 받아 처리하게 한다. */
const remarkPlugins = [remarkGfm];

// ─── 개별 렌더러 ───

/** assistant 텍스트 → 마크다운. "AI 와 나눈 일상 대화"임을 한눈에 — 박스로 감싸면 도구/생각/결과 박스와
 *  뒤섞여 오히려 지저분해 보이므로, **박스를 걷어내고 평범한 본문 텍스트**로 둔다. 다만 "AI 가 말하는 것"임은
 *  왼쪽의 작은 스파클 글리프로만 표식(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분). */
const TextBlock = memo(function TextBlock({ item }: { item: StreamText }): React.JSX.Element {
  return (
    <div className="px-4 py-1">
      <div className="flex gap-2">
        <AiSpeakerGlyph />
        <div className="ide-md prose prose-invert prose-sm min-w-0 max-w-none flex-1 leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
          <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.content}</Markdown>
        </div>
      </div>
    </div>
  );
});

/** tool_use + tool_result 접이식 그룹 */
const ToolBlock = memo(function ToolBlock({ item }: { item: StreamGroup }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const accentColor = item.isActive ? 'border-blue-500/70' : 'border-amber-500/40';
  const headerBg = item.isActive ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'bg-gray-800/30 hover:bg-gray-800/60';

  // input 미리보기
  const preview = useMemo(() => {
    if (!item.input) return '';
    try {
      const obj = JSON.parse(item.input) as Record<string, unknown>;
      // 주요 필드만 추출
      const file = obj['file_path'] ?? obj['path'] ?? obj['pattern'] ?? obj['command'];
      if (typeof file === 'string') return file.length > 80 ? `${file.slice(0, 80)}...` : file;
    } catch { /* not JSON */ }
    return item.input.length > 80 ? `${item.input.slice(0, 80)}...` : item.input;
  }, [item.input]);

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 ${accentColor} transition-colors`}>
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group/hdr flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${headerBg}`}
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
      >
        {/* 셰브론 */}
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-colors group-hover/hdr:bg-gray-700/50">
          <svg
            className={`h-2.5 w-2.5 text-gray-500 transition-transform group-hover/hdr:text-gray-300 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24" fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {/* 도구 이름 */}
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-400/90">
          {item.toolName}
        </span>

        {/* 미리보기 */}
        {!open && preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400">
            {preview}
          </span>
        )}

        {/* 스피너 or hover 힌트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {item.isActive && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
          )}
          <span className="hidden text-[10px] text-gray-500 group-hover/hdr:inline">
            {open ? t('ide.streamRenderer.collapse') : t('ide.streamRenderer.expand')}
          </span>
        </div>
      </button>

      {/* 펼친 내용 */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/50 px-3 py-2">
          {item.input && (
            <div className="mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.input')}</span>
              <pre className="scrollbar-thin mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-200">
                {item.input}
              </pre>
            </div>
          )}
          {item.output && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.output')}</span>
              <pre className="scrollbar-thin mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-300">
                {item.output}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 활성 프로그레스 바 */}
      {item.isActive && (
        <div className="h-[2px] w-full overflow-hidden bg-gray-800/30">
          <div className="h-full w-1/3 rounded-full bg-blue-500/60" style={{ animation: 'slide 1.5s ease-in-out infinite' }} />
        </div>
      )}
    </div>
  );
});

/** assistant thinking — VS Code 스타일 1줄 "생각 중 …" + 접이식 전체 보기 (연보라·이탤릭) */
const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: StreamThinking }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 성능: thinking 본문이 토큰마다 자라도 미리보기는 content 가 바뀔 때만 재계산.
  const preview = useMemo(() => item.content.replace(/\s+/g, ' ').trim().slice(0, 100), [item.content]);
  return (
    <div className="mx-2 my-1 overflow-hidden rounded-md border-l-2 border-violet-500/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-violet-500/10"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg className={`h-2.5 w-2.5 text-violet-400/70 transition-transform group-hover/hdr:text-violet-300 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {/* "생각 중" 라벨 — 진행 중이면 도트 애니메이션 */}
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[12px] italic text-violet-300/85">
          {t('ide.streamRenderer.thinking')}
          {item.isActive && <ThinkingDots />}
        </span>
        {/* 완료 후 접힘 상태일 때만 첫 문장 미리보기 */}
        {!open && !item.isActive && preview && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-violet-300/50">
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-violet-500/20 bg-gray-950/50 px-4 py-2.5">
          <div className="whitespace-pre-wrap break-words text-[13px] italic leading-relaxed text-violet-200/90">
            {item.content}
          </div>
        </div>
      )}
    </div>
  );
});

/** system 메시지 — SDK subtype([task_started] 등)은 깔끔한 칩, 그 외 임의 본문은 텍스트 폴백 */
function SystemLine({ item }: { item: StreamSystem }): React.JSX.Element {
  const subtype = parseSystemSubtype(item.content);
  if (subtype) return <SystemNode subtype={subtype} />;
  return (
    <div className="px-4 py-1">
      <span className="font-mono text-[12px] text-gray-400">{item.content}</span>
    </div>
  );
}

/** 최종 결과 */
function ResultBlock({ item }: { item: StreamResult }): React.JSX.Element {
  return (
    <div className="mx-2 my-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-strong:text-gray-100">
        <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.content}</Markdown>
      </div>
    </div>
  );
}

/** 명령 폴백 (스트림 없을 때). 실행 중 인디케이터는 하단 StreamStatusBar 가 담당 — 여기선 프롬프트/결과만. */
function CommandBlock({ item }: { item: StreamCommand }): React.JSX.Element {
  const isError = item.status === 'error';
  // v2.61 — 전송한 첨부 이미지를 사용자 프롬프트 아래 썸네일로 표시. 클릭 시 전역 라이트박스로 확대.
  // v2.93 — blob preview(메모리) 우선, 없으면 server 파일 라우트로 폴백(별창/새로고침/재시작에서도 표시).
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const thumbs = useAttachmentThumbs(item.attachments);
  return (
    <div className="px-4 py-2" data-cmd-id={item.id}>
      {/* 프롬프트 — 사용자 입력은 길이와 무관하게 항상 "내 메시지" 말풍선으로. */}
      <CollapsiblePrompt prompt={item.prompt} />
      {/* 전송한 첨부 이미지 썸네일 (클릭 → 라이트박스) */}
      {thumbs.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2 pl-5">
          {thumbs.map((a) => (
            <button
              key={a.basename}
              type="button"
              onClick={() => openImageLightbox(a.url)}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800 transition-opacity hover:opacity-80"
            >
              <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* 결과 */}
      {item.result && (
        <div className={`rounded-md border px-3 py-2 ${
          isError ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed">
            <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 렌더러 ───

/** 단일 스트림 아이템 → 블록 엘리먼트. 북마크 이동 앵커용 `data-stream-item-id` 래퍼로 감싼다.
 *  zoom — IDE 본문 텍스트 줌 배율. **스크롤러(가상 리스트 뷰포트)가 아니라 각 항목 래퍼**에 걸어,
 *  Virtuoso 가 zoom 반영된 실제 항목 높이를 그대로 측정(가상화·스크롤 계산과 일관)하게 한다. */
function renderStreamItem(item: StreamItemFull, thinkingLabel: string, zoom: number): React.JSX.Element {
  let inner: React.JSX.Element;
  switch (item.kind) {
    case 'text':     inner = <TextBlock item={item} />; break;
    case 'thinking': inner = <ThinkingBlock item={item} />; break;
    case 'tool':     inner = <ToolBlock item={item} />; break;
    case 'result':   inner = <ResultBlock item={item} />; break;
    case 'system':   inner = <SystemLine item={item} />; break;
    case 'command':  inner = <CommandBlock item={item} />; break;
    case 'thinking-live': inner = <ThinkingLiveLine label={thinkingLabel} />; break;
    case 'report':   inner = <AgentReportCard report={item.report} />; break;
    case 'question': inner = <AgentQuestionCard questions={item.questions} />; break;
    case 'review':   inner = <AgentReviewCard review={item.review} />; break;
    case 'list':     inner = <AgentListCard list={item.list} />; break;
    case 'ask':      inner = <AskQuestionCard request={item.request} />; break;
  }
  return <div data-stream-item-id={item.id} style={zoom === 1 ? undefined : { zoom }}>{inner}</div>;
}

export const StreamRenderer = memo(forwardRef<StreamRendererHandle, StreamRendererProps>(function StreamRenderer({ events, commands, reports, questions, reviews, lists, askRequests, onScrollerRef, restoreState, onAtBottomChange }, ref): React.JSX.Element {
  const { t } = useTranslation();
  // 성능: 2단 빌드 — 1단계(events 기반 base)는 토큰 스트리밍 때만, 2단계(카드 합류)는 카드 변경 때만 재계산.
  const base = useMemo(() => buildBaseItems(events, commands), [events, commands]);
  const merged = useMemo(
    () => mergeCardsIntoItems(base, commands, reports, questions, reviews, lists, askRequests),
    [base, commands, reports, questions, reviews, lists, askRequests],
  );

  // v3.09 — 항목 identity 안정화(thinking 떨림 차단). buildBaseItems 는 호출마다 **모든 항목을 새 객체**로
  //   만들어, thinking 토큰 하나가 올 때마다 전 항목의 참조가 바뀐다 → memo 자식이 전부 깨져 뷰포트
  //   선렌더 버퍼(increaseViewportBy top:1600/bottom:2000) 전체가 매 토큰 재렌더·재측정되고, 그 재측정이
  //   유발하는 virtuoso scrollTop 보정 + 바닥고정 핀들과 맞물려 화면이 미세 진동(발발 떨림)했다. 특히
  //   thinking 중엔 활성 블록이 접혀 있어 보이는 변화는 없는데 토큰만 초고빈도로 와 떨림만 도드라졌다.
  //   → 직전 렌더에서 같은 id 의 항목과 렌더에 영향 주는 필드가 모두 같으면 **이전 객체 참조를 그대로
  //   재사용**한다. 그러면 실제로 자란 항목(진행 중 thinking/text 한 개)만 참조가 바뀌어 그 한 항목만
  //   재렌더되고, 나머지는 memo 가 유지돼 버퍼 전체 재측정이 사라진다(스크롤 추종 로직은 손대지 않음).
  const prevById = useRef<Map<string, StreamItemFull>>(new Map());
  const items = useMemo(() => {
    const next = new Map<string, StreamItemFull>();
    const reconciled = merged.map((it) => {
      const old = prevById.current.get(it.id);
      const keep = old && sameStreamItem(old, it) ? old : it;
      next.set(it.id, keep);
      return keep;
    });
    prevById.current = next;
    return reconciled;
  }, [merged]);

  const thinkingLabel = t('ide.streamRenderer.thinking');
  // IDE 본문 텍스트 줌 — 각 항목 래퍼에 zoom 적용(아래 renderStreamItem). 변경 시 itemContent 정체성이
  //   바뀌어 Virtuoso 가 전 항목을 재측정 → 새 배율로 정착(줌 조작은 드물어 비용 무관).
  const ideTextZoom = useGraphStore((s) => s.ideTextZoom);
  const itemContent = useCallback(
    (_index: number, item: StreamItemFull) => renderStreamItem(item, thinkingLabel, ideTextZoom),
    [thinkingLabel, ideTextZoom],
  );

  // v2.99 — virtuoso 가 단독 소유한 내부 스크롤러 DOM. 북마크 이동의 "컨테이너 한정 스크롤" 이 이걸 쓴다
  //   (옛 외부 scrollParent 컨테이너 대체). scrollerRef 콜백에서 채워 부모에게도 그대로 올린다.
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const node = el instanceof HTMLElement ? el : null;
    scrollerElRef.current = node;
    onScrollerRef?.(node);
  }, [onScrollerRef]);

  // §5.5 #17-7 — 북마크 이동: anchorId 인덱스로 가상 리스트를 스크롤(렌더 보장)한 뒤, 다음 프레임에
  //   컨테이너 한정 스크롤 + 항목 외곽선 플래시 + 텍스트 선택. anchorId 없거나 못 찾으면 텍스트 검색 폴백.
  const scrollToBookmark = useCallback((anchorId: string | undefined, text: string) => {
    const idx = anchorId ? items.findIndex((it) => it.id === anchorId) : -1;
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' });
    window.setTimeout(() => {
      const cont = scrollerElRef.current;
      if (!cont) return;
      if (anchorId) {
        const el = findItemElement(cont, anchorId);
        if (el) {
          scrollElementIntoCenter(cont, el);
          flashElement(el);
          const range = findTextRangeInContainer(el, text);
          if (range) {
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          }
          return;
        }
      }
      const range = findTextRangeInContainer(cont, text);
      if (range) scrollRangeIntoCenter(cont, range);
    }, idx >= 0 ? 280 : 60);
  }, [items]);
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
  }, []);
  // 하단 상태바 점프: 명령 항목(cmd-${id})을 인덱스로 먼저 렌더(virtuoso)시킨 뒤, 다음 프레임에 컨테이너
  //   한정으로 상단(-16px) 정렬. 인덱스 스크롤을 빼면 미렌더 항목에서 querySelector 가 null → 안 올라간다.
  const scrollToCommand = useCallback((cmdId: string) => {
    const itemId = `cmd-${cmdId}`;
    const idx = items.findIndex((it) => it.id === itemId);
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'start' });
    window.setTimeout(() => {
      const cont = scrollerElRef.current;
      if (!cont) return;
      const el = cont.querySelector<HTMLElement>(`[data-cmd-id="${itemId}"]`);
      if (!el) return;
      const containerRect = cont.getBoundingClientRect();
      const targetRect = el.getBoundingClientRect();
      cont.scrollTo({ top: cont.scrollTop + (targetRect.top - containerRect.top) - 16, behavior: 'smooth' });
    }, idx >= 0 ? 280 : 0);
  }, [items]);
  const getState = useCallback((cb: (snap: StateSnapshot) => void) => {
    virtuosoRef.current?.getState(cb);
  }, []);
  useImperativeHandle(ref, () => ({ scrollToBookmark, scrollToBottom, scrollToCommand, getState }), [scrollToBookmark, scrollToBottom, scrollToCommand, getState]);

  // v2.99 — 바닥 추종을 라이브러리에 위임: 바닥에 있을 때만 새 출력을 따라 내려가고(사용자가 위로 올리면
  //   자동으로 비추종), 옛 수동 scrollTop=scrollHeight / 제스처 추적 / 측정 보정 구분이 전부 불필요해진다.
  const followOutput = useCallback((isAtBottom: boolean): 'auto' | false => (isAtBottom ? 'auto' : false), []);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">{t('ide.streamRenderer.noActivity')}</p>
      </div>
    );
  }

  // v2.99 — Virtuoso 가 height:100% 로 자기 스크롤러를 단독 소유(외부 customScrollParent 공유 폐기).
  //   followOutput 으로 바닥 추종, atBottomStateChange 로 추종 의도 통지, restoreStateFrom 으로 세션 복원.
  return (
    <Virtuoso
      ref={virtuosoRef}
      className="scrollbar-thin"
      style={{ height: '100%' }}
      scrollerRef={handleScrollerRef}
      data={items}
      computeItemKey={(_i, item) => item.id}
      itemContent={itemContent}
      followOutput={followOutput}
      atBottomStateChange={onAtBottomChange}
      atBottomThreshold={40}
      // 복원 스냅샷이 있으면 그 위치/측정값으로, 없으면(첫 진입) 마지막 항목(바닥)에서 시작 — 둘은 배타.
      {...(restoreState
        ? { restoreStateFrom: restoreState }
        : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
      // A: 뷰포트 밖 선렌더 버퍼 확대 — 중간 속도 스크롤에서 본문이 미리 준비돼 pop-in 이 줄어든다.
      increaseViewportBy={{ top: 1600, bottom: 2000 }}
      // B(제거): scrollSeek 자리표시자는 **스트리밍 중 떨림(발발 떨림)의 원인**이었다 — 바닥 자동추종(followOutput)
      //   이 매 토큰 바닥으로 순간 점프하면 그 속도가 enter 임계(800px/s)를 넘겨 자리표시자가 깜빡이고, 게다가
      //   마지막 항목이 **자라는 중**이라 추정 높이 ≠ 실제 높이 → 교체할 때마다 화면이 위아래로 튀었다. 빠른 휠
      //   스크롤에서도 같은 높이 불일치로 떨렸다. 자리표시자를 빼고 항상 실제 본문을 그려 떨림을 없앤다(빠른 드래그
      //   시 약간 무겁지만 안정성 우선).
    />
  );
}));
