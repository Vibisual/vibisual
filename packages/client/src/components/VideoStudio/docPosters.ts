import { fetchDocPoster, type DocSummary } from './videoApi.js';
import { runWhenIdle } from './studioIdle.js';

/**
 * §5.13 (V) 37-1 — 문서 갤러리 포스터 일감 줄. 그리는 쪽은 숨은 일꾼 창이라 요청 하나가 곧 일감이다 — 보이는 카드만 청하고 동시에 걸리는 수를 묶는다.
 *  ① 디스크 묻기(`render=0`)는 가볍다 — 동시 `PROBE_CONCURRENCY`.
 *  ② 디스크에 없을 때만 굽는다(`render=1`) — 동시 1, 스튜디오가 한가할 때(`runWhenIdle` — 재생·끌기·입력 중에는 쉰다). 서버는 그 일감을 배경으로 세워 에이전트·스튜디오 일감 뒤로 보낸다.
 *  ③ 기억은 판본(`version`·`updatedAt`)까지 열쇠에 품는다 — 문서가 안 바뀌었으면 다시 묻지 않는다. 바이트 예산 LRU(§3.2.4 F).
 *  ④ 카드가 화면을 벗어나거나 판이 닫히면 기다리던 요청을 취소한다(이미 나간 요청의 결과는 버리지 않고 기억한다).
 */

export const PROBE_CONCURRENCY = 4;
export const BAKE_CONCURRENCY = 1;
/** 창 안 포스터 기억의 바이트 예산(데이터 주소 글자 수 — 320px webp 한 장은 보통 10~30KB). */
export const POSTER_CACHE_BYTES = 16 * 1024 * 1024;

/** 기억 값의 뜻 — 그림 데이터 주소 · `''` = 그릴 것이 없는 문서 · `FAILED` = 못 얻음(판을 다시 열면 한 번 더 청한다). */
export const POSTER_FAILED = '!';

const cache = new Map<string, string>();
let cacheBytes = 0;
const listeners = new Map<string, Set<() => void>>();

interface Job {
  readonly key: string;
  readonly project: string;
  readonly docId: string;
  refs: number;
  stage: 'probe-wait' | 'probe' | 'bake-wait' | 'bake';
  readonly abort: AbortController;
}
const pending = new Map<string, Job>();
const probeQueue: Job[] = [];
const bakeQueue: Job[] = [];
let probing = 0;
let baking = 0;

export function posterKey(project: string, doc: Pick<DocSummary, 'id' | 'version' | 'updatedAt'>): string {
  return `${project}\u0000${doc.id}\u0000${doc.version}\u0000${doc.updatedAt}`;
}

function notify(key: string): void {
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

function remember(key: string, value: string): void {
  const prev = cache.get(key);
  if (prev !== undefined) { cacheBytes -= prev.length; cache.delete(key); }
  cache.set(key, value);
  cacheBytes += value.length;
  while (cacheBytes > POSTER_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    cacheBytes -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
    notify(oldest);
  }
  notify(key);
}

/** 기억한 값(없으면 `undefined`) — 꺼내 볼 때 뒤로 옮긴다. */
export function recallPoster(key: string): string | undefined {
  const value = cache.get(key);
  if (value !== undefined) { cache.delete(key); cache.set(key, value); }
  return value;
}

export function subscribePoster(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** 판을 다시 열 때 — 못 얻었던 포스터를 한 번 더 청할 수 있게 비운다. */
export function forgetFailedPosters(): void {
  for (const [key, value] of [...cache]) {
    if (value !== POSTER_FAILED) continue;
    cacheBytes -= value.length;
    cache.delete(key);
    notify(key);
  }
}

function finish(job: Job): void {
  if (pending.get(job.key) === job) pending.delete(job.key);
}

function drop(queue: Job[], job: Job): void {
  const at = queue.indexOf(job);
  if (at >= 0) queue.splice(at, 1);
}

function pumpProbe(): void {
  while (probing < PROBE_CONCURRENCY) {
    const job = probeQueue.shift();
    if (!job) return;
    job.stage = 'probe';
    probing += 1;
    void fetchDocPoster(job.project, job.docId, false)
      .then((r) => {
        if (r.image) { remember(job.key, r.image); finish(job); return; }
        if (r.state === 'empty') { remember(job.key, ''); finish(job); return; }
        if (job.refs <= 0) { finish(job); return; }
        job.stage = 'bake-wait';
        bakeQueue.push(job);
        pumpBake();
      })
      .catch(() => { remember(job.key, POSTER_FAILED); finish(job); })
      .finally(() => { probing -= 1; pumpProbe(); });
  }
}

function pumpBake(): void {
  while (baking < BAKE_CONCURRENCY) {
    const job = bakeQueue.shift();
    if (!job) return;
    job.stage = 'bake';
    baking += 1;
    runWhenIdle(() => fetchDocPoster(job.project, job.docId, true), { signal: job.abort.signal })
      .then((r) => remember(job.key, r.image ?? (r.state === 'empty' ? '' : POSTER_FAILED)))
      .catch(() => { if (!job.abort.signal.aborted) remember(job.key, POSTER_FAILED); })
      .finally(() => { baking -= 1; finish(job); pumpBake(); });
  }
}

/**
 * 이 문서의 포스터를 청한다(이미 기억했거나 같은 열쇠가 줄에 있으면 새로 만들지 않는다). 돌려주는 함수가 취소다 —
 * 아직 줄에서 기다리는 요청만 걷고, 나간 요청은 끝나는 대로 기억에 남는다.
 */
export function requestPoster(project: string, doc: Pick<DocSummary, 'id' | 'version' | 'updatedAt'>): () => void {
  const key = posterKey(project, doc);
  if (cache.has(key)) return () => undefined;
  let job = pending.get(key);
  // 굽기를 취소한 일감은 멈춘 채 남아 있을 수 있다 — 같은 열쇠를 다시 청하면 새로 세운다.
  if (job?.abort.signal.aborted) { finish(job); job = undefined; }
  if (!job) {
    job = { key, project, docId: doc.id, refs: 0, stage: 'probe-wait', abort: new AbortController() };
    pending.set(key, job);
    probeQueue.push(job);
  }
  const mine = job;
  mine.refs += 1;
  pumpProbe();
  let canceled = false;
  return () => {
    if (canceled) return;
    canceled = true;
    mine.refs -= 1;
    if (mine.refs > 0) return;
    if (mine.stage === 'probe-wait') { drop(probeQueue, mine); finish(mine); }
    else if (mine.stage === 'bake-wait') { drop(bakeQueue, mine); finish(mine); }
    else if (mine.stage === 'bake') mine.abort.abort();
  };
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetPostersForTest(): void {
  cache.clear();
  cacheBytes = 0;
  listeners.clear();
  pending.clear();
  probeQueue.length = 0;
  bakeQueue.length = 0;
  probing = 0;
  baking = 0;
}

/** 시험 전용 — 지금 줄·동시 수. */
export function __posterQueueForTest(): { readonly probeWaiting: number; readonly bakeWaiting: number; readonly probing: number; readonly baking: number } {
  return { probeWaiting: probeQueue.length, bakeWaiting: bakeQueue.length, probing, baking };
}
