import { CLAUDE_SETUP_INSTALL_COMMAND_WIN } from '@vibisual/shared';
import type { ClaudeAuthLoginMode, PlatformName } from '@vibisual/shared';

/** Use the host's probe, including when the renderer is a phone browser. */
export function claudeLoginPlatform(binPath: string, installCommand?: string): PlatformName {
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(binPath)) return 'win32';
  if (binPath.startsWith('/')) return 'linux'; // macOS and Linux use the same expansion below.
  return installCommand === CLAUDE_SETUP_INSTALL_COMMAND_WIN ? 'win32' : 'linux';
}

/** The optional field follows HTML email input syntax; quotes/control characters are not shell data. */
export function isClaudeLoginEmailValid(email: string): boolean {
  const value = email.trim();
  return !value || /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

export function buildClaudeLoginCommand(
  binPath: string,
  mode: ClaudeAuthLoginMode,
  email: string,
  platform: PlatformName,
): { command: string; env: Record<string, string> } {
  if (!isClaudeLoginEmailValid(email)) throw new Error('invalid-email');
  const bin = binPath || 'claude';
  // A Windows filename cannot contain quotes. Reject malformed probe values so an
  // environment expansion cannot break out of its surrounding cmd quotes.
  if (/[\u0000\r\n]/.test(bin) || (platform === 'win32' && bin.includes('"'))) throw new Error('invalid-binary-path');
  const ref = (name: string): string => platform === 'win32' ? `"%${name}%"` : `"$${name}"`;
  const executable = bin === 'claude' ? 'claude' : ref('VIBISUAL_CLAUDE_LOGIN_BIN');
  const value = email.trim();
  return {
    // Quoted environment expansion preserves &, %, $, spaces and apostrophes as
    // data instead of re-parsing user text as cmd/POSIX shell syntax.
    command: `${executable} auth login ${mode === 'console' ? '--console' : '--claudeai'}${value ? ` --email ${ref('VIBISUAL_CLAUDE_LOGIN_EMAIL')}` : ''} && exit || exit`,
    env: {
      VIBISUAL_CLAUDE_LOGIN_BIN: bin,
      ...(value ? { VIBISUAL_CLAUDE_LOGIN_EMAIL: value } : {}),
    },
  };
}
