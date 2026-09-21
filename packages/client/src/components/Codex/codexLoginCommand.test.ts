import { describe, expect, it } from 'vitest';
import { buildCodexLoginCommand, codexLoginPlatform } from './codexLoginCommand.js';

describe('Codex login PTY command', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s passes the executable as one environment argument and closes its shell', (platform) => {
    const bin = platform === 'win32' ? 'C:\\Tools\\A&B %DEMO%\\bin\\codex.cmd' : '/opt/A&B $DEMO/it\'s codex';
    const result = buildCodexLoginCommand(bin, 'device', platform);
    expect(result.env).toEqual({ VIBISUAL_CODEX_LOGIN_BIN: bin });
    expect(result.command).toBe(`${platform === 'win32' ? '"%VIBISUAL_CODEX_LOGIN_BIN%"' : '"$VIBISUAL_CODEX_LOGIN_BIN"'} login --device-auth && exit || exit`);
    expect(result.command).not.toContain(bin);
  });

  it('uses the host binary path, not the phone browser OS', () => {
    expect(codexLoginPlatform('C:\\Tools\\codex.cmd')).toBe('win32');
    expect(codexLoginPlatform('\\\\host\\tools\\codex.exe')).toBe('win32');
    expect(codexLoginPlatform('/opt/homebrew/bin/codex')).toBe('linux');
  });

  it('browser sign-in keeps the normal login command', () => {
    expect(buildCodexLoginCommand('/bin/codex', 'browser', 'linux').command).not.toContain('--device-auth');
  });

  it('bare codex works when setup has not supplied a host platform yet', () => {
    expect(buildCodexLoginCommand('codex', 'browser', 'linux').command).toBe('codex login && exit || exit');
  });
});
