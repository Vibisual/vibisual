/**
 * §5.11 — **판정이 살아 있는가.**
 *
 * 사용자 지적 — "각 플러그인이 독립적으로 개발되고 있는지 검토하고 **정상 작동**할 수 있도록 하나씩 확인해."
 *
 * 지금까지의 그물은 "카드가 뜨는가"(`renderAll`), "부하가 과하지 않은가"(`panelLoad`/`badgeLoad`),
 * "집행 블록이 비지 않았는가"(`enforcement`)까지였다. 빠져 있던 것은 **등급이 상황에 따라 움직이는가**다.
 * 등급이 어떤 상황에서도 한 값이면 그 카드는 화면에 떠 있을 뿐 아무것도 재지 않는다 — 실제로
 * `token-budget` 이 그랬다. 상수 구획만 나눠 보고 있어서 몫이 4.9%(200k)·0.98%(1M) 로 굳었고,
 * `heavy` 문턱(10%)은 **어떤 모델에서도 닿을 수 없는 죽은 가지**였다. 사람 눈으로는 안 보인다 —
 * 카드는 정상적으로 그려지고 테스트도 전부 통과했으니까. 그래서 여기서 못 박는다.
 *
 * 고정이 **의도**인 카드는 아래 `INTENTIONALLY_FIXED` 에 이유와 함께 적는다. 목록에 적는 행위 자체가
 * "이건 알고 고정한 것"이라는 서명이고, 목록에 없으면 그 카드는 죽은 판정으로 간주한다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';
import type { PluginBubbleContext } from './types.js';

/** `PluginSection` 이 등급을 그리는 자리. */
const STATUS = /font-medium[^"]*">([^<]*)<\/span>/g;

/**
 * 등급이 한 값이어도 되는 카드 — **이유가 있는 것만**.
 *
 * `mcp-server` 는 "우리를 MCP 도구로 바깥에 노출하지 않는다"(SSOT §10 Out of Scope)는 **결정 자체를**
 * 화면에 남겨 두는 카드다. 안 하기로 한 것도 보여야 나중에 오해가 없고, 어느 날 열리면 이 카드가 먼저
 * 색을 바꾼다. 그때까지 등급이 고정인 것이 맞다.
 */
const INTENTIONALLY_FIXED: Record<string, string> = {
  'mcp-server': 'SSOT §10 Out of Scope — 노출하지 않는다는 결정을 고정 표시',
};

/**
 * 공유 컨텍스트가 담지 못하는 **극단**을 몇 개 덧댄다.
 *
 * 공유 묶음은 "평범한 프로젝트들"이라 규칙이 짧고 모델도 한 종류다. 판정이 사는지 보려면 카드가 재는 축이
 * 실제로 흔들리는 상황이 하나는 있어야 한다 — 규칙을 크게 적은 에이전트, 창이 다섯 배 넓은 모델처럼
 * **사용자가 실제로 만들 수 있는** 상태만 넣는다(공유 묶음은 건드리지 않는다 — 다른 검사의 바닥이다).
 */
function stressVariants(base: readonly PluginBubbleContext[]): PluginBubbleContext[] {
  const seed = base.find((c) => c.agentConfig !== undefined);
  if (!seed?.agentConfig) return [];
  const withConfig = (patch: Partial<NonNullable<PluginBubbleContext['agentConfig']>>): PluginBubbleContext =>
    ({ ...seed, agentConfig: { ...seed.agentConfig, ...patch } }) as PluginBubbleContext;
  return [
    withConfig({ rules: 'x'.repeat(120_000) }),
    withConfig({ model: 'claude-opus-4-6', rules: 'x'.repeat(600_000) }),
  ];
}

describe('판정 생존', () => {
  const t = recorder(new Set<string>());
  const contexts = [...pluginTestContexts(t), ...stressVariants(pluginTestContexts(t))];

  const gradesOf = (id: string): { hits: number; grades: Set<string> } => {
    const mod = PLUGIN_CLIENT_MODULES.find((m) => m.manifest.id === id);
    const grades = new Set<string>();
    let hits = 0;
    for (const ctx of contexts) {
      for (const section of mod?.panelSections ?? []) {
        if (!section.match(ctx)) continue;
        hits++;
        let markup = '';
        try { markup = renderToStaticMarkup(section.render(ctx) as never); } catch { markup = 'ERR'; }
        for (const m of markup.matchAll(STATUS)) grades.add(m[1] ?? '');
      }
    }
    return { hits, grades };
  };

  it('여러 상황에 뜨는 카드는 등급이 하나로 굳지 않는다 — 굳은 등급은 켜도 아무것도 안 재는 카드다', () => {
    const inert: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      const id = mod.manifest.id;
      if (id in INTENTIONALLY_FIXED) continue;
      const { hits, grades } = gradesOf(id);
      if (hits > 1 && grades.size <= 1) inert.push(`${id} → "${[...grades][0] ?? '(등급 없음)'}" 고정`);
    }
    expect(inert).toEqual([]);
  });

  it('고정 예외 목록은 실재하는 카드만 담는다 — 지운 카드가 남으면 예외가 조용히 늘어난다', () => {
    const known = new Set(PLUGIN_CLIENT_MODULES.map((m) => m.manifest.id));
    expect(Object.keys(INTENTIONALLY_FIXED).filter((id) => !known.has(id))).toEqual([]);
  });

  it('고정 예외는 실제로 고정인 카드만 담는다 — 살아난 카드가 예외로 남으면 다시 죽어도 안 걸린다', () => {
    const notFixed = Object.keys(INTENTIONALLY_FIXED).filter((id) => gradesOf(id).grades.size > 1);
    expect(notFixed).toEqual([]);
  });
});
