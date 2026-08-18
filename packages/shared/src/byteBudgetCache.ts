/**
 * byteBudgetCache.ts — §3.2.4 F축. 캐시를 **개수가 아니라 총 바이트**로 묶는 LRU.
 *
 * **왜 개수 상한으로는 안 되나**: 세션 트랜스크립트는 4KB 짜리와 26MB 짜리가 섞여 있는데
 * `max = 64` 같은 개수 상한은 그 둘을 같은 한 칸으로 센다. 큰 것 몇 개가 들어오면 예산이
 * 수백 MB 로 튀고, 반대로 작은 것만 들어오면 캐시가 텅 빈 채로 축출이 돈다. 그래서 업계
 * 표준(`lru-cache` v11 의 `maxSize` + `sizeCalculation`)은 바이트 기준을 권한다 —
 * "개수 상한은 모든 항목이 같은 크기라고 가정하는데 실제로는 거의 그렇지 않다."
 *
 * 여기서는 그 형태만 가져오고 **새 의존성은 추가하지 않는다**(§3.4 — shared 는 아무것도
 * import 하지 않는다). `Map` 이 삽입 순서를 보존하므로 "가장 오래 안 쓴 것부터"는
 * `delete` → `set` 재삽입으로 얻는다.
 *
 * **크기는 근사여도 된다.** 예산이 하는 일은 절대 바이트를 맞추는 게 아니라 *큰 것이 작은 것보다
 * 먼저 밀려나게* 하는 것이다. `sizeOf` 는 O(1) 근사로 충분하고, 그래야 축출 판정이 싸다.
 *
 * ⚠ **제자리 변경(in-place mutation)에 주의**: 캐시에 넣은 값을 나중에 고치면(배열 push 등)
 *   저장된 크기가 낡는다. 고친 쪽이 `refresh(key)` 를 불러야 총량이 맞는다 — 증분 스캔처럼
 *   "같은 객체를 계속 키우는" 사용처가 바로 그 경우다.
 */

/** 값 하나의 바이트를 추정한다. 정확할 필요 없고 **상대 크기**만 맞으면 된다. */
export type SizeOf<V> = (value: V) => number;

export interface ByteBudgetCacheOptions<V> {
  /** 진단·로그에 쓰는 이름(예: `sessionDiscovery.tokenScan`). */
  name: string;
  /** 총 바이트 상한. **0 = 무제한**(§3.2.3 과 같은 규약 — 그 축을 끈다). */
  maxBytes: number;
  /** 항목 개수 상한. 0 = 무제한. 바이트 예산과 **둘 다** 적용된다(먼저 걸리는 쪽이 이긴다). */
  maxEntries?: number;
  /** 값 하나의 바이트 추정. */
  sizeOf: SizeOf<V>;
}

/** 진단 화면·로그가 읽는 캐시 상태. */
export interface ByteBudgetCacheStats {
  name: string;
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntries: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * 메모리 압력 대응(§3.2.4 I축)이 캐시 종류를 모른 채 축출을 시킬 수 있게 하는 최소 접점.
 * `memoryMonitor` 는 이 인터페이스만 알고, 무엇이 들어 있는지는 모른다.
 */
export interface EvictableCache {
  /** 진단·로그용 이름. */
  readonly cacheName: string;
  /** 현재 점유 바이트(추정). */
  currentBytes(): number;
  /** 현재 점유의 `fraction`(0~1) 만큼을 오래된 것부터 버린다. 버린 바이트를 돌려준다. */
  evictFraction(fraction: number): number;
  /** 전부 버린다. 버린 바이트를 돌려준다. */
  clear(): number;
}

interface Entry<V> {
  value: V;
  /** 마지막으로 잰 크기. 총량 회계는 이 값으로만 한다(sizeOf 를 매번 부르지 않기 위해). */
  bytes: number;
}

/** 문자열의 힙 점유 근사 — V8 문자열은 대체로 UTF-16 이라 문자당 2바이트 + 헤더. */
export function approximateStringBytes(text: string | null | undefined): number {
  if (!text) return 0;
  return text.length * 2 + 24;
}

/**
 * §3.2.4 F축(경량판) — **키 개수만** 묶는다. 넣은 직후 한 줄 부르면 된다.
 *
 * 값이 작아 바이트 예산까지는 필요 없지만 **키가 세션·에이전트 수만큼 늘어나는** 자리용이다
 * (§3.2.3 이 디스크에서 만난 "값 길이엔 캡이 있는데 키 개수엔 없다"와 같은 형태가 힙에도 있었다).
 * `Map` 이 삽입 순서를 보존하므로 가장 먼저 들어온 것부터 나간다.
 *
 * ⚠ **다시 만들 수 있는 파생물에만 쓴다.** 사용자가 옮긴 좌표처럼 잃으면 화면이 달라지는 상태에는
 *   쓰지 마라 — 그건 §3.2.3 이 세운 "보던 것은 줄지 않는다"를 깨는 것이다.
 *
 * @returns 버린 개수.
 */
export function capMapSize<K, V>(map: Map<K, V>, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0; // 0 = 무제한(§3.2.3 과 같은 규약)
  let dropped = 0;
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
    dropped += 1;
  }
  return dropped;
}

