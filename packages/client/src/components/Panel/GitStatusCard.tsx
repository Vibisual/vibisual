import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitStatus, GitCommit, GitWorktreeStatus } from '@vibisual/shared';
import { BUBBLE_COLORS, GIT_STATUS_CONFIG } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface GitError {
  title: string;
  subtitle?: React.ReactNode;
  note?: React.ReactNode;
  stderr: string;
}

const API_BASE = '';

function formatRelativeShort(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

interface GitStatusCardProps {
  projectName: string;
}

/**
 * §7.6 GitStatusCard — root 버블 DetailPanel 전용.
 * 4-case 분기 (no-git / not-repo / repo / repo+worktrees) + 수동 새로고침.
 */
export function GitStatusCard({ projectName }: GitStatusCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<GitError | null>(null);
  const [syncingNodeId, setSyncingNodeId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const setGitRefreshing = useGraphStore((s) => s.setGitRefreshing);
  const gitRefreshing = useGraphStore((s) => s.gitRefreshing[projectName] ?? false);

  const fetchStatus = useCallback(async (force: boolean): Promise<void> => {
    setGitRefreshing(projectName, true);
    setError(null);
    try {
      const url = `${API_BASE}/api/git-status/${encodeURIComponent(projectName)}${force ? '?force=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GitStatus;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitRefreshing(projectName, false);
    }
  }, [projectName, setGitRefreshing]);

  const syncWorktree = useCallback(async (wt: GitWorktreeStatus): Promise<void> => {
    setSyncingNodeId(wt.nodeId);
    try {
      const res = await fetch(`${API_BASE}/api/worktree/${encodeURIComponent(wt.nodeId)}/sync`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; step?: string; base?: string; stderr?: string; error?: string;
      };
      if (res.status === 409 && body.step === 'merge') {
        setGitError({
          title: t('panel.gitStatus.syncFailed'),
          subtitle: (
            <>
              <span className="font-mono text-lime-300">{wt.branch}</span>
              {' ← '}
              <span className="font-mono text-gray-300">{body.base ?? '?'}</span>
            </>
          ),
          note: t('panel.gitStatus.syncNote'),
          stderr: body.stderr ?? 'merge conflict',
        });
        return;
      }
      if (!res.ok || !body.ok) {
        setGitError({
          title: t('panel.gitStatus.syncFailedGeneric'),
          subtitle: <span className="font-mono text-gray-300">{wt.branch}</span>,
          stderr: body.stderr ?? (body.error ?? `HTTP ${res.status}`),
        });
        return;
      }
      await fetchStatus(true);
    } catch (err) {
      setGitError({
        title: t('panel.gitStatus.syncFailedGeneric'),
        stderr: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncingNodeId(null);
    }
  }, [fetchStatus, t]);

  const runCommit = useCallback(async (): Promise<void> => {
    setCommitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; step?: string; message?: string; stderr?: string; error?: string;
      };
      if (!res.ok || !body.ok) {
        setGitError({
          title: t('panel.gitStatus.commitFailed'),
          subtitle: body.step === 'commit'
            ? <span className="font-mono text-gray-300">git commit</span>
            : body.step === 'add'
              ? <span className="font-mono text-gray-300">git add -A</span>
              : undefined,
          note: body.step === 'commit'
            ? t('panel.gitStatus.commitNote')
            : undefined,
          stderr: body.stderr ?? (body.error ?? `HTTP ${res.status}`),
        });
        return;
      }
      await fetchStatus(true);
    } catch (err) {
      setGitError({
        title: t('panel.gitStatus.commitFailed'),
        stderr: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCommitting(false);
    }
  }, [projectName, fetchStatus, t]);

  useEffect(() => {
    void fetchStatus(false);
  }, [fetchStatus]);

  return (
    <section className="flex flex-col gap-2 rounded border border-gray-700/50 bg-gray-800/30 p-2.5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
          <BranchIcon className="h-3.5 w-3.5" />
          <span>{t('panel.gitStatus.git')}</span>
        </div>
        <button
          type="button"
          onClick={() => { void fetchStatus(true); }}
          disabled={gitRefreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-700/40 hover:text-gray-200 disabled:opacity-50"
          title={t('panel.gitStatus.refreshTitle')}
        >
          <RefreshIcon className={`h-3 w-3 ${gitRefreshing ? 'animate-spin' : ''}`} />
          <span>{t('panel.gitStatus.refresh')}</span>
        </button>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => { void fetchStatus(true); }} />
      ) : !status ? (
        <LoadingSkeleton />
      ) : status.case === 'no-git' ? (
        <NoGitState />
      ) : status.case === 'not-repo' ? (
        <NotRepoState projectName={projectName} onInitDone={() => { void fetchStatus(true); }} />
      ) : (
        <RepoState
          status={status}
          onSyncWorktree={(wt) => { void syncWorktree(wt); }}
          syncingNodeId={syncingNodeId}
          onCommit={() => { void runCommit(); }}
          committing={committing}
        />
      )}

      {gitError && (
        <GitErrorModal error={gitError} onClose={() => setGitError(null)} />
      )}
    </section>
  );
}

// ─── Case states ───

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="h-3 w-24 animate-pulse rounded bg-gray-700/60" />
      <div className="h-3 w-40 animate-pulse rounded bg-gray-700/40" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 py-3 text-center">
      <AlertIcon className="h-5 w-5 text-red-400" />
      <p className="text-xs text-gray-400">{t('panel.gitStatus.failedToLoad')}</p>
      <p className="font-mono text-[10px] text-gray-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:border-gray-500 hover:text-white"
      >
        {t('panel.gitStatus.retry')}
      </button>
    </div>
  );
}

function NoGitState(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 py-3 text-center">
      <AlertIcon className="h-6 w-6 text-amber-400/80" />
      <p className="text-xs font-medium text-gray-200">{t('panel.gitStatus.notInstalled')}</p>
      <p className="text-[10px] text-gray-500">{t('panel.gitStatus.needsGit')}</p>
      <a
        href="https://git-scm.com/downloads"
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10 hover:text-blue-300"
      >
        {t('panel.gitStatus.installGuide')}
        <ExternalLinkIcon className="h-3 w-3" />
      </a>
    </div>
  );
}

function NotRepoState({ projectName, onInitDone }: { projectName: string; onInitDone: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const handleInit = useCallback(async () => {
    if (!window.confirm(t('panel.gitStatus.initConfirm', { projectName }))) return;
    setPending(true);
    try {
      const res = await fetch(`${API_BASE}/api/git-init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; stderr?: string };
        window.alert(t('panel.gitStatus.initFailed') + '\n' + (body.error ?? '') + '\n' + (body.stderr ?? ''));
        return;
      }
      onInitDone();
    } finally {
      setPending(false);
    }
  }, [projectName, onInitDone, t]);

  return (
    <div className="flex flex-col items-center gap-2 py-3 text-center">
      <CircleDotIcon className="h-6 w-6 text-blue-400/80" />
      <p className="text-xs font-medium text-gray-200">{t('panel.gitStatus.notRepo')}</p>
      <p className="truncate font-mono text-[10px] text-gray-500">/{projectName}</p>
      <button
        type="button"
        onClick={() => { void handleInit(); }}
        disabled={pending}
        className="mt-1 flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-50"
      >
        {pending ? t('panel.gitStatus.initRunning') : t('panel.gitStatus.runInit')}
        {!pending && <ArrowRightIcon className="h-3 w-3" />}
      </button>
    </div>
  );
}

