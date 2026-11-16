import type { JSX } from 'react';
import type { MemoClientHost } from '../host.js';
import { MemoDialog } from './MemoDialog.js';
import { IconDownload, IconLock } from './icons.js';
import { MemoButton, MemoSwitch, type MemoText } from './ui.js';

interface MemoSettingsProps {
  tr: MemoText; host: MemoClientHost; aiEnabled: boolean; busy: boolean;
  changeAI: (enabled: boolean) => void; exportAll: () => void; close: () => void;
}
export function MemoSettings({ tr, host, aiEnabled, busy, changeAI, exportAll, close }: MemoSettingsProps): JSX.Element {
  const rows: [string, string][] = [
    [tr('new'), 'Ctrl+Alt+N'], [tr('searchMemos'), 'Ctrl+F'], [tr('toggleLibrary'), 'Ctrl+\\'],
    [tr('saveNow'), 'Ctrl+S'],
    [tr('toggleCheck'), 'Ctrl+Enter'], [tr('format.link'), 'Ctrl+K'], [tr('moveLineUp'), 'Alt+Up'], [tr('moveLineDown'), 'Alt+Down'],
  ];
  return <MemoDialog title={tr('settings')} closeLabel={tr('close')} close={close}>
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-sm text-gray-300"><IconLock className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />{tr('localOnly')}</p>
      <MemoSwitch checked={aiEnabled} onChange={changeAI} label={tr('enableAI')} />
      <MemoButton disabled={busy} onClick={exportAll} className="flex items-center gap-1.5"><IconDownload className="h-3.5 w-3.5 shrink-0" />{tr('export')}</MemoButton>
      <p className="text-xs text-gray-500">{tr('exportHint')}</p>
      {host.shortcutLabel && <section className="space-y-2" aria-label={tr('shortcuts')}>
        <h3 className="text-xs font-semibold text-gray-400">{tr('shortcuts')}</h3>
        <dl className="space-y-1 text-sm">{rows.map(([label, combo]) => <div key={combo} className="flex items-center justify-between gap-3">
          <dt className="min-w-0 truncate text-gray-300">{label}</dt>
          <dd><kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-200">{host.shortcutLabel?.(combo)}</kbd></dd>
        </div>)}</dl>
      </section>}
      <p className="text-xs text-gray-500">{tr('writingHint')}</p>
      <p className="text-xs text-gray-500">{tr('slashHint')}</p>
    </div>
  </MemoDialog>;
}
