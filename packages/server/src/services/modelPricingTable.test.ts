// SCENARIO.md §4 (동적 모델 레지스트리) — 모델 단가·컨텍스트 테이블 회귀 테스트.
//
// 이 파일이 지키려는 것은 하나다: **화면에 고를 수 있게 띄워 놓고 값은 모르는 모델이 없을 것.**
//
// 이 테스트가 없던 동안 실제로 벌어진 일 — `claude-fable-5` 는 드롭다운 시드 맨 앞에 있었고 스폰도
// 정확히 됐는데, `MODEL_FAMILY_DEFAULTS` 에 `fable` 이 없어 단가·컨텍스트만 폴백값으로 떨어졌다.
// 결과는 비용 1.5배 과대($15/$75 ← 실제 $10/$50), 컨텍스트 5배 과소(200K ← 실제 1M)였고,
// **아무 에러도 나지 않아** 화면에는 그럴듯한 숫자가 계속 떴다. 아래 (1)(2)가 그 자리를 막는다.
//
// 값의 출처는 Anthropic 공개 문서다 — 가격표(`platform.claude.com/docs/en/about-claude/pricing`)와
// 모델 개요표(`.../about-claude/models/overview`). 확인 2026-09-02.
// 값이 틀려서 이 테스트가 깨지면 코드가 아니라 **먼저 공개 문서를 다시 보고** 표를 고친다.

import { describe, it, expect } from 'vitest';
import type { ModelRegistry } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_MODELS,
  AVAILABLE_AGENT_MODEL_FULL_IDS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_PRICING,
  MODEL_CONTEXT_LIMITS,
  MODEL_FAMILY_DEFAULTS,
  MODEL_PRICING,
  getModelContextLimit,
  getModelPricing,
  isKnownFamily,
  isPricingEstimated,
  normalizeModelId,
  parseFamilyFromFullId,
  parseModelSemver,
  resolveModelContextLimit,
  resolveModelPricing,
  addCostTotals,
  emptyCostTotals,
} from '@vibisual/shared';
import { mapApiModelEntry, mergeSeedAndApiEntries } from './modelRegistryService.js';

/** 소수 곱셈 꼬리를 끊는다 — 테이블이 쓰는 것과 같은 규칙. */
const round = (v: number): number => Math.round(v * 1e6) / 1e6;

describe('모델 테이블 — 고를 수 있는 것은 값도 안다', () => {
  it('(1) 드롭다운 시드의 모든 풀ID 는 단가·컨텍스트 시드를 갖는다 (폴백 금지)', () => {
    const noPrice = AVAILABLE_AGENT_MODEL_FULL_IDS.filter((id) => !MODEL_PRICING[id]);
    const noCtx = AVAILABLE_AGENT_MODEL_FULL_IDS.filter((id) => !MODEL_CONTEXT_LIMITS[id]);
    expect(noPrice, '단가 시드가 없는 풀ID').toEqual([]);
    expect(noCtx, '컨텍스트 시드가 없는 풀ID').toEqual([]);
  });

  it('(2) 드롭다운에 뜨는 모든 패밀리는 패밀리 디폴트를 갖는다 — fable 이 빠졌던 자리', () => {
    const unknown = AVAILABLE_AGENT_MODELS.filter((f) => !isKnownFamily(f));
    expect(unknown, '패밀리 디폴트가 없는 패밀리').toEqual([]);
    // 시드 풀ID 가 만들어 내는 패밀리도 전부 알려져 있어야 한다.
    const seedFamilies = [...new Set(AVAILABLE_AGENT_MODEL_FULL_IDS.map((id) => parseFamilyFromFullId(id)))];
    for (const f of seedFamilies) expect(isKnownFamily(f), `미지 패밀리: ${String(f)}`).toBe(true);
  });

  it('(3) isKnownFamily 는 MODEL_FAMILY_DEFAULTS 키와 정확히 같다 (손으로 적은 목록 금지)', () => {
    for (const f of Object.keys(MODEL_FAMILY_DEFAULTS)) expect(isKnownFamily(f)).toBe(true);
    for (const f of ['zzz', 'claude', '', 'opus5']) expect(isKnownFamily(f)).toBe(false);
    expect(isKnownFamily(undefined)).toBe(false);
    expect(isKnownFamily(null)).toBe(false);
  });
});

