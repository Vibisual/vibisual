/**
 * §5.11 — 버블 배지 부하 상한: 조용한 상태의 버블에 붙는 배지 수에 상한을 건다. 배지 계약은 하나 — 평상시에는 붙지 않는다.
 * 패널 카드는 `panelOrder.ts` 가 접어 주지만 배지는 붙으면 다 보인다 — 새 카드가 무조건 붙는 배지를 달면 여기서 걸린다.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';
import type { PluginBubbleContext } from './types.js';

/** 컨텍스트 하나에 붙는 배지들의 소유 카드 id. */
function attached(ctx: PluginBubbleContext): string[] {
  const out: string[] = [];
  for (const mod of PLUGIN_CLIENT_MODULES) {
    for (const badge of mod.bubbleBadges ?? []) {
      if (badge.match(ctx)) out.push(mod.manifest.id);
    }
  }
  return out;
}

/**
 * 픽스처 순서(`testkit/contexts.tsx`)와 맞물린 상한.
 * 조용한 쪽은 낮게, 일부러 문제를 만든 쪽은 높게 — 문제 상황에서 배지가 많이 뜨는 것은 정상이다.
 */
const LIMITS: { index: number; label: string; max: number }[] = [
  { index: 0, label: '① 설정도 데이터도 없는 훅 세션', max: 0 },
  // ② 에 남는 하나는 `graceful-degradation` 이다. 무응답 자동승인은 **기본값 자체가 위험**인 드문 경우라
  //    기본 상태에서도 알리는 쪽이 맞다고 보고 남겼다(사용자가 `deny` 로 바꾸면 사라진다).
  { index: 1, label: '② 갓 만든 커스텀 에이전트', max: 1 },
  { index: 4, label: '⑤ 에이전트가 아닌 버블', max: 0 },
  { index: 8, label: '⑨ 조용하지만 데이터 완비', max: 0 },
];

describe('버블 배지 부하', () => {
  const contexts = pluginTestContexts(recorder(new Set()));

  for (const { index, label, max } of LIMITS) {
    it(`${label} — 배지가 ${max}개를 넘지 않는다`, () => {
      const ctx = contexts[index];
      expect(ctx, '픽스처 순서가 바뀌었다 — 상한 표의 index 를 함께 고쳐야 한다').toBeDefined();
      const ids = attached(ctx as PluginBubbleContext);
      // 넘쳤을 때 어느 카드 때문인지 바로 보이도록 id 를 메시지에 싣는다.
      expect(ids.length, `붙은 배지: ${ids.join(', ')}`).toBeLessThanOrEqual(max);
    });
  }

  it('배지를 선언한 카드는 어떤 컨텍스트에서든 한 번은 붙는다 — 영영 안 붙는 배지는 죽은 코드다', () => {
    const everAttached = new Set<string>();
    for (const ctx of contexts) for (const id of attached(ctx)) everAttached.add(id);

    const declared = PLUGIN_CLIENT_MODULES
      .filter((m) => (m.bubbleBadges ?? []).length > 0)
      .map((m) => m.manifest.id);
    expect(declared.filter((id) => !everAttached.has(id))).toEqual([]);
  });
});
