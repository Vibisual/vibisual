import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';

/** §4 (첫 실행 온보딩) ③ — 폴더 열기 창구가 취소·선택기 없음·등록 실패·연결 실패를 갈라 돌려준다. */

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  useGraphStore.setState({ activateOpenedProject: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('openProjectFolder', () => {
  it('고르면 표시명으로 탭을 세운다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, project: { name: 'app' }, displayName: 'app (2)' })));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({ ok: true, cancelled: false, name: 'app (2)' });
    expect(useGraphStore.getState().activateOpenedProject).toHaveBeenCalledExactlyOnceWith('app (2)');
  });

  it('대화상자를 닫은 것만 취소로 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, cancelled: true })));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({ ok: false, cancelled: true });
    expect(useGraphStore.getState().activateOpenedProject).not.toHaveBeenCalled();
  });

  it('선택기 없음(501)은 서버 안내와 함께 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error: 'no folder picker available (install zenity or kdialog)' }, 501)));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({
      ok: false, cancelled: false, error: { kind: 'picker-missing', detail: 'no folder picker available (install zenity or kdialog)' },
    });
  });

  it('등록 실패(500)는 원인과 함께 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error: 'Error: EACCES' }, 500)));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({
      ok: false, cancelled: false, error: { kind: 'failed', detail: 'Error: EACCES' },
    });
  });

  it('서버에 닿지 못하면 연결 실패다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({
      ok: false, cancelled: false, error: { kind: 'network', detail: 'Failed to fetch' },
    });
  });

  it('중간에서 HTML 오류 페이지가 와도 상태 코드를 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad gateway</h1>', { status: 502 })));
    expect(await useGraphStore.getState().openProjectFolder()).toEqual({
      ok: false, cancelled: false, error: { kind: 'failed', detail: 'HTTP 502' },
    });
  });
});
