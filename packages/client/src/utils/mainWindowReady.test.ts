/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 본체 창이 "첫 화면을 다 그렸다"고 main 에 알리는 규칙.
 *
 * 사용자 보고(2026-10-16): "앱이 처음 뜰 때 바로 띄우니까 떴는데도 버벅인다 — 언리얼·VS 처럼 로딩 화면이 먼저 떴으면".
 * 이제 본체 창은 숨긴 채 그리고 스플래시가 앞을 지킨다. 창이 보이는 때는 이 신호가 정한다 — 너무 이르면 버벅이는 화면이
 * 그대로 보이고, 안 오면 창이 상한까지 숨는다. 그래서 판정(순수)과 흐름(가짜 시계)을 함께 고정한다.
 *
 * ⚠ 클라 vitest 에는 DOM 이 없다 — 창·프레임은 손으로 세우고, 소스 배선은 `import.meta.glob(?raw)` 으로 읽는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_WINDOW_READY_CAP_MS, MAIN_WINDOW_READY_QUIET_MS } from '@vibisual/shared';
import type { CanvasLoadingInputs } from '../components/BubbleMap/canvasLoading.js';
import { useGraphStore } from '../stores/graphStore.js';
import { __resetMainWindowReadyForTest, installMainWindowReadySignal, isFirstScreenReady } from './mainWindowReady.js';

const READY: CanvasLoadingInputs = {
  activeProject: 'vibisual',
  activeIsStub: false,
  snapshotScope: ['vibisual'],
  snapshotReceived: true,
  connectionStatus: 'connected',
  currentFolderId: null,
  snapshotFolderScope: null,
};

describe('첫 화면 판정 — "불러오는 중" 알약이 꺼지는 바로 그 조건', () => {
  it('지금 보는 탭이 실린 스냅샷을 받았으면 그렸다', () => {
    expect(isFirstScreenReady(READY)).toBe(true);
  });

  it('스냅샷을 한 번도 못 받았으면 아니다 — 부팅 첫 화면은 빈 껍데기다', () => {
    expect(isFirstScreenReady({ ...READY, snapshotReceived: false })).toBe(false);
    expect(isFirstScreenReady({ ...READY, snapshotReceived: false, activeProject: null, snapshotScope: null })).toBe(false);
  });

  it('보는 탭이 범위 밖이면 아직이다 — 범위를 선언한 뒤의 스냅샷을 기다린다', () => {
    expect(isFirstScreenReady({ ...READY, snapshotScope: ['other'] })).toBe(false);
  });

  it('범위를 적용하지 않은 스냅샷(전량)이면 그렸다', () => {
    expect(isFirstScreenReady({ ...READY, snapshotScope: null })).toBe(true);
  });

  it('등록된 프로젝트가 없으면(첫 실행) 기다릴 것이 없다 — 첫 실행 안내가 바로 보여야 한다', () => {
    expect(isFirstScreenReady({ ...READY, activeProject: null, snapshotScope: [] })).toBe(true);
  });

  it('내려놓은 탭(stub)은 그렸다 — 그 화면에는 이미 [불러오기] 안내가 서 있다', () => {
    expect(isFirstScreenReady({ ...READY, activeIsStub: true, snapshotScope: ['other'] })).toBe(true);
  });

  it('폴더 안에 있으면 그 폴더의 내용까지 와야 한다', () => {
    expect(isFirstScreenReady({ ...READY, currentFolderId: 'f1', snapshotFolderScope: [] })).toBe(false);
    expect(isFirstScreenReady({ ...READY, currentFolderId: 'f1', snapshotFolderScope: ['f1'] })).toBe(true);
  });
});

