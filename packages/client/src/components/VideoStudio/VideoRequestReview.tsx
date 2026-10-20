import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkVideoRequirements, resolveTimeline, videoBaseline, type VideoDoc, type VideoDocOp, type VideoRequirement, type VideoRequirementResult,
} from '@vibisual/video';
import { workspaceMediaSize } from '../../utils/workspaceMedia.js';
import { NumberField } from '../Creation/NumberField.js';
import { openWorkspaceFile } from '../IDE/useWorkspaceExplorer.js';

const KIND_KEYS: Readonly<Record<VideoRequirement['kind'], string>> = {
  'ending-text': 'endingText', 'source-revision': 'sourceRevision', visual: 'visual', 'selected-only': 'selectedOnly', preserved: 'preserved',
};
const STATUS_KEYS: Readonly<Record<VideoRequirementResult['status'], string>> = {
  passed: 'ide.verify.verdict.pass', failed: 'panel.videoStudio.requestReview.failed', unverified: 'panel.videoStudio.requestReview.unverified',
};
const reasonKey = (reason: string): string => `panel.videoStudio.requestReview.reasons.${reason.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}`;

/**
 * §5.13 (R-10) — request checks. The check runs asynchronously (one shared frame budget, yielding between slices),
 * so a long video never freezes the studio; "only the selection changed" and "keep these as they are" compare with
 * item signatures recorded when the check was added.
 */
export function VideoRequestReview({ projectRoot, doc, disabled, selectedItemId, onApply }: {
  projectRoot: string; doc: VideoDoc; disabled: boolean; selectedItemId?: string | null; onApply: (ops: readonly VideoDocOp[]) => void | Promise<boolean>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState(''); const [seconds, setSeconds] = useState(3);
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState<{ version: number; results: VideoRequirementResult[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!doc.requirements?.length) { setChecks({ version: doc.version, results: [] }); return undefined; }
    const controller = new AbortController();
    setFailed(false);
    checkVideoRequirements(doc, resolveTimeline(doc), {
      signal: controller.signal,
      frameExists: async (path) => ((await workspaceMediaSize(projectRoot, path)) ?? 0) > 0,
    }).then((results) => { if (!controller.signal.aborted) setChecks({ version: doc.version, results }); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [doc, projectRoot]);
  const addRequirement = async (requirement: VideoRequirement): Promise<boolean> => {
    if (saving || disabled) return false;
    setSaving(true);
    try { return await onApply([{ op: 'setDoc', patch: { requirements: [...(doc.requirements ?? []), requirement] } }]) !== false; }
    finally { setSaving(false); }
  };
  const stamp = Date.now().toString(36);
  const selected = selectedItemId ? doc.tracks.flatMap((track) => track.items).find((item) => item.id === selectedItemId) : undefined;
  const results = checks?.results ?? [];
  // 터치에서는 누름 자리를 키운다(서랍 안 — 폭은 서랍이 정한다).
  const button = 'rounded border border-white/20 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2';
  return <section className="space-y-2 border-t border-white/10 p-3 text-[12px] text-slate-300">
    <h3>{t('panel.videoStudio.requestReview.title')}</h3><p className="text-slate-400">{t('panel.videoStudio.requestReview.hint')}</p>
    <input value={text} onChange={event => setText(event.target.value)} onKeyDown={event => event.stopPropagation()} placeholder={t('panel.videoStudio.requestReview.text')}
      aria-label={t('panel.videoStudio.requestReview.text')} className="w-full rounded bg-vb-sunken p-2" />
    <NumberField label={t('panel.videoStudio.requestReview.seconds')} value={seconds} min={0.1} max={3600} onCommit={setSeconds}
      className="flex items-center gap-2" inputClassName="w-20 rounded bg-vb-sunken p-1 pointer-coarse:p-2" />
    <button type="button" disabled={disabled || saving || !text.trim()} className={button}
      onClick={() => { void addRequirement({ id: `text-${stamp}`, kind: 'ending-text', text, lastSeconds: seconds }).then((ok) => { if (ok) setText(''); }); }}>
      {t('panel.videoStudio.requestReview.add')}</button>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || saving || !selected} className={button} title={t('panel.videoStudio.requestReview.selectedOnlyHint')}
        onClick={() => { if (selected) void addRequirement({ id: `only-${stamp}`, kind: 'selected-only', itemIds: [selected.id], base: videoBaseline(doc) }); }}>
        {t('panel.videoStudio.requestReview.addSelectedOnly')}</button>
      <button type="button" disabled={disabled || saving || !selected} className={button} title={t('panel.videoStudio.requestReview.preservedHint')}
        onClick={() => { if (selected) void addRequirement({ id: `keep-${stamp}`, kind: 'preserved', itemIds: [selected.id], base: videoBaseline(doc, [selected.id]) }); }}>
        {t('panel.videoStudio.requestReview.addPreserved')}</button>
    </div>
    {!selected && <p className="text-slate-500">{t('panel.videoStudio.requestReview.selectFirst')}</p>}
    {failed && <p role="alert" className="text-amber-300">{t('panel.videoStudio.requestReview.checkFailed')}</p>}
    {!!doc.requirements?.length && checks?.version !== doc.version && !failed && <p role="status">{t('panel.options.account.checking')}</p>}
    {results.map(check => <div key={check.id} className="flex items-start gap-2">
      <span className="min-w-0 flex-1 break-words">
        {t(STATUS_KEYS[check.status])} · {t(`panel.videoStudio.requestReview.kinds.${KIND_KEYS[check.kind]}`)}
        {' · '}{check.evidence || t('panel.videoStudio.requestReview.noEvidence')}{check.at !== undefined ? ` · ${check.at.toFixed(2)}s` : ''}
        {check.reason && <span className="block text-slate-400">{t(reasonKey(check.reason))}</span>}
      </span>
      <button type="button" disabled={disabled} aria-label={t('panel.videoStudio.requestReview.remove')} title={t('panel.videoStudio.requestReview.remove')}
        className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-100 disabled:opacity-40 pointer-coarse:p-2"
        onClick={() => onApply([{ op: 'setDoc', patch: { requirements: doc.requirements?.filter(value => value.id !== check.id) ?? [] } }])}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>)}
    {doc.requirements?.flatMap(check => check.kind === 'visual' && check.evidence ? [<button key={check.id} type="button" onClick={() => openWorkspaceFile(projectRoot, check.evidence!.framePath)}
      className="block break-all text-left underline">{check.description} · {check.evidence.framePath}</button>] : [])}
  </section>;
}
