import { StringDecoder } from 'node:string_decoder';
import type { ChildProcess } from 'node:child_process';
import { observeChildStreamErrors } from './childStreamErrors.js';

export class CodexAppServerRpcError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function rpcRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export interface CodexAppServerRpcOptions {
  requestTimeoutMs: number;
  maxLineChars: number;
  onActivity: () => void;
  onNotification: (method: string, params: unknown) => void;
  onRequest: (id: string | number, method: string, params: unknown) => void;
  onFailure: (error: Error) => void;
}

/** Line-delimited JSON-RPC. An unanswered write is never reported as a rejected request. */
export class CodexAppServerRpc {
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private disposed = false;

  constructor(private readonly child: ChildProcess, private readonly options: CodexAppServerRpcOptions) {
    child.stdout?.on('data', this.handleStdout);
    child.stderr?.on('data', this.handleStderr);
    observeChildStreamErrors(child, (stream, error) => {
      if (!this.disposed) options.onFailure(new Error(`Codex app-server ${stream} failed: ${error.message}`));
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('Codex app-server connection is closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} acknowledgement timed out; delivery is unknown`));
      }, this.options.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: string | number, result: unknown): void { this.write({ id, result }); }

  rejectRequest(id: string | number, message: string): void {
    this.write({ id, error: { code: -32601, message } });
  }

  dispose(error = new Error('Codex app-server connection closed')): void {
    if (this.disposed) return;
    this.disposed = true;
    this.child.stdout?.off('data', this.handleStdout);
    this.child.stderr?.off('data', this.handleStderr);
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private write(value: object): void {
    if (this.disposed || !this.child.stdin || this.child.stdin.destroyed)
      throw new Error('Codex app-server input is closed');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }

  private handleStderr = (chunk: Buffer | string): void => {
    if (!this.disposed && chunk.length > 0) this.options.onActivity();
  };

  private handleStdout = (chunk: Buffer | string): void => {
    if (this.disposed || chunk.length === 0) return;
    this.options.onActivity();
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let newline: number;
    while (!this.disposed && (newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > this.options.maxLineChars) {
        this.options.onFailure(new Error('Codex app-server response exceeded the line limit'));
        return;
      }
      this.handleLine(line);
    }
    if (this.buffer.length > this.options.maxLineChars)
      this.options.onFailure(new Error('Codex app-server response exceeded the line limit'));
  };

  private handleLine(line: string): void {
    let message: Record<string, unknown> | undefined;
    try { message = rpcRecord(JSON.parse(line)); } catch { return; }
    if (!message) return;
    if (typeof message.method === 'string') {
      if (typeof message.id === 'string' || typeof message.id === 'number')
        this.options.onRequest(message.id, message.method, message.params);
      else this.options.onNotification(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    const error = rpcRecord(message.error);
    if (error) pending.reject(new CodexAppServerRpcError(
      typeof error.message === 'string' ? error.message : 'Codex app-server request rejected',
      typeof error.code === 'number' ? error.code : undefined,
    ));
    else pending.resolve(message.result);
  }
}
