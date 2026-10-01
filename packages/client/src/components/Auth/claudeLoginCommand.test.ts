import { describe, expect, it } from 'vitest';
import { CLAUDE_SETUP_INSTALL_COMMAND_WIN } from '@vibisual/shared';
import { buildClaudeLoginCommand, claudeLoginPlatform, isClaudeLoginEmailValid } from './claudeLoginCommand.js';

describe('Claude sign-in passes user data outside shell syntax', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s preserves special characters in the binary path and email', (platform) => {
    const bin = platform === 'win32' ? 'C:\\Tools\\R&D %DEMO%\\claude.cmd' : '/opt/R&D $DEMO/it\'s claude';
    const email = "r&d+$DEMO%DEMO%'test@example.invalid";
    const result = buildClaudeLoginCommand(bin, 'claudeai', email, platform);
    expect(result.env).toEqual({ VIBISUAL_CLAUDE_LOGIN_BIN: bin, VIBISUAL_CLAUDE_LOGIN_EMAIL: email });
    expect(result.command).not.toContain(bin);
    expect(result.command).not.toContain(email);
    const ref = (key: string) => platform === 'win32' ? `"%${key}%"` : `"$${key}"`;
    expect(result.command).toBe(`${ref('VIBISUAL_CLAUDE_LOGIN_BIN')} auth login --claudeai --email ${ref('VIBISUAL_CLAUDE_LOGIN_EMAIL')} && exit || exit`);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s keeps Console mode and omits a blank optional email', (platform) => {
    const result = buildClaudeLoginCommand('', 'console', '  ', platform);
    expect(result.command).toBe('claude auth login --console && exit || exit');
    expect(result.env).toEqual({ VIBISUAL_CLAUDE_LOGIN_BIN: 'claude' });
  });

  it('uses the host path before the fallback installer, without inspecting the browser OS', () => {
    expect(claudeLoginPlatform('C:\\Tools\\claude.exe')).toBe('win32');
    expect(claudeLoginPlatform('\\\\server\\tools\\claude.exe')).toBe('win32');
    expect(claudeLoginPlatform('/opt/homebrew/bin/claude', CLAUDE_SETUP_INSTALL_COMMAND_WIN)).toBe('linux');
    expect(claudeLoginPlatform('claude', CLAUDE_SETUP_INSTALL_COMMAND_WIN)).toBe('win32');
    expect(claudeLoginPlatform('claude', 'curl ... | bash')).toBe('linux');
  });

  it.each(['', 'r&d@example.invalid', "o'connor@example.invalid", 'a+b@example.invalid', 'user@localhost'])(
    'accepts optional/HTML email input %s', (email) => expect(isClaudeLoginEmailValid(email)).toBe(true),
  );

  it.each(['not-an-email', 'a"&echo@example.invalid', 'a\nb@example.invalid', 'a\u0000b@example.invalid', 'a b@example.invalid'])(
    'rejects malformed input before constructing any shell command: %s', (email) => {
      expect(isClaudeLoginEmailValid(email)).toBe(false);
      expect(() => buildClaudeLoginCommand('claude', 'claudeai', email, 'win32')).toThrow('invalid-email');
    },
  );

  it('rejects a malformed Windows probe path instead of breaking cmd quoting', () => {
    expect(() => buildClaudeLoginCommand('C:\\bad"&path\\claude.exe', 'claudeai', '', 'win32')).toThrow('invalid-binary-path');
    expect(() => buildClaudeLoginCommand('/opt/bad\npath/claude', 'claudeai', '', 'linux')).toThrow('invalid-binary-path');
  });
});
