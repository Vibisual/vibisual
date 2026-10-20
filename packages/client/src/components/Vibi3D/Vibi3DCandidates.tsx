import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmDialog } from '../../utils/appDialog.js';
import type { CreationCandidate, CreationCandidateSummary, CreationDoc, CreationHead } from '@vibisual/shared';
import {
  cleanupCreationCandidates, discardCreationCandidate, listCreationCandidates, readCreationCandidate, rebaseCreationCandidate,
} from '../Creation/creationApi.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { mergeCandidateSummaries } from './candidatePreview.js';
import { compareModelSources } from './modelComparison.js';
import { Vibi3DCandidatePreview, type PreviewItem } from './Vibi3DCandidatePreview.js';

const CHANGE_KEYS: Readonly<Record<'added' | 'changed' | 'removed', string>> = {
  added: 'ide.reviewLane.changeType.added', changed: 'panel.options.keyboard.filterChanged', removed: 'panel.vibi3d.review.removed',
};

/**
 * §5.13 (R-10) — 3D candidate review. The list is payload-free and is read again only while the panel is open and the
 * source's candidate stamp moved; a candidate's body is read when it is chosen. Stale candidates can be moved onto the
 * current revision (rebase) when their changes do not overlap, discarded one by one or cleaned up together.
 */
