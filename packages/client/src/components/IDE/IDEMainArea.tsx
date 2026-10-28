import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, CommandError, SubAgent, SubAgentStreamEvent, AgentEvent, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest, RunningSubagentTask } from '@vibisual/shared';
import { STREAM_DENSITIES, displayCommands, slashCommandNeedsTerminal, SESSION_MEMO, VOICE_INPUT, isVoiceToggleKey, mergeVoiceText, polishVoiceChunk, isMicAccessFixable, isNoDeviceError, type StreamDensity } from '@vibisual/shared';
import { isBackgroundShellTask, isSessionRunning } from '@vibisual/shared';
import { verificationNotRun } from '@vibisual/shared';
import {
  useSessionRunning, useSessionWork, useSessionExecuting, useSessionLivenessFacts,
} from '../../hooks/useSessionRunning.js';
import { afterInputComposition, cancelPendingInputEdits, IME_ENTER_OWNER, isComposingKeyEvent, isComposingNow, isImeConsumedKey, isInputComposing } from '../../utils/inputComposition.js';
import { decideEnterKey, enterCancelsDefault } from '../../utils/inputEnterKey.js';
import { boundedTextSelection, replaceTextRange, restoreInputSelection } from '../../utils/textInputSelection.js';
import { speechRunPositions, NO_SPEECH_RUNS, type SpeechRunPos } from './streamDensity.js';
import type { TodoItem } from '@vibisual/shared';
import { latestPlanProgress, parsePlanTodos, isSystemSubtypeChip, isHiddenSystemSubtype, PLAN_TOOL_NAME, commandAnchorTs, hasDispatched, PENDING_COMMAND_TS, isCardEchoText, isInvisibleStreamText, turnCoverageOf, dispatchedTurnAnchorsAsc, emptyTurnCoverage, cardPlacementTs, isCardSenderCandidate, type TurnCoverage, type CardSenderCall, type SentCardKind } from './streamItems.js';
import { foldTaskChips } from './taskChips.js';
import { describeCommandError, parseStreamErrorContent, joinCommandErrorLine } from './commandError.js';
import { CommandErrorNotice } from './CommandErrorNotice.js';
import { StreamErrorAccumulator } from './streamErrorDedup.js';
import { turnStopLabelKey } from './turnStopLabel.js';
import { PlanBlock } from './PlanBlock.js';
import { toolPreview } from './toolPreview.js';
import { useGraphStore, agentSessionInputKey, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
// §5.5 #17-34 — 창 안 분할. 칸 컨텍스트가 있으면 이 본문은 그 칸의 세션을 그리고, 창 단위 단축키는
//   초점 칸만 받는다(컨텍스트 밖 = 분할 없음 = 종전 동작 그대로).
import { useSplitCellFocused, useSplitCellSession } from './splitCellContext.js';
import { lightboxHostMatches, useImageLightboxHostSpot, useImageLightboxOrigin } from './imageLightboxOrigin.js';
import type { AgentSessionInputAttachment, EditorFollowMark } from '../../stores/graphStore.js';
import { useAvailableSkills, type SkillInfo, type BuiltinCommandInfo } from '../../hooks/useAvailableSkills.js';
import { builtinSlashDescription } from './slashBuiltinDesc.js';
// §5.5 #17-33 ⑦ — 스킬 상태 태그. 여기서는 **표시 전용**(`onFix` 를 안 넘긴다).
import { SkillStateTag } from '../SkillStateTag.js';
import { useSessionStop } from '../../hooks/useSessionStop.js';
import { clearFieldText } from '../../hooks/textFieldActions.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { openWebSearch } from './webSearchUrl.js';
import { StreamRenderer, StreamEndGap, type StreamRendererHandle } from './StreamRenderer.js';
import { StreamImageThumb } from './StreamImageThumb.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { providerBadgeOf } from './ideProviderViews.js';
import { ImageLightboxView } from './ImageAnnotator.js';
import { decideFollow } from './followDecision.js';
import { FOLLOW_SKIP_SHORT_KEYS, followSessionKey } from './editorFollow.js';
import { useVirtuosoFrontShift } from './frontShift.js';
import {
  DENSITY_ANCHOR_HOLD_MS, pickDensityAnchorEntries, resolveDensityAnchor, sessionSnapshotKey,
  type DensityAnchorEntry,
} from './densityAnchor.js';
import { statusBarPinsToRunning, VIEWED_TOP_MARGIN } from './streamViewedCommand.js';
import { measureViewportItems, probePromptPlace, samePromptOutline, settleItemAtTop, PROMPT_JUMP_TOP_GAP, type PromptProbe, type PromptRailEntry } from './promptRail.js';
import { PromptRail } from './PromptRailView.js';
import { readingItemAttrsNoProse } from './reading/readingModel.js';
import { useStreamToggle, streamToggleProps, STREAM_TOGGLE_ATTR } from './streamToggle.js';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement, resolveAnchorIdFromSelection, markRange, clearFindHighlight, highlightSearchMatches } from './bookmarkScroll.js';
import { isFindableTextKind, findTextMatches } from './streamSearch.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { UnseenCardPills, type UnseenCardMeta } from './UnseenCardPills.js';
import { IDETerminalPanes } from './IDETerminalPanes.js';
import { SessionMemoLayer } from './SessionMemoLayer.js';
import { SessionBubbleView, isInsideSessionBubbles, sessionBubbleStreamsOf, useOlderSessionIds } from './SessionBubbleView.js';
import type { SessionBubbleStream } from './sessionBubbles.js';
import { canAddMemoCount, hasHiddenMemoHeaders } from './sessionMemo.js';
import { useMemoLinkHost } from './useMemoLinkHost.js';
import { SystemNode, parseSystemSubtype, parseSystemTaskInfo } from './SystemNode.js';
import { ThinkingLiveLine, StepTraceLine, WriteTraceLine } from './ThinkingIndicator.js';
import { collectThinkRuns, mergeAdjacentThinkTraces, shouldTraceWriting, toolGroupElapsedMs, toolCallElapsedMs, type ThinkTraceView } from './turnSteps.js';
import { thinkTraceText, writeTraceText, toolElapsedText, toolCallElapsedText } from './stepTraceText.js';
// §5.5 #17-18 ⑤ — 대기 중 덧말의 상태·컨트롤은 이 말풍선이 갖는다.
import { CollapsiblePrompt, AiSpeakerGlyph, type PromptCommandState } from './CollapsiblePrompt.js';
import { INPUT_FIELD_SIZING, INPUT_MAX_HEIGHT, autosizeInput } from './inputAutosize.js';
import { decideArrowKey, getCommandHistory, hasCommandHistory, seedCommandHistory, type HistoryNavState } from './commandHistory.js';
// §5.5 #17-38 — 음성 받아쓰기. 마이크 수명은 훅이, 키·글 끼우기 판정은 shared 가, "듣는 중" 표시는 오버레이가 맡는다.
import { useVoiceDictation } from '../../hooks/useVoiceDictation.js';
import { useMicSettings } from '../../hooks/useMicSettings.js';
import { resolveVoicePort, type VoicePortResult } from '../../hooks/voiceOpenGate.js';
import { useVoiceAsr } from '../../hooks/useVoiceAsr.js';
import { VoiceInputOverlay } from './VoiceInputOverlay.js';
import { VoiceInstallDialog } from './VoiceInstallDialog.js';
import { MicSettingsPopup } from './MicSettingsPopup.js';
import { shortcutLabel } from '../../utils/platform.js';
import { liveLineActivityAt, liveLineMode, type LiveLineMode } from '../../utils/sessionActivity.js';
import { buildSessionRunInputs } from '../../utils/sessionStatus.js';
import { turnOfEvent, type StreamSystem } from './streamItems.js';
import { TransportRecoveryAccumulator, type StreamTransportRecovery } from './streamTransportRecovery.js';
import { TransportRecoveryLine } from './TransportRecoveryLine.js';
import { ProcessGuardLine } from './ProcessGuardLine.js';
import { parseProcessGuardNotice } from '@vibisual/shared';

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

/** §5.5 #17-15 — "지금 생각하고 있다"를 뜻하는 이벤트(SDK 펄스 + 실제 thinking 델타).
 *  사고 원문은 본문에 쌓지 않는다(Sub 탭 streamItems 와 같은 규칙). 라이브 1줄의 라벨은 이 판정을 쓰지
 *  않는다 — 작동 중이면 늘 `작업 중`이다(§5.5 #17-24 ⑦). */
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

/** §5.5 #17-2 — 슬래시 드롭다운 항목: 디스크 스킬/커맨드 또는 CLI 내장(built-in) 명령. */
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

// 바닥 추종 의도 판정 임계(px). 스크롤 후 바닥과의 거리가 이보다 가까우면 "추종 중"으로 본다.
const FOLLOW_BOTTOM_THRESHOLD = 80;

interface IDEMainAreaProps {
  agentId: string;
  isCustom: boolean;
}

/** 드롭된 File 의 절대경로 — Electron 은 preload `window.api.getPathForFile`(webUtils), 브라우저 dev 는 비표준 `File.path`. 둘 다 없으면 빈 문자열(첨부 불가). */
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
 * 북마크 이동 스크롤 — anchorId 엘리먼트로 중앙 + 플래시, 없으면 보관 텍스트 검색(공백·노드 경계 관용). 가상 리스트는 먼저 scrollToIndex.
 * `preserveFocus` = 검색용 — selection 대신 CSS 하이라이트로 칠해 검색창 caret 을 지킨다(`markRange`).
 */
function performBookmarkScroll(container: HTMLElement, anchorId: string | undefined, text: string, preserveFocus = false): boolean {
  if (anchorId) {
    const el = findItemElement(container, anchorId);
    if (el) {
      // 인-페이지 검색(preserveFocus)은 **검색어가 든 그 줄**을 중앙에 놓고 선택 색으로 칠한다.
      //   항목 중앙 정렬만 하면 카드가 화면보다 길 때 정작 검색어는 화면 밖에 남는다.
      if (preserveFocus && highlightSearchMatches(container, el, text)) return true;
      scrollElementIntoCenter(container, el);
      flashElement(el);
      // 항목 안에서 정확한 텍스트도 표시해 주면 더 좋다(있으면).
      const range = findTextRangeInContainer(el, text);
      if (range) markRange(range, preserveFocus);
      return true;
    }
  }
  if (preserveFocus && highlightSearchMatches(container, container, text)) return true;
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
  type: 'command' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system' | 'step' | 'image';
  text: string;
  timestamp: number;
  sessionLabel?: string;
  toolName?: string;
  transportRecovery?: StreamTransportRecovery;
  error?: CommandError;
  /** §5.5 #17-39 — 마지막 조각 도착 시각(`timestamp` 와의 차 = 걸린 시간). step·text 둘 다 쓴다(Sub 탭 `endedAt` 과 대칭). */
  endedAt?: number;
  /** §5.5 #17-39 — 사고 자국의 분량(글자). `text` 는 비어 있다 — 사고 **원문은 담지 않는다**. */
  stepChars?: number;
  /** §5.5 #17-39 ⑩ — 사고 자국의 주인 키(세션 id + 중첩 Task id). 주인이 다르면 합치지 않는다(`sessionLabel` 은 겹칠 수 있어 키 ❌). */
  stepOwner?: string;
  /** §5.25 (O) — 그림이 나온 세션(주소가 `<agentId>/<subAgentId>/<eventId>` 라 필요, `sessionLabel` 은 주소로 못 쓴다). */
  imageSubAgentId?: string;
  /** §5.5 #17-18 ⑦-7 — 줄이 나온 세션. 전체 보기에서 카드 발신 도구를 같은 세션 안에서만 찾을 때 쓴다(`sessionLabel` 은 겹친다). */
  subAgentId?: string;
  /** command 의 보낸 시각. `timestamp` 는 말풍선 자리(#17-18 ⑥ — 나간 시각, 대기 중이면 `PENDING_COMMAND_TS`)라 시각 표기에 못 쓴다. */
  submittedAt?: number;
  /** §5.5 #17-18 ⑤ — command 의 큐 상태. 말풍선이 색을 정하고 대기 중이면 [대기|합치기|즉시]·삭제를 띄운다. */
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
  /** `working` = 작동 중(사고 포함 — #17-24 ⑦), `waiting` = 줄만 섬(§5.5 #17-18 ⑪), `compacting` = 접는 중(#17-24 ⑥). */
  mode: LiveLineMode;
  timestamp: number;
  /** §2.4 (무응답) — 무응답을 재는 시계(마지막 이벤트 시각). 모르면 `null`(Sub 탭과 동형). */
  lastActivityAt: number | null;
  /** §5.5 #17-10 ⑥-6 (턴 시계) — 평소 적는 경과의 시작점(지금 턴 · 대기면 줄 선 시각). Sub 탭과 동형. */
  turnStartedAt: number | null;
  /** §5.3 #9-1 (P) — 감춘 턴이 도는 중이면 무응답으로 안 뒤집는다(Sub 탭 `StreamThinkingLive` 와 동형). */
  hiddenTurn?: true;
  /** §5.5 #17-24 ⑥ — `compacting` 모드일 때만 — CLI 가 접기 시작한 시각(Sub 탭과 동형). */
  compactingSince?: number;
}

/** 라이브 1줄의 세 모습 → i18n 키. Sub 탭 `liveLabels` 와 같은 키여야 한다(다르면 탭을 옮길 때 말이 바뀐다, #17-18 ⑪). */
const MAIN_LIVE_LABEL_KEY: Record<TerminalThinkingLive['mode'], string> = {
  working: 'ide.streamRenderer.working',
  waiting: 'ide.streamRenderer.waiting',
  compacting: 'ide.streamRenderer.compacting',
};

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

// ─── §5.5 #17-48: 메인 탭의 내 입력 — 타임라인의 command 줄(큐 명령 `cmd-*` · 훅 프롬프트 `evt-*`) ───

const EMPTY_PROMPT_OUTLINE: readonly PromptRailEntry[] = [];

/** 내 입력(명령 말풍선) 노드인가 — 레일의 눈금 하나가 된다. */
function isMainPromptNode(n: MainTimelineNode): boolean {
  return n.t === 'item' && n.item.kind === undefined && n.item.type === 'command';
}