describe('알리는 흐름 — 칠해지고 조용해진 뒤 한 번', () => {
  let mainReady: ReturnType<typeof vi.fn>;

  const resetStore = (): void => {
    useGraphStore.setState({
      snapshotReceived: false,
      snapshotScope: null,
      activeProject: null,
      stubProjects: {},
      connectionStatus: 'connected',
      currentFolderId: null,
      snapshotFolderScope: null,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    mainReady = vi.fn(async () => true);
    vi.stubGlobal('window', {
      api: { lifecycle: { mainReady } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    // 숨긴 창도 프레임을 그린다(실측 약 30Hz) — 여기서는 16ms 로 세운다.
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => globalThis.setTimeout(() => cb(performance.now()), 16));
    __resetMainWindowReadyForTest();
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __resetMainWindowReadyForTest();
    resetStore();
  });

  it('스냅샷 전에는 알리지 않고, 오면 두 프레임 + 조용함 뒤에 한 번 알린다', async () => {
    const off = installMainWindowReadySignal();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mainReady).not.toHaveBeenCalled();

    useGraphStore.setState({ snapshotReceived: true });
    await vi.advanceTimersByTimeAsync(MAIN_WINDOW_READY_QUIET_MS);
    expect(mainReady, '칠하고 조용해지기 전에 알렸다').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(mainReady).toHaveBeenCalledOnce();

    useGraphStore.setState({ snapshotScope: [] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mainReady, '스냅샷마다 다시 알렸다').toHaveBeenCalledOnce();
    off();
  });

  it('다시 마운트돼도(개발 모드의 StrictMode) 한 번만 알린다', async () => {
    const off1 = installMainWindowReadySignal();
    off1();
    const off2 = installMainWindowReadySignal();
    useGraphStore.setState({ snapshotReceived: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mainReady).toHaveBeenCalledOnce();
    off2();
  });

  it('긴 작업이 그치지 않아도 상한 뒤에는 알린다 — 창이 숨어 버리면 안 된다', async () => {
    const observers: Array<{ cb: (list: { getEntries(): Array<{ startTime: number; duration: number }> }) => void; off: boolean }> = [];
    class BusyObserver {
      static supportedEntryTypes = ['longtask'];
      private readonly self: { cb: BusyObserver['cbType']; off: boolean };
      cbType!: (list: { getEntries(): Array<{ startTime: number; duration: number }> }) => void;
      constructor(cb: BusyObserver['cbType']) {
        this.self = { cb, off: false };
        observers.push(this.self);
      }
      observe(): void {}
      disconnect(): void { this.self.off = true; }
    }
    vi.stubGlobal('PerformanceObserver', BusyObserver);
    const busy = globalThis.setInterval(() => {
      for (const o of observers) if (!o.off) o.cb({ getEntries: () => [{ startTime: performance.now() - 60, duration: 60 }] });
    }, 50);

    const off = installMainWindowReadySignal();
    useGraphStore.setState({ snapshotReceived: true });
    await vi.advanceTimersByTimeAsync(MAIN_WINDOW_READY_CAP_MS - 200);
    expect(mainReady, '바쁜데 상한 전에 알렸다').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(mainReady).toHaveBeenCalledOnce();
    globalThis.clearInterval(busy);
    off();
  });

  it('알릴 곳이 없으면(웹 모드·구버전 preload) 아무것도 하지 않는다', async () => {
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const off = installMainWindowReadySignal();
    useGraphStore.setState({ snapshotReceived: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mainReady).not.toHaveBeenCalled();
    off();
  });
});

describe('소스 배선', () => {
  const SOURCES = import.meta.glob<string>(['/src/App.tsx', '/src/components/Layout/AppErrorBoundary.tsx'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const app = SOURCES['/src/App.tsx'] ?? '';
  const boundary = SOURCES['/src/components/Layout/AppErrorBoundary.tsx'] ?? '';

  it('본체 창의 셸(App)이 마운트될 때 신호를 건다', () => {
    expect(app).not.toBe('');
    expect(app).toContain('useEffect(() => installMainWindowReadySignal(), []);');
  });

  it('화면이 무너져도 알린다 — 복구 화면이 스플래시 뒤에 숨어 상한까지 기다리지 않게', () => {
    expect(boundary).not.toBe('');
    const at = boundary.indexOf('componentDidCatch(');
    expect(at).toBeGreaterThan(-1);
    expect(boundary.slice(at, boundary.indexOf('\n  }', at))).toContain('sendMainWindowReady();');
    // 오류 경계는 앱 스토어에 기대지 않는다 — 스토어를 부르지 않는 모듈에서 가져온다.
    expect(boundary).toContain("from '../../utils/mainWindowReadyNotify.js'");
  });
});
