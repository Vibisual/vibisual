import type { EventEmitter } from 'node:events';

const LIMITS = { message: 4000, stack: 8000 };
type FaultKind = 'uncaughtException' | 'unhandledRejection' | 'stdout' | 'stderr' | 'hook' | 'hook-listener';
interface DiagnosticSinks {
  persist: (message: string, stack?: string) => void;
  publish: (message: string, stack?: string) => void;
  console: (message: string) => void;
}

function describeFailure(value: unknown): { message: string; stack?: string } {
  try {
    if (value instanceof Error) {
      return {
        message: String(value.message).slice(0, LIMITS.message),
        ...(typeof value.stack === 'string' ? { stack: value.stack.slice(0, LIMITS.stack) } : {}),
      };
    }
    return { message: String(value).slice(0, LIMITS.message) };
  } catch {
    return { message: 'Unprintable error value' };
  }
}

/** Diagnostic failures cannot recurse into the same broken output pipe or skip the durable record.
 * VS Code encountered this teardown loop: github.com/microsoft/vscode/blob/main/src/server-main.ts.
 * This only isolates diagnostic sinks; it does not make an unknown main-process exception safe.
 */
export function createMainDiagnostics(sinks: DiagnosticSinks): {
  report: (kind: FaultKind, error: unknown) => void;
  guardStreams: (stdout: EventEmitter, stderr: EventEmitter) => () => void;
} {
  let reporting = false;
  let consoleAvailable = true;
  const failedStreams = new Set<'stdout' | 'stderr'>();
  const report = (kind: FaultKind, error: unknown): void => {
    if (reporting) return;
    reporting = true;
    try {
      const detail = describeFailure(error);
      const message = `${kind}: ${detail.message}`;
      try { sinks.persist(message, detail.stack); } catch { /* A full disk must not break the other sinks. */ }
      try { sinks.publish(message, detail.stack); } catch { /* A broken renderer must not re-enter reporting. */ }
      if (consoleAvailable) {
        try { sinks.console(message); } catch { consoleAvailable = false; }
      }
    } finally {
      reporting = false;
    }
  };
  const guardStreams = (stdout: EventEmitter, stderr: EventEmitter): (() => void) => {
    const failed = (name: 'stdout' | 'stderr', error: unknown): void => {
      consoleAvailable = false;
      if (failedStreams.has(name)) return;
      failedStreams.add(name);
      report(name, error);
    };
    const out = (error: unknown): void => failed('stdout', error);
    const err = (error: unknown): void => failed('stderr', error);
    stdout.on('error', out);
    stderr.on('error', err);
    return (): void => { stdout.off('error', out); stderr.off('error', err); };
  };
  return { report, guardStreams };
}
