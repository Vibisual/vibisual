import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDoc, CreationDocSummary } from '@vibisual/shared';
import type { VideoDoc, VideoDocOp } from '@vibisual/video';
import { keepCreationLink, readCreationMirror } from '../Creation/creationApi.js';
import { buildAssetItemOps } from './videoEditor.js';
import { importVideoSource, listVideoSources } from './videoSourcesApi.js';
import { applySourceRevisionOps, sourceConsumers } from './videoSourceLinks.js';
import { mediaKindKey } from './kindLabels.js';

export interface VideoSourcesDrawerProps {
  project: string; doc: VideoDoc; playhead: number; disabled: boolean;
  /** §5.13 (Y) 40-5 ① — 들이는 순간의 시각(재생 중에도 정확하게). 없으면 `playhead`. */
  readPlayhead?: () => number;
  onApply: (ops: readonly VideoDocOp[]) => void | Promise<boolean>;
  onError: (error: unknown) => void;
  pendingWork?: MutableRefObject<number>;
}

/**
 * Pinned revisions are the default; opening or refreshing never changes a scene. A newer revision is applied to chosen scenes or kept —
 * "keep" is recorded on the source index (mirror document) and folds the notice until the source changes (§5.13 (R-10)).
 */
export function VideoSourcesDrawer(p: VideoSourcesDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [sources, setSources] = useState<CreationDocSummary[]>([]);
  const [mirror, setMirror] = useState<CreationDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const latest = useRef(p); latest.current = p;
  const key = `${p.project}:${p.doc.id}`;
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const status = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(p.doc.id)}/source-status?project=${encodeURIComponent(p.project)}`)
        .then(r => r.json()) as { ok: boolean };
      const [docs, index] = await Promise.all([listVideoSources(p.project), readCreationMirror(p.project, 'vibistudio', p.doc.id).catch(() => null)]);
      if (`${latest.current.project}:${latest.current.doc.id}` !== key) return;
      setFailed(!status.ok); setSources(docs); setMirror(index);
    } catch (error) { latest.current.onError(error); }
    finally { setBusy(false); }
  }, [p.project, p.doc.id, key]);
  useEffect(() => { setSources([]); setMirror(null); setSelected({}); void refresh(); }, [refresh]);
  const run = async (source: CreationDocSummary, previous?: string): Promise<void> => {
    if (busy || p.disabled) return;
    const version = p.doc.version;
    if (p.pendingWork) p.pendingWork.current += 1;
    setBusy(true);
    try {
      const asset = await importVideoSource(p.project, source.id, source.revision);
      if (`${latest.current.project}:${latest.current.doc.id}` !== key || latest.current.doc.version !== version) throw new Error(t('panel.videoStudio.sources.changed'));
      const chosen = previous ? sourceConsumers(p.doc, previous).filter(item => selected[`${previous}:${item.id}`]).map(item => item.id) : [];
      const ops = previous ? applySourceRevisionOps(p.doc, previous, asset, chosen) : buildAssetItemOps(p.doc, asset, p.readPlayhead?.() ?? p.playhead, source.title);
      if (await p.onApply(ops) !== false) setSelected({});
    } catch (error) { p.onError(error); }
    finally { if (p.pendingWork) p.pendingWork.current -= 1; setBusy(false); }
  };
  /** Records (or withdraws) "keep the current revision" for one linked asset on the video's source index. */
  const keep = async (assetId: string, revision: number | null): Promise<void> => {
    if (busy || !mirror) return;
    setBusy(true);
    try { setMirror(await keepCreationLink(p.project, mirror.id, assetId, revision)); }
    catch (error) { p.onError(error); }
    finally { setBusy(false); }
  };
  const linked = Object.values(p.doc.assets).filter(asset => asset.creationSource && sourceConsumers(p.doc, asset.id).length > 0);
  // 터치에서는 누름 자리를 키운다(서랍 안 — 폭은 서랍이 정한다).
  const button = 'rounded border border-white/20 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2';
  return <section className="space-y-2 border-t border-white/10 p-3 text-[12px] text-slate-300">
    <div className="flex items-center justify-between gap-2"><h3 className="min-w-0">{t('panel.videoStudio.sources.title')}</h3>
      <button type="button" disabled={busy} onClick={() => { void refresh(); }} className="shrink-0 rounded border border-white/15 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2">{t('panel.gitStatus.refresh')}</button></div>
    <p className="text-slate-400">{t('panel.videoStudio.sources.hint')}</p>
    {failed && <p role="alert" className="text-amber-300">{t('panel.videoStudio.sources.syncFailed')}</p>}
    {busy && <p role="status">{t('panel.videoStudio.sources.loading')}</p>}
    {sources.length === 0 && !busy && <p>{t('panel.videoStudio.sources.empty')}</p>}
    {sources.map(source => <button key={source.id} type="button" disabled={busy || p.disabled} onClick={() => { void run(source); }}
      className="block w-full rounded border border-white/10 p-2 text-left hover:bg-white/5 disabled:opacity-40">
      {source.title} · {t(mediaKindKey(source.appId === 'vibi3d' ? 'model' : 'image'))}
      {' · '}{t('panel.creation.version', { revision: source.revision })}<span className="ml-2">{t('canvas.spec.add')}</span></button>)}
    {linked.map(asset => {
      const ref = asset.creationSource!;
      const source = sources.find(item => item.id === ref.id);
      const consumers = sourceConsumers(p.doc, asset.id);
      const link = mirror?.links.find(item => item.id === asset.id);
      const outdated = !!source && source.revision > ref.revision;
      const kept = outdated && (link?.keptRevision ?? 0) >= source.revision;
      return <div key={asset.id} className="space-y-1 rounded border border-white/10 p-2">
        <p>{source?.title ?? ref.id} · {t('panel.creation.version', { revision: ref.revision })}</p>
        {outdated && kept && <>
          <p className="text-slate-400">{t('panel.creation.kept', { revision: ref.revision, seen: link?.keptRevision ?? source.revision })}</p>
          <button type="button" disabled={busy || !mirror} onClick={() => { void keep(asset.id, null); }} className={button}>{t('panel.creation.unkeep')}</button>
        </>}
        {outdated && !kept && <>
          <p className="text-amber-300">{t('panel.videoStudio.sources.available', { revision: source.revision })}</p>
          {consumers.map(item => <label key={item.id} className="flex items-center gap-2 pointer-coarse:min-h-9">
            <input type="checkbox" className="shrink-0 pointer-coarse:h-5 pointer-coarse:w-5" disabled={busy || p.disabled} checked={selected[`${asset.id}:${item.id}`] ?? false}
              onChange={e => setSelected(value => ({ ...value, [`${asset.id}:${item.id}`]: e.target.checked }))} />
            {item.label}{item.chapterId ? ` · ${p.doc.chapters?.find(chapter => chapter.id === item.chapterId)?.title ?? item.chapterId}` : ''}
          </label>)}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || p.disabled || !consumers.some(item => selected[`${asset.id}:${item.id}`])} onClick={() => { void run(source, asset.id); }}
              className={button}>{t('panel.videoStudio.sources.update')}</button>
            <button type="button" disabled={busy || !mirror} onClick={() => { void keep(asset.id, source.revision); }} className={button}>{t('panel.creation.keep')}</button>
          </div>
          <p className="text-slate-400">{t('panel.videoStudio.sources.keep')}</p>
        </>}
        {!outdated && <p className="text-slate-400">{consumers.map(item => item.label).join(' · ')}</p>}
      </div>;
    })}
  </section>;
}