function RepoState({
  status,
  onSyncWorktree,
  syncingNodeId,
  onCommit,
  committing,
}: {
  status: Extract<GitStatus, { case: 'repo' }>;
  onSyncWorktree: (wt: GitWorktreeStatus) => void;
  syncingNodeId: string | null;
  onCommit: () => void;
  committing: boolean;
}): React.JSX.Element {
  const dirty = status.staged + status.modified + status.untracked > 0;
  return (
    <div className="flex flex-col gap-2.5">
      <BranchRow branch={status.branch} ahead={status.ahead} behind={status.behind} />
      <ChangeCounts staged={status.staged} modified={status.modified} untracked={status.untracked} />
      <CommitButton dirty={dirty} committing={committing} onClick={onCommit} />
      {status.commits.length > 0 && <CommitList commits={status.commits} />}
      {status.worktrees.length > 0 && (
        <WorktreeList
          worktrees={status.worktrees}
          onSync={onSyncWorktree}
          syncingNodeId={syncingNodeId}
        />
      )}
    </div>
  );
}

function CommitButton({
  dirty,
  committing,
  onClick,
}: {
  dirty: boolean;
  committing: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const enabled = dirty && !committing;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className={`flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[11px] transition-colors ${
        enabled
          ? 'border-gray-700 bg-gray-800/40 text-gray-200 hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-300'
          : 'border-gray-800 text-gray-600'
      } disabled:cursor-not-allowed`}
      title={dirty ? t('panel.gitStatus.commitTitleDirty') : t('panel.gitStatus.commitTitleClean')}
    >
      {committing ? (
        <RefreshIcon className="h-3 w-3 animate-spin" />
      ) : (
        <CommitIcon className="h-3 w-3" />
      )}
      <span>{committing ? t('panel.gitStatus.committing') : t('panel.gitStatus.commit')}</span>
    </button>
  );
}

