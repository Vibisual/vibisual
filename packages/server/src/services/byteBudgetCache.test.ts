/**
 * §3.2.4 F축 — 바이트 예산 LRU 캐시 회귀 테스트.
 *
 * 지키는 것은 셋이다.
 *  1. **개수가 아니라 바이트로 묶인다** — 큰 항목 하나가 작은 항목 여럿보다 먼저 밀려난다.
 *     (종전 `SESSION_TEXT_CACHE_MAX = 64` 는 26MB 와 4KB 를 같은 한 칸으로 셌다.)
 *  2. **제자리 변경이 회계에 반영된다** — 증분 스캔은 같은 객체를 계속 키우므로,
 *     `refresh()` 를 안 부르면 예산이 조용히 새어 나간다.
 *  3. **방금 넣은 것이 즉시 사라지지 않는다** — 예산보다 큰 값 하나가 들어와도 캐시가 비면
 *     그 파일을 물을 때마다 전량 재파싱이 도는, 고치려던 바로 그 증상이 된다.
 */
import { describe, it, expect } from 'vitest';
import { ByteBudgetCache, approximateStringBytes, capMapSize } from '@vibisual/shared';

/** 값의 길이를 그대로 바이트로 세는 캐시 — 예산 계산을 눈으로 따라갈 수 있게. */
function makeCache(maxBytes: number, maxEntries = 0) {
  return new ByteBudgetCache<string, string>({
    name: 'test',
    maxBytes,
    maxEntries,
    sizeOf: (v) => v.length,
  });
}

