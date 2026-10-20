import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecReadingSettings } from '@vibisual/shared';
import { useSpecScope, type SpecScopeControl } from './specReadingScope.js';

let api: SpecScopeControl;
let view: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
const response = (settings: SpecReadingSettings): Response => new Response(JSON.stringify({ ok: true, settings }));
function Probe({ root }: { root: string }): null { api = useSpecScope(root, 'agent', 'sub'); return null; }
async function render(root = '/project'): Promise<void> {
  await act(async () => {
    if (view) view.update(<Probe root={root} />);
    else view = create(<Probe root={root} />);
  });
}
function deferred(): { promise: Promise<Response>; reply: (settings: SpecReadingSettings) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, reply: (settings) => resolve(response(settings)) };
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => { view?.unmount(); }); view = undefined; vi.unstubAllGlobals(); });

describe('정독 설정은 화면 안에서 한 벌만 유지한다', () => {
  it('켜기 뒤 강도 저장은 변경 필드만 보내고 토글·환경설정이 같은 응답을 읽는다', async () => {
    let server: SpecReadingSettings = { strength: 'observe', enabledProject: false, roots: ['docs'] };
    fetchMock.mockImplementation(async (url, init) => {
      if (!init) return response(server);
      const body = JSON.parse(String(init.body)) as { enabled?: boolean; settings?: Partial<SpecReadingSettings> };
      server = String(url).endsWith('/scope') ? { ...server, enabledProject: body.enabled } : { ...server, ...body.settings };
      return response(server);
    });
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { api.set('project', true); });
    await act(async () => { api.patch({ strength: 'enforce' }); });
    expect(api.effective).toBe(true);
    expect(api.settings).toMatchObject({ enabledProject: true, strength: 'enforce', roots: ['docs'] });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ projectPath: '/project', settings: { strength: 'enforce' } });
  });

  it('문서 경로·면제도 같은 설정을 갱신하고 다른 필드를 요청에 복사하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response({ strength: 'warn', enabledProject: true }));
    await render();
    fetchMock.mockResolvedValueOnce(response({ strength: 'warn', enabledProject: true, roots: ['new-docs'] }));
    await act(async () => { api.patch({ roots: ['new-docs'] }); });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ projectPath: '/project', settings: { roots: ['new-docs'] } });
    fetchMock.mockResolvedValueOnce(response({ strength: 'warn', enabledProject: true, roots: ['new-docs'], waived: ['REQ-1'] }));
    await act(async () => { api.waive('REQ-1', true); });
    expect(api.settings?.waived).toEqual(['REQ-1']);
    expect(api.effective).toBe(true);
  });

  it('프로젝트 전환 뒤 이전 저장 응답은 새 프로젝트의 설정을 덮지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response({ strength: 'observe' }));
    await render();
    const oldSave = deferred();
    fetchMock.mockReturnValueOnce(oldSave.promise);
    act(() => { api.set('project', true); });
    fetchMock.mockResolvedValueOnce(response({ strength: 'warn', enabledProject: false }));
    await render('/other');
    await act(async () => { oldSave.reply({ strength: 'enforce', enabledProject: true }); });
    expect(api.settings).toEqual({ strength: 'warn', enabledProject: false });
    expect(api.effective).toBe(false);
    expect(api.saving).toBe(false);
  });

  it('늦은 최초 조회 응답과 같은 프레임의 중복 요청이 최신 저장을 되돌리지 않는다', async () => {
    const load = deferred(); const save = deferred();
    fetchMock.mockReturnValueOnce(load.promise).mockReturnValueOnce(save.promise);
    await render();
    act(() => { api.set('project', true); api.set('project', false); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { save.reply({ strength: 'observe', enabledProject: true }); });
    await act(async () => { load.reply({ strength: 'observe', enabledProject: false }); });
    expect(api.effective).toBe(true);
    expect(api.loading).toBe(false);
  });
});
