/**
 * §5.11 v3.88 — DetailPanel 의 치명적 3요소 섹션 (panelSection 기여).
 *
 * 배지가 "몇 개 섰나"를 말한다면 여기서는 **무엇 때문에 섰고, 무엇을 끊으면 되는지**를 말한다.
 * 표시 전용 — 이 섹션은 권한을 바꾸지 않는다(판정과 집행의 분리). 실제 변경은 Agent Settings 에서.
 */
import type { PluginPanelContext } from '../../types.js';
import { judgeTrifecta, type TrifectaLeg, type TrifectaLegState } from '../trifecta.js';

const LEG_ORDER: TrifectaLeg[] = ['data', 'untrusted', 'egress'];

const STATE_DOT: Record<TrifectaLegState, string> = {
  closed: 'bg-emerald-400',
  gated: 'bg-amber-400/60',
  open: 'bg-red-400',
};

export function TrifectaSection({ ctx }: { ctx: PluginPanelContext }): React.JSX.Element {
  const { t } = ctx;
  const verdict = judgeTrifecta(ctx.agentConfig);

  const levelClass =
    verdict.level === 'critical' ? 'text-red-300'
      : verdict.level === 'caution' ? 'text-amber-300'
        : 'text-emerald-300';

  return (
    <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('panel.plugins.lethalTrifecta.heading')}
        </span>
        <span className={`text-[11px] font-medium ${levelClass}`}>
          {t(`panel.plugins.lethalTrifecta.level.${verdict.level}`)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {LEG_ORDER.map((leg) => {
          const result = verdict.legs[leg];
          return (
            <div key={leg} className="flex items-start gap-2">
              <span className={`mt-1 block h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[result.state]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] text-gray-300">{t(`panel.plugins.lethalTrifecta.leg.${leg}`)}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">
                    {t(`panel.plugins.lethalTrifecta.state.${result.state}`)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-gray-500">
                  {result.tools.length > 0 ? result.tools.join(' · ') : t('panel.plugins.lethalTrifecta.noTool')}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 border-t border-white/[0.05] pt-2 text-[11px] leading-relaxed text-gray-400">
        {verdict.cheapestCut
          ? t('panel.plugins.lethalTrifecta.prescription')
          : t('panel.plugins.lethalTrifecta.alreadyCut')}
      </p>

      {verdict.isolated && (
        <p className="mt-1 text-[11px] leading-relaxed text-sky-300/80">{t('panel.plugins.lethalTrifecta.isolatedNote')}</p>
      )}

      <p className="mt-1 text-[10px] leading-relaxed text-gray-600">{t('panel.plugins.lethalTrifecta.displayOnly')}</p>
    </div>
  );
}
