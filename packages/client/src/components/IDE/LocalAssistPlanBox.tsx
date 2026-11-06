import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalPlanSummary, SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { planActions, planDisplayState, type PlanAction } from './localAssistViewModel.js';

/** 상자 안에 펼쳐 보일 줄 수 — 나머지는 "+N" 한 줄로 접는다(사이드바가 체크리스트로 가득 차지 않게). */
const PLAN_LINES_SHOWN = 12;
const EMPTY_SUBS: SubAgent[] = [];

interface Props {
  agentId: string;
  subAgentId: string | null;
  /** 계획 먼저·릴레이 중 하나라도 켜졌나 — 꺼져 있고 계획도 없으면 상자를 그리지 않는다. */
  planningOn: boolean;
}

/** §5.19 (J) ④ — 그 세션 탭의 계획(서버 판정 `SubAgent.localPlan`)과 승인·이어하기·새 계획 손잡이. */
export const LocalAssistPlanBox = memo(function LocalAssistPlanBox({ agentId, subAgentId, planningOn }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const subs = useGraphStore((s) => s.subAgents[agentId]) ?? EMPTY_SUBS;
  const plan: LocalPlanSummary | undefined = subAgentId ? subs.find((su) => su.id === subAgentId)?.localPlan : undefined;
  const loop = useGraphStore((s) => (subAgentId ? s.sessionLoops[subAgentId] : undefined));
  const runAction = useGraphStore((s) => s.runLocalPlanAction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 앱을 다시 켜면 다음 턴 전까지 요약이 비어 있다 — 탭을 열 때 서버에 파일로 다시 맞추라고 한 번 묻는다.
  useEffect(() => {
    if (subAgentId) void runAction(agentId, subAgentId, 'refresh');
  }, [agentId, subAgentId, runAction]);

  const act = useCallback(async (action: PlanAction) => {
    if (!subAgentId) return;
    setBusy(true);
    const result = await runAction(agentId, subAgentId, action);
    setBusy(false);
    setError(result.ok ? null : t('ide.localAssist.plan.actionFailed', { reason: result.error ?? '' }));
  }, [agentId, subAgentId, runAction, t]);

  if (!subAgentId) {
    return planningOn ? <p className="text-[12px] leading-relaxed text-gray-500">{t('ide.localAssist.plan.noSession')}</p> : null;
  }
  if (!plan) {
    return planningOn ? <p className="text-[12px] leading-relaxed text-gray-500">{t('ide.localAssist.plan.empty')}</p> : null;
  }

  const display = planDisplayState(plan, loop);
  const pending = plan.total - plan.done;
  const actions = planActions(display, pending);
  const hidden = plan.items.length - PLAN_LINES_SHOWN;

  return (
    <div className={`flex flex-col gap-1.5 rounded border px-2 py-1.5 ${display === 'running' ? 'border-teal-500/40 bg-teal-500/5' : 'border-gray-700 bg-gray-800/60'}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {display === 'running' && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-teal-400" />}
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-gray-100">{t(`ide.localAssist.plan.state.${display}`)}</span>
        <span className="flex-shrink-0 text-[12px] text-gray-400">{t('ide.localAssist.plan.progress', { done: plan.done, total: plan.total })}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {plan.items.slice(0, PLAN_LINES_SHOWN).map((item, i) => (
          <li key={`${String(i)}-${item.text}`} className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug">
            <svg className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${item.done ? (item.skipped ? 'text-amber-400' : 'text-teal-400') : 'text-gray-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              {item.done && !item.skipped && <path d="m7 12 3.5 3.5L17 9" />}
              {item.skipped && <path d="M8 12h8" />}
            </svg>
            <span className={`min-w-0 break-words ${item.done ? 'text-gray-500 line-through decoration-gray-600' : 'text-gray-200'}`}>
              {item.text}
              {item.skipped && <span className="ml-1 text-amber-400/90 no-underline">({t('ide.localAssist.plan.skipped')})</span>}
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="text-[12px] text-gray-500">{t('ide.localAssist.plan.more', { count: hidden })}</li>}
      </ul>
      <div className="flex flex-wrap gap-1">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => { void act(action); }}
            className={`rounded px-2 py-0.5 text-[12px] font-semibold disabled:opacity-50 pointer-coarse:py-1.5 ${
              action === 'reset' ? 'border border-gray-600 text-gray-300 hover:border-gray-400' : 'bg-teal-600 text-white hover:bg-teal-500'
            }`}
          >
            {t(`ide.localAssist.plan.${action}`)}
          </button>
        ))}
      </div>
      <span className="break-all text-[12px] text-gray-600">{plan.file}</span>
      {error && <span className="text-[12px] text-rose-300">{error}</span>}
    </div>
  );
});
