import { useCallback, useRef, useSyncExternalStore } from 'react';
import { APP_THUMB, PREVIEW_POLICY, type PreviewLane } from '@vibisual/shared';

import { clientPathKey } from '../utils/platform.js';
import { thumbnailSkipped } from './appLinkedItems.js';
import { previewBudget } from './previewBudget.js';
import { getInternalApp, type AppThumbnail, type AppThumbnailRenderer } from './registry.js';
import { isThumbnailSkip } from './thumbnailSkip.js';

/**
 * §5.4 #36 (F) — 앱 위성 화면의 **미리보기 기억 장소**.
 *
 * 무엇을 어떻게 굽는지는 앱이 레지스트리 `thumbnail` 로 선언하고(늦은 로더), 여기는 **언제·몇 번** 굽는지만 맡는다.
 * 코어는 앱 이름을 모른다(§5.13 (P-4)) — 결과 두 모양(그림·파형)만 안다.
 *
 * - **한 번 굽고 기억한다.** 열쇠 = 앱 · 프로젝트 경로키 · 파일 · 결과 버전 · 크기. 같은 결과를 다시 보내지 않는 한 다시 굽지 않는다.
 * - **화면 밖에서 돌아와도 바로 보인다.** 캔버스는 화면 밖 노드를 언마운트하지만 이 장소는 모듈에 산다.
 * - **동시 건수 상한.** 영상 디코더·WebGL 문맥이 노드 수만큼 한꺼번에 뜨지 않게 줄을 세운다.
 * - **못 구운 것도 기억한다.** 읽지 못하는 형식을 마운트마다 다시 조르지 않는다(결과 버전이 바뀌면 새 열쇠라 다시 시도한다).
 * - **상한을 넘으면 오래 안 본 것부터 버린다** — 지금 그려지고 있는 것은 버리지 않고, 버린 그림의 blob URL 은 되돌린다.
 *
 * 경로 비교는 `clientPathKey`(멀티플랫폼 1축) — 같은 루트가 `C:\proj`·`C:/proj` 로 와도 한 장, linux 는 대소문자를 접지 않는다.
 */

export type ThumbStatus = 'loading' | 'ready' | 'none';

export interface ThumbState {
  readonly status: ThumbStatus;
  readonly thumb: AppThumbnail | null;
  /**
   * §5.1 #2-1 (G) ① — 못 구운(`none`) 이유가 "앱 성능 기준보다 커서 일부러 굽지 않았다"면 `tooLarge`(굽는 함수가
   * `THUMB_SKIPPED_TOO_LARGE` 를 돌려줬다). 파일 버블이 이 값으로 "미리보기 생략" 툴팁을 단다. 없으면 이유를 모른다.
   */
  readonly reason?: 'tooLarge';
}

export interface ThumbJob {
  readonly appId: string;
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 루트 기준 상대 경로. */
  readonly file: string;
  /** 결과 버전(`AppBubble.fileAt`) — 모르면 0. */
  readonly version: number;
  /** 구울 크기(px × 화면 배율, 정수). */
  readonly width: number;
  readonly height: number;
  /** §5.1 #2-1 (G) ④ — 굽는 줄(종류별 동시 건수). 없으면 줄 구분 없이 전체 상한만 본다. 열쇠에 들지 않는다. */
  readonly lane?: PreviewLane | undefined;
  /** §5.1 #2-1 (G) ① — 이미 아는 파일 크기(굽는 함수에 넘긴다). 열쇠에 들지 않는다. */
  readonly bytes?: number | undefined;
}

export interface ThumbCacheOptions {
  /** 그 앱의 굽는 함수. 선언이 없으면 `null`. */
  readonly resolve: (appId: string) => Promise<AppThumbnailRenderer | null>;
  /** 버린 미리보기의 자원을 돌려준다(blob URL 되돌리기). */
  readonly release: (thumb: AppThumbnail) => void;
  readonly cacheMax: number;
  readonly concurrency: number;
  /** 한 장의 시간 상한(ms). 넘으면 못 구운 것으로 치고 줄을 비운다 — 늦게 끝난 결과는 돌려주고 버린다. */
  readonly timeoutMs: number;
  /** §5.1 #2-1 (G) ④ — 종류별 동시 건수(줄마다). 없으면 전체 상한만. */
  readonly laneConcurrency?: Partial<Record<PreviewLane, number>>;
  /** §5.1 #2-1 (G) ④ — 지금 새 일감을 시작해도 되는가(캔버스가 멈춰 있나). 없으면 늘 된다. */
  readonly isIdle?: () => boolean;
  /** 다시 한가해지면 부를 길(미뤄 둔 줄을 다시 민다). */
  readonly onIdle?: (listener: () => void) => () => void;
  /** §5.1 #2-1 (G) ④ — 줄에 서고 이만큼 지나도록 아무도 보지 않으면 시작 전에 버린다(ms). 없으면 버리지 않는다. */
  readonly staleQueuedMs?: number;
  /** §5.1 #2-1 (G) ⑦ — 굽지 않을 일감(앱이 그 확장자는 못 푼다고 선언). 줄에 세우지 않고 곧바로 못 구운 것으로 둔다(요청 0건). */
  readonly skip?: (job: ThumbJob) => boolean;
  readonly now?: () => number;
}

