import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDoc, CreationValue } from '@vibisual/shared';
import { commitCreationDoc } from '../Creation/creationApi.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { GENERATOR_CODE_MAX, modelGeneratorCode } from './modelSource.js';

/** §5.13 (R-10) — the generator code stored with a 3D source, as editable text. It is never run: the scene is the source of truth. */
export function Vibi3DCodePanel({ projectId, doc, disabled, onDoc }: {
  projectId: string; doc: CreationDoc; disabled: boolean; onDoc: (doc: CreationDoc) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const saved = modelGeneratorCode(doc);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(saved); setError(''); }, [doc.id, doc.revision, saved]);
  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const payload = { ...(doc.payload as Record<string, CreationValue>) };
      if (draft.trim()) payload['generatorCode'] = draft.slice(0, GENERATOR_CODE_MAX); else delete payload['generatorCode'];
      onDoc(await commitCreationDoc(projectId, doc, { payload }));
    } catch (reason) { setError(creationErrorText(t, reason)); } finally { setBusy(false); }
  };
  return <details className="shrink-0 border-t border-white/10 px-3 py-2 text-xs text-gray-300">
    <summary className="cursor-pointer pointer-coarse:py-2">{t('panel.vibi3d.code.title')}</summary>
    <p className="mt-2 text-gray-400">{t('panel.vibi3d.code.hint')}</p>
    {/* 화면 높이의 30% 를 넘지 않게 — 낮은 창(가로로 든 폰)에서 코드 칸 하나가 아래 묶음을 다 차지하지 않는다. */}
    <textarea aria-label={t('panel.vibi3d.code.title')} value={draft} maxLength={GENERATOR_CODE_MAX} rows={10} spellCheck={false} disabled={disabled || busy}
      onChange={(event) => setDraft(event.target.value)}
      className="mt-2 max-h-[30dvh] w-full resize-y rounded border border-white/10 bg-gray-950 p-2 font-mono text-xs text-gray-100 disabled:opacity-50" />
    <div className="mt-2 flex items-center gap-2">
      <button type="button" className="rounded bg-white/10 px-2 py-1 disabled:opacity-40 pointer-coarse:py-2" disabled={disabled || busy || draft === saved}
        onClick={() => void save()}>{t('panel.vibi3d.code.save')}</button>
      {draft !== saved && <button type="button" className="rounded bg-white/5 px-2 py-1 pointer-coarse:py-2" disabled={busy} onClick={() => setDraft(saved)}>{t('panel.vibi3d.code.revert')}</button>}
    </div>
    {disabled && <p className="mt-2 text-amber-300">{t('panel.creation.saveFirst')}</p>}
    {error && <p role="alert" className="mt-2 break-words text-amber-300">{error}</p>}
  </details>;
}
