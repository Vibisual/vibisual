/**
 * §5.5 #17-28 ⑦ — 주입원 한 줄의 **상세창**.
 *
 * 표는 "무엇이 얼마나 실리는가"를 정확히 세웠지만, 그 줄이 대체 무엇인지는 말하지 않았다.
 * 이 창이 답하는 것은 넷이다 — **무엇인가 · 어디서 오는가 · 끄면 어떻게 되는가 · 실제로 뭐가 나가는가.**
 *
 * 마지막 칸이 핵심이다. 말로 설명하는 대신 **이 턴에 실제로 조립된 문자열 그대로**를 보여 준다
 * (서버가 프롬프트를 만드는 그 함수로 다시 재어 준다). 파일로 이뤄진 줄은 파일 목록이 서고,
 * 한 줄을 누르면 그 파일의 내용이 같은 자리에 열린다 — 새 편집기를 만들지 않고, 프로젝트 안의
 * 파일은 내장 편집창(#17-27)으로 넘긴다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ContextSourceItem, ContextSourcePreview } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { highlightCode } from './codeHighlight.js';
import { TOKEN_CLASS, languageFromPath } from './codeLanguages.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { openFileByPath } from './useWorkspaceExplorer.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { formatTokens, CONTEXT_CATEGORY_LABEL_KEY } from './contextInventoryView.js';
import { controlExplainKey, CONTEXT_ABOUT_FIELDS } from './contextSourceAbout.js';
import { useContextAbout } from './useContextAbout.js';
import { useIDEPaneActions } from './idePane.js';

/** 본문 뷰어가 한 번에 그리는 줄 수 상한 — 그 위로는 브라우저가 아니라 사람이 못 읽는다. */
const MAX_VIEWER_LINES = 4_000;

/** 경로 비교 — Windows 는 대소문자를 가리지 않으므로 낮춰서 본다. */
function isInsideRoot(absPath: string, rootPath: string | null): boolean {
  if (!rootPath) return false;
  const a = absPath.replace(/\\/g, '/').toLowerCase();
  const r = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return a === r || a.startsWith(`${r}/`);
}

