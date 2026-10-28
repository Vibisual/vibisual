/**
 * §3.2.4 F축 — 캐시를 개수가 아니라 **총 바이트**로 묶는 LRU(4KB·26MB 트랜스크립트를 같은 한 칸으로 세지 않게). 새 의존성 ❌(§3.4).
 * 크기는 근사(O(1) `sizeOf`)면 된다. ⚠ 넣은 값을 제자리에서 키우면(증분 스캔) `refresh(key)` 를 불러야 총량이 맞는다.
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

/** §3.2.4 I축 — 메모리 압력 대응(`memoryMonitor`)이 캐시 종류를 모른 채 축출을 시키는 최소 접점. */
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
 * §3.2.4 F축(경량판) — Map 의 키 개수만 묶는다(오래된 것부터 버리고 버린 개수를 돌려준다).
 * ⚠ 다시 만들 수 있는 파생물에만 — 잃으면 화면이 달라지는 상태(옮긴 좌표 등)는 ❌(§3.2.3).
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

/** `capMapSize` 의 `Set` 짝(같은 규약·같은 주의). 버린 개수를 돌려준다. */
export function capSetSize<T>(set: Set<T>, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0; // 0 = 무제한(§3.2.3 과 같은 규약)
  let dropped = 0;
  while (set.size > max) {
    const oldest = set.values().next();
    if (oldest.done) break;
    set.delete(oldest.value);
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

  /** 조회 + LRU 최신화(재삽입). */
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

  /** 제자리에서 키운 값의 크기를 다시 잰다 — 증분 스캔은 **반드시** 부른다(안 부르면 예산이 조용히 샌다). */
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

  /** ⚠ 마지막 한 항목은 남긴다 — 예산보다 큰 것이 바로 사라지면 캐시가 늘 비어 매번 전량 재파싱한다. */
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
