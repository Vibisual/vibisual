/**
 * §5.11 — 원문 용어 ↔ 등록부 독립 대조. `catalog.test.ts` 의 카탈로그도 같은 손이 써서, 원문에서 빠진 용어는 양쪽이 함께 틀린 채 통과한다.
 * 그래서 기준을 원문에서 뽑아 고정한 표(`glossaryTerms.ts`)로 둔다 — 카탈로그 검사는 문서↔코드, 이 검사는 원문이 다 들어왔는지를 본다.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_MANIFESTS } from './registry.js';
import { GLOSSARY_TERMS, DERIVED_CARDS } from './glossaryTerms.js';

const registered = new Set(PLUGIN_MANIFESTS.map((m) => m.id));

describe('원문 용어 대조', () => {
  it('용어 110개가 빠짐없이 이어져 있다 — 번호가 끊기면 뽑을 때 놓친 것이다', () => {
    expect(GLOSSARY_TERMS).toHaveLength(110);
    expect(GLOSSARY_TERMS.map((t) => t.n)).toEqual(Array.from({ length: 110 }, (_, i) => i + 1));
  });

  it('모든 용어에 담당 카드가 있다', () => {
    const orphanTerms = GLOSSARY_TERMS.filter((t) => t.cards.length === 0);
    expect(orphanTerms.map((t) => `${t.n} ${t.term}`)).toEqual([]);
  });

  it('대응표가 가리키는 카드가 전부 실재한다 — 이름이 바뀌면 여기서 먼저 걸린다', () => {
    const missing = GLOSSARY_TERMS
      .flatMap((t) => t.cards.map((id) => ({ id, t })))
      .filter(({ id }) => !registered.has(id))
      .map(({ id, t }) => `${t.n} ${t.term} → ${id}`);
    expect(missing).toEqual([]);
  });

  it('등록된 카드는 원문에서 왔거나 파생으로 밝혀져 있다 — 출처 없는 카드를 남기지 않는다', () => {
    const fromTerms = new Set(GLOSSARY_TERMS.flatMap((t) => t.cards));
    const derived = new Set(DERIVED_CARDS);
    const unexplained = [...registered].filter((id) => !fromTerms.has(id) && !derived.has(id));
    expect(unexplained).toEqual([]);
  });

  it('파생으로 적어 둔 카드가 실제로 등록돼 있다 — 지운 카드가 목록에 남으면 대조가 헐거워진다', () => {
    expect(DERIVED_CARDS.filter((id) => !registered.has(id))).toEqual([]);
  });

  it('한 카드를 여러 용어가 나눠 쓰는 경우는 의도된 것만이다', () => {
    const owners = new Map<string, number[]>();
    for (const t of GLOSSARY_TERMS) {
      for (const id of t.cards) owners.set(id, [...(owners.get(id) ?? []), t.n]);
    }
    const shared = [...owners.entries()].filter(([, ns]) => ns.length > 1);
    // 45(Overthinking)는 별도 카드가 아니라 44(Reasoning Effort) 카드 안에서 다룬다.
    expect(shared.map(([id, ns]) => `${id}:${ns.join(',')}`)).toEqual(['reasoning-effort:44,45']);
  });

  it('등록 수 = 용어가 낳은 카드 + 파생 — 셈이 맞는지 마지막으로 확인한다', () => {
    const fromTerms = new Set(GLOSSARY_TERMS.flatMap((t) => t.cards));
    expect(fromTerms.size + DERIVED_CARDS.length).toBe(PLUGIN_MANIFESTS.length);
  });
});
