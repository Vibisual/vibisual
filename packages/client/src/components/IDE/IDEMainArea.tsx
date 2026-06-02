import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent, AgentEvent, AgentReport, AgentQuestions } from '@vibisual/shared';
import { useGraphStore, agentSessionInputKey, selectIDEOverlay } from '../../stores/graphStore.js';
import type { AgentSessionInputAttachment } from '../../stores/graphStore.js';
import { useAvailableSkills, type SkillInfo } from '../../hooks/useAvailableSkills.js';
import { StreamRenderer } from './StreamRenderer.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { IDETerminalView } from './IDETerminalView.js';
import { SystemNode, parseSystemSubtype } from './SystemNode.js';
import { ThinkingDots, ThinkingLiveLine } from './ThinkingIndicator.js';

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

interface IDEMainAreaProps {
  agentId: string;
  isCustom: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
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
  return entries;
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

    // 연속 text 블록 3개 이상 → 하나로 묶기
    if (cur.type === 'text') {
      const children: TerminalEntry[] = [cur];
      let j = i + 1;
      while (j < flat.length && flat[j]!.type === 'text') {
        children.push(flat[j]!);
        j++;
      }
      if (children.length >= 3) {
        const preview = children[0]!.text.slice(0, 80);
        items.push({
          kind: 'group',
          id: `grp-${cur.id}`,
          groupType: 'text',
          header: `${preview}${children[0]!.text.length > 80 ? '...' : ''} (+${children.length - 1} lines)`,
          timestamp: cur.timestamp,
          sessionLabel: cur.sessionLabel,
          entries: children,
          isActive: false,
        });
        i = j;
        continue;
      }
    }

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (executingForSession) return;
      handleSubmit();
    }
  }, [slashOpen, slashState, slashIndex, confirmSlash, setText, handleSubmit, executingForSession]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // 타이핑 = 완료 알림 확인 — 도트 녹색→회색.
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged]);

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
          rows={1}
          placeholder={activeSessionId === null ? t('ide.mainArea.inputPlaceholderNew') : t('ide.mainArea.inputPlaceholder')}
          className="scrollbar-thin min-h-[28px] flex-1 resize-none bg-transparent text-[13px] leading-7 text-gray-200 placeholder-gray-500 outline-none"
          style={{ maxHeight: 120 }}
          data-ide-input={agentId}
          data-ide-input-session={activeSessionId ?? ''}
        />
        {executingForSession ? (
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
    </div>
  );
}

// ─── Stream 하단 상태바 — 실행 중 스피너 / 완료 후 요약+스크롤점프 ───

interface StreamStatusBarProps {
  commands: QueuedCommand[];
  scrollRef: React.RefObject<HTMLDivElement>;
}

const STATUS_SUMMARY_MAX = 80;

