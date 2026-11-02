import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONTEXT_SCOPE_LEVELS, CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import type { ContextScopeLevel, ContextSourceItem } from '@vibisual/shared';
import { readContextInventory, writeContextOverride } from './contextInventoryApi.js';
import { scopeStateOf } from './contextScopeView.js';
import { ScopeGlyph } from './autoGoalScope.js';

/** The goal panel edits the same overrides as the context panel and prompt gate. */
export function GoalActivationRules({ agentId, subAgentId }: { agentId: string; subAgentId: string | null | undefined }): React.JSX.Element {
  return <GoalActivationScope key={JSON.stringify([agentId, subAgentId])} agentId={agentId} subAgentId={subAgentId ?? null} />;
}

function GoalActivationScope({ agentId, subAgentId }: { agentId: string; subAgentId: string | null }): React.JSX.Element {
  const { t } = useTranslation();
  const [item, setItem] = useState<ContextSourceItem | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const writing = useRef(false);

  useEffect(() => {
    alive.current = true;
    let current = true;
    setBusy(true);
    setError(null);
    void readContextInventory(agentId, subAgentId).then((inventory) => {
      if (!current) return;
      const goal = inventory.items.find((entry) => entry.id === CONTEXT_SOURCE_IDS.goal);
      if (!goal) throw new Error('Goal context source is unavailable');
      setItem(goal);
    }).catch(() => { if (current) setError('load'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; alive.current = false; };
  }, [agentId, subAgentId, revision]);

  const set = async (scope: ContextScopeLevel, enabled: boolean | null): Promise<void> => {
    if (writing.current || busy || !item) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await writeContextOverride(agentId, subAgentId, scope, CONTEXT_SOURCE_IDS.goal, enabled);
      const inventory = await readContextInventory(agentId, subAgentId);
      const goal = inventory.items.find((entry) => entry.id === CONTEXT_SOURCE_IDS.goal);
      if (!goal) throw new Error('Goal context source is unavailable');
      if (alive.current) setItem(goal);
    } catch {
      if (alive.current) setError('save');
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section aria-label={t('ide.goal.activationRules')} className="mx-2 mb-2 rounded border border-gray-800 bg-gray-900/40 p-1">
      <div className="flex items-center gap-1 px-2 py-1">
        <h4 className="min-w-0 flex-1 text-[12px] font-semibold text-gray-400">{t('ide.goal.activationRules')}</h4>
        <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)} title={t('ide.context.refresh')} aria-label={t('ide.context.refresh')}
          className="rounded p-0.5 text-gray-500 hover:text-gray-200 disabled:opacity-40">
          <svg aria-hidden className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11.5-2L20 8M4 16l2.5 3A7 7 0 0 0 18 17" /></svg>
        </button>
      </div>
      <p className={`px-2 pb-1 text-[12px] leading-relaxed ${item?.enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
        {t(item?.enabled ? 'ide.goal.enabledHint' : 'ide.goal.disabledHint')}
      </p>
      {CONTEXT_SCOPE_LEVELS.map((scope) => {
        const own = item?.scopeOverrides?.[scope] ?? null;
        const effective = item ? scopeStateOf(item, scope) : false;
        const available = scope !== 'session' || !!subAgentId;
        return (
          <button key={scope} type="button" data-goal-scope={scope} disabled={busy || !item || !available}
            onClick={() => { void set(scope, own === null ? true : own ? false : null); }}
            title={available ? undefined : t('ide.autoGoal.scope.unavailable')}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-gray-800 disabled:cursor-default disabled:opacity-40">
            <ScopeGlyph own={own} effective={effective} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">{t(`ide.autoGoal.scope.${scope}`)}</span>
            <span className={`flex-shrink-0 text-[12px] ${own === null ? 'text-gray-600' : own ? 'text-emerald-400' : 'text-gray-500'}`}>
              {t(own === null ? 'ide.autoGoal.scope.inherited' : own ? 'ide.autoGoal.scope.on' : 'ide.autoGoal.scope.off')}
            </span>
          </button>
        );
      })}
      <p className="px-2 py-1 text-[12px] leading-relaxed text-gray-600">{t('ide.autoGoal.scope.hint')}</p>
      {error && <p role="alert" className="px-2 text-[12px] text-rose-300">{t(error === 'save' ? 'ide.context.saveError' : 'ide.context.loadError')}</p>}
    </section>
  );
}