describe('모델 테이블 — 공개 가격표 대조', () => {
  // [풀ID, 입력, 출력, 캐시읽기, 캐시쓰기, 컨텍스트]
  const TABLE: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
    ['claude-fable-5-1', 10, 50, 0.25, 12.5, 1_000_000], // 캐시 읽기만 0.025× (이 세대 전용)
    ['claude-fable-5', 10, 50, 1, 12.5, 1_000_000],
    ['claude-opus-5', 5, 25, 0.5, 6.25, 1_000_000],
    ['claude-opus-4-8', 5, 25, 0.5, 6.25, 1_000_000],
    ['claude-opus-4-5', 5, 25, 0.5, 6.25, 200_000],
    ['claude-opus-4-1', 15, 75, 1.5, 18.75, 200_000],
    ['claude-sonnet-5', 2, 10, 0.2, 2.5, 1_000_000],
    ['claude-sonnet-4-6', 3, 15, 0.3, 3.75, 1_000_000],
    ['claude-sonnet-4-5', 3, 15, 0.3, 3.75, 200_000],
    ['claude-haiku-4-5', 1, 5, 0.1, 1.25, 200_000],
  ];

  it.each(TABLE)('%s', (id, input, output, cacheRead, cacheWrite, ctx) => {
    const p = getModelPricing(id);
    expect(p.input).toBe(input);
    expect(p.output).toBe(output);
    expect(p.cacheRead).toBe(cacheRead);
    expect(p.cacheWrite).toBe(cacheWrite);
    expect(getModelContextLimit(id)).toBe(ctx);
  });

  it('캐시 단가는 전부 입력가에서 파생된 값이다 (손으로 옮겨 적은 값 금지)', () => {
    for (const [id, p] of Object.entries(MODEL_PRICING)) {
      expect(p.cacheWrite, `${id} 캐시쓰기 = 입력가 × 1.25`).toBe(round(p.input * 1.25));
      // 표준은 0.1×, Fable/Mythos 5.1 세대만 0.025×.
      expect([round(p.input * 0.1), round(p.input * 0.025)], `${id} 캐시읽기 배수`).toContain(p.cacheRead);
    }
  });

  it('출력가는 언제나 입력가보다 비싸다 (in/out 자리 바뀜 방지)', () => {
    for (const [id, p] of Object.entries(MODEL_PRICING)) {
      expect(p.output, `${id}`).toBeGreaterThan(p.input);
    }
  });
});