export class ByteBudgetCache<K, V> implements EvictableCache {
  private readonly map = new Map<K, Entry<V>>();
  private readonly sizeOf: SizeOf<V>;
  private readonly name: string;
  private maxBytes: number;
  private maxEntries: number;
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: ByteBudgetCacheOptions<V>) {
    this.name = options.name;
    this.maxBytes = Math.max(0, Math.floor(options.maxBytes));
    this.maxEntries = Math.max(0, Math.floor(options.maxEntries ?? 0));
    this.sizeOf = options.sizeOf;
  }

  get cacheName(): string {
    return this.name;
  }

  /**
   * 조회 + LRU 최신화. 없으면 `undefined`.
   *
   * 재삽입으로 순서를 갱신하므로 `Map` 삽입 순서 = "오래 안 쓴 것 먼저"가 유지된다.
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // 최신화 — 지웠다 다시 넣어 삽입 순서 맨 뒤로 보낸다.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** LRU 순서를 건드리지 않는 조회(진단·검사용). */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** 저장 + 예산 초과분 축출. */
  set(key: K, value: V): void {
    const bytes = this.safeSize(value);
    const prev = this.map.get(key);
    if (prev !== undefined) {
      this.totalBytes -= prev.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.totalBytes += bytes;
    this.enforceBudget();
  }

  /**
   * 값을 제자리에서 고친 뒤 크기를 다시 재고 총량을 맞춘다(LRU 순서도 최신화).
   *
   * 증분 스캔처럼 같은 객체를 계속 키우는 사용처는 **반드시** 이걸 불러야 한다 — 안 부르면
   * 캐시는 처음 넣었을 때의 작은 크기로 회계해 예산이 조용히 새어 나간다.
   */
  refresh(key: K): void {
    const entry = this.map.get(key);
    if (entry === undefined) return;
    const bytes = this.safeSize(entry.value);
    this.totalBytes += bytes - entry.bytes;
    entry.bytes = bytes;
    this.map.delete(key);
    this.map.set(key, entry);
    this.enforceBudget();
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    this.totalBytes -= entry.bytes;
    this.map.delete(key);
    return true;
  }

  /** 전부 버린다. 버린 바이트를 돌려준다(`EvictableCache`). */
  clear(): number {
    const freed = this.totalBytes;
    this.map.clear();
    this.totalBytes = 0;
    return freed;
  }

  get size(): number {
    return this.map.size;
  }

  currentBytes(): number {
    return this.totalBytes;
  }

  /** 현재 점유의 `fraction`(0~1) 만큼을 오래된 것부터 버린다. */
  evictFraction(fraction: number): number {
    if (!Number.isFinite(fraction) || fraction <= 0) return 0;
    if (fraction >= 1) return this.clear();
    const target = Math.floor(this.totalBytes * (1 - fraction));
    return this.evictDownTo(target);
  }

  /** 예산 재설정(설정 UI 로 바꿀 수 있게). 줄이면 즉시 초과분을 버린다. */
  setBudget(maxBytes: number, maxEntries?: number): void {
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    if (maxEntries !== undefined) this.maxEntries = Math.max(0, Math.floor(maxEntries));
    this.enforceBudget();
  }

  stats(): ByteBudgetCacheStats {
    return {
      name: this.name,
      entries: this.map.size,
      bytes: this.totalBytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  /** 남아 있는 키들(오래된 것부터). 테스트·진단용. */
  keys(): K[] {
    return Array.from(this.map.keys());
  }

  // ─── 내부 ───

  /** `sizeOf` 가 던지거나 이상한 값을 줘도 캐시가 깨지지 않게. */
  private safeSize(value: V): number {
    let n: number;
    try {
      n = this.sizeOf(value);
    } catch {
      n = 0;
    }
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  private enforceBudget(): void {
    if (this.maxEntries > 0) {
      while (this.map.size > this.maxEntries) {
        if (!this.evictOldest()) break;
      }
    }
    if (this.maxBytes > 0 && this.totalBytes > this.maxBytes) {
      this.evictDownTo(this.maxBytes);
    }
  }

  /**
   * 총량이 `targetBytes` 이하가 될 때까지 오래된 것부터 버린다.
   *
   * ⚠ **마지막 한 항목은 남긴다** — 방금 넣은 것이 예산보다 크면 넣자마자 사라져 캐시가
   *   영원히 비게 되고, 그러면 그 파일을 물을 때마다 전량 재파싱이 돈다(고치려던 바로 그 증상).
   */
  private evictDownTo(targetBytes: number): number {
    let freed = 0;
    while (this.totalBytes > targetBytes && this.map.size > 1) {
      const before = this.totalBytes;
      if (!this.evictOldest()) break;
      freed += before - this.totalBytes;
    }
    return freed;
  }

  private evictOldest(): boolean {
    const oldest = this.map.keys().next();
    if (oldest.done) return false;
    const entry = this.map.get(oldest.value);
    if (entry !== undefined) this.totalBytes -= entry.bytes;
    this.map.delete(oldest.value);
    this.evictions += 1;
    return true;
  }
}