export interface ThumbCache {
  /** 이 일감을 기억 장소에 올린다(없으면 줄에 세운다). 열쇠를 돌려준다. */
  ensure: (job: ThumbJob) => string;
  /** 지금 상태. 모르는 열쇠는 `loading`(곧 `ensure` 가 올린다). 같은 상태면 같은 객체다. */
  peek: (key: string) => ThumbState;
  subscribe: (key: string, listener: () => void) => () => void;
  /** 기억 중인 수(시험용). */
  size: () => number;
}

const LOADING: ThumbState = { status: 'loading', thumb: null };
const NONE: ThumbState = { status: 'none', thumb: null };
const SKIPPED_LARGE: ThumbState = { status: 'none', thumb: null, reason: 'tooLarge' };

export function thumbKey(job: ThumbJob): string {
  // JSON 으로 묶는다 — 구분자 한 글자로 이으면 그 글자가 경로 안에 있을 때 두 열쇠가 같아진다.
  return JSON.stringify([job.appId, clientPathKey(job.projectId), job.file, job.version, job.width, job.height]);
}

interface Entry {
  state: ThumbState;
  readonly listeners: Set<() => void>;
  usedAt: number;
}

interface Queued {
  readonly key: string;
  readonly lane: PreviewLane | undefined;
  readonly enqueuedAt: number;
  readonly run: () => Promise<void>;
}

