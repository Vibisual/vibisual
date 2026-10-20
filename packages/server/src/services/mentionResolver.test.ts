/** §5.1 #2-1 (C) — 깊은 파일 언급도 접미를 되짚으며 메인 스레드를 붙들지 않는다. */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createMentionResolver } from '@vibisual/shared';

describe('createMentionResolver — 가장 긴 접미와 후보 경계', () => {
  const candidates = [
    { id: 'logo-a', path: 'assets/logo.png' },
    { id: 'logo-b', path: 'brand/logo.png' },
    { id: 'sound', path: 'audio/theme.wav' },
  ];

  it('더 긴 경로는 후보를 좁히고 모호한 이름만으로는 잇지 않는다', () => {
    const resolve = createMentionResolver(candidates, 'linux');
    expect(resolve(['root/assets/logo.png'], 'self')).toEqual(['logo-a']);
    expect(resolve(['root/unknown/logo.png'], 'self')).toEqual([]);
    expect(resolve(['theme.wav'], 'self')).toEqual(['sound']);
    expect(resolve(['assets/nope.png'], 'self')).toEqual([]);
  });

  it('가장 긴 접미가 자기 자신이면 더 짧은 접미로 돌아가지 않는다', () => {
    const resolve = createMentionResolver(candidates, 'linux');
    expect(resolve(['root/assets/logo.png', 'brand/logo.png'], 'logo-a')).toEqual(['logo-b']);
  });

  it('같은 id의 중복 경로는 모호하지 않고 다른 id가 붙으면 모호함을 유지한다', () => {
    const resolve = createMentionResolver([
      { id: 'one', path: 'a/logo.png' },
      { id: 'one', path: 'a/logo.png' },
      { id: 'one', path: 'b/logo.png' },
      { id: 'two', path: 'b/logo.png' },
      { id: 'one', path: 'b/logo.png' },
    ], 'linux');
    expect(resolve(['a/logo.png'], 'self')).toEqual(['one']);
    expect(resolve(['b/logo.png'], 'self')).toEqual([]);
    expect(resolve(['logo.png'], 'self')).toEqual([]);
  });

  it.each(['win32', 'darwin', 'linux'])('정규화·대소문자 규칙을 %s에서 유지한다', (platform) => {
    const resolve = createMentionResolver(candidates, platform);
    expect(resolve(['.\\root\\..\\assets\\.\\logo.png'], 'self')).toEqual(['logo-a']);
    expect(resolve(['ROOT/ASSETS/LOGO.PNG'], 'self')).toEqual(platform === 'linux' ? [] : ['logo-a']);
    expect(resolve(['', '/', '.', '..'], 'self')).toEqual([]);
  });

  it('결과의 순서·중복 제거·상한을 유지한다', () => {
    const tokens = ['theme.wav', 'audio/theme.wav', 'assets/logo.png', 'brand/logo.png'];
    expect(createMentionResolver(candidates, 'linux', 2)(tokens, 'self')).toEqual(['sound', 'logo-a']);
    expect(createMentionResolver(candidates, 'linux', 0)(tokens, 'self')).toEqual([]);
    expect(createMentionResolver(candidates, 'linux', -1)(tokens, 'self')).toEqual([]);
    expect(createMentionResolver([], 'linux')(tokens, 'self')).toEqual([]);
  });
});

describe('createMentionResolver — 긴 유효 경로', () => {
  it('256KiB 경로의 색인·추출·해소를 끝내고 뒤의 파일과 긴 후보 자체도 보존한다', () => {
    // 동기 연산이 회귀해도 시험 러너의 타이머를 막지 않도록 별도 프로세스에서 끊는다.
    const moduleUrl = new URL('../../../shared/dist/fileMentions.js', import.meta.url).href;
    const script = `
      import { createMentionResolver, extractFileMentions } from ${JSON.stringify(moduleUrl)};
      const prefix = 'segment/'.repeat(32768);
      const longPath = prefix + 'assets/logo.png';
      const resolve = createMentionResolver([
        { id: 'logo', path: 'assets/logo.png' },
        { id: 'other', path: 'brand/logo.png' },
        { id: 'late', path: 'audio/late.wav' },
      ], 'linux');
      const longCandidate = createMentionResolver([
        { id: 'deep', path: longPath },
        { id: 'shallow', path: 'brand/logo.png' },
      ], 'linux');
      process.stdout.write(JSON.stringify({
        resolved: resolve(extractFileMentions(longPath + ' late.wav'), 'self'),
        later: resolve(extractFileMentions(prefix + 'absent.png late.wav'), 'self'),
        indexed: longCandidate([longPath], 'self'),
        self: longCandidate([longPath], 'deep'),
        ambiguous: longCandidate(['logo.png'], 'self'),
      }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      resolved: ['logo', 'late'], later: ['late'], indexed: ['deep'], self: [], ambiguous: [],
    });
  });
});
