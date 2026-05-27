import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, SubAgent, SubAgentStreamEvent, AgentEvent } from '@vibisual/shared';
import { useGraphStore, agentSessionInputKey, selectIDEOverlay } from '../../stores/graphStore.js';
import type { AgentSessionInputAttachment } from '../../stores/graphStore.js';
import { StreamRenderer } from './StreamRenderer.js';
import { AskQuestionCard } from './AskQuestionCard.js';

const EMPTY_COMMANDS: QueuedCommand[] = [];
const EMPTY_SUBS: SubAgent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];
const EMPTY_STREAM_EVENTS: SubAgentStreamEvent[] = [];

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
  groupType: 'tool' | 'text';
  header: string;
  toolName?: string;
  timestamp: number;
  sessionLabel?: string;
  entries: TerminalEntry[];
  /** tool이 아직 실행 중 (result 없음) */
  isActive: boolean;
}

type TerminalItem = (TerminalEntry & { kind?: undefined }) | TerminalGroup;

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

/** tool_use+tool_result 쌍을 접을 수 있는 그룹으로, 연속 text를 하나로 묶기 */
function groupEntries(flat: TerminalEntry[]): TerminalItem[] {
  const items: TerminalItem[] = [];
  let i = 0;

  while (i < flat.length) {
    const cur = flat[i]!;

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

  // unmount 시 (IDE 닫기 등) 이 agent 의 모든 세션 draft 첨부를 일괄 정리.
  // 세션 전환은 unmount 가 아니므로 첨부가 보존된다(원하는 동작).
  useEffect(() => {
    return () => {
      const removed = takeAgentSessionInputs(agentIdRef.current);
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (executingForSession) return;
      handleSubmit();
    }
  }, [handleSubmit, executingForSession]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // 타이핑 = 완료 알림 확인 — 도트 녹색→회색.
    if (activeSessionId) markSubAcknowledged(activeSessionId);
  }, [activeSessionId, markSubAcknowledged]);

  return (
    <div className="flex flex-col gap-1.5 border-t border-gray-700 bg-gray-900/80 px-3 py-2">
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
                className={`h-full w-full object-cover ${a.uploading || a.error ? 'opacity-40' : ''}`}
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
              <img
                key={a.basename}
                src={a.url}
                alt=""
                className="h-5 w-5 rounded border border-gray-700 object-cover"
              />
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

// ─── 메인 영역 ───

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
    return groupEntries(flat);
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
  }, [items.length, askCards.length]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Terminal output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={handleAckClick}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-gray-950"
      >
        {activeSessionId !== null ? (
          /* ── Sub 탭: CLI 스타일 스트림 렌더러 (마크다운 + 접이식 도구) ── */
          <>
            <StreamRenderer
              events={activeStreamEvents}
              commands={commands.filter((c) => c.subAgentId === activeSessionId)}
            />
            {askCards.length > 0 && (
              <div className="py-1">
                {askCards.map((req) => (
                  <AskQuestionCard key={req.requestId} request={req} />
                ))}
              </div>
            )}
          </>
        ) : items.length === 0 && askCards.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-gray-600">
                {subAgents.length === 0 ? t('ide.mainArea.noSessions') : t('ide.mainArea.noActivity')}
              </p>
              {isCustom && subAgents.length === 0 && (
                <p className="mt-1 text-xs text-gray-700">{t('ide.mainArea.startHint')}</p>
              )}
            </div>
          </div>
        ) : (
          /* ── Agent 탭: 기존 터미널 라인 + AskUserQuestion 카드 ── */
          <div className="py-1">
            {items.map((item) =>
              item.kind === 'group'
                ? <TerminalGroupLine key={item.id} group={item} />
                : <TerminalLine key={item.id} entry={item} />,
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
    </div>
  );
});