/** 메인 탭 입력 목록(위→아래). 시각은 보낸 시각(`submittedAt`) — 대기 중 꼬리 표식(`timestamp`)은 시각이 아니다. */
function mainPromptOutlineOf(timeline: readonly MainTimelineNode[]): PromptRailEntry[] {
  const out: PromptRailEntry[] = [];
  for (const n of timeline) {
    if (n.t !== 'item' || n.item.kind !== undefined || n.item.type !== 'command') continue;
    out.push({ id: n.item.id, text: n.item.text, at: n.item.submittedAt });
  }
  return out;
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
  // §5.5 #17-18 ⑦-6 — 목표 창 블록뿐인 본문도 화면에 안 그려지므로 말이 아니다(Sub 탭 precededByCard 와 같은 함수).
  if (it.kind === undefined) {
    if (it.type === 'text') return isInvisibleStreamText(it.text);
    return it.type === 'system' || it.type === 'tool_use' || it.type === 'tool_result' || it.type === 'step';
  }
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

// §5.5 #17-18 ⑦-7 — 카드 발신 도구 후보(메인 탭 판). 판정은 Sub 탭과 같은 `cardPlacementTs`, 후보 자리는 그 도구가 든 묶음(카드는 묶음 아래).
// 간결은 묶음이 없어 신고 시각 그대로.

/** 도구 묶음에서 카드 발신 후보를 세션별로 뽑는다. */
export function collectMainCardSenderCalls(items: readonly TerminalItem[]): Map<string, CardSenderCall[]> {
  const bySub = new Map<string, CardSenderCall[]>();
  for (const it of items) {
    if (it.kind !== 'group' || it.groupType !== 'tool') continue;
    const entries = it.entries;
    for (let k = 0; k < entries.length; k++) {
      const use = entries[k]!;
      if (use.type !== 'tool_use' || !use.subAgentId || !isCardSenderCandidate(use.toolName, use.text)) continue;
      // 이 호출의 결과 = 다음 호출 전까지 따라붙은 결과 줄들(`groupEntries` 가 짝지은 그대로).
      let output = '';
      for (let j = k + 1; j < entries.length && entries[j]!.type !== 'tool_use'; j++) {
        if (entries[j]!.type === 'tool_result') output += entries[j]!.text;
      }
      const calls = bySub.get(use.subAgentId);
      const call: CardSenderCall = { at: use.timestamp, sortTs: it.timestamp, input: use.text, output };
      if (calls) calls.push(call); else bySub.set(use.subAgentId, [call]);
    }
  }
  return bySub;
}

/** 이 카드가 설 정렬 키 — 같은 세션의 후보로만 판정한다(세션을 모르는 카드는 신고 시각 그대로). */
export function mainCardPlacementTs(
  kind: SentCardKind,
  card: { id: string; createdAt: number; subAgentId?: string },
  callsBySub: ReadonlyMap<string, readonly CardSenderCall[]>,
): number {
  return cardPlacementTs(kind, card, card.subAgentId ? callsBySub.get(card.subAgentId) : undefined);
}

// ─── §5.5 #17-39 ⑩: 간결에서 이어 붙은 사고 자국 합치기(메인 탭 판본) ───
//   판정은 Sub 탭(`applyStreamDensity`)과 **같은 함수**(`mergeAdjacentThinkTraces`)가 한다 — 여기는 읽기·쓰기만.

/** 타임라인 노드가 사고 자국이면 합치기가 읽는 모양으로, 아니면 `null`(= 구간이 끊긴다 — 본문·카드·라이브 1줄 전부). */
function readMainStepTrace(n: MainTimelineNode): ThinkTraceView | null {
  if (n.t !== 'item' || n.item.kind !== undefined || n.item.type !== 'step') return null;
  const e = n.item;
  return { ms: (e.endedAt ?? e.timestamp) - e.timestamp, chars: e.stepChars ?? 0, owner: e.stepOwner };
}

/** 합친 시간·분량을 든 새 노드 — id·자리는 첫 자국 그대로, `endedAt` 은 시작 + 사고 시간의 합(Sub 탭과 같은 규약). */
function writeMainStepTrace(n: MainTimelineNode, ms: number, chars: number): MainTimelineNode {
  if (n.t !== 'item' || n.item.kind !== undefined) return n;
  return { t: 'item', item: { ...n.item, endedAt: n.item.timestamp + ms, stepChars: chars } };
}

/** §5.5 읽기 설정 — 메인 탭은 `.ide-md` 그리드가 없어 도구 줄·도구 묶음만 칼럼 밖으로, 나머지는 칼럼 안. */
function mainTimelineReadingKind(n: MainTimelineNode): string {
  if (n.t !== 'item') return n.t;
  if (n.item.kind === 'group') return n.item.groupType === 'tool' ? 'toolgroup' : n.item.groupType;
  if (n.item.kind === 'plan' || n.item.kind === 'thinking-live') return n.item.kind;
  return n.item.type === 'tool_use' || n.item.type === 'tool_result' ? 'tool' : n.item.type;
}

/** 스트림 이벤트 + 명령 대기열 + agentEvents를 통합하여 터미널 항목 생성 */
export function buildEntries(
  commands: QueuedCommand[],
  subAgents: SubAgent[],
  streams: Record<string, SubAgentStreamEvent[]>,
  activeSessionId: string | null,
  agentEvents: AgentEvent[],
  // §5.5 #17-12 ③ — 실패 사유를 사람 문장으로 바꾸는 로케일 주입(이 함수는 순수하게 유지한다).
  formatError: (error: CommandError) => string,
  // Recovery follows original command states, not displayCommands' promoted queued copies.
  originalCommands: QueuedCommand[] = commands,
  runningTasks?: RunningSubagentTask[],
): TerminalEntry[] {
  const entries: TerminalEntry[] = [];
  const subLabelMap = new Map(subAgents.map((s) => [s.id, s.label]));

  /** Main/sub views share the transport accumulator; each session owns a separate episode. */
  const pushStreamEntries = (events: SubAgentStreamEvent[], subId: string, label?: string): void => {
    const sessionCommands = originalCommands.filter((cmd) => cmd.subAgentId === subId);
    const anchors = dispatchedTurnAnchorsAsc(sessionCommands);
    const recovery = new TransportRecoveryAccumulator();
    const errors = new StreamErrorAccumulator();
    const recoveryRows: StreamSystem[] = [];
    const makeStreamEntry = (evt: SubAgentStreamEvent): TerminalEntry => ({
      id: evt.id,
      type: evt.imagePath ? 'image' : evt.eventType,
      text: evt.eventType === 'error' ? formatError(parseStreamErrorContent(evt.content)) : evt.content,
      timestamp: evt.timestamp,
      sessionLabel: label,
      toolName: evt.toolName,
      subAgentId: subId,
      ...(evt.eventType === 'error' ? { error: parseStreamErrorContent(evt.content) } : {}),
      ...(evt.imagePath ? { imageSubAgentId: subId } : {}),
    });
    for (const evt of events) {
      // Thinking is evidence of resumed work even though its raw body is hidden below.
      if (recovery.consume(evt, turnOfEvent(evt, anchors), recoveryRows)) continue;
      if (isThinkingActivity(evt) || isHiddenSystemEvent(evt)) continue;
      if (!errors.consume(evt, turnOfEvent(evt, anchors), entries, makeStreamEntry)) entries.push(makeStreamEntry(evt));
    }
    const sub = subAgents.find((candidate) => candidate.id === subId);
    const running = sub !== undefined && isSessionRunning(buildSessionRunInputs({
      sub, commands: originalCommands, runningTasks, acknowledged: false,
    }));
    recovery.projectStopped(recoveryRows, sessionCommands, running);
    for (const row of recoveryRows) {
      entries.push({
        id: row.id, type: 'system', text: row.content, timestamp: row.timestamp,
        sessionLabel: label, transportRecovery: row.transportRecovery,
      });
    }
    pushThinkTraces(events, subId, label);
  };

  /** §5.5 #17-39 — 사고 런 → 단계 자국. 판정은 Sub 탭과 같은 `collectThinkRuns`(펄스·숨김 system 제외) — 탭마다 자국 수가 달라지지 않게. */
  const pushThinkTraces = (events: SubAgentStreamEvent[], subId: string, label?: string): void => {
    for (const run of collectThinkRuns(events, (e) => isThinkingPulse(e) || isHiddenSystemEvent(e))) {
      entries.push({
        id: `step-${run.firstId}`,
        type: 'step',
        text: '',
        timestamp: run.startedAt,
        endedAt: run.endedAt,
        stepChars: run.chars,
        // §5.5 #17-39 ⑩ — 런을 끊는 주인(중첩 Task)에 세션까지 더한 키. 전체 보기에서 세션이 섞여 와도 안 섞인다.
        stepOwner: run.nested ? `${subId}/${run.nested}` : subId,
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

  // 대기열 프롬프트는 상태 무관(대기 포함) 내 말풍선으로(§5.5 #17-18 ⑤). 상태는 `command` 로 — 색과 대기 중 방식 칩·삭제는 말풍선이 그린다.
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
      pushStreamEntries(events, subId, subLabelMap.get(subId));
    }
  } else {
    // 특정 세션만
    const events = streams[activeSessionId];
    if (events) {
      pushStreamEntries(events, activeSessionId);
    }
  }

  // 완료/오류 결과 — 그 턴의 말이 스트림에 없을 때만 cmd.result 폴백(§5.5 #17-12 ③-3, Sub 탭과 같은 턴 단위 `turnCoverageOf`).
  const coverageBySub = new Map<string, TurnCoverage>();
  const coverageFor = (subId: string): TurnCoverage => {
    let cov = coverageBySub.get(subId);
    if (!cov) {
      cov = turnCoverageOf(streams[subId] ?? [], dispatchedTurnAnchorsAsc(commands.filter((c) => c.subAgentId === subId)));
      coverageBySub.set(subId, cov);
    }
    return cov;
  };
  for (const cmd of targetCmds) {
    if (cmd.status !== 'completed' && cmd.status !== 'error') continue;
    const sessionLabel = activeSessionId === null && cmd.subAgentId
      ? subLabelMap.get(cmd.subAgentId)
      : undefined;

    const coverage = cmd.subAgentId ? coverageFor(cmd.subAgentId) : emptyTurnCoverage();
    // §5.5 #17-12 ③ — 실패 사유. 그 턴의 오류 줄이 스트림에 이미 있으면 그 자리가 진짜 시점이므로 겹쳐 쓰지 않는다.
    if (cmd.status === 'error' && cmd.error && !coverage.failed.has(cmd.id)) {
      entries.push({
        id: `cmderr-${cmd.id}`,
        type: 'error',
        // §5.5 #17-18 ⑥ — 결과 줄은 그 명령의 말풍선 **바로 아래**에 붙는다(같은 기준 + 1).
        text: formatError(cmd.error),
        error: cmd.error,
        timestamp: commandAnchorTs(cmd) + 1,
        sessionLabel,
      });
    }
    if (!cmd.result) continue;
    // 그 턴의 본문·result 줄이 버퍼에 있으면 답은 이미 스트림에서 그려진다 — 창 밖으로 밀려난 턴만 여기서 말한다.
    if (coverage.answered.has(cmd.id)) continue;

    entries.push({
      id: `cmdres-${cmd.id}`,
      type: cmd.status === 'error' ? 'error' : 'result',
      text: cmd.result,
      timestamp: commandAnchorTs(cmd) + 1,
      sessionLabel,
    });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);

  // 같은 세션의 연속 text 는 한 말풍선으로 합친다(델타 조각 — StreamRenderer textBuf 와 같다). 세션이 다르거나 비-text 가 끼면 끊는다.
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
/** §5.5 #17-12 — 메인 탭 밀도(Sub 탭 streamDensity 와 같은 규칙): 연속 동종 도구(진행 중 제외) → `도구 ×N`, 같은 턴의 옛 계획은 접기. `raw` 는 그대로. */
export function applyMainDensity(items: TerminalItem[], density: StreamDensity): TerminalItem[] {
  // §5.5 #17-13 ⑤-3 — 작업 칩(시작·끝)을 한 줄로 접는다. Sub 탭(`applyStreamDensity`)과 **같은 함수**라
  //   두 탭이 같은 스트림을 같은 모양으로 접는다.
  const folded = foldTaskChips(
    items,
    (it) => (it.kind === undefined && it.type === 'system' && !it.transportRecovery ? it.text : null),
    (it, text) => (it.kind === undefined && it.type === 'system' ? { ...it, text } : it),
  );
  if (density === 'raw') return folded;

  // §5.5 #17-13 ⑤ — SDK 상태 칩(`[task_started]` 레일 점)은 간결/표준에서 그리지 않는다(내용 없는 한 줄).
  //   내용이 있는 system 본문(권한 결정 등)은 subtype 단독 패턴이 아니므로 그대로 남는다.
  // §5.5 #17-15 — 사고는 밀도 축에서 빠졌다(항목 조립 시점에 이미 없다 — 여기서 거를 것이 없다).
  const shown = folded.filter((it) => (
    !(it.kind === undefined && it.type === 'system' && !it.transportRecovery && isSystemSubtypeChip(it.text))
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
    if (it.type === 'system') return !it.transportRecovery;
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

  // §5.5 #17-21 ① / #17-24 ① — 간결은 도구 묶음을 진행 중이든 뺀다(남기면 시작·완료마다 깜빡인다 — 작동 중은 라이브 1줄이 알린다).
  // 흡수된 오류·권한 결정 system 본문은 묶음 밖으로 꺼내 남긴다.
  if (density === 'compact') {
    const compacted: TerminalItem[] = [];
    for (const it of out) {
      if (!(it.kind === 'group' && it.groupType === 'tool')) { compacted.push(it); continue; }
      for (const e of it.entries) {
        if (e.type === 'system' && (e.transportRecovery || !isSystemSubtypeChip(e.text))) compacted.push(e);
      }
    }
    // §5.5 #17-43 — 본문은 **하나도 걸러내지 않는다**(Sub 탭 `applyStreamDensity` 와 동일). 종전
    //   규칙(#17-26 ①)의 "턴당 처음·마지막" 상한이 사이의 발견·경고·결정까지 잘라 냈다. 간결이 숨기는
    //   것은 명령창(도구 묶음)뿐이다.
    return compacted;
  }
  return out;
}

export function groupEntries(flat: TerminalEntry[]): TerminalItem[] {
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

/** §5.5 #17-39 — 메인 탭 단계 자국. 훅을 써서 별도 조각이다(`TerminalLine` 은 분기마다 early return). */
function TerminalStepLine({ entry }: { entry: TerminalEntry }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const ms = (entry.endedAt ?? entry.timestamp) - entry.timestamp;
  return <StepTraceLine text={thinkTraceText(t, i18n.language, ms, entry.stepChars ?? 0)} />;
}

/** 메인 탭 AI 본문 — §5.5 #17-49 어느 밀도에서도 접지 않는다(Sub 탭 `TextBlock` 과 같다). 훅을 써서 별도 컴포넌트. */
function TerminalTextLine({ entry, density, run }: { entry: TerminalEntry; density: StreamDensity; run: SpeechRunPos }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // §5.5 #17-39 — 작성 자국(Sub 탭 TextBlock 과 같은 문턱·같은 문구 함수). 메인 탭의 본문 항목은
  //   buildEntries 가 연속 델타를 합쳐 만든 것이라 끝 시각이 따로 없다 — 분량만 적는다(시간은 0).
  const writeTrace = density !== 'compact' && shouldTraceWriting(entry.text.length)
    ? writeTraceText(t, i18n.language, (entry.endedAt ?? entry.timestamp) - entry.timestamp, entry.text.length)
    : null;
  return (
    // §5.5 #17-45 — 세로 여백은 본문 칸이 갖는다(Sub 탭 `TextBlock` 과 같은 구조 — 왼쪽 말머리 칸이
    //   항목 높이를 꽉 채워야 런의 실선이 끊기지 않는다). `solo` 는 종전과 높이가 같다.
    <div className="px-3 max-md:px-1.5">
      <div className="flex gap-2">
        <AiSpeakerGlyph run={run} />
        <div className={`min-w-0 flex-1 ${run === 'mid' || run === 'tail' ? 'py-0.5' : 'py-1'}`}>
          <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-200">
            {entry.sessionLabel && (
              <span className="mr-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[12px] font-semibold text-cyan-400/80">
                {entry.sessionLabel}
              </span>
            )}
            {entry.text}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TerminalLine({ entry, density, run, agentId }: { entry: TerminalEntry; density?: StreamDensity; run?: SpeechRunPos; agentId?: string }): React.JSX.Element {
  if (entry.transportRecovery) {
    return <TransportRecoveryLine recovery={entry.transportRecovery} content={entry.text} sessionLabel={entry.sessionLabel} />;
  }
  if (entry.type === 'error' && entry.error) {
    return <div className="mx-2 my-1">
      {entry.sessionLabel && <div className="mb-1 px-3 text-[12px] text-cyan-400/80">{entry.sessionLabel}</div>}
      <CommandErrorNotice error={entry.error} />
    </div>;
  }
  // §5.5 #17-39 — 단계 자국(끝난 사고 런). Sub 탭과 **같은 조각·같은 문구 함수**를 쓴다.
  if (entry.type === 'step') return <TerminalStepLine entry={entry} />;
  // SDK system 메시지 subtype([task_started] 등)은 날 텍스트 대신 깔끔한 칩으로.
  if (entry.type === 'system') {
    // §5.3 #9-2 — 메모리 보호 알림은 세션 탭과 같은 줄로(문장은 로케일로 만든다).
    const guard = parseProcessGuardNotice(entry.text);
    if (guard) return <ProcessGuardLine notice={guard} content={entry.text} sessionLabel={entry.sessionLabel} />;
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
      // §4 — 폰(max-md)에선 좌우 여백 압축(Sub 탭 블록들과 같은 방침).
      <div className="px-3 py-1 max-md:px-1.5">
        <CollapsiblePrompt prompt={entry.text} command={command} submittedAt={entry.submittedAt} />
      </div>
    );
  }
  // AI 일상 대화(assistant text)는 Sub 탭 TextBlock 과 동일하게 박스 없이 평범한 본문 + 왼쪽 스파클
  // 글리프로만 표식한다(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분).
  if (entry.type === 'text') {
    return <TerminalTextLine entry={entry} density={density ?? 'standard'} run={run ?? 'solo'} />;
  }
  // §5.25 (O) — 엔진이 내건 그림. **Sub 탭과 같은 조각**을 쓴다(두 벌로 두면 한쪽만 고쳐진다).
  //   밀도로 접지 않는다 — 그림은 줄이면 아무 말도 못 한다.
  if (entry.type === 'image') {
    return (
      <div className="px-3 py-1.5 max-md:px-1.5">
        {entry.sessionLabel && (
          <span className="mb-0.5 mr-1.5 inline-block rounded bg-cyan-500/15 px-1 py-0.5 text-[12px] font-semibold text-cyan-400/80">
            {entry.sessionLabel}
          </span>
        )}
        <StreamImageThumb
          agentId={agentId}
          subAgentId={entry.imageSubAgentId}
          eventId={entry.id}
          name={entry.text}
        />
      </div>
    );
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
  // §5.5 #17-39 ⑪ — 묶이지 않은 도구 하나(원문 밀도)의 머리줄에도 그 도구가 쓴 시간 — Sub 탭 ToolBlock 과
  //   같은 함수·같은 규칙(1초 미만도 적는다). 끝은 **짝 결과 줄이 도착한 시각**이고, 결과 줄이 없으면 잴 수 없다.
  let callResultAt: number | undefined;
  if (isTool && !isRun && !group.isActive) {
    for (let k = group.entries.length - 1; k >= 0; k--) {
      const e = group.entries[k]!;
      if (e.type === 'tool_result') { callResultAt = e.timestamp; break; }
    }
  }
  const callElapsed = callResultAt === undefined ? '' : toolCallElapsedText(t, toolCallElapsedMs(group.timestamp, callResultAt));

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
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
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
              {/* §5.5 #17-39 ⑪ — 이 도구가 쓴 시간(이름 바로 뒤 — 묶음의 `×N` 뒤 경과와 같은 모양). */}
              {callElapsed && <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-600">{callElapsed}</span>}
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

/** §5.5 #17-38 — 이미 먹은 키. 한 문서에 IDE 판이 여럿이면 window 리스너도 여럿이라 받아쓰기가 켜졌다 꺼진다 — 먼저 잡은 쪽이 이벤트에 표시를 남긴다. */
const handledVoiceKeys = new WeakSet<KeyboardEvent>();

const API_BASE = '';

/**
 * paste 이미지 1장의 업로드/미리보기 상태(= `AgentSessionInputAttachment`, CommandInputPopup 과 같은 계약:
 * POST /api/agent-attachments/:sid/upload · DELETE /api/agent-attachments/:sid). 제출하면 blob URL 은 `attachmentPreviews` 로 넘긴다.
 */
type PastedAttachment = AgentSessionInputAttachment;

export function TerminalInput({ agentId, activeSessionId }: TerminalInputProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // §5.5 #17-12 ③ — 중지는 useSessionStop 하나(화면의 유일한 [중지]). §2.4 응답을 읽어 "멈출 것 없음"도 알린다.
  const {
    stopping, stop: handleStop, outcome: stopOutcome, clearOutcome: clearStopOutcome, forceStop,
  } = useSessionStop(agentId, activeSessionId);
  const addCommand = useGraphStore((s) => s.addCommand);
  const agents = useGraphStore((s) => s.agents);
  const registerAttachmentPreview = useGraphStore((s) => s.registerAttachmentPreview);
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const lightboxOrigin = useImageLightboxOrigin();
  const markSubAcknowledged = useGraphStore((s) => s.markSubAcknowledged);
  // §5.3 #28 — 세션 스코프 draft(text + attachments), key = agentSessionInputKey(agentId, activeSessionId).
  const draftKey = agentSessionInputKey(agentId, activeSessionId);
  const sessionDraft = useGraphStore((s) => s.agentSessionInputs[draftKey]);
  const inputProviderKind = useGraphStore((s) => s.agentConfigs[agentId]?.provider?.kind);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  const updateAgentSessionInputAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);
  const clearAgentSessionInput = useGraphStore((s) => s.clearAgentSessionInput);
  const text = sessionDraft?.text ?? '';
  const attachments = useMemo<PastedAttachment[]>(() => sessionDraft?.attachments ?? [], [sessionDraft]);
  const recoveredAttachmentPaths = useMemo(() => attachments.filter((a) => !a.previewUrl && a.serverPath).map((a) => a.serverPath), [attachments]);
  const recoveredAttachmentThumbs = useAttachmentThumbs(recoveredAttachmentPaths);
  const attachmentPreviewUrl = (a: PastedAttachment): string => a.previewUrl
    || recoveredAttachmentThumbs.find((thumb) => thumb.basename === a.serverPath.split(/[/\\]/).pop())?.url || '';
  const setText = useCallback(
    (next: string) => setAgentSessionInputText(agentId, activeSessionId, next),
    [agentId, activeSessionId, setAgentSessionInputText],
  );
  const setAttachments = useCallback(
    (updater: (prev: PastedAttachment[]) => PastedAttachment[]) =>
      updateAgentSessionInputAttachments(agentId, activeSessionId, updater),
    [agentId, activeSessionId, updateAgentSessionInputAttachments],
  );
  // §5.3 #28 — 외부 트리거가 setAgentInputDraft 로 넣은 시드를 textarea 로 옮기고 consume 한다. 자동 send ❌(사용자가 Send 를 누른다).
  const draftForAgent = useGraphStore((s) => s.agentInputDrafts[agentId]);
  const consumeAgentInputDraft = useGraphStore((s) => s.consumeAgentInputDraft);
  // 이 탭이 돌고 있나(Run/Stop). 메인 탭은 대상이 모호해 Run. `executing` 만 보지 마라 — 봉인 만료 뒤 깨어난 세션은
  // 명령 없이 `SubAgent.status` 만 active 라 [중지]가 사라진다(`isSessionRunning` 이 세션 축까지 본다).
  const sessionRunning = useSessionRunning(agentId, activeSessionId) && activeSessionId !== null;
  // §5.5 #17-10 — 컴팩트 [중지](멈출 게 있을 때만). 세션 탭은 `sessionRunning` 이 백그라운드 Task 까지 보므로 이것은 메인 탭 전용 `stop-all`.
  const agentBusyElsewhere = useSessionRunning(agentId, null) && activeSessionId === null;
  const sid = useMemo(() => agents.find((a) => a.id === agentId)?.path ?? null, [agents, agentId]);
  const sidRef = useRef<string | null>(sid);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputOwnerRef = useRef(draftKey);
  inputOwnerRef.current = draftKey;
  const isCurrentInput = useCallback((el: HTMLTextAreaElement, owner: string): boolean =>
    el.isConnected && textareaRef.current === el && inputOwnerRef.current === owner, []);
  useEffect(() => {
    const el = textareaRef.current;
    return () => { if (el) cancelPendingInputEdits(el); };
  }, [draftKey]);
  const restoreCaret = useCallback((el: HTMLTextAreaElement, value: string, caret: number, focus = true): void => {
    restoreInputSelection(el, value, caret, caret, () => isCurrentInput(el, draftKey), focus);
  }, [draftKey, isCurrentInput]);
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
  // §5.5 #17-38 ⑰⑱ — 받아쓰기 두 스위치(잡음 억제 · 띄어쓰기 복원). 줌·밀도와 동형인 순수 클라
  //   환경설정이라 서버로 가지 않는다. 마이크 팝업에서 켜고 끈다.
  const voiceDenoise = useGraphStore((s) => s.ideVoiceDenoise);
  const voiceRespace = useGraphStore((s) => s.ideVoiceRespace);
  const setIdeVoiceDenoise = useGraphStore((s) => s.setIdeVoiceDenoise);
  const setIdeVoiceRespace = useGraphStore((s) => s.setIdeVoiceRespace);
  // 확정 콜백은 인식기에 **한 번 붙인 함수**로 계속 도므로, 스위치를 바꾼 뒤에도 옛 값이 박히지
  //   않게 ref 로 읽는다(같은 이유로 훅 안에서도 콜백은 전부 ref 다).
  const voiceRespaceRef = useRef(voiceRespace);
  voiceRespaceRef.current = voiceRespace;
  /** 확정된 말은 커서 자리에(맨 뒤 ❌ — 문장 가운데를 고치다 켜기도 한다). 규칙은 shared `mergeVoiceText`, 여기선 결과만 옮긴다. */
  const handleVoiceCommit = useCallback((chunk: string) => {
    const el = textareaRef.current;
    if (!el) return;
    // §5.5 #17-38 ⑱ — 끼우기 전에 토막의 띄어쓰기를 복원한다(엔진은 공백을 안 낸다 — `--help` 실측, spacing 옵션 없음).
    // `mergeVoiceText` 는 토막과 기존 글의 경계만 다루므로 먼저 다듬어야 손으로 쓴 글을 안 건드린다.
    const polished = polishVoiceChunk(chunk, voiceRespaceRef.current);
    afterInputComposition(el, () => {
      if (!isCurrentInput(el, draftKey)) return;
      const current = el.value;
      const range = boundedTextSelection(current, el.selectionStart, el.selectionEnd);
      const merged = mergeVoiceText(current, range.start, range.end, polished);
      setText(merged.text);
      restoreCaret(el, merged.text, merged.caret, false);
    });
  }, [setText, draftKey, isCurrentInput, restoreCaret]);
  // §5.5 #17-38 ⑬ — 인식기가 준비돼 있는지는 **서버가 디스크를 보고** 답한다. 준비가 안 됐으면
  //   마이크를 열지 않고 설치 창을 띄운다(열었다 곧 닫으면 OS 표시가 깜빡여 고장으로 읽힌다).
  const voiceAsr = useVoiceAsr();
  const [voiceInstallOpen, setVoiceInstallOpen] = useState(false);
  const voiceSessionKey = `${agentId}:${activeSessionId ?? 'none'}`;
  const voiceAsrRef = useRef(voiceAsr);
  voiceAsrRef.current = voiceAsr;

  /** 누름 → 마이크 왕복을 하나로: "준비됨"을 알면 곧장 띄우고, 틀렸으면(폴더 삭제) 실패한 자리에서 서버에 되묻는다(정본은 서버 — `hooks/voiceOpenGate.ts`). */
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
    // ⑰ — 켜는 그 순간의 값이 제약이 된다. 듣는 도중 바꾸면 다음 켜기부터 반영된다.
    denoise: voiceDenoise,
    resolvePort: requestVoicePort,
    onNeedsInstall: handleVoiceNeedsInstall,
    onSessionEnd: handleVoiceSessionEnd,
  });
  const voiceActive = voice.status === 'starting' || voice.status === 'listening';
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const voiceShortcut = useMemo(() => shortcutLabel(VOICE_INPUT.SHORTCUT), []);
  // §5.5 #17 — 입력칸 x 의 호버 안내. 되돌리기는 브라우저 것이라 표기만 OS 를 따른다.
  const undoShortcut = useMemo(() => shortcutLabel('Ctrl+Z'), []);
  // §5.5 #17-38 ⑮ — 마이크가 막혔을 때 **데려다 주는** 판. 우클릭으로도, 실패 안내의
  //   [해결 방법] 으로도 같은 판이 뜬다(같은 물음에 대한 답이라 두 벌로 만들지 않는다).
  const micSettings = useMicSettings();
  const [micPopupOpen, setMicPopupOpen] = useState(false);
  // 이 판이 "고장 안내"인지 "그냥 설정 보기"인지 — 머리말이 갈린다.
  const micBlocked = voice.status === 'error' && voice.error !== null && isMicAccessFixable(voice.error);
  // 마이크가 **아예 없는 것이 확인된** 경우 — 팝업이 연결을 먼저 말한다.
  const micNoDevice = voice.error !== null && isNoDeviceError(voice.error);
  const handleOpenMicSettings = useCallback((): void => {
    void micSettings.open();
  }, [micSettings]);
  /** 마이크 우클릭 = 설정 판. 전역 입력칸 메뉴가 가로채지 않게 기본 메뉴를 막는다(`data-text-menu` 와 같은 규율). */
  const handleMicContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setMicPopupOpen((prev) => !prev);
  }, []);

  /**
   * 단축키(#17-38 ③) — 초점이 입력창 밖이어도 먹되 초점이 이 판 안(data-ide-main)인지 본다(아니면 IDE 수만큼 토글된다).
   * capture 로 받는다 — bubble 이면 입력창 Escape(비우기)가 받아쓰기 취소보다 먼저 돌아 쓰던 글이 날아간다.
   */
  useEffect(() => {
    if (!voiceCellFocused) return;
    const onKey = (e: KeyboardEvent): void => {
      if (isComposingKeyEvent(e)) return;
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

  // §5.5 #17-2 / #17-4 — 슬래시 자동완성(`useAvailableSkills` 모듈 캐시, 이 에이전트 프로젝트의 스킬만) + CLI 내장 명령(드롭다운 전용).
  const slashProjectName = useGraphStore((s) => s.agentProjects[agentId]);
  const { skills: availableSkills, builtins: builtinCommands, loaded: skillsLoaded, slashCommandsEnabled } = useAvailableSkills(slashProjectName, agentId);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashListRef = useRef<HTMLDivElement>(null);
  // 방향키 이동일 때만 활성 항목 스크롤 추종 — hover 로 인한 setSlashIndex 까지 추종하면
  // 스크롤이 항목을 커서 밑으로 밀어 mouseEnter 가 재발화하는 되먹임이 생긴다.
  const slashKeyboardNavRef = useRef(false);

  useEffect(() => { sidRef.current = sid; }, [sid]);

  // 세션 전환/외부 텍스트 변경 시 textarea height 재조정 — JS 폴백 전용(field-sizing 지원 시 no-op).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    autosizeInput(el);
  }, [activeSessionId, text]);

  // §5.3 #28 — draft hydrate. 시드를 지금 활성 세션의 draft 로 옮기고 consume 한다(중복 prefill 방지).
  useEffect(() => {
    if (draftForAgent === undefined) return;
    if (typeof draftForAgent === 'string' && draftForAgent.length > 0) {
      const el = textareaRef.current;
      if (!el) return;
      afterInputComposition(el, () => {
        if (!isCurrentInput(el, draftKey)) return;
        const consumed = consumeAgentInputDraft(agentId);
        if (typeof consumed !== 'string' || consumed.length === 0) return;
        setAgentSessionInputText(agentId, activeSessionId, consumed);
        restoreCaret(el, consumed, consumed.length);
      });
    }
  }, [draftForAgent, agentId, activeSessionId, consumeAgentInputDraft, setAgentSessionInputText, draftKey, isCurrentInput, restoreCaret]);

  // 초안은 입력창의 수명이 아니라 세션에 속한다. 프로젝트 이동·창 교체·닫기에서
  // unmount 되어도 글과 첨부를 함께 보존한다. 첨부 제거는 사용자의 삭제/제출에서만 한다.

  // paste 시점 세션을 잡아 그 draft 의 attachments 를 고친다 — 업로드 중 세션을 바꿔도 원래 세션에 기록된다.
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
    // 첨부 미리보기 줄이 끼며 textarea 가 focus 를 잃을 수 있어 paste 직후와 다음 프레임에 focus 를 되돌린다.
    const el = e.currentTarget;
    const sessionAtPaste = activeSessionId;
    const valueAtPaste = el.value;
    for (const f of files) void uploadFile(f, sessionAtPaste);
    restoreInputSelection(el, valueAtPaste, el.selectionStart, el.selectionEnd,
      () => isCurrentInput(el, draftKey), true);
  }, [uploadFile, activeSessionId, draftKey, isCurrentInput]);

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
  const localImagesUnsupported = inputProviderKind === 'local-llama' && attachments.length > 0;
  const canSubmit = text.trim().length > 0 && !hasPendingUploads && !localImagesUnsupported;

  /**
   * @param live 입력칸의 **현재 값**(Enter 집행이 넘겨준다). 없으면 DOM → 스토어 순으로 찾는다.
   */
  const handleSubmit = useCallback((live?: string) => {
    const el = textareaRef.current;
    // §6(조합 입력 보호) — 조합 **중**이면 보내지 않는다(보내면 고르던 후보가 빈 칸에 되살아난다).
    //   단 확정 직후의 정착 프레임은 조합이 아니다 — 글자는 이미 칸에 들어와 있고, 그걸 조합으로
    //   세던 것이 "한글 첫 Enter 가 늘 줄바꿈"의 정체다.
    if (isComposingNow(el)) return;
    // 값의 정본은 **입력칸 자신**이다. 확정 직후 프레임에는 React 가 아직 마지막 글자를 받지 못했을
    //   수 있고, 통제 입력칸이라 DOM 값은 언제나 사용자가 본 그대로다. 렌더 시점 클로저(`text`)를
    //   읽으면 마지막 음절이 빠진 글이 나간다.
    const draft = useGraphStore.getState().agentSessionInputs[draftKey];
    const current = live ?? (el && isCurrentInput(el, draftKey) ? el.value : draft?.text ?? '');
    const trimmed = current.trim();
    if (!trimmed) return;
    const pending = draft?.attachments ?? [];
    if (pending.some((a) => a.uploading)) return;
    if (useGraphStore.getState().agentConfigs[agentId]?.provider?.kind === 'local-llama' && pending.length > 0) return;
    const submitted = pending.filter((a) => !a.uploading && a.serverPath && !a.error);
    const paths = submitted.map((a) => a.serverPath);
    // 제출한 첨부의 blob URL 은 스토어로 넘긴다(basename 키) — draft 에서 비우되 revoke ❌(소유권 이전, StreamStatusBar 가 읽는다).
    const basenameOf = (p: string): string => {
      const parts = p.split(/[/\\]/);
      return parts[parts.length - 1] ?? '';
    };
    for (const a of submitted) {
      if (a.previewUrl) registerAttachmentPreview(basenameOf(a.serverPath), a.previewUrl);
    }
    clearStopOutcome(); // A delayed answer to the previous stop must not describe this new command.
    addCommand(agentId, trimmed, activeSessionId, paths);
    // 에러·업로드 중 첨부가 없으면 draft 를 지우고(키 정리), 있으면 text 만 비운다.
    const remaining = pending.filter((a) => a.uploading || a.error || !a.serverPath);
    if (remaining.length === 0) {
      clearAgentSessionInput(agentId, activeSessionId);
    } else {
      setText('');
      setAttachments(() => remaining);
    }
    if (el) {
      // 보낸 글은 칸에서도 그 자리에 지운다 — React 가 다시 그리기 전에 같은 Enter 가 한 번 더
      //   들어와도 DOM 값이 비어 있어 둘째는 스스로 멈춘다(중복 전송 차단).
      if (isCurrentInput(el, draftKey)) el.value = '';
      if (!INPUT_FIELD_SIZING) el.style.height = 'auto';
    }
    // 전송하면 히스토리 탐색 상태·힌트 초기화(적재는 addCommand 가 한다 — #17-23).
    historyNavRef.current = null;
    setHint(null);
  }, [draftKey, isCurrentInput, agentId, activeSessionId, addCommand, clearStopOutcome, registerAttachmentPreview, clearAgentSessionInput, setText, setAttachments, setHint]);

  // §5.5 #17-10 — [중지] 단위는 보고 있는 세션(+ 그 서브): 세션 탭은 stop-session, 메인 탭만 stop-all(올리면 다른 탭까지 끊긴다). 둘 다 멱등(200).

  // §5.5 #17-2 — `/` 로 시작해 첫 토큰을 치는 중이면 연다(0건이어도). 스킬 뒤에 CLI 내장 명령(별칭 포함), 같은 이름은 스킬이 이긴다(Claude Code 규칙).
  // §5.19 (G) · §5.25 (B) — 프로바이더 버블엔 띄우지 않는다(클로드 명령이 없고 코덱스 목록은 우리에게 안 온다).
  const isProviderAgent = useGraphStore((s) => (agentId ? !!s.agentConfigs[agentId]?.provider : false));
  // §4 (슬래시 명령 가용성) — CMD 버블(`interactive-terminal`)은 진짜 REPL 이라 화면 있는 명령도 전부 된다.
  //   헤드리스일 때만 "터미널 필요" 배지를 단다 — 되는 곳에서 안 된다고 하면 그게 더 나쁜 거짓말이다.
  const isInteractiveTerminalAgent = useGraphStore(
    (s) => (agentId ? s.agentConfigs[agentId]?.executionMode === 'interactive-terminal' : false),
  );
  const slashState = useMemo(() => {
    if (isProviderAgent) return null;
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
  }, [text, availableSkills, builtinCommands, isProviderAgent]);

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
    const el = textareaRef.current;
    if (!el || isInputComposing(el)) return;
    const next = `/${item.name} `;
    setAgentSessionInputText(agentId, activeSessionId, next);
    restoreCaret(el, next, next.length);
  }, [agentId, activeSessionId, setAgentSessionInputText, restoreCaret]);

  // §5.5 #17-23 — 이 세션의 프롬프트를 ↑/↓ 로(첫 줄 ↑ · 끝 줄 ↓ 만, 슬래시·IME 중엔 쉼). 진입은 두 번 누름(첫 키는 힌트, 꺼낼 게 없으면 안 가로챈다).
  // 목록은 구독 ❌ — 키를 누를 때 commandHistory 캐시에서 읽는다(큐 구독은 리렌더만 늘고 완료분이 빠진다). 탭을 옮기면 탐색 상태를 버린다.
  useEffect(() => {
    historyNavRef.current = null;
    historyHintRef.current = null;
    setHistoryHint(null);
  }, [agentId, activeSessionId]);
  // 저장분이 없으면 완료 아카이브에서 한 번 끌어온다(이후 입구는 addCommand). 아카이브를 의존성에 둔다 — 창을 연 순간엔 스냅샷이 없을 수 있다
  // (구조적 공유라 리렌더 부담 없음).
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
      .filter((c) => !c.silent) // §5.3 #9-1 (P) — 우리가 끼운 압축도 사용자가 친 것이 아니다(↑ 로 나오면 안 된다)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((c) => c.text ?? '');
    seedCommandHistory(agentId, activeSessionId, seen);
  }, [agentId, activeSessionId, completedForAgent]);
  const applyHistoryText = useCallback((value: string) => {
    const el = textareaRef.current;
    if (!el || isInputComposing(el)) return;
    setText(value);
    restoreCaret(el, value, value.length);
  }, [setText, restoreCaret]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // §6 — Enter 는 보내기, 줄바꿈은 Shift+Enter 뿐. 기준은 "입력기가 키를 먹었나": 먹힌 키(일·중 변환 확정)는 흘려보내고
    // 빠져나온 Enter(한글 확정)는 보낸다 — 뭉뚱그리면 첫 Enter 가 줄바꿈이 된다(`decideEnterKey`).
    const imeConsumed = isImeConsumedKey(e.nativeEvent);
    const composing = imeConsumed || isInputComposing(e.currentTarget);
    const slashMatched = slashOpen && slashState ? slashState.matched : [];
    const enter = decideEnterKey({
      key: e.key,
      shiftKey: e.shiftKey,
      chordKey: e.ctrlKey || e.metaKey,
      imeConsumed,
      slashMatchCount: slashMatched.length,
    });
    if (enterCancelsDefault(enter)) {
      e.preventDefault();
      if (enter.kind === 'imeCommit') return;
      if (enter.kind === 'slash') {
        const picked = slashMatched[Math.min(slashIndex, slashMatched.length - 1)];
        if (picked) confirmSlash(picked);
      } else {
        // 실행 중 Enter 는 덧말(큐에 넣기) — Enter 로 중지하지 않는다(중지는 [중지] 버튼).
        handleSubmit((e.currentTarget as HTMLTextAreaElement).value);
      }
      return;
    }
    // 나머지 명령(슬래시 Tab/Escape · 이력 방향키)은 종전대로 입력기의 후보 확정·이동이 우선이다.
    if (composing) return;
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
      // Enter 로 고르는 길은 위 decideEnterKey 가 이미 집행했다 — 여기는 Tab 만 남는다.
      if (e.key === 'Tab' && matched.length > 0) {
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
    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    // 방향키가 아닌 키를 누르면 힌트를 내린다(= 다음엔 다시 두 번 눌러야 들어간다).
    if (!isArrow && historyHintRef.current !== null) setHint(null);
    if (!slashOpen && isArrow) {
      const el = textareaRef.current;
      if (el && el.selectionStart === el.selectionEnd) {
        // 커서 이동이 우선 — 가로채지 않고(preventDefault ❌) 커서가 실제로 움직였는지로 경계를 본다(`\n` 계산은 워드랩 줄에서 틀린다).
        const direction = e.key === 'ArrowUp' ? 'prev' : 'next';
        const beforeCaret = el.selectionStart ?? 0;
        const beforeValue = el.value;
        if (arrowProbeRef.current !== null) clearTimeout(arrowProbeRef.current);
        arrowProbeRef.current = setTimeout(() => {
          arrowProbeRef.current = null;
          const el2 = textareaRef.current;
          if (!el2 || !isCurrentInput(el2, draftKey) || el2 !== el || isInputComposing(el2) || el2.value !== beforeValue) return;
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
    // Shift+Enter 줄 추가 — field-sizing 이 높이를 늦게 늘려 새 줄이 가려질 수 있어 rAF 뒤 caret 이 끝이면 바닥으로 스크롤(엔터 때만 도는 레이아웃 읽기).
    if (e.key === 'Enter' && e.shiftKey) {
      const el = textareaRef.current;
      if (el) {
        const atEnd =
          el.selectionStart === el.selectionEnd && (el.selectionStart ?? 0) >= el.value.length;
        requestAnimationFrame(() => {
          const e2 = textareaRef.current;
          if (!e2 || e2 !== el || !isCurrentInput(e2, draftKey) || isInputComposing(e2)) return;
          autosizeInput(e2); // JS 폴백 환경에서 즉시 재측정(field-sizing 지원 시 no-op)
          if (atEnd) e2.scrollTop = e2.scrollHeight; // 새 줄/caret 을 뷰에 유지
        });
      }
    }
  }, [slashOpen, slashState, slashIndex, confirmSlash, setText, handleSubmit, agentId, activeSessionId, applyHistoryText, setHint, draftKey, isCurrentInput]);

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

  // §5.5 #17 — 입력칸의 x. 값을 갈아 끼우지 않고 편집 명령 한 번으로 지워 Ctrl/Cmd+Z 로 되살아난다.
  //   지우기가 보통의 input 이벤트로 흐르므로 초안·히스토리 해제·슬래시 닫기·높이는 타이핑과 같은 길이다.
  //   첨부는 건드리지 않는다 — 그림 떼기는 서버 파일까지 지우고 되돌릴 길이 없다(각 그림의 x 로 뗀다).
  const handleClearInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !isCurrentInput(el, draftKey)) return;
    clearFieldText(el);
  }, [draftKey, isCurrentInput]);

  // §5.5 #17-3 — 입력 textarea 우클릭 메뉴를 직접 그린다(Electron 패키지엔 기본 메뉴가 없다). 출력 영역 메뉴와 별개.
  const [inputCtx, setInputCtx] = useState<
    { x: number; y: number; start: number; end: number; hasSel: boolean; field: HTMLTextAreaElement; value: string; owner: string } | null
  >(null);
  const closeInputCtx = useCallback(() => setInputCtx(null), []);

  const handleInputContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setInputCtx({ x: e.clientX, y: e.clientY, start, end, hasSel: end > start, field: el, value: el.value, owner: draftKey });
  }, [draftKey]);

  // 지정 범위를 insert 로 교체하고 caret/높이 복원 (Cut=빈 문자열, Paste=클립보드 텍스트).
  const replaceInputRange = useCallback((ctx: NonNullable<typeof inputCtx>, insert: string) => {
    const el = ctx.field;
    afterInputComposition(el, () => {
      // Clipboard reads may finish after typing, switching tabs or closing this input.
      if (!isCurrentInput(el, ctx.owner) || el.value !== ctx.value || el.ownerDocument.activeElement !== el
        || el.selectionStart !== ctx.start || el.selectionEnd !== ctx.end) return;
      const next = replaceTextRange(el.value, ctx.start, ctx.end, insert);
      setText(next.text);
      restoreCaret(el, next.text, next.caret);
    });
  }, [setText, isCurrentInput, restoreCaret]);

  const inputCtxItems = useMemo<ContextMenuItem[]>(() => {
    const ctx = inputCtx;
    const hasSel = ctx?.hasSel ?? false;
    const selectionRequired = t('ide.mainArea.ctxSelectionRequired');
    const selText = (): string => {
      if (!ctx) return '';
      return ctx.value.slice(ctx.start, ctx.end);
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
          replaceInputRange(ctx, '');
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
            .then((clip) => { if (clip) replaceInputRange(ctx, clip); })
            .catch(() => {});
        },
      },
      {
        label: t('ide.mainArea.inputCtxSelectAll'),
        onClick: () => {
          const el = ctx?.field;
          if (!el || !isCurrentInput(el, ctx.owner) || isInputComposing(el)) return;
          el.focus();
          el.select();
        },
      },
    ];
  }, [inputCtx, t, replaceInputRange]);

  return (
    <div ref={inputRootRef} className="relative flex flex-col gap-1.5 border-t border-gray-700 bg-gray-900/80 px-3 py-2">
      {/* §5.5 #17-38 — "듣는 중"은 입력창 위에, 확정된 말은 입력창 글로, 미확정만 이 줄에. */}
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
        onOpenMicSettings={() => { setMicPopupOpen(true); }}
      />
      {/* §5.5 #17-38 ⑮ — 마이크 설정 판. 오버레이와 같은 `bottom-full` 레일이라 새 축이 없고,
          듣는 줄과 동시에 뜨지 않는다(막혀서 뜨는 판이라 듣는 중일 수 없다). */}
      <MicSettingsPopup
        open={micPopupOpen}
        openable={micSettings.openable}
        hintKey={micSettings.hintKey}
        blocked={micBlocked}
        noDevice={micNoDevice}
        onOpenSettings={handleOpenMicSettings}
        onClose={() => { setMicPopupOpen(false); }}
        denoise={voiceDenoise}
        onDenoiseChange={setIdeVoiceDenoise}
        respace={voiceRespace}
        onRespaceChange={setIdeVoiceRespace}
        echoUnavailable={voice.echoUnavailable}
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
      {/* §5.5 #17-2 — 슬래시 자동완성 드롭다운(입력행 바로 위) */}
      {slashOpen && slashState && (
        <div ref={slashListRef} className={`absolute bottom-full left-0 right-0 max-h-72 overflow-y-auto rounded-t border border-b-0 border-gray-700 bg-gray-900 shadow-lg scrollbar-thin ${voiceActive ? 'mb-[46px]' : 'mb-1'}`}>
          {/* §5.5 #17-2 (보강) — 주입원 통제로 슬래시가 꺼진 프로젝트에서는 **목록 전부**가 거절된다.
              항목마다 배지를 달면 개별 축(터미널 전용·미설치)의 배지가 묻히므로 머리에 한 줄만 세우고,
              끄는 자리를 가리킨다. 목록 자체는 걸러내지 않는다 — 켠 뒤에 무엇을 얻는지 보여야 한다. */}
          {!slashCommandsEnabled && (
            <div className="sticky top-0 z-10 flex items-start gap-1.5 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-amber-300/90">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-px h-3.5 w-3.5 flex-shrink-0"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span>{t('ide.mainArea.slashDisabledByContext', { contextSources: t('ide.activityBar.context') })}</span>
            </div>
          )}
          {slashState.matched.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-500">
              {skillsLoaded ? t('ide.mainArea.slashEmpty') : t('ide.mainArea.slashLoading')}
            </div>
          ) : (
            slashState.matched.map((item, idx) => {
              const isActive = idx === Math.min(slashIndex, slashState.matched.length - 1);
              // 내장 명령은 sky, 스킬은 emerald(project)/purple(그 외).
              const accentBg = item.kind === 'builtin'
                ? 'bg-sky-500/15'
                : item.skill.source === 'project' ? 'bg-emerald-500/15' : 'bg-purple-500/15';
              const accentText = item.kind === 'builtin'
                ? 'text-sky-400'
                : item.skill.source === 'project' ? 'text-emerald-400' : 'text-purple-400';
              // §5.5 #17-2 (보강) — 내장 명령 설명만 로케일을 따른다(스킬 설명은 작성자의 말 그대로).
              const description = item.kind === 'builtin'
                ? builtinSlashDescription(item.builtin.name, item.builtin.description, {
                    enCopy: (key) => i18n.getResource('en', 'translation', key),
                    translate: (key) => t(key),
                  })
                : item.skill.description;
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
                    {/* §5.5 #17-33 ⑦ — CLI 가 슬래시를 못 푸는 항목은 알리기만 한다(설치는 Skills 사이드바·플러그인 창 — 드롭다운이 git 설치를 시작하면 안 된다). */}
                    {item.kind === 'skill' && <SkillStateTag skill={item.skill} />}
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
                    {/* §4 (슬래시 명령 가용성) — 헤드리스에서 CLI 가 거절하는 명령을 고르기 전에 표시한다. */}
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
      {/* §5.5 #17-18 ⑤ — 대기 덧말의 상태·칩·삭제는 말풍선(CollapsiblePrompt) 안에 있다 — 여기 대기 줄을 다시 그리지 마라. */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.tempId}
              className="group relative h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800"
              title={a.error ?? (a.uploading ? t('panel.commandQueue.uploading') : t('panel.commandQueue.attached'))}
            >
              <img
                src={attachmentPreviewUrl(a) || undefined}
                alt=""
                // §5.5 #17-25 — 안 보낸 첨부는 자리를 넘겨, 라이트박스 주석 저장이 이 자리를 교체한다.
                onClick={() => {
                  if (a.uploading || a.error) return;
                  const previewUrl = attachmentPreviewUrl(a);
                  if (previewUrl) openImageLightbox(previewUrl, lightboxOrigin(), { agentId, sessionId: activeSessionId, tempId: a.tempId });
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
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-[12px] text-gray-200 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100 pointer-coarse:h-6 pointer-coarse:w-6 pointer-coarse:opacity-100"
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
      {sessionDraft?.sendError && (
        <div role="status" className="mb-1 flex flex-wrap items-center gap-2 text-[12px] leading-relaxed text-gray-400">
          <span className="min-w-0 flex-1 basis-40">{t('ide.orchestra.readiness.retry', { engine: sessionDraft.sendError.engine === 'codex' ? 'Codex' : 'Claude' })}</span>
          <button type="button" className="rounded border border-amber-500/30 px-2 py-1 hover:bg-amber-500/10"
            onClick={() => { if (sessionDraft.sendError) void useGraphStore.getState().prepareOrchestraEngine({ engine: sessionDraft.sendError.engine, action: 'refresh' }); }}>
            {t('ide.orchestra.readiness.recheck')}
          </button>
        </div>
      )}
      {(localImagesUnsupported || sessionDraft?.sendFailure) && (
        <div role="alert" className="mb-1 text-[12px] leading-relaxed text-amber-400">
          {t(localImagesUnsupported || sessionDraft?.sendFailure === 'local-images-unsupported'
            ? 'ide.mainArea.localImagesUnsupported'
            : sessionDraft?.sendFailure === 'rejected' ? 'ide.mainArea.sendRejected' : 'ide.mainArea.sendUnconfirmed')}
        </div>
      )}
      {/* §5.5 #17-9 ⑰(c-1) — 백단 셸 띠를 두지 마라(셸 수만 보고 "계속 입력해도 된다"고 적어 말이 줄에 섰다).
         셸은 활동바 숫자·사이드바 [셸] 칩이 말한다(`sessionRunTruth.test.ts` (K)). */}
      {/* §5.5 #17-10 ⑥-6 — 무응답 띠를 두지 마라(그 [중지]는 입력줄 [중지]와 두 벌). 경과는 "작업 중…" 줄이 말한다(`sessionRunTruth.test.ts` (G)). */}
      {/* §2.4 — [중지] 결과가 `nothing`·`failed` 면 알린다. `nothing` = 화면의 "실행 중"이 거짓이라 강제 마감(기존 `stop-all`)을 함께 연다. */}
      {(stopOutcome.kind === 'nothing' || stopOutcome.kind === 'failed') && (
        <div role="status" className="mb-1 flex flex-wrap items-center gap-2 text-[12px] leading-relaxed text-amber-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span className="min-w-0 flex-1 basis-40" title={stopOutcome.kind === 'nothing' ? t('ide.mainArea.stopNothingHint') : undefined}>
            {stopOutcome.kind === 'nothing'
              ? t('ide.mainArea.stopNothing')
              : t('ide.mainArea.stopFailed', { status: stopOutcome.status ?? 0 })}
          </span>
          {stopOutcome.kind === 'nothing' ? (
            <button
              type="button"
              onClick={forceStop}
              disabled={stopping}
              title={t('ide.mainArea.stopForceTitle')}
              className="rounded border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              {stopping ? t('ide.mainArea.stopping') : t('ide.mainArea.stopForce')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="rounded border border-amber-500/30 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {stopping ? t('ide.mainArea.stopping') : t('ide.mainArea.stopRetry')}
            </button>
          )}
          <button
            type="button"
            onClick={clearStopOutcome}
            title={t('ide.mainArea.voiceErrDismiss')}
            aria-label={t('ide.mainArea.voiceErrDismiss')}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-amber-300/70 transition-colors hover:bg-amber-500/10 hover:text-amber-200"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-blue-400">{'>'}</span>
        {/* textarea 는 w-full, 축소(min-w-0)는 wrapper — textarea 가 flex 항목이면 field-sizing 이 폭을 늘려 줄바꿈·세로 확장이 안 된다. */}
        <div className="min-w-0 flex-1">
          <textarea
            key={draftKey}
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
            // §6 — 전역 IME 가드에게 "Enter 는 내가 맡는다"고 알린다. 가드가 조합 중 Enter 를 붙들면
            //   이 칸에는 브라우저 기본 줄바꿈만 남아 첫 Enter 가 전송이 아니라 줄바꿈이 된다.
            {...IME_ENTER_OWNER}
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
        {/* §5.5 #17 — 입력칸의 x. 쓴 글이 있을 때만 선다(빈 칸의 x 는 누를 것이 없다).
            누르는 순간 입력칸이 초점을 잃어 한글 조합이 먼저 확정되고, 지운 뒤 초점은 입력칸으로 돌아간다. */}
        {text.length > 0 && (
          <button
            type="button"
            onClick={handleClearInput}
            aria-label={t('ide.mainArea.inputClear')}
            title={`${t('ide.mainArea.inputClear')}\n${t('ide.mainArea.inputClearUndoHint', { shortcut: undoShortcut })}`}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-8 pointer-coarse:w-8"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {/* §5.5 #17-38 — 마이크. 실행/중지 왼쪽에 상주하고, 듣는 중에는 같은 자리에서 빨갛게 뛴다.
            `aria-pressed` 로 켜짐을 알린다(색만으로는 읽어 주는 도구에 전달되지 않는다). */}
        <button
          type="button"
          onClick={voice.toggle}
          onContextMenu={handleMicContextMenu}
          aria-pressed={voiceActive}
          aria-label={t(voiceActive ? 'ide.mainArea.voiceStop' : 'ide.mainArea.voiceStart', { shortcut: voiceShortcut })}
          // §5.5 #17-38 ⑮ — 호버 힌트는 **단축키 + 우클릭으로 할 수 있는 일**을 함께 말한다.
          //   우클릭 메뉴는 보이지 않는 기능이라 알려 주지 않으면 아무도 찾지 못한다.
          //   `aria-label` 은 동작 이름만 유지한다 — 읽어 주는 도구에 힌트까지 읽히면 길어진다.
          title={`${t(voiceActive ? 'ide.mainArea.voiceStop' : 'ide.mainArea.voiceStart', { shortcut: voiceShortcut })}\n${t('ide.mainArea.voiceMicHintRightClick')}`}
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
              // §5.5 #17-10 — 이 버튼은 이 세션 탭이 실행 중일 때만 뜬다 = 항상 세션 스코프.
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
              onClick={() => handleSubmit()}
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
            {/* §5.5 #17-10 — 입력은 노는데 멈출 게 남으면 전송 옆 컴팩트 [중지](세션 탭 = 그 세션의 백그라운드 서브, 메인 탭 = 에이전트 전체). */}
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
              onClick={() => handleSubmit()}
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
  /** 점프 직전 호출: 부모가 바닥 추종을 해제해 워치독이 점프 위치를 되끌지 않게 한다. */
  onJump?: () => void;
  /** §5.5 #17-12 — 이 세션의 스트림 이벤트(마지막 TodoWrite 로 "지금 무엇을" 판정). */
  events: SubAgentStreamEvent[];
  /** 이 세션이 돌고 있나(`isSessionRunning`) — 명령 상태만 보면 봉인 만료 뒤 깨어난 세션이 "완료"로 보인다. */
  sessionRunning: boolean;
  /** §2.4 — 정말 `executing` 인 명령이 있나(원본 큐 + 세션 필터). 표시용 사본 `commands` 로 세면 영영 스피너가 남는다. */
  hasExecutingCommand: boolean;
  /** §5.5 #17-50 — 칸이 버블 지도를 보이고 있으면 받는다: 줄을 누르면 대화로 돌아가 그 프롬프트로 간다. */
  returnToStream?: (cmdId: string) => void;
}

const STATUS_SUMMARY_MAX = 80;

/**
 * §5.5 #17-12 · #17-50 — 보기 묶음 [버블 | 간결 | 표준 | 원문](넷 중 하나). [버블] = 이 세션만의 버블 지도(`SessionBubbleView`, 캔버스 부품),
 * 켜진 [버블]을 다시 누르면 지금 밀도로. 버블 켜짐은 칸마다 휘발, 밀도는 전역. 바깥 줄이 `role="button"` 이라 `stopPropagation`.
 */
function StreamViewToggle(): React.JSX.Element {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const paneSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // §5.5 #17-34 — 창을 나눴으면 **이 칸의** 세션, 안 나눴으면 종전대로 창의 활성 세션.
  const activeSessionId = useSplitCellSession(paneSessionId);
  const viewKey = followSessionKey(agentId ?? '', activeSessionId);
  const bubbleOn = useGraphStore((s) => s.ideBubbleView[viewKey] === true);
  const setBubbleView = useGraphStore((s) => s.setIdeBubbleView);
  const density = useGraphStore((s) => s.ideStreamDensity);
  const setDensity = useGraphStore((s) => s.setIdeStreamDensity);
  const segmentClass = (active: boolean): string => `rounded px-1.5 py-0.5 text-[12px] font-medium transition-colors pointer-coarse:py-1 ${
    active ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
  }`;
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 rounded border border-gray-700/60 p-0.5" title={t('ide.density.label')}>
      <button
        type="button"
        aria-pressed={bubbleOn}
        onClick={(e) => { e.stopPropagation(); setBubbleView(viewKey, !bubbleOn); }}
        title={bubbleOn ? t('ide.bubbles.tipOn') : t('ide.bubbles.tipOff')}
        className={segmentClass(bubbleOn)}
      >
        {t('ide.bubbles.toggle')}
      </button>
      {STREAM_DENSITIES.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={!bubbleOn && density === d}
          onClick={(e) => {
            e.stopPropagation();
            setDensity(d);
            if (bubbleOn) setBubbleView(viewKey, false);
          }}
          className={segmentClass(!bubbleOn && density === d)}
        >
          {t(`ide.density.${d}`)}
        </button>
      ))}
    </div>
  );
}

/** §5.19 (G) — 로컬 LLM 버블이 문 모델(하단 상태바, 밀도·추종 옆). 로컬이 아니면 안 그린다. 바깥 줄 클릭은 `stopPropagation`. */
/** §5.19 (D) — 대화 창이 얼마나 찼나(넘치기 전에 보인다 — 엔진이 왕복마다 프롬프트 토큰 수를 준다). 값이 없으면 안 그린다(빈 막대 = "0%" 거짓말). */
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

/**
 * §5.19 (G) · §5.25 (B) — 프로바이더 버블 정체 뱃지. `!!provider` 로 묶지 마라 — 코덱스가 `All Model` 로 뜨고 로컬 설치 창이 열린다
 * (`openIDEOverlay` `kind` 분기와 한 쌍). 코덱스 뱃지는 일부러 못 누른다(모델은 버블 설정 창에서).
 */
function StreamProviderModelButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const provider = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider : undefined));
  const openLocalModelWindow = useGraphStore((s) => s.openLocalModelWindow);
  const badge = providerBadgeOf(provider);
  if (!agentId || !provider || !badge) return null;
  const engineLabel = badge.engine === 'codex'
    ? t('ide.overlay.codexLabel', { defaultValue: 'Codex' })
    : t('ide.overlay.localLabel', { defaultValue: 'All Model' });
  const body = (
    <>
      <span className="flex-shrink-0">{engineLabel}</span>
      {badge.model && (
        <span className="max-w-[180px] truncate font-normal text-slate-400">{badge.model}</span>
      )}
      {/* 코덱스는 문맥 **상한**을 신고하지 않는다 — 그래서 물결이 차지 않고, 여기서도 게이지가 없다. */}
      {provider.contextUsed !== undefined && provider.contextLimit !== undefined && (
        <StreamLocalContextGauge used={provider.contextUsed} limit={provider.contextLimit} />
      )}
    </>
  );
  const shell = 'flex min-w-0 items-center gap-1.5 rounded bg-slate-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-slate-300';
  if (!badge.switchable) return <span className={shell}>{body}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openLocalModelWindow(agentId); }}
      className={`${shell} transition-colors hover:bg-slate-500/25`}
      title={t('ide.overlay.localSwitchModel', { defaultValue: '이 버블이 쓸 모델 바꾸기' })}
    >
      {body}
    </button>
  );
}

/** §5.5 #17-27 ⑪ (h) — 따라간 알림이 화면에 머무는 시간(ms). `index.css` 의 `follow-flyout` 길이와 맞춘다. */
const FOLLOW_FLYOUT_MS = 2200;

/**
 * §5.5 #17-27 ⑪ — [추종](밀도와 별개): 이 세션이 고치는 파일을 편집창이 따라 연다. (h) 옆에 칩·배지를 상주시키지 않는다 —
 * 따라간 순간만 버튼 위에 한 줄(`absolute`). 켜짐은 파란 채움 + 맥동 점.
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
          className={`animate-follow-flyout pointer-events-none absolute bottom-[calc(100%+6px)] right-0 z-20 flex max-w-[min(18rem,calc(100vw-16px))] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[12px] shadow-lg shadow-black/40 ${
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

/** 하단 상태바 한 줄 — `flex-wrap` 으로 접힌다(한 줄 고정이면 좁은 창에서 손잡이가 밀려나 `justify-end` 줄이 사이드바를 덮는다). */
const STATUS_ROW_CLASS = 'flex w-full flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-800 bg-gray-900/70 px-4';

/** 요약 글줄 — `min-w-*` 가 있어야 손잡이보다 먼저 사라지지 않는다(`flex-1` 만이면 기준 폭 0 이라 0px 로 접힌다). */
const STATUS_SUMMARY_CLASS = 'min-w-[6rem] flex-1 truncate text-[12px]';

/** 밀도·추종·(로컬)모델 한 묶음 — 모자라면 묶음째 다음 줄로, 묶음도 `flex-wrap`(분할 칸 하한 280px 에서도 안 넘친다). */
function StreamControls({ jumpHint = false }: { jumpHint?: boolean }): React.JSX.Element {
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <StreamProviderModelButton />
      {/* §5.5 #17-12 · #17-50 — [버블 | 간결 | 표준 | 원문] 한 묶음([버블]을 따로 두지 않는다). */}
      <StreamViewToggle />
      <StreamFollowToggle />
      {jumpHint && (
        <span className="flex-shrink-0 text-[12px] text-gray-600 group-hover:text-gray-300">{'↑'}</span>
      )}
    </div>
  );
}

