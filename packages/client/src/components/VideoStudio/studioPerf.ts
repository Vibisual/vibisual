import { appTimingAt } from '../../apps/appTiming.js';
import { studioAudioMemoryBytes } from './studioMedia.js';

/**
 * §5.13 (X) 39-3 · (Y) 40-12 — 스튜디오 **계측**. 단계 표식은 `performance.mark` 로 늘 남긴다(개발 도구 성능 탭·추적 기록에 그대로 —
 * 비용은 사실상 0). 콘솔에서 `__VIBI_PERF__ = true` 로 켜면(스냅샷 계측과 같은 스위치 — 기본 off) 아래를 **한 줄씩** 낸다 —
 * 콘솔에, 그리고 패키지 앱이면 `main-stall.log` 에도(`perf` 줄 — 멈춤 줄과 나란히 읽힌다):
 *
 * - 열기: 앱 여는 누름(`vibisual-app:open:<appId>` — 코어 표식) → 셸 청크 받기 시작·끝 → 셸이 섬 → 문서 → 첫 그림 → 조작 가능.
 * - 재생: 누름 → 첫 움직임, 미리보기 줄 대기(요청 → 그림), 놓친 실사 프레임, 긴 프레임(LoAF — 100ms 넘는 수와 최악 몇 개의
 *   `blockingDuration` · 스크립트 출처).
 * - 메모리: 열기·재생 60초·닫기 때 이 창의 메모리(렌더러 private/resident · Blink 힙)와 앱 전체 프로세스별(GPU 포함 · Windows 는
 *   privateBytes), 그리고 소리 조각 기억.
 *
 * 다음에 "열 때·재생할 때 느리다"는 말이 오면 추측 대신 이 줄부터 본다.
 */
const PREFIX = 'vibistudio:';
const MiB = 1024 * 1024;
/** 최악으로 남길 긴 프레임 수. */
const LOAF_WORST = 3;
/** 이만큼(ms) 넘는 긴 프레임을 따로 센다. */
const LOAF_REPORT_MS = 100;

export type StudioMark = 'mounted' | 'doc' | 'first-frame' | 'interactive' | 'play-press' | 'play-move';

function perf(): Performance | null {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function' ? performance : null;
}

/** 스위치(콘솔에서 `__VIBI_PERF__ = true`). */
export function studioPerfOn(): boolean {
  return !!(globalThis as { __VIBI_PERF__?: boolean }).__VIBI_PERF__;
}

export function markStudio(name: StudioMark): void {
  try { perf()?.mark(`${PREFIX}${name}`); } catch { /* 계측은 동작에 영향을 주지 않는다 */ }
}

function markAt(name: StudioMark): number | undefined {
  try { return perf()?.getEntriesByName(`${PREFIX}${name}`).at(-1)?.startTime; } catch { return undefined; }
}

/** 한 줄 — 콘솔과(패키지 앱이면) `main-stall.log`. */
function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.warn(line);
  try { window.api?.perf?.log(line); } catch { /* 옛 preload — 콘솔만 */ }
}

const ms = (v: number | undefined, origin: number): string => (v === undefined ? '-' : `${Math.round(v - origin)}`);

/**
 * 첫 그림이 섰다 — 표식을 남기고, 켜져 있으면 여는 누름부터 몇 ms 인지 한 줄로 낸다. 다른 창에서 연 단독 창처럼 여는 누름 표식이
 * 이 창에 없으면 창이 생긴 때(0)부터 잰다(줄에 `from=window`).
 */
export function reportStudioFirstFrame(appId: string): void {
  if (!perf()) return;
  markStudio('first-frame');
  if (!studioPerfOn()) return;
  try {
    const open = appTimingAt(`open:${appId}`);
    const mounted = markAt('mounted');
    const fromOpen = open !== undefined && mounted !== undefined && open <= mounted;
    const origin = fromOpen ? open : 0;
    emit(`[perf-studio] open from=${fromOpen ? 'press' : 'window'} shell-start=${ms(appTimingAt(`shell-start:${appId}`), origin)}ms `
      + `shell-ready=${ms(appTimingAt(`shell-ready:${appId}`), origin)}ms mounted=${ms(mounted, origin)}ms doc=${ms(markAt('doc'), origin)}ms `
      + `first-frame=${ms(markAt('first-frame'), origin)}ms`);
    // 조작 가능 — 첫 그림 뒤 메인 스레드가 처음 한가해진 때.
    const idle = (cb: () => void): void => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') ric(cb, { timeout: 5_000 });
      else setTimeout(cb, 0);
    };
    idle(() => {
      markStudio('interactive');
      emit(`[perf-studio] interactive=${ms(markAt('interactive'), origin)}ms`);
    });
  } catch { /* 계측 실패는 조용히 */ }
}

