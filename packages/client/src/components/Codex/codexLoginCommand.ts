import type { CodexAuthLoginMode, PlatformName } from '@vibisual/shared';

/** The path comes from the host's setup probe, including when the client is a phone. */
export function codexLoginPlatform(binPath: string): PlatformName {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(binPath) ? 'win32' : 'linux';
}

export function buildCodexLoginCommand(binPath: string, mode: CodexAuthLoginMode, platform: PlatformName): {
  command: string;
  env: Record<string, string>;
} {
  // An environment expansion is one argument even for &, spaces or % in a Windows
  // username. No shell quoting helper is shared with interactive PTY commands.
  const executable = !binPath || binPath === 'codex' ? 'codex'
    : platform === 'win32' ? '"%VIBISUAL_CODEX_LOGIN_BIN%"' : '"$VIBISUAL_CODEX_LOGIN_BIN"';
  return {
    // The generic terminal runs a shell; exiting that shell makes CLI completion
    // observable through the existing onExit transport, even for unknown errors.
    command: `${executable} login${mode === 'device' ? ' --device-auth' : ''} && exit || exit`,
    env: { VIBISUAL_CODEX_LOGIN_BIN: binPath || 'codex' },
  };
}
