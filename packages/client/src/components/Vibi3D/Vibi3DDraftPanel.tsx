import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DDraft, Vibi3DDraftSummary } from '@vibisual/shared';
import { listModelDrafts, ModelDraftApiError, readModelDraftHistory, readModelDraftVersion } from './modelDraftApi.js';
import type { ModelDraftSaveState } from './modelDraftAutosave.js';

export interface Vibi3DDraftStatusProps { state: ModelDraftSaveState; onRetry: () => void; actor?: 'human' | 'agent' }
export function Vibi3DDraftStatus({ state, onRetry, actor }: Vibi3DDraftStatusProps): React.JSX.Element {
  const { t } = useTranslation();
  const conflict = state.error instanceof ModelDraftApiError && state.error.code === 'draft-version-conflict';
  const status = state.status === 'pending' ? 'saving' : state.status;
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-vb-code-fg" role="status" aria-live="polite">
    {actor && <span>{t(`panel.vibi3d.drafts.${actor}`)}</span>}
    <span title={state.savedAt ? new Date(state.savedAt).toLocaleString() : undefined}>
      {t(`panel.vibi3d.drafts.${status === 'error' && conflict ? 'conflict' : status}`)}
    </span>
    {state.status === 'error' && <button type="button" onClick={onRetry}
      className="rounded bg-vb-sunken px-2 py-1.5 hover:bg-vb-raised pointer-coarse:py-2">
      {t('panel.vibi3d.drafts.retry')}
    </button>}
  </div>;
}

export interface Vibi3DDraftPanelProps {
  projectId: string;
  draftKey?: string;
  /** Active editor identity when the panel intentionally lists the whole project's drafts. */
  scopeKey?: string;
  refreshToken?: string | number;
  onRestore: (draft: Vibi3DDraft) => void | Promise<void>;
  onDiscard?: (draft: Vibi3DDraft) => void | Promise<void>;
}

