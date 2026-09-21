import http, { type RequestListener } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';

/** Ephemeral loopback inspector fixture; never starts an application or a debuggee. */
export async function inspectorFixture(options: {
  respond?: RequestListener;
  holdUpgrade?: boolean;
  rejectUpgrade?: boolean;
} = {}) {
  let port = 0;
  const sockets = new Set<Socket>();
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer(options.respond ?? ((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/inspector` }]));
  }));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (options.holdUpgrade) return;
    if (options.rejectUpgrade) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not listen');
  port = address.port;
  return {
    server, wss, port,
    close: async (): Promise<void> => {
      for (const ws of wss.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
  };
}
