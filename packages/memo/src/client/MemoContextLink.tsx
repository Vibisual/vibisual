import type { JSX } from 'react';
import { MEMO } from '../config.js';
import type { MemoContext } from '../types.js';
import { IconLink } from './icons.js';
import { INPUT, MemoButton, type MemoText } from './ui.js';

interface MemoContextLinkProps {
  tr: MemoText; context: MemoContext | null; contexts: MemoContext[]; locked: boolean;
  change: (context: MemoContext | null) => void; open: (context: MemoContext) => void;
}
export function MemoContextLink({ tr, context, contexts, locked, change, open }: MemoContextLinkProps): JSX.Element {
  const missing = !!context && !contexts.some(item => item.id === context.id);
  return <section className="space-y-2" aria-label={tr('context')}>
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <IconLink className="h-3.5 w-3.5 shrink-0" />
      <label className="flex min-w-0 items-center gap-2">{tr('context')}
        <select className={`${INPUT} min-w-0 max-w-full py-1 text-xs`} value={context?.id ?? ''} disabled={locked} onChange={event => change(contexts.find(item => item.id === event.target.value) ?? null)}>
          <option value="">{tr('unlinked')}</option>{contexts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          {missing && <option value={context.id}>{context.label}</option>}
        </select>
      </label>
      {context && <MemoButton variant="ghost" disabled={missing} className="px-2 py-1 text-xs" onClick={() => open(context)}>{tr('returnContext')}</MemoButton>}
    </div>
    {missing && <p className="text-xs text-gray-400">{tr('contextMissing')}</p>}
    {context && <details className="text-xs text-gray-400">
      <summary className="cursor-pointer">{tr('excerpt')}</summary>
      <textarea rows={2} aria-label={tr('excerpt')} className={`${INPUT} scrollbar-thin mt-2 w-full`} value={context.excerpt} maxLength={MEMO.inputMax} disabled={locked} onChange={event => change({ ...context, excerpt: event.target.value })} />
      <p className="mt-1">{tr('excerptHint')}</p>
    </details>}
  </section>;
}
