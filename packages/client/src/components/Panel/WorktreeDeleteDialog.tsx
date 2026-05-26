import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

type Phase = 'loading' | 'confirm' | 'running' | 'error';

interface StatusResponse {
  branch: string | null;
  baseBranch: string;
  isMerged: boolean;
  wtPath: string;
  parentPath: string;
}

export const WorktreeDeleteDialog = memo(function WorktreeDeleteDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const target = useGraphStore((s) => s.worktreeDeleteTarget);
  const close = useGraphStore((s) => s.closeWorktreeDelete);
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [errText, setErrText] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const errRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!target) { setStatus(null); setPhase('loading'); setErrText(''); return; }
    let cancelled = false;
    setPhase('loading');
    fetch(`${API_BASE}/api/worktree/${encodeURIComponent(target.nodeId)}/status`)
      .then(async (r) => {
        if (!r.ok) throw new Error('status fetch failed');
        return r.json() as Promise<StatusResponse>;
      })
      .then((s) => { if (!cancelled) { setStatus(s); setPhase('confirm'); } })
      .catch(() => { if (!cancelled) { setStatus(null); setPhase('confirm'); } });
    return () => { cancelled = true; };
  }, [target]);

  const runDelete = useCallback(async (mergeFirst: boolean) => {
    if (!target) return;
    setPhase('running');
    try {
      const url = `${API_BASE}/api/worktree/${encodeURIComponent(target.nodeId)}${mergeFirst ? '?merge=1' : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; stderr?: string; step?: string };
      if (!res.ok || !body.ok) {
        const message = [
          body.step === 'merge' ? t('panel.worktreeDelete.mergeFailedLine', { branch: status?.branch ?? '' }) : (body.error ?? 'delete failed'),
          '',
          body.stderr ?? '',
        ].join('\n').trim();
        setErrText(message);
        setPhase('error');
        return;
      }
      close();
    } catch (e) {
      setErrText(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [target, status, close, t]);

  const copyErr = useCallback(async () => {
    try { await navigator.clipboard.writeText(errText); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  }, [errText]);

  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, close]);

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-[clamp(22rem,40vw,32rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="border-b border-gray-800 px-5 py-3">
          <div className="text-sm font-semibold text-gray-100">{t('panel.worktreeDelete.title')}</div>
          <div className="truncate text-xs text-gray-400">{target.label}</div>
        </div>

        {phase === 'loading' && (
          <div className="px-5 py-6 text-sm text-gray-300">{t('panel.worktreeDelete.checking')}</div>
        )}

        {phase === 'confirm' && (
          <div className="px-5 py-4">
            {status?.branch && status.isMerged && (
              <div className="mb-4 text-sm text-gray-300">
                {t('panel.worktreeDelete.mergedInto', { branch: status.branch, base: status.baseBranch })}
              </div>
            )}
            {status?.branch && !status.isMerged && (
              <div className="mb-4 text-sm text-gray-300">
                {t('panel.worktreeDelete.notMerged', { branch: status.branch, base: status.baseBranch })}
              </div>
            )}
            {!status?.branch && (
              <div className="mb-4 text-sm text-amber-300">
                {t('panel.worktreeDelete.branchUnresolved')}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                {t('panel.worktreeDelete.cancel')}
              </button>
              {status?.branch && !status.isMerged && (
                <button
                  type="button"
                  onClick={() => { void runDelete(true); }}
                  className="rounded border border-lime-600 bg-lime-700 px-3 py-1.5 text-sm text-white hover:bg-lime-600 transition-colors"
                >
                  {t('panel.worktreeDelete.mergeAndDelete')}
                </button>
              )}
              <button
                type="button"
                onClick={() => { void runDelete(false); }}
                className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white hover:bg-red-700 transition-colors"
              >
                {status?.branch && !status.isMerged ? t('panel.worktreeDelete.deleteAnyway') : t('panel.worktreeDelete.delete')}
              </button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="px-5 py-6 text-sm text-gray-300">{t('panel.worktreeDelete.working')}</div>
        )}

        {phase === 'error' && (
          <div className="px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-red-300">{t('panel.worktreeDelete.mergeFailed')}</div>
              <button
                type="button"
                onClick={() => { void copyErr(); }}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
              >
                {copied ? t('panel.worktreeDelete.copied') : t('panel.worktreeDelete.copy')}
              </button>
            </div>
            <pre
              ref={errRef}
              className="scrollbar-thin max-h-64 overflow-auto rounded border border-gray-800 bg-black/60 p-3 font-mono text-xs text-gray-200 select-text whitespace-pre-wrap break-words"
            >
              {errText}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                {t('panel.worktreeDelete.close')}
              </button>
              <button
                type="button"
                onClick={() => { void runDelete(false); }}
                className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white hover:bg-red-700 transition-colors"
              >
                {t('panel.worktreeDelete.deleteAnyway')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
