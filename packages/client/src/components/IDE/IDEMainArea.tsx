import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, CommandError, SubAgent, SubAgentStreamEvent, AgentEvent, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { STREAM_DENSITIES, STREAM_COMPACT_TEXT_CLAMP_LINES, STREAM_COMPACT_TEXT_CLAMP_CHARS, slashCommandNeedsTerminal, SESSION_MEMO, VOICE_INPUT, isVoiceToggleKey, mergeVoiceText, type StreamDensity } from '@vibisual/shared';
import { useSessionRunning } from '../../hooks/useSessionRunning.js';
import { clampStreamText } from './streamDensity.js';
import type { TodoItem } from '@vibisual/shared';
import { latestPlanProgress, parsePlanTodos, isSystemSubtypeChip, isHiddenSystemSubtype, PLAN_TOOL_NAME, commandAnchorTs, hasDispatched, PENDING_COMMAND_TS, isCardEchoText } from './streamItems.js';
import { foldTaskChips } from './taskChips.js';
import { describeCommandError, parseStreamErrorContent, joinCommandErrorLine } from './commandError.js';
import { PlanBlock } from './PlanBlock.js';
import { toolPreview } from './toolPreview.js';
import { useGraphStore, agentSessionInputKey, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
// §5.5 #17-34 — 창 안 분할. 칸 컨텍스트가 있으면 이 본문은 그 칸의 세션을 그리고, 창 단위 단축키는
//   초점 칸만 받는다(컨텍스트 밖 = 분할 없음 = 종전 동작 그대로).
import { useSplitCellFocused, useSplitCellSession } from './splitCellContext.js';
import type { AgentSessionInputAttachment, EditorFollowMark } from '../../stores/graphStore.js';
import { useAvailableSkills, type SkillInfo, type BuiltinCommandInfo } from '../../hooks/useAvailableSkills.js';
import { useSessionStop } from '../../hooks/useSessionStop.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { openWebSearch } from './webSearchUrl.js';
import { StreamRenderer, StreamEndGap, type StreamRendererHandle } from './StreamRenderer.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { ImageLightboxView } from './ImageAnnotator.js';
import { decideFollow } from './followDecision.js';
import { FOLLOW_SKIP_SHORT_KEYS, followSessionKey } from './editorFollow.js';
import { useVirtuosoFrontShift } from './frontShift.js';
import { readingItemAttrsNoProse } from './reading/readingModel.js';
import { useStreamToggle, streamToggleProps, STREAM_TOGGLE_ATTR } from './streamToggle.js';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement, resolveAnchorIdFromSelection, markRange, clearFindHighlight } from './bookmarkScroll.js';
import { isFindableTextKind, findTextMatches } from './streamSearch.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { UnseenCardPills, type UnseenCardMeta } from './UnseenCardPills.js';
import { IDETerminalPanes } from './IDETerminalPanes.js';
import { SessionMemoLayer } from './SessionMemoLayer.js';
import { canAddMemoCount, hasHiddenMemoHeaders } from './sessionMemo.js';
import { SystemNode, parseSystemSubtype, parseSystemTaskInfo } from './SystemNode.js';
import { ThinkingLiveLine, StepTraceLine, WriteTraceLine } from './ThinkingIndicator.js';
import { collectThinkRuns, shouldTraceWriting, toolGroupElapsedMs } from './turnSteps.js';
import { thinkTraceText, writeTraceText, toolElapsedText } from './stepTraceText.js';
// §5.5 #17-18 ⑤ v4.77 — 대기 중 덧말의 상태·컨트롤은 이 말풍선이 갖는다(옛 대기 줄 대체).
import { CollapsiblePrompt, AiSpeakerGlyph, type PromptCommandState } from './CollapsiblePrompt.js';
import { INPUT_FIELD_SIZING, INPUT_MAX_HEIGHT, autosizeInput } from './inputAutosize.js';
import { decideArrowKey, getCommandHistory, hasCommandHistory, seedCommandHistory, type HistoryNavState } from './commandHistory.js';
// §5.5 #17-38 — 음성 받아쓰기. 마이크 수명은 훅이, 키·글 끼우기 판정은 shared 가, "듣는 중" 표시는 오버레이가 맡는다.
import { useVoiceDictation } from '../../hooks/useVoiceDictation.js';
import { resolveVoicePort, type VoicePortResult } from '../../hooks/voiceOpenGate.js';
import { useVoiceAsr } from '../../hooks/useVoiceAsr.js';
import { VoiceInputOverlay } from './VoiceInputOverlay.js';
import { VoiceInstallDialog } from './VoiceInstallDialog.js';
import { shortcutLabel } from '../../utils/platform.js';

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

/** §5.5 #17-15 — "지금 생각하고 있다"를 뜻하는 이벤트(SDK 펄스 + 실제 thinking 델타).
 *  사고 원문은 본문에 쌓지 않고, 진행 중 라이브 1줄만이 유일한 표면이다(Sub 탭 streamItems 와 같은 규칙). */
function isThinkingActivity(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'thinking' || isThinkingPulse(evt);
}

/** §5.5 #17-13 ⑤-4 — 어느 밀도에서도 안 그리는 칩(`status`·살림성 `*_changed`)은 항목 자체를 만들지 않는다.
 *  Sub 탭(streamItems)이 항목 조립 단계에서 이미 거르는 것과 **같은 판정**이다(두 탭이 갈라지지 않게). */
function isHiddenSystemEvent(evt: { eventType: string; content: string }): boolean {
  if (evt.eventType !== 'system') return false;
  const subtype = parseSystemSubtype(evt.content);
  return subtype !== null && isHiddenSystemSubtype(subtype);
}

/** §5.5 #17-2 v3.19 — 슬래시 드롭다운 항목: 디스크 스킬/커맨드 또는 CLI 내장(built-in) 명령. */
type SlashItem =
  | { kind: 'skill'; name: string; skill: SkillInfo }
  | { kind: 'builtin'; name: string; builtin: BuiltinCommandInfo };

const EMPTY_COMMANDS: QueuedCommand[] = [];
const EMPTY_SUBS: SubAgent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];
const EMPTY_STREAM_EVENTS: SubAgentStreamEvent[] = [];
const EMPTY_REPORTS: import('@vibisual/shared').AgentReport[] = [];
const EMPTY_QUESTIONS: import('@vibisual/shared').AgentQuestions[] = [];
const EMPTY_REVIEWS: import('@vibisual/shared').AgentReview[] = [];
const EMPTY_LISTS: import('@vibisual/shared').AgentList[] = [];

// v3.05 — 바닥 추종 의도 판정 임계(px). 스크롤 후 바닥과의 거리가 이보다 가까우면 "추종 중"으로 본다.
//   콘텐츠 성장은 scroll 이벤트를 안 내므로 이 값은 사용자 스크롤-업/다운 제스처에만 반응한다.
const FOLLOW_BOTTOM_THRESHOLD = 80;

interface IDEMainAreaProps {
  agentId: string;
  isCustom: boolean;
}

/**
 * OS 드래그앤드롭으로 들어온 File 의 절대경로 해석. 통합 앱(Electron)에서는 preload 가 노출한
 * `window.api.getPathForFile`(webUtils) 로, 그 외(브라우저 dev)는 비표준 `File.path` 폴백.
 * 둘 다 없으면 빈 문자열(브라우저 dev 에선 OS 경로가 없어 첨부 불가).
 */
function resolveDroppedFilePath(file: File): string {
  const bridge = (window as unknown as { api?: { getPathForFile?: (f: File) => string } }).api;
  try {
    const p = bridge?.getPathForFile?.(file);
    if (p) return p;
  } catch { /* fall through to legacy */ }
  return (file as unknown as { path?: string }).path ?? '';
}

/** dataTransfer 가 OS 파일을 담고 있는지(텍스트 셀렉션 드래그 등과 구분). */
function dragHasFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * 북마크 "이동" 의 실제 스크롤 — anchorId(출처 항목)가 있으면 그 엘리먼트로 컨테이너 중앙 스크롤 +
 * 외곽선 플래시, 없거나 못 찾으면 보관 텍스트를 컨테이너에서 검색(공백/노드 경계 관용)해 선택+스크롤.
 * 가상 리스트는 호출 전에 scrollToIndex 로 그 항목을 렌더시켜 둔다.
 * `preserveFocus` 는 인-페이지 검색용 — 찾은 텍스트를 selection 대신 CSS 하이라이트로 칠해 검색
 * 입력창의 포커스/caret 을 건드리지 않는다(`markRange` 주석 참고).
 */
function performBookmarkScroll(container: HTMLElement, anchorId: string | undefined, text: string, preserveFocus = false): boolean {
  if (anchorId) {
    const el = findItemElement(container, anchorId);
    if (el) {
      scrollElementIntoCenter(container, el);
      flashElement(el);
      // 항목 안에서 정확한 텍스트도 표시해 주면 더 좋다(있으면).
      const range = findTextRangeInContainer(el, text);
      if (range) markRange(range, preserveFocus);
      return true;
    }
  }
  const range = findTextRangeInContainer(container, text);
  if (range) {
    scrollRangeIntoCenter(container, range, preserveFocus);
    return true;
  }
  return false;
}

// ─── 통합 터미널 항목 ───

interface TerminalEntry {
  id: string;
  type: 'command' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system' | 'step';
  text: string;
  timestamp: number;
  sessionLabel?: string;
  toolName?: string;
  /**
   * §5.5 #17-39 — **마지막 조각이 도착한 시각**. `timestamp`(첫 조각) 와의 차이가 곧 걸린 시간이다.
   * 사고 자국(`type==='step'`)과 합쳐진 본문(`type==='text'`) 둘 다 이 필드를 쓴다(Sub 탭 `endedAt` 과 대칭).
   */
  endedAt?: number;
  /** §5.5 #17-39 — 사고 자국의 분량(글자). `text` 는 비어 있다 — 사고 **원문은 담지 않는다**. */
  stepChars?: number;
  /**
   * `type==='command'` 일 때 **내가 보낸 시각**. 위 `timestamp` 는 §5.5 #17-18 ⑥ 대로 말풍선이 설
   * 자리(= 나간 시각 · 대기 중이면 `PENDING_COMMAND_TS` 꼬리 표식)라 시각 표기에 쓸 수 없다.
   */
  submittedAt?: number;
  /**
   * §5.5 #17-18 ⑤ v4.77 — `type==='command'` 일 때 그 명령의 큐 상태. 말풍선이 이 값으로 색을 정하고,
   * 대기 중이면 [대기|합치기|즉시]·삭제 컨트롤을 스스로 띄운다(옛 입력창 위 대기 줄 대체).
   */
  command?: PromptCommandState;
}

/** 접을 수 있는 그룹 (tool_use+tool_result 쌍, 연속 text 블록) */
interface TerminalGroup {
  kind: 'group';
  id: string;
  groupType: 'tool' | 'text';
  header: string;
  toolName?: string;
  timestamp: number;
  sessionLabel?: string;
  entries: TerminalEntry[];
  /** tool이 아직 실행 중 (result 없음) */
  isActive: boolean;
  /** §5.5 #17-12 — 연속 도구를 합친 묶음이면 합쳐진 호출 수(2 이상). 없으면 단일 호출. */
  runCount?: number;
  /** §5.5 #17-13 — 묶음에 등장한 도구 이름(중복 제거, 등장 순서). 헤더 칩 표시용. */
  toolNames?: string[];
}

/** 라이브 1줄 — 에이전트가 작동하는 내내 본문 하단에 1개 떠 있다(§5.5 #17-24 ②, Sub 탭과 동형). */
interface TerminalThinkingLive {
  kind: 'thinking-live';
  id: string;
  /** `thinking` = 사고 중, `working` = 그 외 작업 중. 라벨·색만 가른다(항목은 그대로). */
  mode: 'thinking' | 'working';
  timestamp: number;
}

/** §5.5 #17-12 — 메인 탭에서도 TodoWrite 는 계획 블록으로(Sub 탭 StreamPlan 과 같은 모양 → PlanBlock 재사용). */
interface TerminalPlan {
  kind: 'plan';
  id: string;
  todos: TodoItem[];
  timestamp: number;
  superseded?: boolean;
}

type TerminalItem = (TerminalEntry & { kind?: undefined }) | TerminalGroup | TerminalThinkingLive | TerminalPlan;

/** 메인 탭 타임라인 노드 — 터미널 항목 + 카드류(작업 신고/질문/검수/목록/AskUserQuestion)의 합집합. */
type MainTimelineNode =
  | { t: 'item'; item: TerminalItem }
  // §5.5 #17-12 — 같은 턴의 검수 요청은 별도 노드가 아니라 이 신고 카드 안쪽 구획으로 흡수된다.
  // §5.5 #17-18 ⑦-2 — `live` = 이 카드가 속한 턴이 아직 도는 중(헤더에 `작업 중` 배지).
  | { t: 'report'; report: AgentReport; review?: AgentReview; live?: boolean }
  | { t: 'question'; questions: AgentQuestions; live?: boolean }
  | { t: 'review'; review: AgentReview; live?: boolean }
  | { t: 'list'; list: AgentList; live?: boolean }
  | { t: 'ask'; request: AskUserQuestionRequest };

/** 타임라인 노드의 안정 id — Virtuoso key·앞쪽 절단 shift 카운트가 공용(중복 분기 제거). */
function mainTimelineNodeId(n: MainTimelineNode): string {
  switch (n.t) {
    case 'report': return n.report.id;
    case 'review': return n.review.id;
    case 'list': return n.list.id;
    case 'question': return n.questions.id;
    case 'ask': return n.request.requestId;
    case 'item': return n.item.id;
  }
}

// ─── §5.5 #17-18 ⑦-5: 카드 발송 보고 한 줄 걷어내기(메인 탭 판본) ───
//   Sub 탭은 `dropCardEchoTexts`(streamItems.ts)가 같은 일을 한다. 문구 판정은 **같은 함수**
//   (`isCardEchoText`)를 쓴다 — 두 렌더 경로가 갈리면 같은 줄이 탭에 따라 보이고 안 보인다(⑦-3 과 같은 이유).

/** 이 노드 바로 뒤에 붙은 한 줄이라야 발송 보고로 본다. */
const MAIN_ECHO_CARD_TYPES: ReadonlySet<MainTimelineNode['t']> = new Set(['report', 'question', 'review', 'list']);

/** 뒤로 훑을 때 건너뛰는 노드 — 그 자체로는 에이전트가 "한 말"이 아니다(도구 묶음·회색 잡음·라이브 1줄·자국). */
function isMainEchoSkip(n: MainTimelineNode): boolean {
  if (n.t !== 'item') return false;
  const it = n.item;
  if (it.kind === 'group') return it.groupType === 'tool';
  if (it.kind === 'thinking-live') return true;
  // §5.5 #17-39 — 단계 자국(`step`)도 말이 아니다(Sub 탭 CARD_ECHO_SKIP_KINDS 와 같은 목록).
  if (it.kind === undefined) return it.type === 'system' || it.type === 'tool_use' || it.type === 'tool_result' || it.type === 'step';
  return false;
}

/** 이 노드가 단독 본문 한 줄이면 그 내용, 아니면 null(묶인 본문은 이미 접혀 있어 대상이 아니다). */
function mainEchoTextOf(n: MainTimelineNode): string | null {
  if (n.t !== 'item') return null;
  const it = n.item;
  return it.kind === undefined && it.type === 'text' ? it.text : null;
}

/** `sofar[0..end)` 의 마지막 "말" 이 카드인가(도구·시스템 노드는 건너뛴다). */
function precededByCardNode(sofar: readonly MainTimelineNode[], end: number): boolean {
  for (let k = end - 1; k >= 0; k--) {
    const n = sofar[k]!;
    if (isMainEchoSkip(n)) continue;
    return MAIN_ECHO_CARD_TYPES.has(n.t);
  }
  return false;
}

/** 뺄 것이 하나도 없으면 입력 배열을 그대로 돌려준다(노드 참조 안정 = 재측정 없음). */
function dropCardEchoNodes(nodes: MainTimelineNode[]): MainTimelineNode[] {
  let out: MainTimelineNode[] | null = null;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const content = mainEchoTextOf(n);
    if (content !== null && isCardEchoText(content) && precededByCardNode(out ?? nodes, out ? out.length : i)) {
      if (!out) out = nodes.slice(0, i);
      continue;
    }
    if (out) out.push(n);
  }
  return out ?? nodes;
}

/**
 * §5.5 읽기 설정 — 메인 탭 노드의 폭 취급.
 * 메인 탭은 Sub 탭과 달리 마크다운 컨테이너(`.ide-md`)를 쓰지 않으므로 안쪽에 폭을 넘길 그리드가 없다.
 * 그래서 **도구 줄·도구 묶음만** 칼럼 밖으로 내보내고 나머지는 전부 칼럼 안에 남긴다.
 */
function mainTimelineReadingKind(n: MainTimelineNode): string {
  if (n.t !== 'item') return n.t;
  if (n.item.kind === 'group') return n.item.groupType === 'tool' ? 'toolgroup' : n.item.groupType;
  if (n.item.kind === 'plan' || n.item.kind === 'thinking-live') return n.item.kind;
  return n.item.type === 'tool_use' || n.item.type === 'tool_result' ? 'tool' : n.item.type;
}

/** 스트림 이벤트 + 명령 대기열 + agentEvents를 통합하여 터미널 항목 생성 */
function buildEntries(
  commands: QueuedCommand[],
  subAgents: SubAgent[],
  streams: Record<string, SubAgentStreamEvent[]>,
  activeSessionId: string | null,
  agentEvents: AgentEvent[],
  // §5.5 #17-12 ③ — 실패 사유를 사람 문장으로 바꾸는 로케일 주입(이 함수는 순수하게 유지한다).
  formatError: (error: CommandError) => string,
): TerminalEntry[] {
  const entries: TerminalEntry[] = [];
  const subLabelMap = new Map(subAgents.map((s) => [s.id, s.label]));

  /**
   * §5.5 #17-39 — 사고 런 → 단계 자국 항목. 런 판정은 Sub 탭 파서와 **같은 규칙**을 담은
   * `collectThinkRuns` 한 곳에서 하므로, 같은 대화가 탭에 따라 자국 개수가 달라지지 않는다.
   * 건너뛸 이벤트도 파서와 같은 둘(펄스·숨김 system)을 넘긴다.
   */
  const pushThinkTraces = (events: SubAgentStreamEvent[], label?: string): void => {
    for (const run of collectThinkRuns(events, (e) => isThinkingPulse(e) || isHiddenSystemEvent(e))) {
      entries.push({
        id: `step-${run.firstId}`,
        type: 'step',
        text: '',
        timestamp: run.startedAt,
        endedAt: run.endedAt,
        stepChars: run.chars,
        ...(label ? { sessionLabel: label } : {}),
      });
    }
  };

  // 메인 뷰: Hook 에이전트의 기존 프롬프트+결과 표시
  if (activeSessionId === null && agentEvents.length > 0) {
    for (const evt of agentEvents) {
      entries.push({
        id: `evt-${evt.id}`,
        type: 'command',
        text: evt.message,
        timestamp: evt.timestamp,
        // 훅 이벤트는 큐를 거치지 않는다 — 잡힌 그 시각이 곧 사용자가 보낸 시각이다.
        submittedAt: evt.timestamp,
      });
      if (evt.response) {
        entries.push({
          id: `res-${evt.id}`,
          type: 'result',
          text: evt.response,
          timestamp: evt.timestamp + 1,
        });
      }
    }
  }

  // 명령 대기열 프롬프트 — 상태 무관하게 항상 "내 메시지" 말풍선으로 표시한다.
  //   §5.5 #17-18 ⑤ v4.77 — 대기 중(queued)도 종전 system 잔줄이 아니라 같은 말풍선이다.
  //   상태는 `command` 로 실어 보내 말풍선이 **색**으로 구분하고(대기/합치기/즉시/실행 중),
  //   대기 중이면 방식 칩·삭제까지 그 말풍선 안에서 조작한다.
  const targetCmds = activeSessionId === null
    ? commands
    : commands.filter((c) => c.subAgentId === activeSessionId);

  for (const cmd of targetCmds) {
    const sessionLabel = activeSessionId === null && cmd.subAgentId
      ? subLabelMap.get(cmd.subAgentId)
      : undefined;

    entries.push({
      id: `cmd-${cmd.id}`,
      type: 'command',
      text: cmd.text,
      // §5.5 #17-18 ⑥ — 큐에 넣은 시각이 아니라 **나간 시각**에 선다. 대기 중이면 꼬리로 밀려
      //   화면 맨 아래에 남고(=다음에 나갈 것), dispatch 되는 순간 그 자리에 고정돼 턴 경계선이 된다.
      timestamp: commandAnchorTs(cmd),
      // 말풍선이 "언제 보낸 글인가"를 말할 때 쓰는 값은 그 꼬리 표식이 아니라 실제 투입 시각이다.
      submittedAt: cmd.timestamp,
      sessionLabel,
      command: {
        status: cmd.status,
        ...(cmd.dispatchMode ? { dispatchMode: cmd.dispatchMode } : {}),
        commandId: cmd.id,
      },
    });
  }

  // 스트림 이벤트에서 실시간 출력
  if (activeSessionId === null) {
    // 전체 보기 — 모든 서브에이전트의 스트림
    for (const [subId, events] of Object.entries(streams)) {
      // 현재 에이전트의 서브에이전트만
      if (!subLabelMap.has(subId) && subAgents.length > 0) continue;
      const label = subLabelMap.get(subId);
      for (const evt of events) {
        if (isThinkingActivity(evt)) continue; // §5.5 #17-15 — 사고(펄스·델타)는 본문에 쌓지 않음 (라이브 1줄로 대체)
        if (isHiddenSystemEvent(evt)) continue; // §5.5 #17-13 ⑤-4 — 살림성 칩(`*_changed`)·`status` 는 원문 밀도에서도 안 그린다
        entries.push({
          id: evt.id,
          type: evt.eventType,
          // §5.5 #17-12 ③ — 오류 줄만 서버 원문(`[code:exit] …`)이라 여기서 문장으로 편다.
          text: evt.eventType === 'error' ? formatError(parseStreamErrorContent(evt.content)) : evt.content,
          timestamp: evt.timestamp,
          sessionLabel: label,
          toolName: evt.toolName,
        });
      }
      // §5.5 #17-39 — 사고는 위에서 본문으로 안 쌓았지만, **얼마나 걸렸는지는 남긴다**.
      pushThinkTraces(events, label);
    }
  } else {
    // 특정 세션만
    const events = streams[activeSessionId];
    if (events) {
      for (const evt of events) {
        if (isThinkingActivity(evt)) continue; // §5.5 #17-15 — 사고(펄스·델타)는 본문에 쌓지 않음 (라이브 1줄로 대체)
        if (isHiddenSystemEvent(evt)) continue; // §5.5 #17-13 ⑤-4 — 살림성 칩(`*_changed`)·`status` 는 원문 밀도에서도 안 그린다
        entries.push({
          id: evt.id,
          type: evt.eventType,
          text: evt.eventType === 'error' ? formatError(parseStreamErrorContent(evt.content)) : evt.content,
          timestamp: evt.timestamp,
          toolName: evt.toolName,
        });
      }
      // §5.5 #17-39 — 사고 자국(세션 하나만 볼 때도 전체 보기와 같은 규칙).
      pushThinkTraces(events);
    }
  }

  // completed/error 명령의 결과 — 스트림 result 이벤트가 없을 때만 cmd.result 폴백 (프롬프트는 위에서 이미 push)
  for (const cmd of targetCmds) {
    if (cmd.status !== 'completed' && cmd.status !== 'error') continue;
    const sessionLabel = activeSessionId === null && cmd.subAgentId
      ? subLabelMap.get(cmd.subAgentId)
      : undefined;

    const subStreams = cmd.subAgentId ? (streams[cmd.subAgentId] ?? []) : [];
    // §5.5 #17-12 ③ — 실패 사유. 스트림에 오류 줄이 이미 있으면 그 자리가 진짜 시점이므로 겹쳐 쓰지 않는다.
    if (cmd.status === 'error' && cmd.error && !subStreams.some((e) => e.eventType === 'error')) {
      entries.push({
        id: `cmderr-${cmd.id}`,
        type: 'error',
        // §5.5 #17-18 ⑥ — 결과 줄은 그 명령의 말풍선 **바로 아래**에 붙는다(같은 기준 + 1).
        text: formatError(cmd.error),
        timestamp: commandAnchorTs(cmd) + 1,
        sessionLabel,
      });
    }
    if (!cmd.result) continue;
    const hasResultStream = subStreams.some((e) => e.eventType === 'result');
    if (hasResultStream) continue;

    entries.push({
      id: `cmdres-${cmd.id}`,
      type: cmd.status === 'error' ? 'error' : 'result',
      text: cmd.result,
      timestamp: commandAnchorTs(cmd) + 1,
      sessionLabel,
    });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);

  // AI 설명(text)은 같은 세션에서 연달아 오면 **한 말풍선으로 합친다**. 스트림이 한 응답을 여러 text
  // 이벤트(델타)로 쪼개 보내도 박스 말풍선이 조각조각 나뉘지 않게 한다(StreamRenderer 의 textBuf 합치기와
  // 동일 동작). 세션(sessionLabel)이 다르거나 사이에 비-text 항목(도구·프롬프트 등)이 끼면 거기서 끊긴다
  // → 도구가 설명 사이에 있으면 의미상 별개 말풍선으로 자연스럽게 분리.
  const coalesced: TerminalEntry[] = [];
  for (const e of entries) {
    const prev = coalesced[coalesced.length - 1];
    if (e.type === 'text' && prev && prev.type === 'text' && prev.sessionLabel === e.sessionLabel) {
      prev.text += e.text;
      // §5.5 #17-39 — 합쳐진 말풍선의 끝 시각(작성 자국의 "걸린 시간"). Sub 탭 textBuf.lastTs 와 같은 값.
      prev.endedAt = e.timestamp;
    } else {
      coalesced.push(e.type === 'text' ? { ...e, endedAt: e.timestamp } : e); // text 는 합치기 대상이라 사본(원본 불변)
    }
  }
  return coalesced;
}

