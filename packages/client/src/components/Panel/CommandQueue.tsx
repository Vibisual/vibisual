import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

const EMPTY_COMMANDS: QueuedCommand[] = [];
const API_BASE = '';

interface CommandQueueProps {
  agentId: string;
}

// ─── 세션 선택 + 명령 입력 팝업 ───

interface CommandInputPopupProps {
  agentId: string;
  onSubmit: (text: string, subAgentId: string | null, attachments: string[]) => void;
  onClose: () => void;
}

const MAX_TEXTAREA_HEIGHT = 200;

/**
 * v1.35 — paste 된 이미지 1장의 업로드/미리보기 상태.
 * serverPath 는 업로드 완료 후에만 존재 → submit 시 이 값만 전송.
 * previewUrl 은 로컬 blob URL (언마운트 시 revoke).
 */
interface PastedAttachment {
  tempId: string;
  previewUrl: string;
  serverPath: string;
  uploading: boolean;
  error?: string;
}

function CommandInputPopup({ agentId, onSubmit, onClose }: CommandInputPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const [step, setStep] = useState<'select' | 'input'>('select');
  const [idleSubs, setIdleSubs] = useState<SubAgent[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PastedAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agents = useGraphStore((s) => s.agents);
  const sessionId = useMemo(
    () => agents.find((a) => a.id === agentId)?.path ?? null,
    [agents, agentId],
  );

  // cleanup: unmount 시 미제출 첨부 서버 삭제 + blob URL revoke
  const submittedRef = useRef(false);
  const attachmentsRef = useRef<PastedAttachment[]>([]);
  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    return () => {
      const list = attachmentsRef.current;
      const sid = sessionIdRef.current;
      for (const a of list) URL.revokeObjectURL(a.previewUrl);
      if (submittedRef.current) return;
      if (!sid) return;
      for (const a of list) {
        if (!a.serverPath) continue;
        fetch(`${API_BASE}/api/agent-attachments/${sid}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: a.serverPath }),
        }).catch(() => {});
      }
    };
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const tempId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        { tempId, previewUrl, serverPath: '', uploading: true },
      ]);
      try {
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(`${API_BASE}/api/agent-attachments/${sid}/upload`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { path: string };
        setAttachments((prev) =>
          prev.map((a) =>
            a.tempId === tempId ? { ...a, serverPath: data.path, uploading: false } : a,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'upload failed';
        setAttachments((prev) =>
          prev.map((a) => (a.tempId === tempId ? { ...a, uploading: false, error: msg } : a)),
        );
      }
    },
    [],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      for (const f of files) void uploadFile(f);
    },
    [uploadFile],
  );

  const removeAttachment = useCallback(
    (tempId: string) => {
      setAttachments((prev) => {
        const target = prev.find((a) => a.tempId === tempId);
        if (target) {
          URL.revokeObjectURL(target.previewUrl);
          const sid = sessionIdRef.current;
          if (target.serverPath && sid) {
            fetch(`${API_BASE}/api/agent-attachments/${sid}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: target.serverPath }),
            }).catch(() => {});
          }
        }
        return prev.filter((a) => a.tempId !== tempId);
      });
    },
    [],
  );

  // idle subagent 목록 조회
  useEffect(() => {
    fetch(`${API_BASE}/api/subagents/${agentId}`)
      .then((r) => r.json())
      .then((data: { subAgents?: SubAgent[] }) => {
        const subs = data.subAgents ?? [];
        setIdleSubs(subs);
        // idle sub 없으면 바로 입력 단계 (새 세션 자동)
        if (subs.length === 0) {
          setSelectedSubId(null);
          setStep('input');
        }
        setLoading(false);
      })
      .catch(() => {
        setSelectedSubId(null);
        setStep('input');
        setLoading(false);
      });
  }, [agentId]);

  useEffect(() => {
    if (step === 'input') textareaRef.current?.focus();
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, step]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  const hasPendingUploads = attachments.some((a) => a.uploading);
  const completedAttachments = attachments.filter((a) => !a.uploading && a.serverPath && !a.error);
  const canSubmit = text.trim().length > 0 && !hasPendingUploads;

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (hasPendingUploads) return;
    const paths = attachments
      .filter((a) => !a.uploading && a.serverPath && !a.error)
      .map((a) => a.serverPath);
    submittedRef.current = true;
    onSubmit(trimmed, selectedSubId, paths);
    onClose();
  }, [text, selectedSubId, attachments, hasPendingUploads, onSubmit, onClose]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleSelectSub = useCallback((subId: string | null) => {
    setSelectedSubId(subId);
    setStep('input');
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex w-full max-w-lg flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <span className="text-sm font-semibold text-gray-100">
            {step === 'select' ? t('panel.commandQueue.selectSession') : t('panel.commandQueue.newCommand')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('panel.commandQueue.close')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step 1: 세션 선택 */}
        {step === 'select' && (
          <div className="flex flex-col gap-1.5 p-4">
            {loading ? (
              <p className="text-center text-xs text-gray-500">{t('panel.commandQueue.loading')}</p>
            ) : (
              <>
                {idleSubs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => handleSelectSub(sub.id)}
                    className="flex items-center gap-3 rounded border border-gray-700/50 bg-gray-800/60 px-3 py-2 text-left transition-colors hover:border-blue-500/50 hover:bg-gray-700/60"
                  >
                    <span className="flex h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-gray-200">{sub.label}</span>
                      {sub.lastCommand && (
                        <span className="block truncate text-[10px] text-gray-500">{sub.lastCommand}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-500">
                      {new Date(sub.lastActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleSelectSub(null)}
                  className="flex items-center gap-3 rounded border border-dashed border-gray-600 px-3 py-2 text-left transition-colors hover:border-blue-500/50 hover:bg-gray-800/40"
                >
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="text-xs text-gray-400">{t('panel.commandQueue.newSession')}</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 2: 명령 입력 */}
        {step === 'input' && (
          <div className="p-4">
            {/* 선택된 세션 표시 */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{t('panel.commandQueue.session')}</span>
              {selectedSubId ? (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                  {idleSubs.find((s) => s.id === selectedSubId)?.label ?? selectedSubId}
                </span>
              ) : (
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                  {t('panel.commandQueue.newBadge')}
                </span>
              )}
              {idleSubs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                >
                  {t('panel.commandQueue.change')}
                </button>
              )}
            </div>
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.tempId}
                    className="group relative h-14 w-14 overflow-hidden rounded border border-gray-700 bg-gray-800"
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
                        <span className="text-[9px] font-semibold text-red-200">ERR</span>
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
            <div className="flex gap-3">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onInput={handleInput}
                onPaste={handlePaste}
                onKeyDown={handleTextareaKeyDown}
                rows={3}
                placeholder={t('panel.commandQueue.placeholder')}
                className="scrollbar-thin min-h-[72px] flex-1 resize-none rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500"
                style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-shrink-0 self-end rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                title={hasPendingUploads ? t('panel.commandQueue.waitingForUpload') : undefined}
              >
                {t('panel.commandQueue.run')}{completedAttachments.length > 0 ? ` +${completedAttachments.length}` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Prompts 항목 (subagent 상태 포함) ───

interface DraggableItemProps {
  cmd: QueuedCommand;
  index: number;
  agentId: string;
  dragIndex: number | null;
  overIndex: number | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function DraggableItem({
  cmd,
  index,
  agentId,
  dragIndex,
  overIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: DraggableItemProps): React.JSX.Element {
  const { t } = useTranslation();
  const removeCommand = useGraphStore((s) => s.removeCommand);
  const subAgents = useGraphStore((s) => s.subAgents[agentId]);
  const isDragging = dragIndex === index;
  const isOver = overIndex === index && dragIndex !== index;
  const isExecuting = cmd.status === 'executing';

  // subagent 정보
  const sub = cmd.subAgentId ? subAgents?.find((s) => s.id === cmd.subAgentId) : null;

  return (
    <li
      draggable={!isExecuting}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group flex items-start gap-2 rounded border px-2.5 py-1.5 transition-all ${
        isExecuting
          ? 'border-blue-500/60 bg-blue-900/30'
          : isDragging
            ? 'border-blue-500/50 bg-blue-900/20 opacity-50'
            : isOver
              ? 'border-blue-400/60 bg-blue-900/10'
              : 'border-gray-700/50 bg-gray-800/60'
      } ${isExecuting ? 'cursor-default' : 'cursor-grab'}`}
    >
      {/* 상태 표시 */}
      {isExecuting ? (
        <span className="flex-shrink-0 pt-0.5">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        </span>
      ) : (
        <span className="flex-shrink-0 pt-0.5 text-[10px] font-bold text-gray-500">
          {index + 1}.
        </span>
      )}
      <div className="min-w-0 flex-1">
        {isExecuting && (
          <span className="mb-0.5 block text-[10px] font-semibold text-blue-400">
            {t('panel.commandQueue.executing')}
          </span>
        )}
        <p className="break-words text-xs leading-relaxed text-gray-200">
          {cmd.text}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {/* subagent 라벨 */}
          {sub && (
            <span className={`inline-block rounded px-1 py-px text-[9px] font-medium ${
              isExecuting ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-500'
            }`}>
              {sub.label}
            </span>
          )}
          {!sub && cmd.subAgentId === null && (
            <span className="inline-block rounded bg-gray-600/30 px-1 py-px text-[9px] font-medium text-gray-500">
              {t('panel.commandQueue.newSessionBadge')}
            </span>
          )}
          {/* v1.35 — paste 된 이미지 개수 뱃지. 실행 중/대기 중 모두 표시. cleanup 후 archive 엔 잔재 없음. */}
          {cmd.attachments && cmd.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-400">
              <svg className="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
              {cmd.attachments.length}
            </span>
          )}
        </div>
      </div>
      {!isExecuting && (
        <button
          type="button"
          onClick={() => removeCommand(agentId, cmd.id)}
          className="flex-shrink-0 pt-0.5 text-[10px] text-gray-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        >
          {t('panel.commandQueue.delete')}
        </button>
      )}
    </li>
  );
}

// ─── CommandQueue 메인 ───

export const CommandQueue = memo(function CommandQueue({
  agentId,
}: CommandQueueProps): React.JSX.Element {
  const { t } = useTranslation();
  const allQueues = useGraphStore((s) => s.queuedCommands);
  const commands = allQueues[agentId] ?? EMPTY_COMMANDS;
  const addCommand = useGraphStore((s) => s.addCommand);
  const reorderCommands = useGraphStore((s) => s.reorderCommands);
  const [showPopup, setShowPopup] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleSubmit = useCallback(
    (text: string, subAgentId: string | null, attachments: string[]) =>
      addCommand(agentId, text, subAgentId, attachments),
    [agentId, addCommand],
  );
  const handleClosePopup = useCallback(() => setShowPopup(false), []);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIndex(index);
  }, []);

  const handleDrop = useCallback(() => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      reorderCommands(agentId, dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, overIndex, agentId, reorderCommands]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">{t('panel.commandQueue.prompts')} ({commands.length})</span>
          <button
            type="button"
            onClick={() => setShowPopup(true)}
            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
            aria-label={t('panel.commandQueue.addCommand')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {commands.length > 0 && (
          <ScrollFade maxHeight={256}>
            <ul className="flex flex-col gap-1.5">
              {commands.map((cmd, i) => (
                <DraggableItem
                  key={cmd.id}
                  cmd={cmd}
                  index={i}
                  agentId={agentId}
                  dragIndex={dragIndex}
                  overIndex={overIndex}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </ul>
          </ScrollFade>
        )}
      </div>

      {showPopup && (
        <CommandInputPopup
          agentId={agentId}
          onSubmit={handleSubmit}
          onClose={handleClosePopup}
        />
      )}
    </>
  );
});
