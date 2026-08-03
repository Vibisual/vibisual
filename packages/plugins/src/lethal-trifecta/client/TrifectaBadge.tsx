/**
 * §5.11 v3.88 — 에이전트 버블의 치명적 3요소 배지 (bubbleBadge 기여).
 *
 * 세 칸이 ⓐ데이터 · ⓑ미신뢰 콘텐츠 · ⓒ외부 통신 순서로 고정된다. 칸이 비면(회색) 그 다리가 끊긴 것이고,
 * 유출 경로 자체가 성립하지 않는다. **경고색은 셋 다 무확인으로 열렸을 때만** — 상시 점등은 신호를 죽인다.
 *
 * 격리(worktree)는 판정에 섞지 않고 방패 글리프로 따로 보여준다(사용자 결정 v3.88).
 */
import type { PluginBubbleContext } from '../../types.js';
import { judgeTrifecta, type TrifectaLegState, type TrifectaLevel } from '../trifecta.js';

const SEGMENT_CLASS: Record<TrifectaLegState, Record<TrifectaLevel, string>> = {
  closed: { safe: 'bg-white/15', caution: 'bg-white/15', critical: 'bg-white/15' },
  gated:  { safe: 'bg-amber-400/40', caution: 'bg-amber-400/50', critical: 'bg-amber-400/50' },
  open:   { safe: 'bg-gray-300/70', caution: 'bg-amber-400', critical: 'bg-red-400' },
};

export function TrifectaBadge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const verdict = judgeTrifecta(ctx.agentConfig);
  const legs: TrifectaLegState[] = [
    verdict.legs.data.state,
    verdict.legs.untrusted.state,
    verdict.legs.egress.state,
  ];

  const title = t(`panel.plugins.lethalTrifecta.title.${verdict.level}`, { count: verdict.count });
  const ring = verdict.level === 'critical' ? 'ring-red-400/60' : 'ring-white/15';

  return (
    <span
      className={`pointer-events-auto flex items-center gap-[3px] rounded-full bg-gray-950/85 px-1.5 py-[3px] ring-1 ${ring}`}
      title={verdict.isolated ? `${title} · ${t('panel.plugins.lethalTrifecta.isolated')}` : title}
    >
      {legs.map((state, i) => (
        <span
          key={i}
          className={`block h-[5px] w-[5px] rounded-full ${SEGMENT_CLASS[state][verdict.level]}`}
        />
      ))}
      {verdict.isolated && (
        <svg
          className="h-2.5 w-2.5 text-sky-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
        </svg>
      )}
    </span>
  );
}
