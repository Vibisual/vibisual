import { useState, type JSX } from 'react';
import { MEMO } from '../config.js';
import type { MemoCitation } from '../types.js';
import type { MemoEditorSession } from './editorSession.js';
import { IconSparkles } from './icons.js';
import { MemoAIResult } from './MemoAIResult.js';
import { INPUT, MemoButton, MemoSegmented, type MemoText } from './ui.js';
import { useMemoAI } from './useMemoAI.js';

interface MemoAIPanelProps { editor: MemoEditorSession; selected: string[]; enabled: boolean; tr: MemoText; changed: () => Promise<void>; source: (jobId: string, citation: MemoCitation) => void }
export function MemoAIPanel({ editor, selected, enabled, tr, changed, source }: MemoAIPanelProps): JSX.Element {
  const ai = useMemoAI(editor, enabled, changed); const [question, setQuestion] = useState('');
  const excluded = editor.draft.aiExcluded || editor.note?.deletedAt != null;
  const unavailable = !enabled || ai.busy || ai.job?.state === 'running' || ai.status?.state !== 'available';
  const canOrganize = !unavailable && !excluded && !!(editor.note || editor.draft.body);
  const canAsk = !unavailable && !!question.trim() && (!!selected.length || (!excluded && !!(editor.note || editor.draft.body)));
  const dot = !enabled ? 'bg-gray-600' : ai.status?.state === 'available' ? 'bg-emerald-400' : ai.status ? 'bg-amber-400' : 'bg-gray-600';
  return <section data-select-scope="ai" aria-label={tr('ai')} className="min-w-0 basis-80 space-y-4 border-l border-gray-800 p-4 box-compact:basis-full box-compact:border-l-0 box-compact:border-t">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100"><IconSparkles className="h-4 w-4 shrink-0 text-blue-300" />{tr('ai')}</h2>
    <MemoSegmented label={tr('provider')} value={ai.provider} disabled={ai.busy || ai.job?.state === 'running'} onChange={ai.setProvider}
      options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }]} />
    <p className="text-xs text-gray-500">{tr('aiScope')}</p>
    <p role="status" className="flex min-w-0 items-center gap-2 text-xs text-gray-300"><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} /><span className="min-w-0 truncate">{!enabled ? tr('aiOff') : ai.status ? `${ai.status.provider} · ${tr(`availability.${ai.status.state}`)}${ai.status.subscription ? ` (${ai.status.subscription})` : ''}` : tr('checkingConnection')}</span></p>
    <p className="text-xs text-gray-500">{tr('aiLimits', { max: MEMO.selectionMax, chars: MEMO.inputMax })}</p>
    {enabled && <>
      <MemoButton variant="primary" disabled={!canOrganize} onClick={() => { void ai.run('organize', [], ''); }}>{tr('organize')}</MemoButton>
      <label className="block text-xs text-gray-400">{selected.length ? tr('askSelected', { count: selected.length }) : tr('askCurrent')}
        <textarea rows={3} className={`${INPUT} scrollbar-thin mt-2 w-full`} value={question} onChange={event => setQuestion(event.target.value)} placeholder={tr('questionPlaceholder')} /></label>
      <MemoButton variant="primary" disabled={!canAsk} onClick={() => { void ai.run('ask', selected, question); }}>{tr('ask')}</MemoButton>
      {ai.error && <p role="alert" className="text-sm text-rose-300">{tr(`errors.${ai.error}`)}</p>}
      {!!ai.jobs.length && <label className="block text-xs text-gray-400">{tr('pastResults')}<select className={`${INPUT} mt-2 w-full`} value={ai.job?.id ?? ''}
        onChange={event => ai.setJob(ai.jobs.find(job => job.id === event.target.value) ?? null)}>
        <option value="">{tr('chooseResult')}</option>{ai.jobs.map(job => <option key={job.id} value={job.id}>{new Date(job.createdAt).toLocaleString()} · {tr(job.mode === 'ask' ? 'ask' : 'organize')} · {tr(`state.${job.state}`)}</option>)}
      </select></label>}
      {ai.job && <>
        <MemoAIResult key={ai.job.id} job={ai.job} noteId={editor.note?.id} version={editor.note?.version} busy={ai.busy} tr={tr}
          source={citation => source(ai.job!.id, citation)} apply={fields => { void ai.apply(fields); }} />
        {ai.job.state !== 'running' && <><p className="text-xs text-gray-400">{tr('regenerateHint')}</p><MemoButton disabled={ai.busy || ai.status?.state !== 'available'}
          onClick={() => { void ai.run(ai.job!.mode, ai.job!.sources.map(note => note.id), ai.job!.question, true); }}>{tr('regenerate')}</MemoButton></>}
      </>}
    </>}
  </section>;
}
