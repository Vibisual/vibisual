import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoNote } from '../types.js';
import { MemoAPI } from './api.js';
import { relativeTime } from './listView.js';
import { memoTitle } from './ui.js';

interface MemoCanvasFaceProps {
  projectId: string; workRef?: string | undefined;
  onHeader?: ((header: { title?: string | undefined; changeKey?: string | undefined } | null) => void) | undefined;
}
export function MemoCanvasFace({ projectId, workRef, onHeader }: MemoCanvasFaceProps): JSX.Element {
  const { t, i18n } = useTranslation(); const [note, setNote] = useState<MemoNote | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const read = async (): Promise<void> => {
      if (!workRef) return;
      try {
        const value = await new MemoAPI(projectId).request<MemoNote>(`/notes/${workRef}`);
        if (active) { setNote(value); setFailed(false); onHeader?.({ title: memoTitle(value, t('memo.untitled')), changeKey: String(value.version) }); }
      } catch { if (active) setFailed(true); }
    };
    void read(); const timer = setInterval(() => { void read(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [projectId, workRef]);
  const title = note ? memoTitle(note, t('memo.untitled')) : '';
  const preview = failed ? t('memo.errors.connection-failed') : note?.body || t('memo.capturePlaceholder');
  return <div className="flex h-full min-w-0 flex-col gap-1.5 overflow-hidden bg-gray-900 p-3 text-gray-200">
    {title && !failed && <p className="truncate text-sm font-semibold text-gray-100">{title}</p>}
    <p className="line-clamp-3 min-h-0 flex-1 whitespace-pre-wrap break-words text-xs text-gray-400">{preview}</p>
    <p className="truncate text-xs text-gray-500">{note && !failed ? `${relativeTime(note.updatedAt, Date.now(), i18n?.language)} · ` : ''}{t('memo.openHint')}</p>
  </div>;
}
