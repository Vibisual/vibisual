// SCENARIO.md §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ④ — **메인 스레드 멈춤을 늘 기록한다.**
//
// 서버는 창의 입력을 받는 메인 스레드에서 함께 돈다(§3.7 단일 프로세스). 그 스레드가 멈춘 동안에는 OS 제목줄로도,
// 헤더 로고 덮개로도 창이 따라오지 않는다. 그런데 멈춤을 재는 장치가 한 곳도 없어서 "앱을 켜면 창이 안 움직인다"는
// 보고가 올 때마다 추측으로 고쳤다(사용자 보고 — "계속 반복이야 이게"). 이제 늘 잰다: 짧은 간격의 시계가 늦게 깬
// 만큼이 그 사이 멈춘 시간이다. 문턱을 넘으면 userData/logs/main-stall.log 에 한 줄 남긴다 — 다음 보고는 이것부터
// 읽는다. 무엇이 멈추게 했는지는 이 기록이 말하지 않는다(시각을 다른 로그와 맞춰 본다).
//
// 판정과 줄 모양은 순수 함수라 electron 없이 단위 시험으로 고정한다(`mainStallLog.test.ts`).

import { appendLogText } from './crashLog';

/** 시계 간격(ms). 이보다 짧은 멈춤은 재지 못하지만, 창을 붙잡는 멈춤은 그보다 훨씬 길다. */
export const MAIN_STALL_PROBE_MS = 100;

/** 기록 문턱(ms) — 끄는 손에 창이 안 따라온다고 느끼기 시작하는 길이. */
export const MAIN_STALL_LOG_MS = 200;

export const MAIN_STALL_LOG_FILE = 'main-stall.log';

/** 직전 시계가 깬 때부터 지금까지, 간격을 넘겨 늦은 만큼(ms). 늦지 않았으면 0. */
export function stallLagMs(prevTickAt: number, now: number, intervalMs = MAIN_STALL_PROBE_MS): number {
  return Math.max(0, now - prevTickAt - intervalMs);
}

export interface MainStallRecord {
  /** 멈춤이 끝난(시계가 깬) 시각 — epoch ms. */
  at: number;
  /** 멈춘 길이(ms). */
  stallMs: number;
  /** 프로세스 가동 시간(ms). */
  uptimeMs: number;
  /** 본체 창이 처음 보인 시각(epoch ms) — 아직이면 null. */
  windowShownAt: number | null;
}

/**
 * 로그 한 줄. 멈춤이 **시작된** 시각을 앞에 둔다(그때 무엇이 돌았는지 다른 로그와 맞춰 보는 기준).
 * 창이 뜨기 전의 멈춤(부팅 동기 구간)은 `before-window`, 뜬 뒤면 뜬 때부터 몇 ms 지나 멈췄는지 적는다.
 */
export function formatStallLine(r: MainStallRecord): string {
  const startedAt = r.at - r.stallMs;
  const phase = r.windowShownAt === null
    ? 'before-window'
    : `window+${Math.max(0, Math.round(startedAt - r.windowShownAt))}ms`;
  return `[${new Date(startedAt).toISOString()}] main-thread stall ${Math.round(r.stallMs)}ms `
    + `(${phase}, uptime ${Math.round(r.uptimeMs)}ms)\n`;
}

let timer: ReturnType<typeof setInterval> | null = null;
let windowShownAt: number | null = null;

/** 본체 창이 처음 보였다 — 이후 멈춤은 "창이 뜬 뒤 몇 ms" 로 적힌다. 첫 번만 센다. */
export function markMainWindowShown(now: number = Date.now()): void {
  if (windowShownAt === null) windowShownAt = now;
}

function writeStallLine(line: string): void {
  console.warn(`[main] ${line.trimEnd()}`);
  appendLogText(MAIN_STALL_LOG_FILE, line);
}

/**
 * 시계를 건다. 이미 돌고 있으면 아무것도 하지 않는다. 늦음은 단조 시계(`performance.now`)로 재고, 줄에는
 * 벽시계 시각을 적는다(벽시계가 바뀌어도 가짜 멈춤이 적히지 않게).
 */
export function startMainStallLog(write: (line: string) => void = writeStallLine): void {
  if (timer !== null) return;
  let prev = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    const lag = stallLagMs(prev, now);
    prev = now;
    if (lag < MAIN_STALL_LOG_MS) return;
    try {
      write(formatStallLine({ at: Date.now(), stallMs: lag, uptimeMs: process.uptime() * 1000, windowShownAt }));
    } catch { /* 기록 실패가 앱을 멈추게 하면 안 된다 */ }
  }, MAIN_STALL_PROBE_MS);
  // 이 시계 때문에 프로세스가 종료를 미루지 않게.
  timer.unref?.();
}

export function stopMainStallLog(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetMainStallLogForTest(): void {
  stopMainStallLog();
  windowShownAt = null;
}
