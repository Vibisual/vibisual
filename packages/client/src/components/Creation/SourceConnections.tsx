import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDoc, CreationDocSummary, CreationImpact, CreationLink, CreationOutput } from '@vibisual/shared';
import { openAppWindow } from '../../apps/appWindows.js';
import { getInternalApp } from '../../apps/registry.js';
import {
  commitCreationDoc, keepCreationLink, listCreationDocs, readCreationDoc, readCreationHistory, readCreationImpacts, readCreationOutputs,
} from './creationApi.js';
import { creationErrorText } from './creationErrors.js';
import { useCreationHead } from './useCreationHead.js';

type SourceSummary = Pick<CreationDoc, 'id' | 'title' | 'appId' | 'revision' | 'links' | 'parameters'>;
export type LinkState = 'current' | 'available' | 'kept';
/** Whether a reference is up to date, behind with a pending notice, or behind by the user's decision. */
export function linkState(link: Pick<CreationLink, 'sourceRevision' | 'keptRevision'>, latest: number | undefined): LinkState {
  if (latest === undefined || latest <= link.sourceRevision) return 'current';
  return (link.keptRevision ?? 0) >= latest ? 'kept' : 'available';
}

interface Props {
  projectId: string;
  doc: SourceSummary;
  disabled?: boolean;
  onDoc?: (doc: CreationDoc) => void;
  /**
   * The app's own update for roles it can recompute (re-render a layer, a texture …); it applies the result itself.
   * Resolve `false` for a role it does not know: the shared fallback then moves only the reference revision and says so.
   */
  onUpdateLink?: (link: CreationLink, revision: number) => Promise<boolean>;
}
/** Refresh cadence of the connection lists while the panel is open and the window visible. */
const REFRESH_MS = 10_000;
const HISTORY_SHOWN = 10;

/** `undefined` = not read yet, `null` = the read failed (shown), a list = loaded. */
interface Loaded {
  sources: CreationDocSummary[] | null | undefined;
  impacts: CreationImpact[] | null | undefined;
  outputs: CreationOutput[] | null | undefined;
  history: CreationDocSummary[] | null | undefined;
}

