import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDocSummary } from '@vibisual/shared';
import { listCreationDocs, readCreationDoc } from '../Creation/creationApi.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { isImageDocument, type ImageDocument } from '../Creation/imageSource.js';
import type { ImageSourceDoc } from './imageApi.js';
import { addLinkedImage } from './imageSources.js';
import { imageLabelKey } from './imageLabels.js';
import { creationAppLabel } from '../Creation/creationAppLabels.js';

interface ImageSourcesProps {
  root: string; doc: ImageSourceDoc | null; disabled: boolean; styleDisabled: boolean;
  onDoc: (doc: ImageSourceDoc) => void;
  /** Take another image source's project style; `toLayers` also restyles the existing (unlocked) layers. */
  onStyle: (style: ImageDocument['style'], toLayers: boolean) => void;
}
export function ImageSourcePicker({ root, doc, disabled, styleDisabled, onDoc, onStyle }: ImageSourcesProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const [sources, setSources] = useState<CreationDocSummary[]>([]); const [chosen, setChosen] = useState('');
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const scope = useRef({ root, id: doc?.id }); scope.current = { root, id: doc?.id };
  useEffect(() => { setBusy(false); setError(''); }, [root, doc?.id]);
  useEffect(() => {
    let cancelled = false;
    // Payload-free summaries: the picker needs titles and revisions only.
    void listCreationDocs(root).then(({ docs }) => {
      if (!cancelled) setSources(docs.filter((item) => item.id !== doc?.id && (item.appId === 'vibimage' || item.appId === 'vibi3d')));
    }).catch((failure: unknown) => { if (!cancelled) setError(creationErrorText(t, failure)); });
    return () => { cancelled = true; };
  }, [root, doc?.id, refresh, t]);
  const source = sources.find((item) => item.id === chosen) ?? sources[0];
  const current = (id: string | undefined): boolean => scope.current.root === root && scope.current.id === id;
  const takeStyle = (toLayers: boolean): void => {
    if (!source) return;
    const id = doc?.id; setBusy(true); setError('');
    void readCreationDoc(root, source.id).then((full) => {
      if (current(id) && isImageDocument(full.payload)) onStyle({ ...full.payload.style }, toLayers);
    }).catch((failure: unknown) => { if (current(id)) setError(creationErrorText(t, failure)); }).finally(() => { if (current(id)) setBusy(false); });
  };
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
    <select className="min-w-0 max-w-52 rounded bg-gray-900 p-1.5 pointer-coarse:p-2" aria-label={key('source')} value={source?.id ?? ''} onChange={(e) => setChosen(e.target.value)}>
      {!sources.length && <option value="">{key('source')}</option>}
      {sources.map((item) => <option value={item.id} key={item.id}>
        {t('panel.creation.sourceOption', { title: item.title || item.id, app: creationAppLabel(t, item.appId), revision: item.revision })}
      </option>)}
    </select>
    <button type="button" className="rounded bg-white/5 p-1.5 pointer-coarse:p-2" onClick={() => setRefresh((n) => n + 1)}>{key('sourceRefresh')}</button>
    <button type="button" className="rounded bg-white/5 p-1.5 disabled:opacity-35 pointer-coarse:p-2" disabled={disabled || busy || !doc || !source} onClick={() => {
      if (!doc || !source) return; setBusy(true); setError('');
      void addLinkedImage(root, doc, source).then((next) => { if (current(doc.id)) onDoc(next); })
        .catch((failure: unknown) => { if (current(doc.id)) setError(creationErrorText(t, failure)); }).finally(() => { if (current(doc.id)) setBusy(false); });
    }}>{key(busy ? 'working' : 'importSource')}</button>
    {source?.appId === 'vibimage' && <>
      <button type="button" className="rounded bg-white/5 p-1.5 disabled:opacity-35 pointer-coarse:p-2" disabled={styleDisabled || busy} onClick={() => takeStyle(false)}>{key('useSourceStyle')}</button>
      <button type="button" className="rounded bg-white/5 p-1.5 disabled:opacity-35 pointer-coarse:p-2" disabled={styleDisabled || busy} onClick={() => takeStyle(true)}>{key('useSourceStyleLayers')}</button>
    </>}
    {error && <span role="alert" className="min-w-0 break-words text-amber-200">{error}</span>}
  </div>;
}