// ─── flat 항목 → 그룹화 ───

/** tool_use+tool_result 쌍을 접을 수 있는 그룹으로, 연속 text를 하나로 묶기.
 *  §5.5 #17-15 — 사고는 buildEntries 단계에서 이미 빠졌다(묶을 대상이 없다). */
/**
 * §5.5 #17-26 ① — 간결에서 **턴마다 AI 본문의 처음 것과 마지막 것만** 남긴다
 * (Sub 탭 `streamDensity.keepFirstAndLastText` 와 같은 규칙, 자료형만 다르다).
 *
 * 턴 경계는 사용자 명령(`command`) 항목. 첫 본문 = 의도 선언, 마지막 본문 = 결론·질문이고 사이의 본문은
 * 도구를 감싼 진행 나레이션이라 도구를 숨긴 화면에서 맥락 없는 토막이 된다. 빈 본문은 후보로 세지 않는다.
 */
function keepFirstAndLastMainText(items: TerminalItem[]): TerminalItem[] {
  const keep = new Set<string>();
  let firstOfTurn: string | null = null;
  let lastOfTurn: string | null = null;
  const closeTurn = (): void => {
    if (firstOfTurn) keep.add(firstOfTurn);
    if (lastOfTurn) keep.add(lastOfTurn);
    firstOfTurn = null;
    lastOfTurn = null;
  };
  for (const it of items) {
    if (it.kind !== undefined) continue;
    if (it.type === 'command') { closeTurn(); continue; }
    if (it.type !== 'text' || it.text.trim() === '') continue;
    if (!firstOfTurn) firstOfTurn = it.id;
    else lastOfTurn = it.id;
  }
  closeTurn();
  return items.filter((it) => it.kind !== undefined || it.type !== 'text' || keep.has(it.id));
}

/**
 * §5.5 #17-12 — 메인 탭 밀도 적용(Sub 탭 streamDensity 와 같은 규칙, 자료형만 다르다).
 *  - 연속 동종 도구 묶음(진행 중 제외)을 `도구 ×N` 한 줄로 합친다.
 *  - 같은 턴(명령 경계)의 옛 계획은 접는다.
 * `raw` 밀도에서는 아무것도 하지 않는다.
 */
function applyMainDensity(items: TerminalItem[], density: StreamDensity): TerminalItem[] {
  // §5.5 #17-13 ⑤-3 — 작업 칩(시작·끝)을 한 줄로 접는다. Sub 탭(`applyStreamDensity`)과 **같은 함수**라
  //   두 탭이 같은 스트림을 같은 모양으로 접는다.
  const folded = foldTaskChips(
    items,
    (it) => (it.kind === undefined && it.type === 'system' ? it.text : null),
    (it, text) => (it.kind === undefined && it.type === 'system' ? { ...it, text } : it),
  );
  if (density === 'raw') return folded;

  // §5.5 #17-13 ⑤ — SDK 상태 칩(`[task_started]` 레일 점)은 간결/표준에서 그리지 않는다(내용 없는 한 줄).
  //   내용이 있는 system 본문(권한 결정 등)은 subtype 단독 패턴이 아니므로 그대로 남는다.
  // §5.5 #17-15 — 사고는 밀도 축에서 빠졌다(항목 조립 시점에 이미 없다 — 여기서 거를 것이 없다).
  const shown = folded.filter((it) => (
    !(it.kind === undefined && it.type === 'system' && isSystemSubtypeChip(it.text))
  ));

  // (1) 옛 계획 접기 — 뒤에서부터 훑으며 같은 턴에서 더 새로운 계획을 본 적 있으면 superseded.
  const marked = shown.slice();
  let seenNewerPlan = false;
  for (let k = shown.length - 1; k >= 0; k--) {
    const it = shown[k]!;
    if (it.kind === undefined && it.type === 'command') { seenNewerPlan = false; continue; }
    if (it.kind !== 'plan') continue;
    if (seenNewerPlan) { if (!it.superseded) marked[k] = { ...it, superseded: true }; }
    else { seenNewerPlan = true; if (it.superseded) marked[k] = { ...it, superseded: false }; }
  }

  // (2) 도구 실행 묶기 — §5.5 #17-13: 도구 이름을 가리지 않고, 사이에 낀 잡음(빈 줄·system)도 넘어간다.
  //   §5.5 #17-16: **진행 중 도구도 묶고**(밖에 두면 끝나는 순간 흡수되며 화면이 출렁인다), 문턱 없이
  //   1개짜리 런부터 감싼다. 지금 하는 일은 접힌 묶음이 그리는 "최근 도구 한 줄"이 계속 보여준다.
  const groupableTool = (it: TerminalItem): it is TerminalGroup =>
    it.kind === 'group' && it.groupType === 'tool';
  const filler = (it: TerminalItem): boolean => {
    if (it.kind !== undefined) return false;
    if (it.type === 'system') return true;
    return it.type === 'text' && it.text.trim() === '';
  };
  const out: TerminalItem[] = [];
  let i = 0;
  while (i < marked.length) {
    const cur = marked[i]!;
    if (groupableTool(cur)) {
      let j = i + 1;
      let lastToolEnd = i + 1; // 꼬리 잡음은 묶지 않는다(다음 대화의 머리).
      let runCount = 1;
      while (j < marked.length) {
        const next = marked[j]!;
        if (groupableTool(next)) { runCount++; j++; lastToolEnd = j; continue; }
        if (filler(next)) { j++; continue; }
        break;
      }
      const entries: TerminalEntry[] = [];
      const toolNames: string[] = [];
      let runActive = false;
      for (let k = i; k < lastToolEnd; k++) {
        const it = marked[k]!;
        if (it.kind === 'group') {
          entries.push(...it.entries);
          const name = it.toolName ?? it.header;
          if (name && !toolNames.includes(name)) toolNames.push(name);
          runActive = it.isActive; // 활성은 런의 마지막 도구에만 — 뒤 도구가 오면 자동으로 덮인다.
        } else if (it.kind === undefined) {
          entries.push(it);
        }
      }
      // id 는 첫 묶음 id 고정 — 묶음이 자라도 펼침 상태가 유지된다(Sub 탭 toolgroup 과 동일 규칙).
      out.push({ ...cur, entries, runCount, toolNames, isActive: runActive });
      i = lastToolEnd;
      continue;
    }
    out.push(cur);
    i++;
  }

  // §5.5 #17-21 ① / #17-24 ① — 간결은 **도구 묶음을 진행 중이든 완료든 화면에서 뺀다**(Sub 탭
  //   applyStreamDensity 와 같은 규칙). 진행 중 한 줄을 남겨 두면 도구가 시작·완료할 때마다 그 줄이
  //   생겼다 사라지며 화면이 깜빡인다 — 지금 작동 중이라는 사실은 상시 라이브 1줄이 알린다.
  //   런에 흡수됐던 **내용 있는 system 본문**(오류·권한 결정)은 묶음 밖으로 꺼내 남긴다 — 사용자가 읽어야
  //   하는 내용이라 묶음과 함께 사라지면 안 된다(Sub 탭과 동일).
  if (density === 'compact') {
    const compacted: TerminalItem[] = [];
    for (const it of out) {
      if (!(it.kind === 'group' && it.groupType === 'tool')) { compacted.push(it); continue; }
      for (const e of it.entries) {
        if (e.type === 'system' && !isSystemSubtypeChip(e.text)) compacted.push(e);
      }
    }
    return keepFirstAndLastMainText(compacted);
  }
  return out;
}

function groupEntries(flat: TerminalEntry[]): TerminalItem[] {
  const items: TerminalItem[] = [];
  let i = 0;

  while (i < flat.length) {
    const cur = flat[i]!;

    // §5.5 #17-15 — 사고는 buildEntries 에서 이미 걸러졌다(그룹으로 묶을 대상 자체가 없다).

    // §5.5 #17-12 — TodoWrite 는 계획 블록으로 승격(짝 tool_result 는 계획에 흡수돼 별도 줄이 되지 않는다).
    if (cur.type === 'tool_use' && cur.toolName === PLAN_TOOL_NAME) {
      const todos = parsePlanTodos(cur.text);
      if (todos) {
        let j = i + 1;
        while (j < flat.length && flat[j]!.type === 'tool_result') j++;
        items.push({ kind: 'plan', id: `plan-${cur.id}`, todos, timestamp: cur.timestamp });
        i = j;
        continue;
      }
    }

    // tool_use → 뒤따르는 tool_result(들)까지 그룹 (단독 tool_use도 감쌈 → 활성 표시)
    if (cur.type === 'tool_use') {
      const children: TerminalEntry[] = [cur];
      let j = i + 1;
      while (j < flat.length && flat[j]!.type === 'tool_result') {
        children.push(flat[j]!);
        j++;
      }
      const hasResult = children.length > 1;
      items.push({
        kind: 'group',
        id: `grp-${cur.id}`,
        groupType: 'tool',
        header: cur.toolName ?? 'Tool',
        toolName: cur.toolName,
        timestamp: cur.timestamp,
        sessionLabel: cur.sessionLabel,
        entries: children,
        isActive: !hasResult,
      });
      i = j;
      continue;
    }

    // AI 설명(text)은 접어서 숨기지 않는다 — buildEntries 에서 같은 세션 연속 text 는 이미 한 말풍선으로
    // 합쳐졌으므로, 여기선 그대로 인라인 말풍선으로 펼쳐 보인다(전체 탭에서 설명이 "…(+N lines)" 뒤로
    // 숨던 문제 제거). 도구/생각 묶음만 접을 수 있는 그룹으로 유지.

    items.push(cur);
    i++;
  }

  return items;
}

// ─── 터미널 출력 라인 ───

const TYPE_STYLES: Record<string, { color: string; prefix: string }> = {
  command:     { color: 'text-blue-300',       prefix: '>' },
  text:        { color: 'text-gray-200',       prefix: ' ' },
  tool_use:    { color: 'text-amber-300/90',   prefix: '\u2192' },
  tool_result: { color: 'text-gray-400',       prefix: '\u2190' },
  result:      { color: 'text-emerald-300/90', prefix: '\u2713' },
  error:       { color: 'text-red-300/90',     prefix: '!' },
  system:      { color: 'text-gray-500',       prefix: '*' },
};

/**
 * §5.5 #17-21 ② — 메인 탭 AI 본문. 간결에서는 앞 N줄(또는 N자)만 남기고 [더 보기]로 접는다.
 * `exempt`(화면의 마지막 본문)는 지금 하는 말이자 결론이라 자르지 않는다. 훅을 쓰므로 별도 컴포넌트
 * (TerminalLine 은 분기마다 early return 이라 그 안에서 훅을 부를 수 없다).
 */
/**
 * §5.5 #17-39 — 메인 탭 단계 자국. 훅(`useTranslation`)을 쓰므로 `TerminalLine` 안이 아니라 별도 조각
 * (그쪽은 분기마다 early return 이라 훅을 부를 수 없다 — `TerminalTextLine` 과 같은 이유).
 */
function TerminalStepLine({ entry }: { entry: TerminalEntry }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const ms = (entry.endedAt ?? entry.timestamp) - entry.timestamp;
  return <StepTraceLine text={thinkTraceText(t, i18n.language, ms, entry.stepChars ?? 0)} />;
}

