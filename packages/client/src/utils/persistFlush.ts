/**
 * persistFlush.ts — "아직 디스크에 안 앉힌 손글씨"를 한 번에 미는 단일 창구.
 *
 * **무엇을 모으나.** 사용자가 쳤지만 아직 서버로 보내지 않은 값들이다 — 세션 입력 초안
 * (§5.3 #28) · IDE 폼 초안(§5.5 ⑬) · 명령 히스토리(§5.5 #17-23). 셋 다 타이핑 핫패스에 동기
 * I/O 를 두지 않으려고 **debounce 로 localStorage 에 쓰고**, 창이 숨거나 닫힐 때 즉시 flush 한다.
 *
 * **왜 창구가 하나 필요한가.** 각자 `pagehide`/`beforeunload`/`visibilitychange` 를 직접 듣고
 * 있었는데, 앱 종료는 창을 정상으로 닫지 않고 `app.exit(0)` 으로 프로세스를 내리므로 **그 세
 * 이벤트가 뜨지 않는다.** main 이 종료 직전에 "지금 밀어라"를 물어봐 주기로 했고(§3.2.1),
 * 그 물음을 받는 자리가 여기다. main 은 어떤 초안이 몇 벌인지 알 필요가 없고, 새 초안 저장소가
 * 생겨도 `registerPersistFlush` 한 줄이면 자동으로 그 물음에 포함된다.
 *
 * **규약**
 *  1. **등록은 모듈 초기화에서** — 각 저장소가 자기 `flush` 를 스스로 올린다(중앙 목록 ❌,
 *     한 곳에서 import 로 끌어모으면 순환 의존이 생기고 §3.4 의존성 방향이 무너진다).
 *  2. **하나가 던져도 나머지는 민다** — 한 저장소의 quota 초과가 다른 저장소의 손글씨를
 *     같이 잃게 만들면 안 된다.
 *  3. **여러 번 불려도 안전해야 한다** — 각 `flush` 는 이미 밀 것이 없으면 no-op 이다.
 */

/** 저장소 하나의 "지금 밀어라". 동기여야 한다 — 종료 직전에 불린다. */
export type PersistFlushFn = () => void;

const flushers = new Set<PersistFlushFn>();

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
      console.error('[persistFlush] a flusher failed', err);
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
 * main 의 "지금 밀어라"에 이 창구를 연결한다. **부팅 지점에서 한 번만** 부른다.
 *
 * `window.api` 가 없거나(웹 모드·구버전 preload) `lifecycle` 이 없으면 조용히 아무것도 하지
 * 않는다 — 그 환경에서는 창이 정상으로 닫혀 `pagehide` 가 뜨므로 종전 경로가 그대로 산다.
 *
 * @returns 구독 해제 함수(연결되지 않았으면 no-op).
 */
export function installPersistFlushBridge(): () => void {
  if (typeof window === 'undefined') return () => { /* SSR·테스트 */ };
  const onFlush = window.api?.lifecycle?.onFlushDrafts;
  if (!onFlush) return () => { /* 웹 모드·구버전 preload */ };
  return onFlush(() => { flushAllPersisted(); });
}
