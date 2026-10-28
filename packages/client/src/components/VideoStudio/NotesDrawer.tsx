import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteStatus, VideoNote } from '@vibisual/video';

import { ScrollFade } from '../ScrollFade.js';
import { shortcutLabel } from '../../utils/platform.js';
import { formatClock } from './PreviewControls.js';
import { StudioIcon } from './studioIcons.js';

/** §5.13 (V) 37-7 — 메모 서랍. 고친 메모는 [확인]으로 닫는다. 맡기기는 AI 패널에만 둔다(손잡이 둘 ❌). */
export interface NotesDrawerProps {
  readonly notes: readonly VideoNote[];
  readonly activeId: string | null;
  readonly disabled: boolean;
  readonly onSeek: (note: VideoNote) => void;
  readonly onText: (noteId: string, text: string) => void;
  readonly onStatus: (noteId: string, status: NoteStatus) => void;
  readonly onRemove: (noteId: string) => void;
}

function NoteRow({ note, active, disabled, onSeek, onText, onStatus, onRemove }: {
  readonly note: VideoNote;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onSeek: () => void;
  readonly onText: (text: string) => void;
  readonly onStatus: (status: NoteStatus) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(note.text);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(note.text); }, [note.text, editing]);
  const fixed = note.status === 'fixed';
  return (
    <li className={`flex gap-2 rounded-lg p-2 ${active ? 'bg-white/[0.06] ring-1 ring-[var(--vs-accent)]' : 'hover:bg-white/[0.04]'}`}>
      <button type="button" onClick={onSeek} title={t('panel.videoStudio.notes.seek')}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums pointer-coarse:h-9 pointer-coarse:w-9 ${fixed ? 'border-slate-200 text-slate-100' : note.status === 'closed' ? 'border-white/20 text-slate-500' : 'border-white/70 bg-black/40 text-white'}`}>
        {fixed ? <StudioIcon name="check" className="h-3.5 w-3.5" /> : note.n}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px]">
          <button type="button" onClick={onSeek} className="shrink-0 tabular-nums text-slate-400 hover:text-slate-100 pointer-coarse:py-1.5">{formatClock(note.t)}</button>
          <span className="min-w-0 truncate text-slate-500">· {t(`panel.videoStudio.notes.status_${note.status}`)}</span>
        </div>
        <textarea
          value={draft}
          rows={2}
          disabled={disabled || note.status === 'closed'}
          aria-label={t('panel.videoStudio.notes.text', { n: note.n })}
          placeholder={t('panel.videoStudio.notes.placeholder')}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft.trim() !== note.text) onText(draft.trim()); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { setDraft(note.text); e.currentTarget.blur(); } }}
          className="mt-0.5 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 hover:border-white/10 focus:border-white/15 focus:bg-vb-sunken disabled:opacity-60"
        />
        {note.reply ? <p className="mt-0.5 rounded-md border border-white/10 px-1.5 py-1 text-[12px] leading-relaxed text-slate-300">{note.reply}</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {fixed ? (
            <button type="button" disabled={disabled} onClick={() => onStatus('closed')}
              className="flex items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[12px] text-slate-100 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2">
              <StudioIcon name="check" className="h-3.5 w-3.5" />{t('panel.videoStudio.notes.confirm')}
            </button>
          ) : null}
          {note.status === 'closed' || fixed ? (
            <button type="button" disabled={disabled} onClick={() => onStatus('open')}
              className="rounded-md px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.notes.reopen')}</button>
          ) : null}
          <button type="button" disabled={disabled} onClick={onRemove}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2">
            <StudioIcon name="trash" className="h-3.5 w-3.5" />{t('common.delete')}
          </button>
        </div>
      </div>
    </li>
  );
}

export function NotesDrawer(p: NotesDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showClosed, setShowClosed] = useState(false);
  const live = [...p.notes].filter((n) => n.status !== 'closed').sort((a, b) => a.t - b.t || a.n - b.n);
  const closed = [...p.notes].filter((n) => n.status === 'closed').sort((a, b) => b.updatedAt - a.updatedAt);
  const row = (note: VideoNote): React.JSX.Element => (
    <NoteRow key={note.id} note={note} active={note.id === p.activeId} disabled={p.disabled}
      onSeek={() => p.onSeek(note)} onText={(text) => p.onText(note.id, text)} onStatus={(status) => p.onStatus(note.id, status)} onRemove={() => p.onRemove(note.id)} />
  );
  return (
    <ScrollFade fill className="flex-1">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.notes.hint', { shortcut: shortcutLabel('N') })}</p>
        {live.length > 0 ? <ol className="flex flex-col gap-1">{live.map(row)}</ol> : (
          <p className="text-[12px] text-slate-500">{t('panel.videoStudio.notes.empty')}</p>
        )}
        {closed.length > 0 ? (
          <section>
            <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)}
              className="flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-200 pointer-coarse:py-2">
              <StudioIcon name="chevronDown" className={`h-3.5 w-3.5 transition-transform duration-150 ease-out ${showClosed ? '' : '-rotate-90'}`} />
              {t('panel.videoStudio.notes.closed', { count: closed.length })}
            </button>
            {showClosed ? <ol className="mt-1 flex flex-col gap-1">{closed.map(row)}</ol> : null}
          </section>
        ) : null}
      </div>
    </ScrollFade>
  );
}