/** Shared controls show source relationships; they never guess how to render an app's payload. */
export function SourceConnections({ projectId, doc, disabled = false, onDoc, onUpdateLink }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ sources: undefined, impacts: undefined, outputs: undefined, history: undefined });
  const [failed, setFailed] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [genericNote, setGenericNote] = useState('');
  const scopeRef = useRef({ projectId, id: doc.id });
  if (scopeRef.current.projectId !== projectId || scopeRef.current.id !== doc.id) scopeRef.current = { projectId, id: doc.id };
  const operationRef = useRef(0);
  useEffect(() => {
    operationRef.current += 1; setBusy(false); setFailed(''); setGenericNote('');
    setLoaded({ sources: undefined, impacts: undefined, outputs: undefined, history: undefined });
  }, [projectId, doc.id]);
  useEffect(() => () => { operationRef.current += 1; }, []);
  const head = useCreationHead(projectId, doc.id, { enabled: open });
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') setRefresh(v => v + 1); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    // Each list stands alone: one failed read leaves the others visible.
    void Promise.allSettled([
      listCreationDocs(projectId), readCreationImpacts(projectId, doc.id), readCreationOutputs(projectId, doc.id), readCreationHistory(projectId, doc.id),
    ]).then(([sources, impacts, outputs, history]) => {
      if (cancelled) return;
      setLoaded({
        sources: sources.status === 'fulfilled' ? sources.value.docs : null,
        impacts: impacts.status === 'fulfilled' ? impacts.value : null,
        outputs: outputs.status === 'fulfilled' ? outputs.value : null,
        history: history.status === 'fulfilled' ? history.value : null,
      });
    });
    return () => { cancelled = true; };
  }, [open, projectId, doc.id, doc.revision, refresh, head?.revision]);

  const openSource = useCallback((source: { id: string; appId: string; title: string; parameters?: SourceSummary['parameters'] }) => {
    if (!getInternalApp(source.appId)) return;
    const nativeRef = source.parameters?.['nativeRef'];
    openAppWindow({ appId: source.appId, projectId, ref: typeof nativeRef === 'string' ? nativeRef : source.id, title: source.title });
  }, [projectId]);
  const run = async (action: () => Promise<CreationDoc | null>, ownDoc: boolean): Promise<void> => {
    if (disabled || busy) return;
    const scope = scopeRef.current, operation = ++operationRef.current;
    const current = (): boolean => scopeRef.current === scope && operationRef.current === operation;
    setBusy(true); setFailed('');
    try {
      const next = await action();
      if (current()) { if (ownDoc && next) onDoc?.(next); setRefresh(v => v + 1); }
    } catch (error) { if (current()) setFailed(creationErrorText(t, error)); }
    finally { if (current()) setBusy(false); }
  };
  const update = (link: CreationLink, revision: number): Promise<void> => run(async () => {
    if (onUpdateLink && await onUpdateLink(link, revision)) return null;
    // A role this app cannot recompute: move the reference only, and say so.
    setGenericNote(t('panel.creation.referenceOnly'));
    return commitCreationDoc(projectId, doc, { links: doc.links.map(item => item.id === link.id ? { ...item, sourceRevision: revision } : item) });
  }, true);
  const keep = (docId: string, linkId: string, revision: number | null, own: boolean): Promise<void> =>
    run(() => keepCreationLink(projectId, docId, linkId, revision), own);

  const latestOf = (id: string): number | undefined => loaded.sources?.find(item => item.id === id)?.revision;
  const row = 'mt-2 rounded border border-white/10 p-2';
  const button = 'rounded bg-white/10 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2';
  return <details className="border-t border-white/10 px-3 py-2 text-xs text-gray-300" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium pointer-coarse:py-2">{t('panel.creation.connections')}</summary>
    {/* 펼친 목록은 화면 높이의 30% 안에서 스크롤한다 — 원본·쓰는 곳·이력이 길어도 아래 AI 요청 칸을 밀어내지 않게. */}
    <div className="scrollbar-thin max-h-[30dvh] overflow-y-auto">
      <div className="mt-2 flex items-center justify-between gap-2">
        <span>{t('panel.creation.version', { revision: doc.revision })}</span>
        <button type="button" onClick={() => setRefresh(value => value + 1)} className={button}>{t('panel.gitStatus.refresh')}</button>
      </div>
      {failed && <p role="alert" className="mt-2 text-amber-300">{failed}</p>}
      {genericNote && <p role="status" className="mt-2 text-gray-400">{genericNote}</p>}
      {disabled && <p className="mt-2 text-amber-300">{t('panel.creation.saveFirst')}</p>}

      <p className="mt-3 font-medium">{t('panel.creation.sources')}</p>
      {loaded.sources === null && open && <p className="mt-1 text-amber-300">{t('panel.creation.sectionFailed')}</p>}
      {doc.links.length === 0 && <p className="mt-1 text-gray-500">{t('panel.creation.noSources')}</p>}
      {doc.links.map(link => {
        const source = loaded.sources?.find(item => item.id === link.sourceId);
        const latest = latestOf(link.sourceId);
        const state = linkState(link, latest);
        return <div key={link.id} className={row}>
          <button type="button" disabled={!source} onClick={() => source && openSource(source)} className="min-w-0 break-all text-left underline decoration-white/25">
            {source?.title || link.role}
          </button>
          <p className="mt-1 text-gray-400">{t('panel.creation.reference', { revision: link.sourceRevision, targets: link.targets.join(', ') })}</p>
          {state === 'available' && latest !== undefined && <>
            <p className="mt-1 text-amber-300">{t('panel.creation.updateAvailable', { revision: latest })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy || disabled} onClick={() => void update(link, latest)} className="rounded bg-indigo-500/20 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2">
                {t('panel.creation.update')}
              </button>
              <button type="button" disabled={busy || disabled} onClick={() => void keep(doc.id, link.id, latest, true)} className={button}>{t('panel.creation.keep')}</button>
            </div>
          </>}
          {state === 'kept' && latest !== undefined && <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-gray-400">{t('panel.creation.kept', { revision: link.sourceRevision, seen: link.keptRevision ?? latest })}</span>
            <button type="button" disabled={busy || disabled} onClick={() => void keep(doc.id, link.id, null, true)} className={button}>{t('panel.creation.unkeep')}</button>
          </div>}
        </div>;
      })}

      <p className="mt-3 font-medium">{t('panel.creation.usedBy')}</p>
      {loaded.impacts === null && open && <p className="mt-1 text-amber-300">{t('panel.creation.sectionFailed')}</p>}
      {loaded.impacts?.length === 0 && <p className="mt-1 text-gray-500">{t('panel.creation.noUses')}</p>}
      {loaded.impacts?.map(impact => {
        const state = linkState(impact, impact.latestRevision);
        return <div key={`${impact.docId}:${impact.linkId}`} className={row}>
          <button type="button" className="min-w-0 break-all text-left underline decoration-white/25" onClick={() => {
            void readCreationDoc(projectId, impact.docId).then(openSource).catch((error: unknown) => setFailed(creationErrorText(t, error)));
          }}>{impact.title || impact.appId}</button>
          <p className="mt-1 text-gray-400">
            {t(impact.depth > 1 ? 'panel.creation.indirect' : 'panel.creation.direct', { depth: impact.depth })}
            {' · '}{t('panel.creation.reference', { revision: impact.sourceRevision, targets: impact.targets.join(', ') })}
          </p>
          <p className="mt-1">{t(state === 'current' ? 'panel.creation.currentVersion' : state === 'kept' ? 'panel.creation.keptVersion' : 'panel.creation.olderVersion')}</p>
          {impact.broken && <p className="mt-1 text-amber-300">{t('panel.creation.chainBroken')}</p>}
          {impact.outputs.length > 0 && <ul className="mt-1 space-y-0.5 text-gray-400">
            {impact.outputs.map(output => <li key={output.id} className="break-all">{t('panel.creation.output', { path: output.path, revision: output.sourceRevision })}</li>)}
          </ul>}
          {impact.depth === 1 && state === 'available' && <button type="button" disabled={busy}
            onClick={() => void keep(impact.docId, impact.linkId, impact.latestRevision, false)} className={`${button} mt-2`}>{t('panel.creation.keep')}</button>}
          {impact.depth === 1 && state === 'kept' && <button type="button" disabled={busy}
            onClick={() => void keep(impact.docId, impact.linkId, null, false)} className={`${button} mt-2`}>{t('panel.creation.unkeep')}</button>}
        </div>;
      })}

      {loaded.outputs && loaded.outputs.length > 0 && <>
        <p className="mt-3 font-medium">{t('panel.creation.outputs')}</p>
        {loaded.outputs.map(output => <p key={output.id} className="mt-1 break-all text-gray-400">{t('panel.creation.output', { path: output.path, revision: output.sourceRevision })}</p>)}
      </>}
      {loaded.history && loaded.history.length > 0 && <>
        <p className="mt-3 font-medium">{t('panel.creation.history')}</p>
        <ul className="mt-1 space-y-0.5 text-gray-400">
          {loaded.history.slice(0, HISTORY_SHOWN).map(entry => <li key={entry.revision}>
            {t('panel.creation.historyEntry', {
              revision: entry.revision,
              operation: t(`panel.creation.operations.${entry.operation ?? 'commit'}`, { revision: entry.restoredFrom ?? '' }),
              author: t(entry.author === 'agent' ? 'panel.creation.byAgent' : 'panel.creation.byUser'),
            })}{entry.label ? ` · ${entry.label}` : ''}
          </li>)}
        </ul>
      </>}
    </div>
  </details>;
}
