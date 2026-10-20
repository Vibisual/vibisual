import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { APP_LINKED_ITEMS } from '@vibisual/shared';

import { clientPathKey } from '../utils/platform.js';
import {
  INTERNAL_APPS,
  appOutputExtensions,
  getInternalApp,
  type AppLinkedItem,
  type AppLinkedItemsReader,
  type AppLinkedItemsRequest,
  type AppLinkedItemsSnapshot,
} from './registry.js';

/**
 * §5.4 #36 (H) ③ — 앱 노드 **구슬 줄**("연결된 것")의 기억 장소와 읽기.
 *
 * - 무엇을 읽는지는 앱이 레지스트리 `linkedItems` 로 선언한다(늦은 로더 — 그 노드가 보일 때만 앱 청크가 내려온다).
 *   코어는 앱 이름을 모른다(§5.13 (P-4)).
 * - 노드가 마운트된 동안 `APP_LINKED_ITEMS.pollMs` 마다 다시 묻는다 — 에이전트가 장면·소재를 더하면 저절로 는다.
 *   창이 가려져 있으면(`document.hidden`) 묻지 않는다.
 * - 결과는 **모듈에 남는다** — 캔버스는 화면 밖 노드를 언마운트하지만, 돌아오면 앞 결과가 바로 보인다. 열쇠는 앱 ·
 *   프로젝트 경로키(`clientPathKey` — 멀티플랫폼 1축) · 문서 · 파일. 상한 `cacheMax` 를 넘으면 오래 안 본 것부터 버린다
 *   (지금 그려지는 것·묻는 중인 것은 버리지 않는다).
 * - 한 번 묻는 시간 상한 `readTimeoutMs` — 넘거나 못 읽으면 그 회차는 건너뛰고 **앞 결과를 지우지 않는다**.
 * - 같은 열쇠의 노드가 둘 마운트돼도(본창·별창) 묻는 것은 하나다 — 진행 중인 물음이 있으면 기다린다.
 */

const EMPTY: readonly AppLinkedItem[] = [];

interface Entry {
  snap: AppLinkedItemsSnapshot | null;
  readonly listeners: Set<() => void>;
  usedAt: number;
  inflight: boolean;
}

const entries = new Map<string, Entry>();
let clock = 0;

/**
 * §5.1 #2-1 (B) — 어느 노드든 "연결된 것"의 판본이 바뀌면 오르는 전역 판본. 캔버스의 별자리 판정(앱 노드 중심)이
 * 이것 하나만 구독한다 — 노드마다 따로 구독하면 노드 수만큼 판정이 다시 돈다.
 */
let itemsVersion = 0;
const versionListeners = new Set<() => void>();

function bumpItemsVersion(): void {
  itemsVersion += 1;
  for (const listener of [...versionListeners]) listener();
}

/** §5.1 #2-1 — 전역 판본 구독(`useSyncExternalStore` 용). */
export function subscribeAppLinkedItemsVersion(listener: () => void): () => void {
  versionListeners.add(listener);
  return () => {
    versionListeners.delete(listener);
  };
}

/** §5.1 #2-1 — 지금 전역 판본. */
export function appLinkedItemsVersion(): number {
  return itemsVersion;
}

/**
 * §5.1 #2-1 — 그 노드의 "연결된 것"을 **묻지 않고** 기억된 결과만 꺼낸다(없으면 빈 목록). 묻는 것은 노드가 마운트된
 * 동안 `useAppLinkedItems` 가 한다 — 별자리는 보이는 노드가 이미 읽어 둔 것을 빌려 쓸 뿐 새 요청을 만들지 않는다.
 */
export function peekAppLinkedItems(appId: string, req: AppLinkedItemsRequest): readonly AppLinkedItem[] {
  return entries.get(linkedItemsKey(appId, req))?.snap?.items ?? EMPTY;
}

/** 앱마다 한 번 부르는 늦은 로더. 청크를 못 받았으면 다음에 다시 시도한다(실패를 영영 붙들지 않는다). */
const readers = new Map<string, Promise<AppLinkedItemsReader | null>>();
function loadReader(appId: string): Promise<AppLinkedItemsReader | null> {
  const hit = readers.get(appId);
  if (hit) return hit;
  const loader = getInternalApp(appId)?.linkedItems;
  const next = loader
    ? loader().catch(() => {
        readers.delete(appId);
        return null;
      })
    : Promise.resolve(null);
  readers.set(appId, next);
  return next;
}