export function createThumbCache(opts: ThumbCacheOptions): ThumbCache {
  const entries = new Map<string, Entry>();
  const queue: Queued[] = [];
  const runningByLane = new Map<PreviewLane, number>();
  let running = 0;
  let clock = 0;
  let idleWait: (() => void) | null = null;
  const now = opts.now ?? (() => Date.now());

  const laneFull = (lane: PreviewLane | undefined): boolean => {
    if (lane === undefined) return false;
    const cap = opts.laneConcurrency?.[lane];
    return cap !== undefined && (runningByLane.get(lane) ?? 0) >= cap;
  };

  const pump = (): void => {
    // §5.1 #2-1 (G) ④ — 캔버스가 움직이는 동안은 새로 시작하지 않는다(돌던 것은 마저 굽는다). 한가해지면 다시 민다.
    if (queue.length > 0 && opts.isIdle && !opts.isIdle()) {
      if (!idleWait && opts.onIdle) {
        const off = opts.onIdle(() => {
          off();
          idleWait = null;
          pump();
        });
        idleWait = off;
      }
      return;
    }
    let i = 0;
    while (running < opts.concurrency && i < queue.length) {
      const item = queue[i]!;
      const entry = entries.get(item.key);
      // 줄에 섰다가 화면을 떠났다(보는 사람 없음 · 오래 기다림) — 시작 전에 버린다. 돌아오면 다시 줄에 선다.
      if (!entry || (opts.staleQueuedMs !== undefined && entry.listeners.size === 0
        && now() - item.enqueuedAt > opts.staleQueuedMs)) {
        queue.splice(i, 1);
        if (entry && entry.state.status === 'loading') entries.delete(item.key);
        continue;
      }
      if (laneFull(item.lane)) { i += 1; continue; }
      queue.splice(i, 1);
      running += 1;
      if (item.lane) runningByLane.set(item.lane, (runningByLane.get(item.lane) ?? 0) + 1);
      void item.run().finally(() => {
        running -= 1;
        if (item.lane) runningByLane.set(item.lane, Math.max(0, (runningByLane.get(item.lane) ?? 1) - 1));
        pump();
      });
    }
  };

  // 오래 안 본 것부터 — 그려지는 중(구독자 있음)·굽는 중인 것은 대상이 아니다.
  const evict = (): void => {
    if (entries.size <= opts.cacheMax) return;
    const victims = [...entries.entries()]
      .filter(([, e]) => e.listeners.size === 0 && e.state.status !== 'loading')
      .sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, e] of victims) {
      if (entries.size <= opts.cacheMax) break;
      entries.delete(key);
      if (e.state.thumb) opts.release(e.state.thumb);
    }
  };

  const settle = (key: string, state: ThumbState): void => {
    const e = entries.get(key);
    if (!e) {
      // 굽는 사이 버려졌다 — 결과를 쥘 사람이 없으니 바로 돌려준다.
      if (state.thumb) opts.release(state.thumb);
      return;
    }
    e.state = state;
    for (const listener of [...e.listeners]) listener();
    evict();
  };

  return {
    ensure(job) {
      const key = thumbKey(job);
      clock += 1;
      const hit = entries.get(key);
      if (hit) {
        hit.usedAt = clock;
        return key;
      }
      if (opts.skip?.(job) === true) {
        entries.set(key, { state: NONE, listeners: new Set(), usedAt: clock });
        evict();
        return key;
      }
      entries.set(key, { state: LOADING, listeners: new Set(), usedAt: clock });
      queue.push({ key, lane: job.lane, enqueuedAt: now(), run: async () => {
        const work = (async (): ReturnType<AppThumbnailRenderer> => {
          const render = await opts.resolve(job.appId);
          return render
            ? await render({
              projectId: job.projectId, file: job.file, width: job.width, height: job.height,
              ...(job.bytes !== undefined ? { bytes: job.bytes } : {}),
            })
            : null;
        })();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<'late'>((resolve) => {
          timer = setTimeout(() => resolve('late'), opts.timeoutMs);
        });
        let next: ThumbState = NONE;
        try {
          const won = await Promise.race([work, late]);
          if (won === 'late') {
            // 상한을 넘긴 일감은 자리를 비우고, 나중에 끝나면 그 결과를 돌려주고 버린다.
            void work.then((thumb) => { if (thumb && !isThumbnailSkip(thumb)) opts.release(thumb); }, () => undefined);
          } else if (isThumbnailSkip(won)) {
            next = SKIPPED_LARGE; // 기준보다 커서 일부러 굽지 않았다 — 이유를 함께 기억한다(툴팁)
          } else if (won) {
            next = { status: 'ready', thumb: won };
          }
        } catch {
          next = NONE;
        } finally {
          clearTimeout(timer);
        }
        settle(key, next);
      } });
      pump();
      evict();
      return key;
    },
    peek(key) {
      return entries.get(key)?.state ?? LOADING;
    },
    subscribe(key, listener) {
      const e = entries.get(key);
      if (!e) return () => undefined;
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
        evict();
      };
    },
    size() {
      return entries.size;
    },
  };
}

const appThumbCache = createThumbCache({
  resolve: async (appId) => {
    const loader = getInternalApp(appId)?.thumbnail;
    return loader ? await loader() : null;
  },
  release: (thumb) => {
    if (thumb.kind === 'picture' && thumb.url.startsWith('blob:')) URL.revokeObjectURL(thumb.url);
  },
  cacheMax: APP_THUMB.cacheMax,
  concurrency: APP_THUMB.concurrency,
  timeoutMs: APP_THUMB.renderTimeoutMs,
  // §5.1 #2-1 (G) ④ — 종류별 동시 건수 · 움직이는 동안 쉬기 · 화면을 떠난 줄 버리기.
  laneConcurrency: PREVIEW_POLICY.laneConcurrency,
  isIdle: () => previewBudget.isIdle(),
  onIdle: (l) => previewBudget.onIdle(l),
  staleQueuedMs: PREVIEW_POLICY.staleQueuedMs,
  // §5.1 #2-1 (G) ⑦ — 앱이 못 푼다고 선언한 확장자는 줄에 세우지 않는다(파일 버블·앱 화면·구슬 공통).
  skip: (job) => thumbnailSkipped(job.appId, job.file),
});

const IDLE: ThumbState = { status: 'none', thumb: null };

/**
 * 그 화면의 미리보기. `job` 이 `null` 이면(담긴 파일이 없거나 프로젝트를 모르면) 굽지 않는다.
 * 구독하는 순간 줄에 서고, 구워지면 그 노드만 다시 그려진다.
 */
