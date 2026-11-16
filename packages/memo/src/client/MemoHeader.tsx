import type { JSX } from 'react';
import type { MemoClientHost } from '../host.js';
import { IconPanel, IconPlus, IconSettings, IconSparkles } from './icons.js';
import { titled } from './shortcutTitle.js';
import { MemoButton, MemoIconButton, type MemoText } from './ui.js';

export type MemoSaveState = 'saving' | 'saveFailed' | 'unsaved' | 'saved' | 'ready';
const DOT: Record<MemoSaveState, string> = {
  saving: 'bg-amber-400', unsaved: 'bg-amber-400', saveFailed: 'bg-rose-400', saved: 'bg-emerald-400', ready: 'bg-emerald-400',
};
interface MemoHeaderProps {
  tr: MemoText; host: MemoClientHost; status: MemoSaveState; busy: boolean;
  libraryOpen: boolean; aiOpen: boolean;
  toggleLibrary: () => void; newNote: () => void; toggleAI: () => void; openSettings: () => void;
}
export function MemoHeader({ tr, host, status, busy, libraryOpen, aiOpen, toggleLibrary, newNote, toggleAI, openSettings }: MemoHeaderProps): JSX.Element {
  return <header className="flex h-11 shrink-0 items-center gap-1 border-b border-gray-800 px-2">
    <MemoIconButton label={titled(tr, host, tr('toggleLibrary'), 'Ctrl+\\')} pressed={libraryOpen} onClick={toggleLibrary}><IconPanel /></MemoIconButton>
    <MemoButton variant="primary" disabled={busy} title={titled(tr, host, tr('new'), 'Ctrl+Alt+N')} onClick={newNote} className="flex items-center gap-1.5 py-1.5">
      <IconPlus className="h-3.5 w-3.5 shrink-0" />{tr('new')}
    </MemoButton>
    <span role="status" aria-live="polite" title={tr('localOnly')} className="ml-2 flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status]}`} />{tr(status)}
    </span>
    <span className="flex-1" />
    <MemoButton variant="ghost" aria-pressed={aiOpen} disabled={busy} onClick={toggleAI}
      className={`flex items-center gap-1.5 py-1.5 ${aiOpen ? 'bg-blue-500/15 text-blue-300' : ''}`}>
      <IconSparkles className="h-3.5 w-3.5 shrink-0" /><span className="box-narrow:sr-only">{tr('ai')}</span>
    </MemoButton>
    <MemoIconButton label={tr('settings')} onClick={openSettings}><IconSettings /></MemoIconButton>
  </header>;
}
