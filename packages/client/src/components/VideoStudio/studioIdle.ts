/**
 * §5.13 (Y) 40-10 ④ — 스튜디오의 배경 일 줄 하나. 당장 보일 필요가 없는 일(대표 프레임 굽기·비트 재기·소리 조각 데우기·노드 포스터)을 모아
 * 재생·끌기·입력 중에는 쉬고 한가하면 낮은 우선순위로 돈다 — 저마다 타이머를 들면 재생과 CPU·메인 스레드를 다툰다.
 * `scheduler.postTask` 의 `background`(Chromium 94+ — 31 에서 된다), 없으면 `setTimeout`. 긴 일은 `yieldToMain()` 으로 쪼갠다
 * (`scheduler.yield` 는 129+ 라 31 에 없다). 창(렌더러)마다 한 벌 — 그 창의 스튜디오들이 같은 바쁨을 본다.
 */

export type StudioBusyReason = 'playing' | 'scrubbing' | 'typing';

/** 입력이 멎은 뒤 이만큼(ms) 지나야 한가하다고 본다. */
export const STUDIO_TYPING_QUIET_MS = 800;

const holders = new Map<StudioBusyReason, number>();
const listeners = new Set<() => void>();
let typingTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** 바쁨을 걸거나 푼다(같은 이유를 여럿이 걸 수 있다 — 센다). */
export function setStudioBusy(reason: StudioBusyReason, on: boolean): void {
  const count = Math.max(0, (holders.get(reason) ?? 0) + (on ? 1 : -1));
  if (count === 0) holders.delete(reason);
  else holders.set(reason, count);
  notify();
}

export function isStudioBusy(): boolean {
  return holders.size > 0;
}

/** 입력이 있었다 — 잠깐(`STUDIO_TYPING_QUIET_MS`) 바쁘다. */
export function noteStudioInput(): void {
  if (typingTimer === null) setStudioBusy('typing', true);
  else clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingTimer = null;
    setStudioBusy('typing', false);
  }, STUDIO_TYPING_QUIET_MS);
}

function waitUntilIdle(signal?: AbortSignal): Promise<void> {
  if (!isStudioBusy()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (signal?.aborted) { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
      if (!isStudioBusy()) { cleanup(); resolve(); }
    };
    const cleanup = (): void => {
      listeners.delete(check);
      signal?.removeEventListener('abort', check);
    };
    listeners.add(check);
    signal?.addEventListener('abort', check, { once: true });
  });
}

interface PostTaskScheduler {
  postTask<T>(task: () => T | Promise<T>, options?: { priority?: 'user-blocking' | 'user-visible' | 'background'; signal?: AbortSignal; delay?: number }): Promise<T>;
}

function backgroundScheduler(): PostTaskScheduler | null {
  const s = (globalThis as { scheduler?: Partial<PostTaskScheduler> }).scheduler;
  return s && typeof s.postTask === 'function' ? (s as PostTaskScheduler) : null;
}

/**
 * 한가할 때 낮은 우선순위로 돈다. `delayMs` 만큼 먼저 기다리고(디바운스), 바쁘면 풀릴 때까지 기다린 뒤 돈다. 도는 중에 바빠져도
 * 끊지는 않는다 — 긴 일은 스스로 `yieldToMain()`·`waitStudioIdle()` 로 쪼개 쉰다.
 */
export async function runWhenIdle<T>(task: () => T | Promise<T>, opts: { readonly signal?: AbortSignal; readonly delayMs?: number } = {}): Promise<T> {
  const { signal } = opts;
  signal?.throwIfAborted();
  if (opts.delayMs && opts.delayMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, opts.delayMs);
      const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  await waitUntilIdle(signal);
  signal?.throwIfAborted();
  const scheduler = backgroundScheduler();
  if (scheduler) return scheduler.postTask(task, { priority: 'background', ...(signal ? { signal } : {}) });
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      try { signal?.throwIfAborted(); Promise.resolve(task()).then(resolve, reject); } catch (error) { reject(error); }
    }, 0);
  });
}

/** 긴 배경 일 사이사이 — 메인 스레드에 한 번 양보하고, 그 사이 바빠졌으면 한가해질 때까지 쉰다. */
export async function waitStudioIdle(signal?: AbortSignal): Promise<void> {
  await yieldToMain();
  await waitUntilIdle(signal);
}

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetStudioIdleForTest(): void {
  holders.clear();
  listeners.clear();
  if (typingTimer !== null) clearTimeout(typingTimer);
  typingTimer = null;
}