/** §5.3 #12-4 (F) — [검증 실행]이 그 탭에 넣는 명령에 싣는 직전 작업 발췌의 길이. */
const VERIFY_REQUEST_TASK_EXCERPT_MAX = 300;

/**
 * §5.3 #12-4 (F) — 끝난 명령의 검증 칩(`QueuedCommand.verification` 그대로). 고쳤는데 0회면 "검증 미실행"(+ 최신이면 [검증 실행]),
 * 돌렸으면 "검증 N회 실행"(통과라 말하지 않는다), 읽기·질문만이면 없음. 버튼은 `stopPropagation`.
 */
function StreamVerificationChip({ command, canRun }: { command: QueuedCommand; canRun: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const requestVerification = useGraphStore((s) => s.requestCommandVerification);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const summary = command.verification;
  const ran = summary?.ranCalls ?? 0;
  if (ran > 0) {
    return (
      <span
        className="flex-shrink-0 rounded border border-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-400"
        title={t('ide.verifyPolicy.ranTip')}
      >
        {t('ide.verifyPolicy.ran', { count: ran })}
      </span>
    );
  }
  if (!verificationNotRun(summary)) return null;
  const blocked = summary?.blockedCalls ?? 0;
  const tip = blocked > 0
    ? `${t('ide.verifyPolicy.notRunTip')}\n${t('ide.verifyPolicy.blockedTip', { count: blocked })}`
    : t('ide.verifyPolicy.notRunTip');
  const subAgentId = command.subAgentId;
  const run = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!agentId || !subAgentId || pending) return;
    setPending(true);
    setFailure(null);
    const task = command.text.replace(/\s+/g, ' ').trim().slice(0, VERIFY_REQUEST_TASK_EXCERPT_MAX);
    void requestVerification(agentId, subAgentId, t('ide.verifyPolicy.runPrompt', { task }))
      .then((result) => { if (!result.ok) setFailure(result.error); })
      .finally(() => setPending(false));
  };
  return (
    <span className="flex flex-shrink-0 items-center gap-1">
      <span
        className="flex items-center gap-1 rounded border border-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-400"
        title={tip}
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3"><circle cx="12" cy="12" r="9" /></svg>
        {t('ide.verifyPolicy.notRun')}
      </span>
      {canRun && agentId && subAgentId && (
        <button
          type="button"
          disabled={pending}
          onClick={run}
          title={t('ide.verifyPolicy.runTip')}
          className="rounded border border-gray-600 px-1.5 py-0.5 text-[12px] text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {t('ide.verify.start')}
        </button>
      )}
      {failure && (
        <span className="text-[12px] text-red-400">{t('ide.verifyPolicy.runFailed', { error: failure })}</span>
      )}
    </span>
  );
}

