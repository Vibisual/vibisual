/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 본체 창이 첫 화면을 다 그렸다고 main 에 알린다. 본체 창은 숨긴 채 그리고 스플래시가 앞을 지킨다(빈 껍데기가 보이면 마운트·첫 스냅샷·그리기가 눈앞에서 버벅인다). 셋이 다 된 뒤 알린다:
 *  ① 지금 탭의 데이터가 왔다 — §9 `canvasLoading` 의 'ready' 를 그대로 빌린다(새 판정 ❌). 스냅샷을 못 받았으면 아니다.
 *  ② 그 그림이 한 번 칠해졌다 — 갱신 뒤 두 프레임(숨긴 창도 그린다 — 실측: 숨긴 창의 rAF 초당 약 30회).
 *  ③ 렌더러가 조용하다 — 긴 작업(50ms+)이 `MAIN_WINDOW_READY_QUIET_MS` 동안 없다. 그치지 않아도 `MAIN_WINDOW_READY_CAP_MS` 뒤엔 알린다(창이 숨어 버리면 안 된다).
 * 본체 창(App)만 부른다(다른 창은 main 이 무시한다). 웹 모드·구버전 preload 에서는 아무것도 하지 않는다 — main 이 자기 상한 뒤에 창을 보인다.
 */
import { MAIN_WINDOW_READY_CAP_MS, MAIN_WINDOW_READY_QUIET_MS } from '@vibisual/shared';
import { resolveCanvasLoadingState, type CanvasLoadingInputs } from '../components/BubbleMap/canvasLoading.js';
import { useGraphStore } from '../stores/graphStore.js';
import { sendMainWindowReady } from './mainWindowReadyNotify.js';

/** 긴 작업으로 치는 길이(ms) — Long Tasks API 의 정의와 같다. 타이머가 이만큼 늦게 깨도 그 사이 바빴던 것으로 친다. */
const LONG_TASK_MS = 50;
/** 조용함을 재는 시계 간격(ms). */
const QUIET_POLL_MS = 100;
/** 두 프레임을 기다리는 상한(ms) — 프레임이 오지 않는 환경에서도 다음으로 간다. */
const PAINT_WAIT_CAP_MS = 500;

/** 지금 보는 탭의 첫 화면이 그릴 수 있는 상태인가(순수 — 표로 고정한다). */
export function isFirstScreenReady(i: CanvasLoadingInputs): boolean {
  return i.snapshotReceived && resolveCanvasLoadingState(i) === 'ready';
}

type GraphState = ReturnType<typeof useGraphStore.getState>;

function readinessInputs(s: GraphState): CanvasLoadingInputs {
  return {
    activeProject: s.activeProject,
    activeIsStub: s.activeProject !== null && !!s.stubProjects[s.activeProject],
    snapshotScope: s.snapshotScope,
    snapshotReceived: s.snapshotReceived,
    connectionStatus: s.connectionStatus,
    currentFolderId: s.currentFolderId,
    snapshotFolderScope: s.snapshotFolderScope,
  };
}

/** 그 갱신이 한 번 칠해질 때까지 — 커밋 뒤 두 프레임(두 번째 프레임은 첫 칠이 끝난 뒤에 돈다). */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const cap = window.setTimeout(done, PAINT_WAIT_CAP_MS);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.clearTimeout(cap);
      done();
    }));
  });
}

/**
 * 렌더러가 조용해질 때까지(또는 상한까지) 기다린다. 긴 작업은 두 길로 본다 — Long Tasks 관찰(있으면)과, 이 시계가
 * 늦게 깬 만큼(관찰 기록은 그 작업이 끝난 **뒤에** 오므로 시계가 먼저 깨면 놓친다).
 */
export function waitForRendererQuiet(
  opts: { quietMs?: number; capMs?: number } = {},
): Promise<void> {
  const quietMs = opts.quietMs ?? MAIN_WINDOW_READY_QUIET_MS;
  const capMs = opts.capMs ?? MAIN_WINDOW_READY_CAP_MS;
  return new Promise((resolve) => {
    const start = performance.now();
    let lastBusyAt = start;
    let lastTick = start;
    let observer: PerformanceObserver | null = null;
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lastBusyAt = Math.max(lastBusyAt, entry.startTime + entry.duration);
        });
        observer.observe({ type: 'longtask' });
      }
    } catch {
      observer = null; // 관찰이 안 되는 환경 — 시계만으로 잰다.
    }
    const tick = (): void => {
      const t = performance.now();
      if (t - lastTick - QUIET_POLL_MS >= LONG_TASK_MS) lastBusyAt = Math.max(lastBusyAt, t);
      lastTick = t;
      if (t - lastBusyAt >= quietMs || t - start >= capMs) {
        observer?.disconnect();
        resolve();
        return;
      }
      window.setTimeout(tick, QUIET_POLL_MS);
    };
    window.setTimeout(tick, QUIET_POLL_MS);
  });
}

/** 이 창에서 이미 알리기 시작했는가(한 번만 알린다 — 다시 마운트돼도). */
let signalStarted = false;

/**
 * 본체 창의 셸(App)이 마운트될 때 한 번 건다. 첫 화면이 그릴 수 있는 상태가 되면 칠해지기를·조용해지기를 기다려 알린다.
 * @returns 구독 해제(이미 알리기 시작했으면 그 흐름은 끝까지 간다).
 */
export function installMainWindowReadySignal(): () => void {
  if (typeof window === 'undefined' || typeof window.api?.lifecycle?.mainReady !== 'function') {
    return () => { /* 웹 모드·구버전 preload — 알릴 곳이 없다 */ };
  }
  if (signalStarted) return () => {};
  let unsubscribe: (() => void) | null = null;
  const begin = (): void => {
    if (signalStarted) return;
    signalStarted = true;
    unsubscribe?.();
    unsubscribe = null;
    void afterNextPaint()
      .then(() => waitForRendererQuiet())
      .then(() => sendMainWindowReady());
  };
  if (isFirstScreenReady(readinessInputs(useGraphStore.getState()))) {
    begin();
    return () => {};
  }
  unsubscribe = useGraphStore.subscribe((s) => {
    if (isFirstScreenReady(readinessInputs(s))) begin();
  });
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** 시험 전용 — 모듈 상태를 처음으로 돌린다. */
export function __resetMainWindowReadyForTest(): void {
  signalStarted = false;
}