/** Restore is a shell action: this panel never silently applies a draft to the committed source. */
export function Vibi3DDraftPanel({ projectId, draftKey, scopeKey, refreshToken, onRestore, onDiscard }: Vibi3DDraftPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [refresh, setRefresh] = useState(0);
  const [drafts, setDrafts] = useState<Vibi3DDraftSummary[]>([]);
  const [versions, setVersions] = useState<Vibi3DDraftSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [partial, setPartial] = useState(false);
  const scope = JSON.stringify([projectId, draftKey, scopeKey]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const operation = useRef(0);
  const activeOperation = useRef<number | null>(null);
  const listing = useRef(0);
  const identity = (draft: Vibi3DDraftSummary): string => JSON.stringify([draft.key, draft.actor]);

  useEffect(() => {
    operation.current += 1;
    activeOperation.current = null;
    setDrafts([]); setVersions([]); setSelected(null); setLoading(true); setBusy(false);
    setListError(false); setActionError(false); setPartial(false);
    return () => { operation.current += 1; activeOperation.current = null; listing.current += 1; };
  }, [scope]);

  useEffect(() => {
    const request = ++listing.current;
    const current = (): boolean => request === listing.current && currentScope.current === scope;
    // Autosave updates only the head summaries. History selection and any confirmation
    // already in progress belong to their own operation, not this background request.
    setLoading(true); setListError(false);
    void listModelDrafts(projectId).then(result => {
      if (!current()) return;
      setDrafts(result.drafts.filter(draft => !draftKey || draft.key === draftKey));
      setPartial(result.failed.length > 0);
    }).catch(() => { if (current()) setListError(true); }).finally(() => { if (current()) setLoading(false); });
    return () => { listing.current += 1; };
  }, [projectId, draftKey, scope, refreshToken, refresh]);

  const history = async (draft: Vibi3DDraftSummary): Promise<void> => {
    if (activeOperation.current !== null) return;
    const id = ++operation.current;
    activeOperation.current = id;
    setSelected(identity(draft)); setVersions([]); setBusy(true); setActionError(false);
    try {
      const result = await readModelDraftHistory({ projectId, key: draft.key, actor: draft.actor });
      if (id === operation.current && currentScope.current === scope) setVersions(result);
    } catch { if (id === operation.current && currentScope.current === scope) setActionError(true); }
    finally { if (id === operation.current && currentScope.current === scope) { activeOperation.current = null; setBusy(false); } }
  };

  const perform = async (draft: Vibi3DDraftSummary, action: 'restore' | 'discard'): Promise<void> => {
    if (activeOperation.current !== null) return;
    const id = ++operation.current;
    activeOperation.current = id;
    setBusy(true); setActionError(false);
    try {
      const full = await readModelDraftVersion({ projectId, key: draft.key, actor: draft.actor }, draft.version);
      if (id !== operation.current || currentScope.current !== scope) return;
      if (full.key !== draft.key || full.actor !== draft.actor || full.version !== draft.version) throw new Error('draft-version-mismatch');
      await (action === 'restore' ? onRestore(full) : onDiscard?.(full));
      if (id === operation.current && currentScope.current === scope) setRefresh(value => value + 1);
    } catch { if (id === operation.current && currentScope.current === scope) setActionError(true); }
    finally { if (id === operation.current && currentScope.current === scope) { activeOperation.current = null; setBusy(false); } }
  };
  const button = 'rounded bg-vb-sunken px-2 py-1.5 hover:bg-vb-raised disabled:opacity-50 pointer-coarse:py-2';
  const error = listError || actionError;

  return <details className="mb-2 min-w-0 rounded border border-vb-code-border p-2 text-xs text-vb-code-fg">
    <summary className="cursor-pointer pointer-coarse:py-2">{t('panel.vibi3d.drafts.history')}</summary>
    <p className="my-2 text-vb-code-fg/70">{t('panel.vibi3d.drafts.hint')}</p>
    <button type="button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)} className={button}>
      {t('panel.gitStatus.refresh')}
    </button>
    {loading && <p className="mt-2" role="status">{t('panel.vibi3d.drafts.loading')}</p>}
    {error && <p className="mt-2" role="alert">{t('panel.vibi3d.drafts.loadFailed')}</p>}
    {partial && <p className="mt-2" role="status">{t('panel.vibi3d.drafts.partial')}</p>}
    {!loading && !error && drafts.length === 0 && <p className="mt-2">{t('panel.vibi3d.drafts.empty')}</p>}
    <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
      {drafts.map(draft => <li key={identity(draft)} className="min-w-0 rounded bg-vb-sunken p-2">
        <p className="truncate" title={draft.fileName}>{draft.fileName} · {t(`panel.vibi3d.drafts.${draft.actor}`)}</p>
        <p className="my-1 text-vb-code-fg/70">{t('panel.vibi3d.drafts.version', { version: draft.version, time: new Date(draft.updatedAt).toLocaleString() })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void perform(draft, 'restore')} className={button}>{t('panel.vibi3d.drafts.restore')}</button>
          <button type="button" disabled={busy} onClick={() => void history(draft)} className={button}>{t('panel.vibi3d.drafts.versions')}</button>
          {onDiscard && draft.actor === 'agent' && <button type="button" disabled={busy} onClick={() => void perform(draft, 'discard')} className={button}>
            {t('panel.vibi3d.drafts.discardAgent')}
          </button>}
        </div>
        {selected === identity(draft) && <ol className="mt-2 space-y-1">
          {versions.map(version => <li key={version.version} className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('panel.vibi3d.drafts.version', { version: version.version, time: new Date(version.updatedAt).toLocaleString() })}</span>
            <button type="button" disabled={busy} onClick={() => void perform(version, 'restore')} className={button}>{t('panel.vibi3d.drafts.restore')}</button>
          </li>)}
        </ol>}
      </li>)}
    </ul>
  </details>;
}
