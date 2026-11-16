import { useEffect, useState } from 'react';
import { MEMO } from '../config.js';
import type { MemoAIJob, MemoAIStatus, MemoNote } from '../types.js';
import { errorCode, requestId } from './api.js';
import type { MemoEditorSession } from './editorSession.js';

export function useMemoAI(editor: MemoEditorSession, enabled: boolean, changed: () => Promise<void>) {
  const [jobs, setJobs] = useState<MemoAIJob[]>([]); const [status, setStatus] = useState<MemoAIStatus | null>(null);
  const [job, setJob] = useState<MemoAIJob | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const api = editor.api;
  const [provider, setProvider] = useState<'claude' | 'codex'>('codex');
  useEffect(() => {
    setJob(previous => !enabled || (editor.note?.aiExcluded && previous?.sources.some(source => source.id === editor.note?.id)) ? null : previous);
  }, [enabled, editor.note?.id, editor.note?.aiExcluded]);
  useEffect(() => {
    let active = true;
    if (!enabled) { setJob(null); setJobs([]); return; }
    setStatus(null);
    void Promise.all([api.request<MemoAIStatus>('/status', 'GET', undefined, { provider }), api.request<MemoAIJob[]>('/jobs')])
      .then(([status, jobs]) => { if (active) { setStatus(status); setJobs(jobs); } }).catch(error => { if (active) setError(errorCode(error)); });
    return () => { active = false; };
  }, [api, enabled, editor.note?.aiExcluded, provider]);
  useEffect(() => {
    if (!enabled || job?.state !== 'running') return;
    let active = true;
    const timer = setInterval(() => {
      void api.request<MemoAIJob>(`/jobs/${job.id}`).then(value => { if (active) { setJob(value); setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]); } })
        .catch(error => { if (active) { setError(errorCode(error)); if (['ai-disabled', 'ai-excluded'].includes(errorCode(error))) setJob(null); } });
    }, MEMO.pollMs);
    return () => { active = false; clearInterval(timer); };
  }, [api, enabled, job?.id, job?.state]);
  const run = async (mode: 'ask' | 'organize', ids: string[], question: string, regenerate = false): Promise<void> => {
    setBusy(true); setError('');
    try {
      if (!await editor.flush()) return;
      const targets = ids.length ? ids : editor.note ? [editor.note.id] : [];
      if (!targets.length) { setError('note-required'); return; }
      const value = await api.request<MemoAIJob>('/jobs', 'POST', { mode, ids: targets, question, requestId: requestId(), regenerate, provider });
      setJob(value); setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]); await changed();
    } catch (error) { setError(errorCode(error)); }
    finally { setBusy(false); }
  };
  const apply = async (fields: string[]): Promise<void> => {
    if (!job || !await editor.flush() || !editor.note) return;
    setBusy(true); setError('');
    try {
      const note = await api.request<MemoNote>(`/jobs/${job.id}/apply`, 'POST', { fields, baseVersion: editor.note.version, requestId: requestId() });
      editor.reset(note); await changed();
    } catch (error) { setError(errorCode(error)); } finally { setBusy(false); }
  };
  return { jobs, job, setJob, status, error, busy, run, apply, provider, setProvider };
}
