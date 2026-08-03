/**
 * §5.11 v4.01 — 긴급 정지(Kill Switch): 돌고 있는 것을 즉시 멈추는 단일 수단.
 *
 * 자율성이 올라갈수록 **멈추는 능력**이 곧 통제력이다. 중요한 것은 무엇을 멈추는가 — 현재 실행만 죽이고
 * 스케줄러가 살아 있으면 다음 회차가 다시 뜬다. 그래서 이 스위치는 **예약(세션 루프)을 먼저 끊고**
 * 그다음 돌고 있는 세션을 멈춘다.
 *
 * 카탈로그에서 유일하게 **동작을 가진** 플러그인이며, 그 동작도 호스트가 이름 붙여 연 것
 * (`PluginActions.stopEverything`) 하나뿐이다. 써 본 적 없는 긴급 정지는 작동하지 않는 긴급 정지이므로,
 * 버튼은 멈출 것이 실제로 있을 때만 뜬다.
 */
import { useState } from 'react';
import type { PluginClientModule, PluginHeaderContext, PluginManifest } from '../types.js';

export const killSwitchManifest: PluginManifest = {
  id: 'kill-switch',
  name: 'Kill Switch',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.killSwitch.desc',
  enabledByDefault: false,
  contributes: ['headerItem'],
  clientOnly: true,
};

const K = 'panel.plugins.killSwitch';

function KillButton({ ctx }: { ctx: PluginHeaderContext }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const fire = async (): Promise<void> => {
    // 한 번 더 누르게 하는 이유: 되돌릴 수 없는 동작이라 오클릭 한 번으로 전부 멈추면 곤란하다.
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    try {
      await ctx.actions.stopEverything();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void fire()}
      disabled={busy}
      title={ctx.t(`${K}.title`, { count: ctx.liveAgents })}
      className={`app-nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        armed
          ? 'bg-red-500/25 text-red-200 ring-1 ring-red-400/60'
          : 'bg-white/[0.06] text-gray-400 hover:bg-red-500/15 hover:text-red-300'
      } ${busy ? 'opacity-50' : ''}`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6" />
      </svg>
      {armed ? ctx.t(`${K}.confirm`) : ctx.t(`${K}.label`)}
    </button>
  );
}

export const killSwitchClient: PluginClientModule = {
  manifest: killSwitchManifest,
  // 패널 카드가 아니라 헤더 버튼이라 그리는 행이 없다 — 창은 "어디에 보이나"(headerItem)만 보여 준다.
  usage: { i18nKey: 'killSwitch', checkKeys: [], badgeIsConditional: false },
  headerItems: [
    {
      key: 'kill',
      // 멈출 것이 없으면 띄우지 않는다 — 상시 노출은 누르기만 쉽고 의미는 없다.
      match: (ctx) => ctx.liveAgents > 0,
      render: (ctx) => <KillButton ctx={ctx} />,
    },
  ],
};
