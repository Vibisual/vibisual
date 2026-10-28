/**
 * memoryMonitor.ts — §3.2.4 H·I축. 30초마다 힙 표본을 링버퍼에 남기고, `heapUsed / heap_size_limit` 이 임계를 넘으면 등록 캐시를 비운다(고=절반, 위험=전량).
 * `global.gc()` 를 부르지 않는다 — 강제 GC 는 메인을 수백 ms 멈춘다(서버가 메인과 한 몸이라 곧 UI 정지). 참조만 놓는다. 힙 상한도 올리지 않는다(§3.2.4).
 * 표본도 부하라 30초보다 잦게 재지 않는다.
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

/** 압력 때 비울 캐시 등록 — 얼마나 버릴지는 캐시가 안다(`EvictableCache`). 같은 이름은 마지막이 이긴다. */
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

/** 등록 캐시를 비운다(`critical` 전량 · `high` 절반, 회수 바이트 반환). 버리는 것은 파일에서 다시 만들 수 있는 파생물뿐이다(§3.2.4). */
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

/** 표본 한 장 + 필요하면 압력 대응. 시험이 타이머 없이 부르게 export 한다. */
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
