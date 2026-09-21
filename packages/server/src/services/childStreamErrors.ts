import type { ChildProcess } from 'node:child_process';

export type ChildStreamName = 'stdin' | 'stdout' | 'stderr';

/**
 * ChildProcess 'error' does not handle errors emitted by its separate stdio streams.
 * A write can return normally before EOF/EPIPE is emitted on a later tick. Attach before writing,
 * and keep listeners through close: already queued errors may arrive after the operation settles.
 * The owner decides how to settle its operation; there is no process-global recovery here.
 */
export function observeChildStreamErrors(
  child: ChildProcess,
  onError: (stream: ChildStreamName, error: Error) => void,
): void {
  for (const name of ['stdin', 'stdout', 'stderr'] as const) {
    child[name]?.on('error', (error: Error) => onError(name, error));
  }
}
