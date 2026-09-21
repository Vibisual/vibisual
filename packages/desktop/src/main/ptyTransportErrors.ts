interface ErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function errorSource(value: unknown): ErrorSource | undefined {
  return typeof asRecord(value)?.on === 'function' ? value as ErrorSource : undefined;
}

/**
 * node-pty 1.1.0's legacy on('error') observes output, but Windows conin is a different socket.
 * Confirmed in the installed package; upstream report: https://github.com/microsoft/node-pty/issues/942.
 * Keep this private compatibility access here, shape checked. Do not patch the package/prototype.
 * Listeners deliberately survive PTY exit, since a queued write error can arrive during teardown.
 */
export function observePtyTransportErrors(
  terminal: unknown,
  onError: (side: 'input' | 'output', error: Error) => void,
  platform: NodeJS.Platform = process.platform,
): void {
  errorSource(terminal)?.on('error', (error) => {
    const code = asRecord(error)?.code;
    // Match node-pty 1.1.0: POSIX reads can transiently EAGAIN; EIO/errno 5 means
    // the child closed its PTY. Its normal exit callback owns the final exit code.
    if (typeof code === 'string' && (code.includes('EIO') || code.includes('errno 5')
      || (platform !== 'win32' && code.includes('EAGAIN')))) return;
    onError('output', error);
  });
  const agent = asRecord(asRecord(terminal)?._agent);
  errorSource(agent?.inSocket)?.on('error', (error) => onError('input', error));
}
