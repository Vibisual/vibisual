/**
 * §5.11 v4.26 — 패널 경고 농도 상한.
 *
 * `panelOrder.ts` 는 조용한 카드를 접어 주지만 **경고는 몇 장이든 절대 접지 않는다** — 그게 규칙이다.
 * 그래서 경고의 개수 자체가 곧 화면이다. 기본 설정 에이전트를 열었을 때 경고가 열 장 쏟아지면
 * 사용자는 그중 무엇이 진짜인지 고를 수 없고, 결국 전부 무시하게 된다. 배지에서 겪은 일과 같다
 * (v4.25 — 모든 버블에 붙는 배지는 참이어도 정보가 아니다).
 *
 * 경고는 **사용자가 무언가 잘못 골랐을 때** 나와야 한다. 아무것도 안 건드린 기본 상태에서 나오는 경고는
 * "이 도구는 원래 이렇습니다"라는 뜻이고, 그건 경고가 아니라 설명이다 — 카드 본문이 할 일이다.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';
import type { PluginBubbleContext, PluginSeverity } from './types.js';

function loud(ctx: PluginBubbleContext): { id: string; severity: PluginSeverity }[] {
  const out: { id: string; severity: PluginSeverity }[] = [];
  for (const mod of PLUGIN_CLIENT_MODULES) {
    for (const section of mod.panelSections ?? []) {
      if (!section.match(ctx)) continue;
      const severity = section.severity?.(ctx) ?? 'neutral';
      if (severity === 'bad' || severity === 'warn') out.push({ id: mod.manifest.id, severity });
    }
  }
  return out;
}

/**
 * 픽스처 순서(`testkit/contexts.tsx`)와 맞물린 상한. 문제를 일부러 만든 컨텍스트는 대상이 아니다.
 *
 * 남은 경고를 두 부류로 갈라 보고 정한 값이다.
 *  · **이력이 없어서 나온 경고는 없앴다** — "회고가 없다 / 교훈이 없다"는 방금 만든 에이전트에겐 당연한 상태다.
 *  · **설정을 두고 하는 경고는 남겼다** — 도구 범위 · 격리 · 승인 정책은 지금 바로 바꿀 수 있는 것들이고,
 *    기본값이 열려 있다는 사실 자체가 이 카드들이 존재하는 이유다. 각도만 다를 뿐 전부 참인 지적이다.
 */
const LIMITS: { index: number; label: string; max: number }[] = [
  // ① 훅 세션 — 우리가 설정을 소유하지 않는다. 남는 셋(non-human-identity · owasp-asi · agent-registry)은
  //    "이 세션은 우리 손 밖이다" 자체가 발견이라 정당하다.
  { index: 0, label: '① 설정도 데이터도 없는 훅 세션', max: 3 },
  { index: 1, label: '② 갓 만든 커스텀 에이전트', max: 10 },
  { index: 8, label: '⑨ 조용하지만 데이터 완비', max: 7 },
];

describe('패널 경고 농도', () => {
  const contexts = pluginTestContexts(recorder(new Set()));

  for (const { index, label, max } of LIMITS) {
    it(`${label} — 경고 카드가 ${max}장을 넘지 않는다`, () => {
      const ctx = contexts[index];
      expect(ctx, '픽스처 순서가 바뀌었다 — 상한 표의 index 를 함께 고쳐야 한다').toBeDefined();
      const cards = loud(ctx as PluginBubbleContext);
      expect(
        cards.length,
        `경고 카드: ${cards.map((c) => `${c.id}(${c.severity})`).join(', ')}`,
      ).toBeLessThanOrEqual(max);
    });
  }

  it('이력이 비었다는 이유만으로 경고하는 카드가 없다 — 방금 만든 에이전트는 잘못한 것이 없다', () => {
    // ② 는 설정만 있고 활동은 0 이다. 이력 기반 카드가 여기서 경고하면 `activity.ts` 의 규칙이 샌 것이다.
    const historyCards = new Set([
      'verifier-critic', 'golden-set', 'regression-suite', 'observability', 'adr-presence',
      'benchmark-hygiene', 'audit-trail', 'vibe-coding', 'agentic-engineering',
      'hybrid-workflow', 'spec-driven',
    ]);
    const leaked = loud(contexts[1] as PluginBubbleContext).filter((c) => historyCards.has(c.id));
    expect(leaked.map((c) => c.id)).toEqual([]);
  });
});
