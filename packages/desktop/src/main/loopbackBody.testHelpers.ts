import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LoopbackBodyBudget, readLoopbackBody } from './loopbackBody';

export async function bodyServer(
  limits: { requestBytes: number; totalBytes: number },
  handle?: (payload: Buffer | undefined, res: ServerResponse, release: () => void) => void,
  observe?: (req: IncomingMessage) => void,
): Promise<{ server: Server; budget: LoopbackBodyBudget; port: number; close: () => Promise<void> }> {
  const budget = new LoopbackBodyBudget(limits);
  const server = createServer((req, res) => {
    observe?.(req);
    void readLoopbackBody(req, res, budget).then((body) => {
      if (!body) return;
      if (handle) handle(body.payload, res, body.release);
      else { res.end(body.payload); body.release(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // This fixture owns its ephemeral listener and every connection; no app/server is restarted.
  return {
    server, budget, port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => { if (error) reject(error); else resolve(); });
    }),
  };
}

export function postBody(port: number, chunks: Buffer[], headers?: Record<string, string>): Promise<{ status: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', headers }, (res) => {
      const data: Buffer[] = [];
      res.on('data', (chunk: Buffer) => data.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, data: Buffer.concat(data) }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}
