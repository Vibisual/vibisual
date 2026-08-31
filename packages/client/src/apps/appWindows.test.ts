import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { canPopOutAppWindow, openAppWindow, useAppWindowsStore } from './appWindows.js';
import { INTERNAL_APPS } from './registry.js';

/**
 * §5.13 (S) — 앱은 **앱 안 창**으로 먼저 열리고, 꺼낼 때만 밖으로 나간다.
 *
 * 여기서 못 박는 것 셋: ① 같은 것을 두 번 열어도 창은 하나(앞으로 올 뿐) ② 꺼내면 종전의 그
 * OS 창 경로(`InternalApp.open()`)를 지나고 앱 안 창은 닫힌다 ③ 등록되지 않은 앱은 열지 않는다
 * (부르는 쪽이 연결 프로그램 같은 다른 길로 갈 수 있어야 한다).
 */

const APP = INTERNAL_APPS[0]!;
const PROJECT = 'C:/proj';

function reset(): void {
  useAppWindowsStore.setState({ windows: [] });
}

describe('앱 안 창 store', () => {
  beforeEach(reset);

  it('열면 창이 하나 선다', () => {
    expect(openAppWindow({ appId: APP.id, projectId: PROJECT })).toBe(true);
    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.appId).toBe(APP.id);
  });

  it('같은 것을 또 열면 두 벌이 되지 않고 앞으로 온다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    const first = useAppWindowsStore.getState().windows[0]!;
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', title: '내 영상' });

    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.id).toBe(first.id);
    // 이름은 최신 것으로 — 버블 이름을 바꾼 뒤 다시 열었을 때 옛 이름이 남지 않게.
    expect(windows[0]?.title).toBe('내 영상');
    expect(windows[0]?.focusAt).toBeGreaterThanOrEqual(first.focusAt);
  });

  it('가리키는 것이 다르면 창도 다르다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-2' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, file: 'a/b.mp4' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(3);
  });

  it('등록되지 않은 앱은 열지 않는다 — 부르는 쪽이 다른 길로 갈 수 있어야 한다', () => {
    expect(openAppWindow({ appId: 'nope', projectId: PROJECT })).toBe(false);
    expect(useAppWindowsStore.getState().windows).toHaveLength(0);
  });

  it('닫으면 그 창만 사라진다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-2' });
    const first = useAppWindowsStore.getState().windows[0]!;
    useAppWindowsStore.getState().close(first.id);
    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.ref).toBe('doc-2');
  });
});

describe('밖으로 꺼내기', () => {
  beforeEach(reset);
  afterEach(() => { vi.restoreAllMocks(); });

  it('종전의 OS 창 경로를 그대로 지나고, 앱 안 창은 닫힌다', () => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', file: 'a/b.mp4' });
    const win = useAppWindowsStore.getState().windows[0]!;

    useAppWindowsStore.getState().popOut(win.id);

    expect(open).toHaveBeenCalledWith({ projectId: PROJECT, ref: 'doc-1', file: 'a/b.mp4' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(0);
  });

  it('없는 창을 꺼내라고 해도 아무 일도 하지 않는다', () => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    useAppWindowsStore.getState().popOut('appwin-없음');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('꺼낼 수 있는 판인가', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('브라우저가 아닌 판(서버 렌더·테스트)에서도 터지지 않는다', () => {
    expect(canPopOutAppWindow()).toBe(false);
  });

  it('창을 못 여는 판에서는 손짓·손잡이를 띄우지 않는다', () => {
    vi.stubGlobal('window', {});
    expect(canPopOutAppWindow()).toBe(false);
  });

  it('데스크톱 렌더러면 꺼낼 수 있다', () => {
    vi.stubGlobal('window', { api: { app: { open: (): void => undefined } } });
    expect(canPopOutAppWindow()).toBe(true);
  });
});