export function useAppThumbnail(job: ThumbJob | null): ThumbState {
  const key = job ? thumbKey(job) : null;
  const jobRef = useRef(job);
  jobRef.current = job;
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const current = jobRef.current;
      if (!key || !current) return () => undefined;
      appThumbCache.ensure(current);
      return appThumbCache.subscribe(key, listener);
    },
    [key],
  );
  const getSnapshot = useCallback((): ThumbState => (key ? appThumbCache.peek(key) : IDLE), [key]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 구울 크기 — 그릴 자리 × 화면 배율(상한 `APP_THUMB.pixelRatioMax`), 정수. */
export function thumbPixelSize(width: number, height: number, devicePixelRatio: number): { width: number; height: number } {
  const ratio = Math.max(1, Math.min(APP_THUMB.pixelRatioMax, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/**
 * §5.4 #36 (G) — 구울 자리(캔버스 px)를 `APP_THUMB.bakeStep` 단위로 **올려** 잡는다. 노드 크기를 바꿀 때마다 1px 단위로
 * 열쇠가 바뀌어 다시 굽지 않게 — 같은 칸 안의 크기는 앞서 구운 한 장을 그대로 쓴다(올려 잡으므로 흐려지지 않는다).
 */
export function thumbBakeBox(width: number, height: number): { width: number; height: number } {
  const step = APP_THUMB.bakeStep;
  const up = (v: number): number => Math.max(step, Math.ceil((Number.isFinite(v) && v > 0 ? v : step) / step) * step);
  return { width: up(width), height: up(height) };
}

/** 같은 결과(앱·프로젝트·파일·버전)인가 — 크기만 다른 일감은 같은 결과다. */
function resultIdentity(job: ThumbJob): string {
  return JSON.stringify([job.appId, clientPathKey(job.projectId), job.file, job.version]);
}

/**
 * §5.4 #36 (G) — {@link useAppThumbnail} 와 같되, 크기가 바뀌어 **다시 굽는 동안에는 앞 그림을 그대로** 보인다.
 * 같은 결과의 것만 붙든다 — 다른 결과(다른 파일·새 버전)가 오면 놓는다(옛 결과가 새 결과 행세를 하지 않게).
 * 못 구웠으면(`none`) 붙든 것도 놓는다 — 굽지 못한 것을 옛 그림으로 덮어 감추지 않는다.
 */
export function useSteadyThumbnail(job: ThumbJob | null): ThumbState {
  const state = useAppThumbnail(job);
  const identity = job ? resultIdentity(job) : null;
  const held = useRef<{ identity: string; state: ThumbState } | null>(null);
  if (identity === null || (held.current !== null && held.current.identity !== identity)) held.current = null;
  if (identity !== null && state.status === 'ready') held.current = { identity, state };
  if (identity !== null && state.status === 'none') held.current = null;
  if (state.status === 'loading' && held.current !== null) return held.current.state;
  return state;
}

/** 길이 → 화면 모서리 숫자(`0:12` · `1:05:03`). 1초가 안 되는 결과도 `0:01` 로 보인다(0:00 은 "없음"으로 읽힌다). */
export function formatMediaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.max(1, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * 파형 막대들을 SVG path 하나로 — 막대마다 가운데에서 위아래로 같은 길이(`M x,y1 V y2`), 둥근 끝은 그리는 쪽이 준다.
 * path 하나라 막대가 몇 개든 DOM 노드는 하나다.
 *
 * §5.4 #36 (G) — `range` 를 주면 그 막대 구간(`from` 이상 `to` 미만)만 그린다. 자리는 전체 막대 기준 그대로라,
 * 들은 구간(밝게)과 남은 구간(흐리게)을 두 path 로 겹쳐 그리면 한 파형으로 보인다.
 */
export function wavePath(
  peaks: readonly number[],
  width: number,
  height: number,
  pad: number,
  range?: { readonly from: number; readonly to: number },
): { d: string; strokeWidth: number } {
  const n = peaks.length;
  if (n === 0 || width <= pad * 2 || height <= pad * 2) return { d: '', strokeWidth: 0 };
  const step = (width - pad * 2) / n;
  const cy = height / 2;
  const reach = cy - pad;
  const first = range ? Math.max(0, Math.floor(range.from)) : 0;
  const last = range ? Math.min(n, Math.ceil(range.to)) : n;
  let d = '';
  for (let i = first; i < last; i += 1) {
    const v = Math.min(1, Math.max(0, peaks[i] ?? 0));
    const half = Math.max(0.75, v * reach);
    const x = pad + step * (i + 0.5);
    d += `M${x.toFixed(1)},${(cy - half).toFixed(1)}V${(cy + half).toFixed(1)}`;
  }
  return { d, strokeWidth: Math.max(1, step * 0.55) };
}