function StreamStatusBar({ commands, scrollRef }: StreamStatusBarProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const attachmentPreviews = useGraphStore((s) => s.attachmentPreviews);
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  // 우선순위: 실행 중 > 최신 완료/에러. queued 단독은 하단 표시 대상 아님.
  const target = useMemo(() => {
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

  const handleJump = useCallback(() => {
    if (!target || !scrollRef.current) return;
    const container = scrollRef.current;
    const el = container.querySelector<HTMLElement>(`[data-cmd-id="cmd-${target.id}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = el.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (targetRect.top - containerRect.top) - 16,
      behavior: 'smooth',
    });
  }, [target, scrollRef]);

  if (!target) return null;

  const isExecuting = target.status === 'executing';
  const isError = target.status === 'error';
  const preview = target.text.length > STATUS_SUMMARY_MAX
    ? `${target.text.slice(0, STATUS_SUMMARY_MAX)}…`
    : target.text;

  if (isExecuting) {
    // v1.38 — 실행중 커맨드의 첨부 썸네일을 스토어에서 basename 으로 조회해 인라인 표시.
    //         커맨드 완료 시 server cleanup → next snapshot 에서 attachmentPreviews 자동 revoke.
    const attachmentThumbs: { basename: string; url: string }[] = [];
    if (target.attachments) {
      for (const p of target.attachments) {
        const parts = p.split(/[/\\]/);
        const basename = parts[parts.length - 1] ?? '';
        const url = attachmentPreviews[basename];
        if (url) attachmentThumbs.push({ basename, url });
      }
    }
    return (
      <div className="flex flex-shrink-0 items-center gap-2 border-t border-gray-800 bg-gray-900/70 px-4 py-1.5">
        <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
        <span className="flex-shrink-0 text-[12px] text-blue-300">{t('ide.mainArea.executing')}</span>
        {attachmentThumbs.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            {attachmentThumbs.map((a) => (
              <button
                key={a.basename}
                type="button"
                onClick={() => openImageLightbox(a.url)}
                className="h-5 w-5 flex-shrink-0 overflow-hidden rounded border border-gray-700"
              >
                <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
              </button>
            ))}
          </div>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400">{preview}</span>
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
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
      <button
        type="button"
        onClick={close}
        aria-label={t('panel.detailPanel.close')}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-gray-200 transition-colors hover:bg-black/80"
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Hook 메인 뷰(activeSessionId===null) = read-only, 서브에이전트 탭 = interactive
  const isReadOnly = !isCustom && activeSessionId === null;

  // §4 v2.63 — CMD(interactive-terminal) 에이전트는 **모든 탭**이 임베디드 PTY 터미널.
  // 탭(세션)마다 독립 termId → "+"=새 cmd 터미널, IDE 닫았다 열어도 reattach 로 보존.
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const showInteractiveTerminal = isCustom && executionMode === 'interactive-terminal';

  // §5.5 #17-3 v2.31 — 우클릭 컨텍스트 메뉴.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; selection: string } | null>(null);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  const addCommand = useGraphStore((s) => s.addCommand);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // textarea 위 우클릭은 가로채지 ❌ (브라우저 기본 Paste/Cut/Spell-check 보존).
    const tgt = e.target as HTMLElement;
    if (tgt.closest('textarea, input, [contenteditable="true"]')) return;
    const sel = (window.getSelection()?.toString() ?? '').trim();
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, selection: sel });
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
    const subIdSet = new Set(subAgents.map((s) => s.id));
    const matches = Object.values(pendingAskQuestions).filter((r) => {
      if (r.agentId !== agentId) return false;
      if (activeSessionId !== null) {
        // sub 탭: subAgentId 가 그 탭과 일치하는 질문만
        return r.subAgentId === activeSessionId;
      }
      // 메인 탭: 본 에이전트의 직접 질문(subAgentId 미상) + 이 에이전트의 sub 질문
      return !r.subAgentId || subIdSet.has(r.subAgentId);
    });
    return matches.sort((a, b) => a.createdAt - b.createdAt);
  }, [pendingAskQuestions, agentId, activeSessionId, subAgents]);

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

  // §4 v2.53/v2.57 — 메인 탭: 터미널 항목 + 작업 신고 카드를 합쳐 정렬. 신고는 createdAt 그대로가 아니라
  //   **그 신고가 속한 턴의 끝**(createdAt 이후 첫 프롬프트 직전, 없으면 맨 끝)에 배치 — StreamRenderer 와 동일.
  //   작업 도중 카드가 중간에 끼는 걸 막고, 다음 턴 대화가 오면 자연스럽게 위로 밀려 올라가게 한다.
  const mainTimeline = useMemo(() => {
    const cmdTsAsc = commands.map((c) => c.timestamp).sort((a, b) => a - b);
    const turnEndSortTs = (createdAt: number): number => {
      for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
      return Number.MAX_SAFE_INTEGER;
    };
    const merged: Array<{ ts: number; node: { t: 'item'; item: TerminalItem } | { t: 'report'; report: AgentReport } | { t: 'question'; questions: AgentQuestions } }> = [
      ...items.map((item) => ({ ts: item.timestamp, node: { t: 'item' as const, item } })),
      ...reportCards.map((r) => ({ ts: turnEndSortTs(r.createdAt), node: { t: 'report' as const, report: r } })),
      ...questionCards.map((q) => ({ ts: turnEndSortTs(q.createdAt), node: { t: 'question' as const, questions: q } })),
    ];
    merged.sort((a, b) => a.ts - b.ts);
    return merged.map((m) => m.node);
  }, [items, reportCards, questionCards, commands]);

  // Auto-scroll — 유저가 위로 스크롤하면 비활성화, 바닥 근처면 활성화
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  // 탭 전환 시 스크롤 위치 리셋
  useEffect(() => {
    autoScrollRef.current = true;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeSessionId]);

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length, askCards.length, reportCards.length, questionCards.length]);

  // §4 v2.63 — 인터랙티브 터미널 모드: 활성 탭(세션)을 임베디드 PTY 로 렌더.
  //   key=termId 라 탭 전환 시 그 세션 터미널로 교체(PTY 는 main 에서 보존 → reattach).
  //   모든 hook 은 위에서 이미 호출됐으므로 여기서 조기 return 해도 Rules of Hooks 안전.
  if (showInteractiveTerminal) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <IDETerminalView key={activeSessionId ?? 'main'} agentId={agentId} sessionId={activeSessionId} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Terminal output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={handleAckClick}
        onContextMenu={handleContextMenu}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-gray-950"
      >
        {activeSessionId !== null ? (
          /* ── Sub 탭: CLI 스타일 스트림 렌더러 (마크다운 + 접이식 도구) ── */
          <>
            {/* §4 v2.53 — 작업 신고 카드는 StreamRenderer 안에서 createdAt 기준 인라인 합류(하단 고정 ❌). */}
            <StreamRenderer
              events={activeStreamEvents}
              commands={commands.filter((c) => c.subAgentId === activeSessionId)}
              reports={reportCards}
              questions={questionCards}
            />
            {askCards.length > 0 && (
              <div className="py-1">
                {askCards.map((req) => (
                  <AskQuestionCard key={req.requestId} request={req} />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Agent 탭(메인): 기존 터미널 라인 + AskUserQuestion 카드. 비어있을 땐 그냥 빈 배경(미니멀) ── */
          <div className="py-1">
            {/* §4 v2.53 — 터미널 항목과 작업 신고 카드를 시간순으로 합친 mainTimeline 을 렌더(신고 하단 고정 ❌). */}
            {mainTimeline.map((n) =>
              n.t === 'report'
                ? <AgentReportCard key={n.report.id} report={n.report} />
                : n.t === 'question'
                  ? <AgentQuestionCard key={n.questions.id} questions={n.questions} />
                  : n.item.kind === 'group'
                    ? (n.item.groupType === 'thinking'
                        ? <ThinkingGroupLine key={n.item.id} group={n.item} />
                        : <TerminalGroupLine key={n.item.id} group={n.item} />)
                    : n.item.kind === 'thinking-live'
                      ? <ThinkingLiveLine key={n.item.id} label={t('ide.streamRenderer.thinking')} />
                      : <TerminalLine key={n.item.id} entry={n.item} />,
            )}
            {askCards.map((req) => (
              <AskQuestionCard key={req.requestId} request={req} />
            ))}
          </div>
        )}
      </div>

      {/* Stream 하단 상태바 — Sub 탭(StreamRenderer 활성)에서만 */}
      {activeSessionId !== null && (
        <StreamStatusBar
          commands={commands.filter((c) => c.subAgentId === activeSessionId)}
          scrollRef={scrollRef}
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
