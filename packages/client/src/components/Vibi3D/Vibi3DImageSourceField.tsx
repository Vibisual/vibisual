import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDocSummary, Vibi3DImageSource } from '@vibisual/shared';
import { listCreationDocs } from '../Creation/creationApi.js';
import { creationErrorText } from '../Creation/creationErrors.js';

export const Vibi3DSourceProject = createContext('');
/** Recipe input only: applying it uses the same pinned texture-link path as the material panel. */
export function Vibi3DImageSourceField({ value, onChange, disabled }: {
  value?: Vibi3DImageSource; onChange: (source?: Vibi3DImageSource) => void; disabled?: boolean;
}): React.JSX.Element {
  const projectId = useContext(Vibi3DSourceProject), { t } = useTranslation();
  const tRef = useRef(t); tRef.current = t;
  const [sources, setSources] = useState<CreationDocSummary[]>([]), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    let cancelled = false; setError(''); setSources([]);
    if (projectId && requested) void listCreationDocs(projectId).then(({ docs }) => {
      if (!cancelled) setSources(docs.filter(doc => doc.appId === 'vibimage'));
    }).catch(reason => { if (!cancelled) setError(creationErrorText(tRef.current, reason)); });
    return () => { cancelled = true; };
  }, [projectId, refresh, requested]);
  const id = value?.kind === 'vibimage' ? value.docId : '';
  return <div className="min-w-0 space-y-1 text-xs">
    <label className="flex min-w-0 flex-col gap-1"><span>{t('panel.vibi3d.textureLink.title')}</span>
      <select className="w-full min-w-0 rounded border border-vb-code-border bg-vb-sunken px-1 py-1 pointer-coarse:py-2"
        value={id} disabled={disabled || !projectId} onFocus={() => setRequested(true)} onChange={event => onChange({ kind: 'vibimage', docId: event.target.value })}>
        <option value="" disabled>{t(value?.kind === 'blob' ? 'panel.vibi3d.graphics.embedded' : 'panel.vibi3d.graphics.chooseSource')}</option>
        {id && !sources.some(doc => doc.id === id) && <option value={id}>{id}</option>}
        {sources.map(doc => <option key={doc.id} value={doc.id}>{doc.title || doc.id}</option>)}
      </select>
    </label>
    <button type="button" disabled={disabled || !projectId} className="rounded border border-vb-code-border px-2 py-1 disabled:opacity-40 pointer-coarse:py-2"
      onClick={() => { setRequested(true); setRefresh(count => count + 1); }}>{t('panel.gitStatus.refresh')}</button>
    {error && <p role="alert" className="break-words text-vb-code-fg">{error}</p>}
  </div>;
}
