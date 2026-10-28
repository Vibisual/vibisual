/**
 * 아직 디스크에 안 앉힌 손글씨를 한 번에 미는 단일 창구 — 세션 입력 초안(§5.3 #28) · IDE 폼 초안(§5.5 ⑬) · 명령 히스토리(§5.5 #17-23).
 * 셋 다 타이핑 핫패스에 동기 I/O 를 두지 않으려고 debounce 로 localStorage 에 쓴다. 앱 종료는 `app.exit(0)` 이라 `pagehide`/`beforeunload`/`visibilitychange` 가
 * 뜨지 않으므로, main 이 종료 직전에 "지금 밀어라"를 묻고(§3.2.1) 여기서 받는다. 새 저장소는 `registerPersistFlush` 한 줄이면 포함된다.
 * 규약: 1. 등록은 모듈 초기화에서 각 저장소가 스스로(중앙 목록 ❌ — 순환 의존이 생겨 §3.4 의존성 방향이 무너진다)
 * 2. 하나가 던져도 나머지는 민다(한 저장소의 quota 초과가 다른 손글씨를 잃게 하면 안 된다) 3. 여러 번 불려도 안전 — 밀 것이 없으면 no-op.
 */

/** 저장소 하나의 "지금 밀어라". 동기여야 한다 — 종료 직전에 불린다. */
export type PersistFlushFn = () => void;

const flushers = new Set<PersistFlushFn>();

/** A durable writer resolves true only after its newest draft has reached storage. */
export type DurableFlushFn = () => Promise<boolean>;
const durableFlushers = new Map<DurableFlushFn, (() => void) | undefined>();

export function registerDurableFlush(fn: DurableFlushFn, release?: () => void): () => void {
  durableFlushers.set(fn, release);
  return () => { durableFlushers.delete(fn); };
}

/** All writers get a chance to save; one failure must prevent teardown. */
export async function flushAllDurable(): Promise<boolean> {
  const results = await Promise.allSettled([...durableFlushers.keys()].map(async (flush) => flush()));
  return results.every((result) => result.status === 'fulfilled' && result.value === true);
}

/** Resume editing when shutdown was canceled, failed, or will be retried. */
export function releaseDurableFlushes(): void {
  for (const release of [...durableFlushers.values()]) {
    try { release?.(); } catch { /* One editor must not keep other editors locked. */ }
  }
}

/**
 * 저장소의 flush 를 창구에 올린다.
 * @returns 해제 함수(테스트·핫리로드용). 앱 코드는 보통 버려도 된다 — 모듈은 프로세스와 함께 산다.
 */
export function registerPersistFlush(fn: PersistFlushFn): () => void {
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}

/**
 * 올라온 flush 를 **전부** 부른다.
 *
 * @returns 실제로 부른 개수(진단용). 규약 2 대로 예외는 삼키고 다음으로 넘어간다.
 */
export function flushAllPersisted(): number {
  let ran = 0;
  // 순회 중 등록/해제가 일어나도 안전하도록 사본으로 돈다.
  for (const fn of [...flushers]) {
    try {
      fn();
    } catch (err) {
      // 한 저장소의 실패가 다른 저장소의 손글씨를 같이 잃게 하지 않는다.
      try {
        console.error('[persistFlush] a flusher failed', err);
      } catch {
        // 진단 전송까지 실패해도 뒤에 등록된 초안은 계속 저장해야 한다.
      }
    }
    ran += 1;
  }
  return ran;
}

/** 진단·테스트용 — 지금 올라온 flush 개수. */
export function persistFlushCount(): number {
  return flushers.size;
}

/**
 * main 의 "지금 밀어라"에 이 창구를 연결한다. 부팅 지점에서 한 번만 부른다.
 * `window.api`·`lifecycle` 이 없으면(웹 모드·구버전 preload) 아무것도 하지 않는다 — 그 환경은 창이 정상으로 닫혀 `pagehide` 가 뜬다.
 * @returns 구독 해제 함수(연결되지 않았으면 no-op).
 */
export function installPersistFlushBridge(): () => void {
  if (typeof window === 'undefined') return () => { /* SSR·테스트 */ };
  const onFlush = window.api?.lifecycle?.onFlushDrafts;
  if (!onFlush) return () => { /* 웹 모드·구버전 preload */ };
  const offFlush = onFlush(async () => {
    flushAllPersisted();
    return flushAllDurable();
  });
  const offRelease = window.api?.lifecycle?.onFlushDraftsCanceled?.(releaseDurableFlushes);
  return () => { offFlush(); offRelease?.(); };
}
