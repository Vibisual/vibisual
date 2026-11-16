import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoClientHost } from '../host.js';
import type { MemoNote } from '../types.js';
import { errorCode, type MemoAPI } from './api.js';
import { MemoDialog } from './MemoDialog.js';
import { relativeTime } from './listView.js';
import { MemoButton, memoDate, type MemoText } from './ui.js';

interface MemoHistoryProps { api: MemoAPI; note: MemoNote; tr: MemoText; Scroll: MemoClientHost['Scroll']; close: () => void; revert: (version: number) => void }
export function MemoHistory({ api, note, tr, Scroll, close, revert }: MemoHistoryProps): JSX.Element {
  const { i18n } = useTranslation(); const now = Date.now();
  const [versions, setVersions] = useState<MemoNote[]>([]); const [before, setBefore] = useState<number | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = async (cursor?: number): Promise<void> => {
    setBusy(true);
    try {
      const page = await api.request<{ versions: MemoNote[]; before: number | null }>(`/notes/${note.id}/history`, 'GET', undefined, cursor ? { before: String(cursor) } : {});
      setVersions(previous => cursor ? [...previous, ...page.versions] : page.versions); setBefore(page.before);
    } catch (error) { setError(errorCode(error)); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [note.id]);
  return <MemoDialog title={tr('history')} closeLabel={tr('close')} close={close}>
    <p className="mb-3 text-xs text-gray-500">{tr('historyHint')}</p>
    {error && <p role="alert" className="mb-3 text-sm text-rose-300">{tr(`errors.${error}`)}</p>}
    <Scroll maxHeight={480}>
      <div className="space-y-3">{versions.map(version => <details key={version.version} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3">
        <summary className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-gray-100">{tr('version', { version: version.version })}</span>
          {version.version === note.version && <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-2 text-xs text-blue-200">{tr('currentVersion')}</span>}
          <span className="min-w-0 truncate text-xs text-gray-500" title={memoDate(version.updatedAt)}>{relativeTime(version.updatedAt, now, i18n?.language)} · {tr(version.author === 'ai' ? 'aiEdit' : 'manualEdit')}</span>
        </summary>
        <p className="my-3 whitespace-pre-wrap break-words text-sm text-gray-300">{version.title}{'\n'}{version.body}</p>
        <MemoButton disabled={busy || version.version === note.version || note.deletedAt !== null} onClick={() => revert(version.version)}>{tr('restoreVersion')}</MemoButton>
      </details>)}</div>
    </Scroll>
    {before && <MemoButton className="mt-3" disabled={busy} onClick={() => { void load(before); }}>{tr('loadMore')}</MemoButton>}
  </MemoDialog>;
}
