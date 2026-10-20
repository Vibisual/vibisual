import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDocSummary } from '@vibisual/shared';
import { listCreationDocs } from '../Creation/creationApi.js';
import { creationAppLabel } from '../Creation/creationAppLabels.js';
import { creationErrorText } from '../Creation/creationErrors.js';

interface Props { projectId: string; selectedName: string; disabled: boolean; onApply: (sourceId: string) => Promise<void>; }
/** Image sources a 3D object can wear as a texture. The list is payload-free and read only while the panel is open. */
export function Vibi3DImageSources({ projectId, selectedName, disabled, onApply }: Props): React.JSX.Element {
  const { t } = useTranslation();
  // Errors read the current translator; the reads themselves do not restart when it changes identity.
  const tRef = useRef(t); tRef.current = t;
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<CreationDocSummary[]>([]); const [selected, setSelected] = useState('');
  const [refresh, setRefresh] = useState(0); const [failed, setFailed] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    let stopped = false; setFailed('');
    listCreationDocs(projectId)
      .then(({ docs }) => { if (!stopped) setSources(docs.filter((source) => source.appId === 'vibimage')); })
      .catch((error: unknown) => { if (!stopped) setFailed(creationErrorText(tRef.current, error)); });
    return () => { stopped = true; };
  }, [open, projectId, refresh]);
  const source = sources.find((item) => item.id === selected) ?? sources[0];
  return <details className="shrink-0 border-t border-white/10 px-3 py-2 text-xs text-gray-300" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer pointer-coarse:py-2">{t('panel.vibi3d.textureLink.title')}</summary>
    <p className="mt-2 break-words">{selectedName || t('panel.vibi3d.textureLink.selectObject')}</p>
    {disabled && <p className="mt-1 text-amber-300">{t('panel.creation.saveFirst')}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <select className="min-w-0 max-w-64 rounded bg-gray-900 px-2 py-1 pointer-coarse:py-2" aria-label={t('panel.vibi3d.textureLink.title')} value={source?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
        {!sources.length && <option value="">{t('panel.vibi3d.textureLink.empty')}</option>}
        {sources.map((item) => <option key={item.id} value={item.id}>{t('panel.creation.sourceOption', { title: item.title || item.id, app: creationAppLabel(t, item.appId), revision: item.revision })}</option>)}
      </select>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className="rounded bg-white/10 px-2 py-1 pointer-coarse:py-2">{t('panel.gitStatus.refresh')}</button>
      <button type="button" disabled={disabled || busy || !selectedName || !source} className="rounded bg-violet-500/25 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2" onClick={() => {
        if (!source) return; setBusy(true); setFailed('');
        void onApply(source.id).catch((error: unknown) => setFailed(creationErrorText(tRef.current, error))).finally(() => setBusy(false));
      }}>{t('panel.vibi3d.textureLink.apply')}</button>
    </div>
    {failed && <p role="alert" className="mt-2 break-words text-amber-300">{failed}</p>}
  </details>;
}
