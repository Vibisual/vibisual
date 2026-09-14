import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY_API_TTL_MS,
  MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS,
  MODEL_REGISTRY_OBSERVED_MAX,
  MODEL_REGISTRY_RETRY_MS,
  MODEL_SEED_ENTRIES,
  isPricingEstimated,
  resolveAliasToLatest,
  type ModelRegistryEntry,
} from '@vibisual/shared';
import {
  capObservedEntries,
  isApiRefreshDue,
  mergeObservedEntries,
  mergeSeedAndApiEntries,
  modelRegistryService,
  normalizeObservedModelId,
} from './modelRegistryService.js';

/**
 * §4 (상태바 모델 칸 ③) — **모델 목록은 저절로 최신이어야 한다.**
 *
 * 종전 레지스트리는 부팅 1회였고, 키가 없는 사용자에게는 공개 문서 시드가 목록의 전부였다.
 * 여기서 고정하는 것 —
 *   (가) 대화록의 `message.model` 에서 **배울 것만** 배운다(정규화·모양·비모델 거르기).
 *   (나) 관측분은 시드·API 가 아는 ID 를 덮지 않고, 개수 상한을 지킨다.
 *   (다) `/v1/models` 재조회 판정 — 신선하면 안 부르고, 실패 뒤엔 간격을 지키고, 수동 확인은 하한을 지킨다.
 *   (라) 실제 서비스가 새 판을 배우면 **패밀리 latest 가 그 판으로 옮는다**(비네이티브 별칭 치환이 따라온다).
 */

describe('(가) normalizeObservedModelId — 배울 것만 배운다', () => {
  it('정규 풀ID 는 그대로', () => {
    expect(normalizeObservedModelId('claude-opus-5')).toBe('claude-opus-5');
    expect(normalizeObservedModelId('claude-fable-5-1')).toBe('claude-fable-5-1');
  });

  it('날짜형·`[1m]` 변형은 별칭형으로 접는다', () => {
    expect(normalizeObservedModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeObservedModelId('claude-opus-5[1m]')).toBe('claude-opus-5');
  });

  it('모델이 아닌 값·옛 명명·꼬리 변형은 떨어진다', () => {
    expect(normalizeObservedModelId('<synthetic>')).toBeNull();
    expect(normalizeObservedModelId('claude-3-5-sonnet-20241022')).toBeNull();
    expect(normalizeObservedModelId('claude-opus-5-fast')).toBeNull();
    expect(normalizeObservedModelId('claude-code-2-1')).toBeNull();
    expect(normalizeObservedModelId('gpt-5')).toBeNull();
    expect(normalizeObservedModelId('')).toBeNull();
    expect(normalizeObservedModelId(undefined)).toBeNull();
    expect(normalizeObservedModelId(42)).toBeNull();
  });
});

describe('(나) 관측분 머지·상한', () => {
  const observed = (id: string, observedAt: number): ModelRegistryEntry => ({
    id, family: id.split('-')[1] ?? 'opus', source: 'observed', observedAt,
  });

  it('시드·API 가 아는 ID 는 덮지 않는다 — 가격·컨텍스트를 아는 쪽이 남는다', () => {
    const base = mergeSeedAndApiEntries([]);
    const seedId = MODEL_SEED_ENTRIES[0]!.id;
    const merged = mergeObservedEntries(base, [observed(seedId, 1)]);
    const entry = merged.filter((e) => e.id === seedId);
    expect(entry).toHaveLength(1);
    expect(entry[0]!.source).toBe('seed');
    expect(entry[0]!.pricing).toBeDefined();
  });

  it('처음 보는 ID 만 더한다(중복 관측도 한 번)', () => {
    const base = mergeSeedAndApiEntries([]);
    const merged = mergeObservedEntries(base, [observed('claude-opus-9', 1), observed('claude-opus-9', 2)]);
    expect(merged.filter((e) => e.id === 'claude-opus-9')).toHaveLength(1);
    expect(merged.length).toBe(base.length + 1);
  });

  it('상한을 넘으면 최근 관측 순으로 남긴다', () => {
    const many = Array.from({ length: MODEL_REGISTRY_OBSERVED_MAX + 5 }, (_, i) => observed(`claude-opus-${100 + i}`, i));
    const kept = capObservedEntries(many, MODEL_REGISTRY_OBSERVED_MAX);
    expect(kept).toHaveLength(MODEL_REGISTRY_OBSERVED_MAX);
    // 가장 오래된 다섯(observedAt 0..4)이 빠졌다.
    expect(kept.some((e) => (e.observedAt ?? 0) < 5)).toBe(false);
  });
});

