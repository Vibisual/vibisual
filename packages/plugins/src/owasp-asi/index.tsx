/** §5.11 — OWASP ASI Top 10: 절반 이상이 하네스 문제라 설정만으로 자가 점검이 된다 — 앞선 판정들을 ASI 축으로 묶어 보여준다. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import { judgeTrifecta } from '../sdk/index.js';
import { judgeBlastRadius } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/**
 * ASI01 목표 탈취 · ASI02 도구 오남용 · ASI03 신원 · ASI06 기억 오염 · ASI10 통제 이탈에 대응하는 관측치.
 * ASI06 자리는 승인 없이 실리는 절차가 있는가다(§5.10) — 자동 목표는 승인 버튼 없이 굳히므로, 굳은 것이 프롬프트에 실리면 그 사실이 세어야 할 관측치다(위험이 아니라 보고 있어야 한다는 뜻).
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
