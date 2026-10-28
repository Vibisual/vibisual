/**
 * checkpointCoalescer.ts — §9 체크포인트 저장 배치의 창(window) 단독 소유.
 * hook-event 도구 이벤트 경로(모델 도구 사용 빈도로 오는 유일한 폭주 경로)의 `saveCheckpoint()` 만 부하 적응형 trailing 창으로 묶는다(기본 500ms, 직전 실측 저장 비용 × 배수, 상한 5s). 나머지 호출 지점은 §3.2.1 #4 대로 즉시 저장.
 * 종료 경로는 `flushPendingCheckpointSave()` 를 명시적으로 부른다(desktop main `before-quit`) — Electron 종료는 `app.exit(0)` 이라 Node `exit` 이벤트가 안 돌 수 있어, 그것만 믿으면 마지막 창(0.5~5초)이 사라진다. `process.on('exit')` 는 최후 그물이고 둘 다 `flushSync()` 를 지나 중복 저장되지 않는다.
 * 규약 ① 종료 flush 는 `dirtyOnly` 없이 전 프로젝트 전량(내구성 우선). ② 예약이 없으면 저장하지 않는다 — 디스크가 이미 최신이고, 매번 전량이면 탭이 많을수록 종료가 느려져 업데이트 설치기가 포기한다.
 * ③ 전 구간 동기 — `process 'exit'` 는 동기만 허용하고 `before-quit` 는 곧바로 디스크 큐를 내린다. ④ 저장 실패는 삼킨다(나머지 정리를 건너뛰면 안 된다) — 실패분은 다음 부팅 §3.2.1-4 백업 복구가 맡는다.
 */

/** 저장 창구 — `runServer()` 의 `saveCheckpoint` 시그니처와 같다. */
export type CheckpointSaveFn = (opts?: { dirtyOnly?: boolean }) => void;

export interface CheckpointCoalescerOptions {
  /** 실제 저장. 예약 발화는 `{ dirtyOnly: true }`, 종료 flush 는 인자 없이(전량) 부른다. */
  save: CheckpointSaveFn;
  /** 기본 창 길이(ms) — `CHECKPOINT_BATCH_INTERVAL`. */
  baseIntervalMs: number;
  /** 창 상한(ms) — `CHECKPOINT_BATCH_INTERVAL_MAX`. */
  maxIntervalMs: number;
  /** 다음 창 = 직전 실측 저장 비용 × 이 배수 — `WS_BATCH_BACKOFF_FACTOR`. */
  backoffFactor: number;
  /** 저장 비용 실측용 시계(ms). 테스트에서 주입한다. 기본은 `performance.now`. */
  now?: () => number;
  /** 저장 실패 보고(로그). 던지지 않는다. */
  onError?: (err: unknown, phase: 'scheduled' | 'flush') => void;
}

export class CheckpointCoalescer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delayMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: CheckpointCoalescerOptions) {
    this.delayMs = opts.baseIntervalMs;
    this.now = opts.now ?? ((): number => performance.now());
  }

  /** 예약된 창이 있는가(= 아직 디스크에 안 앉은 훅 이벤트가 있는가). */
  get pending(): boolean {
    return this.timer !== null;
  }

  /** 다음 창 길이(ms) — 부하 적응 결과. 진단·테스트용. */
  get nextDelayMs(): number {
    return this.delayMs;
  }

  /**
   * 창 예약. 이미 예약돼 있으면 아무것도 하지 않는다 — trailing 이라 **마지막 상태**가 저장되므로
   * 창 안에서 몇 건이 더 와도 다시 걸 이유가 없다.
   */
  schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const t0 = this.now();
      try {
        // §9 "저장은 바뀐 프로젝트만" — 이 경로(훅 도구 이벤트)에서만 좁힌다.
        //   `processHookEvent` 가 변경 카운터를 반드시 올리므로 여기서는 판정이 신뢰된다.
        this.opts.save({ dirtyOnly: true });
      } catch (err) {
        this.opts.onError?.(err, 'scheduled');
      }
      const cost = this.now() - t0;
      this.delayMs = Math.min(
        Math.max(this.opts.baseIntervalMs, cost * this.opts.backoffFactor),
        this.opts.maxIntervalMs,
      );
    }, this.delayMs);
  }

  /**
   * **종료 경로 전용** — 예약된 창을 지금 동기로 마무리한다.
   * @returns 저장했으면 `true`, 예약이 없었으면 `false`(두 번째 호출은 항상 `false` — `before-quit`·`process 'exit'` 가 겹쳐도 중복 저장 ❌).
   */
  flushSync(): boolean {
    if (this.timer === null) return false;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      // 규약 1 — 종료 flush 는 전 프로젝트 전량이다(변경 판정 ❌).
      this.opts.save();
    } catch (err) {
      // 규약 4 — 삼킨다. 다음 부팅의 백업 복구에 위임.
      this.opts.onError?.(err, 'flush');
    }
    return true;
  }

  /** 예약만 취소한다(저장 ❌). 테스트·재구성용. */
  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

// 종료 경로가 부를 수 있는 단일 창구 — desktop main 은 `runServer()` 지역 변수에 닿을 수 없어 모듈 싱글턴으로 둔다(`enableAsyncDiskWrites`/`flushPendingDiskWritesSync` 와 같은 형태).

let active: CheckpointCoalescer | null = null;

/** `runServer()` 가 자기 코얼레서를 등록한다. `null` 로 해제. */
export function setActiveCheckpointCoalescer(coalescer: CheckpointCoalescer | null): void {
  active = coalescer;
}

/**
 * 예약된 체크포인트 창을 **지금 동기로** 마무리한다(§3.2.1 내구성).
 *
 * 종료 정리(`before-quit`)는 디스크 큐를 내리기(`shutdownDiskWriteQueue`) **직전에** 이걸 부른다 —
 * 순서가 뒤집히면 이 저장이 만든 쓰기가 큐에 남은 채 프로세스가 사라진다.
 *
 * @returns 실제로 저장했으면 `true`. 서버가 아직 안 떴거나 예약이 없으면 `false`(정상).
 */
export function flushPendingCheckpointSave(): boolean {
  try {
    return active?.flushSync() ?? false;
  } catch {
    // 마지막 방어선 — 종료 정리를 예외로 끊지 않는다.
    return false;
  }
}

/** 진단·테스트용 — 지금 예약된 창이 있는가. */
export function hasPendingCheckpointSave(): boolean {
  return active?.pending ?? false;
}