export function Vibi3DCandidates({ projectId, doc, head, disabled, onAccept, onRevert }: {
  projectId: string; doc: CreationDoc; head: CreationHead | null; disabled: boolean;
  onAccept: (candidate: CreationCandidate) => Promise<void>;
  onRevert: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  // Errors read the current translator; the reads themselves do not restart when it changes identity.
  const tRef = useRef(t); tRef.current = t;
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<CreationCandidateSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [body, setBody] = useState<CreationCandidate | null>(null);
  const [after, setAfter] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const bodies = useRef(new Map<string, CreationCandidate>());
  const summary = candidates.find((item) => item.id === selected);
  const stamp = head?.id === doc.id ? `${head.candidateStamp}:${head.pendingCandidates}` : '';
  useEffect(() => { bodies.current.clear(); setCandidates([]); setSelected(''); setBody(null); setError(''); }, [projectId, doc.id]);
  useEffect(() => {
    if (!open) return undefined;
    let stopped = false;
    listCreationCandidates(projectId, doc.id)
      .then((list) => { if (!stopped) { setCandidates((previous) => mergeCandidateSummaries(previous, list.filter((item) => item.status === 'pending'))); setError(''); } })
      .catch((reason: unknown) => { if (!stopped) setError(creationErrorText(tRef.current, reason)); });
    return () => { stopped = true; };
  }, [open, projectId, doc.id, doc.revision, stamp, refresh]);
  const bodyKey = summary ? `${summary.id}@${summary.createdAt}` : '';
  useEffect(() => {
    if (!summary) { setBody(null); return undefined; }
    const cached = bodies.current.get(bodyKey);
    if (cached) { setBody(cached); return undefined; }
    let stopped = false;
    setBody(null);
    readCreationCandidate(projectId, doc.id, summary.id)
      .then((candidate) => {
        bodies.current.set(bodyKey, candidate);
        if (bodies.current.size > 8) bodies.current.delete(bodies.current.keys().next().value as string);
        if (!stopped) setBody(candidate);
      })
      .catch((reason: unknown) => { if (!stopped) setError(creationErrorText(tRef.current, reason)); });
    return () => { stopped = true; };
    // The body only changes with the candidate's id/createdAt — a poll that returns the same summary never re-reads.
  }, [bodyKey, projectId, doc.id]);
  const changes = useMemo(() => body ? compareModelSources(doc.payload, body.payload) : [], [doc.payload, body]);
  const protectedChange = changes.some((item) => item.protected);
  const stale = candidates.filter((item) => item.baseRevision !== doc.revision).length;
  const preview: PreviewItem | null = !summary ? null : after
    ? (body ? { key: `candidate:${bodyKey}`, load: () => body.payload } : null)
    : { key: `doc:${doc.id}@${doc.revision}`, load: () => doc.payload };
  const act = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(creationErrorText(tRef.current, reason)); } finally { setBusy(false); }
  };
  const reload = (): void => setRefresh((value) => value + 1);
  const button = 'rounded bg-white/10 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2';
  const isStale = !!summary && summary.baseRevision !== doc.revision;
  return <details className="shrink-0 border-t border-white/10 px-3 py-2 text-xs text-gray-300" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium pointer-coarse:py-2">{t('panel.vibi3d.review.title')} · {head?.id === doc.id ? head.pendingCandidates : candidates.length}</summary>
    <div className="mt-2 flex flex-wrap gap-2">
      <select value={selected} onChange={(event) => { setSelected(event.target.value); setAfter(true); }} className="min-w-0 flex-1 rounded bg-gray-900 p-1 pointer-coarse:p-2" aria-label={t('panel.vibi3d.review.title')}>
        <option value="">{t('panel.vibi3d.review.choose')}</option>
        {candidates.map((item) => <option key={item.id} value={item.id}>{item.label || item.id}{item.baseRevision !== doc.revision ? ` · ${t('panel.creation.staleShort')}` : ''}</option>)}
      </select>
      <button type="button" className={button} disabled={busy} onClick={reload}>{t('panel.gitStatus.refresh')}</button>
      {stale > 0 && <button type="button" className={button} disabled={busy}
        onClick={() => void act(async () => { await cleanupCreationCandidates(projectId, doc.id, 'stale'); setSelected(''); reload(); })}>{t('panel.creation.cleanupStale', { count: stale })}</button>}
      {candidates.length > 0 && <button type="button" className={button} disabled={busy}
        onClick={() => void act(async () => { if (!await confirmDialog(t('panel.creation.confirmCleanupAll'), { tone: 'danger' })) return; await cleanupCreationCandidates(projectId, doc.id, 'all'); setSelected(''); reload(); })}>
        {t('panel.creation.cleanupAll')}</button>}
    </div>
    {error && <p role="alert" className="mt-2 break-words text-amber-300">{error}</p>}
    {disabled && <p className="mt-2 text-amber-300">{t('panel.creation.saveFirst')}</p>}
    {summary && <div className="mt-2 flex flex-wrap gap-3">
      <div className="w-80 max-w-full">
        <div className="mb-1 flex gap-1">
          <button type="button" className={button} aria-pressed={!after} onClick={() => setAfter(false)}>{t('panel.vibi3d.review.before')}</button>
          <button type="button" className={button} aria-pressed={after} onClick={() => setAfter(true)}>{t('panel.vibi3d.review.after')}</button>
        </div>
        <Vibi3DCandidatePreview projectId={projectId} item={preview} inspect={{
          kind: 'review', projectId, sourceId: doc.id,
          sourceRevision: after ? summary.baseRevision : doc.revision, candidateId: after ? summary.id : null,
        }} />
      </div>
      <div className="min-w-40 flex-1 space-y-2">
        <p className="break-words">{summary.input}</p>
        <p>{t('panel.vibi3d.review.changed')}</p>
        <p className="break-words">{!body ? t('ide.explorer.loading') : changes.map((item) => `${item.name} (${t(CHANGE_KEYS[item.kind])})`).join(', ') || t('panel.vibi3d.review.none')}</p>
        {body && <p className={protectedChange ? 'text-amber-300' : 'text-emerald-300'}>{t(protectedChange ? 'panel.vibi3d.review.protectedChanged' : 'panel.vibi3d.review.protectedPreserved')}</p>}
        {isStale && <p className="text-amber-300">{t('panel.vibi3d.review.stale')}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={disabled || busy || !body || protectedChange || isStale}
            onClick={() => void act(async () => { await onAccept(body!); setSelected(''); reload(); })}>{t('panel.vibi3d.review.accept')}</button>
          {isStale && <button type="button" className={button} disabled={busy}
            onClick={() => void act(async () => { const moved = await rebaseCreationCandidate(projectId, doc, summary.id); setSelected(moved.id); reload(); })}>{t('panel.creation.rebase')}</button>}
          <button type="button" className={button} disabled={busy}
            onClick={() => void act(async () => { await discardCreationCandidate(projectId, doc.id, summary.id); setSelected(''); reload(); })}>{t('ide.verify.demo.discard')}</button>
        </div>
      </div>
    </div>}
    {doc.canUndo && <button type="button" className={`${button} mt-2`} disabled={disabled || busy}
      onClick={() => void act(async () => { await onRevert(); setSelected(''); })}>{t('panel.vibi3d.review.revert')}</button>}
  </details>;
}