function StreamStatusBar({ commands, scrollRef, streamRef, onJump, events, sessionRunning, hasExecutingCommand: hasRealExecuting, returnToStream }: StreamStatusBarProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const lightboxOrigin = useImageLightboxOrigin();
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
    const measure = (): void => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      if (atBottom) { setViewedId((p) => (p === null ? p : null)); return; }
      // Sub 탭 — DOM 의 명령 블록만 훑지 마라(virtuoso 는 밖을 안 그려 긴 턴에선 줄이 안 바뀐다). 렌더러가 맨 위 항목의 소속 명령을 인덱스로 준다.
      const owned = streamRef.current?.viewedCommandId() ?? null;
      if (owned !== null) { setViewedId((p) => (p === owned ? p : owned)); return; }
      // 메인(Agent) 탭 — 스트림 렌더러가 없고 타임라인에 명령 블록도 없다. 종전 DOM 판정을 그대로 둔다.
      const containerTop = container.getBoundingClientRect().top;
      const blocks = Array.from(container.querySelectorAll<HTMLElement>('[data-cmd-id]'));
      let current: string | null = null;
      for (const el of blocks) {
        // 뷰포트 상단(여백 보정)을 지난 마지막 블록 = 사용자가 보고 있는 커맨드.
        if (el.getBoundingClientRect().top - containerTop <= VIEWED_TOP_MARGIN) current = el.dataset.cmdId ?? null;
      }
      // 맨 위로 스크롤해 어떤 블록도 상단을 지나지 못했으면 첫 블록을 대상으로.
      if (current === null && blocks[0]) current = blocks[0].dataset.cmdId ?? null;
      setViewedId((p) => (p === current ? p : current));
    };
    // 스크롤 한 번에 측정 한 번(프레임 단위 합침) — 휠을 굴리는 동안 레이아웃을 되풀이해 재지 않게.
    let raf = 0;
    const recompute = (): void => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => { raf = 0; measure(); });
    };
    measure();
    container.addEventListener('scroll', recompute, { passive: true });
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      container.removeEventListener('scroll', recompute);
    };
  }, [scrollRef, streamRef, commands]);

  // §5.5 #17-12 ③-2 (a) — 실행 중을 말하는 동안 스크롤 위치를 묻지 않는다(앞 턴을 보면 돌던 일이 사라진 듯 보인다). 측정은 계속해 끝나면 보는 턴으로.
  const pinnedToRunning = statusBarPinsToRunning({
    defaultStatus: defaultTarget?.status ?? null,
    sessionRunning,
    hasRealExecuting,
  });

  // viewedId(=data-cmd-id, `cmd-${id}`)가 가리키는 커맨드를 우선, 없으면 기본 대상.
  const target = useMemo(() => {
    if (viewedId !== null && !pinnedToRunning) {
      const found = commands.find((c) => `cmd-${c.id}` === viewedId);
      if (found) return found;
    }
    return defaultTarget;
  }, [viewedId, commands, defaultTarget, pinnedToRunning]);

  // 첨부 썸네일(basename 조회, blob preview 우선 + 서버 파일 라우트 폴백). 훅은 조건부 return 위에서 부른다(target 없으면 빈 배열).
  const attachmentThumbs = useAttachmentThumbs(target?.attachments);

  // §5.5 #17-12 — 마지막 TodoWrite 기준 "지금 무엇을 하는 중" + 완료/전체. 이벤트가 바뀔 때만 재계산.
  const planProgress = useMemo(() => latestPlanProgress(events), [events]);
  // §5.3 #12-1 — 이 세션이 백단에 띄운 작업 수(훅 대차대조 + 스트림 칩 합산, 서버가 합쳐 보낸다).
  const agentId = useIDEPaneValue((o) => o.agentId);
  const paneSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // §5.5 #17-34 — 창을 나눴으면 **이 칸의** 세션, 안 나눴으면 종전대로 창의 활성 세션.
  const activeSessionId = useSplitCellSession(paneSessionId);
  // §5.5 #17-9 ⑰ — 기다릴 것(모델 자식)만 센다 — 셸까지 세면 `tail -f` 하나로 "기다리는 중"이 영영 선다.
  const bgTaskCount = useGraphStore((s) => {
    const tasks = agentId ? s.runningSubagentTasks[agentId] : undefined;
    if (!tasks) return 0;
    const mine = activeSessionId === null
      ? tasks
      : tasks.filter((x) => x.subAgentId === activeSessionId);
    return mine.filter((x) => !isBackgroundShellTask(x)).length;
  });

  const handleJump = useCallback(() => {
    if (!target) return;
    // §5.5 #17-50 — 버블 지도를 보고 있으면 대화가 화면에 없다. 대화로 돌아가 그 프롬프트로 간다.
    if (returnToStream) { returnToStream(target.id); return; }
    // 점프 전 부모 추종 해제(워치독이 점프 위치를 바닥으로 되끌지 않게).
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
  }, [target, scrollRef, streamRef, onJump, returnToStream]);

  // §5.5 #17-12 — 보여줄 명령이 없어도 **밀도 토글만 있는 얇은 줄**은 남긴다 — 어느 화면에서든 밀도를 바꿀 수 있어야 한다.
  if (!target) {
    return (
      <div className={`${STATUS_ROW_CLASS} py-1`}>
        <StreamControls />
      </div>
    );
  }

  // 되살아난 턴(세션은 도는데 이 세션의 executing 명령이 없음 — 봉인 만료 후) = 실행 중 줄. 단 과거 명령을 보는 중(`target !== defaultTarget`)이면 그대로.
  const resumedTurn = sessionRunning
    && target === defaultTarget
    && !hasRealExecuting;
  // §2.4 — `executing` 만으로 스피너를 돌리지 마라: 표시용 사본은 조용한 압축 중 대기 명령을 승격시키고(`constants.ts`), 좀비 명령은 영영 executing 이다.
  // 세션이 실제로 도는가와 둘 다 참일 때만.
  const isExecuting = (target.status === 'executing' && sessionRunning) || resumedTurn;
  const isError = target.status === 'error' && !resumedTurn;
  // §5.5 #17-12 ③-6 — 실패가 아닌데 평범하게 끝나지 않은 턴(중지·상한·거절·한도)은 초록 "끝남" 대신
  //   호박색 이유 낱말. 되살아난 턴은 끝난 턴이 아니므로 읽지 않는다.
  const stopLabelKey = isExecuting ? null : turnStopLabelKey(target.stopReason, target.status);
  // §5.5 #17-12 — 실행 중에는 "내가 친 프롬프트" 대신 **에이전트가 지금 하는 단계**를 보여준다(계획이 있을 때).
  //   계획이 없으면 종전대로 프롬프트 앞부분 — 어떤 경우에도 빈 줄이 되지 않게.
  const plan = isExecuting ? planProgress : null;
  // §5.5 #17-12 ③ — 오류면 프롬프트 대신 실패 사유를 말한다. 사유 없는 옛 명령은 결과 → 프롬프트 폴백.
  const errorDesc = isError && target.error ? describeCommandError(target.error) : null;
  const errorGuidance = errorDesc?.guidance;
  const errorLine = errorDesc
    ? joinCommandErrorLine(t(errorDesc.labelKey, errorDesc.labelParams), errorGuidance ? null : errorDesc.detail)
    : (isError && target.result ? target.result.replace(/\s*\n+\s*/g, ' ') : null);
  const errorTitle = errorDesc && errorGuidance
    ? [errorLine, t(errorGuidance.explanationKey), t(errorGuidance.actionKey), errorDesc.detail].filter(Boolean).join('\n')
    : errorLine;
  // §5.3 #12-1 — 자기 턴은 끝났는데 **백단 자식이 아직 도는** 상태. 이 줄이 그때 내가 친 프롬프트를
  //   되뇌면 "왜 멈춰 있지?"로 읽힌다 — 무엇을 기다리는지(몇 개가 도는지)를 말해야 한다.
  const waitingOnBackground = isExecuting && bgTaskCount > 0 && !hasRealExecuting;
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
                onClick={(e) => { e.stopPropagation(); openImageLightbox(a.url, lightboxOrigin()); }}
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
        {/* §5.5 #17-12 ③ — 이 줄에 [중지]를 두지 마라(입력창 [중지]와 두 벌, #17-10). */}
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
      title={errorTitle ? `${errorTitle}

${t('ide.mainArea.scrollPrompt')}` : t('ide.mainArea.scrollPrompt')}
    >
      <span className={`flex flex-shrink-0 items-center ${errorGuidance ? 'text-gray-400' : isError ? 'text-red-400' : stopLabelKey ? 'text-amber-400' : 'text-emerald-400'}`}>
        {isError ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        ) : stopLabelKey ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </span>
      {!errorGuidance && <span className={`flex-shrink-0 text-[12px] ${isError ? 'text-red-400' : stopLabelKey ? 'text-amber-400' : 'text-emerald-400'}`}>
        {isError ? t('ide.mainArea.statusError') : stopLabelKey ? t(stopLabelKey) : t('ide.mainArea.statusCompleted')}
      </span>}
      <span className={`${STATUS_SUMMARY_CLASS} ${
        isError && !errorGuidance ? 'text-red-200/90 group-hover:text-red-100' : 'text-gray-300 group-hover:text-gray-100'
      }`}>
        {preview}
      </span>
      {/* §5.3 #12-4 (F) — 이 명령의 검증 상태. [검증 실행]은 지금 작업 트리를 검증하므로 **최신 명령**에만 둔다. */}
      <StreamVerificationChip command={target} canRun={target === defaultTarget && !sessionRunning} />
      <StreamControls jumpHint />
    </div>
  );
}

