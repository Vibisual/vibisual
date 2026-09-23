import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStop, type SessionStopHandle } from './useSessionStop.js';

let view: ReactTestRenderer | undefined;
let handle: SessionStopHandle;
const fetchMock = vi.fn<typeof fetch>();
function Probe({ sid, agent = 'agent' }: { sid: string; agent?: string }): null {
  handle = useSessionStop(agent, sid);
  return null;
}
async function render(sid: string, agent = 'agent'): Promise<void> {
  await act(async () => {
    if (view) view.update(<Probe sid={sid} agent={agent} />);
    else view = create(<Probe sid={sid} agent={agent} />);
  });
}
function deferred(): { promise: Promise<Response>; resolve: (body: unknown) => void } {
  let done!: (response: Response) => void;
  return { promise: new Promise((resolve) => { done = resolve; }), resolve: (body) => done(new Response(JSON.stringify(body))) };
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

describe('stop response ownership while switching sessions', () => {
  it('another session can stop immediately and an old response cannot clear its pending state or show a force-stop hint', async () => {
    const a = deferred();
    const b = deferred();
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await render('a');
    act(() => { handle.stop(); });
    expect(handle.stopping).toBe(true);
    await render('b');
    expect(handle.stopping).toBe(false);
    act(() => { handle.stop(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/b/stop-session');
    await act(async () => { a.resolve({ ok: true, stopped: 0 }); });
    expect(handle.stopping).toBe(true);
    expect(handle.outcome.kind).toBe('none');
    await act(async () => { b.resolve({ ok: true, stopped: 1 }); });
    expect(handle.stopping).toBe(false);
    expect(handle.outcome).toEqual({ kind: 'stopped', count: 1 });
  });

  it('a settled stop hint belongs only to the session where it was requested', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, stopped: 0 })));
    await render('a');
    await act(async () => { handle.stop(); });
    expect(handle.outcome.kind).toBe('nothing');
    await render('b');
    expect(handle.outcome.kind).toBe('none');
  });

  it('leaving and returning to a session does not revive its old delayed response', async () => {
    const a = deferred();
    fetchMock.mockReturnValueOnce(a.promise);
    await render('a');
    act(() => { handle.stop(); });
    await render('b');
    await render('a');
    await act(async () => { a.resolve({ ok: true, stopped: 0 }); });
    expect(handle.outcome.kind).toBe('none');
    expect(handle.stopping).toBe(false);
  });

  it('still prevents two stops in one frame for the same session', async () => {
    const a = deferred();
    fetchMock.mockReturnValueOnce(a.promise);
    await render('a');
    act(() => { handle.stop(); handle.stop(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { a.resolve({ ok: true, stopped: 1 }); });
  });

  it('starting a new command in the same session clears ownership of the previous stop response', async () => {
    const old = deferred();
    fetchMock.mockReturnValueOnce(old.promise);
    await render('a');
    act(() => { handle.stop(); });
    act(() => { handle.clearOutcome(); });
    expect(handle.stopping).toBe(false);
    await act(async () => { old.resolve({ ok: true, stopped: 0 }); });
    expect(handle.outcome.kind).toBe('none');
  });

  it.each([503, null])('a current request still releases its button and reports failure %s', async (status) => {
    if (status === null) fetchMock.mockRejectedValueOnce(new Error('offline'));
    else fetchMock.mockResolvedValueOnce(new Response('', { status }));
    await render('a');
    await act(async () => { handle.stop(); });
    expect(handle.stopping).toBe(false);
    expect(handle.outcome).toEqual({ kind: 'failed', status });
  });
});