describe('(다) isApiRefreshDue — 두드리지 않고, 낡으면 다시 받는다', () => {
  const now = 10_000_000_000;

  it('키가 없으면 언제나 안 부른다', () => {
    expect(isApiRefreshDue({ now, hasKey: false, fetchedAt: 0, lastAttemptAt: 0 }, 'periodic')).toBe(false);
    expect(isApiRefreshDue({ now, hasKey: false, fetchedAt: 0, lastAttemptAt: 0 }, 'manual')).toBe(false);
  });

  it('주기: 한 번도 못 받았으면 부른다', () => {
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: 0, lastAttemptAt: 0 }, 'periodic')).toBe(true);
  });

  it('주기: 신선하면 안 부르고, TTL 이 지나면 부른다', () => {
    const fresh = now - MODEL_REGISTRY_API_TTL_MS + 1_000;
    const stale = now - MODEL_REGISTRY_API_TTL_MS - 1_000;
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: fresh, lastAttemptAt: fresh }, 'periodic')).toBe(false);
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: stale, lastAttemptAt: stale }, 'periodic')).toBe(true);
  });

  it('주기: 방금 실패했으면 재시도 간격을 지킨다 — 끊긴 네트워크에서 20초마다 두드리지 않게', () => {
    const stale = now - MODEL_REGISTRY_API_TTL_MS - 1_000;
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: stale, lastAttemptAt: now - 1_000 }, 'periodic')).toBe(false);
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: stale, lastAttemptAt: now - MODEL_REGISTRY_RETRY_MS }, 'periodic')).toBe(true);
  });

  it('수동: 하한 안이면 건너뛰고, 지나면 신선해도 한 번 더 확인한다', () => {
    const recent = now - MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS + 1_000;
    const older = now - MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS - 1_000;
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: recent, lastAttemptAt: recent }, 'manual')).toBe(false);
    expect(isApiRefreshDue({ now, hasKey: true, fetchedAt: older, lastAttemptAt: older }, 'manual')).toBe(true);
  });
});

describe('(라) 서비스가 대화록에서 새 판을 배운다', () => {
  it('이 묶음은 실제 홈의 캐시(~/.vibisual/model-registry.json)에 쓰지 않는다 — 부팅 확인 전이라 저장이 미뤄진다', () => {
    // 아래가 배우는 가짜 판(`claude-fable-9-9`)이 개발자 PC 의 실제 모델 목록에 남으면 안 된다. 저장은
    //   부팅 확인(`init`)이 캐시를 한 번 읽은 뒤에만 돈다 — 이 파일에서 `init` 을 부르게 되면 먼저 캐시 경로부터 막을 것.
    expect((modelRegistryService as unknown as { cacheLoaded: boolean }).cacheLoaded).toBe(false);
  });

  it('처음 보는 더 높은 판이면 레지스트리에 들어가고 패밀리 latest 가 그 판으로 옮는다', () => {
    const before = resolveAliasToLatest('fable', modelRegistryService.getRegistry());
    expect(before).toBeDefined();

    // 시드에 없는, 판이 더 높은 fable — 날짜 꼬리를 달고 대화록에 찍혀 온 모양 그대로.
    modelRegistryService.noteObservedModel('claude-fable-9-9-20990101');

    const reg = modelRegistryService.getRegistry();
    const learned = reg.entries.find((e) => e.id === 'claude-fable-9-9');
    expect(learned?.source).toBe('observed');
    expect(learned?.observedAt).toBeGreaterThan(0);
    expect(resolveAliasToLatest('fable', reg)).toBe('claude-fable-9-9');
    // 가격은 모르므로 "추정" 표식을 받는다(§5.21) — 아는 척하지 않는다.
    expect(isPricingEstimated('claude-fable-9-9', reg)).toBe(true);
  });

  it('시드가 이미 아는 ID 는 관측으로 다시 들어가지 않는다', () => {
    const seedId = MODEL_SEED_ENTRIES[0]!.id;
    modelRegistryService.noteObservedModel(seedId);
    const entries = modelRegistryService.getRegistry().entries.filter((e) => e.id === seedId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).not.toBe('observed');
  });

  it('모델이 아닌 값은 레지스트리를 건드리지 않는다', () => {
    const before = modelRegistryService.getRegistry();
    modelRegistryService.noteObservedModel('<synthetic>');
    expect(modelRegistryService.getRegistry()).toBe(before);
  });
});
