import { useState, type JSX } from 'react';
import { MEMO } from '../config.js';
import type { MemoTask } from '../types.js';
import { IconCheck, IconPlus, IconX } from './icons.js';
import { taskProgress } from './listView.js';
import { FIELD, MemoIconButton, type MemoText } from './ui.js';

interface MemoTasksProps { tr: MemoText; tasks: MemoTask[]; locked: boolean; change: (tasks: MemoTask[]) => void }
export function MemoTasks({ tr, tasks, locked, change }: MemoTasksProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const { done, total } = taskProgress(tasks);
  const update = (id: string, patch: Partial<MemoTask>): void => change(tasks.map(item => item.id === id ? { ...item, ...patch } : item));
  return <section className="space-y-2" aria-label={tr('tasks')}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-xs font-semibold text-gray-400">{tr('tasks')}</h2>
      {total > 0 && <>
        <span className="text-xs text-gray-500">{tr('taskProgress', { done, total })}</span>
        <progress max={total} value={done} className="h-1 w-24 appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-blue-400 [&::-webkit-progress-bar]:bg-gray-800 [&::-webkit-progress-value]:bg-blue-400" />
      </>}
    </div>
    {tasks.map(item => <div key={item.id} className="group flex items-center gap-2">
      <button type="button" role="checkbox" aria-checked={item.checked} aria-label={item.text} disabled={locked} onClick={() => update(item.id, { checked: !item.checked })}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50 ${item.checked ? 'border-blue-500 bg-blue-500' : 'border-gray-600'}`}>
        {item.checked && <IconCheck className="h-3 w-3 shrink-0" />}
      </button>
      <input className={`${FIELD} flex-1 ${item.checked ? 'text-gray-500 line-through' : ''}`} aria-label={tr('taskItem')} value={item.text} maxLength={MEMO.questionMax} disabled={locked}
        onChange={event => update(item.id, { text: event.target.value })} />
      <MemoIconButton label={tr('removeTask')} disabled={locked} onClick={() => change(tasks.filter(existing => existing.id !== item.id))}
        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"><IconX className="h-3.5 w-3.5 shrink-0" /></MemoIconButton>
    </div>)}
    <form className="flex items-center gap-2" onSubmit={event => {
      event.preventDefault();
      if (!draft.trim() || locked || tasks.length >= MEMO.taskMax) return;
      change([...tasks, { id: `task-${crypto.randomUUID()}`, text: draft.trim(), checked: false }]); setDraft('');
    }}>
      <IconPlus className="h-4 w-4 shrink-0 text-gray-500" />
      <input className={`${FIELD} flex-1`} aria-label={tr('addTask')} placeholder={tr('addTask')} value={draft} maxLength={MEMO.questionMax} disabled={locked || tasks.length >= MEMO.taskMax} onChange={event => setDraft(event.target.value)} />
    </form>
  </section>;
}