describe('ByteBudgetCache — 바이트 예산', () => {
  it('총 바이트가 예산을 넘으면 오래된 것부터 버린다', () => {
    const cache = makeCache(10);
    cache.set('a', '12345');   // 5
    cache.set('b', '12345');   // 10 — 아직 예산 안
    expect(cache.size).toBe(2);

    cache.set('c', '12345');   // 15 → 초과, 가장 오래된 'a' 축출
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.currentBytes()).toBe(10);
  });

  it('큰 항목 하나가 작은 항목 여럿을 밀어낸다 — 개수 상한이었다면 안 밀렸을 자리', () => {
    const cache = makeCache(100);
    for (let i = 0; i < 10; i += 1) cache.set(`small-${i}`, 'x'.repeat(5)); // 50
    expect(cache.size).toBe(10);

    cache.set('big', 'x'.repeat(80)); // 130 → 예산 100 까지 오래된 것부터 축출
    expect(cache.has('big')).toBe(true);
    expect(cache.currentBytes()).toBeLessThanOrEqual(100);
    // 개수 기준이었다면 10개가 전부 남았을 자리 — 바이트 기준이라 일부가 밀렸다.
    expect(cache.size).toBeLessThan(11);
  });

  it('개수 상한도 함께 적용된다(먼저 걸리는 쪽이 이긴다)', () => {
    const cache = makeCache(1_000_000, 3);
    cache.set('a', 'x');
    cache.set('b', 'x');
    cache.set('c', 'x');
    cache.set('d', 'x');
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('maxBytes 0 은 무제한 — §3.2.3 과 같은 규약', () => {
    const cache = makeCache(0);
    for (let i = 0; i < 50; i += 1) cache.set(`k-${i}`, 'x'.repeat(1000));
    expect(cache.size).toBe(50);
  });

  it('예산보다 큰 값을 넣어도 마지막 한 항목은 남는다', () => {
    const cache = makeCache(10);
    cache.set('huge', 'x'.repeat(500));
    // 넣자마자 사라지면 그 파일을 물을 때마다 전량 재파싱이 돈다 — 고치려던 증상 그대로다.
    expect(cache.get('huge')).toBe('x'.repeat(500));
    expect(cache.size).toBe(1);
  });
});

describe('ByteBudgetCache — LRU 순서', () => {
  it('get 이 최신화하므로 최근에 쓴 것은 살아남는다', () => {
    const cache = makeCache(10);
    cache.set('a', '12345');
    cache.set('b', '12345');
    expect(cache.get('a')).toBe('12345'); // a 를 최신으로

    cache.set('c', '12345'); // 초과 → 이제 가장 오래된 것은 b
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('peek 은 순서를 건드리지 않는다', () => {
    const cache = makeCache(10);
    cache.set('a', '12345');
    cache.set('b', '12345');
    expect(cache.peek('a')).toBe('12345'); // 최신화 없음

    cache.set('c', '12345');
    expect(cache.has('a')).toBe(false); // 여전히 a 가 가장 오래됐다
  });
});

describe('ByteBudgetCache — 제자리 변경(refresh)', () => {
  it('refresh 를 부르면 자란 크기가 회계에 반영된다', () => {
    const cache = new ByteBudgetCache<string, { lines: string[] }>({
      name: 'test-mutable',
      maxBytes: 0,
      sizeOf: (v) => v.lines.length * 10,
    });
    const state = { lines: ['a'] };
    cache.set('k', state);
    expect(cache.currentBytes()).toBe(10);

    // 증분 스캔이 같은 객체를 키우는 상황.
    state.lines.push('b', 'c');
    expect(cache.currentBytes()).toBe(10); // 아직 낡은 값

    cache.refresh('k');
    expect(cache.currentBytes()).toBe(30);
  });

  it('refresh 로 예산을 넘으면 그 자리에서 축출된다', () => {
    const cache = new ByteBudgetCache<string, { n: number }>({
      name: 'test-grow',
      maxBytes: 100,
      sizeOf: (v) => v.n,
    });
    cache.set('old', { n: 40 });
    const grown = { n: 40 };
    cache.set('grown', grown);
    expect(cache.size).toBe(2);

    grown.n = 90;
    cache.refresh('grown');
    expect(cache.has('grown')).toBe(true);
    expect(cache.has('old')).toBe(false);
  });

  it('없는 키의 refresh 는 아무 일도 하지 않는다', () => {
    const cache = makeCache(100);
    expect(() => cache.refresh('nope')).not.toThrow();
    expect(cache.currentBytes()).toBe(0);
  });
});

describe('ByteBudgetCache — 압력 대응 접점', () => {
  it('evictFraction 은 점유의 그만큼을 오래된 것부터 버린다', () => {
    const cache = makeCache(0);
    for (let i = 0; i < 10; i += 1) cache.set(`k-${i}`, 'x'.repeat(10)); // 총 100
    const freed = cache.evictFraction(0.5);
    expect(freed).toBeGreaterThanOrEqual(50);
    expect(cache.currentBytes()).toBeLessThanOrEqual(50);
    // 오래된 쪽이 먼저 나갔다.
    expect(cache.has('k-0')).toBe(false);
    expect(cache.has('k-9')).toBe(true);
  });

  it('evictFraction(1) 과 clear 는 전부 비우고 회수 바이트를 돌려준다', () => {
    const cache = makeCache(0);
    cache.set('a', 'x'.repeat(30));
    expect(cache.evictFraction(1)).toBe(30);
    expect(cache.size).toBe(0);

    cache.set('b', 'x'.repeat(20));
    expect(cache.clear()).toBe(20);
    expect(cache.currentBytes()).toBe(0);
  });

  it('0 이하 비율은 아무것도 버리지 않는다', () => {
    const cache = makeCache(0);
    cache.set('a', 'x'.repeat(30));
    expect(cache.evictFraction(0)).toBe(0);
    expect(cache.evictFraction(-1)).toBe(0);
    expect(cache.size).toBe(1);
  });

  it('sizeOf 가 던져도 캐시가 깨지지 않는다', () => {
    const cache = new ByteBudgetCache<string, string>({
      name: 'test-throw',
      maxBytes: 100,
      sizeOf: () => { throw new Error('boom'); },
    });
    expect(() => cache.set('a', 'x')).not.toThrow();
    expect(cache.get('a')).toBe('x');
  });

  it('stats 가 적중·축출을 보고한다', () => {
    const cache = makeCache(10);
    cache.set('a', '12345');
    cache.get('a');
    cache.get('missing');
    cache.set('b', '12345');
    cache.set('c', '12345'); // 축출 발생

    const s = cache.stats();
    expect(s.name).toBe('test');
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.evictions).toBeGreaterThan(0);
    expect(s.maxBytes).toBe(10);
  });
});

describe('capMapSize — 키 개수만 묶는 경량판', () => {
  it('상한을 넘으면 가장 먼저 들어온 것부터 버린다', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 10; i += 1) m.set(`k-${i}`, i);
    expect(capMapSize(m, 4)).toBe(6);
    expect(m.size).toBe(4);
    expect(m.has('k-0')).toBe(false);
    expect(m.has('k-6')).toBe(true);
    expect(m.has('k-9')).toBe(true);
  });

  it('상한 이하면 아무것도 버리지 않는다', () => {
    const m = new Map([['a', 1], ['b', 2]]);
    expect(capMapSize(m, 5)).toBe(0);
    expect(m.size).toBe(2);
  });

  it('0 은 무제한 — §3.2.3 과 같은 규약', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 100; i += 1) m.set(`k-${i}`, i);
    expect(capMapSize(m, 0)).toBe(0);
    expect(m.size).toBe(100);
  });

  it('음수·NaN 도 무제한으로 본다(잘못된 설정이 데이터를 지우지 않게)', () => {
    const m = new Map([['a', 1]]);
    expect(capMapSize(m, -5)).toBe(0);
    expect(capMapSize(m, Number.NaN)).toBe(0);
    expect(m.size).toBe(1);
  });
});

describe('approximateStringBytes', () => {
  it('UTF-16 기준으로 문자당 2바이트 + 헤더를 센다', () => {
    expect(approximateStringBytes('')).toBe(0);
    expect(approximateStringBytes(null)).toBe(0);
    expect(approximateStringBytes(undefined)).toBe(0);
    expect(approximateStringBytes('abc')).toBe(3 * 2 + 24);
  });
});
