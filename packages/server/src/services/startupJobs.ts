/**
 * startupJobs.ts — §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ②. **부팅 한 번짜리 확인은 창이 보인 뒤 한 칸씩.**
 *
 * 서버는 창의 입력을 받는 메인 스레드에서 함께 돈다(§3.7). 부팅 때 걸던 확인들(Claude 설치 1.2초 · 로그인
 * 1.5초 · 사용량 2초 · 코덱스 2초 · 훅 전송 4초)은 `runServer` 맨 앞에서 **부팅 시작 기준**으로 걸려, 부팅이
 * 느리면 창이 뜨는 그 순간 한꺼번에 터졌다 — 저마다 CLI 프로세스를 띄우고(Windows 는 프로세스 생성이 동기다)
 * 스냅샷을 다시 민다. 그 사이 사용자가 제목줄을 잡으면 창이 따라오지 않았다.
 *
 * 그래서 줄에 세웠다가 본체 창이 처음 보일 때(`releaseStartupJobs` — desktop main 이 부른다) 원래 순서 그대로
 * 한 칸씩 돌린다. 창 소식이 끝내 안 오면(창 없는 실행·시험) 상한 뒤 스스로 풀린다 — 확인이 영영 안 도는 일은 없다.
 */
import { STARTUP_JOB_GAP_MS, STARTUP_JOB_RELEASE_CAP_MS, STARTUP_JOB_SETTLE_MS } from '@vibisual/shared';
import { logger } from '../logger.js';

interface StartupJob {
  label: string;
  /** 종전 부팅 기준 지연(ms). 줄에서는 순서만 정한다. */
  delayMs: number;
  run: () => void;
}

/**
 * 풀린 순간부터 각 작업까지의 지연(ms) — 순수 함수. 등록 순서가 아니라 **종전 지연 순서**를 지킨다(같으면
 * 등록 순서). 설치 판정이 로그인 판정보다 앞서야 하는 것처럼 순서에 뜻이 있는 확인들이라서다.
 * 첫 작업은 `settleMs` 뒤, 그다음부터 `gapMs` 씩 띄운다.
 */
export function planStartupJobDelays(
  delays: readonly number[],
  settleMs: number = STARTUP_JOB_SETTLE_MS,
  gapMs: number = STARTUP_JOB_GAP_MS,
): number[] {
  const order = delays
    .map((delay, index) => ({ delay, index }))
    .sort((a, b) => a.delay - b.delay || a.index - b.index);
  const out = new Array<number>(delays.length).fill(0);
  order.forEach(({ index }, rank) => { out[index] = settleMs + rank * gapMs; });
  return out;
}

const pending: StartupJob[] = [];
let released = false;
let capTimer: ReturnType<typeof setTimeout> | null = null;

function runSafely(job: StartupJob): void {
  try {
    job.run();
  } catch (err) {
    logger.warn(`[startupJobs] ${job.label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 부팅 한 번짜리 작업을 줄에 세운다. 이미 풀린 뒤에 들어오면(창이 보인 뒤 늦게 등록) 종전처럼 `delayMs` 뒤에 돈다.
 */
export function deferStartupJob(label: string, delayMs: number, run: () => void): void {
  const job: StartupJob = { label, delayMs, run };
  if (released) {
    setTimeout(() => runSafely(job), delayMs);
    return;
  }
  pending.push(job);
  if (capTimer === null) {
    capTimer = setTimeout(() => releaseStartupJobs('cap'), STARTUP_JOB_RELEASE_CAP_MS);
    // 이 상한 때문에 프로세스가 종료를 미루지 않게(창 없는 실행·시험).
    capTimer.unref?.();
  }
}

/**
 * 본체 창이 처음 보였다 — 줄에 선 작업을 원래 순서대로 한 칸씩 돌린다. 두 번째부터는 아무것도 하지 않는다.
 * `cap` 은 창 소식이 끝내 오지 않아 상한이 대신 푼 경우다.
 */
export function releaseStartupJobs(reason: 'window-shown' | 'cap' = 'window-shown'): void {
  if (released) return;
  released = true;
  if (capTimer !== null) {
    clearTimeout(capTimer);
    capTimer = null;
  }
  const jobs = pending.splice(0);
  const delays = planStartupJobDelays(jobs.map((job) => job.delayMs));
  jobs.forEach((job, index) => {
    setTimeout(() => runSafely(job), delays[index] ?? STARTUP_JOB_SETTLE_MS);
  });
  if (reason === 'cap' && jobs.length > 0) {
    logger.info(`[startupJobs] no window signal — released ${jobs.length} startup job(s) after the cap`);
  }
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetStartupJobsForTest(): void {
  pending.length = 0;
  released = false;
  if (capTimer !== null) clearTimeout(capTimer);
  capTimer = null;
}
