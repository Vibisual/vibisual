import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export const MOBILE_VOICE_SOCKET_PATH = '/api/voice-asr/socket';
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export interface MobileVoiceBridge {
  /** Call only after the mobile listener's Host, Origin, and pairing checks. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, enginePort: number | null, external?: boolean): void;
  closeExternalConnections(): void;
  close(): void;
}

interface Connection {
  external: boolean;
  upstream: WebSocket;
  client: WebSocket | null;
  socket: Duplex;
  dispose: () => void;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function byteLength(data: RawData): number {
  return Array.isArray(data) ? data.reduce((sum, part) => sum + part.byteLength, 0) : data.byteLength;
}

/**
 * Browsers use the paired listener's WSS connection instead of exposing the engine's random
 * plaintext port. The destination is always the server-owned engine on loopback. The desktop
 * renderer keeps its direct local connection; this bridge is only for remote browser audio.
 */
export function createMobileVoiceBridge(report: (error: Error) => void): MobileVoiceBridge {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  const connections = new Set<Connection>();
  let closed = false;
  const diagnostic = (error: Error): void => { try { report(error); } catch { /* diagnostics cannot break cleanup */ } };
  server.on('error', diagnostic);

  return {
    upgrade(req, socket, head, enginePort, external = false) {
      if (closed || enginePort === null || !Number.isInteger(enginePort) || enginePort < 1 || enginePort > 65535) {
        rejectUpgrade(socket, 503, 'Voice engine unavailable');
        return;
      }
      // Delay the browser handshake until the engine is connected. Otherwise the browser can
      // start recording while the upstream is CONNECTING and lose the beginning of its speech.
      const upstream = new WebSocket(`ws://127.0.0.1:${enginePort}`, {
        handshakeTimeout: 10_000,
        maxPayload: MAX_FRAME_BYTES,
        perMessageDeflate: false,
      });
      let disposed = false;
      let closeTimer: ReturnType<typeof setTimeout> | null = null;
      const connection: Connection = { external, upstream, client: null, socket, dispose };
      connections.add(connection);

      function dispose(destroySocket = true): void {
        if (disposed) return;
        disposed = true;
        if (closeTimer !== null) clearTimeout(closeTimer);
        connections.delete(connection);
        connection.client?.terminate();
        upstream.terminate();
        if (destroySocket) socket.destroy();
      }

      function fail(error: Error): void {
        if (disposed) return;
        diagnostic(error);
        // A failed engine handshake must never appear to the browser as a working microphone.
        const upgraded = connection.client !== null;
        if (!upgraded) rejectUpgrade(socket, 502, 'Voice engine unavailable');
        dispose(upgraded);
      }

      function forward(destination: WebSocket, data: RawData, binary: boolean): void {
        if (disposed) return;
        if (destination.readyState !== WebSocket.OPEN || destination.bufferedAmount + byteLength(data) > MAX_BUFFERED_BYTES) {
          fail(new Error('voice WebSocket send queue unavailable'));
          return;
        }
        try {
          destination.send(data, { binary }, (error) => { if (error) fail(error); });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }

      socket.once('close', () => dispose());
      socket.on('error', fail);
      upstream.on('error', fail);
      upstream.on('message', (data, binary) => {
        if (connection.client !== null) forward(connection.client, data, binary);
      });
      upstream.on('close', (code) => {
        if (disposed) return;
        const client = connection.client;
        if (client === null) { fail(new Error('voice engine closed during handshake')); return; }
        // Let already queued final transcripts drain before completing the close handshake.
        client.close(code === 1000 ? 1000 : 1011);
        closeTimer = setTimeout(dispose, 1000);
        closeTimer.unref();
      });
      upstream.once('open', () => {
        if (disposed || closed || socket.destroyed) { dispose(); return; }
        try {
          server.handleUpgrade(req, socket, head, (client) => {
            connection.client = client;
            client.on('error', fail);
            client.on('close', () => dispose());
            client.on('message', (data, binary) => forward(upstream, data, binary));
          });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    closeExternalConnections() {
      for (const connection of connections) if (connection.external) connection.dispose();
    },
    close() {
      if (closed) return;
      closed = true;
      for (const connection of connections) connection.dispose();
      server.close();
    },
  };
}