// ─── 재생 · 미리보기 · 긴 프레임 ───

interface PlayStats {
  pressAt: number | null;
  pressToMove: number | null;
  waits: number[];
}

const play: PlayStats = { pressAt: null, pressToMove: null, waits: [] };

/** 재생을 눌렀다(누르는 순간 — 40-10 ①). */
export function notePlayPress(): void {
  markStudio('play-press');
  play.pressAt = typeof performance === 'undefined' ? null : performance.now();
  play.pressToMove = null;
}

/** 시계가 처음 움직였다(누름 뒤 첫 한 번만 센다). */
export function notePlayMove(): void {
  if (play.pressAt === null) return;
  play.pressToMove = performance.now() - play.pressAt;
  play.pressAt = null;
  markStudio('play-move');
}

/** 미리보기 한 장을 청해서 그려지기까지(ms). 켜져 있을 때만 모은다. */
export function notePreviewWait(waitMs: number): void {
  if (!studioPerfOn()) return;
  play.waits.push(waitMs);
  if (play.waits.length > 2_000) play.waits.splice(0, play.waits.length - 2_000);
}

// ─── §5.13 (Z) 41-6 흘려 트는 재생 ───

const stream = { reanchors: 0, plans: 0, coldSince: null as number | null, coldMs: 0 };

/** 재생 중 컴포지션들에 새 기준을 보냈다(소리가 붙을 때 · 반복으로 처음으로 돌아갈 때). */
export function noteStreamReanchor(): void {
  if (studioPerfOn()) stream.reanchors += 1;
}

/** 무대가 합성기 예약을 다시 짰다. */
export function noteStreamPlan(): void {
  if (studioPerfOn()) stream.plans += 1;
}

/** 첫 그림을 못 낸 컴포지션 자리를 가벼운 판(대표 프레임)으로 메우기 시작/끝. */
export function noteStreamCold(cold: boolean): void {
  if (!studioPerfOn()) return;
  const now = performance.now();
  if (cold) {
    if (stream.coldSince === null) stream.coldSince = now;
    return;
  }
  if (stream.coldSince !== null) { stream.coldMs += now - stream.coldSince; stream.coldSince = null; }
}

function streamSummary(): string {
  const open = stream.coldSince === null ? 0 : performance.now() - stream.coldSince;
  return `stream(reanchor=${stream.reanchors} plan=${stream.plans} cold=${Math.round(stream.coldMs + open)}ms)`;
}

function resetStream(): void {
  stream.reanchors = 0;
  stream.plans = 0;
  stream.coldMs = 0;
  if (stream.coldSince !== null) stream.coldSince = performance.now();
}

interface LoafEntry extends PerformanceEntry {
  readonly blockingDuration?: number;
  readonly scripts?: readonly { readonly sourceURL?: string; readonly invoker?: string; readonly duration?: number }[];
}

interface LoafWatch {
  readonly observer: PerformanceObserver;
  count: number;
  over: number;
  worst: { duration: number; blocking: number; source: string }[];
}

/**
 * 긴 프레임을 지켜본다 — `buffered: true` 로 이미 쌓인 것까지 받되, `since`(앱 여는 누름 · 단독 창이면 0 = 창이 생긴 때) 앞의 것은
 * 세지 않는다(스튜디오와 무관한 앱 시작 프레임이 열기 묶음에 섞이지 않게).
 */
function startLoaf(since: number): LoafWatch | null {
  if (typeof PerformanceObserver === 'undefined') return null;
  try {
    const watch: LoafWatch = { observer: null as unknown as PerformanceObserver, count: 0, over: 0, worst: [] };
    const observer = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as LoafEntry;
        if (entry.startTime < since) continue;
        watch.count += 1;
        if (entry.duration > LOAF_REPORT_MS) watch.over += 1;
        const top = [...(entry.scripts ?? [])].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
        const url = top?.sourceURL ? top.sourceURL.split(/[?#]/)[0]!.split('/').pop() ?? '' : '';
        const source = top ? `${url || '?'}#${(top.invoker ?? '').slice(0, 60)}` : '-';
        watch.worst.push({ duration: entry.duration, blocking: entry.blockingDuration ?? 0, source });
        watch.worst.sort((a, b) => b.blocking - a.blocking || b.duration - a.duration);
        if (watch.worst.length > LOAF_WORST) watch.worst.length = LOAF_WORST;
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: true } as PerformanceObserverInit);
    (watch as { observer: PerformanceObserver }).observer = observer;
    return watch;
  } catch {
    return null;
  }
}

