import { WebSocketServer } from 'ws';

/** The mobile WS carries control/terminal frames; file uploads use the HTTP API. */
export const MOBILE_WS_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MOBILE_WS_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

interface ErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface MobileSocket extends ErrorSource {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback: (error?: Error) => void): void;
  terminate(): void;
}

/** Keep an error consumer for the entire transport lifetime, including late shutdown errors. */
export function retainTransportErrors(source: ErrorSource, report: (error: Error) => void): void {
  source.on('error', (error) => {
    try { report(error); } catch { /* diagnostics must not throw from an EventEmitter callback */ }
  });
}

export function createMobileWebSocketServer(compression: boolean, report: (error: Error) => void): WebSocketServer {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: MOBILE_WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: compression ? {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 10,
      zlibDeflateOptions: { level: 6 },
    } : false,
  });
  retainTransportErrors(server, report);
  return server;
}

/**
 * Never skip a graph delta on a live connection: close the slow connection instead. Reconnect
 * receives a full graph snapshot. Existing terminal-disconnect semantics still apply.
 * One oversized frame has a separate reservation, so the connection ack and later deltas can
 * coexist with an existing large snapshot. Normal outstanding sends still share the 64 MiB budget.
 */
export function createMobileSocketSender(socket: MobileSocket, report: (error: Error) => void): (data: string) => boolean {
  let stopped = false;
  let oversizedOutstanding = false;
  let normalOutstandingBytes = 0;
  const fail = (error: Error): void => {
    if (stopped) return;
    stopped = true;
    try { report(error); } catch { /* diagnostics are best effort */ }
    try { socket.terminate(); } catch { /* already gone */ }
  };
  retainTransportErrors(socket, fail);
  return (data) => {
    if (stopped || socket.readyState !== 1) return false;
    try {
      const bytes = Buffer.byteLength(data, 'utf8');
      const oversized = bytes > MOBILE_WS_MAX_BUFFERED_BYTES;
      // During deflate, bufferedAmount changes from raw to compressed bytes. Subtracting the
      // oversized frame's original size would hide unrelated queued data, so account our normal
      // sends explicitly until their callbacks complete. Every app frame uses this sender.
      const queued = oversizedOutstanding ? normalOutstandingBytes
        : Math.max(normalOutstandingBytes, socket.bufferedAmount);
      if ((oversized && oversizedOutstanding)
        || queued + (oversized ? 0 : bytes) > MOBILE_WS_MAX_BUFFERED_BYTES) {
        fail(new Error('mobile WebSocket send queue exceeded its memory budget; reconnect required'));
        return false;
      }
      if (oversized) oversizedOutstanding = true;
      else normalOutstandingBytes += bytes;
      let completed = false;
      socket.send(data, (error) => {
        if (completed) return;
        completed = true;
        if (oversized) oversizedOutstanding = false;
        else normalOutstandingBytes -= bytes;
        if (error) fail(error);
      });
      return !stopped;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  };
}
