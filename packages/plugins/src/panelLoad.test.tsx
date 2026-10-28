/**
 * §5.11 — 패널 경고 농도 상한. 경고는 몇 장이든 접히지 않아(`panelOrder.ts`) 개수가 곧 화면 길이다.
 * 경고는 무언가 잘못 골랐을 때만 낸다 — 기본 상태의 "원래 이렇다"는 경고가 아니라 카드 본문의 설명이다.
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
 * 픽스처 순서(`testkit/contexts.tsx`)와 맞물린 상한(일부러 문제를 만든 컨텍스트는 제외).
 * 이력이 없어 나는 경고("회고·교훈 없음")는 기본 상태에서 안 낸다. 설정 경고(도구 범위·격리·승인 정책)는 낸다 — 바로 바꿀 수 있는 참인 지적이다.
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

  /**
   * **전부 켠 화면의 실제 무게 — 래칫.** 111종을 다 켜면 한 버블에 경고가 20~32장(실측, 전 도구 허용 + 승인 없음에서 최대).
   * 수치만 고정한다 — 32 가 옳은지는 설계 결정이고, 새 카드가 벽을 높이면 여기서 드러난다.
   */
  it(`전부 켠 버블 하나에 겹치는 경고가 ${32}장을 넘지 않는다`, () => {
    const worst = contexts.reduce(
      (max, ctx) => Math.max(max, loud(ctx as PluginBubbleContext).length),
      0,
    );
    expect(worst, '경고가 더 겹치게 됐다 — 늘린 카드가 정말 경고여야 하는지 먼저 보라').toBeLessThanOrEqual(32);
  });
});
