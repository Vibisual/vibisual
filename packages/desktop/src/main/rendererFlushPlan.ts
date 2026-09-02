/**
 * rendererFlushPlan.ts — 종료 직전 "렌더러가 아직 안 저장한 손글씨"를 받아 내는 왕복의 **판정부**.
 *
 * **왜 필요한가.** 세션 입력 초안(§5.3 #28) · IDE 폼 초안(§5.5 ⑬) · 명령 히스토리(§5.5 #17-23)는
 * 타이핑 핫패스에 동기 I/O 를 두지 않으려고 400ms debounce 로 localStorage 에 쓰고, 대신
 * `pagehide`/`beforeunload`/`visibilitychange` 에서 즉시 flush 하기로 약속돼 있다. 그런데 우리
 * 종료 경로는 창을 정상적으로 닫지 않고 `app.exit(0)` 으로 프로세스를 즉시 내린다(업데이트 설치기가
 * 68초를 기다리다 포기한 사고 이후 4초 상한 + 즉시 종료로 바뀐 자리다). **그 세 이벤트는 그때
 * 뜨지 않는다** — 약속한 flush 가 실제로는 돌지 않았고, 종료 직전 400ms 안에 친 글자가 사라졌다.
 * 잃는 양은 작지만 대상이 **사용자가 직접 타이핑하던 문장**이라 체감은 크다.
 *
 * 그래서 main 이 종료 정리를 시작하면서 **모든 창에 flush 를 요청하고 응답을 기다린다.**
 * 이 파일은 그 왕복 중 electron 에 닿지 않는 부분만 들고 있다 — 창 목록·IPC·세션은
 * `rendererFlush.ts` 가 맡는다. 판정이 electron 에 붙어 있으면 영영 검증되지 않기 때문이다
 * (`chat/policy.ts` 가 따로 있는 것과 같은 이유).
 *
 * **정확성 규약**
 *  1. **기다림에는 반드시 상한이 있다** — 창 하나가 응답하지 않아도 종료가 멎으면 안 된다.
 *     상한을 넘기면 받은 만큼만 들고 나간다(그 창의 초안은 잃지만 앱은 닫힌다).
 *  2. **요청마다 번호를 매긴다** — 지난 회차의 늦은 응답이 이번 회차를 앞당겨 끝내면,
 *     아직 쓰지 않은 창을 기다리지 않고 나가게 된다.
 *  3. **같은 창의 중복 응답은 한 번으로 센다** — 창이 두 번 답해도 나머지를 기다린다.
 *  4. **보내다 실패한 창은 기다리지 않는다** — 이미 죽은 창이라 영영 답하지 않는다.
 *  5. **어느 경로로 끝나든 구독을 해제한다** — 종료 정리가 길어질 때 리스너가 쌓이지 않게.
 */

/** main → renderer: "지금 초안을 디스크에 밀어라". payload = `{ requestId }`. */
export const FLUSH_DRAFTS_REQUEST_CHANNEL = 'vibisual:lifecycle:flush-drafts';
/** renderer → main: "밀었다". payload = `requestId`(숫자). */
export const FLUSH_DRAFTS_DONE_CHANNEL = 'vibisual:lifecycle:flush-drafts:done';

/**
 * 기다림 상한(ms). 렌더러가 하는 일은 localStorage 동기 쓰기 몇 벌이라 정상이면 한 틱이면 끝난다.
 * 종료 정리 전체 상한(`QUIT_CLEANUP_TIMEOUT_MS` = 4초) 안에 넉넉히 들어가는 값이어야 한다 —
 * 이 대기가 그 상한을 먹으면 업데이트 설치기가 다시 포기한다.
 */
export const FLUSH_DRAFTS_TIMEOUT_MS = 600;

/** 요청을 보낼 창 하나. `send` 가 던지면 그 창은 이미 죽은 것으로 본다(규약 4). */
export interface FlushAckTarget {
  /** `webContents.id` — 어느 창이 답했는지 가르는 열쇠. */
  id: number;
  send: (requestId: number) => void;
}

