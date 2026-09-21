import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createMobileSocketSender, MOBILE_WS_MAX_BUFFERED_BYTES, retainTransportErrors } from './mobileSocketSafety';

function fixture() {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((_data: string, _callback: (error?: Error) => void) => {}),
    terminate: vi.fn(),
  });
  const report = vi.fn();
  return { socket, report, send: createMobileSocketSender(socket, report) };
}

describe('mobile WebSocket send boundary', () => {
  it('sends a normal frame unchanged and accepts successful async completion', () => {
    const h = fixture();
    const data = '{"type":"graph_snapshot","payload":{"text":"한字🙂"}}';
    expect(h.send(data)).toBe(true);
    expect(h.socket.send.mock.calls[0]?.[0]).toBe(data);
    h.socket.send.mock.calls[0]?.[1]();
    expect(h.socket.terminate).not.toHaveBeenCalled();
  });

  it.each([0, 2, 3])('does not send while socket state is %s', (state) => {
    const h = fixture();
    h.socket.readyState = state;
    expect(h.send('frame')).toBe(false);
    expect(h.socket.send).not.toHaveBeenCalled();
  });

  it('allows exactly the remaining queue budget, counted in UTF-8 bytes', () => {
    const h = fixture();
    h.socket.bufferedAmount = MOBILE_WS_MAX_BUFFERED_BYTES - 3;
    expect(h.send('한')).toBe(true);
    expect(h.socket.terminate).not.toHaveBeenCalled();
  });

  it('disconnects the entire slow connection before a delta can be selectively lost', () => {
    const h = fixture();
    h.socket.bufferedAmount = MOBILE_WS_MAX_BUFFERED_BYTES - 2;
    expect(h.send('한')).toBe(false);
    expect(h.socket.send).not.toHaveBeenCalled();
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('reconnect required') }));
    h.socket.bufferedAmount = 0;
    expect(h.send('later delta')).toBe(false);
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('reserves one large snapshot separately from the initial ack and later normal frames', () => {
    const h = fixture();
    const snapshot = 'x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1);
    expect(h.send('ack')).toBe(true);
    h.socket.bufferedAmount = 3;
    expect(h.send(snapshot)).toBe(true);
    h.socket.bufferedAmount = snapshot.length + 3;
    expect(h.send('next delta')).toBe(true);
    expect(h.socket.send).toHaveBeenCalledTimes(3);
    expect(h.socket.terminate).not.toHaveBeenCalled();
  });

  it('rejects a second oversized frame until the first send callback completes', () => {
    const h = fixture();
    const snapshot = 'x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1);
    expect(h.send(snapshot)).toBe(true);
    // Compression may already have reduced bufferedAmount; the pending callback still owns it.
    h.socket.bufferedAmount = 0;
    expect(h.send(snapshot)).toBe(false);
    expect(h.socket.send).toHaveBeenCalledTimes(1);
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('releases a large reservation only on completion and tolerates a duplicate callback', () => {
    const h = fixture(); const snapshot = 'x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1);
    expect(h.send(snapshot)).toBe(true);
    const firstDone = h.socket.send.mock.calls[0]![1];
    firstDone(); expect(h.send(snapshot)).toBe(true);
    firstDone(); // A late duplicate must not clear the second frame's reservation.
    expect(h.send(snapshot)).toBe(false);
  });

  it('counts pending normal bytes even after compression makes bufferedAmount much smaller', () => {
    const h = fixture();
    expect(h.send('x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1))).toBe(true);
    expect(h.send('n'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES))).toBe(true);
    h.socket.bufferedAmount = 1;
    expect(h.send('delta')).toBe(false);
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('releases normal capacity on callbacks without clearing an oversized reservation', () => {
    const h = fixture();
    expect(h.send('x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1))).toBe(true);
    expect(h.send('n'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES))).toBe(true);
    h.socket.send.mock.calls[1]![1]();
    expect(h.send('delta')).toBe(true);
    expect(h.send('x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1))).toBe(false);
  });

  it('contains a large send callback failure and keeps the connection stopped', () => {
    const h = fixture();
    expect(h.send('x'.repeat(MOBILE_WS_MAX_BUFFERED_BYTES + 1))).toBe(true);
    h.socket.send.mock.calls[0]![1](new Error('large write failed'));
    expect(h.send('later')).toBe(false);
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('contains asynchronous write errors and retains the listener for later errors', () => {
    const h = fixture();
    h.send('frame');
    h.socket.send.mock.calls[0]?.[1](new Error('write failed'));
    expect(() => h.socket.emit('error', new Error('late reset'))).not.toThrow();
    expect(h.socket.terminate).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it('contains synchronous write errors, logging errors, and termination errors', () => {
    const h = fixture();
    h.socket.send.mockImplementation(() => { throw new Error('write failed'); });
    h.report.mockImplementation(() => { throw new Error('log unavailable'); });
    h.socket.terminate.mockImplementation(() => { throw new Error('already closed'); });
    expect(h.send('frame')).toBe(false);
    expect(() => h.socket.emit('error', new Error('late error'))).not.toThrow();
  });

  it('a failed peer does not interrupt delivery to a healthy peer', () => {
    const slow = fixture();
    const healthy = fixture();
    slow.socket.bufferedAmount = MOBILE_WS_MAX_BUFFERED_BYTES;
    for (const h of [slow, healthy]) h.send('delta');
    expect(slow.socket.terminate).toHaveBeenCalledTimes(1);
    expect(healthy.socket.send).toHaveBeenCalledTimes(1);
    expect(healthy.socket.terminate).not.toHaveBeenCalled();
  });
});

describe('transport lifetime error listener', () => {
  it('survives removal of the temporary startup listener and repeated runtime errors', () => {
    const server = new EventEmitter();
    const report = vi.fn();
    const duringStartup = vi.fn();
    retainTransportErrors(server, report);
    server.on('error', duringStartup);
    server.removeListener('error', duringStartup);
    expect(() => server.emit('error', new Error('runtime error'))).not.toThrow();
    expect(() => server.emit('error', new Error('shutdown error'))).not.toThrow();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('does not let diagnostic failure escape an error callback', () => {
    const source = new EventEmitter();
    retainTransportErrors(source, () => { throw new Error('diagnostics unavailable'); });
    expect(() => source.emit('error', new Error('transport failed'))).not.toThrow();
  });
});