function TerminalTextLine({ entry, density, exempt }: { entry: TerminalEntry; density: StreamDensity; exempt: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const clamped = useMemo(
    () => (density === 'compact' && !exempt
      ? clampStreamText(entry.text, STREAM_COMPACT_TEXT_CLAMP_LINES, STREAM_COMPACT_TEXT_CLAMP_CHARS)
      : null),
    [density, exempt, entry.text],
  );
  const [open, toggleOpen] = useStreamToggle(`text-more-${entry.id}`, false);
  const body = clamped && !open ? clamped.text : entry.text;
  // §5.5 #17-39 — 작성 자국(Sub 탭 TextBlock 과 같은 문턱·같은 문구 함수). 메인 탭의 본문 항목은
  //   buildEntries 가 연속 델타를 합쳐 만든 것이라 끝 시각이 따로 없다 — 분량만 적는다(시간은 0).
  const writeTrace = density !== 'compact' && shouldTraceWriting(entry.text.length)
    ? writeTraceText(t, i18n.language, (entry.endedAt ?? entry.timestamp) - entry.timestamp, entry.text.length)
    : null;
  return (
    <div className="px-3 py-1 max-md:px-1.5">
      <div className="flex gap-2">
        <AiSpeakerGlyph />
        <div className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-200">
            {entry.sessionLabel && (
              <span className="mr-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[12px] font-semibold text-cyan-400/80">
                {entry.sessionLabel}
              </span>
            )}
            {body}
          </span>
          {clamped && (
            <button
              type="button"
              onClick={toggleOpen}
              className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500 transition-colors hover:text-gray-300"
            >
              <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {open ? t('ide.streamRenderer.showLess') : t('ide.streamRenderer.showMoreLines', { count: clamped.hiddenLines })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TerminalLine({ entry, density, exempt, agentId }: { entry: TerminalEntry; density?: StreamDensity; exempt?: boolean; agentId?: string }): React.JSX.Element {
  // §5.5 #17-39 — 단계 자국(끝난 사고 런). Sub 탭과 **같은 조각·같은 문구 함수**를 쓴다.
  if (entry.type === 'step') return <TerminalStepLine entry={entry} />;
  // SDK system 메시지 subtype([task_started] 등)은 날 텍스트 대신 깔끔한 칩으로.
  if (entry.type === 'system') {
    const subtype = parseSystemSubtype(entry.text);
    // §5.5 #17-13 ⑤-3 — 작업 칩이면 payload(이름·결과·소요 시간)를 함께 넘긴다(없으면 종전 모양).
    if (subtype) return <SystemNode subtype={subtype} task={parseSystemTaskInfo(entry.text)} />;
  }
  // 사용자 입력(command)은 길이와 무관하게 StreamRenderer(Sub 탭)와 동일한 "내 메시지" 말풍선으로.
  // (탭에 따라 옛 평문으로 뜨던 불일치 제거 — 두 경로가 같은 CollapsiblePrompt 사용.)
  if (entry.type === 'command') {
    // 대기 중 명령의 컨트롤은 큐 좌표(agentId + commandId)를 알아야 동작한다 — 여기서 합쳐 넘긴다.
    const command = entry.command
      ? (agentId ? { ...entry.command, agentId } : entry.command)
      : undefined;
    return (
      // §4 v3.24 — 폰(max-md)에선 좌우 여백 압축(Sub 탭 블록들과 동일 방침).
      <div className="px-3 py-1 max-md:px-1.5">
        <CollapsiblePrompt prompt={entry.text} command={command} submittedAt={entry.submittedAt} />
      </div>
    );
  }
  // AI 일상 대화(assistant text)는 Sub 탭 TextBlock 과 동일하게 박스 없이 평범한 본문 + 왼쪽 스파클
  // 글리프로만 표식한다(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분).
  if (entry.type === 'text') {
    return <TerminalTextLine entry={entry} density={density ?? 'standard'} exempt={exempt ?? false} />;
  }
  const style = TYPE_STYLES[entry.type] ?? TYPE_STYLES['text']!;

  return (
    <div className="group flex gap-2 px-3 py-1 max-md:px-1.5 hover:bg-gray-800/40">
      <span className="flex-shrink-0 select-none pt-px text-[12px] text-gray-500">{formatTime(entry.timestamp)}</span>
      <span className={`w-3 flex-shrink-0 select-none text-center font-mono text-[13px] ${style.color}`}>{style.prefix}</span>
      <div className="min-w-0 flex-1">
        {entry.sessionLabel && (
          <span className="mr-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[12px] font-semibold text-cyan-400/80">
            {entry.sessionLabel}
          </span>
        )}
        {entry.toolName && (
          <span className="mr-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[12px] font-semibold text-amber-400/80">
            {entry.toolName}
          </span>
        )}
        {/* §5.5 #17-21 ⑤ — 간결에서는 내용 있는 system·도구 잔줄만 한 줄로 자른다(내용을 지우진 않는다).
            결론(result)과 오류(error)는 어느 밀도에서도 온전히 보여준다 — 그게 핵심이다. */}
        <span className={`break-words text-[13px] leading-relaxed ${style.color} ${
          density === 'compact' && entry.type !== 'result' && entry.type !== 'error' ? 'block truncate' : 'whitespace-pre-wrap'
        }`}>
          {entry.text}
        </span>
      </div>
    </div>
  );
}

// ─── 접을 수 있는 그룹 (VS Code 스타일) ───

/** 활성 상태 스피너 */
function Spinner(): React.JSX.Element {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
  );
}

/** tool_use 입력의 한 줄 요약 — §5.5 #17-13 로 Sub 탭과 **같은 순수 함수**를 쓴다(원본 JSON 노출 제거). */
function toolInputPreview(entry: TerminalEntry): string {
  return toolPreview(entry.text);
}

/** §5.5 #17-13 — 묶음 헤더에 보여줄 도구 이름 칩 개수(초과분은 `+N`). */
const TOOL_GROUP_NAME_CHIPS = 3;

/** §5.5 #17-16 — 접힌 묶음이 그리는 최근 도구 한 줄(Sub 탭 ToolGroupLatestLine 과 같은 규칙·같은 높이). */
function TerminalRunLatestLine({ entry, active }: { entry: TerminalEntry; active: boolean }): React.JSX.Element {
  return (
    // 이 줄은 항상 헤더 아래에 붙는다(§5.5 #17-24 ① 로 헤더 없는 `bare` 자리는 사라졌다).
    <div className="flex items-center gap-2 border-t border-gray-800/40 px-2.5 py-1">
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        {active ? <Spinner /> : (
          <svg className="h-3 w-3 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className={`flex-shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold ${active ? 'bg-blue-500/15 text-blue-300' : 'bg-amber-500/10 text-amber-400/70'}`}>
        {entry.toolName ?? 'Tool'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-500">{toolInputPreview(entry)}</span>
    </div>
  );
}

function TerminalGroupLine({ group, density }: { group: TerminalGroup; density?: StreamDensity }): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-16 ④ — 펼침은 모듈 저장소에 보관(가상 리스트 언마운트에도 유지).
  const [open, toggleOpen] = useStreamToggle(group.id, false);
  const isTool = group.groupType === 'tool';
  // §5.5 #17-16 ① — 도구 묶음은 1개짜리부터 존재하므로 개수와 무관하게 "명령 실행됨 ×N" 머리를 쓴다.
  const isRun = group.runCount !== undefined;
  // 접혀 있을 때 보여줄 가장 최근 도구 호출(진행 중이면 그게 지금 하는 일).
  const latestUse = isRun ? [...group.entries].reverse().find((e) => e.type === 'tool_use') : undefined;
  // §5.5 #17-39 — 이 묶음이 걸린 시간(Sub 탭 ToolGroupBlock 과 같은 함수·같은 규칙).
  //   **진행 중에는 재지 않는다** — 끝을 모르는 채로 적으면 매 틱 숫자가 바뀌며 헤더가 깜빡인다.
  const elapsed = group.isActive ? '' : toolElapsedText(t, toolGroupElapsedMs(group.entries.map((e) => e.timestamp)));

  // §5.5 #17-24 ① — 간결에는 도구 묶음이 **아예 도달하지 않는다**(진행 중이든 완료든 applyMainDensity 가
  //   배열에서 뺐다). 종전의 "진행 중 한 줄" 분기는 그 줄이 생겼다 사라지며 화면을 깜빡이게 해 없앴다.

  // 활성 상태 색상
  const accentColor = group.isActive
    ? 'border-blue-500/70'
    : isTool
      ? 'border-amber-500/40'
      : 'border-gray-600/40';

  const headerBg = group.isActive
    ? 'bg-blue-500/5 hover:bg-blue-500/10'
    : 'bg-gray-800/30 hover:bg-gray-800/60';

  // tool_use의 입력 미리보기
  const preview = isTool ? toolInputPreview(group.entries[0]!) : '';

  return (
    <div className={`mx-1.5 my-0.5 overflow-hidden rounded border-l-2 ${accentColor} transition-colors`}>
      {/* 헤더 — 클릭으로 토글 */}
      <button
        type="button"
        onClick={toggleOpen}
        {...streamToggleProps(open)}
        className={`group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors ${headerBg}`}
        title={open ? 'Click to collapse' : 'Click to expand'}
      >
        {/* 시간 */}
        <span className="flex-shrink-0 select-none text-[12px] text-gray-500">
          {formatTime(group.timestamp)}
        </span>

        {/* 셰브론 — hover 시 강조 */}
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-colors group-hover/hdr:bg-gray-700/50">
          <svg
            className={`h-2.5 w-2.5 text-gray-500 transition-transform group-hover/hdr:text-gray-300 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {/* 라벨 영역 */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {group.sessionLabel && (
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-[12px] font-semibold text-cyan-400/80">
              {group.sessionLabel}
            </span>
          )}
          {/* §5.5 #17-13 — 묶음이면 도구 이름 대신 "명령 실행됨 ×N" + 이름 칩 몇 개. 단일 호출이면 종전대로. */}
          {isRun ? (
            <>
              <span className="flex-shrink-0 text-[12px] text-gray-400">{t('ide.streamRenderer.activity')}</span>
              <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-500">
                {t('ide.streamRenderer.toolRun', { count: group.runCount })}
              </span>
              {/* §5.5 #17-39 — 이 묶음이 걸린 시간. 잴 수 없으면(호출 하나) 아무것도 붙이지 않는다. */}
              {elapsed && <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-600">{elapsed}</span>}
              {(group.toolNames ?? []).slice(0, TOOL_GROUP_NAME_CHIPS).map((name) => (
                <span key={name} className="flex-shrink-0 rounded bg-gray-700/40 px-1 py-0.5 text-[12px] font-medium text-gray-500">
                  {name}
                </span>
              ))}
              {(group.toolNames?.length ?? 0) > TOOL_GROUP_NAME_CHIPS && (
                <span className="flex-shrink-0 text-[12px] text-gray-600">+{(group.toolNames?.length ?? 0) - TOOL_GROUP_NAME_CHIPS}</span>
              )}
            </>
          ) : (
            <>
              {isTool && group.toolName && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-bold text-amber-400/90">
                  {group.toolName}
                </span>
              )}
              {/* 미리보기 텍스트 (접힌 상태) */}
              {!open && preview && (
                <span className="truncate font-mono text-[12px] text-gray-400">
                  {preview}
                </span>
              )}
            </>
          )}
          {!isTool && (
            <span className="truncate text-[12px] text-gray-300">
              {group.header}
            </span>
          )}
        </div>

        {/* 오른쪽: 스피너 or 아이템 카운트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {group.isActive && !isRun && <Spinner />}
          {!group.isActive && isTool && !isRun && group.entries.length > 1 && (
            <span className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[12px] text-gray-400">
              {group.entries.length - 1} result{group.entries.length > 2 ? 's' : ''}
            </span>
          )}
          {/* hover 힌트 */}
          <span className="hidden text-[12px] text-gray-500 group-hover/hdr:inline">
            {open ? 'collapse' : 'expand'}
          </span>
        </div>
      </button>

      {/* 접혀 있어도 최근 도구 한 줄은 항상(활성/완료 같은 높이 → 스트리밍 중 리스트가 안 움직인다). */}
      {!open && latestUse && <TerminalRunLatestLine entry={latestUse} active={group.isActive} />}

      {/* 펼친 내용 */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/50">
          {group.entries.map((e) => (
            <TerminalLine key={e.id} entry={e} />
          ))}
        </div>
      )}

      {/* 활성 상태 하단 프로그레스 바 — 묶음은 최근 도구 줄의 스피너가 대신한다(2px 출렁임 방지). */}
      {group.isActive && !isRun && (
        <div className="h-[2px] w-full overflow-hidden bg-gray-800/30">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/60"
            style={{ animation: 'slide 1.5s ease-in-out infinite' }}
          />
        </div>
      )}
    </div>
  );
}

// ─── 명령 입력 영역 ───

// 입력 textarea 자동 높이 — inputAutosize.ts 로 추출 (IDESidebar.insertSkill 과 공유).
//   field-sizing: content 위임 + 인라인 height 자가 치유. 상세 주석은 그 파일 참조.

interface TerminalInputProps {
  agentId: string;
  activeSessionId: string | null;
}

/**
 * §5.5 #17-38 — **이미 누가 먹은 키인가.**
 *
 * 한 문서에 IDE 판이 둘 이상 떠 있으면(분할·중첩) window 리스너도 그 수만큼 서고, 같은
 * 키 하나에 받아쓰기가 켜졌다 곧바로 꺼진다. 먼저 잡은 쪽이 그 이벤트에 표시를 남기면
 * 뒤엣것은 비켜선다. 창이 여럿인 경우는 여기 걸리지 않는다 — 초점 없는 창은 애초에
 * 키 이벤트를 받지 않는다.
 */
const handledVoiceKeys = new WeakSet<KeyboardEvent>();

const API_BASE = '';

/**
 * v1.35 — paste 된 이미지 1장의 업로드/미리보기 상태.
 * CommandInputPopup 과 동일 계약. 서버 endpoints: POST /api/agent-attachments/:sid/upload, DELETE /api/agent-attachments/:sid.
 * v1.38 — 제출 시 blob URL 은 graphStore.attachmentPreviews 로 이관, 입력창 상태는 즉시 비움.
 *         실행중 상태바(StreamStatusBar)가 스토어에서 basename 으로 조회해 썸네일 표시.
 * v1.48 — 타입을 graphStore.AgentSessionInputAttachment 와 동치 alias 로 통합 (세션별 store 보관).
 */
type PastedAttachment = AgentSessionInputAttachment;

function TerminalInput({ agentId, activeSessionId }: TerminalInputProps): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-12 ③ v4.64 — 중지 동작은 공용 훅(useSessionStop)이 단일 창구이자, 이제 화면에서도 유일한 [중지].
  const { stopping, stop: handleStop } = useSessionStop(agentId, activeSessionId);
  const addCommand = useGraphStore((s) => s.addCommand);
  const agents = useGraphStore((s) => s.agents);
  const registerAttachmentPreview = useGraphStore((s) => s.registerAttachmentPreview);
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const markSubAcknowledged = useGraphStore((s) => s.markSubAcknowledged);
  // §5.3 #28 v1.48 — 세션 스코프 draft (text + attachments) store 구독.
  // 세션 탭 전환 시 입력 내용이 해당 세션에 매여 유지된다. key = agentSessionInputKey(agentId, activeSessionId).
  const draftKey = agentSessionInputKey(agentId, activeSessionId);
  const sessionDraft = useGraphStore((s) => s.agentSessionInputs[draftKey]);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  const updateAgentSessionInputAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);
  const clearAgentSessionInput = useGraphStore((s) => s.clearAgentSessionInput);
  const takeAgentSessionInputs = useGraphStore((s) => s.takeAgentSessionInputs);
  const text = sessionDraft?.text ?? '';
  const attachments = useMemo<PastedAttachment[]>(() => sessionDraft?.attachments ?? [], [sessionDraft]);
  const setText = useCallback(
    (next: string) => setAgentSessionInputText(agentId, activeSessionId, next),
    [agentId, activeSessionId, setAgentSessionInputText],
  );
  const setAttachments = useCallback(
    (updater: (prev: PastedAttachment[]) => PastedAttachment[]) =>
      updateAgentSessionInputAttachments(agentId, activeSessionId, updater),
    [agentId, activeSessionId, updateAgentSessionInputAttachments],
  );
  // §5.3 #28 v1.47 — 외부 트리거(예: ContiHistoryDetail "새 콘티 생성")가 setAgentInputDraft 로
  // 시드 프롬프트를 넣었으면 마운트/agent 변경 시 textarea 에 hydrate 후 consume.
  // 자동 send ❌ — 사용자가 직접 Send 눌러야 dispatch (사용자 작성 흐름 보존).
  const draftForAgent = useGraphStore((s) => s.agentInputDrafts[agentId]);
  const consumeAgentInputDraft = useGraphStore((s) => s.consumeAgentInputDraft);
  // 이 탭(activeSessionId) 이 **지금 돌고 있는가** — Run/Stop 토글 판정.
  // 메인 탭(activeSessionId===null) 은 여러 서브가 병렬 실행될 수 있으므로 Stop 대상이 모호 → Run 유지.
  //
  // 종전에는 `QueuedCommand.status === 'executing'` **하나만** 봤다. 그런데 턴 봉인이 만료된 뒤
  // 세션이 다시 깨어나면 서버는 `SubAgent.status` 만 `active` 로 되돌리고(명령은 이미 아카이브로
  // 옮겨져 되돌릴 수 없다), 그 결과 **아직 돌고 있는 세션에서 [중지]가 사라졌다**. 판정을
  // 공유 모듈(`isSessionRunning`)로 옮겨 세션 축까지 함께 보게 한다.
  const sessionRunning = useSessionRunning(agentId, activeSessionId) && activeSessionId !== null;
  // §5.5 #17-10 v3.53 — 컴팩트 [중지] 노출 조건. **버튼이 실제로 멈출 수 있는 게 있을 때만** 뜬다.
  //   이제 세션 탭의 "이 세션이 띄운 백그라운드 Task" 도 위 `sessionRunning` 이 함께 보므로, 이 조건은
  //   **스코프를 좁힐 세션이 없는 메인 탭 전용**으로 남는다 — 어느 세션 탭이든 executing 이거나
  //   백그라운드 Task 가 하나라도 살아있으면 `stop-all` 을 낼 수 있다.
  const agentBusyElsewhere = useSessionRunning(agentId, null) && activeSessionId === null;
  const sid = useMemo(() => agents.find((a) => a.id === agentId)?.path ?? null, [agents, agentId]);
  const sidRef = useRef<string | null>(sid);
  const agentIdRef = useRef<string>(agentId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // §5.5 #17-23 — 명령 히스토리 상태(자세한 규약은 아래 히스토리 블록 주석 참조).
  //   `historyNavRef` = 탐색 커서(null = 탐색 중 아님), `historyHint` = 진입 힌트(두 번 눌러야 이동).
  //   ref 를 함께 두는 이유: keydown 은 리렌더를 기다릴 수 없어 **직전 힌트 상태를 즉시** 봐야 한다.
  const historyNavRef = useRef<HistoryNavState | null>(null);
  const [historyHint, setHistoryHint] = useState<'prev' | 'next' | null>(null);
  const historyHintRef = useRef<'prev' | 'next' | null>(null);
  const setHint = useCallback((next: 'prev' | 'next' | null) => {
    if (historyHintRef.current === next) return;
    historyHintRef.current = next;
    setHistoryHint(next);
  }, []);
  // 방향키를 누른 **뒤** 커서가 실제로 움직였는지 재는 탐침(기본 동작이 끝난 다음 틱에 확인).
  const arrowProbeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (arrowProbeRef.current !== null) clearTimeout(arrowProbeRef.current);
  }, []);

  // ─── §5.5 #17-38 음성 받아쓰기 ───
  // 인식 언어 = 화면 언어(사용자가 이미 고른 값이라 따로 물을 것이 없다).
  const uiLocale = useGraphStore((s) => s.uiLocale);
  // 창 단위 단축키의 임자 판정 — 분할 중에는 초점 칸만 받는다(#17-34 Ctrl+F·배율과 같은 규칙).
  const voiceCellFocused = useSplitCellFocused();
  const inputRootRef = useRef<HTMLDivElement>(null);
  /**
   * 확정된 말은 **커서 자리에** 들어간다(항상 맨 뒤 ❌ — 문장 가운데를 고치다 마이크를 켜는
   * 일이 실제로 있고, 그때 말한 것이 끝에 붙으면 그 문장을 다시 손봐야 한다).
   * 끼우는 규칙 자체는 shared `mergeVoiceText` 한 곳이고, 여기서는 그 결과를 스토어와
   * 커서 위치로 옮겨 놓기만 한다.
   */
  const handleVoiceCommit = useCallback((chunk: string) => {
    const el = textareaRef.current;
    const current = el?.value ?? '';
    const selStart = el?.selectionStart ?? current.length;
    const selEnd = el?.selectionEnd ?? current.length;
    const merged = mergeVoiceText(current, selStart, selEnd, chunk);
    setText(merged.text);
    // 스토어를 거쳐 값이 다시 그려진 **다음** 프레임에 커서를 세운다 — 지금 세우면 되감긴다.
    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      if (!el2) return;
      el2.setSelectionRange(merged.caret, merged.caret);
      autosizeInput(el2); // 여러 줄이 한꺼번에 들어와도 입력창이 바로 늘어나게
    });
  }, [setText]);
  // §5.5 #17-38 ⑬ — 인식기가 준비돼 있는지는 **서버가 디스크를 보고** 답한다. 준비가 안 됐으면
  //   마이크를 열지 않고 설치 창을 띄운다(열었다 곧 닫으면 OS 표시가 깜빡여 고장으로 읽힌다).
  const voiceAsr = useVoiceAsr();
  const [voiceInstallOpen, setVoiceInstallOpen] = useState(false);
  const voiceSessionKey = `${agentId}:${activeSessionId ?? 'none'}`;
  const voiceAsrRef = useRef(voiceAsr);
  voiceAsrRef.current = voiceAsr;

  /**
   * 누름 → 마이크 사이의 왕복을 하나로 줄인다. 이미 "준비됨"을 물어 둔 판에서는 다시 묻지 않고
   * 곧장 엔진을 띄우고, 그 값이 거짓말이었으면(폴더를 지웠으면) 실패한 자리에서 서버에게
   * 되묻는다 — 판정의 정본은 여전히 서버(디스크)다([voiceOpenGate.ts](../../hooks/voiceOpenGate.ts)).
   */
  const requestVoicePort = useCallback(async (): Promise<VoicePortResult> => resolveVoicePort({
    knownReady: voiceAsrRef.current.state?.ready ?? null,
    refresh: async () => (await voiceAsrRef.current.refresh())?.ready ?? null,
    openSession: () => voiceAsrRef.current.openSession(voiceSessionKey),
  }), [voiceSessionKey]);

  const handleVoiceSessionEnd = useCallback(() => {
    voiceAsrRef.current.closeSession(voiceSessionKey);
  }, [voiceSessionKey]);

  const handleVoiceNeedsInstall = useCallback(() => {
    setVoiceInstallOpen(true);
  }, []);

  const voice = useVoiceDictation({
    locale: uiLocale,
    enabled: true,
    onCommit: handleVoiceCommit,
    resolvePort: requestVoicePort,
    onNeedsInstall: handleVoiceNeedsInstall,
    onSessionEnd: handleVoiceSessionEnd,
  });
  const voiceActive = voice.status === 'starting' || voice.status === 'listening';
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const voiceShortcut = useMemo(() => shortcutLabel(VOICE_INPUT.SHORTCUT), []);

  /**
   * 단축키(#17-38 ③) — **초점이 입력창에 없어도** 같은 손짓이 먹는다.
   *
   * ⚠ 창이 여럿일 수 있다(버블 오버레이 창 #17-6). window 리스너 하나만 두고 "이 칸이
   *   초점"만 보면 **떠 있는 IDE 수만큼 켜졌다 꺼진다** — 그래서 초점이 실제로 이 판
   *   안에 있는지(data-ide-main)까지 함께 본다. 판정이 하나뿐이라 두 번 토글될 자리가 없다.
   *
   * ⚠ capture 단계다. 듣는 중의 Escape 는 "받아쓰기 취소"가 먼저여야 하는데, bubble 로 받으면
   *   입력창의 Escape(슬래시 목록 열림 시 입력 비우기)가 먼저 돌아 쓰던 글까지 날아간다.
   */
  useEffect(() => {
    if (!voiceCellFocused) return;
    const onKey = (e: KeyboardEvent): void => {
      const v = voiceRef.current;
      const listening = v.status === 'starting' || v.status === 'listening';
      const toggle = isVoiceToggleKey(e);
      // 듣는 중이 아닐 때의 Escape 는 우리 것이 아니다 — 종전 흐름(슬래시 목록 닫기 등)에 넘긴다.
      const cancel = e.key === 'Escape' && listening;
      if (!toggle && !cancel) return;

      const root = inputRootRef.current?.closest('[data-ide-main]') ?? null;
      if (root === null) return;
      const active = document.activeElement;
      // 초점이 이 판 안에 있거나, 아직 아무 데도 잡히지 않았을 때(창을 막 연 직후)만 우리 것이다.
      if (!root.contains(active) && active !== null && active !== document.body) return;
      if (handledVoiceKeys.has(e)) return;
      handledVoiceKeys.add(e);

      e.preventDefault();
      e.stopPropagation();
      if (toggle) v.toggle();
      else v.cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [voiceCellFocused]);

  // §5.5 #17-2 v2.30 / #17-4 v2.32 — 슬래시 자동완성. `useAvailableSkills` 가 모듈 캐시를 공유.
  // v2.59 — 이 에이전트가 속한 프로젝트의 스킬만 자동완성(탭별 개별 조회).
  // v3.19 — CLI 내장 슬래시 명령(builtins)도 병행 표시(드롭다운 전용 — Skills 사이드바 불변).
  const slashProjectName = useGraphStore((s) => s.agentProjects[agentId]);
  const { skills: availableSkills, builtins: builtinCommands, loaded: skillsLoaded } = useAvailableSkills(slashProjectName, agentId);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashListRef = useRef<HTMLDivElement>(null);
  // 방향키 이동일 때만 활성 항목 스크롤 추종 — hover 로 인한 setSlashIndex 까지 추종하면
  // 스크롤이 항목을 커서 밑으로 밀어 mouseEnter 가 재발화하는 되먹임이 생긴다.
  const slashKeyboardNavRef = useRef(false);

  useEffect(() => { sidRef.current = sid; }, [sid]);
  useEffect(() => { agentIdRef.current = agentId; }, [agentId]);

  // 세션 전환/외부 텍스트 변경 시 textarea height 재조정 — JS 폴백 전용(field-sizing 지원 시 no-op).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    autosizeInput(el);
  }, [activeSessionId, text]);

  // §5.3 #28 v1.47 — draft hydrate. 외부 트리거가 setAgentInputDraft 로 넣은 시드를
  // textarea 에 옮기고 store 에서 consume(중복 prefill 방지). 사용자가 보고 수정 가능.
  // v1.48 — 시드 수신은 "현재 활성 세션" 의 draft 로 들어간다.
  useEffect(() => {
    if (draftForAgent === undefined) return;
    const consumed = consumeAgentInputDraft(agentId);
    if (typeof consumed === 'string' && consumed.length > 0) {
      setAgentSessionInputText(agentId, activeSessionId, consumed);
      // 다음 프레임에 textarea height auto-grow + focus
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        autosizeInput(el);
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [draftForAgent, agentId, activeSessionId, consumeAgentInputDraft, setAgentSessionInputText]);

  // unmount 시 이 agent 의 모든 세션 draft(text+첨부)를 일괄 정리 — 단 "진짜 IDE 닫기" 일 때만.
  // §5.3 #28 v2.x — IDE 오버레이는 ideOverlays[projectId] 로 프로젝트 단위 보관이라(selectIDEOverlay)
  //   옆 프로젝트 탭으로 전환만 해도 AgentIDEOverlay 가 null 을 리턴해 이 컴포넌트가 unmount 된다.
  //   그 unmount 에서 draft 를 지우면 탭 복귀 시 치던 텍스트/첨부가 사라진다(사용자 보고 버그).
  //   closeIDEOverlay 는 ideOverlays 슬롯을 통째로 삭제하므로, unmount 시점에 어떤 슬롯이든
  //   이 agent 의 IDE 가 아직 열려 있으면(=탭 전환) draft 를 보존하고, 아무 슬롯도 없을 때만(=닫힘) 정리한다.
  // 세션 전환은 애초에 unmount 가 아니므로 늘 보존된다.
  useEffect(() => {
    return () => {
      const aid = agentIdRef.current;
      const stillOpen = Object.values(useGraphStore.getState().ideOverlays).some(
        (o) => o.agentId === aid,
      );
      if (stillOpen) return;
      const removed = takeAgentSessionInputs(aid);
      const s = sidRef.current;
      for (const a of removed) URL.revokeObjectURL(a.previewUrl);
      if (!s) return;
      for (const a of removed) {
        if (!a.serverPath) continue;
        fetch(`${API_BASE}/api/agent-attachments/${s}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: a.serverPath }),
        }).catch(() => {});
      }
    };
  }, [takeAgentSessionInputs]);

  // v1.48 — paste 시점 세션을 캡처해 그 세션 draft 의 attachments 로 update.
  // 업로드 중 사용자가 세션을 바꿔도 완료 시 원래 세션에 기록된다.
  const uploadFile = useCallback(async (file: File, targetSessionId: string | null) => {
    const s = sidRef.current;
    if (!s) return;
    const tempId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    updateAgentSessionInputAttachments(agentId, targetSessionId, (prev) => [
      ...prev,
      { tempId, previewUrl, serverPath: '', uploading: true },
    ]);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(`${API_BASE}/api/agent-attachments/${s}/upload`, { method: 'POST', body: fd });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      updateAgentSessionInputAttachments(agentId, targetSessionId, (prev) =>
        prev.map((a) => (a.tempId === tempId ? { ...a, serverPath: data.path, uploading: false } : a)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload failed';
      updateAgentSessionInputAttachments(agentId, targetSessionId, (prev) =>
        prev.map((a) => (a.tempId === tempId ? { ...a, uploading: false, error: msg } : a)),
      );
    }
  }, [agentId, updateAgentSessionInputAttachments]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    // v1.49 — 첨부 미리보기 row 가 sibling 으로 삽입되며 textarea 가 일시적으로 focus 를 잃는 케이스가 있어
    //         paste 동기 + 다음 프레임(re-render 후) 양쪽에서 명시적으로 focus 복구.
    const el = e.currentTarget;
    const sessionAtPaste = activeSessionId;
    for (const f of files) void uploadFile(f, sessionAtPaste);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      } else {
        el.focus();
      }
    });
  }, [uploadFile, activeSessionId]);

  const removeAttachment = useCallback((tempId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.tempId === tempId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        const s = sidRef.current;
        if (target.serverPath && s) {
          fetch(`${API_BASE}/api/agent-attachments/${s}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: target.serverPath }),
          }).catch(() => {});
        }
      }
      return prev.filter((a) => a.tempId !== tempId);
    });
  }, [setAttachments]);

  const hasPendingUploads = attachments.some((a) => a.uploading);
  const canSubmit = text.trim().length > 0 && !hasPendingUploads;

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (hasPendingUploads) return;
    const submitted = attachments.filter((a) => !a.uploading && a.serverPath && !a.error);
    const paths = submitted.map((a) => a.serverPath);
    // v1.38 — 제출한 첨부의 blob URL 을 스토어로 이관 (basename 키).
    //         입력창 draft 에서는 즉시 비우되 revoke 하지 않음 — 소유권 이전.
    //         StreamStatusBar 가 실행중 커맨드의 cmd.attachments basename 으로 조회해 렌더.
    const basenameOf = (p: string): string => {
      const parts = p.split(/[/\\]/);
      return parts[parts.length - 1] ?? '';
    };
    for (const a of submitted) {
      registerAttachmentPreview(basenameOf(a.serverPath), a.previewUrl);
    }
    addCommand(agentId, trimmed, activeSessionId, paths);
    // v1.48 — 에러/업로드중 첨부 없으면 draft 전체 제거(키 정리), 있으면 text 만 비우고 attachments 남김.
    const remaining = attachments.filter((a) => a.uploading || a.error || !a.serverPath);
    if (remaining.length === 0) {
      clearAgentSessionInput(agentId, activeSessionId);
    } else {
      setText('');
      setAttachments(() => remaining);
    }
    if (textareaRef.current && !INPUT_FIELD_SIZING) {
      textareaRef.current.style.height = 'auto';
    }
    // 전송하면 히스토리 탐색 상태·힌트 초기화(적재는 addCommand 가 한다 — #17-23).
    historyNavRef.current = null;
    setHint(null);
  }, [text, agentId, activeSessionId, addCommand, attachments, hasPendingUploads, registerAttachmentPreview, clearAgentSessionInput, setText, setAttachments, setHint]);

  // §5.5 #17-10 v3.53 — [중지] = **열려 있는 세션 하나 + 그 세션이 띄운 서브에이전트** 중지.
  //   v3.51 은 이걸 에이전트 전체(stop-all)로 올려 다른 세션 탭까지 함께 끊었다 — 중지의 기본 단위는
  //   사용자가 보고 있는 세션이다. 세션 탭이면 stop-session(그 탭의 자식 + 그 세션 대차대조 + 그 세션
  //   큐만), 스코프를 좁힐 세션이 없는 메인 탭에서만 종전 stop-all.
  //   둘 다 실행 중인 게 없어도 멱등(200)이라 에러 처리 분기가 필요 없다.

  // §5.5 #17-2 v2.30 — text 가 `/` 로 시작하고 첫 토큰을 아직 타이핑 중이면 드롭다운 활성.
  // 매칭 0개여도 드롭다운은 열려 "No matching skills" hint 표기.
  // v3.19 — 디스크 스킬 뒤에 CLI 내장 명령을 병행 매칭(별칭 포함). 같은 이름은 스킬이 이긴다
  //   (Claude Code 규칙: project/personal 커맨드가 built-in 을 가림).
  // §5.19 (G) — 로컬 버블(All Model)에는 클로드 CLI 의 슬래시 명령·스킬이 없다. 목록을 띄우면
  //   고를 수 있는 것처럼 보이지만 실제로는 그 텍스트가 모델에게 그대로 흘러갈 뿐이다.
  const isLocalProviderAgent = useGraphStore((s) => (agentId ? !!s.agentConfigs[agentId]?.provider : false));
  // §4 (슬래시 명령 가용성) — CMD 버블(`interactive-terminal`)은 진짜 REPL 이라 화면 있는 명령도 전부 된다.
  //   헤드리스일 때만 "터미널 필요" 배지를 단다 — 되는 곳에서 안 된다고 하면 그게 더 나쁜 거짓말이다.
  const isInteractiveTerminalAgent = useGraphStore(
    (s) => (agentId ? s.agentConfigs[agentId]?.executionMode === 'interactive-terminal' : false),
  );
  const slashState = useMemo(() => {
    if (isLocalProviderAgent) return null;
    if (!text.startsWith('/')) return null;
    const firstWord = text.slice(1).split(/\s/)[0] ?? '';
    if (text.length > firstWord.length + 1) return null;
    const filter = firstWord.toLowerCase();
    const skillMatched = filter.length === 0
      ? availableSkills
      : availableSkills.filter((s) => s.name.toLowerCase().includes(filter));
    const skillNames = new Set(availableSkills.map((s) => s.name.toLowerCase()));
    const builtinMatched = builtinCommands.filter((c) => {
      if (skillNames.has(c.name.toLowerCase())) return false;
      if (filter.length === 0) return true;
      return c.name.toLowerCase().includes(filter)
        || c.aliases.some((a) => a.toLowerCase().includes(filter));
    });
    const matched: SlashItem[] = [
      ...skillMatched.map((s): SlashItem => ({ kind: 'skill', name: s.name, skill: s })),
      ...builtinMatched.map((c): SlashItem => ({ kind: 'builtin', name: c.name, builtin: c })),
    ];
    return { filter, matched };
  }, [text, availableSkills, builtinCommands, isLocalProviderAgent]);

  const slashOpen = slashState !== null;
  const slashKey = slashState?.filter ?? '';
  useEffect(() => {
    setSlashIndex(0);
    slashListRef.current?.scrollTo({ top: 0 });
  }, [slashKey]);
  // 방향키로 활성 항목이 max-h 스크롤 영역 밖으로 나가면 최소 이동으로 따라간다.
  useEffect(() => {
    if (!slashKeyboardNavRef.current) return;
    slashKeyboardNavRef.current = false;
    slashListRef.current
      ?.querySelector<HTMLElement>('[data-slash-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex]);

  const confirmSlash = useCallback((item: SlashItem) => {
    setAgentSessionInputText(agentId, activeSessionId, `/${item.name} `);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autosizeInput(el);
    });
  }, [agentId, activeSessionId, setAgentSessionInputText]);

  // §5.5 #17-23 — 입력 명령 히스토리: **이 세션에서** 보낸 사용자 프롬프트를 ↑/↓ 로 재호출(셸/CMD 관례).
  //   커서가 첫 줄일 때 ↑(더 오래된 것), 마지막 줄일 때 ↓(더 최근/원래 draft)에만 반응해 멀티라인 편집을
  //   깨지 않는다. 슬래시 드롭다운/한글 IME 조합 중엔 비활성.
  //   ⚠ 진입은 **두 번 누름** — 경계에서 첫 번째 방향키는 힌트만 띄우고(historyHint), 두 번째에 실제로
  //     히스토리로 들어간다. 꺼낼 게 없으면 힌트조차 뜨지 않고 키도 가로채지 않는다(#17-23 ⑤).
  //   ⚠ 목록은 **구독하지 않는다**(commandHistory 모듈 캐시에서 키를 누른 순간 읽는다) — 종전엔
  //     queuedCommands 를 구독해 명령 상태가 바뀔 때마다 입력창이 리렌더됐고, 완료된 명령은 서버가
  //     큐에서 빼 가므로 정작 히스토리는 비어 있었다.
  // 세션 탭을 옮기면 그 탭의 히스토리로 갈아타므로 탐색·힌트 상태를 버린다.
  useEffect(() => {
    historyNavRef.current = null;
    historyHintRef.current = null;
    setHistoryHint(null);
  }, [agentId, activeSessionId]);
  // 이 기능 이전에 보낸 명령을 첫 사용에서 한 번 끌어온다(저장분이 없을 때만 — 이후엔 addCommand 가 유일 입구).
  //   완료 아카이브를 의존성에 두는 이유: 창을 여는 순간엔 아직 서버 스냅샷이 안 왔을 수 있어
  //   마운트 1회로 끝내면 "첫 실행에서만 히스토리가 비는" 창이 생긴다. 이 값은 명령이 끝날 때만
  //   바뀌고 구조적 공유로 동일성이 유지되므로 리렌더 부담이 없다(큐를 구독하던 종전과 다르다).
  const completedForAgent = useGraphStore((s) => s.completedCommands[agentId]);
  useEffect(() => {
    if (activeSessionId === null) return; // 메인 탭은 보낼 때마다 새 세션이 생기므로 시드할 과거가 없다
    if (hasCommandHistory(agentId, activeSessionId)) return;
    const st = useGraphStore.getState();
    const seen = [
      ...(st.completedCommands[agentId] ?? []),
      ...(st.queuedCommands[agentId] ?? []),
    ]
      .filter((c) => c.subAgentId === activeSessionId) // 세션 단위 — 옆 탭 명령이 섞이지 않게
      .filter((c) => !c.edgeId) // Task Edge 로 주입된 것은 사용자가 친 명령이 아니다
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((c) => c.text ?? '');
    seedCommandHistory(agentId, activeSessionId, seen);
  }, [agentId, activeSessionId, completedForAgent]);
  const applyHistoryText = useCallback((value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      autosizeInput(el);
    });
  }, [setText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (slashOpen && slashState) {
      const matched = slashState.matched;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (matched.length > 0) {
          slashKeyboardNavRef.current = true;
          setSlashIndex((i) => Math.min(matched.length - 1, i + 1));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (matched.length > 0) {
          slashKeyboardNavRef.current = true;
          setSlashIndex((i) => Math.max(0, i - 1));
        }
        return;
      }
      if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && matched.length > 0) {
        e.preventDefault();
        const picked = matched[Math.min(slashIndex, matched.length - 1)];
        if (picked) confirmSlash(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setText('');
        return;
      }
    }
    // 명령 히스토리 (↑/↓) — 슬래시 드롭다운 비활성 + IME 조합 아님 + 커서 collapsed 일 때만.
    const composing = (e.nativeEvent as { isComposing?: boolean }).isComposing === true;
    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    // 방향키가 아닌 키를 누르면 힌트를 내린다(= 다음엔 다시 두 번 눌러야 들어간다).
    if (!isArrow && historyHintRef.current !== null) setHint(null);
    if (!slashOpen && !composing && isArrow) {
      const el = textareaRef.current;
      if (el && el.selectionStart === el.selectionEnd) {
        // ⚠ **커서 이동이 언제나 우선이다** — 키를 가로채지 않고(preventDefault ❌) 브라우저가
        //   기본 동작을 하게 둔 뒤, 커서가 **실제로 움직였는지**로 경계를 판정한다.
        //   줄바꿈(`\n`) 위치로 계산하면 워드랩으로 접힌 긴 한 줄에서 "이미 첫 줄"로 오판해
        //   사용자가 커서를 위로 못 올린다(실제 사용자 신고 지점). 화면상 몇 행인지는 브라우저만 안다.
        const direction = e.key === 'ArrowUp' ? 'prev' : 'next';
        const beforeCaret = el.selectionStart ?? 0;
        const beforeValue = el.value;
        if (arrowProbeRef.current !== null) clearTimeout(arrowProbeRef.current);
        arrowProbeRef.current = setTimeout(() => {
          arrowProbeRef.current = null;
          const el2 = textareaRef.current;
          if (!el2 || el2.value !== beforeValue) return; // 그 사이 값이 바뀌었으면 판단 보류
          // 판정 규칙은 순수 함수 한 곳(decideArrowKey)에 있다 — 화면은 결과만 집행한다.
          const outcome = decideArrowKey({
            caretMoved: (el2.selectionStart ?? 0) !== beforeCaret,
            nav: historyNavRef.current,
            hint: historyHintRef.current,
            entries: getCommandHistory(agentId, activeSessionId),
            draft: el2.value,
            direction,
          });
          if (outcome.kind === 'clearHint') setHint(null);
          else if (outcome.kind === 'hint') setHint(outcome.direction);
          else if (outcome.kind === 'apply') {
            historyNavRef.current = outcome.nav;
            setHint(null);
            applyHistoryText(outcome.text);
          }
        }, 0);
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 실행 중에도 Enter 는 "덧말"(추가 대화) 로 동작 — 중지하지 않고 후속 메시지를 큐에 넣는다.
      // 중지는 마우스로 좌측 중지 버튼을 눌러야만 — Enter 로 실행을 끊지 않는다(사용자 보고 흐름).
      handleSubmit();
      return;
    }
    // Shift+Enter = 줄 추가(브라우저가 줄바꿈 삽입 — preventDefault ❌). field-sizing 이 간헐적으로
    //   새 줄만큼 높이 재계산을 즉시 못 해 방금 친 줄이 아래로 가려지는 문제 안전판.
    //   커밋 후(rAF) caret 이 값의 끝이면 바닥으로 스크롤해 새 줄이 항상 보이게 한다.
    //   ⚠ 타이핑 핫패스가 아니라 **엔터 1회**에만 도는 레이아웃 읽기라 입력 지연 회귀 없음.
    if (e.key === 'Enter' && e.shiftKey) {
      const el = textareaRef.current;
      if (el) {
        const atEnd =
          el.selectionStart === el.selectionEnd && (el.selectionStart ?? 0) >= el.value.length;
        requestAnimationFrame(() => {
          const e2 = textareaRef.current;
          if (!e2) return;
          autosizeInput(e2); // JS 폴백 환경에서 즉시 재측정(field-sizing 지원 시 no-op)
          if (atEnd) e2.scrollTop = e2.scrollHeight; // 새 줄/caret 을 뷰에 유지
        });
      }
    }
  }, [slashOpen, slashState, slashIndex, confirmSlash, setText, handleSubmit, agentId, activeSessionId, applyHistoryText, setHint]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // ⚠ 타이핑 핫패스 — field-sizing 지원 시 autosizeInput 은 no-op(강제 reflow 0회).
    //   여기에 per-keystroke 레이아웃 읽기(scrollHeight 등)를 다시 넣으면 입력 지연 회귀.
    autosizeInput(el);
    // 사용자가 직접 타이핑하면 히스토리 탐색·힌트 종료(다음 ↑ 는 현재 편집분을 prefix·draft 로 다시 시작).
    historyNavRef.current = null;
    if (historyHintRef.current !== null) setHint(null);
    // 타이핑 = 완료 알림 확인 — 도트 녹색→회색.
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged, setHint]);

  // §5.5 #17-3 v2.79 — 입력 textarea 우클릭 컨텍스트 메뉴 (Cut/Copy/Paste/Select All).
  //   Electron packaged 빌드엔 브라우저 기본 메뉴가 없어 우클릭 시 아무 것도 안 떴다 →
  //   일반 IDE 입력창처럼 우클릭 메뉴를 직접 그린다. 출력 영역 메뉴(handleContextMenu)와 별개.
  const [inputCtx, setInputCtx] = useState<
    { x: number; y: number; start: number; end: number; hasSel: boolean } | null
  >(null);
  const closeInputCtx = useCallback(() => setInputCtx(null), []);

  const handleInputContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setInputCtx({ x: e.clientX, y: e.clientY, start, end, hasSel: end > start });
  }, []);

  // 지정 범위를 insert 로 교체하고 caret/높이 복원 (Cut=빈 문자열, Paste=클립보드 텍스트).
  const replaceInputRange = useCallback((start: number, end: number, insert: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const value = el.value;
    const next = value.slice(0, start) + insert + value.slice(end);
    setText(next);
    const caret = start + insert.length;
    requestAnimationFrame(() => {
      const e2 = textareaRef.current;
      if (!e2) return;
      e2.focus();
      e2.setSelectionRange(caret, caret);
      autosizeInput(e2);
    });
  }, [setText]);

  const inputCtxItems = useMemo<ContextMenuItem[]>(() => {
    const ctx = inputCtx;
    const hasSel = ctx?.hasSel ?? false;
    const selectionRequired = t('ide.mainArea.ctxSelectionRequired');
    const selText = (): string => {
      if (!ctx) return '';
      return (textareaRef.current?.value ?? '').slice(ctx.start, ctx.end);
    };
    return [
      {
        label: t('ide.mainArea.inputCtxCut'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => {
          if (!ctx) return;
          const s = selText();
          if (s && typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(s).catch(() => {});
          }
          replaceInputRange(ctx.start, ctx.end, '');
        },
      },
      {
        label: t('ide.mainArea.inputCtxCopy'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => {
          const s = selText();
          if (s && typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(s).catch(() => {});
          }
        },
      },
      {
        // §5.5 #17-3 (판올림 번호 발급 대기) — 입력창에서 고른 글자도 같은 함수로 검색한다.
        label: t('ide.mainArea.ctxSearchWeb'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => { openWebSearch(selText()); },
      },
      {
        label: t('ide.mainArea.inputCtxPaste'),
        onClick: () => {
          if (!ctx || typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;
          navigator.clipboard
            .readText()
            .then((clip) => { if (clip) replaceInputRange(ctx.start, ctx.end, clip); })
            .catch(() => {});
        },
      },
      {
        label: t('ide.mainArea.inputCtxSelectAll'),
        onClick: () => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.select();
        },
      },
    ];
  }, [inputCtx, t, replaceInputRange]);

  return (
    <div ref={inputRootRef} className="relative flex flex-col gap-1.5 border-t border-gray-700 bg-gray-900/80 px-3 py-2">
      {/* §5.5 #17-38 — "지금 듣고 있다"는 입력창 **위**에 뜬다. 말한 것은 아래 입력창의 글이 되고,
          아직 확정되지 않은 말만 이 줄에 머문다(사용자 지시 — 텍스트는 창에, 이펙트는 창 위에). */}
      <VoiceInstallDialog
        open={voiceInstallOpen}
        state={voiceAsr.state}
        uiLocale={uiLocale}
        onInstall={() => { void voiceAsr.install(); }}
        onCancel={() => { void voiceAsr.cancel(); }}
        onClose={() => { setVoiceInstallOpen(false); }}
        onReady={() => {
          // §5.19 (B) — 창이 스스로 끝을 알리고 물러나며, 누른 사람이 하려던 일이 이어진다.
          setVoiceInstallOpen(false);
          voiceRef.current.start();
        }}
      />
      <VoiceInputOverlay
        status={voice.status}
        error={voice.error}
        interim={voice.interim}
        analyserRef={voice.analyserRef}
        onStop={voice.stop}
        onDismissError={voice.dismissError}
      />
      {/* §5.5 #17-23 ⑤ — 히스토리 진입 힌트. 경계에서 방향키를 처음 눌렀을 때만 뜨고,
          같은 방향으로 한 번 더 누르면 실제로 히스토리로 들어간다. 꺼낼 게 없으면 아예 안 뜬다.
          받아쓰기 중에는 내린다 — 같은 자리를 두 장이 나눠 쓰지 않는다(방향키 안내는 지금 쓸모가 없다). */}
      {historyHint !== null && !slashOpen && !voiceActive && (
        <div className="pointer-events-none absolute bottom-full left-3 mb-1 flex items-center gap-1.5 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-300 shadow-lg">
          <span className="flex h-4 w-4 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-300">
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {historyHint === 'prev' ? (
                <>
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </>
              ) : (
                <>
                  <path d="M12 5v14" />
                  <path d="M19 12l-7 7-7-7" />
                </>
              )}
            </svg>
          </span>
          <span>{t(historyHint === 'prev' ? 'ide.mainArea.historyHintPrev' : 'ide.mainArea.historyHintNext')}</span>
        </div>
      )}
      {/* §5.5 #17-2 v2.30 — 슬래시 자동완성 드롭다운 (입력행 바로 위) */}
      {slashOpen && slashState && (
        <div ref={slashListRef} className={`absolute bottom-full left-0 right-0 max-h-72 overflow-y-auto rounded-t border border-b-0 border-gray-700 bg-gray-900 shadow-lg scrollbar-thin ${voiceActive ? 'mb-[46px]' : 'mb-1'}`}>
          {slashState.matched.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-500">
              {skillsLoaded ? t('ide.mainArea.slashEmpty') : t('ide.mainArea.slashLoading')}
            </div>
          ) : (
            slashState.matched.map((item, idx) => {
              const isActive = idx === Math.min(slashIndex, slashState.matched.length - 1);
              // v3.19 — 내장 명령은 sky, 스킬은 기존 emerald(project)/purple(그 외) 유지.
              const accentBg = item.kind === 'builtin'
                ? 'bg-sky-500/15'
                : item.skill.source === 'project' ? 'bg-emerald-500/15' : 'bg-purple-500/15';
              const accentText = item.kind === 'builtin'
                ? 'text-sky-400'
                : item.skill.source === 'project' ? 'text-emerald-400' : 'text-purple-400';
              const description = item.kind === 'builtin' ? item.builtin.description : item.skill.description;
              return (
                <button
                  key={`${item.kind}:${item.name}`}
                  type="button"
                  data-slash-active={isActive ? 'true' : undefined}
                  onMouseDown={(ev) => { ev.preventDefault(); confirmSlash(item); }}
                  onMouseEnter={() => setSlashIndex(idx)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${isActive ? accentBg : 'hover:bg-gray-800/60'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-[12px] font-semibold ${accentText}`}>/{item.name}</span>
                    {item.kind === 'skill' && item.skill.source === 'plugin' && item.skill.pluginName && (
                      <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[12px] uppercase tracking-wide text-purple-400/80">
                        {item.skill.pluginName}
                      </span>
                    )}
                    {item.kind === 'builtin' && (
                      <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[12px] uppercase tracking-wide text-sky-400/80">
                        {t('ide.mainArea.slashBuiltin')}
                      </span>
                    )}
                    {item.kind === 'builtin' && item.builtin.aliases.length > 0 && (
                      <span className="font-mono text-[12px] text-gray-600">
                        {item.builtin.aliases.map((a) => `/${a}`).join(' ')}
                      </span>
                    )}
                    {/* §4 (슬래시 명령 가용성) — 헤드리스에서 CLI 가 거절하는 명령. 종전에는 화면이
                        아무 말도 안 해 사용자가 고른 뒤에야 죽는 걸 알았다. */}
                    {item.kind === 'builtin' && slashCommandNeedsTerminal(item.name, isInteractiveTerminalAgent) && (
                      <span className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[12px] tracking-wide text-amber-400/90">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3 w-3"
                          aria-hidden="true"
                        >
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <path d="m7 9 3 3-3 3M13 15h4" />
                        </svg>
                        {t('ide.mainArea.slashNeedsTerminal')}
                      </span>
                    )}
                  </div>
                  {description && (
                    <span className="line-clamp-2 text-[12px] leading-tight text-gray-500">
                      {description}
                    </span>
                  )}
                </button>
              );
            })
          )}
          <div className="border-t border-gray-800 bg-gray-950/70 px-3 py-1 text-[12px] text-gray-600">
            {t('ide.mainArea.slashHint')}
          </div>
        </div>
      )}
      {/* §5.5 #17-18 ⑤ v4.77 — 옛 "대기 줄"은 없앴다. 대기 중 덧말의 상태·방식 칩·삭제는 그 덧말의
          **말풍선(CollapsiblePrompt)** 안에 있다 — 같은 내용을 두 곳에 그리지 않는다. */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.tempId}
              className="group relative h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800"
              title={a.error ?? (a.uploading ? t('panel.commandQueue.uploading') : t('panel.commandQueue.attached'))}
            >
              <img
                src={a.previewUrl}
                alt=""
                // §5.5 #17-25 v4.80 — 아직 안 보낸 첨부는 "어느 자리인지"를 함께 넘긴다
                //   → 라이트박스에서 주석을 저장하면 새로 붙지 않고 **이 자리를 교체**한다.
                onClick={() => {
                  if (a.uploading || a.error) return;
                  openImageLightbox(a.previewUrl, { agentId, sessionId: activeSessionId, tempId: a.tempId });
                }}
                className={`h-full w-full object-cover ${a.uploading || a.error ? 'opacity-40' : 'cursor-zoom-in'}`}
              />
              {a.uploading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                </div>
              )}
              {a.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
                  <span className="text-[12px] font-semibold text-red-200">{t('ide.mainArea.attachmentError')}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(a.tempId)}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-[12px] text-gray-200 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                aria-label={t('panel.commandQueue.removeAttachment')}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-blue-400">{'>'}</span>
        {/* v3.31 — flex 축소(min-w-0)를 wrapper 로 옮기고 textarea 는 w-full(definite width)로 고정.
            field-sizing:content 가 textarea 를 flex 항목으로 두면 내용 폭까지 넓혀 긴 붙여넣기/삽입이
            줄바꿈되지 않아 1줄로 잘리고 세로로 안 늘어났다. 폭을 wrapper 로 확정하면 field-sizing 은
            높이만 계산 → 내용이 줄바꿈되며 세로로 자동 확장. */}
        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onBlur={() => setHint(null)} // 포커스를 잃으면 히스토리 힌트도 내린다
            onPaste={handlePaste}
            onContextMenu={handleInputContextMenu}
            // 전역 입력칸 메뉴(`GlobalTextFieldContextMenu`)에게 "여긴 내가 맡는다"고 알린다 —
            // 전역이 가로채면 이 메뉴의 [웹에서 검색] 이 통째로 죽는다.
            data-text-menu="own"
            rows={1}
            placeholder={activeSessionId === null ? t('ide.mainArea.inputPlaceholderNew') : t('ide.mainArea.inputPlaceholder')}
            className="scrollbar-thin block min-h-[28px] w-full resize-none bg-transparent text-[13px] leading-7 text-gray-200 placeholder-gray-500 outline-none"
            style={
              INPUT_FIELD_SIZING
                ? ({ maxHeight: INPUT_MAX_HEIGHT, fieldSizing: 'content' } as React.CSSProperties)
                : { maxHeight: INPUT_MAX_HEIGHT }
            }
            data-ide-input={agentId}
            data-ide-input-session={activeSessionId ?? ''}
          />
        </div>
        {/* §5.5 #17-38 — 마이크. 실행/중지 왼쪽에 상주하고, 듣는 중에는 같은 자리에서 빨갛게 뛴다.
            `aria-pressed` 로 켜짐을 알린다(색만으로는 읽어 주는 도구에 전달되지 않는다). */}
        <button
          type="button"
          onClick={voice.toggle}
          aria-pressed={voiceActive}
          aria-label={t(voiceActive ? 'ide.mainArea.voiceStop' : 'ide.mainArea.voiceStart', { shortcut: voiceShortcut })}
          title={t(voiceActive ? 'ide.mainArea.voiceStop' : 'ide.mainArea.voiceStart', { shortcut: voiceShortcut })}
          className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border transition-colors ${
            voiceActive
              ? 'border-rose-500/60 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
              : voice.status === 'error'
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          {voiceActive && (
            <span className="absolute inset-0 animate-pulse rounded bg-rose-500/10" aria-hidden="true" />
          )}
          <svg className="relative h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
        {sessionRunning ? (
          // 실행 중: 좌측 [중지](마우스 클릭 전용) + 우측 [덧말](Enter=추가 대화).
          //   중지는 실행을 끊는 파괴적 동작이라 마우스로만 — Enter 는 handleSubmit(덧말)에 배정.
          //   덧말 = 멈추지 않고 후속 메시지를 큐에 추가(서버 busy 가드가 현재 턴 종료 후 이어서 처리).
          <>
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="flex h-7 flex-shrink-0 items-center gap-1 rounded bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              // §5.5 #17-10 v3.53 — 이 버튼은 이 세션 탭이 실행 중일 때만 뜬다 = 항상 세션 스코프.
              title={t('ide.mainArea.stopSessionTitle')}
              aria-label={t('ide.mainArea.stop')}
            >
              {stopping ? (
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-white/70 border-t-transparent" />
              ) : (
                <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1" y="1" width="8" height="8" rx="1" />
                </svg>
              )}
              {stopping ? t('ide.mainArea.stopping') : t('ide.mainArea.stop')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex h-7 flex-shrink-0 items-center gap-1 rounded bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
              title={hasPendingUploads ? t('panel.commandQueue.waitingForUpload') : t('ide.mainArea.followUpTitle')}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('ide.mainArea.followUp')}
            </button>
          </>
        ) : (
          <>
            {/* §5.5 #17-10 v3.53 — 이 탭 입력은 노는데 멈출 게 남아 있으면 전송 옆에 컴팩트 [중지].
                세션 탭 = 이 세션이 띄운 백그라운드 서브에이전트만, 메인 탭 = 에이전트 전체. 다 끝나면 사라진다. */}
            {agentBusyElsewhere && (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-red-500/50 text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                title={activeSessionId ? t('ide.mainArea.stopSessionTitle') : t('ide.mainArea.stopAllTitle')}
                aria-label={activeSessionId ? t('ide.mainArea.stop') : t('ide.mainArea.stopAll')}
              >
                {stopping ? (
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-red-300/70 border-t-transparent" />
                ) : (
                  <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor">
                    <rect x="1" y="1" width="8" height="8" rx="1" />
                  </svg>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex h-7 flex-shrink-0 items-center rounded bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
              title={hasPendingUploads ? t('panel.commandQueue.waitingForUpload') : undefined}
            >
              {t('ide.mainArea.run')}
            </button>
          </>
        )}
      </div>
      {inputCtx && (
        <IDEContextMenu x={inputCtx.x} y={inputCtx.y} items={inputCtxItems} onClose={closeInputCtx} />
      )}
    </div>
  );
}

// ─── Stream 하단 상태바 — 실행 중 스피너 / 완료 후 요약+스크롤점프 ───

interface StreamStatusBarProps {
  commands: QueuedCommand[];
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Sub 탭 가상 리스트 핸들 — 점프 시 미렌더 항목을 scrollToIndex 로 먼저 렌더시키기 위함. */
  streamRef: React.RefObject<StreamRendererHandle>;
  /** v3.14 — 점프 직전 호출: 부모가 바닥 추종을 해제해 워치독이 점프 위치를 되끌지 않게 한다. */
  onJump?: () => void;
  /** §5.5 #17-12 — 이 세션의 스트림 이벤트(마지막 TodoWrite 로 "지금 무엇을" 판정). */
  events: SubAgentStreamEvent[];
  /**
   * 이 세션이 **지금 돌고 있는가**(`isSessionRunning` 판정 결과).
   *
   * 명령 상태(`executing`)만으로는 부족하다 — 턴 봉인이 만료된 뒤 세션이 다시 깨어나면 명령은
   * `completed` 로 굳은 채 스트림만 계속 흐른다. 그때 이 줄이 초록 "완료"를 띄우면 화면이
   * 거짓말을 한다(탭 점은 파랗게 도는데 여기만 끝났다고 말하던 그 불일치).
   */
  sessionRunning: boolean;
}

const STATUS_SUMMARY_MAX = 80;

/** §5.5 #17-12 — 표시 밀도 3단 토글(간결/표준/원문). 상태바 우측에 상주 — 스트림이 길어지는 자리에서 바로 조절. */
function StreamDensityToggle(): React.JSX.Element {
  const { t } = useTranslation();
  const density = useGraphStore((s) => s.ideStreamDensity);
  const setDensity = useGraphStore((s) => s.setIdeStreamDensity);
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 rounded border border-gray-700/60 p-0.5" title={t('ide.density.label')}>
      {STREAM_DENSITIES.map((d) => (
        <button
          key={d}
          type="button"
          onClick={(e) => { e.stopPropagation(); setDensity(d); }}
          className={`rounded px-1.5 py-0.5 text-[12px] font-medium transition-colors ${
            density === d ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
        >
          {t(`ide.density.${d}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * §5.19 (G) — All Model(로컬 LLM) 버블이 **지금 문 모델**. 종전에는 창 타이틀바의 정체 뱃지였으나
 * 사용자 지시로 **밀도 토글 옆**(하단 상태바)으로 내려왔다 — 모델을 바꾸는 일은 창의 이름표보다
 * "지금 이 대화를 무엇으로 굴리나"에 가깝고, 그 조절 손잡이(밀도·추종)가 모여 있는 자리가 여기다.
 *
 * 로컬 버블이 아니면 **아무것도 그리지 않는다** — 클로드 버블의 상태바는 종전과 한 픽셀도 다르지 않다.
 * 바깥 줄이 `role="button"`(프롬프트로 점프)이라 클릭은 밀도 토글과 같이 `stopPropagation` 한다.
 */
/**
 * §5.19 (D) — 이 버블의 **대화 창이 얼마나 찼나.**
 *
 * 종전에는 창을 넘긴 **뒤에야** 한 줄이 떴다 — 그때는 이미 오래된 말을 덜어 낸 뒤라 사용자는
 * 무엇이 사라졌는지 모른 채 결과만 본다. 엔진이 왕복마다 프롬프트 토큰 수를 공짜로 알려 주므로,
 * 넘치기 전에 보여 주는 것이 옳다.
 *
 * 값이 없으면 **아무것도 그리지 않는다** — 첫 턴을 돌기 전에는 잴 것이 없고, 빈 막대는
 * "0% 찼다"는 거짓말이 된다.
 */
function StreamLocalContextGauge({ used, limit }: { used: number; limit: number }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!(limit > 0) || used <= 0) return null;
  const ratio = Math.min(1, used / limit);
  const percent = Math.round(ratio * 100);
  // 색은 셋뿐이다 — 여유 / 슬슬 / 곧 넘침. 눈금을 더 쪼개도 사람이 하는 일은 같다.
  const tone = ratio >= 0.9 ? 'bg-rose-400' : ratio >= 0.75 ? 'bg-amber-400' : 'bg-slate-400';
  const label = `${String(Math.round(used / 100) / 10)}K / ${String(Math.round(limit / 1024))}K`;
  return (
    <span
      className="flex flex-shrink-0 items-center gap-1"
      title={t('ide.overlay.localContextUsed', {
        defaultValue: '대화 창 {{used}} / {{limit}} 토큰 ({{percent}}%) — 넘치면 오래된 말부터 덜어 냅니다',
        used,
        limit,
        percent,
      })}
    >
      <span className="h-1 w-8 overflow-hidden rounded-full bg-gray-700">
        <span className={`block h-full ${tone}`} style={{ width: `${String(percent)}%` }} />
      </span>
      <span className="text-[12px] font-normal text-slate-400">{label}</span>
    </span>
  );
}

function StreamLocalModelButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const provider = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider : undefined));
  const openLocalModelWindow = useGraphStore((s) => s.openLocalModelWindow);
  if (!agentId || !provider) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openLocalModelWindow(agentId); }}
      className="flex min-w-0 items-center gap-1.5 rounded bg-slate-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-500/25"
      title={t('ide.overlay.localSwitchModel', { defaultValue: '이 버블이 쓸 모델 바꾸기' })}
    >
      <span className="flex-shrink-0">{t('ide.overlay.localLabel', { defaultValue: 'All Model' })}</span>
      {provider.modelName && (
        <span className="max-w-[180px] truncate font-normal text-slate-400">{provider.modelName}</span>
      )}
      {provider.contextUsed !== undefined && provider.contextLimit !== undefined && (
        <StreamLocalContextGauge used={provider.contextUsed} limit={provider.contextLimit} />
      )}
    </button>
  );
}

/** §5.5 #17-27 ⑪ (h) — 따라간 알림이 화면에 머무는 시간(ms). `index.css` 의 `follow-flyout` 길이와 맞춘다. */
const FOLLOW_FLYOUT_MS = 2200;

/**
 * §5.5 #17-27 ⑪ — [추종] 토글. 밀도 토글 **옆에** 서지만 밀도 축이 아니다(별개 on/off).
 * 켜면 **이 세션이** 고치는 파일을 오른쪽 편집창이 따라 연다 — 끄면 종전처럼 사용자가 눌러야 열린다.
 *
 * (h) — **옆에는 아무것도 붙지 않는다.** 한때 자국 칩과 대기 건수 배지를 상주시켰지만, 좁은 상태바가
 * 셋으로 붐볐고 그 수는 스캔 창 밖으로 밀릴 때마다 줄어 흔들렸다. 상시 표시는 정보가 아니라 배경이 된다 —
 * 그래서 지금은 **따라간 그 순간에만** 버튼 위로 한 줄이 떠올랐다 사라진다(`absolute` 라 줄을 밀지 않고,
 * 사라지는 요소라 클릭 대상도 아니다). 켜짐 자체는 파란 채움 + 맥동하는 점이 말한다.
 */
function StreamFollowToggle(): React.JSX.Element {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const paneSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // §5.5 #17-34 — 창을 나눴으면 **이 칸의** 세션, 안 나눴으면 종전대로 창의 활성 세션.
  const activeSessionId = useSplitCellSession(paneSessionId);
  const sessionKey = followSessionKey(agentId ?? '', activeSessionId);
  const follow = useGraphStore((s) => s.ideEditorFollow[sessionKey] === true);
  const setFollow = useGraphStore((s) => s.setIdeEditorFollow);
  const followNow = useGraphStore((s) => s.followPendingEditNow);
  const lastMark = useGraphStore((s) => s.ideEditorFollowLast);
  // 자국은 **그 세션의 것**만 본다 — 옆 세션이 따라간 파일이 여기 뜨면 세션 격리가 무너져 보인다.
  const mark = follow && lastMark && lastMark.sessionKey === sessionKey ? lastMark : null;

  /** 지금 떠 있는 알림 — 자국이 **새로** 찍힐 때만 서고 스스로 걷힌다(`at` 이 곧 그 알림의 신원). */
  const [flyout, setFlyout] = useState<EditorFollowMark | null>(null);
  /** 이미 띄운 자국의 시각. `null` = 아직 아무것도 안 띄웠다. */
  const flyoutSeenRef = useRef<number | null>(null);
  /** 이 컴포넌트가 처음 그려지는 중인가 — 처음 본 자국은 **옛 것**이라 띄우면 거짓말이 된다. */
  const flyoutMountedRef = useRef(false);
  useEffect(() => {
    const at = mark?.at ?? null;
    // 화면을 다시 그릴 때(뷰 전환·재마운트) 남아 있던 자국이 "방금 따라갔다" 로 둔갑하지 않게 한 번 건너뛴다.
    if (!flyoutMountedRef.current) {
      flyoutMountedRef.current = true;
      flyoutSeenRef.current = at;
      return;
    }
    if (at === null) { flyoutSeenRef.current = null; setFlyout(null); return; }
    if (at === flyoutSeenRef.current) return;
    flyoutSeenRef.current = at;
    setFlyout(mark);
    const timer = window.setTimeout(() => setFlyout(null), FOLLOW_FLYOUT_MS);
    return () => window.clearTimeout(timer);
    // 자국의 시각이 바뀔 때가 곧 "새로 따라갔다" 이다 — 같은 편집으로 두 번 띄우지 않는다.
  }, [mark?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const flySkip = flyout?.skip ?? null;

  return (
    <span className="relative flex flex-shrink-0 items-center">
      {flyout && (
        // 줄을 밀지 않게 절대 배치 · 읽기 전용(사라지는 것을 누르게 하면 헛클릭이 된다).
        <span
          key={flyout.at}
          role="status"
          className={`animate-follow-flyout pointer-events-none absolute bottom-[calc(100%+6px)] right-0 z-20 flex max-w-[18rem] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[12px] shadow-lg shadow-black/40 ${
            flySkip
              ? 'border-amber-400/60 bg-amber-950/95 text-amber-200'
              : 'border-blue-400/60 bg-blue-950/95 text-blue-100'
          }`}
        >
          {flySkip ? (
            <svg
              className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg
              className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M12 20V6" />
              <path d="m6 12 6-6 6 6" />
            </svg>
          )}
          <span className="min-w-0 truncate font-semibold">{flyout.name}</span>
          {flySkip ? (
            <span className="flex-shrink-0 text-amber-300/80">{t(FOLLOW_SKIP_SHORT_KEYS[flySkip])}</span>
          ) : flyout.startLine !== null && (
            <span className="flex-shrink-0 tabular-nums text-blue-300/80">
              {flyout.endLine !== null && flyout.endLine !== flyout.startLine
                ? t('ide.follow.lineRange', { from: flyout.startLine, to: flyout.endLine })
                : t('ide.follow.lineShort', { line: flyout.startLine })}
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        aria-pressed={follow}
        onClick={(e) => {
          e.stopPropagation();
          // 켤 때는 켜는 것으로 끝내지 않는다 — 기억해 둔 마지막 편집이 있으면 **거기까지** 데려간다.
          if (follow) setFollow(sessionKey, false);
          else followNow(sessionKey);
        }}
        title={follow ? t('ide.follow.tipOn') : t('ide.follow.tipOff')}
        className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
          follow
            ? 'border-blue-400/80 bg-blue-500/25 text-blue-100'
            : 'border-gray-600/70 text-gray-400 hover:bg-gray-800 hover:text-gray-100'
        }`}
      >
        {follow ? (
          <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
          </span>
        ) : (
          <svg
            className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" />
            <line x1="12" y1="1.5" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22.5" y2="12" />
          </svg>
        )}
        {follow ? t('ide.follow.labelOn') : t('ide.follow.label')}
      </button>
    </span>
  );
}

/**
 * 하단 상태바 한 줄의 뼈대 — **넘치지 않고 접힌다.**
 *
 * 종전에는 `flex ... gap-2` 한 줄에 손잡이 셋이 전부 `flex-shrink-0` 으로 서 있었다. 창을 좁혀
 * 대화가 얇아지면 그 셋이 줄 밖으로 밀려났는데, 대상 없음 줄은 `justify-end` 라 넘친 만큼이
 * **왼쪽으로** 흘러 옆 사이드바 위를 덮었다(사용자 스크린샷 아래쪽 표시). 이제 줄이 `flex-wrap`
 * 이라 자리가 모자라면 손잡이 묶음이 **다음 줄로 내려간다** — 아무것도 잘리지 않고, 밖으로도
 * 나가지 않는다. 넓은 창에서는 한 줄에 다 들어가므로 종전 화면과 같다.
 */
const STATUS_ROW_CLASS = 'flex w-full flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-800 bg-gray-900/70 px-4';

/**
 * 요약 글줄 — `min-w-*` 가 있어야 **손잡이보다 먼저 사라지지 않는다.** `flex-1` 만 두면 기준 폭이
 * 0 이라 줄바꿈 셈에서 없는 것으로 쳐, 좁은 칸에서 글줄이 0px 로 접히고 손잡이만 남는다.
 */
const STATUS_SUMMARY_CLASS = 'min-w-[6rem] flex-1 truncate text-[12px]';

/**
 * 밀도·추종·(로컬이면) 모델 — 한 묶음으로 움직인다. 줄이 모자라면 이 묶음째 다음 줄로 내려가고,
 * 묶음 자신도 `flex-wrap` 이라 분할 칸(하한 280px)처럼 좁은 자리에서도 밖으로 나가지 않는다.
 */
function StreamControls({ jumpHint = false }: { jumpHint?: boolean }): React.JSX.Element {
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <StreamLocalModelButton />
      <StreamDensityToggle />
      <StreamFollowToggle />
      {jumpHint && (
        <span className="flex-shrink-0 text-[12px] text-gray-600 group-hover:text-gray-300">{'↑'}</span>
      )}
    </div>
  );
}

function StreamStatusBar({ commands, scrollRef, streamRef, onJump, events, sessionRunning }: StreamStatusBarProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  // 우선순위(기본): 실행 중 > 최신 완료/에러. queued 단독은 하단 표시 대상 아님.
  const defaultTarget = useMemo(() => {
    const executing = commands.find((c) => c.status === 'executing');
    if (executing) return executing;
    let latest: QueuedCommand | null = null;
    for (const c of commands) {
      if ((c.status === 'completed' || c.status === 'error') && (!latest || c.timestamp > latest.timestamp)) {
        latest = c;
      }
    }
    return latest;
  }, [commands]);

  // 스크롤 추종 — 사용자가 위로 스크롤해 과거 대화를 보면, 상태바가 "지금 뷰포트 상단에 걸친
  //   커맨드 블록"을 가리키게 한다. 그래서 버튼을 누르면 그때그때 보고 있는 프롬프트로 이동.
  //   바닥 근처(=마지막 대화 추적)면 viewedId=null → 위 defaultTarget(실행중 스피너/최신) 유지.
  const [viewedId, setViewedId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const recompute = (): void => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      if (atBottom) { setViewedId((p) => (p === null ? p : null)); return; }
      const containerTop = container.getBoundingClientRect().top;
      const blocks = Array.from(container.querySelectorAll<HTMLElement>('[data-cmd-id]'));
      let current: string | null = null;
      for (const el of blocks) {
        // 뷰포트 상단(여백 24px 보정)을 지난 마지막 블록 = 사용자가 보고 있는 커맨드.
        if (el.getBoundingClientRect().top - containerTop <= 24) current = el.dataset.cmdId ?? null;
      }
      // 맨 위로 스크롤해 어떤 블록도 상단을 지나지 못했으면 첫 블록을 대상으로.
      if (current === null && blocks[0]) current = blocks[0].dataset.cmdId ?? null;
      setViewedId((p) => (p === current ? p : current));
    };
    recompute();
    container.addEventListener('scroll', recompute, { passive: true });
    return () => container.removeEventListener('scroll', recompute);
  }, [scrollRef, commands]);

  // viewedId(=data-cmd-id, `cmd-${id}`)가 가리키는 커맨드를 우선, 없으면 기본 대상.
  const target = useMemo(() => {
    if (viewedId !== null) {
      const found = commands.find((c) => `cmd-${c.id}` === viewedId);
      if (found) return found;
    }
    return defaultTarget;
  }, [viewedId, commands, defaultTarget]);

  // v1.38 — 첨부 썸네일(basename 으로 조회). v2.93 — blob preview 우선 + server 파일 라우트 폴백.
  //          훅은 조건부 return 위에서 호출(target 없으면 빈 배열).
  const attachmentThumbs = useAttachmentThumbs(target?.attachments);

  // §5.5 #17-12 — 마지막 TodoWrite 기준 "지금 무엇을 하는 중" + 완료/전체. 이벤트가 바뀔 때만 재계산.
  const planProgress = useMemo(() => latestPlanProgress(events), [events]);
  // §5.3 #12-1 — 이 세션이 백단에 띄운 작업 수(훅 대차대조 + 스트림 칩 합산, 서버가 합쳐 보낸다).
  const agentId = useIDEPaneValue((o) => o.agentId);
  const paneSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // §5.5 #17-34 — 창을 나눴으면 **이 칸의** 세션, 안 나눴으면 종전대로 창의 활성 세션.
  const activeSessionId = useSplitCellSession(paneSessionId);
  const bgTaskCount = useGraphStore((s) => {
    const tasks = agentId ? s.runningSubagentTasks[agentId] : undefined;
    if (!tasks) return 0;
    return activeSessionId === null
      ? tasks.length
      : tasks.filter((x) => x.subAgentId === activeSessionId).length;
  });

  const handleJump = useCallback(() => {
    if (!target) return;
    // v3.14 — 점프 전 부모 추종 해제(워치독이 점프 위치를 바닥으로 되끌지 않게).
    onJump?.();
    // 가상 리스트는 뷰포트 밖 항목을 렌더하지 않는다 — DOM 조회만으로는 바닥에서 누를 때 타깃 프롬프트가
    //   미렌더라 el===null → 안 올라간다. virtuoso scrollToIndex(렌더 보장)+정밀 스크롤을 한 핸들이 담당.
    if (streamRef.current) { streamRef.current.scrollToCommand(target.id); return; }
    // 폴백 — 핸들이 아직 없으면(드문 타이밍) 렌더된 항목 한정 DOM 스크롤.
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const el = container.querySelector<HTMLElement>(`[data-cmd-id="cmd-${target.id}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = el.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (targetRect.top - containerRect.top) - 16,
      behavior: 'smooth',
    });
  }, [target, scrollRef, streamRef, onJump]);

  // §5.5 #17-12 — 보여줄 명령이 없어도 **밀도 토글만 있는 얇은 줄**은 남긴다 — 어느 화면에서든 밀도를 바꿀 수 있어야 한다.
  if (!target) {
    return (
      <div className={`${STATUS_ROW_CLASS} py-1`}>
        <StreamControls />
      </div>
    );
  }

  // **되살아난 턴** — 세션은 도는데 이 세션 소유의 `executing` 명령이 없는 상태(봉인 만료 후 재진입).
  //   이때 마지막 완료 명령을 그대로 "완료"로 그리면 화면이 거짓말을 하므로 실행 중 줄로 되돌린다.
  //   단 **사용자가 위로 스크롤해 과거 명령을 보고 있을 때(`target !== defaultTarget`)는 건드리지 않는다** —
  //   그 줄은 "지금"이 아니라 "그때"를 가리키는 자리라, 지나간 명령에 스피너가 돌면 그게 또 거짓이 된다.
  const resumedTurn = sessionRunning
    && target === defaultTarget
    && !commands.some((c) => c.status === 'executing');
  const isExecuting = target.status === 'executing' || resumedTurn;
  const isError = target.status === 'error' && !resumedTurn;
  // §5.5 #17-12 — 실행 중에는 "내가 친 프롬프트" 대신 **에이전트가 지금 하는 단계**를 보여준다(계획이 있을 때).
  //   계획이 없으면 종전대로 프롬프트 앞부분 — 어떤 경우에도 빈 줄이 되지 않게.
  const plan = isExecuting ? planProgress : null;
  // §5.5 #17-12 ③ — 오류로 끝났으면 이 줄이 말할 것은 **내가 친 프롬프트가 아니라 실패 사유**다.
  //   "오류"라는 단어만 놓고 원인을 삼키면 사용자는 무엇이 잘못됐는지 알 길이 없다(사용자 지적).
  //   사유가 없는 옛 명령은 결과 텍스트 → 프롬프트 순으로 폴백해 종전 화면과 같아진다.
  const errorDesc = isError && target.error ? describeCommandError(target.error) : null;
  const errorLine = errorDesc
    ? joinCommandErrorLine(t(errorDesc.labelKey, errorDesc.labelParams), errorDesc.detail)
    : (isError && target.result ? target.result.replace(/\s*\n+\s*/g, ' ') : null);
  // §5.3 #12-1 — 자기 턴은 끝났는데 **백단 자식이 아직 도는** 상태. 이 줄이 그때 내가 친 프롬프트를
  //   되뇌면 "왜 멈춰 있지?"로 읽힌다 — 무엇을 기다리는지(몇 개가 도는지)를 말해야 한다.
  const waitingOnBackground = isExecuting && bgTaskCount > 0 && !commands.some((c) => c.status === 'executing');
  const rawSummary = waitingOnBackground
    ? t('ide.activityBar.runningSubagents', { count: bgTaskCount })
    : plan ? plan.current : (errorLine ?? target.text);
  const preview = rawSummary.length > STATUS_SUMMARY_MAX
    ? `${rawSummary.slice(0, STATUS_SUMMARY_MAX)}…`
    : rawSummary;

  if (isExecuting) {
    // 첨부 썸네일 버튼이 안에 있어 <button> 중첩이 불가 → div[role=button] 으로 점프 처리.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleJump}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJump(); } }}
        title={t('ide.mainArea.scrollPrompt')}
        className={`group cursor-pointer text-left transition-colors hover:bg-gray-800/70 ${STATUS_ROW_CLASS} py-1.5`}
      >
        <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
        <span className="flex-shrink-0 text-[12px] text-blue-300">{t('ide.mainArea.executing')}</span>
        {attachmentThumbs.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            {attachmentThumbs.map((a) => (
              <button
                key={a.basename}
                type="button"
                onClick={(e) => { e.stopPropagation(); openImageLightbox(a.url); }}
                className="h-5 w-5 flex-shrink-0 overflow-hidden rounded border border-gray-700"
              >
                <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
              </button>
            ))}
          </div>
        )}
        <span className={`${STATUS_SUMMARY_CLASS} ${plan ? 'text-gray-200' : 'font-mono text-gray-400 group-hover:text-gray-200'}`}>{preview}</span>
        {/* 계획이 있으면 완료/전체 — "얼마나 남았나"가 중지 판단의 재료가 된다. */}
        {plan && (
          <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-500">
            {t('ide.plan.progress', { done: plan.done, total: plan.total })}
          </span>
        )}
        {/* §5.5 #17-12 ③ v4.64 — 이 줄에는 [중지]를 두지 않는다. 실행 중이면 바로 아래 입력창에 같은 동작의
            [중지]가 뜨므로 버튼이 둘로 보였다("왜 중지가 2개냐"). 중지 창구는 입력창 하나(#17-10). */}
        <StreamControls jumpHint />
      </div>
    );
  }

  // 밀도 토글(버튼)이 안에 들어가므로 바깥은 button 중첩이 불가 → div[role=button] 으로 점프 처리(실행 중 줄과 동형).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleJump}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJump(); } }}
      className={`group cursor-pointer text-left transition-colors hover:bg-gray-800/70 ${STATUS_ROW_CLASS} py-1.5`}
      // §5.5 #17-12 ③ — 한 줄이라 80자에서 잘린다. 잘린 사유 전문은 툴팁이 받는다(잘려서 못 읽는 일 방지).
      title={errorLine ? `${errorLine}

${t('ide.mainArea.scrollPrompt')}` : t('ide.mainArea.scrollPrompt')}
    >
      <span className={`flex flex-shrink-0 items-center ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
        {isError ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </span>
      <span className={`flex-shrink-0 text-[12px] ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
        {isError ? t('ide.mainArea.statusError') : t('ide.mainArea.statusCompleted')}
      </span>
      <span className={`${STATUS_SUMMARY_CLASS} ${
        isError ? 'text-red-200/90 group-hover:text-red-100' : 'text-gray-300 group-hover:text-gray-100'
      }`}>
        {preview}
      </span>
      <StreamControls jumpHint />
    </div>
  );
}

// ─── 우클릭 컨텍스트 메뉴 — §5.5 #17-27 ⑨ v4.97 로 `IDEContextMenu` 공용 컴포넌트로 이사(편집창과 공유). ───

// ─── 메인 영역 ───

// ─── v2.61 첨부 이미지 라이트박스 — 전역 transient state(imageLightbox)를 body 로 portal. ───
//      입력칩 · 실행 상태바 · 대화 스트림의 어떤 썸네일을 클릭해도 여기서 전체화면 확대.
//      §5.5 #17-25 v4.80 — 확대만 하던 자리에 주석 도구를 얹었다(ImageLightboxView). 여기는
//      "store 를 읽어 body 로 portal" 만 하고, 도구·저장 배선은 그 컴포넌트가 갖는다.
function ImageLightboxHost({ agentId, activeSessionId, canAttach }: ImageLightboxHostProps): React.JSX.Element | null {
  const lightbox = useGraphStore((s) => s.imageLightbox);
  const close = useGraphStore((s) => s.closeImageLightbox);
  if (!lightbox) return null;
  return createPortal(
    <ImageLightboxView
      // 이미지가 바뀌면 주석·도구 상태를 새로 시작한다(다음 이미지에 앞 그림이 남아 있으면 안 된다).
      key={lightbox.url}
      state={lightbox}
      agentId={agentId}
      activeSessionId={activeSessionId}
      canAttach={canAttach}
      onClose={close}
    />,
    document.body,
  );
}

interface ImageLightboxHostProps {
  agentId: string;
  activeSessionId: string | null;
  /** 붙일 입력창이 있는가 — 읽기 전용(Hook 에이전트 메인 탭)이면 [내려받기]만 남는다. */
  canAttach: boolean;
}

// IDE 본문 텍스트 줌 배율 사다리 — 크롬 페이지 줌처럼 정해진 단(段)만 밟아, 어디서 확대/축소해도 항상
//   60·67·75·80·90·100·110·125·150·175·200·240% 같은 깔끔한 값에 떨어진다(옛 ×1.1 곱셈 누적은
//   102%·112% 같은 어중간한 값을 만들었다). 범위는 store 클램프(0.6~2.4)와 동일.
const IDE_TEXT_ZOOM_LADDER = [0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.4];
/** 현재 배율에서 사다리 한 단 위/아래 값. 사다리 밖 값(구버전 영속·핀치 잔여)도 다음 단부터 깔끔하게 복귀.
 *  끝단에서 더 가면 현재값 유지(store no-op). */
function stepIdeTextZoomLadder(cur: number, dir: 1 | -1): number {
  if (dir > 0) return IDE_TEXT_ZOOM_LADDER.find((v) => v > cur + 0.001) ?? cur;
  for (let i = IDE_TEXT_ZOOM_LADDER.length - 1; i >= 0; i--) {
    const v = IDE_TEXT_ZOOM_LADDER[i];
    if (v !== undefined && v < cur - 0.001) return v;
  }
  return cur;
}
/** 사다리에서 가장 가까운 단 — 핀치(연속값) 종료 시 스냅용. */
function nearestIdeTextZoomLadder(cur: number): number {
  let best = 1;
  let bestDist = Math.abs(1 - cur);
  for (const v of IDE_TEXT_ZOOM_LADDER) {
    const d = Math.abs(v - cur);
    if (d < bestDist) { best = v; bestDist = d; }
  }
  return best;
}

export const IDEMainArea = memo(function IDEMainArea({
  agentId,
  isCustom,
}: IDEMainAreaProps): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-12 ③ — 실패 사유(코드 + 원문) → 한 줄 문장. 타임라인 조립은 순수 함수라 로케일을 주입한다.
  const formatError = useCallback((error: CommandError): string => {
    const desc = describeCommandError(error);
    return joinCommandErrorLine(t(desc.labelKey, desc.labelParams), desc.detail);
  }, [t]);
  const paneSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // §5.5 #17-34 — 창을 나눴으면 **이 칸의** 세션, 안 나눴으면 종전대로 창의 활성 세션.
  const activeSessionId = useSplitCellSession(paneSessionId);
  // §5.5 #17-34 — 이 본문이 창 단위 단축키(Ctrl+F 검색·Ctrl± 배율)의 임자인가. 분할 중이면 초점 칸만
  //   참이다(칸마다 window 리스너를 달아 두면 한 번 누른 확대가 칸 수만큼 먹는다).
  const cellFocused = useSplitCellFocused();
  // 하단 상태바가 "완료"라고 말할지 "실행 중"이라고 말할지의 근거. 입력창의 [중지] 토글과 **같은 훅**을
  //   써서 두 자리가 어긋나지 않게 한다(종전에는 각자 명령 상태만 따로 봐서 갈라졌다).
  const streamSessionRunning = useSessionRunning(agentId, activeSessionId);
  // §5.5 #17-12 ③ v4.64 — 하단 상태바의 [중지]를 없애면서 여기서 쓰던 useSessionStop 도 함께 제거.
  //   중지 창구는 입력창(TerminalInput)의 [중지] 하나뿐이다(#17-10 범위 규칙 그대로).
  const markSubAcknowledged = useGraphStore((s) => s.markSubAcknowledged);
  // 사용자가 메인 영역(스크롤 영역) 안을 클릭하면 현재 sub 의 완료 알림을 확인 처리(녹색→회색).
  const handleAckClick = useCallback(() => {
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged]);
  const queuedCmds = useGraphStore((s) => s.queuedCommands[agentId] ?? EMPTY_COMMANDS);
  const completedCmds = useGraphStore((s) => s.completedCommands[agentId] ?? EMPTY_COMMANDS);
  // queued/executing + completed/error 를 시간순으로 합친다 — 완료 후에도 프롬프트 이력 유지 (CommandQueue와 동일).
  const commands = useMemo(
    () => [...queuedCmds, ...completedCmds].sort((a, b) => a.timestamp - b.timestamp),
    [queuedCmds, completedCmds],
  );
  const subAgents = useGraphStore((s) => s.subAgents[agentId] ?? EMPTY_SUBS);
  const agentEvents = useGraphStore((s) => s.agentEvents[agentId] ?? EMPTY_EVENTS);
  // 스트림: 선택된 세션의 이벤트 배열만 구독 (참조 안정 — 해당 세션 이벤트만 변경 시 리렌더)
  const activeStreamEvents = useGraphStore((s) =>
    activeSessionId !== null
      ? (s.subAgentStreams[activeSessionId] ?? EMPTY_STREAM_EVENTS)
      : EMPTY_STREAM_EVENTS,
  );
  // §5.5 v3.72 — 메인 탭(activeSessionId===null) 전용 스트림 갱신 신호.
  //   종전엔 메인 탭이 스트림을 **직접 구독하지 않고** `subAgents` 배열의 참조가 매 스냅샷마다
  //   새로 만들어지는 것에 얹혀 갱신됐다. loadSnapshot 에 구조적 공유가 들어가 그 참조가 안정되면
  //   그 우연한 신호가 끊겨 메인 탭에 출력이 안 흐른다 → 실제 데이터 의존성을 명시한다.
  //   이벤트 **개수 합**(원시 number)이라 내용이 안 늘면 리렌더를 유발하지 않는다.
  const mainStreamVersion = useGraphStore((s) => {
    if (activeSessionId !== null) return 0;
    let total = 0;
    for (const sub of s.subAgents[agentId] ?? EMPTY_SUBS) {
      total += s.subAgentStreams[sub.id]?.length ?? 0;
    }
    return total;
  });
  // v2.99 — scrollRef/scrollEl 은 이제 virtuoso 가 단독 소유한 **내부 스크롤러 DOM**(옛 외부 overflow
  //   컨테이너 대체). Sub 탭=StreamRenderer onScrollerRef, 메인 탭=메인 Virtuoso scrollerRef 가 이 콜백으로
  //   같은 노드를 올린다. StreamStatusBar·북마크 이동·Select All 이 이 컨테이너 한정으로 작동한다.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollNode = useCallback((node: HTMLElement | Window | null) => {
    const el = node instanceof HTMLElement ? (node as HTMLDivElement) : null;
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  // IDE 본문 텍스트 줌 — Ctrl+휠로 스트림/대화 글자 배율 조절(캔버스·창 UI 와 무관). 배율은 각 항목 래퍼에
  //   zoom 으로 적용(StreamRenderer renderStreamItem / 아래 메인 타임라인 itemContent). 스크롤러는 그대로 둬
  //   가상화 측정과 충돌하지 않게 한다. 본문 출력 영역에 native 비-passive wheel 리스너(capture)를 달아
  //   preventDefault + stopPropagation 으로 가로채고(스크롤·markUpIntent 미발화), 부호로 확대/축소한다.
  const ideTextZoom = useGraphStore((s) => s.ideTextZoom);
  // §5.5 #17-12 — 메인 탭도 같은 표시 밀도를 따른다(계획 접기·동종 도구 합치기).
  const density = useGraphStore((s) => s.ideStreamDensity);
  const setIdeTextZoom = useGraphStore((s) => s.setIdeTextZoom);
  const ideBodyRef = useRef<HTMLDivElement | null>(null);
  // 배율 배지 표시 상태 — 배율이 "바뀐 직후"에만 잠깐 떠 있다가 스르륵 사라진다(계속 떠 있으면 잡음).
  //   prevZoomRef 를 현재값으로 초기화해 localStorage 영속 배율로 부팅해도 첫 렌더엔 배지가 안 뜬다.
  //   연속 줌(휠 연타/핀치) 중엔 타이머가 계속 리셋돼 떠 있고, 손을 떼면 1.5s 뒤 페이드아웃.
  const [zoomBadgeVisible, setZoomBadgeVisible] = useState(false);
  const zoomBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(ideTextZoom);
  useEffect(() => {
    if (prevZoomRef.current === ideTextZoom) return;
    prevZoomRef.current = ideTextZoom;
    setZoomBadgeVisible(true);
    if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    zoomBadgeTimerRef.current = setTimeout(() => setZoomBadgeVisible(false), 1500);
  }, [ideTextZoom]);
  useEffect(() => () => {
    if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
  }, []);
  // 배지에 마우스를 올리면 페이드아웃 보류(초기화 버튼을 누르러 가는 도중 사라지지 않게), 떠나면 재개.
  const holdZoomBadge = useCallback((): void => {
    if (zoomBadgeTimerRef.current) {
      clearTimeout(zoomBadgeTimerRef.current);
      zoomBadgeTimerRef.current = null;
    }
  }, []);
  const releaseZoomBadge = useCallback((): void => {
    if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    zoomBadgeTimerRef.current = setTimeout(() => setZoomBadgeVisible(false), 1500);
  }, []);
  useEffect(() => {
    const el = ideBodyRef.current;
    if (!el) return;
    const onWheelZoom = (e: WheelEvent): void => {
      if (!e.ctrlKey) return; // 줌 제스처만 가로챔 — 일반 스크롤은 그대로 통과.
      e.preventDefault();
      e.stopPropagation();
      const cur = useGraphStore.getState().ideTextZoom;
      setIdeTextZoom(stepIdeTextZoomLadder(cur, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheelZoom, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheelZoom, { capture: true });
  }, [setIdeTextZoom]);
  // §4 v3.24 — 두 손가락 핀치 = 본문 텍스트 줌(모바일 웹, Ctrl+휠의 터치 짝). 같은 store 경로
  //   (setIdeTextZoom, 0.6~2.4 클램프)라 배율 표시·localStorage 영속·다중 창 동기화가 그대로 붙는다.
  //   두 터치 거리비를 핀치 시작 시점 배율에 곱하고, 핀치 중 touchmove 는 preventDefault(스크롤 정지)
  //   + stopPropagation(capture — 스크롤러의 위로-제스처 추종 해제 판정 미발화)으로 가로챈다.
  useEffect(() => {
    const el = ideBodyRef.current;
    if (!el) return;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinching = false;
    const touchDist = (touches: TouchList): number => {
      const a = touches[0];
      const b = touches[1];
      if (!a || !b) return 0;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return;
      pinching = true;
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = useGraphStore.getState().ideTextZoom;
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const d = touchDist(e.touches);
      if (pinchStartDist <= 0 || d <= 0) return;
      const next = pinchStartZoom * (d / pinchStartDist);
      // 미세 변동은 스킵 — 매 touchmove 마다 전 항목 재측정 + localStorage 기록을 하지 않게.
      if (Math.abs(next - useGraphStore.getState().ideTextZoom) < 0.01) return;
      setIdeTextZoom(next);
    };
    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2 && pinching) {
        pinching = false;
        // 제스처 중엔 연속값이지만 손을 떼면 크롬 줌처럼 가장 가까운 사다리 단으로 스냅해 %를 깔끔하게.
        setIdeTextZoom(nearestIdeTextZoomLadder(useGraphStore.getState().ideTextZoom));
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
      el.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [setIdeTextZoom]);
  // "맨 아래로" 점프 버튼 노출 여부 — 사용자가 위로 스크롤해 바닥에서 멀어졌을 때만 뜬다(onScroll 이 갱신).
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  // 본문 텍스트 줌 키보드 — Ctrl/Cmd + '='(또는 '+'/NumpadAdd)=확대, Ctrl+'-'(또는 '_'/NumpadSubtract)=축소,
  //   Ctrl+'0'(또는 Numpad0)=100% 리셋. VS Code·브라우저 관례. IDE 오버레이가 떠 있는 동안(이 컴포넌트 마운트)
  //   window 레벨에서 받아, 휠 줌(위)의 키보드 짝을 이룬다. native 기본 줌은 없지만 안전하게 preventDefault.
  useEffect(() => {
    if (!cellFocused) return; // §5.5 #17-34 — 분할 중에는 초점 칸 하나만 이 키를 받는다.
    const onKeyZoom = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key;
      const cur = useGraphStore.getState().ideTextZoom;
      if (k === '=' || k === '+' || e.code === 'NumpadAdd') { e.preventDefault(); setIdeTextZoom(stepIdeTextZoomLadder(cur, 1)); }
      else if (k === '-' || k === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); setIdeTextZoom(stepIdeTextZoomLadder(cur, -1)); }
      else if (k === '0' || e.code === 'Numpad0') { e.preventDefault(); setIdeTextZoom(1); }
    };
    window.addEventListener('keydown', onKeyZoom);
    return () => window.removeEventListener('keydown', onKeyZoom);
  }, [setIdeTextZoom, cellFocused]);
  // v3.05 — 바닥 추종의 SSOT 를 "스크롤 의도"(followRef)로 바꾼다. 옛 코드는 virtuoso 의
  //   atBottomStateChange 가 주는 순간 바닥 여부(atBottomRef)로 추종을 판정했는데, 새 메시지/블록이
  //   스트리밍돼 본문이 뷰포트 아래로 자라면 바닥과의 거리가 40px 임계를 넘겨 라이브러리가 곧장
  //   atBottom=false 를 쏘고, 그 false 때문에 추종 effect 가 즉시 빠져나가 다시 바닥으로 붙지 못했다
  //   → 새 답변에 포커싱은커녕 화면이 "스스로 위로 올라가" 보였다. 핵심 통찰: **콘텐츠가 자라기만 하면
  //   scroll 이벤트는 안 난다(높이만 변하고 scrollTop 은 그대로)** → followRef 는 scroll 이벤트에서만
  //   갱신하므로 콘텐츠 성장으로는 절대 꺼지지 않고, **사용자가 직접 위로 올릴 때만**(scroll 이벤트 +
  //   바닥에서 멂) 꺼진다. 다시 바닥으로 내리면(scroll 이벤트 + 바닥 근접) 자동 재무장. = 사용자가 말한
  //   3상태 그대로: ①안 건들면 자동추종 ②위로 올리면 그 자리 고정 ③다시 내리면 자동추종 재개.
  // v2.99 — 활성 세션(탭) key. 메인 탭은 '__main__'. 세션별 스냅샷/추종상태 맵의 공통 키.
  const sessionKey = activeSessionId ?? '__main__';
  // 추종 의도(SSOT) — 스크롤 핸들러가 갱신. 추종 effect / 자기메시지 점프가 이 값을 본다.
  const followRef = useRef(true);
  // 세션별 "추종 중이었나" — 추종 세션은 복귀 시 (옛 위치가 아니라) **새 바닥**으로 가야 하므로
  //   restoreStateFrom 대신 initialTopMostItemIndex=LAST 를 쓴다. 스크롤 핸들러가 현재 세션 키로 기록.
  const sessionAtBottomRef = useRef<Map<string, boolean>>(new Map());
  // §5.5 #17-16 ③ — 펼침 클릭 직후의 앵커 유지 구간(ms 시각). 이 동안은 라이브러리가 "바닥"이라고 알려도
  //   추종을 재무장하지 않는다 — 재무장하면 워치독이 매 프레임 바닥으로 끌어 앵커와 싸운다.
  const expandHoldUntilRef = useRef(0);
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    // 라이브러리가 "바닥에 닿았다"고 알릴 때만 추종을 켠다(확실히 바닥). false 는 콘텐츠가 자라며 바닥이
    //   멀어진 일시 상태일 수 있어 추종을 끄지 않는다 — 끄는 건 사용자 스크롤-업만(아래 scroll 핸들러).
    if (performance.now() < expandHoldUntilRef.current) return;
    if (atBottom) { followRef.current = true; sessionAtBottomRef.current.set(sessionKey, true); setShowJumpBottom(false); }
  }, [sessionKey]);
  // v3.14 — 바닥 붙이기의 **유일한 집행 프리미티브**: virtuoso 측정 모델 좌표(scrollToIndex LAST)가 아니라
  //   **실제 DOM**(scrollHeight-clientHeight)으로 붙인다. 모델이 DOM 과 어긋난 순간(측정 지연·추정 오차·절단
  //   등 원인 불문) 모델 좌표 집행은 "모델이 생각하는 바닥"=실제보다 위로 스크롤을 역주행시켰다(thinking 중
  //   "내리는 순간 위로 올려버림"의 구조적 원인). DOM 좌표 쓰기는 최댓값으로의 idempotent 이동이라 위로
  //   역주행이 물리적으로 불가능하고, 쓰기 후 virtuoso 는 scroll 이벤트를 받아 그 위치의 창을 그린다.
  const glueToBottomDom = useCallback((): void => {
    const el = scrollEl;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < target - 0.5) el.scrollTop = target;
  }, [scrollEl]);
  // v2.99 — 세션(탭)별 virtuoso 상태 스냅샷(측정된 항목 높이 + 스크롤 위치). 스크롤 중 throttled 로 갱신 저장,
  //   복귀 때 restoreStateFrom 으로 복원 → 재측정 출렁임 없이 보던 위치로 즉시 정착(옛 rAF 정착 루프 + 덮개,
  //   세션별 {top,atBottom} 맵, 복원 중 저장 금지 플래그를 모두 대체).
  const sessionSnapshotsRef = useRef<Map<string, StateSnapshot>>(new Map());
  // v2.99 — 세션 복원 스냅샷 결정: 떠날 때 바닥이었으면(또는 첫 진입) undefined → 자식이 새 바닥(LAST)에서
  //   시작, 아니면(위로 올려둔 세션) 저장 스냅샷으로 그 위치 복원.
  const restoreStateFor = useCallback((key: string): StateSnapshot | undefined => {
    if (sessionAtBottomRef.current.get(key) ?? true) return undefined;
    return sessionSnapshotsRef.current.get(key);
  }, []);
  // 북마크 이동 nonce — 막 전환된 세션이 북마크 점프인지 식별해 스크롤 복원을 양보(중복 스크롤 충돌 방지).
  const handledBookmarkNonceRef = useRef<number>(-1);

  // §5.5 #17 / #17-29 — 훅 버블은 **어느 탭에서도** read-only. 종전엔 `activeSessionId === null`(메인 탭)
  //   조건이 붙어 있어 훅 버블의 세션 탭 위에서는 입력창이 열렸고, 그렇게 보낸 명령은 우리가 spawn 하지
  //   않은 부모에 자식을 매달았다(스폰 주입·완료 신고 경로가 통째로 없는 세션). 커스텀만 interactive.
  const isReadOnly = !isCustom;

  // §4 v2.63 — CMD(interactive-terminal) 에이전트는 **모든 탭**이 임베디드 PTY 터미널.
  // 탭(세션)마다 독립 termId → "+"=새 cmd 터미널, IDE 닫았다 열어도 reattach 로 보존.
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const showInteractiveTerminal = isCustom && executionMode === 'interactive-terminal';

  // §5.5 #17-3 v2.31 — 우클릭 컨텍스트 메뉴. anchorId = 선택 출처 항목(§17-7 북마크 이동용).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; selection: string; anchorId?: string } | null>(null);
  // §5.5 #17-36 — 우클릭 메뉴가 찍은 스티키 메모 생성 지점(화면 좌표). 판(SessionMemoLayer)이 소비하고 비운다.
  const [memoSpawn, setMemoSpawn] = useState<{ x: number; y: number } | null>(null);
  // 이 화면(세션 탭 또는 메인 탭)에 붙은 메모 장수 — 상한에 닿으면 메뉴 항목을 흐린다.
  const memoCount = useGraphStore((s) => (
    activeSessionId
      ? (s.subAgents[agentId]?.find((x) => x.id === activeSessionId)?.memos?.length ?? 0)
      : (s.agentMemos[agentId]?.length ?? 0)
  ));
  // §5.5 #17-36 ⑨ — 이 화면에 **이름이 가려진** 메모가 있나. 불린 하나만 돌려주므로 스냅샷마다
  //   새 참조가 나오지 않는다(배열을 그대로 돌려주면 매 스냅샷이 리렌더가 된다 — 스토어 규약).
  const memoHeadersHidden = useGraphStore((s) => hasHiddenMemoHeaders(
    (activeSessionId
      ? s.subAgents[agentId]?.find((x) => x.id === activeSessionId)?.memos
      : s.agentMemos[agentId]) ?? [],
  ));
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  const addCommand = useGraphStore((s) => s.addCommand);

  // OS 파일 드래그앤드롭 — 출력 영역/입력창 어디에 떨궈도 그 파일들의 절대경로를 활성 세션 입력에
  //   덧붙인다(에이전트가 Read 로 읽도록). 다른 IDE 처럼 드래그 중 오버레이 힌트 표시.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  // 입력 textarea(data-ide-input) 를 찾아 focus + caret 끝 + 자동높이 복원 (quote-reply 와 동일 셀렉터).
  const focusInputEnd = useCallback(() => {
    const sessionAttr = activeSessionId ?? '';
    const ta = document.querySelector<HTMLTextAreaElement>(
      `textarea[data-ide-input="${agentId}"][data-ide-input-session="${sessionAttr}"]`,
    );
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autosizeInput(ta);
  }, [agentId, activeSessionId]);

  const insertDroppedPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const key = agentSessionInputKey(agentId, activeSessionId);
    const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
    // 경로에 공백이 있어도 에이전트가 인식하도록 따옴표로 감싼다(공백 없으면 원문 그대로).
    const joined = paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
    const next = existing.trim().length > 0 ? `${existing.replace(/\s*$/, '')} ${joined} ` : `${joined} `;
    setAgentSessionInputText(agentId, activeSessionId, next);
    requestAnimationFrame(focusInputEnd);
  }, [agentId, activeSessionId, setAgentSessionInputText, focusInputEnd]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isReadOnly || !dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, [isReadOnly]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isReadOnly || !dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, [isReadOnly]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (isReadOnly || !dragHasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, [isReadOnly]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    dragDepth.current = 0;
    setDragActive(false);
    if (isReadOnly || !dragHasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    const paths = files.map(resolveDroppedFilePath).filter((p) => p.length > 0);
    insertDroppedPaths(paths);
  }, [isReadOnly, insertDroppedPaths]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // textarea 위 우클릭은 가로채지 ❌ (브라우저 기본 Paste/Cut/Spell-check 보존).
    const tgt = e.target as HTMLElement;
    if (tgt.closest('textarea, input, [contenteditable="true"]')) return;
    const sel = (window.getSelection()?.toString() ?? '').trim();
    // 선택이 시작된 출처 항목 id 를 지금(선택 살아있을 때) 캡처 — 메뉴 클릭 후엔 선택이 풀릴 수 있다.
    const anchorId = resolveAnchorIdFromSelection();
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, selection: sel, anchorId });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const clearMemoSpawn = useCallback(() => setMemoSpawn(null), []);
  // §5.5 #17-36 ⑨ — [겹친 메모 펼치기] 요청 신호. 값이 바뀌면 판(SessionMemoLayer)이 1회 수행한다.
  const [memoSpread, setMemoSpread] = useState<number | null>(null);
  const clearMemoSpread = useCallback(() => setMemoSpread(null), []);

  const ctxItems = useMemo<ContextMenuItem[]>(() => {
    const sel = ctxMenu?.selection ?? '';
    const hasSel = sel.length > 0;
    const selectionRequired = t('ide.mainArea.ctxSelectionRequired');
    return [
      {
        label: t('ide.mainArea.ctxCopy'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(sel).catch(() => {});
          }
        },
      },
      {
        // §5.5 #17-3 (판올림 번호 발급 대기) — 고른 글자를 기본 브라우저에서 검색.
        //   창을 여는 길은 이미 있는 것 하나(window.open → Electron main 의 shell.openExternal).
        label: t('ide.mainArea.ctxSearchWeb'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => { openWebSearch(sel); },
      },
      {
        label: t('ide.mainArea.ctxBookmark'),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => {
          if (!sel) return;
          const st = useGraphStore.getState();
          const agentLabel = st.nodeMap[agentId]?.label ?? agentId;
          const projectId = st.agentProjects[agentId] ?? null;
          st.addBookmark({ text: sel, agentId, sessionId: activeSessionId, projectId, agentLabel, anchorId: ctxMenu?.anchorId });
        },
      },
      {
        label: t('ide.mainArea.ctxSaveToBrain', { defaultValue: '메모리에 기억' }),
        disabled: !hasSel,
        disabledTitle: selectionRequired,
        onClick: () => {
          if (!sel) return;
          void useGraphStore.getState().saveBrainCardFromText(sel, agentId, activeSessionId);
        },
      },
      {
        label: t('ide.mainArea.ctxQuoteReply'),
        disabled: !hasSel || isReadOnly,
        disabledTitle: !hasSel ? selectionRequired : undefined,
        onClick: () => {
          const quoted = sel.split('\n').map((line) => `> ${line}`).join('\n');
          const key = agentSessionInputKey(agentId, activeSessionId);
          const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
          const next = existing.length > 0 ? `${quoted}\n${existing}` : `${quoted}\n`;
          setAgentSessionInputText(agentId, activeSessionId, next);
          // textarea 자동 focus + cursor end + 자동높이 — data-ide-input 셀렉터로 매칭.
          requestAnimationFrame(() => {
            const sessionAttr = activeSessionId ?? '';
            const ta = document.querySelector<HTMLTextAreaElement>(
              `textarea[data-ide-input="${agentId}"][data-ide-input-session="${sessionAttr}"]`,
            );
            if (!ta) return;
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
            autosizeInput(ta);
          });
        },
      },
      {
        label: t('ide.mainArea.ctxSendAsPrompt'),
        disabled: !hasSel || isReadOnly,
        disabledTitle: !hasSel ? selectionRequired : undefined,
        onClick: () => {
          addCommand(agentId, sel, activeSessionId, []);
        },
      },
      {
        label: t('ide.mainArea.ctxSelectAll'),
        onClick: () => {
          const el = scrollRef.current;
          if (!el) return;
          const range = document.createRange();
          range.selectNodeContents(el);
          const selObj = window.getSelection();
          if (selObj) {
            selObj.removeAllRanges();
            selObj.addRange(range);
          }
        },
      },
      {
        // §5.5 #17-36 — 누른 그 자리에 스티키 메모 한 장. 고른 글자가 없어도 되는 유일한 항목이라
        //   구분선으로 위 묶음(선택 텍스트를 다루는 것들)과 가른다.
        id: 'add-memo',
        label: t('ide.mainArea.ctxAddMemo'),
        separatorBefore: true,
        disabled: !canAddMemoCount(memoCount),
        disabledTitle: t('ide.memo.limitReached', { max: SESSION_MEMO.MAX_PER_OWNER }),
        onClick: () => {
          if (!ctxMenu) return;
          setMemoSpawn({ x: ctxMenu.x, y: ctxMenu.y });
        },
      },
      // §5.5 #17-36 ⑨ — 겹쳐 둔 것을 떼어 놓는다. 두 장 미만이면 겹칠 자리가 없으므로 항목 자체를
      //   내지 않고, 두 장 이상인데 안 겹쳤으면 **이유를 달아 흐린다**(있다가 없어지는 항목 ❌).
      ...(memoCount >= 2 ? [{
        id: 'spread-memos',
        label: t('ide.mainArea.ctxSpreadMemos'),
        disabled: !memoHeadersHidden,
        disabledTitle: t('ide.mainArea.ctxSpreadMemosNone'),
        onClick: () => { setMemoSpread(Date.now()); },
      }] : []),
    ];
  }, [ctxMenu, isReadOnly, t, agentId, activeSessionId, setAgentSessionInputText, addCommand, memoCount, memoHeadersHidden]);

  // 스트림 데이터 조립: 서브 탭이면 해당 스트림만, 메인이면 전체
  const streams = useMemo<Record<string, SubAgentStreamEvent[]>>(() => {
    if (activeSessionId !== null) {
      return activeStreamEvents.length > 0 ? { [activeSessionId]: activeStreamEvents } : {};
    }
    // 메인 뷰: 스토어에서 현재 스냅샷 직접 읽기 (리렌더 유발 없이 최신 데이터)
    const all = useGraphStore.getState().subAgentStreams;
    const result: Record<string, SubAgentStreamEvent[]> = {};
    for (const sub of subAgents) {
      const arr = all[sub.id];
      if (arr && arr.length > 0) result[sub.id] = arr;
    }
    return result;
    // mainStreamVersion — 메인 탭에서 스트림이 실제로 늘었을 때만 재조립(위 주석 참조).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeStreamEvents, subAgents, mainStreamVersion]);

  const items = useMemo(() => {
    // [perf-snapshot] 계측 — 콘솔에서 `__VIBI_PERF__ = true`. 메인 탭(activeSessionId===null)은 증분 파서가
    // 없어 매 스냅샷마다 전 세션 이벤트를 재파싱·정렬한다. 이 비용이 스냅샷 비용과 겹치는지 확인.
    const _PERF = !!(globalThis as unknown as { __VIBI_PERF__?: boolean }).__VIBI_PERF__;
    const _t0 = _PERF ? performance.now() : 0;
    const flat = buildEntries(commands, subAgents, streams, activeSessionId, agentEvents, formatError);
    const agentBusy = commands.some((c) => c.status === 'executing' || c.status === 'queued');
    const grouped = applyMainDensity(groupEntries(flat), density);
    if (_PERF && activeSessionId === null) {
      const _t1 = performance.now();
      let _n = 0;
      for (const _a of Object.values(streams)) _n += _a.length;
      // eslint-disable-next-line no-console
      console.warn(
        `[perf-snapshot] mainTab buildEntries+group=${(_t1 - _t0).toFixed(1)}ms events=${_n} subs=${subAgents.length}`,
      );
    }

    // §5.5 #17-24 ② — 라이브 1줄은 **에이전트가 작동하는 동안 항상** 뜬다(Sub 탭 computeThinkingLive 와 동형).
    //   가장 최근 이벤트는 켜고 끄는 스위치가 아니라 라벨을 고르는 값 — 사고 이벤트면 `생각 중`, 그 외는 `작업 중`.
    if (agentBusy) {
      // v3.72 — 종전엔 "가장 최근 이벤트" 를 찾으려고 **전 세션 이벤트를 매번 완주**했다(O(전체)).
      //   스트림 배열은 도착 순서대로 append 되므로 각 배열의 **마지막 원소**만 보면 된다(O(세션 수)).
      //   세션이 길어질수록 커지던 비용이 사라진다.
      let latest: SubAgentStreamEvent | null = null;
      for (const evts of Object.values(streams)) {
        const tail = evts[evts.length - 1];
        if (tail && (!latest || tail.timestamp > latest.timestamp)) latest = tail;
      }
      const mode = latest && isThinkingActivity(latest) ? 'thinking' : 'working';
      grouped.push({ kind: 'thinking-live', id: 'thinking-live', mode, timestamp: latest?.timestamp ?? Date.now() });
    }
    return grouped;
  }, [commands, subAgents, streams, activeSessionId, agentEvents, density, formatError]);

  // §5.3 #12-2 v2.26 — 이 에이전트 (+ 활성 세션) 의 AskUserQuestion 카드 목록.
  // 메인 탭(activeSessionId === null): 이 에이전트의 모든 sub 질문을 시간순.
  // sub 탭: 그 sub 의 질문만.
  const pendingAskQuestions = useGraphStore((s) => s.pendingAskQuestions);
  const askCards = useMemo(() => {
    const matches = Object.values(pendingAskQuestions).filter((r) => {
      if (r.agentId !== agentId) return false;
      // sub 탭: 그 세션(subAgentId)의 질문만. 메인 탭: 이 에이전트의 **모든** 질문(작업 신고 카드와 동일).
      //   메인 탭에서 subIdSet 멤버십으로 거르던 옛 로직은, 막 스폰돼 아직 subAgents 스냅샷에 안 들어온
      //   세션의 AskUserQuestion 을 조용히 누락시켜 사용자가 못 보고 60s 타임아웃되던 버그의 직접 원인.
      //   r.agentId === agentId 로 이미 소속이 보장되므로 메인 탭에선 무조건 노출한다(§5.3 #12-2).
      return activeSessionId !== null ? r.subAgentId === activeSessionId : true;
    });
    return matches.sort((a, b) => a.createdAt - b.createdAt);
  }, [pendingAskQuestions, agentId, activeSessionId]);

  // §4 v2.52 — 이 에이전트의 작업 신고 카드. agentReports 는 agentId 1차 키.
  // 메인 탭(activeSessionId === null): 이 에이전트의 모든 신고. sub 탭: 그 세션(subAgentId) 신고만.
  const agentReportsForAgent = useGraphStore((s) => s.agentReports[agentId] ?? EMPTY_REPORTS);
  const reportCards = useMemo(() => {
    const matches = agentReportsForAgent.filter((r) =>
      activeSessionId !== null ? r.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentReportsForAgent, activeSessionId]);

  // §4 v2.60 — 이 에이전트의 질문 카드. reportCards 와 동일 필터/정렬.
  const agentQuestionsForAgent = useGraphStore((s) => s.agentQuestions[agentId] ?? EMPTY_QUESTIONS);
  const questionCards = useMemo(() => {
    const matches = agentQuestionsForAgent.filter((q) =>
      activeSessionId !== null ? q.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentQuestionsForAgent, activeSessionId]);

  // §4 v2.70 — 이 에이전트의 검수 요청 카드. reportCards/questionCards 와 동일 필터/정렬.
  const agentReviewsForAgent = useGraphStore((s) => s.agentReviews[agentId] ?? EMPTY_REVIEWS);
  const reviewCards = useMemo(() => {
    const matches = agentReviewsForAgent.filter((r) =>
      activeSessionId !== null ? r.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentReviewsForAgent, activeSessionId]);

  // §4 v2.84 — 이 에이전트의 번호 목록 정렬 카드. reviewCards 와 동일 필터/정렬.
  const agentListsForAgent = useGraphStore((s) => s.agentLists[agentId] ?? EMPTY_LISTS);
  const listCards = useMemo(() => {
    const matches = agentListsForAgent.filter((l) =>
      activeSessionId !== null ? l.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentListsForAgent, activeSessionId]);

  // §5.5 — "놓친 카드" pill 후보(신고/질문/검수/목록). createdAt 오름차순. 새 카드 생성·소멸 때만 정체성 변경.
  //   AskUserQuestion(ask)은 이미 강조 카드(60초 동기 hold)라 제외.
  const unseenCandidateCards = useMemo<UnseenCardMeta[]>(() => {
    const all: UnseenCardMeta[] = [
      ...reportCards.map((r) => ({ id: r.id, kind: 'report' as const, createdAt: r.createdAt })),
      ...questionCards.map((q) => ({ id: q.id, kind: 'question' as const, createdAt: q.createdAt })),
      ...reviewCards.map((r) => ({ id: r.id, kind: 'review' as const, createdAt: r.createdAt })),
      ...listCards.map((l) => ({ id: l.id, kind: 'list' as const, createdAt: l.createdAt })),
    ];
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }, [reportCards, questionCards, reviewCards, listCards]);

  // §4 v2.53/v2.57 · §5.5 #17-18 ⑦-1 — 메인 탭: 터미널 항목 + 카드를 합쳐 정렬. 카드는 **신고된 그 시각**
  //   (`createdAt`)에 못 박히고, 그 뒤 출력은 전부 카드 아래로 쌓인다 — StreamRenderer 와 동일 규칙.
  //   옛 "그 턴 끝으로 미루기"(`turnEndSortTs`)는 도는 턴에 뒤에 올 명령이 없어 카드를 화면 바닥에
  //   붙박아 두었고, 그 탓에 "안 끝났는데 카드부터 나와 끝난 줄 착각"·"언제 나온 카드인지 모름"이 됐다.
  const mainTimeline = useMemo(() => {
    // §5.5 #17-18 ⑥-3 — 턴 경계는 **이미 나간 명령**의 dispatch 시각이다. 대기 중 덧말은 아직
    //   아무것도 끊지 않았으므로 경계에서 뺀다. Ask 의 "맨 끝" 폴백은 대기 말풍선(꼬리)보다 **위**여야 한다.
    //   ⑥-5 — "나갔는가" 판정은 `hasDispatched` 한 곳(Sub 탭과 같은 함수). 앱이 내려가 재개 대기로
    //   큐에 돌아간 명령은 이미 한 번 턴을 끊었으므로 경계에 남는다.
    const cmdTsAsc = commands
      .filter(hasDispatched)
      .map((c) => commandAnchorTs(c))
      .sort((a, b) => a - b);
    // §5.3 #12-2 — 답을 기다리는 AskUserQuestion 만 종전대로 그 턴 끝(없으면 꼬리)에 둔다(60초 안에 답해야
    //   하는 요청이라 눈앞에서 밀려 올라가면 안 된다). 지나간 보고인 카드류는 ⑦-1 로 제자리 고정.
    const pendingAskSortTs = (createdAt: number): number => {
      for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
      return PENDING_COMMAND_TS - 1;
    };
    // §5.5 #17-18 ⑦-3 — 턴 식별은 정렬과 분리: dispatch 경계를 몇 개 지났는가가 곧 턴 번호다.
    const turnIndexOf = (createdAt: number): number => {
      let n = 0;
      for (const ts of cmdTsAsc) { if (ts <= createdAt) n += 1; else break; }
      return n;
    };
    // §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중인가(뒤에 나간 명령이 없고 지금 실행 중).
    const lastAnchor = cmdTsAsc[cmdTsAsc.length - 1];
    const turnRunning = commands.some((c) => c.status === 'executing');
    const isLive = (createdAt: number): boolean =>
      turnRunning && !(lastAnchor !== undefined && lastAnchor > createdAt);
    // §5.5 #17-12 — 같은 턴의 검수는 그 턴 신고 카드로 흡수해 한 장으로 보여준다.
    //   짝 없는 검수만 독립 카드로 남는다(StreamRenderer 의 mergeCardsIntoItems 와 동일 규칙).
    const reportNodes: Array<{ ts: number; node: MainTimelineNode }> = [];
    const reportNodeByTurn = new Map<number, { node: MainTimelineNode }>();
    for (const r of reportCards) {
      const entry = {
        ts: r.createdAt,
        node: { t: 'report' as const, report: r, live: isLive(r.createdAt) } as MainTimelineNode,
      };
      reportNodes.push(entry);
      reportNodeByTurn.set(turnIndexOf(r.createdAt), entry);
    }
    const reviewNodes: Array<{ ts: number; node: MainTimelineNode }> = [];
    for (const rv of reviewCards) {
      const host = reportNodeByTurn.get(turnIndexOf(rv.createdAt));
      if (host && host.node.t === 'report' && !host.node.review) {
        host.node = { ...host.node, review: rv };
        continue;
      }
      reviewNodes.push({ ts: rv.createdAt, node: { t: 'review' as const, review: rv, live: isLive(rv.createdAt) } });
    }
    const merged: Array<{ ts: number; node: MainTimelineNode }> = [
      ...items.map((item) => ({ ts: item.timestamp, node: { t: 'item' as const, item } })),
      ...reportNodes,
      ...questionCards.map((q) => ({ ts: q.createdAt, node: { t: 'question' as const, questions: q, live: isLive(q.createdAt) } })),
      ...reviewNodes,
      ...listCards.map((l) => ({ ts: l.createdAt, node: { t: 'list' as const, list: l, live: isLive(l.createdAt) } })),
      // §5.3 #12-2 — pending AskUserQuestion 카드도 타임라인 안으로(가상 리스트 밖 형제 렌더 → 겹침 제거).
      ...askCards.map((req) => ({ ts: pendingAskSortTs(req.createdAt), node: { t: 'ask' as const, request: req } })),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    // §5.5 #17-18 ⑦-5 — 카드 바로 뒤에 붙는 "~카드로 보냈습니다" 한 줄은 화면에서 뺀다(카드가 이미 하는 말).
    //   정렬 **뒤**에 걷는다: "바로 앞이 카드"라는 자리 조건은 시간순으로 놓인 뒤에야 성립한다.
    return dropCardEchoNodes(merged.map((m) => m.node));
  }, [items, reportCards, questionCards, reviewCards, listCards, askCards, commands]);

  // v3.13 — 스트림 버퍼 앞쪽 절단(상한 초과 시 오래된 이벤트 일괄 제거)을 메인 Virtuoso 에도 shift 로 신고.
  //   인덱스 기반 sizeTree 가 절단마다 밀려 측정 모델이 붕괴 → 긴 세션에서 스크롤이 "위로 말려 올라가던" 원인.
  //   §5.5 #17-12 — 밀도를 리셋 키로 함께(전환 시 항목 id 가 통째로 갈리는 걸 절단으로 오인 방지).
  const mainFirstItemIndex = useVirtuosoFrontShift(mainTimeline, mainTimelineNodeId, density);

  // §5.5 #17-21 ② — 간결에서 유일하게 자르지 않는 본문 = 타임라인의 **마지막 AI 텍스트**(지금 하는 말 = 결론).
  const mainLastTextId = useMemo(() => {
    for (let k = mainTimeline.length - 1; k >= 0; k--) {
      const n = mainTimeline[k]!;
      if (n.t === 'item' && n.item.kind === undefined && n.item.type === 'text') return mainTimelineNodeId(n);
    }
    return null;
  }, [mainTimeline]);

  // v2.99 — 세션(탭) 전환 시 위치 복원: 자식(StreamRenderer / 메인 Virtuoso)을 key={sessionKey} 로 재마운트하고
  //   restoreStateFrom 으로 그 세션의 저장 스냅샷(측정된 항목 높이 + 스크롤 위치)을 받아 **재측정 출렁임 없이**
  //   보던 위치로 즉시 정착시킨다(옛 rAF 정착 루프 + 불투명 덮개 + 픽셀 앵커 대체).
  //   스냅샷은 "떠날 때"가 아니라 **스크롤이 일어나는 동안 throttled 로 갱신 저장**한다 — getState 는 virtuoso 가
  //   마운트돼 있는 동안에만 유효한데, 언마운트 cleanup 시점엔 자식 virtuoso 가 이미 해제돼 잡을 수 없기 때문.
  //   탭을 바꾸면 그 세션에서 마지막으로 스크롤된 위치가 이미 맵에 들어 있어 복귀 시 그대로 복원된다.
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    let raf = 0;
    const save = (): void => {
      raf = 0;
      const handle = activeSessionId === null ? mainVirtuosoRef.current : streamRef.current;
      handle?.getState((snap) => { sessionSnapshotsRef.current.set(sessionKey, snap); });
    };
    // v3.08 — 추종 해제는 **사용자 직접 제스처**(휠 위로/터치 드래그/PageUp·Home 등)가 있었을 때만. 옛 v3.05 는
    //   scroll 이벤트의 dist 만 보고 followRef 를 껐는데, 그 전제("콘텐츠 성장으로는 scroll 이 안 난다")가 틀렸다 —
    //   virtuoso 는 스트리밍으로 마지막 항목이 자라면 위쪽 선렌더 버퍼(increaseViewportBy top:1600)를 재측정하며
    //   **스스로 scrollTop 을 보정**해 scroll 이벤트를 쏜다. 그 순간 콘텐츠가 막 자라 dist≥임계라 추종이 꺼지고,
    //   이후 pin(v3.04/ResizeObserver)이 전부 bail 해 새 단어가 바닥에 안 붙고 화면이 "위로 말려 올라가" 보였다
    //   (사용자: "새 단어 쓰면 왜 위로 올라가냐"). → 프로그램/측정이 만든 scroll 로는 절대 끄지 않고, 사용자가
    //   실제로 위로 올린 제스처가 최근(700ms)에 있었을 때만 끈다. 바닥에 닿으면(직접 내렸든 pin 이 붙였든) 항상 재무장.
    let userUpIntentUntil = 0;
    const markUpIntent = (): void => { userUpIntentUntil = performance.now() + 700; };
    // §5.5 #17-16 ③ — 접이식 블록을 **펼치는 클릭**은 "이걸 읽겠다"는 사용자 의도다. 종전엔 펼침으로
    //   높이가 늘어난 만큼 바닥 추종 워치독(v3.14)이 매 프레임 스크롤을 바닥에 붙여, 펼친 내용이 한순간
    //   보였다가 곧장 위로 밀려났다(사용자: "쫙 보였다가 바로 사라져"). 펼침 클릭이면 ① 추종을 **먼저**
    //   끄고 ② 클릭한 헤더의 뷰포트 오프셋을 짧게(400ms) 유지해 그 자리를 잡아 둔다. 접는 클릭은 손대지
    //   않는다(높이가 줄 뿐이라 추종이 그대로 옳다). 사용자가 직접 스크롤하면 즉시 앵커를 놓는다.
    let holdRaf = 0;
    let holdEl: HTMLElement | null = null;
    let holdOffset = 0;
    let holdUntil = 0;
    const cancelHold = (): void => {
      holdEl = null;
      expandHoldUntilRef.current = 0;
      if (holdRaf) { cancelAnimationFrame(holdRaf); holdRaf = 0; }
    };
    const holdTick = (): void => {
      holdRaf = 0;
      const target = holdEl;
      if (!target || !target.isConnected || performance.now() > holdUntil) { holdEl = null; return; }
      const delta = (target.getBoundingClientRect().top - el.getBoundingClientRect().top) - holdOffset;
      if (Math.abs(delta) > 1) el.scrollTop += delta;
      holdRaf = requestAnimationFrame(holdTick);
    };
    const onToggleClick = (e: MouseEvent): void => {
      const btn = (e.target as Element | null)?.closest?.(`[${STREAM_TOGGLE_ATTR}]`);
      if (!(btn instanceof HTMLElement)) return;
      // React onClick 은 루트 컨테이너에서 뒤에 처리되므로, 여기서 읽는 aria-expanded 는 **클릭 이전** 상태다.
      if (btn.getAttribute('aria-expanded') !== 'false') return; // 접는 클릭 — 그대로 둔다.
      followRef.current = false;
      sessionAtBottomRef.current.set(sessionKey, false);
      holdEl = btn;
      holdOffset = btn.getBoundingClientRect().top - el.getBoundingClientRect().top;
      holdUntil = performance.now() + 400;
      expandHoldUntilRef.current = holdUntil; // 이 구간엔 atBottom 통지로 추종이 재무장되지 않는다.
      if (!holdRaf) holdRaf = requestAnimationFrame(holdTick);
    };
    // Ctrl+휠은 본문 텍스트 줌 제스처(아래 ideTextZoom wheel 핸들러)라 스크롤-업 의도로 치지 않는다.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && e.deltaY < 0) markUpIntent();
      if (!e.ctrlKey) cancelHold(); // 사용자가 직접 굴리면 아래 펼침 앵커는 즉시 손을 뗀다.
    };
    const onKeyNav = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') markUpIntent();
      cancelHold();
    };
    // v3.14 — 스크롤바 드래그는 wheel/touch/key 어디에도 안 잡히던 제스처 구멍: 포인터를 누른 채
    //   scrollTop 이 감소하면(=바를 위로 끎) 위로-제스처로 편입한다. 안 하면 추종이 살아있는 동안
    //   워치독이 매 프레임 바닥으로 되끌어 사용자가 스크롤바로는 위로 못 올라간다.
    let pointerDown = false;
    let prevScrollTop = el.scrollTop;
    const onPointerDown = (): void => { pointerDown = true; cancelHold(); };
    const onPointerUp = (): void => { pointerDown = false; };
    const onTouchMove = (): void => { markUpIntent(); cancelHold(); };
    const onScroll = (): void => {
      const goingUp = el.scrollTop < prevScrollTop;
      prevScrollTop = el.scrollTop;
      if (pointerDown && goingUp) markUpIntent();
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      // 판정은 순수 함수(decideFollow)로 위임 — virtuoso/레이아웃 없이 Vitest 로 결정론적 검증(followDecision.test).
      followRef.current = decideFollow({
        dist,
        threshold: FOLLOW_BOTTOM_THRESHOLD,
        prevFollow: followRef.current,
        userUpIntent: performance.now() < userUpIntentUntil,
        goingUp,
      });
      sessionAtBottomRef.current.set(sessionKey, followRef.current);
      // 바닥에서 충분히 떨어졌을 때만 "맨 아래로" 버튼 노출(자잘한 이탈엔 안 뜨게 240px 임계).
      setShowJumpBottom(dist > 240);
      if (!raf) raf = requestAnimationFrame(save);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKeyNav);
    el.addEventListener('click', onToggleClick);
    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKeyNav);
      el.removeEventListener('click', onToggleClick);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      cancelHold();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollEl, activeSessionId, sessionKey]);

  // v3.00 — 세션(탭) 진입 시 가변 높이(마크다운/도구 블록) 측정 reflow 로 본문이 위아래로 출렁이던(통통 튀던)
  //   증상 제거. v2.99 가 단독 스크롤러로 가면서 v2.97 의 "정착 덮개" 를 걷어냈더니, restoreStateFrom 스냅샷이
  //   덮지 못한 화면 밖 항목(increaseViewportBy 로 선렌더되는 위/아래 버퍼)이 마운트 후 뒤늦게 측정되며
  //   ① 통통 튀는 출렁임 ② 바닥이 살짝 위 ③ 복원 위치가 밀려 보임 — 세 증상이 한 뿌리로 재발했다. 출력 영역을
  //   잠깐 불투명 덮개로 가린 채 scrollHeight 가 연속 프레임(=5) 안 바뀔 때(측정 정착, 상한 1200ms)까지 기다렸다
  //   페이드아웃해 정돈된 본문을 한 번에 드러낸다(VS Code 식 "레이아웃 준비 전 미표시"). 진입 시 바닥이던 세션은
  //   그동안 LAST 로 재고정해 "바닥이 살짝 위" 까지 해소하고, 위로 올려둔 세션은 restoreStateFrom 복원 위치를
  //   그대로 유지한다(LAST 재고정 ❌). useLayoutEffect 라 전환 첫 프레임부터 덮여 pre-settle 깜빡임이 없다.
  const [covering, setCovering] = useState(true);
  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) { setCovering(true); return; }
    setCovering(true);
    const atBottomOnEntry = sessionAtBottomRef.current.get(sessionKey) ?? true;
    // v3.06 — 진입 세션의 추종 의도로 followRef 를 즉시 정렬(layout 단계라 paint 전). 이게 없으면 위로
    //   올려둔 세션으로 돌아왔을 때 followRef 가 직전 세션의 stale true 로 남아, 아래 ResizeObserver/스트림
    //   추종이 restoreStateFrom 복원 위치를 무시하고 바닥으로 끌어내린다.
    followRef.current = atBottomOnEntry;
    let raf = 0;
    let stable = 0;
    let lastH = -1;
    const start = performance.now();
    const tick = (): void => {
      raf = 0;
      // v3.14 — 재고정도 DOM 진실로(모델 좌표 scrollToIndex 금지). initialTopMostItemIndex=LAST 가 첫
      //   위치를 잡고, 측정 정착 동안의 재고정은 실제 바닥 좌표로 붙인다.
      if (atBottomOnEntry) glueToBottomDom();
      const h = el.scrollHeight;
      if (h === lastH) stable += 1; else { stable = 0; lastH = h; }
      if (stable >= 5 || performance.now() - start > 1200) { setCovering(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [scrollEl, sessionKey, activeSessionId, glueToBottomDom]);

  // 사용자가 방금 엔터로 보낸 자기 프롬프트(명령) 수가 늘면 — 위로 올려둔 상태였어도 무조건 하단으로
  //   되돌린다(자기가 보낸 메시지는 항상 보이게 하는 채팅 UX). 추종 재개 + Virtuoso 핸들로 마지막 항목까지 스크롤.
  const userCmdCount = useMemo(
    () => commands.filter((c) => activeSessionId === null || c.subAgentId === activeSessionId).length,
    [commands, activeSessionId],
  );
  const prevUserCmdCountRef = useRef(userCmdCount);
  useEffect(() => {
    const grew = userCmdCount > prevUserCmdCountRef.current;
    prevUserCmdCountRef.current = userCmdCount;
    if (grew) {
      // v3.05 — 자기 메시지 전송은 추종을 무조건 재무장(위로 올려둔 상태였어도 바닥으로 끌어내려 따라간다).
      followRef.current = true;
      sessionAtBottomRef.current.set(sessionKey, true);
      // v3.14 — 실제 바닥 붙이기는 아래 워치독이 매 프레임 수행하므로, 여기선 추종 재무장 + 즉시 1회
      //   접착만 한다. 전송 직후 400ms 동안은 스트레이 위로-제스처 오탐이 추종을 꺼도 매 프레임 되살린다
      //   (엔터 직후라 사용자 스크롤-업일 수 없음 — v3.07 교훈 유지).
      glueToBottomDom();
      let raf = 0;
      const start = performance.now();
      const rearm = (): void => {
        followRef.current = true;
        sessionAtBottomRef.current.set(sessionKey, true);
        raf = performance.now() - start < 400 ? requestAnimationFrame(rearm) : 0;
      };
      rearm();
      return () => { if (raf) cancelAnimationFrame(raf); };
    }
  }, [userCmdCount, activeSessionId, sessionKey, glueToBottomDom]);

  // v3.14 — 바닥 추종의 **유일한 집행자: DOM 진실 워치독**. followRef 가 살아있는 동안 매 프레임 실제
  //   바닥(scrollHeight-clientHeight)과의 편차를 재고 어긋났을 때만 붙인다(xterm/VS Code 터미널 방식).
  //   역사: v3.04(데이터 effect)→v3.06(RO)→v3.12(totalListHeightChanged pin)까지 모든 집행이 virtuoso
  //   측정 모델 좌표(scrollToIndex LAST)를 목표로 삼았는데, 모델이 실제 DOM 과 어긋나는 순간(측정 지연·
  //   추정 오차 등 원인 불문) "모델이 생각하는 바닥"=실제보다 위쪽으로 스크롤을 역주행시켰다 — thinking 중
  //   "추종이 안 내려가고, 내리면 위로 되끌려 올라감"의 구조적 원인. DOM 좌표 접착은 최댓값으로의
  //   idempotent 이동이라 ① 위로 역주행이 불가능하고 ② epsilon 띠 없이(>0.5px) 바닥이 '선'으로 유지되며
  //   ③ 뷰포트 리사이즈·콘텐츠 성장·측정 정착·절단 보정 등 모든 높이 변화를 원인 구분 없이 흡수한다
  //   (옛 totalListHeightChanged pin + 뷰포트 RO 를 함께 대체). followRef=false(사용자가 위로 올려 읽는 중)
  //   면 DOM 읽기조차 하지 않아 "그 자리 고정"이 보장되고 per-frame 비용도 없다(입력 지연 회귀 방지).
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    let raf = 0;
    let lastWarnAt = 0;
    const tick = (): void => {
      if (followRef.current) {
        const target = el.scrollHeight - el.clientHeight;
        const delta = target - el.scrollTop;
        if (delta > 0.5) {
          // 진단 — 추종 중인데 바닥에서 600px 이상 벌어져 있었다면 무언가가 스크롤을 위로 끌어올린 것.
          //   재발 시 원인 추적용(2s 스로틀). 동작엔 영향 없음.
          if (delta > 600 && performance.now() - lastWarnAt > 2000) {
            lastWarnAt = performance.now();
            console.warn('[follow-watchdog] 추종 중 대편차 재접착', { delta: Math.round(delta) });
          }
          el.scrollTop = target;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [scrollEl]);

  // 북마크 "이동" 소비 — 타깃 세션이 활성화되면, 출처 항목(anchorId)으로 가상 리스트를 직접 스크롤한다.
  //   Sub 탭: StreamRenderer 가 자체 Virtuoso 로 처리. 메인 탭: 여기서 메인 Virtuoso scrollToIndex 후
  //   컨테이너 스크롤+하이라이트. nonce 로 1회만 처리(스토어 clear 가 effect 재실행→cleanup 으로 타이머를
  //   취소하는 회귀를 피하려 clear 대신 handledNonce 가드).
  const bookmarkScrollTarget = useGraphStore((s) => s.bookmarkScrollTarget);
  const streamRef = useRef<StreamRendererHandle>(null);
  const mainVirtuosoRef = useRef<VirtuosoHandle>(null);
  useEffect(() => {
    const target = bookmarkScrollTarget;
    if (!target) return;
    if (target.nonce === handledBookmarkNonceRef.current) return;
    if (target.sessionId !== activeSessionId) return; // 타깃 세션 활성화 전 — 대기(아직 nonce 미처리)
    handledBookmarkNonceRef.current = target.nonce;
    // v3.14 — 점프 동안 워치독이 점프 위치를 바닥으로 되끌지 않게 추종을 명시 해제. 점프한 곳이 바닥
    //   근처면 atBottomStateChange 가 자동 재무장한다.
    followRef.current = false;
    sessionAtBottomRef.current.set(sessionKey, false);
    const { anchorId, text } = target;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number): void => {
      timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    };

    if (activeSessionId !== null) {
      // Sub 탭 — StreamRenderer 가 index 스크롤 + 하이라이트를 담당.
      later(() => streamRef.current?.scrollToBookmark(anchorId, text), 120);
    } else {
      // 메인 탭 — 메인 Virtuoso 를 anchorId 인덱스로 보낸 뒤(렌더 후) 컨테이너 스크롤+하이라이트.
      const idx = anchorId ? mainTimeline.findIndex((n) => mainTimelineNodeId(n) === anchorId) : -1;
      // scrollToIndex 는 짧은 타이머 안에서 — 오버레이가 새로 마운트(프로젝트 전환)된 직후엔 ref 가 아직 null.
      later(() => { if (idx >= 0) mainVirtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' }); }, 60);
      later(() => {
        const el = scrollRef.current;
        if (el) performBookmarkScroll(el, anchorId, text);
      }, idx >= 0 ? 340 : 140);
    }
    return () => { cancelled = true; for (const tmr of timers) clearTimeout(tmr); };
    // mainTimeline 은 의도적으로 deps 제외(스크롤은 nonce 변경 시 1회만; deps 에 넣으면 타임라인 갱신마다
    // cleanup 이 진행 중 타이머를 취소). nonce 가드가 중복 실행을 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkScrollTarget, activeSessionId]);

  // ── §5.5 대화 인-페이지 검색 (Ctrl+F) ──────────────────────────────────────
  //   가상 리스트(Virtuoso)라 화면 밖 항목은 DOM 에 없어 브라우저 Ctrl+F 로 못 잡는다 → 항목 **데이터**
  //   기준으로 매칭한 뒤 scrollToIndex 로 렌더시키고 performBookmarkScroll 로 중앙 정렬 + 텍스트 선택/플래시.
  //   Sub 탭은 StreamRenderer 핸들(searchMatchIds/scrollToBookmark)에, 메인 탭은 mainTimeline 로컬 계산에 위임.
  //   터미널 모드는 IDETerminalView 가 자체 Ctrl+F 를 가지므로 이 검색을 걸지 않는다.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCaretRef = useRef(0);

  // 검색창 포커스 유지 — 이동(가상 리스트 렌더 → 스크롤 → 하이라이트)은 비동기라 그 사이에 포커스가
  //   빠지면 사용자가 이어서 타이핑을 못 한다(브라우저 찾기막대는 늘 입력칸에 머문다). 이동이 끝나는
  //   시점들에서 "검색창이 포커스를 잃었고, 사용자가 다른 입력칸으로 옮겨간 것도 아닐 때"만 되돌린다.
  //   이미 포커스면 아무것도 하지 않는다 — focus/setSelectionRange 는 IME(한글) 조합을 깨뜨린다.
  const restoreSearchFocus = useCallback(() => {
    const el = searchInputRef.current;
    if (!el || document.activeElement === el) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    const caret = Math.min(searchCaretRef.current, el.value.length);
    el.focus();
    try { el.setSelectionRange(caret, caret); } catch { /* 선택 범위를 지원 안 하는 입력이면 무시 */ }
  }, []);

  // 검색 대상은 **본문 텍스트뿐** — 도구 묶음·계획·라이브 줄은 물론, 명령(`command`)·도구 출력
  //   엔트리도 제외한다. 판정은 Sub 탭과 같은 술어(streamSearch.isFindableTextKind)를 쓴다.
  const mainItemSearchText = useCallback((item: TerminalItem): string => {
    if (item.kind !== undefined) return ''; // 도구 묶음·계획·라이브 줄
    return isFindableTextKind(item.type) ? item.text ?? '' : '';
  }, []);

  const computeMatches = useCallback((query: string): string[] => {
    if (!query.trim()) return [];
    if (activeSessionId !== null) return streamRef.current?.searchMatchIds(query) ?? [];
    const ids: string[] = [];
    for (const n of mainTimeline) {
      if (n.t !== 'item') continue;
      if (findTextMatches(mainItemSearchText(n.item), query)) ids.push(n.item.id);
    }
    return ids;
  }, [activeSessionId, mainTimeline, mainItemSearchText]);

  const navigateSearch = useCallback((ids: string[], idx: number, query: string) => {
    const id = ids[idx];
    if (!id) return;
    // 이동 전 검색창 caret 을 기억해 둔다 — 도중에 포커스가 빠졌을 때 그 자리로 되돌리기 위함.
    const input = searchInputRef.current;
    if (input && document.activeElement === input) searchCaretRef.current = input.selectionStart ?? input.value.length;
    // 이동이 끝나는 시점들(다음 프레임 · 하이라이트 직후 · 부드러운 스크롤 꼬리)에서 포커스를 확인·복구.
    requestAnimationFrame(restoreSearchFocus);
    window.setTimeout(restoreSearchFocus, 340);
    window.setTimeout(restoreSearchFocus, 620);
    // v3.14 — 검색 이동 동안 워치독이 바닥으로 되끌지 않게 추종 명시 해제(바닥 근처 도착 시 자동 재무장).
    followRef.current = false;
    sessionAtBottomRef.current.set(sessionKey, false);
    // preserveFocus=true — 찾은 텍스트는 selection 이 아니라 CSS 하이라이트로 칠한다(검색창 caret 보존).
    if (activeSessionId !== null) { streamRef.current?.scrollToBookmark(id, query, true); return; }
    const nodeIdx = mainTimeline.findIndex((n) => n.t === 'item' && n.item.id === id);
    if (nodeIdx >= 0) mainVirtuosoRef.current?.scrollToIndex({ index: nodeIdx, align: 'center' });
    window.setTimeout(() => {
      const cont = scrollRef.current;
      if (cont) performBookmarkScroll(cont, id, query, true);
    }, nodeIdx >= 0 ? 260 : 40);
  }, [activeSessionId, mainTimeline, sessionKey, restoreSearchFocus]);

  // query/열림/탭 변경 시 매칭 재계산 + 첫 매칭으로 이동. 스트리밍 데이터 변경마다 자동 점프하지 않도록
  //   deps 는 최소화(검색 중 본문이 계속 자라도 화면이 튀지 않게).
  useEffect(() => {
    if (!searchOpen) return;
    const ids = computeMatches(searchQuery);
    setSearchMatches(ids);
    setSearchIdx(0);
    if (ids.length > 0) navigateSearch(ids, 0, searchQuery);
    else clearFindHighlight(); // 매칭 0 — 앞 검색어의 하이라이트가 남아 있지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchQuery, activeSessionId]);

  const searchStep = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (searchIdx + dir + searchMatches.length) % searchMatches.length;
    setSearchIdx(next);
    navigateSearch(searchMatches, next, searchQuery);
  }, [searchMatches, searchIdx, searchQuery, navigateSearch]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false); setSearchQuery(''); setSearchMatches([]); setSearchIdx(0);
    clearFindHighlight();
  }, []);

  // 하이라이트 레지스트리는 document 전역이라, 이 IDE 가 사라질 때 남은 칠을 거둔다.
  useEffect(() => () => clearFindHighlight(), []);

  useEffect(() => {
    if (showInteractiveTerminal) return;
    if (!cellFocused) return; // §5.5 #17-34 — 검색창도 초점 칸에서만 열린다(칸마다 동시에 뜨지 않게).
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => { const el = searchInputRef.current; if (el) { el.focus(); el.select(); } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showInteractiveTerminal, cellFocused]);

  // v3.14 — 상태바 "프롬프트로 이동" 등 위쪽으로의 점프 전에 추종을 명시 해제(워치독 되끌림 방지).
  const releaseFollowForJump = useCallback(() => {
    followRef.current = false;
    sessionAtBottomRef.current.set(sessionKey, false);
  }, [sessionKey]);

  // "맨 아래로" 점프 — 추종 재무장 + 즉시 1회 접착(v3.14 — 이후 프레임은 워치독이 실제 바닥에 유지).
  const jumpToBottom = useCallback(() => {
    followRef.current = true;
    sessionAtBottomRef.current.set(sessionKey, true);
    glueToBottomDom();
    setShowJumpBottom(false);
  }, [sessionKey, glueToBottomDom]);

  // §5.5 — 놓친 카드 pill 클릭: 그 카드 위치로 이동(+중앙 정렬·플래시). 위로 갈 수 있으니 추종을 명시 해제해
  //   워치독이 바닥으로 되끌지 않게 한다(바닥 근처 도착이면 atBottomStateChange 가 자동 재무장). 검색·북마크 점프와 동형.
  const scrollToCard = useCallback((card: UnseenCardMeta) => {
    followRef.current = false;
    sessionAtBottomRef.current.set(sessionKey, false);
    if (activeSessionId !== null) {
      // Sub 탭 StreamRenderer 는 카드 stream item.id 를 `${kind}-${rawId}` 로 접두어 붙여 관리한다
      //   (mergeCardsIntoItems). scrollToBookmark 는 item.id 기준으로 인덱스를 찾으므로 접두어를 붙여 넘긴다.
      streamRef.current?.scrollToBookmark(`${card.kind}-${card.id}`, '');
      return;
    }
    // §5.5 #17-12 — 신고 카드로 흡수된 검수는 독립 노드가 아니므로 흡수한 신고 노드를 찾아준다.
    const idx = mainTimeline.findIndex((n) =>
      mainTimelineNodeId(n) === card.id || (n.t === 'report' && n.review?.id === card.id));
    if (idx >= 0) mainVirtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' });
    window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const found = findItemElement(el, card.id);
      if (found) { scrollElementIntoCenter(el, found); flashElement(found); }
    }, idx >= 0 ? 260 : 40);
  }, [activeSessionId, mainTimeline, sessionKey]);

  // §4 v2.63 — 인터랙티브 터미널 모드: 활성 탭(세션)을 임베디드 PTY 로 렌더.
  //   key=termId 라 탭 전환 시 그 세션 터미널로 교체(PTY 는 main 에서 보존 → reattach).
  //   모든 hook 은 위에서 이미 호출됐으므로 여기서 조기 return 해도 Rules of Hooks 안전.
  if (showInteractiveTerminal) {
    // §4 (CMD) — 세션 탭이 아직 정해지지 않았으면(창을 연 직후의 찰나) **터미널을 세우지 않는다**.
    //   CMD 는 커스텀이라 탭바에 메인 탭 자체가 없고(IDETabBar 의 `!isCustom` 조건), 세션은 곧
    //   자동으로 골라지거나 새로 열린다(AgentIDEOverlay 의 자동 선택·자동 생성). 그 찰나에
    //   `'main'` 으로 터미널을 한 벌 세우면 `term:<agent>:main` PTY 가 실제로 떠서 셸 배너와
    //   prefill 명령까지 그린 뒤, 세션이 정해지는 순간 key 가 바뀌며 통째로 갈아엎힌다 —
    //   사용자 눈에는 "처음 열면 자동으로 적힌 명령이 지워진다"로 보인다. 게다가 버려진 PTY 는
    //   회수되지도 않는다(unmount 는 reattach 를 위해 PTY 를 살려 두는 것이 규약이라, 아무도
    //   보지 않는 셸이 그대로 남는다).
    if (!activeSessionId) {
      // 배경색은 터미널과 같은 값 — 이 찰나의 자리바꿈이 깜빡임으로 드러나지 않게.
      return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#11111b]" />;
    }
    // §4 v2.83 — CMD 카드는 외부 레일이 아니라 **터미널 안 ANSI 색 박스**로 인라인 렌더된다
    //   (IDETerminalView 의 TerminalCardSniffer 가 마커 줄을 박스로 대체). 여기선 터미널만 렌더.
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* §4 (CMD ⑤) — 탭 하나가 pane 트리를 갖는다. 분할이 없으면 pane '0' 단일 렌더라
            종전(IDETerminalView 직접 렌더)과 화면·termId 가 바이트 단위로 같다. */}
        <IDETerminalPanes key={activeSessionId} agentId={agentId} sessionId={activeSessionId} />
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      // §5.5 #17-38 ③ — 창 단위 단축키가 "초점이 이 판 안에 있는가"를 물을 때 보는 표식.
      //   칸(분할)마다 이 판이 하나씩이라 창이 여럿이어도 임자가 하나로 정해진다.
      data-ide-main={agentId}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* OS 파일 드래그앤드롭 오버레이 — 드래그 중에만 출력+입력 영역 전체를 덮는 점선 힌트 */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-blue-950/40 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-blue-400/70 bg-gray-900/85 px-8 py-6 shadow-xl">
            <svg className="h-8 w-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6" />
              <path d="m9 15 3 3 3-3" />
            </svg>
            <span className="text-sm font-semibold text-blue-100">{t('ide.mainArea.dropFilesHint')}</span>
          </div>
        </div>
      )}
      {/* Terminal output — v2.99: virtuoso 가 자기 내부 스크롤러를 단독 소유. 이 div 는 클릭/우클릭 위임 +
          레이아웃(flex 높이)만 담당하고 직접 스크롤하지 않는다(옛 overflow 컨테이너 + onScroll 폐기). */}
      <div
        ref={ideBodyRef}
        onClick={handleAckClick}
        onContextMenu={handleContextMenu}
        className="relative flex min-h-0 flex-1 flex-col bg-gray-950"
      >
        {/* §5.5 #17-36 — 이 화면에 붙여 둔 스티키 메모. 대화 위에 떠 있고 함께 스크롤되지 않는다.
            좌표는 이 컨테이너(ideBodyRef) 기준이라 창을 좁혀도 판 안에 남는다. */}
        <SessionMemoLayer
          agentId={agentId}
          sessionId={activeSessionId}
          containerRef={ideBodyRef}
          spawnAt={memoSpawn}
          onSpawnConsumed={clearMemoSpawn}
          spreadRequest={memoSpread}
          onSpreadConsumed={clearMemoSpread}
        />
        {/* 본문 텍스트 줌 배율 표시 — Ctrl+휠/Ctrl±/핀치로 배율이 바뀐 직후에만 우측 상단에 떠 "지금 몇 배인지"
            기준을 잡아주고, 손을 떼면 잠시 뒤 스르륵 사라진다(zoomBadgeVisible). 페이드 전환을 위해 항상
            마운트해 두고 opacity 만 굴린다(조건부 마운트면 나타날 때 전환이 없음). 검색바(같은 코너)와
            겹치지 않게 searchOpen 이면 양보. pointer-events-none 으로 본문 클릭/스크롤을 가리지 않는다. */}
        {!searchOpen && (
          <div
            className={`absolute right-3 top-2 z-20 flex select-none items-center gap-1 rounded-md bg-gray-900/60 py-0.5 pl-2 pr-1 shadow-sm backdrop-blur-sm transition-opacity duration-500 ${zoomBadgeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            aria-hidden={!zoomBadgeVisible}
            onMouseEnter={holdZoomBadge}
            onMouseLeave={releaseZoomBadge}
          >
            <span className="text-[12px] font-medium tabular-nums text-gray-500">{Math.round(ideTextZoom * 100)}%</span>
            {/* 크롬 줌 버블의 "재설정" 짝 — 100% 가 아닐 때만 활성화. 배지가 떠 있는 동안에만 클릭 가능
                (pointer-events 는 컨테이너에서 일괄 제어)라 본문 클릭/스크롤을 가리지 않는다. */}
            <button
              type="button"
              onClick={() => setIdeTextZoom(1)}
              disabled={ideTextZoom === 1}
              className="rounded px-1.5 py-0.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-gray-700/70 hover:text-gray-100 disabled:cursor-default disabled:text-gray-600 disabled:hover:bg-transparent"
            >
              {t('ide.zoom.reset')}
            </button>
          </div>
        )}
        {/* §5.5 대화 인-페이지 검색바 — Ctrl+F. 본문(항목별 zoom) 위 chrome 이라 zoom 영향 없음(z-20 > 덮개 z-10). */}
        {searchOpen && (
          <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900/95 px-2 py-1 shadow-lg backdrop-blur-sm">
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); searchStep(e.shiftKey ? -1 : 1); }
                else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
              }}
              placeholder={t('ide.search.placeholder')}
              spellCheck={false}
              className="w-44 bg-transparent text-[12px] text-gray-100 placeholder-gray-500 outline-none"
            />
            <span className="min-w-[40px] text-right text-[12px] tabular-nums text-gray-400">
              {searchQuery.trim() ? `${searchMatches.length ? searchIdx + 1 : 0}/${searchMatches.length}` : ''}
            </span>
            {/* 다음/이전은 mousedown 기본동작(포커스 이동)을 막아 **입력칸이 포커스를 잃지 않게** 한다 —
                브라우저 찾기막대처럼 눌러 가며 계속 타이핑할 수 있어야 한다(클릭 이벤트는 그대로 뜬다). */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => searchStep(-1)}
              disabled={searchMatches.length === 0}
              title={t('ide.search.prev')}
              aria-label={t('ide.search.prev')}
              className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => searchStep(1)}
              disabled={searchMatches.length === 0}
              title={t('ide.search.next')}
              aria-label={t('ide.search.next')}
              className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <button
              type="button"
              onClick={closeSearch}
              title={t('ide.search.close')}
              aria-label={t('ide.search.close')}
              className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        {activeSessionId !== null ? (
          /* ── Sub 탭: CLI 스타일 스트림 렌더러 (마크다운 + 접이식 도구) ── */
          <>
            {/* §4 v2.53 — 작업 신고 카드는 StreamRenderer 안에서 createdAt 기준 인라인 합류(하단 고정 ❌). */}
            {/* v2.99 — StreamRenderer 의 Virtuoso 가 height:100% 로 자기 스크롤러를 단독 소유. onScrollerRef 로
                그 스크롤러 DOM 을 받아 StreamStatusBar·북마크가 쓰고, key={sessionKey} 재마운트 + restoreState 로
                세션 위치를 복원한다. §5.3 #12-2 — AskUserQuestion 카드는 askRequests 로 가상 리스트 안에 합류. */}
            <StreamRenderer
              key={sessionKey}
              ref={streamRef}
              events={activeStreamEvents}
              commands={commands.filter((c) => c.subAgentId === activeSessionId)}
              // §4 v3.21 — result 블록 좋아요/싫어요 피드백 컨텍스트(소유 에이전트 + 이 세션 탭).
              agentId={agentId}
              subAgentId={activeSessionId ?? undefined}
              reports={reportCards}
              questions={questionCards}
              reviews={reviewCards}
              lists={listCards}
              askRequests={askCards}
              onScrollerRef={setScrollNode}
              restoreState={restoreStateFor(sessionKey)}
              onAtBottomChange={handleAtBottomChange}
            />
          </>
        ) : (
          /* ── Agent 탭(메인): 기존 터미널 라인 + AskUserQuestion 카드. 비어있을 땐 그냥 빈 배경(미니멀) ── */
          <>
            {/* §4 v2.53 — 터미널 항목과 작업 신고 카드를 시간순으로 합친 mainTimeline 을 렌더(신고 하단 고정 ❌). */}
            {/* v2.99 — 메인 Virtuoso 도 height:100% 로 자기 스크롤러 단독 소유. mainTimeline 이 비면 그리지 않아 미니멀 배경 유지. */}
            {mainTimeline.length > 0 && (
              <Virtuoso
                key={sessionKey}
                ref={mainVirtuosoRef}
                className="scrollbar-thin"
                style={{ height: '100%' }}
                scrollerRef={setScrollNode}
                // v3.14 — 바닥 추종 집행은 DOM 워치독 단일 권한(followOutput 위임 제거 — 모델 좌표 역주행 차단).
                atBottomStateChange={handleAtBottomChange}
                atBottomThreshold={40}
                // v3.17 — 마지막 줄과 하단 입력부 사이 여백(리스트 일부라 바닥 접착에 포함).
                components={{ Footer: StreamEndGap }}
                // 복원 스냅샷이 있으면(위로 올려둔 세션) 그 위치/측정값으로, 없으면(첫 진입/바닥 추종 세션)
                //   마지막 항목(새 바닥)에서 시작 — 둘은 배타.
                {...(restoreStateFor(sessionKey)
                  ? { restoreStateFrom: restoreStateFor(sessionKey) }
                  : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
                data={mainTimeline}
                // v3.13 — 앞쪽 절단 누적 수. virtuoso 가 공식 shift 경로로 sizeTree 키 재정렬 + scrollTop 보정.
                firstItemIndex={mainFirstItemIndex}
                computeItemKey={(_i, n) => mainTimelineNodeId(n)}
                itemContent={(_i, n) => {
                  const itemId = mainTimelineNodeId(n);
                  // §5.5 — 놓친 카드 pill 이 관측할 앵커. 카드류(신고/질문/검수/목록)에만 표식.
                  const isCard = n.t === 'report' || n.t === 'question' || n.t === 'review' || n.t === 'list';
                  return (
                    <div
                      data-stream-item-id={itemId}
                      className="ide-stream"
                      {...readingItemAttrsNoProse(mainTimelineReadingKind(n))}
                      {...(isCard ? { 'data-card-id': itemId } : {})}
                      style={ideTextZoom === 1 ? undefined : { zoom: ideTextZoom }}
                    >
                      {n.t === 'report'
                        ? <AgentReportCard report={n.report} review={n.review} live={n.live} />
                        : n.t === 'review'
                          ? <AgentReviewCard review={n.review} live={n.live} />
                        : n.t === 'list'
                          ? <AgentListCard list={n.list} live={n.live} />
                        : n.t === 'question'
                          ? <AgentQuestionCard questions={n.questions} live={n.live} />
                        : n.t === 'ask'
                          ? <AskQuestionCard request={n.request} />
                          : n.item.kind === 'plan'
                            ? <PlanBlock item={n.item} />
                          : n.item.kind === 'group'
                            ? <TerminalGroupLine group={n.item} density={density} />
                            : n.item.kind === 'thinking-live'
                              ? <ThinkingLiveLine label={n.item.mode === 'working' ? t('ide.streamRenderer.working') : t('ide.streamRenderer.thinking')} mode={n.item.mode} />
                              : <TerminalLine entry={n.item} density={density} exempt={itemId === mainLastTextId} agentId={agentId} />}
                    </div>
                  );
                }}
                // A: 뷰포트 밖 선렌더 버퍼 확대 — 중간 속도 스크롤에서 본문이 미리 준비돼 pop-in 이 줄어든다.
                increaseViewportBy={{ top: 1600, bottom: 2000 }}
                // B(제거): scrollSeek 자리표시자는 스트리밍 중/빠른 스크롤 시 추정 높이≠실제 높이 교체로 화면이
                //   위아래로 떨리던(발발 떨림) 원인 — 항상 실제 본문을 그려 떨림 제거(StreamRenderer 와 동일 조치).
              />
            )}
          </>
        )}

        {/* v3.00 — 진입 측정 정착 덮개: 본문이 정돈될 때까지 같은 배경색(gray-950)으로 가렸다 페이드인.
            가릴 본문이 있을 때만 불투명·클릭 차단, 정착(또는 빈 세션)이면 투명+pointer-events-none 로 무영향. */}
        <div
          aria-hidden
          className={`absolute inset-0 z-10 bg-gray-950 transition-opacity duration-150 ${
            covering &&
            (activeSessionId === null
              ? mainTimeline.length > 0
              : activeStreamEvents.length > 0 || commands.some((c) => c.subAgentId === activeSessionId))
              ? 'opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        />

        {/* §5.5 놓친 카드 pill 스택 — 좌하단. 뷰포트에 머물지 못하고 스쳐 지나간/못 본 카드만 쌓인다.
            클릭하면 그 카드 위치로 이동하고 pill 은 사라진다(입력창 위, 우하단 "맨 아래로" 버튼과 안 겹침). */}
        <UnseenCardPills scrollEl={scrollEl} cards={unseenCandidateCards} onJump={scrollToCard} />

        {/* §5.5 "맨 아래로" 점프 버튼 — 위로 스크롤해 바닥에서 멀어졌을 때만(showJumpBottom) 우하단에 뜬다.
            클릭 시 추종 재무장 + 바닥으로. 덮개(z-10)·검색바(z-20) 위(z-20). */}
        {showJumpBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            title={t('ide.mainArea.jumpToBottom')}
            aria-label={t('ide.mainArea.jumpToBottom')}
            className="absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-gray-600 bg-gray-800/90 text-gray-200 shadow-lg backdrop-blur-sm transition-colors hover:border-blue-400/60 hover:bg-gray-700 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Stream 하단 상태바 — §5.5 #17-12 로 메인 탭에도 상주(밀도 토글이 어느 탭에서도 닿게).
          메인 탭은 스코프를 좁힐 세션이 없어 명령 전체를 본다. v4.64 — [중지]는 이 줄에서 빠지고 입력창 하나로. */}
      <StreamStatusBar
        commands={activeSessionId !== null ? commands.filter((c) => c.subAgentId === activeSessionId) : commands}
        scrollRef={scrollRef}
        streamRef={streamRef}
        onJump={releaseFollowForJump}
        // §5.5 #17-12 — "지금 무엇을"(마지막 계획 단계).
        //   메인 탭은 단일 스트림이 아니므로 계획 줄 없이 프롬프트 미리보기를 유지한다.
        events={activeSessionId !== null ? activeStreamEvents : EMPTY_STREAM_EVENTS}
        sessionRunning={streamSessionRunning}
      />

      {/* Command input — 커스텀 에이전트만 입력 가능(§5.5 #17-29) */}
      {!isReadOnly && (
        <TerminalInput agentId={agentId} activeSessionId={activeSessionId} />
      )}

      {/* Read-only — 훅 버블은 모든 탭에서 관측 전용 */}
      {isReadOnly && (
        <div className="flex h-8 items-center justify-center border-t border-gray-700 bg-gray-900/60">
          <span className="text-[12px] text-gray-600">{t('ide.mainArea.readOnly')}</span>
        </div>
      )}

      {/* v2.61 — 첨부 이미지 라이트박스 (입력칩·상태바·대화 썸네일 클릭 시 전체화면 확대) */}
      <ImageLightboxHost agentId={agentId} activeSessionId={activeSessionId} canAttach={!isReadOnly} />

      {/* §5.5 #17-3 v2.31 — 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <IDEContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={closeCtxMenu}
        />
      )}
    </div>
  );
});
