import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent, AgentEvent, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { useGraphStore, agentSessionInputKey, selectIDEOverlay } from '../../stores/graphStore.js';
import type { AgentSessionInputAttachment } from '../../stores/graphStore.js';
import { useAvailableSkills, type SkillInfo } from '../../hooks/useAvailableSkills.js';
import { StreamRenderer, type StreamRendererHandle } from './StreamRenderer.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { decideFollow } from './followDecision.js';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement, resolveAnchorIdFromSelection } from './bookmarkScroll.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { IDETerminalView } from './IDETerminalView.js';
import { SystemNode, parseSystemSubtype } from './SystemNode.js';
import { ThinkingDots, ThinkingLiveLine } from './ThinkingIndicator.js';
import { CollapsiblePrompt, AiSpeakerGlyph } from './CollapsiblePrompt.js';

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

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
 */
function performBookmarkScroll(container: HTMLElement, anchorId: string | undefined, text: string): boolean {
  if (anchorId) {
    const el = findItemElement(container, anchorId);
    if (el) {
      scrollElementIntoCenter(container, el);
      flashElement(el);
      // 항목 안에서 정확한 텍스트도 선택해 주면 더 좋다(있으면).
      const range = findTextRangeInContainer(el, text);
      if (range) {
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
      return true;
    }
  }
  const range = findTextRangeInContainer(container, text);
  if (range) {
    scrollRangeIntoCenter(container, range);
    return true;
  }
  return false;
}

// ─── 통합 터미널 항목 ───

interface TerminalEntry {
  id: string;
  type: 'command' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system';
  text: string;
  timestamp: number;
  sessionLabel?: string;
  toolName?: string;
}

/** 접을 수 있는 그룹 (tool_use+tool_result 쌍, 연속 text 블록) */
interface TerminalGroup {
  kind: 'group';
  id: string;
  groupType: 'tool' | 'text' | 'thinking';
  header: string;
  toolName?: string;
  timestamp: number;
  sessionLabel?: string;
  entries: TerminalEntry[];
  /** tool이 아직 실행 중 (result 없음) */
  isActive: boolean;
}

/** 생각 중 라이브 1줄 — 실제 thinking 중일 때만 본문 하단에 1개 등장 */
interface TerminalThinkingLive {
  kind: 'thinking-live';
  id: string;
  timestamp: number;
}

type TerminalItem = (TerminalEntry & { kind?: undefined }) | TerminalGroup | TerminalThinkingLive;

/** 스트림 이벤트 + 명령 대기열 + agentEvents를 통합하여 터미널 항목 생성 */
function buildEntries(
  commands: QueuedCommand[],
  subAgents: SubAgent[],
  streams: Record<string, SubAgentStreamEvent[]>,
  activeSessionId: string | null,
  agentEvents: AgentEvent[],
): TerminalEntry[] {
  const entries: TerminalEntry[] = [];
  const subLabelMap = new Map(subAgents.map((s) => [s.id, s.label]));

  // 메인 뷰: Hook 에이전트의 기존 프롬프트+결과 표시
  if (activeSessionId === null && agentEvents.length > 0) {
    for (const evt of agentEvents) {
      entries.push({
        id: `evt-${evt.id}`,
        type: 'command',
        text: evt.message,
        timestamp: evt.timestamp,
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

  // 명령 대기열 프롬프트 — 상태 무관하게 항상 표시 (queued는 system 스타일, 나머지는 command 스타일)
  const targetCmds = activeSessionId === null
    ? commands
    : commands.filter((c) => c.subAgentId === activeSessionId);

  for (const cmd of targetCmds) {
    const sessionLabel = activeSessionId === null && cmd.subAgentId
      ? subLabelMap.get(cmd.subAgentId)
      : undefined;

    entries.push({
      id: `cmd-${cmd.id}`,
      type: cmd.status === 'queued' ? 'system' : 'command',
      text: cmd.text,
      timestamp: cmd.timestamp,
      sessionLabel,
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
        if (isThinkingPulse(evt)) continue; // 생각 중 펄스는 본문에 쌓지 않음 (라이브 1줄로 대체)
        entries.push({
          id: evt.id,
          type: evt.eventType,
          text: evt.content,
          timestamp: evt.timestamp,
          sessionLabel: label,
          toolName: evt.toolName,
        });
      }
    }
  } else {
    // 특정 세션만
    const events = streams[activeSessionId];
    if (events) {
      for (const evt of events) {
        if (isThinkingPulse(evt)) continue; // 생각 중 펄스는 본문에 쌓지 않음 (라이브 1줄로 대체)
        entries.push({
          id: evt.id,
          type: evt.eventType,
          text: evt.content,
          timestamp: evt.timestamp,
          toolName: evt.toolName,
        });
      }
    }
  }

  // completed/error 명령의 결과 — 스트림 result 이벤트가 없을 때만 cmd.result 폴백 (프롬프트는 위에서 이미 push)
  for (const cmd of targetCmds) {
    if (cmd.status !== 'completed' && cmd.status !== 'error') continue;
    if (!cmd.result) continue;
    const sessionLabel = activeSessionId === null && cmd.subAgentId
      ? subLabelMap.get(cmd.subAgentId)
      : undefined;

    const subStreams = cmd.subAgentId ? (streams[cmd.subAgentId] ?? []) : [];
    const hasResultStream = subStreams.some((e) => e.eventType === 'result');
    if (hasResultStream) continue;

    entries.push({
      id: `cmdres-${cmd.id}`,
      type: cmd.status === 'error' ? 'error' : 'result',
      text: cmd.result,
      timestamp: cmd.timestamp + 1,
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
    } else {
      coalesced.push(e.type === 'text' ? { ...e } : e); // text 는 합치기 대상이라 사본(원본 불변)
    }
  }
  return coalesced;
}

// ─── flat 항목 → 그룹화 ───

/** tool_use+tool_result 쌍을 접을 수 있는 그룹으로, 연속 text를 하나로 묶기.
 *  thinking 블록은 항상 하나로 합쳐 VS Code 처럼 "생각 중 …" 1줄로 표시한다.
 *  agentBusy 이고 thinking 이 마지막 항목이면 = 아직 생각 중 → 도트 애니메이션. */
function groupEntries(flat: TerminalEntry[], agentBusy: boolean): TerminalItem[] {
  const items: TerminalItem[] = [];
  let i = 0;

  while (i < flat.length) {
    const cur = flat[i]!;

    // thinking → 연속 thinking 을 항상 1개 그룹으로 합치기 (단독 thinking 포함)
    if (cur.type === 'thinking') {
      const children: TerminalEntry[] = [cur];
      let j = i + 1;
      while (j < flat.length && flat[j]!.type === 'thinking') {
        children.push(flat[j]!);
        j++;
      }
      items.push({
        kind: 'group',
        id: `grp-${cur.id}`,
        groupType: 'thinking',
        header: '',
        timestamp: cur.timestamp,
        sessionLabel: cur.sessionLabel,
        entries: children,
        isActive: false,
      });
      i = j;
      continue;
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

  // 마지막 항목이 thinking 그룹이고 에이전트가 작동 중이면 = 아직 생각 중 → 활성(도트 애니메이션).
  // 이후 text/tool 이 따라붙으면 생각이 끝난 것이므로 정적 1줄(접힘)로 남는다.
  if (agentBusy) {
    const last = items[items.length - 1];
    if (last && last.kind === 'group' && last.groupType === 'thinking') {
      last.isActive = true;
    }
  }

  return items;
}

// ─── 터미널 출력 라인 ───

const TYPE_STYLES: Record<string, { color: string; prefix: string }> = {
  command:     { color: 'text-blue-300',       prefix: '>' },
  text:        { color: 'text-gray-200',       prefix: ' ' },
  thinking:    { color: 'text-violet-300/70',  prefix: '\u2026' },
  tool_use:    { color: 'text-amber-300/90',   prefix: '\u2192' },
  tool_result: { color: 'text-gray-400',       prefix: '\u2190' },
  result:      { color: 'text-emerald-300/90', prefix: '\u2713' },
  error:       { color: 'text-red-300/90',     prefix: '!' },
  system:      { color: 'text-gray-500',       prefix: '*' },
};

function TerminalLine({ entry }: { entry: TerminalEntry }): React.JSX.Element {
  // SDK system 메시지 subtype([task_started] 등)은 날 텍스트 대신 깔끔한 칩으로.
  if (entry.type === 'system') {
    const subtype = parseSystemSubtype(entry.text);
    if (subtype) return <SystemNode subtype={subtype} />;
  }
  // 사용자 입력(command)은 길이와 무관하게 StreamRenderer(Sub 탭)와 동일한 "내 메시지" 말풍선으로.
  // (탭에 따라 옛 평문으로 뜨던 불일치 제거 — 두 경로가 같은 CollapsiblePrompt 사용.)
  if (entry.type === 'command') {
    return (
      <div className="px-3 py-1">
        <CollapsiblePrompt prompt={entry.text} />
      </div>
    );
  }
  // AI 일상 대화(assistant text)는 Sub 탭 TextBlock 과 동일하게 박스 없이 평범한 본문 + 왼쪽 스파클
  // 글리프로만 표식한다(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분).
  if (entry.type === 'text') {
    return (
      <div className="px-3 py-1">
        <div className="flex gap-2">
          <AiSpeakerGlyph />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-200">
            {entry.sessionLabel && (
              <span className="mr-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] font-semibold text-cyan-400/80">
                {entry.sessionLabel}
              </span>
            )}
            {entry.text}
          </span>
        </div>
      </div>
    );
  }
  const style = TYPE_STYLES[entry.type] ?? TYPE_STYLES['text']!;

  return (
    <div className="group flex gap-2 px-3 py-1 hover:bg-gray-800/40">
      <span className="flex-shrink-0 select-none pt-px text-[10px] text-gray-500">{formatTime(entry.timestamp)}</span>
      <span className={`w-3 flex-shrink-0 select-none text-center font-mono text-[13px] ${style.color}`}>{style.prefix}</span>
      <div className="min-w-0 flex-1">
        {entry.sessionLabel && (
          <span className="mr-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] font-semibold text-cyan-400/80">
            {entry.sessionLabel}
          </span>
        )}
        {entry.toolName && (
          <span className="mr-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold text-amber-400/80">
            {entry.toolName}
          </span>
        )}
        <span className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${style.color}`}>
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

/** tool_use 입력의 요약 (첫 80자) */
function toolInputPreview(entry: TerminalEntry): string {
  const raw = entry.text;
  if (!raw) return '';
  const trimmed = raw.slice(0, 100);
  return trimmed.length < raw.length ? `${trimmed}...` : trimmed;
}

function TerminalGroupLine({ group }: { group: TerminalGroup }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const isTool = group.groupType === 'tool';

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
        onClick={() => setOpen((v) => !v)}
        className={`group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors ${headerBg}`}
        title={open ? 'Click to collapse' : 'Click to expand'}
      >
        {/* 시간 */}
        <span className="flex-shrink-0 select-none text-[10px] text-gray-500">
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
            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] font-semibold text-cyan-400/80">
              {group.sessionLabel}
            </span>
          )}
          {isTool && group.toolName && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400/90">
              {group.toolName}
            </span>
          )}
          {/* 미리보기 텍스트 (접힌 상태) */}
          {!open && preview && (
            <span className="truncate font-mono text-[12px] text-gray-400">
              {preview}
            </span>
          )}
          {!isTool && (
            <span className="truncate text-[12px] text-gray-300">
              {group.header}
            </span>
          )}
        </div>

        {/* 오른쪽: 스피너 or 아이템 카운트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {group.isActive && <Spinner />}
          {!group.isActive && isTool && group.entries.length > 1 && (
            <span className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400">
              {group.entries.length - 1} result{group.entries.length > 2 ? 's' : ''}
            </span>
          )}
          {/* hover 힌트 */}
          <span className="hidden text-[10px] text-gray-500 group-hover/hdr:inline">
            {open ? 'collapse' : 'expand'}
          </span>
        </div>
      </button>

      {/* 펼친 내용 */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/50">
          {group.entries.map((e) => (
            <TerminalLine key={e.id} entry={e} />
          ))}
        </div>
      )}

      {/* 활성 상태 하단 프로그레스 바 */}
      {group.isActive && (
        <div className="h-[2px] w-full overflow-hidden bg-gray-800/30">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/60"
            style={{ animation: 'slide 1.5s ease-in-out infinite' }}
          />
        </div>
      )}
    </div>
  );
}

// ─── 사고 중(thinking) — VS Code 스타일 1줄 "생각 중 …" + 접이식 전체 보기 ───

function ThinkingGroupLine({ group }: { group: TerminalGroup }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fullText = group.entries.map((e) => e.text).join('');
  const preview = fullText.replace(/\s+/g, ' ').trim().slice(0, 100);

  return (
    <div className="mx-1.5 my-0.5 overflow-hidden rounded border-l-2 border-violet-500/40">
      {/* 헤더 — 클릭으로 전체 사고 과정 토글 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-violet-500/10"
        title={open ? 'Click to collapse' : 'Click to expand'}
      >
        {/* 시간 */}
        <span className="flex-shrink-0 select-none text-[10px] text-gray-500">
          {formatTime(group.timestamp)}
        </span>

        {/* 셰브론 */}
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg
            className={`h-2.5 w-2.5 text-violet-400/70 transition-transform group-hover/hdr:text-violet-300 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {group.sessionLabel && (
          <span className="flex-shrink-0 rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] font-semibold text-cyan-400/80">
            {group.sessionLabel}
          </span>
        )}

        {/* "생각 중" 라벨 — 진행 중이면 도트 애니메이션 */}
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[12px] italic text-violet-300/85">
          {t('ide.streamRenderer.thinking')}
          {group.isActive && <ThinkingDots />}
        </span>

        {/* 완료 후 접힘 상태일 때만 첫 문장 미리보기 */}
        {!open && !group.isActive && preview && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-violet-300/50">
            {preview}
          </span>
        )}
      </button>

      {/* 펼친 전체 사고 과정 */}
      {open && (
        <div className="border-t border-violet-500/20 bg-gray-950/50 px-4 py-2.5">
          <div className="whitespace-pre-wrap break-words text-[13px] italic leading-relaxed text-violet-200/90">
            {fullText}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 명령 입력 영역 ───

interface TerminalInputProps {
  agentId: string;
  activeSessionId: string | null;
}

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
  const [stopping, setStopping] = useState(false);
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
  // 이 탭(activeSessionId) 에서 현재 실행 중인 커맨드 존재 여부 — Run/Stop 토글 판정.
  // 메인 탭(activeSessionId===null) 은 여러 서브가 병렬 실행될 수 있으므로 Stop 대상이 모호 → Run 유지.
  const executingForSession = useGraphStore((s) => {
    if (activeSessionId === null) return false;
    const q = s.queuedCommands[agentId];
    if (!q) return false;
    return q.some((c) => c.subAgentId === activeSessionId && c.status === 'executing');
  });
  const sid = useMemo(() => agents.find((a) => a.id === agentId)?.path ?? null, [agents, agentId]);
  const sidRef = useRef<string | null>(sid);
  const agentIdRef = useRef<string>(agentId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // §5.5 #17-2 v2.30 / #17-4 v2.32 — 슬래시 자동완성. `useAvailableSkills` 가 모듈 캐시를 공유.
  // v2.59 — 이 에이전트가 속한 프로젝트의 스킬만 자동완성(탭별 개별 조회).
  const slashProjectName = useGraphStore((s) => s.agentProjects[agentId]);
  const { skills: availableSkills, loaded: skillsLoaded } = useAvailableSkills(slashProjectName, agentId);
  const [slashIndex, setSlashIndex] = useState(0);

  useEffect(() => { sidRef.current = sid; }, [sid]);
  useEffect(() => { agentIdRef.current = agentId; }, [agentId]);

  // 세션 전환 시 textarea height 를 새 텍스트 길이에 맞춰 재조정.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
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
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // 전송하면 히스토리 탐색 상태 초기화.
    historyIdxRef.current = -1;
  }, [text, agentId, activeSessionId, addCommand, attachments, hasPendingUploads, registerAttachmentPreview, clearAgentSessionInput, setText, setAttachments]);

  const handleStop = useCallback(async () => {
    if (!activeSessionId || stopping) return;
    setStopping(true);
    try {
      await fetch(`${API_BASE}/api/subagents/${agentId}/${activeSessionId}/stop`, { method: 'POST' });
    } catch { /* no-op — 실패해도 다음 close 이벤트에서 UI 복구 */ }
    // 서버 close 핸들러가 status 업데이트하면 스냅샷 브로드캐스트로 버튼이 Run 으로 돌아온다.
    // 안전장치로 짧은 타임아웃 후 로컬 stopping 해제.
    setTimeout(() => setStopping(false), 1500);
  }, [agentId, activeSessionId, stopping]);

  // §5.5 #17-2 v2.30 — text 가 `/` 로 시작하고 첫 토큰을 아직 타이핑 중이면 드롭다운 활성.
  // 매칭 0개여도 드롭다운은 열려 "No matching skills" hint 표기.
  const slashState = useMemo(() => {
    if (!text.startsWith('/')) return null;
    const firstWord = text.slice(1).split(/\s/)[0] ?? '';
    if (text.length > firstWord.length + 1) return null;
    const filter = firstWord.toLowerCase();
    const matched = filter.length === 0
      ? availableSkills
      : availableSkills.filter((s) => s.name.toLowerCase().includes(filter));
    return { filter, matched };
  }, [text, availableSkills]);

  const slashOpen = slashState !== null;
  const slashKey = slashState?.filter ?? '';
  useEffect(() => { setSlashIndex(0); }, [slashKey]);

  const confirmSlash = useCallback((skill: SkillInfo) => {
    setAgentSessionInputText(agentId, activeSessionId, `/${skill.name} `);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });
  }, [agentId, activeSessionId, setAgentSessionInputText]);

  // §5.5 — 입력 명령 히스토리: 이 세션에서 보낸 사용자 프롬프트를 ↑/↓ 로 재호출(터미널/REPL/챗 관례).
  //   커서가 첫 줄일 때 ↑(더 오래된 것), 마지막 줄일 때 ↓(더 최근/원래 draft)에만 반응해 멀티라인 편집을
  //   깨지 않는다. 슬래시 드롭다운/한글 IME 조합 중엔 비활성. queuedCommands 에서 이 세션의 프롬프트만 추출.
  const sessionCommands = useGraphStore((s) => s.queuedCommands[agentId]);
  const commandHistory = useMemo(() => {
    const texts: string[] = [];
    for (const c of sessionCommands ?? []) {
      if (activeSessionId !== null && c.subAgentId !== activeSessionId) continue;
      const tx = (c.text ?? '').trim();
      if (tx && texts[texts.length - 1] !== tx) texts.push(tx); // 연속 중복 제거
    }
    return texts;
  }, [sessionCommands, activeSessionId]);
  const historyIdxRef = useRef(-1);   // -1 = 미탐색(현재 draft). 그 외 = commandHistory 인덱스.
  const historyDraftRef = useRef(''); // 탐색 시작 시 원래 draft 보존(↓ 로 끝까지 내려오면 복원).
  const applyHistoryText = useCallback((value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });
  }, [setText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (slashOpen && slashState) {
      const matched = slashState.matched;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (matched.length > 0) setSlashIndex((i) => Math.min(matched.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (matched.length > 0) setSlashIndex((i) => Math.max(0, i - 1));
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
    if (!slashOpen && !composing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const el = textareaRef.current;
      if (el && el.selectionStart === el.selectionEnd) {
        const caret = el.selectionStart ?? 0;
        const value = el.value;
        if (e.key === 'ArrowUp') {
          const inFirstLine = value.slice(0, caret).indexOf('\n') === -1;
          if (inFirstLine && commandHistory.length > 0) {
            e.preventDefault();
            if (historyIdxRef.current === -1) { historyDraftRef.current = value; historyIdxRef.current = commandHistory.length; }
            const nextIdx = Math.max(0, historyIdxRef.current - 1);
            historyIdxRef.current = nextIdx;
            applyHistoryText(commandHistory[nextIdx] ?? '');
            return;
          }
        } else { // ArrowDown — 히스토리 탐색 중일 때만 더 최근/원래 draft 로.
          const inLastLine = value.slice(caret).indexOf('\n') === -1;
          if (inLastLine && historyIdxRef.current !== -1) {
            e.preventDefault();
            const nextIdx = historyIdxRef.current + 1;
            if (nextIdx >= commandHistory.length) { historyIdxRef.current = -1; applyHistoryText(historyDraftRef.current); }
            else { historyIdxRef.current = nextIdx; applyHistoryText(commandHistory[nextIdx] ?? ''); }
            return;
          }
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 실행 중에도 Enter 는 "덧말"(추가 대화) 로 동작 — 중지하지 않고 후속 메시지를 큐에 넣는다.
      // 중지는 마우스로 좌측 중지 버튼을 눌러야만 — Enter 로 실행을 끊지 않는다(사용자 보고 흐름).
      handleSubmit();
    }
  }, [slashOpen, slashState, slashIndex, confirmSlash, setText, handleSubmit, commandHistory, applyHistoryText]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // 사용자가 직접 타이핑하면 히스토리 탐색 종료(다음 ↑ 는 현재 편집분을 draft 로 다시 시작).
    historyIdxRef.current = -1;
    // 타이핑 = 완료 알림 확인 — 도트 녹색→회색.
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged]);

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
      e2.style.height = 'auto';
      e2.style.height = `${Math.min(e2.scrollHeight, 120)}px`;
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
    <div className="relative flex flex-col gap-1.5 border-t border-gray-700 bg-gray-900/80 px-3 py-2">
      {/* §5.5 #17-2 v2.30 — 슬래시 자동완성 드롭다운 (입력행 바로 위) */}
      {slashOpen && slashState && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto rounded-t border border-b-0 border-gray-700 bg-gray-900 shadow-lg scrollbar-thin">
          {slashState.matched.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-500">
              {skillsLoaded ? t('ide.mainArea.slashEmpty') : t('ide.mainArea.slashLoading')}
            </div>
          ) : (
            slashState.matched.map((s, idx) => {
              const isActive = idx === Math.min(slashIndex, slashState.matched.length - 1);
              const accentBg = s.source === 'project' ? 'bg-emerald-500/15' : 'bg-purple-500/15';
              const accentText = s.source === 'project' ? 'text-emerald-400' : 'text-purple-400';
              return (
                <button
                  key={`${s.source}:${s.name}`}
                  type="button"
                  onMouseDown={(ev) => { ev.preventDefault(); confirmSlash(s); }}
                  onMouseEnter={() => setSlashIndex(idx)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${isActive ? accentBg : 'hover:bg-gray-800/60'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-[12px] font-semibold ${accentText}`}>/{s.name}</span>
                    {s.source === 'plugin' && s.pluginName && (
                      <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-purple-400/80">
                        {s.pluginName}
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <span className="line-clamp-2 text-[10px] leading-tight text-gray-500">
                      {s.description}
                    </span>
                  )}
                </button>
              );
            })
          )}
          <div className="border-t border-gray-800 bg-gray-950/70 px-3 py-1 text-[10px] text-gray-600">
            {t('ide.mainArea.slashHint')}
          </div>
        </div>
      )}
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
                onClick={() => { if (!a.uploading && !a.error) openImageLightbox(a.previewUrl); }}
                className={`h-full w-full object-cover ${a.uploading || a.error ? 'opacity-40' : 'cursor-zoom-in'}`}
              />
              {a.uploading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                </div>
              )}
              {a.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
                  <span className="text-[9px] font-semibold text-red-200">{t('ide.mainArea.attachmentError')}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(a.tempId)}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-[10px] text-gray-200 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
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
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onContextMenu={handleInputContextMenu}
          rows={1}
          placeholder={activeSessionId === null ? t('ide.mainArea.inputPlaceholderNew') : t('ide.mainArea.inputPlaceholder')}
          className="scrollbar-thin min-h-[28px] flex-1 resize-none bg-transparent text-[13px] leading-7 text-gray-200 placeholder-gray-500 outline-none"
          style={{ maxHeight: 120 }}
          data-ide-input={agentId}
          data-ide-input-session={activeSessionId ?? ''}
        />
        {executingForSession ? (
          // 실행 중: 좌측 [중지](마우스 클릭 전용) + 우측 [덧말](Enter=추가 대화).
          //   중지는 실행을 끊는 파괴적 동작이라 마우스로만 — Enter 는 handleSubmit(덧말)에 배정.
          //   덧말 = 멈추지 않고 후속 메시지를 큐에 추가(서버 busy 가드가 현재 턴 종료 후 이어서 처리).
          <>
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="flex h-7 flex-shrink-0 items-center gap-1 rounded bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex h-7 flex-shrink-0 items-center rounded bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
            title={hasPendingUploads ? t('panel.commandQueue.waitingForUpload') : undefined}
          >
            {t('ide.mainArea.run')}
          </button>
        )}
      </div>
      {inputCtx && (
        <TerminalContextMenu x={inputCtx.x} y={inputCtx.y} items={inputCtxItems} onClose={closeInputCtx} />
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
}

const STATUS_SUMMARY_MAX = 80;

function StreamStatusBar({ commands, scrollRef, streamRef }: StreamStatusBarProps): React.JSX.Element | null {
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

  const handleJump = useCallback(() => {
    if (!target) return;
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
  }, [target, scrollRef, streamRef]);

  if (!target) return null;

  const isExecuting = target.status === 'executing';
  const isError = target.status === 'error';
  const preview = target.text.length > STATUS_SUMMARY_MAX
    ? `${target.text.slice(0, STATUS_SUMMARY_MAX)}…`
    : target.text;

  if (isExecuting) {
    // 첨부 썸네일 버튼이 안에 있어 <button> 중첩이 불가 → div[role=button] 으로 점프 처리.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleJump}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJump(); } }}
        title={t('ide.mainArea.scrollPrompt')}
        className="group flex w-full flex-shrink-0 cursor-pointer items-center gap-2 border-t border-gray-800 bg-gray-900/70 px-4 py-1.5 text-left transition-colors hover:bg-gray-800/70"
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
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400 group-hover:text-gray-200">{preview}</span>
        <span className="flex-shrink-0 text-[10px] text-gray-600 group-hover:text-gray-300">{'↑'}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleJump}
      className="group flex w-full flex-shrink-0 items-center gap-2 border-t border-gray-800 bg-gray-900/70 px-4 py-1.5 text-left transition-colors hover:bg-gray-800/70"
      title={t('ide.mainArea.scrollPrompt')}
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
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300 group-hover:text-gray-100">
        {preview}
      </span>
      <span className="flex-shrink-0 text-[10px] text-gray-600 group-hover:text-gray-300">
        {'↑'}
      </span>
    </button>
  );
}

// ─── 우클릭 컨텍스트 메뉴 (v2.31 §5.5 #17-3) ───

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

function TerminalContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // 뷰포트 클리핑: 메뉴가 화면 밖으로 넘치면 좌상단 좌표 보정 (mount 직후 1회).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y]);

  // 외부 mousedown / Esc → 닫기.
  // 누수 방지: onClose 를 ref 로 고정해 의존성에서 빼면, 호출자가 매 렌더 새 콜백을 줘도
  //   리스너를 재등록(중복 누적)하지 않는다 — 마운트당 1회만 등록/해제.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
      className="min-w-[180px] rounded border border-gray-700 bg-gray-900 py-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          disabled={it.disabled}
          title={it.disabled ? it.disabledTitle : undefined}
          onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
          className={`flex w-full items-center px-3 py-1.5 text-left text-[12px] transition-colors ${
            it.disabled
              ? 'cursor-not-allowed text-gray-600'
              : 'text-gray-200 hover:bg-blue-500/20'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ─── 메인 영역 ───

// ─── v2.61 첨부 이미지 라이트박스 — 전역 transient state(imageLightbox)를 body 로 portal. ───
//      입력칩 · 실행 상태바 · 대화 스트림의 어떤 썸네일을 클릭해도 여기서 전체화면 확대.
function ImageLightboxHost(): React.JSX.Element | null {
  const { t } = useTranslation();
  const url = useGraphStore((s) => s.imageLightbox);
  const close = useGraphStore((s) => s.closeImageLightbox);
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, close]);
  if (!url) return null;
  return createPortal(
    <div
      onClick={close}
      className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
      role="dialog"
      aria-modal="true"
    >
      <img
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-lg border border-gray-700 shadow-2xl"
      />
      {/* v2.94 — top-4(16px)는 Windows 네이티브 타이틀바 오버레이(우상단 ~144×36px, OS가 웹 위에
          그려 클릭 가로챔)와 겹쳐 닫기가 막혔다. 타이틀바 높이(36px) 아래(top-12=48px)로 내려 회피. */}
      <button
        type="button"
        onClick={close}
        aria-label={t('panel.detailPanel.close')}
        className="absolute right-4 top-12 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-gray-200 transition-colors hover:bg-black/80"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>,
    document.body,
  );
}

export const IDEMainArea = memo(function IDEMainArea({
  agentId,
  isCustom,
}: IDEMainAreaProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
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
  const setIdeTextZoom = useGraphStore((s) => s.setIdeTextZoom);
  const ideBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ideBodyRef.current;
    if (!el) return;
    const onWheelZoom = (e: WheelEvent): void => {
      if (!e.ctrlKey) return; // 줌 제스처만 가로챔 — 일반 스크롤은 그대로 통과.
      e.preventDefault();
      e.stopPropagation();
      const cur = useGraphStore.getState().ideTextZoom;
      setIdeTextZoom(cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheelZoom, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheelZoom, { capture: true });
  }, [setIdeTextZoom]);
  // "맨 아래로" 점프 버튼 노출 여부 — 사용자가 위로 스크롤해 바닥에서 멀어졌을 때만 뜬다(onScroll 이 갱신).
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  // 본문 텍스트 줌 키보드 — Ctrl/Cmd + '='(또는 '+'/NumpadAdd)=확대, Ctrl+'-'(또는 '_'/NumpadSubtract)=축소,
  //   Ctrl+'0'(또는 Numpad0)=100% 리셋. VS Code·브라우저 관례. IDE 오버레이가 떠 있는 동안(이 컴포넌트 마운트)
  //   window 레벨에서 받아, 휠 줌(위)의 키보드 짝을 이룬다. native 기본 줌은 없지만 안전하게 preventDefault.
  useEffect(() => {
    const onKeyZoom = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key;
      const cur = useGraphStore.getState().ideTextZoom;
      if (k === '=' || k === '+' || e.code === 'NumpadAdd') { e.preventDefault(); setIdeTextZoom(cur * 1.1); }
      else if (k === '-' || k === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); setIdeTextZoom(cur / 1.1); }
      else if (k === '0' || e.code === 'Numpad0') { e.preventDefault(); setIdeTextZoom(1); }
    };
    window.addEventListener('keydown', onKeyZoom);
    return () => window.removeEventListener('keydown', onKeyZoom);
  }, [setIdeTextZoom]);
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
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    // 라이브러리가 "바닥에 닿았다"고 알릴 때만 추종을 켠다(확실히 바닥). false 는 콘텐츠가 자라며 바닥이
    //   멀어진 일시 상태일 수 있어 추종을 끄지 않는다 — 끄는 건 사용자 스크롤-업만(아래 scroll 핸들러).
    if (atBottom) { followRef.current = true; sessionAtBottomRef.current.set(sessionKey, true); setShowJumpBottom(false); }
  }, [sessionKey]);
  // 메인 Virtuoso 바닥 추종: 바닥에 있을 때만 새 출력을 따라간다(StreamRenderer 의 followOutput 과 동일 계약).
  const mainFollowOutput = useCallback((isAtBottom: boolean): 'auto' | false => (isAtBottom ? 'auto' : false), []);
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

  // Hook 메인 뷰(activeSessionId===null) = read-only, 서브에이전트 탭 = interactive
  const isReadOnly = !isCustom && activeSessionId === null;

  // §4 v2.63 — CMD(interactive-terminal) 에이전트는 **모든 탭**이 임베디드 PTY 터미널.
  // 탭(세션)마다 독립 termId → "+"=새 cmd 터미널, IDE 닫았다 열어도 reattach 로 보존.
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const showInteractiveTerminal = isCustom && executionMode === 'interactive-terminal';

  // §5.5 #17-3 v2.31 — 우클릭 컨텍스트 메뉴. anchorId = 선택 출처 항목(§17-7 북마크 이동용).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; selection: string; anchorId?: string } | null>(null);
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
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
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
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
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
    ];
  }, [ctxMenu, isReadOnly, t, agentId, activeSessionId, setAgentSessionInputText, addCommand]);

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
  }, [activeSessionId, activeStreamEvents, subAgents]);

  const items = useMemo(() => {
    const flat = buildEntries(commands, subAgents, streams, activeSessionId, agentEvents);
    const agentBusy = commands.some((c) => c.status === 'executing' || c.status === 'queued');
    const grouped = groupEntries(flat, agentBusy);

    // 라이브 "생각 중 …" 1줄 — 에이전트 작동 중이고 가장 최근 스트림 이벤트가 thinking 펄스면
    // (= 지금 실제로 생각 중) 본문 하단에 1개만 띄운다. 출력이 시작되면 사라진다.
    if (agentBusy) {
      let latest: SubAgentStreamEvent | null = null;
      for (const evts of Object.values(streams)) {
        for (const e of evts) {
          if (!latest || e.timestamp > latest.timestamp) latest = e;
        }
      }
      if (latest && isThinkingPulse(latest)) {
        grouped.push({ kind: 'thinking-live', id: 'thinking-live', timestamp: latest.timestamp });
      }
    }
    return grouped;
  }, [commands, subAgents, streams, activeSessionId, agentEvents]);

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

  // §4 v2.53/v2.57 — 메인 탭: 터미널 항목 + 작업 신고 카드를 합쳐 정렬. 신고는 createdAt 그대로가 아니라
  //   **그 신고가 속한 턴의 끝**(createdAt 이후 첫 프롬프트 직전, 없으면 맨 끝)에 배치 — StreamRenderer 와 동일.
  //   작업 도중 카드가 중간에 끼는 걸 막고, 다음 턴 대화가 오면 자연스럽게 위로 밀려 올라가게 한다.
  const mainTimeline = useMemo(() => {
    const cmdTsAsc = commands.map((c) => c.timestamp).sort((a, b) => a - b);
    const turnEndSortTs = (createdAt: number): number => {
      for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
      return Number.MAX_SAFE_INTEGER;
    };
    const merged: Array<{ ts: number; node: { t: 'item'; item: TerminalItem } | { t: 'report'; report: AgentReport } | { t: 'question'; questions: AgentQuestions } | { t: 'review'; review: AgentReview } | { t: 'list'; list: AgentList } | { t: 'ask'; request: AskUserQuestionRequest } }> = [
      ...items.map((item) => ({ ts: item.timestamp, node: { t: 'item' as const, item } })),
      ...reportCards.map((r) => ({ ts: turnEndSortTs(r.createdAt), node: { t: 'report' as const, report: r } })),
      ...questionCards.map((q) => ({ ts: turnEndSortTs(q.createdAt), node: { t: 'question' as const, questions: q } })),
      ...reviewCards.map((r) => ({ ts: turnEndSortTs(r.createdAt), node: { t: 'review' as const, review: r } })),
      ...listCards.map((l) => ({ ts: turnEndSortTs(l.createdAt), node: { t: 'list' as const, list: l } })),
      // §5.3 #12-2 — pending AskUserQuestion 카드도 타임라인 안으로(가상 리스트 밖 형제 렌더 → 겹침 제거).
      ...askCards.map((req) => ({ ts: turnEndSortTs(req.createdAt), node: { t: 'ask' as const, request: req } })),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    return merged.map((m) => m.node);
  }, [items, reportCards, questionCards, reviewCards, listCards, askCards, commands]);

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
    // Ctrl+휠은 본문 텍스트 줌 제스처(아래 ideTextZoom wheel 핸들러)라 스크롤-업 의도로 치지 않는다.
    const onWheel = (e: WheelEvent): void => { if (!e.ctrlKey && e.deltaY < 0) markUpIntent(); };
    const onKeyNav = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') markUpIntent();
    };
    const onScroll = (): void => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      // 판정은 순수 함수(decideFollow)로 위임 — virtuoso/레이아웃 없이 Vitest 로 결정론적 검증(followDecision.test).
      followRef.current = decideFollow({
        dist,
        threshold: FOLLOW_BOTTOM_THRESHOLD,
        prevFollow: followRef.current,
        userUpIntent: performance.now() < userUpIntentUntil,
      });
      sessionAtBottomRef.current.set(sessionKey, followRef.current);
      // 바닥에서 충분히 떨어졌을 때만 "맨 아래로" 버튼 노출(자잘한 이탈엔 안 뜨게 240px 임계).
      setShowJumpBottom(dist > 240);
      if (!raf) raf = requestAnimationFrame(save);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', markUpIntent, { passive: true });
    el.addEventListener('keydown', onKeyNav);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', markUpIntent);
      el.removeEventListener('keydown', onKeyNav);
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
      if (atBottomOnEntry) {
        if (activeSessionId === null) mainVirtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
        else streamRef.current?.scrollToBottom();
      }
      const h = el.scrollHeight;
      if (h === lastH) stable += 1; else { stable = 0; lastH = h; }
      if (stable >= 5 || performance.now() - start > 1200) { setCovering(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [scrollEl, sessionKey, activeSessionId]);

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
      // 자기가 보낸 메시지는 항상 맨 아래에 보이게(채팅 UX). 전송 직후 reflow(새 프롬프트 블록 측정 + 카드
      //   재배치 + 첨부 썸네일 + 스트리밍 시작)에 밀려 "살짝 위"로 남지 않도록 짧은 시간창(≈400ms) 동안 매
      //   프레임 LAST 로 재고정해 reflow 를 타고 넘는다 — 한 프레임이라도 바닥에 닿으면 followOutput 이 이후를 추종.
      // v3.07 — 전송 직후 스크롤이 바닥이 아니라 위로 말려 올라가던 버그 수정. 원인 ① jump 가 virtuoso
      //   scrollToIndex(LAST) **하나에만** 의존했는데, 새 프롬프트/스트리밍으로 마지막 항목이 자라는 중이면
      //   measure 가 못 따라와 바닥에 닿지 못했다. ② 그 사이 virtuoso 가 위쪽 선렌더 버퍼를 측정하며 스크롤을
      //   보정하면 onScroll 이 dist>임계로 읽어 followRef 를 꺼버려, 400ms 창이 끝난 뒤 v3.04/ResizeObserver
      //   재고정마저 멈춰 "위로 올라간 채" 굳었다. → 매 프레임 (a)followRef 재무장(엔터 직후라 사용자 스크롤-업
      //   아님) (b)scrollToIndex 로 LAST 렌더/측정 보장. 이후 실제 바닥 붙이기는 v3.12 totalListHeightChanged
      //   pin 이 마지막 항목이 자랄 때마다 정확히 수행한다.
      // v3.12 — 옛 (c)단계 `el.scrollTop = el.scrollHeight`(raw DOM 쓰기)를 제거했다. raw 값은 virtuoso 내부
      //   측정 모델과 어긋나 스냅 후 재보정 진동을 키웠다(v3.10 단일 스크롤 권한 위반). LAST 렌더만 보장하면
      //   모델 동기화 시점(totalListHeightChanged)의 pin 이 나머지 바닥 고정을 책임진다.
      let raf = 0;
      const start = performance.now();
      const jump = (): void => {
        // (a) 창 동안 스트레이 스크롤 보정이 추종을 꺼도 매 프레임 되살린다.
        followRef.current = true;
        sessionAtBottomRef.current.set(sessionKey, true);
        // (b) 가상 리스트가 마지막 항목을 렌더/측정하도록(실제 바닥 붙이기는 totalListHeightChanged pin 이 담당).
        if (activeSessionId !== null) streamRef.current?.scrollToBottom();
        else mainVirtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
        raf = performance.now() - start < 400 ? requestAnimationFrame(jump) : 0;
      };
      jump();
      return () => { if (raf) cancelAnimationFrame(raf); };
    }
  }, [userCmdCount, activeSessionId, sessionKey]);

  // v3.12 — 스트리밍 성장 추종을 **virtuoso 모델 동기화 시점(`totalListHeightChanged`) 단일 pin** 으로 일원화.
  //   역사: v3.04 는 데이터변경 effect(activeStreamEvents/commands/카드 deps)로, v3.06 은 ResizeObserver 로
  //   콘텐츠 높이를 좇으며 각각 scrollToIndex(LAST) 를 쐈고, v3.11 은 그 둘에 BOTTOM_PIN_EPSILON(24px) 띠를
  //   달아 "바닥 근처면 스킵" 했다. 그런데 이 구조가 사용자 보고 떨림의 근원이었다 — ① epsilon 띠 톱니:
  //   스트리밍으로 마지막 항목이 자라는 동안 dist 가 0→24px 로 누적되도록 방치하다 넘는 순간에만 스냅해
  //   토큰마다 밀림→스냅 톱니(떨림) + 정지 위치가 0~24px 어긋남(끝줄 걸침). ② 스냅 목표 지연: 마지막
  //   항목이 자라는 중엔 virtuoso 측정 모델이 실제 DOM 보다 한 프레임 늦어 scrollToIndex(LAST) 스냅 후에도
  //   바닥이 아니라 재측정→재보정 연쇄. ③ RO 자기 되먹임: pin 의 scrollToIndex(LAST) 가 선렌더 버퍼
  //   (increaseViewportBy top:1600) 항목의 뒤늦은 재측정을 유발→콘텐츠 높이 변동→RO 재발화→또 pin 의 루프가
  //   24px 를 넘으면 epsilon 으로 못 끊어 "끝에서 드드드득" 진동.
  //   → 성장 트리거를 virtuoso 의 `totalListHeightChanged`(내부 측정 모델의 총높이가 **실제로 바뀐 직후에만**
  //   발화) 하나로 모은다. 목표(LAST)가 낡지 않아 스냅 후 재보정 연쇄가 없고(②해소), 높이 무변화 재발화가
  //   없어 자기 되먹임이 수렴하며(③해소), epsilon 없이 매 높이변화마다 정확히 붙어 바닥이 '선'이 된다(①해소).
  //   추종 의도(followRef)가 살아있을 때만, rAF 로 프레임당 1회 합쳐 붙인다(⚠ per-token 강제 reflow 입력 지연
  //   회귀 방지). Sub 탭 = StreamRenderer 의 scrollToBottom(), 메인 탭 = mainVirtuoso scrollToIndex(LAST).
  const pinToBottom = useCallback(() => {
    if (activeSessionId !== null) streamRef.current?.scrollToBottom();
    else mainVirtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
  }, [activeSessionId]);
  const pinRafRef = useRef(0);
  const handleTotalListHeightChanged = useCallback(() => {
    if (!followRef.current) return;
    if (pinRafRef.current) return; // 이미 이 프레임 pin 예약됨 — 합치기(프레임당 1회).
    pinRafRef.current = requestAnimationFrame(() => {
      pinRafRef.current = 0;
      if (!followRef.current) return;
      pinToBottom();
    });
  }, [pinToBottom]);
  useEffect(() => () => { if (pinRafRef.current) cancelAnimationFrame(pinRafRef.current); }, []);

  // v3.12 — ResizeObserver 는 **뷰포트 리사이즈 전용**으로 축소한다. 콘텐츠(리스트) 높이 성장은 위
  //   totalListHeightChanged 단일 pin 이 정확히 담당하므로, RO 가 콘텐츠(firstElementChild)까지 감시하면
  //   scrollToIndex(LAST)→선렌더 카드 재측정→콘텐츠 높이 변동→RO 재발화의 자기 되먹임만 되살아난다. RO 는
  //   totalListHeightChanged 가 못 잡는 **스크롤러 자신의 clientHeight 변화(창/패널 리사이즈)** 만 잡아, 추종
  //   의도(followRef)가 살아있으면 rAF 로 프레임당 1회 바닥에 다시 붙인다(입력 지연 회귀 방지). 위로 올려둔
  //   상태(followRef=false)면 아무것도 안 해 "그 자리 고정"이 보장된다(스크롤-업 우선).
  useEffect(() => {
    const el = scrollEl;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const pin = (): void => {
      raf = 0;
      if (!followRef.current) return;
      if (activeSessionId !== null) streamRef.current?.scrollToBottom();
      else mainVirtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
    };
    const ro = new ResizeObserver(() => {
      if (!followRef.current) return;
      if (!raf) raf = requestAnimationFrame(pin);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [scrollEl, activeSessionId]);

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
    // v2.99 — 점프 동안 바닥 추종이 점프 위치를 끌어내리지 않게: followOutput 은 바닥에 있을 때만 따라가므로,
    //   anchorId 로 위쪽 항목에 스크롤하면 자동으로 비추종이 된다(옛 autoScrollRef/followBottomRef 강제 불필요).
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
      const idx = anchorId
        ? mainTimeline.findIndex((n) =>
            (n.t === 'report' ? n.report.id
              : n.t === 'review' ? n.review.id
              : n.t === 'list' ? n.list.id
              : n.t === 'question' ? n.questions.id
              : n.t === 'ask' ? n.request.requestId
              : n.item.id) === anchorId)
        : -1;
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

  const mainItemSearchText = useCallback((item: TerminalItem): string => {
    if ('kind' in item && item.kind === 'group') return `${item.header} ${item.entries.map((en) => en.text).join(' ')}`;
    if ('kind' in item && item.kind === 'thinking-live') return '';
    return (item as TerminalEntry).text ?? '';
  }, []);

  const computeMatches = useCallback((query: string): string[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (activeSessionId !== null) return streamRef.current?.searchMatchIds(query) ?? [];
    const ids: string[] = [];
    for (const n of mainTimeline) {
      if (n.t !== 'item') continue;
      if (mainItemSearchText(n.item).toLowerCase().includes(q)) ids.push(n.item.id);
    }
    return ids;
  }, [activeSessionId, mainTimeline, mainItemSearchText]);

  const navigateSearch = useCallback((ids: string[], idx: number, query: string) => {
    const id = ids[idx];
    if (!id) return;
    if (activeSessionId !== null) { streamRef.current?.scrollToBookmark(id, query); return; }
    const nodeIdx = mainTimeline.findIndex((n) => n.t === 'item' && n.item.id === id);
    if (nodeIdx >= 0) mainVirtuosoRef.current?.scrollToIndex({ index: nodeIdx, align: 'center' });
    window.setTimeout(() => {
      const cont = scrollRef.current;
      if (cont) performBookmarkScroll(cont, id, query);
    }, nodeIdx >= 0 ? 260 : 40);
  }, [activeSessionId, mainTimeline]);

  // query/열림/탭 변경 시 매칭 재계산 + 첫 매칭으로 이동. 스트리밍 데이터 변경마다 자동 점프하지 않도록
  //   deps 는 최소화(검색 중 본문이 계속 자라도 화면이 튀지 않게).
  useEffect(() => {
    if (!searchOpen) return;
    const ids = computeMatches(searchQuery);
    setSearchMatches(ids);
    setSearchIdx(0);
    if (ids.length > 0) navigateSearch(ids, 0, searchQuery);
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
  }, []);

  useEffect(() => {
    if (showInteractiveTerminal) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => { const el = searchInputRef.current; if (el) { el.focus(); el.select(); } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showInteractiveTerminal]);

  // "맨 아래로" 점프 — 추종 재무장 + 마지막 항목 렌더 보장(실제 바닥 붙이기는 v3.12 totalListHeightChanged pin 이 담당).
  // v3.12 — 옛 `el.scrollTop = el.scrollHeight`(raw DOM 쓰기)를 제거했다. raw 값은 virtuoso 측정 모델과 어긋나
  //   진동을 키웠다(v3.10 단일 스크롤 권한 완성). followRef 재무장 + scrollToIndex(LAST) 만 남긴다.
  const jumpToBottom = useCallback(() => {
    followRef.current = true;
    sessionAtBottomRef.current.set(sessionKey, true);
    if (activeSessionId !== null) streamRef.current?.scrollToBottom();
    else mainVirtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
    setShowJumpBottom(false);
  }, [activeSessionId, sessionKey]);

  // §4 v2.63 — 인터랙티브 터미널 모드: 활성 탭(세션)을 임베디드 PTY 로 렌더.
  //   key=termId 라 탭 전환 시 그 세션 터미널로 교체(PTY 는 main 에서 보존 → reattach).
  //   모든 hook 은 위에서 이미 호출됐으므로 여기서 조기 return 해도 Rules of Hooks 안전.
  if (showInteractiveTerminal) {
    // §4 v2.83 — CMD 카드는 외부 레일이 아니라 **터미널 안 ANSI 색 박스**로 인라인 렌더된다
    //   (IDETerminalView 의 TerminalCardSniffer 가 마커 줄을 박스로 대체). 여기선 터미널만 렌더.
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <IDETerminalView key={activeSessionId ?? 'main'} agentId={agentId} sessionId={activeSessionId} />
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
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
            <span className="min-w-[40px] text-right text-[11px] tabular-nums text-gray-400">
              {searchQuery.trim() ? `${searchMatches.length ? searchIdx + 1 : 0}/${searchMatches.length}` : ''}
            </span>
            <button
              type="button"
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
              reports={reportCards}
              questions={questionCards}
              reviews={reviewCards}
              lists={listCards}
              askRequests={askCards}
              onScrollerRef={setScrollNode}
              restoreState={restoreStateFor(sessionKey)}
              onAtBottomChange={handleAtBottomChange}
              onTotalListHeightChanged={handleTotalListHeightChanged}
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
                // 바닥 추종을 라이브러리에 위임 — 바닥에 있을 때만 새 출력을 따라가고, 위로 올리면 자동 비추종.
                followOutput={mainFollowOutput}
                atBottomStateChange={handleAtBottomChange}
                atBottomThreshold={40}
                // v3.12 — 성장 추종 단일 pin: virtuoso 측정 모델의 총높이가 실제로 바뀐 직후에만 발화 → 바닥이 '선'.
                totalListHeightChanged={handleTotalListHeightChanged}
                // 복원 스냅샷이 있으면(위로 올려둔 세션) 그 위치/측정값으로, 없으면(첫 진입/바닥 추종 세션)
                //   마지막 항목(새 바닥)에서 시작 — 둘은 배타.
                {...(restoreStateFor(sessionKey)
                  ? { restoreStateFrom: restoreStateFor(sessionKey) }
                  : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
                data={mainTimeline}
                computeItemKey={(_i, n) =>
                  n.t === 'report' ? n.report.id
                    : n.t === 'review' ? n.review.id
                    : n.t === 'list' ? n.list.id
                    : n.t === 'question' ? n.questions.id
                    : n.t === 'ask' ? n.request.requestId
                    : n.item.id}
                itemContent={(_i, n) => {
                  const itemId = n.t === 'report' ? n.report.id
                    : n.t === 'review' ? n.review.id
                    : n.t === 'list' ? n.list.id
                    : n.t === 'question' ? n.questions.id
                    : n.t === 'ask' ? n.request.requestId
                    : n.item.id;
                  return (
                    <div data-stream-item-id={itemId} style={ideTextZoom === 1 ? undefined : { zoom: ideTextZoom }}>
                      {n.t === 'report'
                        ? <AgentReportCard report={n.report} />
                        : n.t === 'review'
                          ? <AgentReviewCard review={n.review} />
                        : n.t === 'list'
                          ? <AgentListCard list={n.list} />
                        : n.t === 'question'
                          ? <AgentQuestionCard questions={n.questions} />
                        : n.t === 'ask'
                          ? <AskQuestionCard request={n.request} />
                          : n.item.kind === 'group'
                            ? (n.item.groupType === 'thinking'
                                ? <ThinkingGroupLine group={n.item} />
                                : <TerminalGroupLine group={n.item} />)
                            : n.item.kind === 'thinking-live'
                              ? <ThinkingLiveLine label={t('ide.streamRenderer.thinking')} />
                              : <TerminalLine entry={n.item} />}
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

      {/* Stream 하단 상태바 — Sub 탭(StreamRenderer 활성)에서만 */}
      {activeSessionId !== null && (
        <StreamStatusBar
          commands={commands.filter((c) => c.subAgentId === activeSessionId)}
          scrollRef={scrollRef}
          streamRef={streamRef}
        />
      )}

      {/* Command input — 서브에이전트 탭이거나 커스텀이면 입력 가능 */}
      {!isReadOnly && (
        <TerminalInput agentId={agentId} activeSessionId={activeSessionId} />
      )}

      {/* Read-only — Hook 에이전트 메인 뷰만 */}
      {isReadOnly && (
        <div className="flex h-8 items-center justify-center border-t border-gray-700 bg-gray-900/60">
          <span className="text-[10px] text-gray-600">{t('ide.mainArea.readOnly')}</span>
        </div>
      )}

      {/* v2.61 — 첨부 이미지 라이트박스 (입력칩·상태바·대화 썸네일 클릭 시 전체화면 확대) */}
      <ImageLightboxHost />

      {/* §5.5 #17-3 v2.31 — 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={closeCtxMenu}
        />
      )}
    </div>
  );
});
