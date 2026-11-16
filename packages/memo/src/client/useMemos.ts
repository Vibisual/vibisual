import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MEMO } from '../config.js';
import type { MemoList, MemoNote } from '../types.js';
import { errorCode, MemoAPI, requestId } from './api.js';
import { MemoEditorSession } from './editorSession.js';
import type { MemoQuery } from './listView.js';

export function useMemos(project: string, initialId: string | undefined, mediaUrl?: (path: string) => string) {
  const api = useMemo(() => new MemoAPI(project, mediaUrl), [project, mediaUrl]);
  const editor = useMemo(() => new MemoEditorSession(api), [api]);
  const [, redraw] = useReducer(value => value + 1, 0);
  const [list, setList] = useState<MemoList>({ notes: [], settings: { aiEnabled: true } });
  const [query, setQuery] = useState<MemoQuery>({ view: 'recent', q: '', from: '', until: '' });
  const [loading, setLoading] = useState(!!initialId);
  const [error, setError] = useState('');
  const openSequence = useRef(0);
  const lastListing = useRef<{ api: MemoAPI; query: MemoQuery } | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    try { setList(await api.request<MemoList>('/notes', 'GET', undefined, { ...query,
      from: query.from ? new Date(`${query.from}T00:00:00`).toISOString() : '',
      until: query.until ? new Date(`${query.until}T23:59:59.999`).toISOString() : '',
    })); }
    catch (error) { setError(errorCode(error)); }
  }, [api, query]);
  useEffect(() => { editor.changed = redraw; return () => { editor.changed = () => undefined; }; }, [editor]);
  useEffect(() => {
    let active = true;
    if (initialId) void api.request<MemoNote>(`/notes/${initialId}`).then(note => { if (active) editor.reset(note); })
      .catch(error => { if (active) setError(errorCode(error)); }).finally(() => { if (active) setLoading(false); });
    else editor.draft.context = { kind: 'project', id: project, label: project.split(/[\\/]/).pop() || project, excerpt: '' };
    return () => { active = false; };
  }, [editor, api, project]);
  useEffect(() => {
    const previous = lastListing.current;
    lastListing.current = { api, query };
    if (!previous || previous.api !== api || previous.query.q === query.q) { void refresh(); return; }
    const timer = setTimeout(() => { void refresh(); }, MEMO.autosaveMs);
    return () => clearTimeout(timer);
  }, [api, query, refresh]);
  useEffect(() => {
    if (!editor.dirty || editor.error) return;
    const timer = setTimeout(() => { void editor.flush().then(ok => { if (ok) void refresh(); }); }, MEMO.autosaveMs);
    return () => clearTimeout(timer);
  }, [editor, editor.draft, editor.dirty, editor.error, refresh]);
  const open = async (id: string | null): Promise<void> => {
    const sequence = ++openSequence.current;
    setLoading(true);
    try {
      if (!await editor.flush()) return;
      const target = id ? await api.request<MemoNote>(`/notes/${id}`) : null;
      if (sequence !== openSequence.current || !await editor.flush()) return;
      editor.reset(target);
      if (!id) editor.draft.context = { kind: 'project', id: project, label: project.split(/[\\/]/).pop() || project, excerpt: '' };
      setError('');
    } catch (error) { setError(errorCode(error)); }
    finally { if (sequence === openSequence.current) setLoading(false); }
  };
  const action = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (!await editor.flush() || !editor.note) return false;
    try {
      const note = await api.request<MemoNote>(`/notes/${editor.note.id}`, 'PATCH', { ...payload, baseVersion: editor.note.version, requestId: requestId() });
      editor.reset(note); await refresh(); return true;
    } catch (error) { setError(errorCode(error)); return false; }
  };
  const duplicate = async (): Promise<boolean> => {
    if (!await editor.flush() || !editor.note) return false;
    const { title, body, tags, tasks, context, aiExcluded } = editor.draft;
    try {
      const copy = await api.request<MemoNote>('/notes', 'POST', { title, body, tags, tasks, context, pinned: false, aiExcluded, requestId: requestId() });
      editor.reset(copy); await refresh(); return true;
    } catch (error) { setError(errorCode(error)); return false; }
  };
  const changeAI = async (aiEnabled: boolean): Promise<void> => {
    try { await api.request('/settings', 'POST', { aiEnabled }); await refresh(); }
    catch (error) { setError(errorCode(error)); }
  };
  return { api, editor, list, query, setQuery, loading, error, setError, refresh, open, action, duplicate, changeAI };
}
