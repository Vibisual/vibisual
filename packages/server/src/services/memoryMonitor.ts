/**
 * memoryMonitor.ts — §3.2.4 H·I축. 힙을 재고, 압력이 걸리면 캐시를 스스로 비운다.
 *
 * **왜 필요했나**: 가동 10.9시간 앱이 메인 프로세스 혼자 3,050MB 를 잡고 있었는데, 서버에
 * `process.memoryUsage()` 호출이 **한 곳도 없어서** 진단을 프로세스 I/O 카운터와 소거법으로
 * 해야 했다(디스크 영속분 73MB 를 실측해 배제 → 누적 읽기 16GB 를 보고 재파싱을 지목).
 * 계측이 있었으면 첫 5분에 끝났을 일이다.
 *
 * **무엇을 하나**
 *  - H축: 30초마다 `process.memoryUsage()` + `v8.getHeapStatistics()` 표본을 링버퍼에 남긴다.
 *  - I축: `heapUsed / heap_size_limit` 이 임계를 넘으면 등록된 캐시를 축출한다(고=절반, 위험=전량).
 *
 * **무엇을 안 하나**
 *  - `global.gc()` 를 부르지 않는다. `--expose-gc` 없이는 없는 함수이고, 있어도 강제 GC 는
 *    메인 프로세스를 수백 ms 멈춘다(서버가 메인과 한 몸이라 그게 곧 UI 정지다). 우리가 할 일은
 *    **참조를 놓아 주는 것**이고, 언제 거둘지는 V8 이 정한다.
 *  - 힙 상한을 올리지 않는다(§3.2.4 — 한도를 올리는 것은 원인 수정이 아니다).
 *
 * ⚠ 표본 자체가 부하가 되면 안 된다. `getHeapStatistics()` 는 싸지만 30초보다 잦게 부르지 않는다.
 */
import v8 from 'node:v8';
import {
  MEMORY_PRESSURE_COOLDOWN_MS,
  MEMORY_PRESSURE_CRITICAL_RATIO,
  MEMORY_PRESSURE_EVICT_FRACTION,
  MEMORY_PRESSURE_HIGH_RATIO,
  MEMORY_SAMPLE_HISTORY,
  MEMORY_SAMPLE_INTERVAL_MS,
  type EvictableCache,
  type MemoryCacheStat,
  type MemoryDiagnosticsReport,
  type MemoryPressureLevel,
  type MemorySample,
} from '@vibisual/shared';
import { logger } from '../logger.js';

/** 캐시 이름 → 축출 접점. 이름을 키로 써서 중복 등록(HMR·재기동)에 안전하다. */
const evictables = new Map<string, EvictableCache>();

/** 통계까지 낼 수 있는 캐시는 이쪽도 함께 등록된다(`ByteBudgetCache` 는 둘 다 만족). */
interface StatProvider {
  stats(): MemoryCacheStat;
}
const statProviders = new Map<string, StatProvider>();

const history: MemorySample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastReliefAt: number | null = null;
let reliefCount = 0;
let reliefFreedBytes = 0;

function hasStats(value: unknown): value is StatProvider {
  return typeof (value as StatProvider | null)?.stats === 'function';
}

/**
 * 압력이 걸렸을 때 비울 캐시를 등록한다.
 *
 * 등록만 하면 되고, 무엇이 들어 있는지 여기서는 모른다 — 캐시가 스스로 "오래된 것부터 얼마만큼"을
 * 버릴 줄 안다(`EvictableCache`). 같은 이름으로 다시 등록하면 마지막 것이 이긴다.
 */
export function registerEvictableCache(cache: EvictableCache): void {
  evictables.set(cache.cacheName, cache);
  if (hasStats(cache)) statProviders.set(cache.cacheName, cache);
}

/** 테스트·정리용 — 등록을 되돌린다. */
export function unregisterEvictableCache(name: string): void {
  evictables.delete(name);
  statProviders.delete(name);
}

/** 지금 이 순간의 힙 표본 한 장. 링버퍼에 넣지 않는다(순수 조회). */
export function sampleMemory(now: number = Date.now()): MemorySample {
  const usage = process.memoryUsage();
  let heapLimit = 0;
  try {
    heapLimit = v8.getHeapStatistics().heap_size_limit;
  } catch {
    heapLimit = 0;
  }
  const ratio = heapLimit > 0 ? usage.heapUsed / heapLimit : 0;
  return {
    at: now,
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    heapLimit,
    ratio,
  };
}