export interface FlushAckResult {
  /** 요청이 실제로 나간 창 수. */
  requested: number;
  /** 그중 응답한 창 수. */
  acked: number;
  /** 보내다 실패한 창 수(이미 죽음). */
  failed: number;
  /** 상한을 넘겨 나왔는가(= 응답 못 받은 창이 남았다). */
  timedOut: boolean;
}

export interface CollectFlushAcksOptions {
  targets: readonly FlushAckTarget[];
  /** 이번 회차 번호(규약 2). 호출자가 단조 증가시킨다. */
  requestId: number;
  /** ack 구독. 해제 함수를 돌려줘야 한다(규약 5). */
  subscribe: (onAck: (senderId: number, requestId: number) => void) => () => void;
  timeoutMs?: number;
  /** 타이머 주입 — 테스트에서 가짜 시계를 쓰기 위함. 기본은 전역 `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * 모든 창에 flush 를 요청하고 응답을 모은다. **어떤 경우에도 reject 하지 않는다** —
 * 종료 정리가 예외로 끊기면 그게 더 큰 손실이다.
 */
export function collectFlushAcks(opts: CollectFlushAcksOptions): Promise<FlushAckResult> {
  const {
    targets,
    requestId,
    subscribe,
    timeoutMs = FLUSH_DRAFTS_TIMEOUT_MS,
    setTimer = (fn, ms): unknown => setTimeout(fn, ms),
    clearTimer = (h): void => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  return new Promise<FlushAckResult>((resolve) => {
    // 구독을 **보내기 전에** 건다 — 렌더러가 같은 틱에 답해도 놓치지 않는다.
    const acked = new Set<number>();
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: unknown = null;
    let requested = 0;
    let failed = 0;
    /**
     * 아직 요청을 다 보내지 않았는가.
     *
     * ⚠ 이 깃발이 없으면 **같은 틱에 답하는 창 하나가 나머지를 두고 나가게 만든다** — 첫 창이
     *   `send()` 안에서 곧바로 답하면 그 순간 `requested` 는 아직 1 이라 "전부 받았다"가 성립한다.
     *   실제 Electron IPC 는 비동기라 눈에 안 띄지만, 판정이 보내는 순서에 기대면 안 된다.
     */
    let sending = true;

    const finish = (timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) { try { clearTimer(timer); } catch { /* 이미 해제됨 */ } timer = null; }
      // 규약 5 — 어느 경로로 끝나든 반드시 해제.
      if (unsubscribe) { try { unsubscribe(); } catch { /* 이미 해제됨 */ } unsubscribe = null; }
      resolve({ requested, acked: acked.size, failed, timedOut });
    };

    /** 보낸 창이 전부 답했으면 끝낸다. 보내는 중에는 절대 판정하지 않는다. */
    const finishIfAllAcked = (): void => {
      if (sending || requested === 0) return;
      if (acked.size >= requested) finish(false);
    };

    try {
      unsubscribe = subscribe((senderId, ackRequestId) => {
        // 규약 2 — 지난 회차의 늦은 응답은 이번 회차를 끝내지 못한다.
        if (ackRequestId !== requestId) return;
        // 규약 3 — 같은 창의 중복 응답은 한 번.
        acked.add(senderId);
        finishIfAllAcked();
      });
    } catch {
      // 구독조차 못 걸면 기다릴 방법이 없다 — 기다리지 않고 나간다.
      resolve({ requested: 0, acked: 0, failed: targets.length, timedOut: false });
      return;
    }

    for (const t of targets) {
      try {
        t.send(requestId);
        requested += 1;
      } catch {
        failed += 1; // 규약 4 — 이미 죽은 창은 기다리지 않는다.
      }
    }
    sending = false;

    // 보낼 곳이 하나도 없으면(창 0개 · 전부 죽음) 즉시 끝낸다.
    if (requested === 0) { finish(false); return; }
    // 같은 틱에 이미 전부 답했을 수 있다(동기 구독 경로).
    finishIfAllAcked();
    if (settled) return;

    // 규약 1 — 기다림에는 반드시 상한이 있다.
    timer = setTimer(() => finish(true), timeoutMs);
  });
}
