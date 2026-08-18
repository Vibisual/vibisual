/**
 * §5.11 v3.93 — 봉쇄(Containment): 뚫렸다고 가정했을 때 무엇까지 가능한가.
 *
 * 인젝션이 모델 층에서 해결되지 않았으므로, 실효 전략은 "일부는 성공한다고 가정하고, 성공해도 큰일이
 * 나지 않게 만드는 것"이다. 사고방식의 전환이 핵심이라 질문이 다르다 — "어떻게 막을까"가 아니라
 * **"뚫렸을 때 무엇까지 가능한가"**. 그래서 이 카드는 세 앞선 판정(3요소·반경·격리)을 한 줄로 합친다.
 *
 * 표시 전용이며, 다른 플러그인이 꺼져 있어도 자기 판정만으로 동작한다(플러그인 간 의존 ❌ — 순수 함수 재사용).
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { judgeTrifecta } from '../sdk/index.js';
import { judgeBlastRadius } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function summary(ctx: PluginBubbleContext): { leak: boolean; radius: number; isolated: boolean } {
  const trifecta = judgeTrifecta(ctx.agentConfig);
  const radius = judgeBlastRadius(ctx.agentConfig);
  return {
    leak: trifecta.level === 'critical',
    radius: radius.score,
    isolated: radius.isolated,
  };
}

const inspector = defineInspector({
  id: 'containment',
  i18nKey: 'containment',
  name: 'Containment',
  category: 'security',
  status: (ctx) => {
    const s = summary(ctx);
    if (s.leak && s.radius >= 3) return { key: 'open', tone: 'bad' };
    if (s.leak || s.radius >= 3) return { key: 'partial', tone: 'warn' };
    return { key: 'contained', tone: 'good' };
  },
  checks: [
    {
      key: 'leak',
      value: (ctx) => ctx.t(`panel.plugins.containment.${summary(ctx).leak ? 'possible' : 'broken'}`),
      tone: (ctx) => (summary(ctx).leak ? 'bad' : 'good'),
    },
    {
      key: 'radius',
      value: (ctx) => `${summary(ctx).radius} / 4`,
      tone: (ctx) => (summary(ctx).radius >= 3 ? 'warn' : 'neutral'),
    },
    {
      key: 'isolation',
      value: (ctx) => ctx.t(`panel.plugins.containment.${summary(ctx).isolated ? 'isolated' : 'shared'}`),
      tone: (ctx) => (summary(ctx).isolated ? 'good' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
  badge: {
    match: (ctx) => summary(ctx).leak && summary(ctx).radius >= 3,
    text: () => '',
    icon: ICONS.shield,
  },
});

export const containmentManifest = inspector.manifest;
export const containmentClient = inspector.client;
