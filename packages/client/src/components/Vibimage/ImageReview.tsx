import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationCandidateSummary } from '@vibisual/shared';
import { creationErrorText } from '../Creation/creationErrors.js';
import { readImageRevision, type ImageCandidate, type ImageSourceDoc } from './imageApi.js';
import { imageReviewChecks } from './imageReviewChecks.js';
import { ImageStage } from './ImageStage.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageReviewProps {
  root: string;
  source: ImageSourceDoc;
  summary: CreationCandidateSummary;
  readCandidate: (id: string) => Promise<ImageCandidate>;
  /** Unsaved edits or a busy editor. */
  disabled: boolean;
  onAccept: () => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
  onRebase: () => Promise<string | null>;
  onClose: () => void;
}
export function ImageReview({ root, source, summary, readCandidate, disabled, onAccept, onDiscard, onRebase, onClose }: ImageReviewProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  // A newly selected proposal must never inherit the previous proposal's picture or accept checks, even
  // during the render before its effect runs. Include the source revision so changed sources reload together.
  const request = useMemo(() => ({ root, sourceId: source.id, sourceRevision: source.revision, candidateId: summary.id, baseRevision: summary.baseRevision }),
    [root, source.id, source.revision, summary.id, summary.baseRevision]);
  const active = useRef(request); active.current = request;
  const mounted = useRef(true);
  const action = useRef<object | null>(null);
  const [loaded, setLoaded] = useState<{
    request: object; base: ImageSourceDoc | null; candidate: ImageCandidate | null; failed: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState<object | null>(null);
  const [workingRequest, setWorkingRequest] = useState<object | null>(null);
  const current = loaded?.request === request ? loaded : null;
  const base = current?.base ?? null; const candidate = current?.candidate ?? null;
  const failed = current?.failed ?? ''; const confirming = confirmed === request;
  const working = workingRequest === request;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setLoaded(null); setConfirmed(null);
    // Load the immutable base and proposal as one pair; neither half may belong to the previous selection.
    void Promise.all([
      source.revision === summary.baseRevision ? Promise.resolve(source) : readImageRevision(root, source.id, summary.baseRevision),
      readCandidate(summary.id),
    ]).then(([baseDoc, body]) => {
      if (cancelled) return;
      if (body.id !== summary.id || body.baseRevision !== summary.baseRevision || body.status !== 'pending') throw new Error('candidate-conflict');
      if (baseDoc.id !== source.id || baseDoc.revision !== summary.baseRevision) throw new Error('revision-not-found');
      setLoaded({ request, base: baseDoc, candidate: body, failed: '' });
    }).catch((error: unknown) => {
      if (!cancelled) setLoaded({ request, base: null, candidate: null, failed: creationErrorText(t, error) });
    });
    return () => { cancelled = true; };
  }, [root, source, summary.id, summary.baseRevision, readCandidate, request, t]);
  const stale = summary.baseRevision !== source.revision;
  const checks = base && candidate ? imageReviewChecks(base, candidate) : null;
  const names = checks?.changed.map((id) => {
    const name = candidate?.payload.layers.find((layer) => layer.id === id)?.name ?? base?.payload.layers.find((layer) => layer.id === id)?.name ?? id;
    return `${name} (${id})`;
  });
  const act = async (run: () => Promise<unknown>): Promise<void> => {
    if (action.current === request) return;
    action.current = request; setWorkingRequest(request);
    try { await run(); } finally {
      if (action.current === request) action.current = null;
      if (mounted.current && active.current === request) setWorkingRequest(null);
    }
  };
  const closeCurrent = (): void => { if (mounted.current && active.current === request) onClose(); };
  const accept = (): void => {
    if (disabled || stale || working || !checks || checks.blocked) return;
    if (checks.needsConfirmation && !confirming) { setConfirmed(request); return; }
    // The review closes only when the candidate actually became the source; a failure keeps it open with the reason.
    void act(async () => { if (await onAccept()) closeCurrent(); });
  };
  const button = 'rounded px-3 py-1.5 disabled:opacity-35 pointer-coarse:py-2';
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 p-3 text-xs">
      <span className="min-w-0 break-words">{summary.label}</span><span>{t('panel.apps.vibimage.editor.changed', { count: checks?.changed.length ?? 0 })}</span>
      <button type="button" className={`${button} bg-amber-200/20`} disabled={disabled || stale || working || !checks || checks.blocked} onClick={accept}>
        {key(confirming ? 'acceptAnyway' : 'accept')}
      </button>
      {stale && <button type="button" className={`${button} bg-indigo-500/20`} disabled={disabled || working}
        onClick={() => void act(async () => { await onRebase(); })}>{key('rebase')}</button>}
      <button type="button" className={`${button} bg-white/5`} disabled={working} onClick={() => void act(async () => { if (await onDiscard()) closeCurrent(); })}>{key('discard')}</button>
      <button type="button" className={`${button} bg-white/5`} onClick={onClose}>{key('back')}</button>
      {stale && <span className="text-amber-200">{key('staleCandidate')}</span>}
    </div>
    {checks && <div className="shrink-0 border-b border-white/10 px-3 py-2 text-xs">
      <p className="max-h-20 overflow-y-auto break-all">{names?.join(', ') || key('noLayerChanges')}</p>
      <p className={checks.blocked ? 'text-amber-200' : 'text-emerald-200'}>
        {key(checks.protectedChanged ? 'protectedChanged' : 'protectedPreserved')}
        {checks.selectionCheck === 'checked' && ` · ${key(checks.selectedOnly ? 'selectionPreserved' : 'selectionExceeded')}`}
      </p>
      {checks.selectionCheck === 'unknown' && <p role="alert" className="text-amber-200">{key('selectionUnknown')}</p>}
      {confirming && <p role="alert" className="text-amber-200">{key('confirmUnchecked')}</p>}
      {checks.canvasChanged && <p>{key('canvasChanged')}</p>}
    </div>}
    {/* 원본·제안 두 무대는 나란히 — 폰 폭(box-narrow)에서는 위아래로 쌓고, 둘 다 무대 하한을 못 지키는 낮은 창이면 이 칸이 스크롤한다. */}
    {base && candidate ? <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 box-narrow:grid-cols-1 box-narrow:grid-rows-[repeat(2,minmax(12rem,1fr))] box-narrow:overflow-y-auto">
      <div className="flex min-h-0 min-w-0 flex-col">
        <p className="shrink-0 px-3 py-1 text-xs text-gray-400">{key('source')}</p>
        <ImageStage root={root} doc={base.payload} inspect={{ projectId: root, source: { id: base.id, revision: base.revision, title: base.title }, unsaved: false }} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <p className="shrink-0 px-3 py-1 text-xs text-gray-400">{key('compare')} · {summary.label}</p>
        <ImageStage root={root} doc={candidate.payload} inspect={{
          projectId: root, source: { id: source.id, revision: source.revision, title: source.title }, unsaved: false,
          proposal: { id: summary.id, baseRevision: summary.baseRevision },
        }} />
      </div>
    </div>
      : <p role={failed ? 'alert' : 'status'} className="p-3 text-xs">{failed || key('working')}</p>}
    <p className="shrink-0 px-3 py-2 text-xs text-gray-400">{key('visualReview')}</p>
  </div>;
}
