import { APP_CANVAS_FACE } from '@vibisual/shared';

import { fetchStillImage } from './videoApi.js';
import { historyStill } from './studioApi.js';
import { runWhenIdle } from './studioIdle.js';
import { scrubStillTimes } from './glanceView.js';

/**
 * §5.4 #36 (J) — 훑어보기 정지 화면 기억(일꾼 스틸 data URL): 장면이 없는 문서의 포스터(35% 지점) · 훑기 정지 화면(판본마다
 * `APP_CANVAS_FACE.scrubStills` 장, 처음 훑을 때 쉬는 틈에) · 직전 판 정지 화면(④ — 누르고 있는 동안). 한 바이트 예산을 나눠 쓰고
 * 넘치면 오래 안 본 것부터 버린다(§3.2.4 F). 못 구운 칸은 빈 글자로 기억해 다시 조르지 않는다(판본·시각이 바뀌면 열쇠가 바뀐다).
 */

const STILL_CACHE_BYTES = 16 * 1024 * 1024;
/** 판본이 바뀐 뒤 이만큼 잠잠하면 포스터를 찍는다(ms) — 에이전트가 연달아 고치는 동안 매번 찍지 않게. */
export const POSTER_SETTLE_MS = 1200;

const cache = new Map<string, string>();
let cacheBytes = 0;
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<unknown>>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeGlanceStills(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function remember(key: string, image: string): void {
  const prev = cache.get(key);
  if (prev !== undefined) { cacheBytes -= prev.length; cache.delete(key); }
  cache.set(key, image);
  cacheBytes += image.length;
  while (cacheBytes > STILL_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    cacheBytes -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
  }
  notify();
}

/** 기억한 그림(못 구웠거나 없으면 `null`) · 꺼내 볼 때 뒤로 옮긴다. */
export function recallGlanceStill(key: string): string | null {
  const image = cache.get(key);
  if (image === undefined) return null;
  cache.delete(key);
  cache.set(key, image);
  return image || null;
}

/** 이미 물어본 열쇠인가(못 구운 것 포함). */
export function glanceStillKnown(key: string): boolean {
  return cache.has(key);
}

export function posterStillKey(project: string, docId: string, version: number): string {
  return JSON.stringify(['poster', project, docId, version]);
}

export function scrubStillKey(project: string, docId: string, version: number, index: number): string {
  return JSON.stringify(['scrub', project, docId, version, index]);
}

/** 직전 판 정지 화면 열쇠 — 시각은 0.1초로 묶는다(같은 자리를 조금 옮겨 눌러도 새로 찍지 않게). */
export function holdStillKey(project: string, docId: string, revId: string, t: number): string {
  return JSON.stringify(['hold', project, docId, revId, Math.round(t * 10) / 10]);
}

function once<T>(key: string, job: () => Promise<T>): Promise<T> {
  const flying = inflight.get(key) as Promise<T> | undefined;
  if (flying) return flying;
  const run = job().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** 장면이 없는 문서의 포스터(35% 지점) — 잠잠해진 뒤 · 쉬는 틈에 한 장(§5.13 (Y) 40-7 ④ · 40-10 ④). */
export function bakePosterStill(project: string, docId: string, version: number, t: number, signal: AbortSignal): Promise<void> {
  const key = posterStillKey(project, docId, version);
  if (cache.has(key)) return Promise.resolve();
  return once(key, async () => {
    try {
      const image = await runWhenIdle(() => fetchStillImage(project, docId, t), { delayMs: POSTER_SETTLE_MS, signal });
      remember(key, image);
    } catch {
      if (!signal.aborted) remember(key, '');
    }
  });
}

/** ② 장면이 없는 문서를 처음 훑을 때 — 판본마다 정지 화면 몇 장을 앞에서부터 한 장씩 쉬는 틈에 찍는다(찍히는 대로 보인다). */
export function bakeScrubStills(project: string, docId: string, version: number, duration: number, signal: AbortSignal): Promise<void> {
  const times = scrubStillTimes(duration, APP_CANVAS_FACE.scrubStills);
  return once(JSON.stringify(['scrub-run', project, docId, version]), async () => {
    for (let i = 0; i < times.length; i += 1) {
      const key = scrubStillKey(project, docId, version, i);
      const t = times[i];
      if (cache.has(key) || t === undefined) continue;
      if (signal.aborted) return;
      try {
        remember(key, await runWhenIdle(() => fetchStillImage(project, docId, t), { signal }));
      } catch {
        if (signal.aborted) return;
        remember(key, '');
      }
    }
  });
}

/** 그 판본의 훑기 정지 화면들(`scrubStillTimes` 순서, 아직·못 구운 칸은 `null`). */
export function scrubStillsOf(project: string, docId: string, version: number): (string | null)[] {
  return Array.from({ length: APP_CANVAS_FACE.scrubStills }, (_, i) => recallGlanceStill(scrubStillKey(project, docId, version, i)));
}

/** ④ 직전 판의 같은 시각 정지 화면 — 사람이 누르고 있는 동안이라 쉬는 틈을 기다리지 않는다. */
export function loadHoldStill(project: string, docId: string, revId: string, t: number): Promise<void> {
  const key = holdStillKey(project, docId, revId, t);
  if (cache.has(key)) return Promise.resolve();
  return once(key, async () => {
    try {
      remember(key, await historyStill(project, docId, revId, Math.round(t * 10) / 10));
    } catch {
      remember(key, '');
    }
  });
}
