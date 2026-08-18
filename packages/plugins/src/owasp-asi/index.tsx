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
import type { PluginBubbleContext } from '../sdk/index.js';

/** ASI01 목표 탈취 · ASI02 도구 오남용 · ASI03 신원 · ASI06 기억 오염 · ASI10 통제 이탈에 대응하는 관측치. */
function flags(ctx: PluginBubbleContext): number {
  const trifecta = judgeTrifecta(ctx.agentConfig);
  const radius = judgeBlastRadius(ctx.agentConfig);
  return [
    trifecta.level === 'critical',
    radius.score >= 3,
    ctx.agentConfig?.permissionMode === 'bypassPermissions',
    (ctx.data.brain?.needsCheckCount ?? 0) > 0,
    !ctx.customCreated,
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'owasp-asi', i18nKey: 'owaspAsi', name: 'OWASP ASI Top 10', category: 'security',
  needs: ['brain'],
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
