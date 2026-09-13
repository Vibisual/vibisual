/**
 * §5.11 v3.99 — OWASP ASI Top 10: 에이전트 전용 위험 목록으로 자가 점검.
 *
 * 기존 LLM 위험 목록과 별개로, **행동하는 AI** 에 특화된 좌표계다. 눈여겨볼 점은 절반 이상이 모델이 아니라
 * **하네스의 문제**라는 것 — 그래서 우리 설정만으로도 상당 부분을 자가 점검할 수 있다.
 * 이 카드는 앞선 판정들을 ASI 축으로 다시 묶어 한 장으로 보여준다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { judgeTrifecta } from '../sdk/index.js';
import { judgeBlastRadius } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/**
 * ASI01 목표 탈취 · ASI02 도구 오남용 · ASI03 신원 · ASI06 기억 오염 · ASI10 통제 이탈에 대응하는 관측치.
 *
 * ASI06 자리에 서는 것은 **승인 없이 실리는 절차가 있는가**다(§5.10). 자동 목표는 사용자
 * 지시대로 승인 버튼 없이 굳히므로, 굳은 것이 이 자리 프롬프트에 실리고 있다면 그 사실 자체가
 * 이 축에서 세어야 할 관측치다 — 위험하다는 뜻이 아니라 **보고 있어야 한다**는 뜻이다.
 */
function flags(ctx: PluginBubbleContext): number {
  const trifecta = judgeTrifecta(ctx.agentConfig);
  const radius = judgeBlastRadius(ctx.agentConfig);
  return [
    trifecta.level === 'critical',
    radius.score >= 3,
    ctx.agentConfig?.permissionMode === 'bypassPermissions',
    readAutoGoal(ctx).carried > 0,
    !ctx.customCreated,
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'owasp-asi', i18nKey: 'owaspAsi', name: 'OWASP ASI Top 10', category: 'security',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const n = flags(ctx);
    if (n === 0) return { key: 'clear', tone: 'good' };
    return n >= 3 ? { key: 'many', tone: 'bad' } : { key: 'some', tone: 'warn' };
  },
  checks: [
    { key: 'flags', value: (ctx) => `${flags(ctx)} / 5`, tone: (ctx) => (flags(ctx) >= 3 ? 'bad' : flags(ctx) > 0 ? 'warn' : 'good') },
    { key: 'trifecta', value: (ctx) => judgeTrifecta(ctx.agentConfig).level },
    { key: 'radius', value: (ctx) => `${judgeBlastRadius(ctx.agentConfig).score} / 4` },
  ],
  noteKey: () => '.note',
  badge: { match: (ctx) => flags(ctx) >= 3, text: (ctx) => String(flags(ctx)), icon: ICONS.shield },
});

export const owaspAsiManifest = inspector.manifest;
export const owaspAsiClient = inspector.client;