// 우클릭 컨텍스트 메뉴는 `IDEContextMenu` 공용 컴포넌트에 있다(§5.5 #17-27 ⑨, 편집창과 공유).

// ─── 메인 영역 ───

// 첨부 이미지 라이트박스 — 전역 imageLightbox 를 body 로 portal 만 한다(어느 썸네일이든). 주석 도구·저장은 ImageLightboxView(§5.5 #17-25).
/** §5.5 #17-27 ⑳ — 파일 창도 같은 호스트를 쓴다(붙일 입력창이 없어 `canAttach=false` — 덮어쓰기·내려받기만). */
export function ImageLightboxHost({ agentId, activeSessionId, canAttach, zIndex }: ImageLightboxHostProps): React.JSX.Element | null {
  const lightbox = useGraphStore((s) => s.imageLightbox);
  const close = useGraphStore((s) => s.closeImageLightbox);
  // 호스트는 대화 본문마다 있다 — **연 자리의 것만** 그린다(창·분할 칸 수만큼 겹쳐 뜨고 [저장]이 남의 입력창으로 가던 것).
  const spot = useImageLightboxHostSpot();
  if (!lightbox || !lightboxHostMatches(lightbox.origin, spot)) return null;
  return createPortal(
    <ImageLightboxView
      // 이미지가 바뀌면 주석·도구 상태를 새로 시작한다(다음 이미지에 앞 그림이 남아 있으면 안 된다).
      key={lightbox.url}
      state={lightbox}
      agentId={agentId}
      activeSessionId={activeSessionId}
      canAttach={canAttach}
      {...(zIndex !== undefined ? { zIndex } : {})}
      onClose={() => close(lightbox)}
    />,
    document.body,
  );
}

