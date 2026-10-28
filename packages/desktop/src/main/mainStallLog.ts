// SCENARIO.md §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ④ — 메인 스레드 멈춤을 늘 기록한다.
// 서버가 창 입력을 받는 메인 스레드에서 함께 돌아(§3.7), 멈춘 동안엔 OS 제목줄로도 로고 덮개로도 창이 따라오지 않는다.
// 짧은 간격 시계가 늦게 깬 만큼이 멈춘 시간이고, 문턱을 넘으면 userData/logs/main-stall.log 에 한 줄 남긴다 — 창이 안 움직이는 증상은 이것부터 읽는다.
// 원인은 말하지 않는다(시각을 다른 로그와 맞춰 본다). 판정·줄 모양은 순수 함수(`mainStallLog.test.ts`).

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
  /** §9 「시작 화면(스플래시)」 — 스플래시가 보인 시각(epoch ms). 없었거나 아직이면 null. */
  splashShownAt?: number | null;
}

/**
 * 로그 한 줄. 멈춤이 시작된 시각을 앞에 둔다(다른 로그와 맞춰 보는 기준).
 * 기준점은 본체 창이 뜬 뒤면 `window+`, 스플래시만 떠 있던 구간이면 `splash+`, 둘 다 없으면(부팅 동기 구간) `before-window`.
 */
export function formatStallLine(r: MainStallRecord): string {
  const startedAt = r.at - r.stallMs;
  const splashAt = r.splashShownAt ?? null;
  const phase = r.windowShownAt !== null
    ? `window+${Math.max(0, Math.round(startedAt - r.windowShownAt))}ms`
    : splashAt !== null
      ? `splash+${Math.max(0, Math.round(startedAt - splashAt))}ms`
      : 'before-window';
  return `[${new Date(startedAt).toISOString()}] main-thread stall ${Math.round(r.stallMs)}ms `
    + `(${phase}, uptime ${Math.round(r.uptimeMs)}ms)\n`;
}

/**
 * §9 「시작 화면(스플래시)」 — 시작의 이정표 한 줄(스플래시가 보였다 · 본체 창이 보였다). 멈춤 줄과 같은 파일에 두어
 * "언제 무엇이 보였고 그 사이 얼마나 멈췄나"를 한 파일에서 읽는다.
 */
export function formatStartupLine(at: number, label: string, uptimeMs: number): string {
  return `[${new Date(at).toISOString()}] startup ${label} (uptime ${Math.round(uptimeMs)}ms)\n`;
}

let timer: ReturnType<typeof setInterval> | null = null;
let windowShownAt: number | null = null;
let splashShownAt: number | null = null;

/** 본체 창이 처음 보였다 — 이후 멈춤은 "창이 뜬 뒤 몇 ms" 로 적힌다. 첫 번만 센다. */
export function markMainWindowShown(now: number = Date.now()): void {
  if (windowShownAt === null) windowShownAt = now;
}

/** §9 「시작 화면(스플래시)」 — 스플래시가 보였다. 본체 창이 보이기 전까지의 멈춤은 "스플래시가 뜬 뒤 몇 ms" 로 적힌다. */
export function markSplashShown(now: number = Date.now()): void {
  if (splashShownAt === null) splashShownAt = now;
}

/** 시작 이정표를 기록한다(콘솔 + main-stall.log). 실패해도 던지지 않는다. */
export function logStartupMilestone(label: string, write: (line: string) => void = writeStallLine): void {
  try {
    write(formatStartupLine(Date.now(), label, process.uptime() * 1000));
  } catch { /* 기록 실패가 앱을 멈추게 하면 안 된다 */ }
}

function writeStallLine(line: string): void {
  console.warn(`[main] ${line.trimEnd()}`);
  appendLogText(MAIN_STALL_LOG_FILE, line);
}

/** §5.13 (Y) 40-12 — 이 길이(ms)를 넘게 걸린 IPC·vibproxy 처리는 경로·크기와 함께 적는다(멈춘 길이만으로는 원인을 가를 수 없다). */
export const TRANSFER_LOG_MS = 100;
/** 이만큼(바이트) 넘게 실어 나른 응답은 걸린 시간과 무관하게 적는다 — IPC 로 큰 본문이 다니는 일 자체가 고칠 거리다. */
export const TRANSFER_LOG_BYTES = 8 * 1024 * 1024;
const TRANSFER_PATH_MAX = 240;

export interface TransferRecord {
  /** 처리가 끝난 시각(epoch ms). */
  at: number;
  /** 통로 이름(`ipc-fetch` · `vibproxy` · `vibproxy-media`). */
  channel: string;
  /** 요청 경로(쿼리 포함 — 길면 자른다). */
  path: string;
  ms: number;
  bytes: number;
}

export function shouldLogTransfer(ms: number, bytes: number): boolean {
  return ms >= TRANSFER_LOG_MS || bytes >= TRANSFER_LOG_BYTES;
}

/** 전송 한 줄 — 시작 시각을 앞에 둔다(멈춤 줄과 같은 기준이라 나란히 읽힌다). */
export function formatTransferLine(r: TransferRecord): string {
  const startedAt = r.at - r.ms;
  const path = r.path.length > TRANSFER_PATH_MAX ? `${r.path.slice(0, TRANSFER_PATH_MAX)}…` : r.path;
  return `[${new Date(startedAt).toISOString()}] transfer ${r.channel} ${Math.round(r.ms)}ms `
    + `${(r.bytes / 1048576).toFixed(1)}MB ${path}\n`;
}

/** 문턱을 넘은 전송만 적는다. 실패해도 던지지 않는다. */
export function logTransfer(r: TransferRecord, write: (line: string) => void = writeStallLine): void {
  if (!shouldLogTransfer(r.ms, r.bytes)) return;
  try { write(formatTransferLine(r)); } catch { /* 기록 실패가 앱을 멈추게 하면 안 된다 */ }
}

const PERF_LINE_MAX = 1200;

/** §5.13 (Y) 40-12 — 렌더러 계측 한 줄(`__VIBI_PERF__` 를 켠 창만 보낸다). 같은 파일에 두어 멈춤과 나란히 읽는다. */
export function formatPerfLine(at: number, text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `[${new Date(at).toISOString()}] perf ${flat.length > PERF_LINE_MAX ? `${flat.slice(0, PERF_LINE_MAX)}…` : flat}\n`;
}

export function logPerfLine(text: string, write: (line: string) => void = writeStallLine): void {
  try { write(formatPerfLine(Date.now(), text)); } catch { /* 기록 실패가 앱을 멈추게 하면 안 된다 */ }
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
      write(formatStallLine({ at: Date.now(), stallMs: lag, uptimeMs: process.uptime() * 1000, windowShownAt, splashShownAt }));
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
  splashShownAt = null;
}