/** 표본 하나의 압력 단계. 임계는 상수 한 곳에서만 해석한다. */
export function pressureLevelOf(sample: MemorySample): MemoryPressureLevel {
  if (sample.ratio >= MEMORY_PRESSURE_CRITICAL_RATIO) return 'critical';
  if (sample.ratio >= MEMORY_PRESSURE_HIGH_RATIO) return 'high';
  return 'normal';
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

/**
 * 등록된 캐시를 비워 압력을 던다. 회수한 바이트를 돌려준다.
 *
 * `critical` 이면 전량, `high` 면 절반. 버리는 것은 **파일에서 다시 만들 수 있는 파생물**뿐이라
 * 사용자가 보던 것은 줄지 않는다(§3.2.4 — 소비자에게 no-op).
 */
export function relieveMemoryPressure(level: MemoryPressureLevel, now: number = Date.now()): number {
  if (level === 'normal' || evictables.size === 0) return 0;
  let freed = 0;
  for (const cache of evictables.values()) {
    try {
      freed += level === 'critical'
        ? cache.clear()
        : cache.evictFraction(MEMORY_PRESSURE_EVICT_FRACTION);
    } catch (err) {
      logger.warn(
        `memoryMonitor: evict failed (${cache.cacheName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  lastReliefAt = now;
  reliefCount += 1;
  reliefFreedBytes += freed;
  return freed;
}

/**
 * 표본 한 장을 찍어 링버퍼에 넣고, 필요하면 압력 대응까지 한다.
 *
 * 주기 타이머가 부르지만 테스트에서 직접 부를 수도 있게 export 한다(타이머를 흉내 내지 않아도 됨).
 */
export function tickMemoryMonitor(now: number = Date.now()): MemorySample {
  const sample = sampleMemory(now);
  history.push(sample);
  while (history.length > MEMORY_SAMPLE_HISTORY) history.shift();

  const level = pressureLevelOf(sample);
  if (level === 'normal') return sample;

  // 쿨다운 — 축출 직후에는 GC 가 아직 안 돌아 heapUsed 가 그대로다. 이 간격이 없으면 매 표본마다
  // 캐시를 비워 "캐시가 영영 비어 있는" 상태가 되고, 그러면 재파싱이 오히려 늘어난다.
  if (lastReliefAt !== null && now - lastReliefAt < MEMORY_PRESSURE_COOLDOWN_MS) return sample;

  const freed = relieveMemoryPressure(level, now);
  logger.warn(
    `memoryMonitor: heap pressure ${level} — heapUsed ${mb(sample.heapUsed)} / limit ${mb(sample.heapLimit)} ` +
    `(${(sample.ratio * 100).toFixed(0)}%), released ${mb(freed)} from ${evictables.size} cache(s)`,
  );
  return sample;
}

/** 주기 표본 시작. 이미 돌고 있으면 아무것도 하지 않는다(중복 기동 안전). */
export function startMemoryMonitor(): void {
  if (timer !== null) return;
  // 부팅 직후 한 장 — "켠 직후가 얼마였나"가 있어야 나중 표본을 읽을 수 있다.
  try {
    tickMemoryMonitor();
  } catch { /* 계측 실패가 기동을 막지 않는다 */ }
  timer = setInterval(() => {
    try {
      tickMemoryMonitor();
    } catch { /* best effort */ }
  }, MEMORY_SAMPLE_INTERVAL_MS);
  // 이 타이머 때문에 프로세스가 종료를 미루지 않도록.
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopMemoryMonitor(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** `GET /api/diagnostics/memory` 가 그대로 내보내는 리포트. */
export function getMemoryDiagnostics(): MemoryDiagnosticsReport {
  const current = history.length > 0 ? history[history.length - 1] ?? null : null;
  const caches: MemoryCacheStat[] = [];
  for (const provider of statProviders.values()) {
    try {
      caches.push(provider.stats());
    } catch { /* 한 캐시가 실패해도 나머지는 보고한다 */ }
  }
  // 통계를 못 내는 캐시도 최소한 이름·크기는 보인다(등록됐는데 화면에 없으면 진단이 헷갈린다).
  for (const [name, cache] of evictables) {
    if (statProviders.has(name)) continue;
    caches.push({ name, entries: 0, bytes: cache.currentBytes(), maxBytes: 0, hits: 0, misses: 0, evictions: 0 });
  }
  return {
    current,
    history: [...history],
    level: current ? pressureLevelOf(current) : 'normal',
    caches,
    reliefCount,
    lastReliefAt,
    reliefFreedBytes,
    uptimeMs: Math.round(process.uptime() * 1000),
  };
}

/** 테스트 전용 — 모듈 전역 상태를 초기화한다. */
export function __resetMemoryMonitorForTest(): void {
  stopMemoryMonitor();
  evictables.clear();
  statProviders.clear();
  history.length = 0;
  lastReliefAt = null;
  reliefCount = 0;
  reliefFreedBytes = 0;
}