describe('모델 테이블 — 폴백', () => {
  it('처음 보는 패밀리는 현행 최고가·보수적 컨텍스트로 떨어진다', () => {
    const p = getModelPricing('claude-zzz-9');
    expect(p).toEqual(DEFAULT_PRICING);
    expect(p.input).toBe(10); // 현행 최고가 티어. 은퇴한 Opus 4.1 의 $15 를 쓰면 전부 과대계상된다.
    expect(getModelContextLimit('claude-zzz-9')).toBe(DEFAULT_CONTEXT_LIMIT);
  });

  it('알려진 패밀리의 처음 보는 판올림은 그 패밀리 latest 단가로 떨어진다', () => {
    // 시드에 없는 미래 ID — 패밀리 디폴트가 받는다.
    expect(getModelPricing('claude-fable-9').input).toBe(10);
    expect(getModelContextLimit('claude-fable-9')).toBe(1_000_000);
    expect(getModelPricing('claude-sonnet-9').input).toBe(2);
    expect(getModelPricing('claude-haiku-9').input).toBe(1);
    expect(getModelContextLimit('claude-haiku-9')).toBe(200_000);
  });

  it('모델 ID 가 없으면 폴백', () => {
    expect(getModelPricing(undefined)).toEqual(DEFAULT_PRICING);
    expect(getModelContextLimit(null)).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('alias 는 그 패밀리의 진짜 최신을 가리킨다', () => {
  /** 시드 안에서 그 패밀리의 최신(semver 최대) 풀ID. `markLatestOfFamily` 와 같은 1순위 기준. */
  function newestSeedOf(family: string): string | undefined {
    return AVAILABLE_AGENT_MODEL_FULL_IDS
      .filter((id) => parseFamilyFromFullId(id) === family)
      .sort((a, b) => {
        const [aMaj, aMin] = parseModelSemver(a);
        const [bMaj, bMin] = parseModelSemver(b);
        return bMaj - aMaj || bMin - aMin;
      })[0];
  }

  it('fable 최신 시드는 claude-fable-5-1 이다', () => {
    // 여기가 뒤처지면 CLI 가 bare `fable` 을 모르는 탓에 subAgentManager 가 치환하는 대상이
    // 구세대가 되어, 사용자는 최신을 골랐는데 조용히 구모델이 뜬다.
    expect(newestSeedOf('fable')).toBe('claude-fable-5-1');
    expect(parseModelSemver('claude-fable-5-1')).toEqual([5, 1]);
    expect(parseModelSemver('claude-fable-5')).toEqual([5, 0]);
  });

  it('나머지 패밀리 최신도 고정', () => {
    expect(newestSeedOf('opus')).toBe('claude-opus-5');
    expect(newestSeedOf('sonnet')).toBe('claude-sonnet-5');
    expect(newestSeedOf('haiku')).toBe('claude-haiku-4-5');
  });
});

describe('/v1/models 매핑 — max_input_tokens', () => {
  it('max_input_tokens 를 컨텍스트로 읽는다 (필드명은 context_window 가 아니다)', () => {
    const e = mapApiModelEntry({
      id: 'claude-fable-5-1',
      display_name: 'Claude Fable 5.1',
      created_at: '2026-06-24T00:00:00Z',
      max_input_tokens: 1_000_000,
    });
    expect(e).not.toBeNull();
    expect(e?.contextWindow).toBe(1_000_000);
    expect(e?.family).toBe('fable');
    expect(e?.displayName).toBe('Claude Fable 5.1');
    expect(e?.source).toBe('api');
  });

  it('값이 아닌 것은 버린다 — 없음·0·음수·NaN', () => {
    expect(mapApiModelEntry({ id: 'claude-opus-5' })?.contextWindow).toBeUndefined();
    expect(mapApiModelEntry({ id: 'claude-opus-5', max_input_tokens: 0 })?.contextWindow).toBeUndefined();
    expect(mapApiModelEntry({ id: 'claude-opus-5', max_input_tokens: -1 })?.contextWindow).toBeUndefined();
    expect(mapApiModelEntry({ id: 'claude-opus-5', max_input_tokens: NaN })?.contextWindow).toBeUndefined();
  });

  it('모델이 아닌 항목은 채택하지 않는다', () => {
    expect(mapApiModelEntry({ id: 'claude-code-1' })).toBeNull();
    expect(mapApiModelEntry({ id: 'gpt-4' })).toBeNull();
  });

  it('망가진 created_at 은 undefined 로 흘린다 (NaN 이 정렬을 오염시키지 않게)', () => {
    expect(mapApiModelEntry({ id: 'claude-opus-5', created_at: '???' })?.createdAt).toBeUndefined();
  });
});

describe('시드 ↔ API 머지', () => {
  it('API 가 컨텍스트를 안 주면 시드 값이 살아남는다', () => {
    const merged = mergeSeedAndApiEntries([
      { id: 'claude-fable-5-1', family: 'fable', source: 'api' },
    ]);
    const e = merged.find((x) => x.id === 'claude-fable-5-1');
    expect(e?.contextWindow).toBe(1_000_000);
    expect(e?.source).toBe('api');
  });

  it('API 가 컨텍스트를 주면 그쪽이 이긴다 (시드가 낡아도 따라간다)', () => {
    const merged = mergeSeedAndApiEntries([
      { id: 'claude-sonnet-4-5', family: 'sonnet', contextWindow: 1_000_000, source: 'api' },
    ]);
    expect(merged.find((x) => x.id === 'claude-sonnet-4-5')?.contextWindow).toBe(1_000_000);
  });

  it('가격은 API 가 주지 않으므로 언제나 시드가 유지된다', () => {
    const merged = mergeSeedAndApiEntries([
      { id: 'claude-opus-5', family: 'opus', displayName: 'Claude Opus 5', source: 'api' },
    ]);
    const e = merged.find((x) => x.id === 'claude-opus-5');
    expect(e?.pricing?.input).toBe(5);
    expect(e?.pricing?.output).toBe(25);
    expect(e?.displayName).toBe('Claude Opus 5');
  });

  it('시드에 없는 신규 모델은 그대로 들어온다', () => {
    const merged = mergeSeedAndApiEntries([
      { id: 'claude-fable-9', family: 'fable', contextWindow: 2_000_000, source: 'api' },
    ]);
    const e = merged.find((x) => x.id === 'claude-fable-9');
    expect(e?.contextWindow).toBe(2_000_000);
    // 가격은 시드에 없으니 조회 시점에 패밀리 디폴트가 받는다.
    expect(getModelPricing('claude-fable-9').input).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────
// §4 — 조회용 정규화와 단가 출처. 화면의 "추정" 표식이 여기 판정 위에 서 있다.
//
// 이 두 블록이 막는 것은 서로 다른 사고다.
//  (1) 정규화 없이는 **날짜형 ID 가 시드를 통째로 빗나간다.** 실측(2026-09-02 로컬 대화록 135,150턴)
//      에서 1,225턴이 `claude-haiku-4-5-20251001` 이었다. haiku 는 폴백값이 우연히 같아 티가 안 났지만
//      `claude-opus-4-5-<날짜>` 였다면 컨텍스트가 200K 대신 1M — fable 때와 **같은 5배 사고**다.
//  (2) 출처 판정이 틀리면 표식이 늑대소년이 된다. 아는 모델에 "추정"이 붙으면 아무도 안 보게 되고,
//      모르는 모델에 안 붙으면 표식이 있으나 마나다.
// ─────────────────────────────────────────────────────────────────────

describe('조회용 정규화 — 날짜형·변형 ID', () => {
  it('날짜 꼬리와 변형 표기를 떼어 별칭형으로 접는다', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModelId('claude-opus-5[1m]')).toBe('claude-opus-5');
  });

  it('별칭형은 건드리지 않는다 (마이너 판올림을 날짜로 오인하지 않는다)', () => {
    expect(normalizeModelId('claude-opus-4-5')).toBe('claude-opus-4-5');
    expect(normalizeModelId('claude-fable-5-1')).toBe('claude-fable-5-1');
  });

  it('날짜형 opus-4-5 의 컨텍스트는 200K 다 — 폴백을 타면 1M(5배)이 된다', () => {
    expect(getModelContextLimit('claude-opus-4-5-20251101')).toBe(200_000);
    expect(resolveModelContextLimit('claude-opus-4-5-20251101').source).toBe('seed');
  });

  it('실제 대화록에 있는 날짜형 haiku 는 시드 단가를 그대로 받는다', () => {
    const r = resolveModelPricing('claude-haiku-4-5-20251001');
    expect(r.source).toBe('seed');
    expect(r.pricing.input).toBe(1);
    expect(r.pricing.output).toBe(5);
    expect(isPricingEstimated('claude-haiku-4-5-20251001')).toBe(false);
  });
});

describe('단가 출처 — "추정" 표식의 판정 근거', () => {
  it('드롭다운에 띄운 모델은 하나도 추정이 아니다', () => {
    for (const id of AVAILABLE_AGENT_MODEL_FULL_IDS) {
      expect(resolveModelPricing(id).source, id).toBe('seed');
      expect(isPricingEstimated(id), id).toBe(false);
    }
  });

  it('모르는 모델은 패밀리 디폴트로 떨어지고 추정이 된다', () => {
    expect(resolveModelPricing('claude-fable-9').source).toBe('family');
    expect(isPricingEstimated('claude-fable-9')).toBe(true);
  });

  it('모델 자체를 모르면 DEFAULT_PRICING 이고 그것도 추정이다', () => {
    expect(resolveModelPricing(undefined).source).toBe('default');
    expect(resolveModelPricing('<synthetic>').pricing).toBe(DEFAULT_PRICING);
    expect(isPricingEstimated('<synthetic>')).toBe(true);
  });

  it('레지스트리가 단가를 들고 있으면 그쪽이 이기고 추정이 아니다', () => {
    const registry: ModelRegistry = {
      entries: [{
        id: 'claude-fable-9',
        family: 'fable',
        pricing: { input: 7, output: 35, cacheRead: 0.7, cacheWrite: 8.75 },
        source: 'api',
      }],
      updatedAt: 0,
      sourceMix: 'api-merged',
    };
    const r = resolveModelPricing('claude-fable-9', registry);
    expect(r.source).toBe('registry');
    expect(r.pricing.input).toBe(7);
    expect(isPricingEstimated('claude-fable-9', registry)).toBe(false);
  });

  it('레지스트리도 날짜형을 접어서 찾는다', () => {
    const registry: ModelRegistry = {
      entries: [{ id: 'claude-fable-9', family: 'fable', contextWindow: 2_000_000, source: 'api' }],
      updatedAt: 0,
      sourceMix: 'api-merged',
    };
    expect(resolveModelContextLimit('claude-fable-9-20260901', registry).contextWindow).toBe(2_000_000);
  });

  it('얇은 껍데기가 같은 값을 준다 — 해소 순서는 한 벌뿐이다', () => {
    for (const id of ['claude-opus-5', 'claude-fable-9', 'claude-haiku-4-5-20251001', '<synthetic>']) {
      expect(getModelPricing(id), id).toEqual(resolveModelPricing(id).pricing);
      expect(getModelContextLimit(id), id).toBe(resolveModelContextLimit(id).contextWindow);
    }
  });
});

describe('추정 전파 — addCostTotals', () => {
  it('한쪽만 추정이어도 합계는 추정이다 (순서 무관)', () => {
    const known = { ...emptyCostTotals(), costUsd: 1 };
    const guess = { ...emptyCostTotals(), costUsd: 2, estimated: true };
    expect(addCostTotals(known, guess).estimated).toBe(true);
    expect(addCostTotals(guess, known).estimated).toBe(true);
  });

  it('둘 다 아니면 깃발을 만들지 않는다 — 빈 필드를 전선에 싣지 않는다', () => {
    expect(addCostTotals(emptyCostTotals(), emptyCostTotals()).estimated).toBeUndefined();
  });
});
