import { useState, type JSX } from 'react';
import type { MemoAIJob, MemoCitation } from '../types.js';
import { MemoButton, memoDate, memoTitle, type MemoText } from './ui.js';

interface MemoAIResultProps {
  job: MemoAIJob; noteId: string | undefined; version: number | undefined; busy: boolean; tr: MemoText;
  source: (citation: MemoCitation) => void; apply: (fields: string[]) => void;
}
const CHIP = 'rounded-full border border-gray-700 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';
export function MemoAIResult({ job, noteId, version, busy, tr, source, apply }: MemoAIResultProps): JSX.Element {
  const [fields, setFields] = useState(['title', 'body', 'tags', 'tasks']);
  const result = job.result;
  const changed = job.mode === 'organize' && (job.sources[0]?.version !== version || job.sources[0]?.id !== noteId);
  return <section className="space-y-3 border-t border-gray-800 pt-3" aria-label={tr('result')}>
    <div className="flex flex-wrap items-center gap-2"><strong className={`rounded-full border px-2 py-0.5 text-xs font-medium ${job.state === 'failed' ? 'border-rose-500/30 bg-rose-500/15 text-rose-200' : 'border-gray-700 bg-gray-800 text-gray-200'}`}>{tr(`state.${job.state}`)}</strong><span className="text-xs text-gray-500">{memoDate(job.createdAt)}</span></div>
    {job.error && <p role="alert" className="text-sm text-rose-300">{tr(`errors.${job.error}`)}</p>}
    {job.sources.map(note => <p key={note.id} className="break-words text-xs text-gray-400">{memoTitle(note, tr('untitled'))} · {tr('version', { version: note.version })} · {memoDate(note.updatedAt)}</p>)}
    {result && <>
      {result.title && <h3 className="break-words text-sm font-semibold">{result.title}</h3>}
      {result.claims.map((claim, index) => <div key={index} className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
        <p className="text-xs font-semibold text-gray-500">{tr(`kind.${claim.kind}`)}</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{claim.kind === 'unknown' ? tr('insufficient') : claim.text}</p>
        <div className="flex flex-wrap gap-1">{claim.citations.map((citation, citationIndex) => <button key={citationIndex} type="button" onClick={() => source(citation)} className={CHIP}>{tr('source')} {citationIndex + 1}</button>)}</div>
      </div>)}
      {!!result.tags.length && <p className="text-sm">{tr('tags')}: {result.tags.join(', ')}</p>}
      {result.tasks.map((task, index) => <div key={index} className="flex flex-wrap items-start gap-2 text-sm"><span>{task.text}</span><button type="button" onClick={() => source(task.citation)} className={CHIP}>{tr('source')}</button></div>)}
      {job.mode === 'organize' && <div className="space-y-3">
        <p className="text-xs text-gray-500">{tr(changed ? 'sourceChanged' : 'applyHint')}</p>
        <div className="flex flex-wrap gap-3">{['title', 'body', 'tags', 'tasks'].map(field => <label key={field} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={fields.includes(field)}
          onChange={event => setFields(previous => event.target.checked ? [...previous, field] : previous.filter(value => value !== field))} />{tr(field)}</label>)}</div>
        <MemoButton variant="primary" disabled={busy || changed || !fields.length} onClick={() => apply(fields)}>{tr('apply')}</MemoButton>
      </div>}
      {job.usage && <details className="text-xs text-gray-500"><summary>{tr('usage')}</summary><pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(job.usage, null, 2)}</pre></details>}
    </>}
  </section>;
}
