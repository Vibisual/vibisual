/**
 * §5.11 — 판정이 살아 있는가: 등급이 상황에 따라 움직이는지 본다. 어떤 상황에서도 한 값이면 그 카드는 아무것도 재지 않는다
 * (예: 상수 구획만 보던 `token-budget` 의 `heavy` 문턱은 어떤 모델에서도 닿지 않았는데 렌더·테스트는 다 통과했다).
 * 고정이 의도인 카드는 `INTENTIONALLY_FIXED` 에 이유와 함께 적는다 — 목록에 없으면 죽은 판정으로 본다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';
import type { PluginBubbleContext } from './types.js';

/** `PluginSection` 이 등급을 그리는 자리. */
const STATUS = /font-medium[^"]*">([^<]*)<\/span>/g;

/**
 * 등급이 한 값이어도 되는 카드 — 이유가 있는 것만.
 * `mcp-server` 는 MCP 도구로 바깥에 노출하지 않는다는 결정(SSOT §10 Out of Scope)을 화면에 남기는 카드라 고정이 맞다 — 열리면 이 카드가 먼저 색을 바꾼다.
 */
const INTENTIONALLY_FIXED: Record<string, string> = {
  'mcp-server': 'SSOT §10 Out of Scope — 노출하지 않는다는 결정을 고정 표시',
};

/**
 * 공유 컨텍스트가 담지 못하는 극단(규칙을 크게 적은 에이전트, 창이 다섯 배 넓은 모델)을 덧댄다 — 사용자가 실제로 만들 수 있는 상태만.
 * 공유 묶음은 건드리지 않는다 — 다른 검사의 바닥이다.
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