/** 미리보기 대기 요약(개수 · 가운데 · 95% · 최댓값). */
export function summarizeWaits(waits: readonly number[]): string {
  if (waits.length === 0) return 'n=0';
  const sorted = [...waits].sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return `n=${sorted.length} p50=${Math.round(pick(0.5))}ms p95=${Math.round(pick(0.95))}ms max=${Math.round(sorted[sorted.length - 1]!)}ms`;
}

export interface StudioPerfSession {
  /** 그때까지 모은 것을 한 줄로 내고 비운다(`open` · `play` · `close`). */
  readonly flush: (label: string, extra?: { readonly droppedFrames?: number }) => void;
  readonly stop: () => void;
}

/**
 * 스튜디오 하나의 계측 묶음 — 켜져 있을 때만 긴 프레임을 지켜본다(꺼져 있으면 아무 일도 하지 않는다). `since` = 셀 첫 시각
 * (performance 기준 ms — 앱 여는 누름 표식, 없으면 0).
 */
export function startStudioPerfSession(since = 0): StudioPerfSession {
  if (!studioPerfOn()) return { flush: () => undefined, stop: () => undefined };
  const loaf = startLoaf(since);
  let lastDropped = 0;
  return {
    flush: (label, extra) => {
      try {
        const dropped = extra?.droppedFrames;
        const droppedNow = dropped === undefined ? '-' : String(Math.max(0, dropped - lastDropped));
        if (dropped !== undefined) lastDropped = dropped;
        const worst = loaf ? loaf.worst.map((w) => `${Math.round(w.duration)}/${Math.round(w.blocking)}ms ${w.source}`).join(' | ') : '-';
        emit(`[perf-studio] ${label} press→move=${play.pressToMove === null ? '-' : `${Math.round(play.pressToMove)}ms`} `
          + `preview-wait(${summarizeWaits(play.waits)}) dropped-footage=${droppedNow} ${streamSummary()} `
          + `loaf(n=${loaf?.count ?? '-'} >${LOAF_REPORT_MS}ms=${loaf?.over ?? '-'} worst=${worst || '-'})`);
        play.waits.length = 0;
        play.pressToMove = null;
        resetStream();
        if (loaf) { loaf.count = 0; loaf.over = 0; loaf.worst.length = 0; }
      } catch { /* 계측 실패는 조용히 */ }
    },
    stop: () => { try { loaf?.observer.disconnect(); } catch { /* 이미 끊겼다 */ } },
  };
}

// ─── 메모리 ───

/** 메모리 한 줄(열기 · 재생 60초 · 닫기). 켜져 있을 때만. */
export async function logStudioMemory(label: string): Promise<void> {
  if (!studioPerfOn()) return;
  try {
    let line = `[perf-studio] memory ${label} audio-chunks=${(studioAudioMemoryBytes() / MiB).toFixed(1)}MB`;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    if (heap) line += ` js-heap=${(heap.usedJSHeapSize / MiB).toFixed(0)}/${(heap.totalJSHeapSize / MiB).toFixed(0)}MB`;
    const snap = await window.api?.perf?.memory().catch(() => null);
    if (snap) {
      const r = snap.renderer;
      if (r) {
        line += ` renderer(private=${kb(r.privateKB)} resident=${kb(r.residentKB)} blink=${kb(r.blinkAllocatedKB)}/${kb(r.blinkTotalKB)})`;
      }
      for (const proc of snap.processes) {
        line += ` ${proc.type}x${proc.count}=${kb(proc.workingSetKB)}${proc.privateKB !== undefined ? `/${kb(proc.privateKB)}` : ''}`;
      }
    }
    emit(line);
  } catch { /* 계측 실패는 조용히 */ }
}

function kb(value: number | undefined): string {
  return value === undefined ? '-' : `${(value / 1024).toFixed(0)}MB`;
}