/** 색이 입혀진 읽기 전용 본문 — 편집창(#17-27)과 같은 색 규칙을 쓰되 고칠 수는 없다. */
const PreviewBody = memo(function PreviewBody({ text, language }: { text: string; language: string }): React.JSX.Element {
  const lines = useMemo(() => highlightCode(text, language).slice(0, MAX_VIEWER_LINES), [text, language]);
  return (
    <div className="font-mono text-[12px] leading-[1.55]">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="mr-2 w-9 flex-shrink-0 select-none pr-1 text-right text-[12px] text-gray-600">{i + 1}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-gray-300">
            {line.map((token, j) => (
              <span key={j} className={TOKEN_CLASS[token.kind]}>{token.text}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
});

interface IDEContextSourceDialogProps {
  agentId: string;
  subAgentId?: string | undefined;
  item: ContextSourceItem;
  /** 표의 토글과 **같은 손잡이** — 설명을 읽은 자리에서 바로 끄고 켤 수 있게. */
  onToggle: (item: ContextSourceItem, next: boolean) => void;
  busy: boolean;
  onClose: () => void;
}

export function IDEContextSourceDialog({
  agentId,
  subAgentId,
  item,
  onToggle,
  busy,
  onClose,
}: IDEContextSourceDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const about = useContextAbout();
  const rootPath = useIDEProjectRoot();
  const { openEditorFile: openInEditor } = useIDEPaneActions();
  const [preview, setPreview] = useState<ContextSourcePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const title = item.labelKey ? t(item.labelKey) : item.title;

  const load = useCallback(async (filePath?: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ source: item.id });
      if (subAgentId) params.set('sub', subAgentId);
      if (filePath) params.set('file', filePath);
      const res = await fetch(`/api/context-source/${encodeURIComponent(agentId)}?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setPreview((await res.json()) as ContextSourcePreview);
    } catch {
      setPreview(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [agentId, subAgentId, item.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const backdrop = useBackdropDismiss(onClose);

  const handleCopy = useCallback(() => {
    if (!preview?.text) return;
    void navigator.clipboard?.writeText(preview.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [preview]);

  const handleOpenFile = useCallback((absPath: string) => {
    if (isInsideRoot(absPath, rootPath)) {
      openInEditor(editorFileFromAbsPath(absPath, rootPath));
      onClose();
      return;
    }
    // 프로젝트 밖 파일(`~/.claude/…`)은 내장 편집창의 뿌리 밖이라 밖에서 연다.
    openFileByPath(absPath, absPath.split(/[\\/]/).pop() ?? absPath);
  }, [rootPath, openInEditor, onClose]);

  const lockable = item.control === 'session' || item.control === 'spawn';
  const files = preview?.files ?? [];
  const language = preview?.filePath ? languageFromPath(preview.filePath) : 'markdown';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" {...backdrop}>
      <div
        className="flex h-[80vh] w-[980px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-gray-900/95 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 머리 — 제목·분류·닫기 */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-white">{title}</h2>
            <p className="mt-0.5 truncate text-[12px] text-gray-500">
              {t(CONTEXT_CATEGORY_LABEL_KEY[item.category] ?? item.category)}
              {item.detail ? ` · ${item.detail}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 — 설명 · 상태 · 파일 목록 */}
          <div className="flex w-[320px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/[0.06] p-4">
            {CONTEXT_ABOUT_FIELDS.map((field) => {
              const body = about(item, field);
              if (!body) return null;
              return (
                <div key={field}>
                  <p className="text-[12px] font-bold uppercase tracking-wider text-gray-600">
                    {t(`ide.context.detail.${field}Label`)}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-gray-300">{body}</p>
                </div>
              );
            })}

            {/* 지금 이 줄의 상태 — 켬/끔 + 그것을 어떻게 끄는가 */}
            <div className="rounded-lg border border-white/[0.06] bg-black/25 p-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!lockable || busy}
                  onClick={() => onToggle(item, !item.enabled)}
                  aria-pressed={item.enabled}
                  title={lockable
                    ? t(item.enabled ? 'ide.context.turnOff' : 'ide.context.turnOn')
                    : t(item.hintKey ?? 'ide.context.locked')}
                  className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full px-0.5 transition-colors ${
                    !lockable
                      ? 'cursor-not-allowed bg-gray-700/60'
                      : item.enabled
                        ? 'bg-emerald-500/70 hover:bg-emerald-400/80'
                        : 'bg-gray-600 hover:bg-gray-500'
                  }`}
                >
                  <span className={`h-3 w-3 rounded-full bg-white/90 transition-transform ${item.enabled ? 'translate-x-3' : 'translate-x-0'} ${!lockable ? 'opacity-40' : ''}`} />
                </button>
                <span className={`text-[12px] font-semibold ${item.enabled ? 'text-emerald-300/90' : 'text-gray-500'}`}>
                  {t(item.enabled ? 'ide.context.detail.stateOn' : 'ide.context.detail.stateOff')}
                </span>
                <span className="ml-auto tabular-nums text-[12px] font-semibold text-violet-300/80">
                  {item.estimated ? '~' : ''}{formatTokens(item.tokens)}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-gray-400">{t(controlExplainKey(item.control))}</p>
              {item.hintKey && <p className="mt-1 text-[12px] leading-relaxed text-sky-300/80">{t(item.hintKey)}</p>}
              {item.warnKey && <p className="mt-1 text-[12px] leading-relaxed text-amber-400/80">{t(item.warnKey)}</p>}
              {item.overrideScope && (
                <p className="mt-1 text-[12px] text-violet-300/70">
                  {t('ide.context.detail.overrideBy', { scope: t(`ide.context.scope.${item.overrideScope}`) })}
                </p>
              )}
            </div>

            {/* 파일 목록 — 누르면 그 파일이 오른쪽에 열린다. */}
            {files.length > 0 && (
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wider text-gray-600">
                  {t('ide.context.detail.filesLabel', { count: files.length })}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {files.map((f) => {
                    const active = Boolean(preview?.filePath && f.path && preview.filePath === f.path);
                    return (
                      <li key={f.path ?? f.title}>
                        <div className={`group flex items-center gap-1 rounded px-1.5 py-1 transition-colors ${active ? 'bg-violet-500/15' : 'hover:bg-white/[0.05]'}`}>
                          <button
                            type="button"
                            onClick={() => { if (f.path) void load(f.path); }}
                            title={f.path ?? f.title}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className={`block truncate text-[12px] ${active ? 'text-violet-200' : 'text-gray-300'}`}>{f.title}</span>
                            <span className="block truncate text-[12px] text-gray-600">{f.path}</span>
                          </button>
                          <span className="flex-shrink-0 tabular-nums text-[12px] text-violet-300/60">{formatTokens(f.tokens)}</span>
                          {f.path && (
                            <button
                              type="button"
                              onClick={() => handleOpenFile(f.path as string)}
                              title={t(isInsideRoot(f.path, rootPath) ? 'ide.context.detail.openInEditor' : 'ide.context.detail.openOutside')}
                              aria-label={t(isInsideRoot(f.path, rootPath) ? 'ide.context.detail.openInEditor' : 'ide.context.detail.openOutside')}
                              className="flex-shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition-colors hover:bg-white/[0.08] hover:text-gray-200 group-hover:opacity-100"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* 오른쪽 — 실제로 나가는 본문 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-gray-600">
                {t('ide.context.detail.bodyLabel')}
              </span>
              {preview?.filePath && (
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500" title={preview.filePath}>{preview.filePath}</span>
              )}
              {preview && !preview.unreadable && (
                <span className={`${preview.filePath ? '' : 'ml-auto '}flex-shrink-0 tabular-nums text-[12px] text-gray-500`}>
                  {t('ide.context.detail.sizeLine', { chars: preview.chars.toLocaleString('en-US'), tokens: formatTokens(preview.tokens) })}
                </span>
              )}
              {preview?.text && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                >
                  {t(copied ? 'ide.context.detail.copied' : 'ide.context.detail.copy')}
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-black/30 px-3 py-2">
              {loading && <p className="p-4 text-center text-[12px] text-gray-600">{t('ide.context.detail.loading')}</p>}
              {!loading && failed && <p className="p-4 text-center text-[12px] text-amber-400/80">{t('ide.context.detail.error')}</p>}
              {!loading && !failed && preview?.unreadable && (
                <p className="p-4 text-[12px] leading-relaxed text-gray-500">{t('ide.context.detail.unreadable')}</p>
              )}
              {!loading && !failed && preview && !preview.unreadable && preview.text.length === 0 && (
                <p className="p-4 text-[12px] leading-relaxed text-gray-500">{t('ide.context.detail.emptyBody')}</p>
              )}
              {!loading && !failed && preview && preview.text.length > 0 && (
                <>
                  <PreviewBody text={preview.text} language={language} />
                  {preview.truncated && (
                    <p className="mt-2 border-t border-white/[0.06] pt-2 text-[12px] text-amber-400/70">
                      {t('ide.context.detail.truncated', { count: preview.text.length.toLocaleString('en-US') })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