interface ImageLightboxHostProps {
  agentId: string;
  activeSessionId: string | null;
  /** 붙일 입력창이 있는가 — 읽기 전용(Hook 에이전트 메인 탭)이면 [내려받기]만 남는다. */
  canAttach: boolean;
  /** §5.5 #17-27 ⑳ — 겹침 높이(파일 창이 연 팝업은 그 창 한 칸 위). 생략하면 종전 그대로. */
  zIndex?: number;
}

/** §5.5 #17-36 ⑫ — 메모 링크 이동에서 리스트를 옮긴 뒤 그려지기를 기다리는 틈(ms). 북마크 이동의 간격(60ms → 340ms)과 같은 280ms. */
const MEMO_LINK_JUMP_SETTLE_MS = 280;

/** §5.5 #17-50 — 버블 지도에서 대화로 돌아와 프롬프트로 옮기기 전 기다리는 틈(ms) — 대화가 서고 첫 측정을 마치는 동안. */
const BUBBLE_RETURN_SETTLE_MS = 180;
/** 지도가 꺼져 있을 때의 빈 재료 — 매 렌더 새 배열이면 지도 쪽 memo 가 헛돈다. */
const EMPTY_BUBBLE_STREAMS: readonly SessionBubbleStream[] = [];
const EMPTY_BUBBLE_SESSION_IDS: readonly string[] = [];

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
  // 하단 상태바의 "완료"/"실행 중" 근거. 입력창 [중지] 토글과 같은 훅을 써야 두 자리가 어긋나지 않는다.
  const streamSessionRunning = useSessionRunning(agentId, activeSessionId);
  // §2.4 (생존 판정 단일화) — **원본 큐 + 세션 필터 + 공유 술어**로 낸 "작동 중"(도는 중 ∪ 줄 서 있음).
  //   라이브 1줄(작업 중)과 스트림 렌더러가 이 값 하나를 본다. 화면용 사본(`displayCommands`)을
  //   생존 판정에 쓰면 아무것도 돌지 않는 세션이 영영 "실행 중"으로 굳는다(constants.ts 의 경고 그대로).
  const sessionHasWork = useSessionWork(agentId, activeSessionId);
  // §2.4 — "진짜 도는 명령이 있는가"(원본 큐). 하단 상태바가 되살아난 턴을 가려낼 때 쓴다.
  const sessionExecuting = useSessionExecuting(agentId, activeSessionId);
  // §2.4 `lastActivityAt` 무응답 시작점(서버 값) · §5.5 #17-18 ⑪ `waiting` 줄만 섰나(라이브 1줄 세 번째 모습, Sub 탭에도) ·
  // §5.3 #9-1 (P) `hiddenTurn` 감춘 턴 중(경과만 세고 무응답 ❌) · §5.5 #17-10 ⑥-6 턴 시계(원본 큐 + 세션 필터, 줄이 와도 되감기지 않는다).
  const {
    lastActivityAt: sessionLastActivityAt, waiting: sessionWaiting, hiddenTurn: sessionHiddenTurn,
    turnStartedAt: sessionTurnStartedAt, compactingSince: sessionCompactingSince,
  } = useSessionLivenessFacts(agentId, activeSessionId);
  // §5.5 #17-12 ③ — 여기엔 useSessionStop 이 없다(중지 창구는 TerminalInput 의 [중지] 하나, #17-10).
  const markSubAcknowledged = useGraphStore((s) => s.markSubAcknowledged);
  // 사용자가 메인 영역(스크롤 영역) 안을 클릭하면 현재 sub 의 완료 알림을 확인 처리(녹색→회색).
  const handleAckClick = useCallback(() => {
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged]);
  const queuedCmds = useGraphStore((s) => s.queuedCommands[agentId] ?? EMPTY_COMMANDS);
  const completedCmds = useGraphStore((s) => s.completedCommands[agentId] ?? EMPTY_COMMANDS);
  const runningTasks = useGraphStore((s) => s.runningSubagentTasks[agentId]);
  const originalCommands = useMemo(() => [...queuedCmds, ...completedCmds], [queuedCmds, completedCmds]);
  // queued/executing + completed/error 시간순(완료 뒤에도 프롬프트가 남게). §5.3 #9-1 (P) 우리가 끼운 조용한 압축은 말풍선 ❌ — "작업 중" 판정은 그대로 센다.
  const commands = useMemo(
    () => [...displayCommands(queuedCmds), ...completedCmds].sort((a, b) => a.timestamp - b.timestamp),
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
  // §5.5 — 메인 탭 전용 스트림 갱신 신호(이벤트 개수 합). `subAgents` 참조 변화에 기대지 마라 — 구조적 공유로 안정되면 출력이 멎는다.
  const mainStreamVersion = useGraphStore((s) => {
    if (activeSessionId !== null) return 0;
    let total = 0;
    for (const sub of s.subAgents[agentId] ?? EMPTY_SUBS) {
      total += s.subAgentStreams[sub.id]?.length ?? 0;
    }
    return total;
  });
  // scrollRef/scrollEl = virtuoso 내부 스크롤러(Sub 탭 onScrollerRef · 메인 scrollerRef 가 올린다). 상태바·북마크·Select All 이 이 안에서만 돈다.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollNode = useCallback((node: HTMLElement | Window | null) => {
    const el = node instanceof HTMLElement ? (node as HTMLDivElement) : null;
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  // 본문 텍스트 줌(Ctrl+휠) — 배율은 항목 래퍼의 zoom(스크롤러에 걸면 가상화 측정과 부딪힌다). 비-passive capture wheel 로 preventDefault + stopPropagation.
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
      if (isInsideSessionBubbles(e.target)) return; // §5.5 #17-50 — 버블 지도 위 Ctrl+휠은 지도 배율이다.
      e.preventDefault();
      e.stopPropagation();
      const cur = useGraphStore.getState().ideTextZoom;
      setIdeTextZoom(stepIdeTextZoomLadder(cur, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheelZoom, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheelZoom, { capture: true });
  }, [setIdeTextZoom]);
  // §4 — 핀치 = 텍스트 줌(Ctrl+휠의 짝, 같은 setIdeTextZoom 0.6~2.4). 핀치 중 touchmove 는 preventDefault + stopPropagation(capture — 추종 해제 판정이 돌지 않게).
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
      if (isInsideSessionBubbles(e.target)) return; // §5.5 #17-50 — 버블 지도 위 두 손가락은 지도 배율이다.
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
      if (isComposingKeyEvent(e)) return;
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
  // 바닥 추종의 SSOT = 스크롤 의도(followRef): 안 건들면 추종 · 올리면 고정 · 내리면 재개. atBottomStateChange 순간값으로 판정하지 마라 —
  // 본문이 자라 40px 를 넘는 순간 추종이 풀린다(끄는 조건은 아래 markUpIntent). `sessionKey` = 탭 키(메인 '__main__').
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
  // 바닥 붙이기는 실제 DOM(scrollHeight-clientHeight)으로만 — virtuoso 모델 좌표(scrollToIndex LAST)는 DOM 과 어긋나면 위로 역주행한다. DOM 쓰기는 idempotent.
  const glueToBottomDom = useCallback((): void => {
    const el = scrollEl;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < target - 0.5) el.scrollTop = target;
  }, [scrollEl]);
  // 세션별 virtuoso 스냅샷(스크롤 중 throttled 저장 → restoreStateFrom). 키는 세션 × 밀도(sessionSnapshotKey) — 밀도가 다른 목록에 쓰면 엉뚱한 곳에 떨어진다.
  const sessionSnapshotsRef = useRef<Map<string, StateSnapshot>>(new Map());
  const densityRef = useRef(density);
  densityRef.current = density;
  // 세션 복원 스냅샷: 떠날 때 바닥이었거나 첫 진입이면 undefined(자식이 LAST 에서 시작), 위로 올려 둔 세션이면 저장 스냅샷.
  const restoreStateFor = useCallback((key: string): StateSnapshot | undefined => {
    if (sessionAtBottomRef.current.get(key) ?? true) return undefined;
    return sessionSnapshotsRef.current.get(sessionSnapshotKey(key, density));
  }, [density]);
  // 북마크 이동 nonce — 막 전환된 세션이 북마크 점프인지 식별해 스크롤 복원을 양보(중복 스크롤 충돌 방지).
  const handledBookmarkNonceRef = useRef<number>(-1);

  // §5.5 #17 / #17-29 — 훅 버블은 **어느 탭에서도** read-only. 종전엔 `activeSessionId === null`(메인 탭)
  //   조건이 붙어 있어 훅 버블의 세션 탭 위에서는 입력창이 열렸고, 그렇게 보낸 명령은 우리가 spawn 하지
  //   않은 부모에 자식을 매달았다(스폰 주입·완료 신고 경로가 통째로 없는 세션). 커스텀만 interactive.
  const isReadOnly = !isCustom;

  // §4 — CMD 에이전트는 모든 탭이 임베디드 PTY(탭마다 termId, IDE 를 닫아도 reattach 로 보존).
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const showInteractiveTerminal = isCustom && executionMode === 'interactive-terminal';

  // §5.5 #17-50 — [버블]: 이 칸의 대화 자리에 이 세션만의 버블 지도를 세우나. 키는 [추종]과 같은 꼴(칸마다 따로 · 휘발).
  //   CMD 탭은 대화 칸이 PTY 라 지도가 설 자리도 손잡이(상태바)도 없다.
  const bubbleViewKey = followSessionKey(agentId, activeSessionId);
  const bubbleOn = useGraphStore((s) => s.ideBubbleView[bubbleViewKey] === true) && !showInteractiveTerminal;
  const setBubbleView = useGraphStore((s) => s.setIdeBubbleView);
  // 지도로 갈 때는 대화 스크롤러를 내려놓는다 — 화면에 없는 스크롤러를 워치독·정착 덮개가 계속 붙들지 않게.
  //   돌아오면 대화가 새 스크롤러를 올리고, 그것이 정착·추종 정렬을 세션 탭을 오갈 때와 같은 길로 다시 돌린다.
  useEffect(() => {
    if (bubbleOn) setScrollNode(null);
  }, [bubbleOn, setScrollNode]);

  // §5.5 #17-3 — 우클릭 컨텍스트 메뉴. anchorId = 선택 출처 항목(§17-7 북마크 이동용).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; selection: string; anchorId?: string } | null>(null);
  // §5.5 #17-36 — 우클릭 메뉴가 찍은 스티키 메모 생성 지점(화면 좌표). 판(SessionMemoLayer)이 소비하고 비운다.
  const [memoSpawn, setMemoSpawn] = useState<{ x: number; y: number } | null>(null);
  // 이 화면(세션 탭 또는 메인 탭)에 붙은 메모 장수 — 상한에 닿으면 메뉴 항목을 흐린다.
  const memoCount = useGraphStore((s) => (
    activeSessionId
      ? (s.subAgents[agentId]?.find((x) => x.id === activeSessionId)?.memos?.filter((m) => m.closedAt === undefined).length ?? 0)
      : (s.agentMemos[agentId]?.filter((m) => m.closedAt === undefined).length ?? 0)
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
          const el = ideBodyRef.current?.querySelector('[data-prompt-reader-body]') ?? scrollRef.current;
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
    const flat = buildEntries(commands, subAgents, streams, activeSessionId, agentEvents, formatError, originalCommands, runningTasks);
    // §2.4 — `hasSessionWork`(원본 큐 + 세션 필터)만 본다. `commands.some(...)` 로 되돌리지 마라 — 표시용 사본에 세션 필터도 없어 남의 좀비 명령이 이 탭을 "작업 중"으로 칠한다.
    const agentBusy = sessionHasWork;
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

    // §5.5 #17-24 ②⑦ — 라이브 1줄은 작동 중 늘 `작업 중`(최근 이벤트로 켜고 끄거나 `생각 중`을 고르지 않는다 — 턴 시계와 붙으면 멈춘 듯 읽힌다).
    if (agentBusy) {
      // 가장 최근 이벤트는 각 스트림 배열의 마지막 원소만 본다(도착 순 append — O(세션 수)).
      let latest: SubAgentStreamEvent | null = null;
      for (const evts of Object.values(streams)) {
        const tail = evts[evts.length - 1];
        if (tail && (!latest || tail.timestamp > latest.timestamp)) latest = tail;
      }
      // §5.5 #17-18 ⑪ — 줄 선 것이 먼저다(Sub 탭 `computeThinkingLive` 와 동형).
      // §5.5 #17-24 ⑥ ⑦ — 접는 중이면 압축 중. 고르는 규칙은 Sub 탭과 같은 함수 한 곳(`liveLineMode`).
      const mode = liveLineMode(sessionWaiting, sessionCompactingSince !== null);
      // §2.4 — 경과 시계 = 마지막 활동(보인 줄·세션 활동 중 늦은 쪽, Sub 탭과 같은 함수). 근거 없으면 `null` — `Date.now()` 면 영영 무응답이 안 된다.
      grouped.push({
        kind: 'thinking-live', id: 'thinking-live', mode,
        timestamp: latest?.timestamp ?? Date.now(),
        lastActivityAt: liveLineActivityAt(latest?.timestamp, sessionLastActivityAt),
        // §5.5 #17-10 ⑥-6 — 평소 적는 경과는 턴 시작부터(Sub 탭과 같은 사실).
        turnStartedAt: sessionTurnStartedAt,
        ...(mode === 'compacting' && sessionCompactingSince !== null ? { compactingSince: sessionCompactingSince } : {}),
        ...(sessionHiddenTurn ? { hiddenTurn: true as const } : {}),
      });
    }
    return grouped;
  }, [commands, subAgents, streams, activeSessionId, agentEvents, density, formatError, originalCommands, runningTasks, sessionHasWork, sessionWaiting, sessionLastActivityAt, sessionHiddenTurn, sessionTurnStartedAt, sessionCompactingSince]);

  // §5.3 #12-2 — AskUserQuestion 카드. 메인 탭: 이 에이전트의 모든 sub 질문 시간순, sub 탭: 그 sub 의 질문만.
  const pendingAskQuestions = useGraphStore((s) => s.pendingAskQuestions);
  const askCards = useMemo(() => {
    const matches = Object.values(pendingAskQuestions).filter((r) => {
      if (r.agentId !== agentId) return false;
      // 메인 탭은 이 에이전트의 질문 전부(소속은 `r.agentId` 가 보장). subIdSet 으로 거르지 마라 — 막 스폰된 세션의 질문이 빠져 60s 타임아웃된다.
      return activeSessionId !== null ? r.subAgentId === activeSessionId : true;
    });
    return matches.sort((a, b) => a.createdAt - b.createdAt);
  }, [pendingAskQuestions, agentId, activeSessionId]);

  // §4 — 작업 신고 카드(agentReports 는 agentId 1차 키). 메인 탭: 모든 신고, sub 탭: 그 세션 신고만.
  const agentReportsForAgent = useGraphStore((s) => s.agentReports[agentId] ?? EMPTY_REPORTS);
  const reportCards = useMemo(() => {
    const matches = agentReportsForAgent.filter((r) =>
      activeSessionId !== null ? r.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentReportsForAgent, activeSessionId]);

  // §4 — 질문 카드. reportCards 와 같은 필터/정렬.
  const agentQuestionsForAgent = useGraphStore((s) => s.agentQuestions[agentId] ?? EMPTY_QUESTIONS);
  const questionCards = useMemo(() => {
    const matches = agentQuestionsForAgent.filter((q) =>
      activeSessionId !== null ? q.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentQuestionsForAgent, activeSessionId]);

  // §4 — 검수 요청 카드. reportCards 와 같은 필터/정렬.
  const agentReviewsForAgent = useGraphStore((s) => s.agentReviews[agentId] ?? EMPTY_REVIEWS);
  const reviewCards = useMemo(() => {
    const matches = agentReviewsForAgent.filter((r) =>
      activeSessionId !== null ? r.subAgentId === activeSessionId : true,
    );
    return [...matches].sort((a, b) => a.createdAt - b.createdAt);
  }, [agentReviewsForAgent, activeSessionId]);

  // §4 — 번호 목록 정렬 카드. reviewCards 와 같은 필터/정렬.
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

  // §4 · §5.5 #17-18 ⑦-1 — 카드는 신고 시각(`createdAt`)에 못 박는다(StreamRenderer 와 같다). 턴 끝으로 미루지 마라(`turnEndSortTs`) — 도는 턴에선 바닥에 붙어 끝난 듯 보인다.
  const mainTimeline = useMemo(() => {
    // §5.5 #17-18 ⑥-3 — 턴 경계 = 나간 명령의 dispatch 시각(대기 덧말 제외, Ask 의 "맨 끝" 폴백은 대기 말풍선보다 위).
    // ⑥-5 판정은 `hasDispatched` 하나(Sub 탭과 같다) — 재개 대기로 큐에 돌아간 명령도 경계에 남는다.
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
    // §2.4 — 원본 큐 답만 본다(표시용 사본의 executing 은 승격된 대기 명령으로 지나간 카드까지 "도는 중"으로 만든다).
    const turnRunning = sessionExecuting;
    const isLive = (createdAt: number): boolean =>
      turnRunning && !(lastAnchor !== undefined && lastAnchor > createdAt);
    // §5.5 #17-18 ⑦-7 — 카드를 보낸 도구 줄이 카드보다 뒤에 정렬되면(코덱스는 명령 시작을 카드 뒤에 알린다)
    //   카드는 그 줄(묶음) 바로 아래에 선다. 정렬 자리(`ts`)만 바뀌고 턴 귀속·`작업 중` 은 신고 시각 그대로다.
    const senderCallsBySub = collectMainCardSenderCalls(items);
    // §5.5 #17-12 — 같은 턴의 검수는 그 턴 신고 카드로 흡수해 한 장으로 보여준다.
    //   짝 없는 검수만 독립 카드로 남는다(StreamRenderer 의 mergeCardsIntoItems 와 동일 규칙).
    const reportNodes: Array<{ ts: number; node: MainTimelineNode }> = [];
    const reportNodeByTurn = new Map<number, { node: MainTimelineNode }>();
    for (const r of reportCards) {
      const entry = {
        ts: mainCardPlacementTs('report', r, senderCallsBySub),
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
      reviewNodes.push({ ts: mainCardPlacementTs('review', rv, senderCallsBySub), node: { t: 'review' as const, review: rv, live: isLive(rv.createdAt) } });
    }
    const merged: Array<{ ts: number; node: MainTimelineNode }> = [
      ...items.map((item) => ({ ts: item.timestamp, node: { t: 'item' as const, item } })),
      ...reportNodes,
      ...questionCards.map((q) => ({ ts: mainCardPlacementTs('question', q, senderCallsBySub), node: { t: 'question' as const, questions: q, live: isLive(q.createdAt) } })),
      ...reviewNodes,
      ...listCards.map((l) => ({ ts: mainCardPlacementTs('list', l, senderCallsBySub), node: { t: 'list' as const, list: l, live: isLive(l.createdAt) } })),
      // §5.3 #12-2 — pending AskUserQuestion 카드도 타임라인 안으로(가상 리스트 밖 형제 렌더 → 겹침 제거).
      ...askCards.map((req) => ({ ts: pendingAskSortTs(req.createdAt), node: { t: 'ask' as const, request: req } })),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    // §5.5 #17-18 ⑦-5 — 카드 바로 뒤에 붙는 "~카드로 보냈습니다" 한 줄은 화면에서 뺀다(카드가 이미 하는 말).
    //   정렬 **뒤**에 걷는다: "바로 앞이 카드"라는 자리 조건은 시간순으로 놓인 뒤에야 성립한다.
    const nodes = dropCardEchoNodes(merged.map((m) => m.node));
    // §5.5 #17-39 ⑩ — 간결에서 이어 붙은 사고 자국을 주인별 한 줄로(Sub 탭과 같은 함수). 카드가 **여기서야**
    //   타임라인에 합류하므로 합치기도 이 뒤에 돌린다 — `applyMainDensity` 안에서 돌리면 카드를 사이에 둔
    //   자국까지 한 줄로 합쳐져 같은 대화가 탭에 따라 다르게 접힌다.
    return density === 'compact' ? mergeAdjacentThinkTraces(nodes, readMainStepTrace, writeMainStepTrace) : nodes;
  }, [items, reportCards, questionCards, reviewCards, listCards, askCards, commands, density, sessionExecuting]);

  // 앞쪽 절단을 메인 Virtuoso 에 shift 로 알린다(안 하면 sizeTree 가 밀려 스크롤이 말린다). 밀도도 리셋 키로(전환을 절단으로 오인하지 않게).
  const mainFirstItemIndex = useVirtuosoFrontShift(mainTimeline, mainTimelineNodeId, density);

  // §5.5 #17-45 — 연속 발화 런(Sub 탭과 **같은 순수 함수**). 간결에서만 켠다.
  //   주인은 **세션 이름표**다 — 전체 보기에서는 여러 세션의 말이 한 타임라인에 섞여 오므로,
  //   세션이 바뀌면 다른 사람의 말이라 런을 끊어야 한다(Sub 탭의 중첩 서브에이전트와 같은 자리).
  const mainSpeechRuns = useMemo(
    () => (density === 'compact'
      ? speechRunPositions(mainTimeline.map((n) => {
        const id = mainTimelineNodeId(n);
        const isText = n.t === 'item' && n.item.kind === undefined && n.item.type === 'text';
        return { id, text: isText, owner: isText ? (n.item as TerminalEntry).sessionLabel : undefined };
      }))
      : NO_SPEECH_RUNS),
    [mainTimeline, density],
  );

  // 세션 전환 = key={sessionKey} 재마운트 + restoreStateFrom. 스냅샷은 스크롤 중 throttled 로 저장한다 — 언마운트 cleanup 땐 getState 가 이미 무효다.
  const mainTimelineRef = useRef(mainTimeline);
  mainTimelineRef.current = mainTimeline;
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    let raf = 0;
    const save = (): void => {
      raf = 0;
      const handle = activeSessionId === null ? mainVirtuosoRef.current : streamRef.current;
      const key = sessionSnapshotKey(sessionKey, densityRef.current);
      handle?.getState((snap) => { sessionSnapshotsRef.current.set(key, snap); });
    };
    // 추종 해제는 최근 700ms 안의 직접 위로-제스처(휠·터치·PageUp·Home 등)로만. scroll 거리로 끄지 마라 — virtuoso 가 버퍼(top:1600)를
    // 재측정하며 스스로 scroll 을 쏜다. 바닥에 닿으면 늘 재무장.
    let userUpIntentUntil = 0;
    const markUpIntent = (): void => { userUpIntentUntil = performance.now() + 700; };
    // §5.5 #17-16 ③ — 펼치는 클릭은 추종을 먼저 끄고 헤더 위치를 400ms 붙든다(안 하면 워치독이 펼친 내용을 밀어낸다). 접기는 그대로, 직접 스크롤하면 놓는다.
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
    // §5.5 #17-12 — 밀도 전환 자리 지키기: 바꾸기 직전(구독이 리렌더보다 먼저) 화면 항목을 적고, 새 목록에도 있는 첫 항목을 같은 높이에 붙든다.
    // 2프레임 못 찾으면 순번으로 한 번 옮긴다. 표식은 `expandHoldUntilRef`(cancelHold 가 놓는다).
    let anchorRaf = 0;
    let anchor: { entries: DensityAnchorEntry[]; until: number; misses: number; jumped: boolean } | null = null;
    const jumpToDensityAnchor = (entries: readonly DensityAnchorEntry[]): void => {
      if (activeSessionId !== null) {
        const handle = streamRef.current;
        if (!handle) return;
        const found = resolveDensityAnchor(entries, (id) => { const i = handle.indexOfItemId(id); return i >= 0 ? i : null; });
        if (found) handle.scrollToItemIndex(found.hit, found.entry.offset);
        return;
      }
      const timeline = mainTimelineRef.current;
      const found = resolveDensityAnchor(entries, (id) => {
        const i = timeline.findIndex((n) => mainTimelineNodeId(n) === id);
        return i >= 0 ? i : null;
      });
      if (found) mainVirtuosoRef.current?.scrollToIndex({ index: found.hit, align: 'start', offset: -found.entry.offset });
    };
    const anchorTick = (): void => {
      anchorRaf = 0;
      const a = anchor;
      if (!a || expandHoldUntilRef.current !== a.until || performance.now() > a.until) { anchor = null; return; }
      followRef.current = false;
      const found = resolveDensityAnchor(a.entries, (id) => findItemElement(el, id));
      if (found) {
        a.misses = 0;
        const delta = (found.hit.getBoundingClientRect().top - el.getBoundingClientRect().top) - found.entry.offset;
        if (Math.abs(delta) > 1) el.scrollTop += delta;
      } else if (!a.jumped && ++a.misses >= 2) {
        a.jumped = true;
        jumpToDensityAnchor(a.entries);
      }
      anchorRaf = requestAnimationFrame(anchorTick);
    };
    const unsubscribeDensity = useGraphStore.subscribe((state, prev) => {
      if (state.ideStreamDensity === prev.ideStreamDensity) return;
      if (followRef.current) return; // 바닥을 따라가던 화면은 새 바닥이 곧 보던 자리다(워치독이 붙인다).
      const contTop = el.getBoundingClientRect().top;
      const rects: { id: string; top: number; bottom: number }[] = [];
      el.querySelectorAll<HTMLElement>('[data-stream-item-id]').forEach((node) => {
        const id = node.dataset.streamItemId;
        if (!id) return;
        const r = node.getBoundingClientRect();
        rects.push({ id, top: r.top - contTop, bottom: r.bottom - contTop });
      });
      const entries = pickDensityAnchorEntries(rects, el.clientHeight);
      if (entries.length === 0) return;
      cancelHold();
      const until = performance.now() + DENSITY_ANCHOR_HOLD_MS;
      anchor = { entries, until, misses: 0, jumped: false };
      expandHoldUntilRef.current = until; // 이 구간엔 atBottom 통지·scroll 판정으로 추종이 재무장되지 않는다.
      sessionAtBottomRef.current.set(sessionKey, false);
      if (!anchorRaf) anchorRaf = requestAnimationFrame(anchorTick);
    });
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
    // 스크롤바 드래그는 wheel/touch/key 로 안 잡혀, 누른 채 scrollTop 이 줄면 위로-제스처로 친다(안 하면 워치독이 되끈다).
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
      //   §5.5 #17-12 — 자리를 붙드는 구간(펼침·밀도 전환)에는 재무장하지 않는다. 붙드는 동안 생긴 scroll 은
      //   보정 결과일 뿐 사용자가 바닥으로 내린 것이 아니다 — 재무장하면 워치독이 곧장 바닥으로 끌어간다.
      followRef.current = performance.now() < expandHoldUntilRef.current
        ? false
        : decideFollow({
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
      unsubscribeDensity();
      cancelHold();
      anchor = null;
      if (anchorRaf) cancelAnimationFrame(anchorRaf);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollEl, activeSessionId, sessionKey]);

  // 세션 진입 정착 덮개 — 버퍼 항목이 늦게 측정되며 출렁이므로 scrollHeight 가 5프레임 안정(상한 1200ms)될 때까지 가렸다 드러낸다.
  // 바닥이던 세션은 그동안 다시 붙이고, 올려 둔 세션은 복원 위치 그대로. useLayoutEffect(첫 프레임부터 덮는다).
  const [covering, setCovering] = useState(true);
  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) { setCovering(true); return; }
    setCovering(true);
    const atBottomOnEntry = sessionAtBottomRef.current.get(sessionKey) ?? true;
    // 진입 즉시 followRef 를 그 세션의 의도로(layout 단계) — 직전 세션의 true 가 남으면 복원 위치를 무시하고 바닥으로 끈다.
    followRef.current = atBottomOnEntry;
    let raf = 0;
    let stable = 0;
    let lastH = -1;
    const start = performance.now();
    const tick = (): void => {
      raf = 0;
      // 재고정도 실제 DOM 바닥으로(모델 좌표 scrollToIndex 금지). 첫 위치는 initialTopMostItemIndex=LAST 가 잡는다.
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
      // §5.5 #17-12 — 붙들던 자리(펼침·밀도 전환)는 놓는다. 보낸 말을 보여 주는 것이 먼저다.
      expandHoldUntilRef.current = 0;
      // 자기 메시지 전송은 추종을 무조건 재무장한다(위로 올려 둔 상태여도).
      followRef.current = true;
      sessionAtBottomRef.current.set(sessionKey, true);
      // 접착은 워치독 몫이라 여기선 재무장 + 1회 접착. 전송 후 400ms 는 위로-제스처 오탐이 꺼도 되살린다(엔터 직후라 스크롤-업일 수 없다).
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

  // 바닥 추종의 유일한 집행자 = DOM 워치독: followRef 가 켜진 동안 매 프레임 실제 바닥과 0.5px 넘게 어긋나면 붙인다(xterm 방식, 모든 높이 변화 흡수).
  // 모델 좌표를 목표로 삼지 마라(역주행). followRef=false 면 DOM 도 안 읽는다(그 자리 고정, 프레임 비용 0).
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

  // 북마크 이동 소비 — 출처 항목으로 스크롤(메인 탭은 scrollToIndex 후). nonce 로 1회 — 스토어를 clear 하면 effect cleanup 이 타이머를 취소해 handledNonce 로 가른다.
  const bookmarkScrollTarget = useGraphStore((s) => s.bookmarkScrollTarget);
  const streamRef = useRef<StreamRendererHandle>(null);
  const mainVirtuosoRef = useRef<VirtuosoHandle>(null);
  useEffect(() => {
    const target = bookmarkScrollTarget;
    if (!target) return;
    if (target.nonce === handledBookmarkNonceRef.current) return;
    if (target.sessionId !== activeSessionId) return; // 타깃 세션 활성화 전 — 대기(아직 nonce 미처리)
    // §5.5 #17-50 — 북마크는 대화의 자리다. 버블 지도를 보고 있으면 대화로 돌아가고, 대화가 선 다음 실행에서 옮긴다
    //   (nonce 를 아직 처리하지 않았으므로 bubbleOn 이 바뀌어 이 효과가 다시 돌 때 이어서 간다).
    if (bubbleOn) { setBubbleView(bubbleViewKey, false); return; }
    handledBookmarkNonceRef.current = target.nonce;
    // 점프 동안 워치독이 되끌지 않게 추종을 해제한다(바닥 근처에 닿으면 atBottomStateChange 가 재무장).
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
  }, [bookmarkScrollTarget, activeSessionId, bubbleOn, bubbleViewKey, setBubbleView]);

  // §5.5 대화 검색(Ctrl+F) — 화면 밖은 DOM 이 없어 데이터로 매칭 → scrollToIndex + performBookmarkScroll(Sub 탭은 StreamRenderer 핸들, 메인은 mainTimeline).
  // 터미널 모드는 IDETerminalView 자체 검색.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCaretRef = useRef(0);

  // 검색창 포커스 — 비동기 이동 끝에 포커스를 잃었고 다른 입력칸으로 간 것도 아니면 되돌린다. 이미 포커스면 손대지 않는다(focus/setSelectionRange 는 IME 조합을 깬다).
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
    // 검색 이동 동안 워치독이 되끌지 않게 추종을 해제한다(바닥 근처에 닿으면 재무장).
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
      if (isComposingKeyEvent(e)) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        // §5.5 #17-50 — 찾기는 대화에서 한다. 버블 지도를 보고 있으면 대화로 돌아가 검색바를 연다.
        if (bubbleOn) setBubbleView(bubbleViewKey, false);
        setSearchOpen(true);
        requestAnimationFrame(() => { const el = searchInputRef.current; if (el) { el.focus(); el.select(); } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showInteractiveTerminal, cellFocused, bubbleOn, bubbleViewKey, setBubbleView]);

  // 위로 점프(상태바 "프롬프트로 이동" 등) 전에 추종을 해제한다(워치독 되끌림 방지).
  const releaseFollowForJump = useCallback(() => {
    followRef.current = false;
    sessionAtBottomRef.current.set(sessionKey, false);
  }, [sessionKey]);

  // "맨 아래로" 점프 — 추종 재무장 + 즉시 1회 접착(이후는 워치독이 붙든다).
  const jumpToBottom = useCallback(() => {
    followRef.current = true;
    sessionAtBottomRef.current.set(sessionKey, true);
    glueToBottomDom();
    setShowJumpBottom(false);
  }, [sessionKey, glueToBottomDom]);

  // ─── §5.5 #17-48 내 입력 레일 — 맨 위 · 이전 · 다음 · 입력 눈금(맨 아래로 위) ───
  //   Sub 탭은 렌더러가 입력 목록을 올려 주고(목록이 실제로 바뀔 때만), 메인 탭은 타임라인의 command 줄이다.
  //   세션 키를 함께 적어 두어, 탭을 바꾼 첫 프레임에 앞 세션의 목록으로 그리지 않게 한다.
  const [subPromptOutline, setSubPromptOutline] = useState<{ key: string; prompts: readonly PromptRailEntry[] }>({ key: '', prompts: EMPTY_PROMPT_OUTLINE });
  const handlePromptOutline = useCallback((prompts: readonly PromptRailEntry[]) => {
    setSubPromptOutline({ key: sessionKey, prompts });
  }, [sessionKey]);
  const mainPromptOutlineNow = useMemo(
    () => (activeSessionId === null ? mainPromptOutlineOf(mainTimeline) : EMPTY_PROMPT_OUTLINE),
    [activeSessionId, mainTimeline],
  );
  // 타임라인은 스트리밍 줄마다 새 배열이다 — 입력 목록이 같으면 옛 참조를 써서 레일을 다시 그리지 않는다.
  const mainPromptOutlineRef = useRef<readonly PromptRailEntry[]>(EMPTY_PROMPT_OUTLINE);
  if (!samePromptOutline(mainPromptOutlineRef.current, mainPromptOutlineNow)) mainPromptOutlineRef.current = mainPromptOutlineNow;
  const railPrompts = activeSessionId !== null
    ? (subPromptOutline.key === sessionKey ? subPromptOutline.prompts : EMPTY_PROMPT_OUTLINE)
    : mainPromptOutlineRef.current;
  const railProbe = useCallback((): PromptProbe | null => {
    if (activeSessionId !== null) return streamRef.current?.promptProbe() ?? null;
    const el = scrollRef.current;
    if (!el) return null;
    const viewport = measureViewportItems(el);
    if (!viewport) return null;
    return probePromptPlace(mainTimelineRef.current, isMainPromptNode, viewport, mainTimelineNodeId);
  }, [activeSessionId]);
  // 입력으로 옮기기 — 상태바 점프와 같이 추종부터 놓는다(워치독이 바닥으로 되끌지 않게).
  const jumpToPrompt = useCallback((itemId: string) => {
    releaseFollowForJump();
    if (activeSessionId !== null) { streamRef.current?.jumpToItem(itemId); return; }
    const idx = mainTimelineRef.current.findIndex((n) => mainTimelineNodeId(n) === itemId);
    if (idx < 0) return;
    mainVirtuosoRef.current?.scrollToIndex({ index: idx, align: 'start', offset: -PROMPT_JUMP_TOP_GAP });
    settleItemAtTop(() => scrollRef.current, itemId);
  }, [activeSessionId, releaseFollowForJump]);
  const jumpToListTop = useCallback(() => {
    releaseFollowForJump();
    if (activeSessionId !== null) { streamRef.current?.jumpToTop(); return; }
    mainVirtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' });
  }, [activeSessionId, releaseFollowForJump]);

  // ─── §5.5 #17-50 버블 지도 → 대화로 돌아가기 ───
  //   돌아갈 자리: undefined = 없음 · 문자열 = 그 턴의 프롬프트 항목(`cmd-<명령 id>` — 두 탭이 같은 id 를 쓴다).
  //   맨 아래(답을 기다리는 질문)는 정착 덮개가 바닥에 붙여 주므로 따로 옮기지 않는다.
  const bubbleReturnRef = useRef<string | undefined>(undefined);
  const jumpToPromptRef = useRef(jumpToPrompt);
  jumpToPromptRef.current = jumpToPrompt;
  const returnFromBubbles = useCallback((turnId: string | null) => {
    if (turnId === null) {
      followRef.current = true;
      sessionAtBottomRef.current.set(sessionKey, true);
      bubbleReturnRef.current = undefined;
    } else {
      // 그 프롬프트로 — 돌아올 때 정착 덮개가 바닥 고정을 돌리지 않게 먼저 추종을 놓는다.
      followRef.current = false;
      sessionAtBottomRef.current.set(sessionKey, false);
      bubbleReturnRef.current = `cmd-${turnId}`;
    }
    setBubbleView(bubbleViewKey, false);
  }, [sessionKey, setBubbleView, bubbleViewKey]);
  // 가운데 에이전트 버블 더블클릭 = 보기 묶음의 [표준] 칸을 누른 것과 같다. 밀도는 전역이라 다른 칸의 대화도 표준이 된다.
  const setStreamDensity = useGraphStore((s) => s.setIdeStreamDensity);
  const showStandardFromBubbles = useCallback(() => {
    setStreamDensity('standard');
    returnFromBubbles(null);
  }, [setStreamDensity, returnFromBubbles]);
  useEffect(() => {
    if (bubbleOn || bubbleReturnRef.current === undefined) return;
    // 대화가 다시 서고(가상 리스트 첫 측정) 난 뒤에 옮긴다 — 북마크 이동이 세션을 세운 뒤 기다리는 것과 같은 결.
    const timer = window.setTimeout(() => {
      const target = bubbleReturnRef.current;
      bubbleReturnRef.current = undefined;
      if (target) jumpToPromptRef.current(target);
    }, BUBBLE_RETURN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [bubbleOn]);

  // §5.5 #17-50 — 지도의 재료: 이 칸의 대화와 **같은 조립**(`streams`) + 세션마다 원본 명령(턴 귀속은 원본 상태로 —
  //   표시용 사본은 조용한 압축 동안 대기 명령을 실행 중으로 올려 둔다). 꺼져 있으면 아무것도 만들지 않는다.
  const bubbleStreams = useMemo(
    () => (bubbleOn ? sessionBubbleStreamsOf(streams, originalCommands) : EMPTY_BUBBLE_STREAMS),
    [bubbleOn, streams, originalCommands],
  );
  const bubbleSessionIds = useMemo(
    () => (!bubbleOn ? EMPTY_BUBBLE_SESSION_IDS : activeSessionId !== null ? [activeSessionId] : subAgents.map((s) => s.id)),
    [bubbleOn, activeSessionId, subAgents],
  );
  const bubbleOlderSessionIds = useOlderSessionIds(bubbleSessionIds);
  const bubbleTitle = useGraphStore((s) => {
    if (!bubbleOn) return '';
    const agentLabel = s.nodeMap[agentId]?.label ?? '';
    if (activeSessionId === null) return agentLabel;
    return s.subAgents[agentId]?.find((x) => x.id === activeSessionId)?.label || agentLabel;
  });

  // §5.5 #17-36 ⑫ — 메모 링크의 "세션 글 위치"로 가기. 같은 화면 안이라 북마크 이동(#17-7)과 **같은 손잡이**를
  //   기다림 없이 부른다(북마크는 세션을 세운 뒤라 소비 효과가 타이머로 기다린다). 추종부터 놓는다.
  const jumpToStreamAnchor = useCallback((anchorId: string | undefined, text: string) => {
    releaseFollowForJump();
    if (activeSessionId !== null) { streamRef.current?.scrollToBookmark(anchorId, text); return; }
    const idx = anchorId ? mainTimelineRef.current.findIndex((n) => mainTimelineNodeId(n) === anchorId) : -1;
    if (idx >= 0) mainVirtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' });
    // 가상 리스트가 그 항목을 그린 뒤에 찾는다 — 화면 밖 항목은 DOM 에 없다.
    window.setTimeout(() => {
      const el = scrollRef.current;
      if (el) performBookmarkScroll(el, anchorId, text);
    }, idx >= 0 ? MEMO_LINK_JUMP_SETTLE_MS : 0);
  }, [activeSessionId, releaseFollowForJump]);
  // ⑫ 메모 판이 묻는 것(내 입력·다른 세션·루트)과 따라가는 길 — 정체가 고정된 묶음이라 판·카드가 다시 그려지지 않는다.
  const memoLinkHost = useMemoLinkHost({
    agentId,
    activeSessionId,
    isCustom,
    prompts: railPrompts,
    jumpToStream: jumpToStreamAnchor,
  });

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

  // §4 — 터미널 모드: 활성 탭을 PTY 로(key=termId, PTY 는 main 이 보존 → reattach). 훅은 전부 위에서 불러 이 조기 return 이 안전하다.
  if (showInteractiveTerminal) {
    // §4 (CMD) — 세션 탭이 정해지기 전엔 터미널을 세우지 않는다(CMD 는 메인 탭이 없고 세션은 곧 자동 선택·생성된다).
    // 'main' 으로 세우면 실제 PTY 가 떠 prefill 까지 그린 뒤 갈아엎히고, 그 PTY 는 회수되지 않는다(unmount 는 PTY 를 살려 두는 규약).
    if (!activeSessionId) {
      // 배경색은 터미널과 같은 값 — 이 찰나의 자리바꿈이 깜빡임으로 드러나지 않게.
      return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-vb-terminal" />;
    }
    // §4 — CMD 카드는 터미널 안 ANSI 박스(IDETerminalView 의 TerminalCardSniffer). 여기선 터미널만.
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
      {/* 출력 영역 — 스크롤은 virtuoso 단독. 이 div 는 클릭/우클릭 위임 + flex 높이만. */}
      <div
        ref={ideBodyRef}
        data-ide-text-viewport=""
        onClick={handleAckClick}
        onContextMenu={handleContextMenu}
        className="relative flex min-h-0 flex-1 flex-col bg-gray-950"
      >
        {bubbleOn ? (
          /* §5.5 #17-50 — 대화 칸 자리에 이 세션만의 버블 지도. 대화에만 사는 덧판(메모 판·배율 배지·검색바·놓친 카드·
             내 입력 레일·정착 덮개)은 서지 않는다 — 그 판들이 가리키는 대화가 화면에 없다. */
          <SessionBubbleView
            agentId={agentId}
            sessionId={activeSessionId}
            streams={bubbleStreams}
            olderSessionIds={bubbleOlderSessionIds}
            title={bubbleTitle}
            running={streamSessionRunning}
            pendingAsks={askCards.length}
            onReturnToStream={returnFromBubbles}
            onShowStandard={showStandardFromBubbles}
          />
        ) : (<>
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
          linkHost={memoLinkHost}
        />
        {/* 줌 배율 배지 — 바뀐 직후만 떴다 사라진다. 페이드를 위해 늘 마운트(opacity 만), 검색바가 열리면 양보, pointer-events-none. */}
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
            {/* §4 — 작업 신고 카드는 StreamRenderer 안에서 createdAt 기준 인라인 합류(하단 고정 ❌). */}
            {/* StreamRenderer Virtuoso 가 스크롤러를 단독 소유(onScrollerRef 로 상태바·북마크에), key={sessionKey} + restoreState 로 복원.
               §5.3 #12-2 AskUserQuestion 카드는 askRequests 로 리스트 안에. */}
            <StreamRenderer
              key={sessionKey}
              ref={streamRef}
              events={activeStreamEvents}
              commands={commands.filter((c) => c.subAgentId === activeSessionId)}
              // §2.4 — 바닥 "작업 중..." 은 원본 큐 공유 술어로 정한다(표시용 사본이면 승격 탓에 켜지거나 조용한 압축 중 꺼진다).
              sessionBusy={sessionHasWork}
              // §5.5 #17-18 ⑪ — 같은 원본 큐 + 세션 필터에서 나온 "줄만 서 있는가".
              sessionWaiting={sessionWaiting}
              // §2.4 (무응답) — 라이브 1줄 시계의 재료(메인 탭과 같은 값). 보인 줄만 재면 조용한 압축 뒤의
              //   새 턴이 앞 턴 끝부터 잰 "마지막 업데이트 N 전"으로 시작한다.
              sessionActivityAt={sessionLastActivityAt}
              sessionActivityHidden={sessionHiddenTurn}
              // §5.5 #17-10 ⑥-6 — 라이브 1줄이 평소 적는 경과의 시작점(메인 탭과 같은 값).
              sessionTurnStartedAt={sessionTurnStartedAt}
              // §5.5 #17-24 ⑥ — 접는 중이면 라이브 1줄이 `압축 중`(메인 탭과 같은 값).
              sessionCompactingSince={sessionCompactingSince}
              // §4 — result 블록 좋아요/싫어요 피드백 컨텍스트(소유 에이전트 + 이 세션 탭).
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
              // §5.5 #17-48 — 내 입력 레일의 눈금 목록.
              onPromptOutline={handlePromptOutline}
            />
          </>
        ) : (
          /* ── Agent 탭(메인): 기존 터미널 라인 + AskUserQuestion 카드. 비어있을 땐 그냥 빈 배경(미니멀) ── */
          <>
            {/* §4 — 터미널 항목과 작업 신고 카드를 시간순으로 합친 mainTimeline(신고 하단 고정 ❌). */}
            {/* 메인 Virtuoso 도 스크롤러를 단독 소유(height:100%). mainTimeline 이 비면 그리지 않는다. */}
            {mainTimeline.length > 0 && (
              <Virtuoso
                key={sessionKey}
                ref={mainVirtuosoRef}
                className="scrollbar-thin"
                style={{ height: '100%' }}
                scrollerRef={setScrollNode}
                // 바닥 추종 집행은 DOM 워치독 단독 — followOutput 을 주지 마라(모델 좌표로 역주행한다).
                atBottomStateChange={handleAtBottomChange}
                atBottomThreshold={40}
                // 마지막 줄과 하단 입력부 사이 여백(리스트 일부라 바닥 접착에 포함).
                components={{ Footer: StreamEndGap }}
                // 복원 스냅샷이 있으면(위로 올려둔 세션) 그 위치/측정값으로, 없으면(첫 진입/바닥 추종 세션)
                //   마지막 항목(새 바닥)에서 시작 — 둘은 배타.
                {...(restoreStateFor(sessionKey)
                  ? { restoreStateFrom: restoreStateFor(sessionKey) }
                  : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
                data={mainTimeline}
                // 앞쪽 절단 누적 수 — virtuoso 가 공식 shift 경로로 sizeTree 키 재정렬 + scrollTop 보정을 한다.
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
                              ? <ThinkingLiveLine label={t(MAIN_LIVE_LABEL_KEY[n.item.mode])} mode={n.item.mode} lastActivityAt={n.item.lastActivityAt} turnStartedAt={n.item.turnStartedAt} hiddenTurn={n.item.hiddenTurn === true} compactingSince={n.item.compactingSince ?? null} />
                              : <TerminalLine entry={n.item} density={density} run={mainSpeechRuns.get(itemId) ?? 'solo'} agentId={agentId} />}
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

        {/* 진입 정착 덮개(gray-950) — 가릴 본문이 있을 때만 불투명·클릭 차단, 아니면 투명 + pointer-events-none. */}
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

        {/* §5.5 #17-48 — 입력 레일 알약(맨 위·이전·입력 점·다음·맨 아래로). "맨 아래로"는 바닥에서 멀면 켜진다(입력이 없으면 그것만).
           key 로 세션마다 새로 세운다(붙든 자리·팝업이 새지 않게). */}
        <PromptRail
          key={sessionKey}
          prompts={railPrompts}
          probe={railProbe}
          scrollEl={scrollEl}
          onJumpToPrompt={jumpToPrompt}
          onJumpToTop={jumpToListTop}
          onJumpToBottom={jumpToBottom}
          showJumpBottom={showJumpBottom}
        />
        </>)}
      </div>

      {/* 하단 상태바 — §5.5 #17-12 메인 탭에도(밀도 토글이 닿게, 명령 전체). [중지]는 입력창에만. */}
      <StreamStatusBar
        commands={activeSessionId !== null ? commands.filter((c) => c.subAgentId === activeSessionId) : commands}
        scrollRef={scrollRef}
        streamRef={streamRef}
        onJump={releaseFollowForJump}
        // §5.5 #17-12 — "지금 무엇을"(마지막 계획 단계).
        //   메인 탭은 단일 스트림이 아니므로 계획 줄 없이 프롬프트 미리보기를 유지한다.
        events={activeSessionId !== null ? activeStreamEvents : EMPTY_STREAM_EVENTS}
        sessionRunning={streamSessionRunning}
        hasExecutingCommand={sessionExecuting}
        // §5.5 #17-50 — 지도를 보고 있으면 줄 누름 = 대화로 돌아가 그 프롬프트로.
        returnToStream={bubbleOn ? returnFromBubbles : undefined}
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

      <ImageLightboxHost agentId={agentId} activeSessionId={activeSessionId} canAttach={!isReadOnly} />

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