// ─── Pieces ───

function BranchRow({ branch, ahead, behind }: { branch: string; ahead: number; behind: number }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <BranchIcon className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
        <span className="truncate font-mono text-xs text-gray-200">{branch}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px]">
        {ahead > 0 && (
          <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
            <ArrowUpIcon className="h-2.5 w-2.5" />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="flex items-center gap-0.5 rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-400">
            <ArrowDownIcon className="h-2.5 w-2.5" />
            {behind}
          </span>
        )}
        {ahead === 0 && behind === 0 && (
          <span className="rounded bg-gray-700/40 px-1.5 py-0.5 text-gray-500">{t('panel.gitStatus.synced')}</span>
        )}
      </div>
    </div>
  );
}

function ChangeCounts({ staged, modified, untracked }: { staged: number; modified: number; untracked: number }): React.JSX.Element {
  const { t } = useTranslation();
  const hasAny = staged + modified + untracked > 0;
  if (!hasAny) {
    return <p className="text-[10px] text-gray-500">{t('panel.gitStatus.clean')}</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <CountBox label="staged" count={staged} tone="emerald" />
      <CountBox label="modified" count={modified} tone="amber" />
      <CountBox label="untracked" count={untracked} tone="gray" />
    </div>
  );
}

function CountBox({ label, count, tone }: { label: 'staged' | 'modified' | 'untracked'; count: number; tone: 'emerald' | 'amber' | 'gray' }): React.JSX.Element {
  const { t } = useTranslation();
  const toneMap = {
    emerald: count > 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-gray-700/50 text-gray-600',
    amber:   count > 0 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'       : 'border-gray-700/50 text-gray-600',
    gray:    count > 0 ? 'border-gray-500/40 bg-gray-500/10 text-gray-300'          : 'border-gray-700/50 text-gray-600',
  };
  return (
    <div className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1 ${toneMap[tone]}`}>
      <span className="font-mono text-sm font-semibold leading-none">{count}</span>
      <span className="text-[9px] uppercase tracking-wide opacity-80">{t(`panel.gitStatus.${label}Label`)}</span>
    </div>
  );
}

function CommitList({ commits }: { commits: GitCommit[] }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{t('panel.gitStatus.recentCommits')}</span>
      <ul className="flex flex-col gap-0.5">
        {commits.map((c) => (
          <li key={c.sha} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-800/40">
            {c.coAuthoredByClaude ? (
              <span
                className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ backgroundColor: BUBBLE_COLORS.agent }}
                title={t('panel.gitStatus.coAuthoredByClaude')}
              >
                C
              </span>
            ) : (
              <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-gray-600" title={c.author} />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-300" title={c.subject}>
              {c.subject}
            </span>
            <span className="flex-shrink-0 text-[10px] text-gray-500">{formatRelativeShort(c.timestamp)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorktreeList({
  worktrees,
  onSync,
  syncingNodeId,
}: {
  worktrees: GitWorktreeStatus[];
  onSync: (wt: GitWorktreeStatus) => void;
  syncingNodeId: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        {t('panel.gitStatus.worktrees')} · {worktrees.length}
      </span>
      <ul className="flex flex-col gap-0.5">
        {worktrees.map((w) => (
          <WorktreeRow
            key={w.nodeId}
            wt={w}
            onSync={onSync}
            syncing={syncingNodeId === w.nodeId}
          />
        ))}
      </ul>
    </div>
  );
}

function WorktreeRow({
  wt,
  onSync,
  syncing,
}: {
  wt: GitWorktreeStatus;
  onSync: (wt: GitWorktreeStatus) => void;
  syncing: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const focusOnNode = useGraphStore((s) => s.focusOnNode);
  const goToMain = useGraphStore((s) => s.goToMain);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const handleFocus = useCallback(() => {
    if (currentFolderId) goToMain();
    selectNode(wt.nodeId);
    focusOnNode(wt.nodeId);
  }, [wt.nodeId, currentFolderId, goToMain, selectNode, focusOnNode]);

  const canSync = wt.behind > 0;
  const handleSync = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canSync || syncing) return;
    onSync(wt);
  }, [wt, onSync, canSync, syncing]);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleFocus}
        onKeyDown={(e) => { if (e.key === 'Enter') handleFocus(); }}
        className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-800/40"
        title={t('panel.gitStatus.goToWorktree', { name: wt.name })}
      >
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: BUBBLE_COLORS.worktree }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-300">{wt.branch}</span>
        <span className="flex items-center gap-1 text-[10px]">
          {wt.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-400">
              <ArrowUpIcon className="h-2 w-2" />
              {wt.ahead}
            </span>
          )}
          {wt.behind > 0 && (
            <span className="flex items-center gap-0.5 text-orange-400">
              <ArrowDownIcon className="h-2 w-2" />
              {wt.behind}
            </span>
          )}
          {wt.dirty && (
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: GIT_STATUS_CONFIG.DIRTY_DOT_COLOR }}
              title={t('panel.gitStatus.uncommittedChangesTitle')}
            />
          )}
        </span>
        <button
          type="button"
          onClick={handleSync}
          disabled={!canSync || syncing}
          className={`flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            canSync
              ? 'border border-gray-700 text-gray-300 hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-300'
              : 'border border-gray-800 text-gray-600'
          } disabled:opacity-50`}
          title={canSync ? t('panel.gitStatus.mergeInto', { branch: wt.branch }) : t('panel.gitStatus.upToDate')}
        >
          {syncing ? (
            <RefreshIcon className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <SyncIcon className="h-2.5 w-2.5" />
          )}
          <span>{t('panel.gitStatus.syncBtn')}</span>
        </button>
        {wt.lastActivityAt && (
          <span className="flex-shrink-0 text-[10px] text-gray-600">{formatRelativeShort(wt.lastActivityAt)}</span>
        )}
      </div>
    </li>
  );
}

// ─── Git 에러 모달 (v1.20 WorktreeDeleteDialog 패턴 기반, title/stderr props 로 일반화) ───

function GitErrorModal({
  error,
  onClose,
}: {
  error: GitError;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(error.stderr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [error.stderr]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[clamp(22rem,40vw,32rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="border-b border-gray-800 px-5 py-3">
          <div className="text-sm font-semibold text-gray-100">{error.title}</div>
          {error.subtitle && (
            <div className="truncate text-xs text-gray-400">{error.subtitle}</div>
          )}
        </div>
        <div className="px-5 py-4">
          {error.note && (
            <p className="mb-3 text-xs text-gray-400">{error.note}</p>
          )}
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-red-300">{t('panel.gitStatus.stderr')}</div>
            <button
              type="button"
              onClick={() => { void handleCopy(); }}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-700"
            >
              {copied ? t('panel.gitStatus.copied') : t('panel.gitStatus.copy')}
            </button>
          </div>
          <pre
            ref={preRef}
            className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-800 bg-black/60 p-3 font-mono text-xs text-gray-200 select-text"
          >
            {error.stderr}
          </pre>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              {t('panel.gitStatus.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Icons ───

function BranchIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function RefreshIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function AlertIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CircleDotIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function ExternalLinkIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ArrowRightIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function ArrowUpIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function SyncIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function CommitIcon(props: { className?: string }): React.JSX.Element {
  // git commit icon — horizontal line with circle (octicons/git-commit 재현)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="4" />
      <line x1="1.05" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="22.96" y2="12" />
    </svg>
  );
}