export function linkedItemsKey(appId: string, req: AppLinkedItemsRequest): string {
  // JSON 으로 묶는다 — 구분자 한 글자로 이으면 그 글자가 경로 안에 있을 때 두 열쇠가 같아진다.
  return JSON.stringify([appId, clientPathKey(req.projectId), req.ref ?? '', req.file ?? '']);
}

function evict(): void {
  if (entries.size <= APP_LINKED_ITEMS.cacheMax) return;
  const victims = [...entries.entries()]
    .filter(([, e]) => e.listeners.size === 0 && !e.inflight)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [key] of victims) {
    if (entries.size <= APP_LINKED_ITEMS.cacheMax) break;
    entries.delete(key);
  }
}

function entryOf(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { snap: null, listeners: new Set(), usedAt: (clock += 1), inflight: false };
    entries.set(key, e);
    evict();
  }
  return e;
}

/** 한 번 묻는다. 시간 상한을 넘기거나 못 읽으면 앞 결과 그대로. 판본(`key`)이 같으면 아무도 깨우지 않는다. */
function refresh(appId: string, req: AppLinkedItemsRequest, key: string): void {
  const e = entryOf(key);
  e.usedAt = clock += 1;
  if (e.inflight) return;
  e.inflight = true;
  void (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reader = await loadReader(appId);
      if (!reader) return;
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), APP_LINKED_ITEMS.readTimeoutMs);
      });
      const won = await Promise.race([reader(req), late]);
      if (won === 'late' || won === null) return;
      if (e.snap !== null && e.snap.key === won.key) return;
      e.snap = won;
      for (const listener of [...e.listeners]) listener();
      bumpItemsVersion();
    } catch {
      // 못 읽었다 — 앞 결과를 지우지 않는다(다음 회차가 다시 묻는다).
    } finally {
      clearTimeout(timer);
      e.inflight = false;
    }
  })();
}

/**
 * 그 노드의 "연결된 것". `appId`·`req` 중 하나라도 없으면 묻지 않고 빈 목록이다(노드가 접혔거나 선언 없는 앱).
 * 구독은 열쇠 하나 — 판본이 바뀔 때만 그 노드가 다시 그려진다.
 */
export function useAppLinkedItems(appId: string | null, req: AppLinkedItemsRequest | null): readonly AppLinkedItem[] {
  const key = appId !== null && req !== null ? linkedItemsKey(appId, req) : null;
  const reqRef = useRef(req);
  reqRef.current = req;

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      if (key === null) return () => undefined;
      const e = entryOf(key);
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
        evict();
      };
    },
    [key],
  );
  const getSnapshot = useCallback(
    (): readonly AppLinkedItem[] => (key !== null ? entries.get(key)?.snap?.items ?? EMPTY : EMPTY),
    [key],
  );
  const items = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (key === null || appId === null) return undefined;
    const tick = (): void => {
      const current = reqRef.current;
      if (current === null) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh(appId, current, key);
    };
    tick();
    const timer = setInterval(tick, APP_LINKED_ITEMS.pollMs);
    return () => clearInterval(timer);
  }, [key, appId]);

  return items;
}

/**
 * 이 파일의 작은 미리보기를 **어느 앱이 굽나** — 그 확장자를 받겠다고 선언했고(`outputs` 없으면 `opens`) 굽는 함수
 * (`thumbnail`)가 있는 첫 앱. 코어는 확장자 표를 들지 않는다(§5.13 (R-1) 과 같은 규율). 없으면 `null` — 아이콘으로 둔다.
 */
export function thumbnailAppFor(file: string): string | null {
  const dot = file.lastIndexOf('.');
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (dot <= slash + 1) return null;
  const ext = file.slice(dot).toLowerCase();
  for (const app of INTERNAL_APPS) {
    if (app.thumbnail && appOutputExtensions(app).includes(ext)) return app.id;
  }
  return null;
}
