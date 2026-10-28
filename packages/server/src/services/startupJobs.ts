/**
 * §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ② — 부팅 한 번짜리 확인(설치·로그인·사용량·코덱스·훅 전송)은 줄에 세웠다가
 * 본체 창이 처음 보일 때(`releaseStartupJobs`) 원래 순서대로 한 칸씩 돈다 — 저마다 CLI 를 띄우고(Windows 프로세스 생성은 동기) 스냅샷을 밀어, 한꺼번에 터지면 창이 안 끌린다.
 * 창 소식이 없으면 상한 뒤 스스로 풀린다. 스플래시 실행은 창 전에 좁은 간격으로 풀고(`'splash'`), desktop main 은 `pendingStartupJobCount() === 0` 뒤에 창을 보인다.
 */
import {
  STARTUP_JOB_GAP_MS,
  STARTUP_JOB_RELEASE_CAP_MS,
  STARTUP_JOB_SETTLE_MS,
  STARTUP_JOB_SPLASH_GAP_MS,
  STARTUP_JOB_SPLASH_SETTLE_MS,
} from '@vibisual/shared';
import { logger } from '../logger.js';

interface StartupJob {
  label: string;
  /** 종전 부팅 기준 지연(ms). 줄에서는 순서만 정한다. */
  delayMs: number;
  run: () => void;
}

/**
 * 줄을 푸는 계기. `window-shown` = 본체 창이 처음 보였다 · `splash` = 스플래시 뒤에서 먼저 푼다(본체 창은 아직
 * 숨어 있다) · `cap` = 창 소식이 끝내 오지 않아 상한이 대신 풀었다.
 */
export type StartupJobRelease = 'window-shown' | 'splash' | 'cap';

/** 풀린 뒤 각 작업까지의 지연(ms, 순수). 등록 순서가 아니라 원래 지연 순서다(설치 판정 → 로그인 판정처럼 순서에 뜻이 있다). 첫 작업 `settleMs`, 이후 `gapMs` 간격. */
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
/** 풀린 뒤 시계에 걸어 두었지만 아직 돌지 않은 작업 수. */
let scheduledNotRun = 0;

function runSafely(job: StartupJob): void {
  try {
    job.run();
  } catch (err) {
    logger.warn(`[startupJobs] ${job.label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 시계에 건다 — 돌기 직전에 셈에서 뺀다(작업이 던져도 셈은 맞는다). */
function schedule(job: StartupJob, delayMs: number): void {
  scheduledNotRun += 1;
  setTimeout(() => {
    scheduledNotRun -= 1;
    runSafely(job);
  }, delayMs);
}

/**
 * 부팅 한 번짜리 작업을 줄에 세운다. 이미 풀린 뒤에 들어오면(창이 보인 뒤 늦게 등록) 종전처럼 `delayMs` 뒤에 돈다.
 */
export function deferStartupJob(label: string, delayMs: number, run: () => void): void {
  const job: StartupJob = { label, delayMs, run };
  if (released) {
    schedule(job, delayMs);
    return;
  }
  pending.push(job);
  if (capTimer === null) {
    capTimer = setTimeout(() => releaseStartupJobs('cap'), STARTUP_JOB_RELEASE_CAP_MS);
    // 이 상한 때문에 프로세스가 종료를 미루지 않게(창 없는 실행·시험).
    capTimer.unref?.();
  }
}

/** 원래 순서대로 한 칸씩 돌린다 — 두 번째 호출부터는 무동작(스플래시가 먼저 풀었으면 창의 첫 show 는 무시). `splash` 만 좁은 간격. */
export function releaseStartupJobs(reason: StartupJobRelease = 'window-shown'): void {
  if (released) return;
  released = true;
  if (capTimer !== null) {
    clearTimeout(capTimer);
    capTimer = null;
  }
  const jobs = pending.splice(0);
  const delays = reason === 'splash'
    ? planStartupJobDelays(jobs.map((job) => job.delayMs), STARTUP_JOB_SPLASH_SETTLE_MS, STARTUP_JOB_SPLASH_GAP_MS)
    : planStartupJobDelays(jobs.map((job) => job.delayMs));
  jobs.forEach((job, index) => {
    schedule(job, delays[index] ?? STARTUP_JOB_SETTLE_MS);
  });
  if (reason === 'cap' && jobs.length > 0) {
    logger.info(`[startupJobs] no window signal — released ${jobs.length} startup job(s) after the cap`);
  }
}

/** 아직 시작 안 한 부팅 확인 수(풀리기 전엔 줄, 뒤엔 시계). 시작만 동기라 0 이면 멈춤을 만들 일이 지나갔다 — desktop main 이 스플래시를 걷기 전에 본다. */
export function pendingStartupJobCount(): number {
  return released ? scheduledNotRun : pending.length;
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetStartupJobsForTest(): void {
  pending.length = 0;
  released = false;
  scheduledNotRun = 0;
  if (capTimer !== null) clearTimeout(capTimer);
  capTimer = null;
}
