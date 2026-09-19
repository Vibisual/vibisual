/**
 * §4 v3.16 모바일 웹 접속 — **화면을 다시 켰을 때 연결을 점검해 제자리 새로고침을 건다.**
 *
 * 폰 크롬은 화면이 꺼지면 탭을 숨기고, 몇 분 뒤에는 얼린다(Page Lifecycle `freeze`). 그 사이 와이파이가
 * 잠들면 WebSocket 은 `onclose` 도 없이 죽은 채 OPEN 으로 남는다. 화면을 다시 켜도 아무것도 안 흘러와
 * 글이 중간에 끊기고 작업이 멈춘 것처럼 보였다(사용자 보고 — PC 에서는 끝까지 써 있는데 폰은 탭을 닫았다
 * 다시 열어야 보인다). 끊긴 것을 알아챈 경우에도 재시도 `MAX_RECONNECT_ATTEMPTS` 번을 다 쓰면 다시는
 * 안 붙었다.
 *
 * 그래서 화면이 돌아오면 아래 판정으로 §5.12 (J) `reconnect` 를 건다. 새 연결은 전체 스냅샷을 다시 받고,
 * 끊겨 있던 동안의 스트림 줄·대기 카드는 재연결 쪽(`reconnectResync.ts`)이 채운다. 판정은 순수 함수라
 * DOM 없이 시험한다(`resumeResync.test.ts`).
 */

/**
 * 이만큼 숨어 있었으면 소켓이 OPEN 이라도 믿지 않고 새로 붙는다. 짧게 가렸다 돌아온 경우(탭 전환 등)는
 * 소켓이 살아 있고 쌓인 메시지가 그대로 들어오므로 전체 스냅샷을 다시 받을 까닭이 없다.
 */
export const RESUME_RESYNC_HIDDEN_MS = 30_000;
/** 복귀 신호는 한 번에 여럿 온다(`resume` → `visibilitychange`, `online`). 한 번만 붙도록 이 간격 안은 무시한다. */
export const RESUME_RESYNC_DEBOUNCE_MS = 2_000;

export type ResumeTrigger =
  /** 숨었다가 다시 보인다(화면 켜기·탭 복귀). */
  | 'visible'
  /** 뒤로 가기 캐시(bfcache)에서 되살아났다 — 그 사이 소켓은 닫혀 있었다. */
  | 'pageshow-restored'
  /** 얼었던 탭이 풀렸다(Page Lifecycle `resume`). */
  | 'frozen-resumed'
  /** 망이 다시 잡혔다 — 주소가 바뀌었으면 옛 소켓은 죽은 것이다. */
  | 'online';

export type SocketState = 'open' | 'connecting' | 'closed';

export interface ResumeResyncInput {
  trigger: ResumeTrigger;
  /**
   * 통합 앱(`window.api` — IPC 전송)인가. 그 전송은 같은 프로세스 안이라 좀비가 되지 않고, 창을 가렸다
   * 돌아올 때마다 전체 스냅샷을 다시 받을 까닭이 없다.
   */
  packaged: boolean;
  /** 숨어 있던 시간(ms). */
  hiddenForMs: number;
  socketState: SocketState;
  /** 이 판정이 마지막으로 새로고침을 건 뒤 지난 시간(ms). 건 적이 없으면 매우 큰 값. */
  sinceLastResyncMs: number;
}

export function shouldResyncOnResume(input: ResumeResyncInput): boolean {
  if (input.packaged) return false;
  if (input.sinceLastResyncMs < RESUME_RESYNC_DEBOUNCE_MS) return false;
  // 얼었다 풀림·캐시 복귀·망 복귀 — 소켓이 OPEN 이라고 적혀 있어도 믿을 근거가 없다.
  if (input.trigger !== 'visible') return true;
  // 이미 끊겨 있다 — 늘어난 backoff(최대 수 분)나 다 써 버린 재시도를 기다리지 않고 지금 붙는다.
  if (input.socketState === 'closed') return true;
  return input.hiddenForMs >= RESUME_RESYNC_HIDDEN_MS;
}

/**
 * 복귀 신호를 모아 `onResume` 하나로 알린다. 해제 함수를 돌려준다.
 *
 * 숨은 시각은 `visibilitychange`(hidden)·`pagehide`·`freeze` 중 가장 먼저 온 것으로 잡는다 — 폰은
 * 화면을 끌 때 셋 중 무엇이 먼저 오는지가 기기마다 다르다.
 */
export function installResumeWatch(
  onResume: (trigger: ResumeTrigger, hiddenForMs: number) => void,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
  const takeHiddenFor = (): number => {
    const ms = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    return ms;
  };
  const markHidden = (): void => {
    if (hiddenAt === null) hiddenAt = Date.now();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      markHidden();
      return;
    }
    onResume('visible', takeHiddenFor());
  };
  const onPageShow = (e: PageTransitionEvent): void => {
    if (!e.persisted) return;
    onResume('pageshow-restored', takeHiddenFor());
  };
  // 크롬은 숨은 채로도 잠깐 풀어 일을 시킬 때가 있다 — 그때는 붙지 않고 다시 보일 때(`visible`)에 맡긴다.
  const onFrozenResume = (): void => {
    if (document.visibilityState !== 'visible') return;
    onResume('frozen-resumed', takeHiddenFor());
  };
  const onOnline = (): void => {
    onResume('online', hiddenAt === null ? 0 : Date.now() - hiddenAt);
  };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', markHidden);
  document.addEventListener('resume', onFrozenResume);
  window.addEventListener('pagehide', markHidden);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onOnline);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', markHidden);
    document.removeEventListener('resume', onFrozenResume);
    window.removeEventListener('pagehide', markHidden);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', onOnline);
  };
}
