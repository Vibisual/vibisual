import { describe, it, expect } from 'vitest';
import { buildCliInvocation } from './claudeCliRun.js';

// 멀티플랫폼 규칙 — 분기 함수가 `platform` 을 인자로 받으므로 개발기 한 대에서 세 OS 를 다 잰다.

describe('buildCliInvocation', () => {
  it('mac/linux 는 셸을 끼우지 않는다', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const inv = buildCliInvocation('/usr/local/bin/claude', ['-p', '/usage'], platform);
      expect(inv).toEqual({ file: '/usr/local/bin/claude', args: ['-p', '/usage'], shell: false });
    }
  });

  it('Windows 네이티브 실행본(.exe)도 셸 없이 그대로 — 인용 규칙이 끼어들 자리가 없다', () => {
    const inv = buildCliInvocation('C:\\Program Files\\Claude\\claude.exe', ['-p', '/usage'], 'win32');
    expect(inv.shell).toBe(false);
    expect(inv.file).toBe('C:\\Program Files\\Claude\\claude.exe');
  });

  it('Windows 의 .cmd shim 만 셸 경유 — 공백이 든 경로는 따옴표로 감싼다', () => {
    const inv = buildCliInvocation('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '/usage'], 'win32');
    expect(inv.shell).toBe(true);
    expect(inv.file).toBe('"C:\\Program Files\\nodejs\\claude.cmd"');
    expect(inv.args).toEqual(['-p', '/usage']);
  });

  it('공백이 든 인자도 셸 경유일 때만 감싼다', () => {
    const inv = buildCliInvocation('C:\\bin\\claude.bat', ['--settings', 'C:\\a b\\s.json'], 'win32');
    expect(inv.args).toEqual(['--settings', '"C:\\a b\\s.json"']);
  });
});
