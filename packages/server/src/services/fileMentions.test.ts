/** §5.1 #2-1 (C) — shared 추출기의 경로 문법과 긴 낱말 회귀. shared에는 시험 러너가 없다. */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { extractFileMentions } from '@vibisual/shared';

describe('extractFileMentions — 경로 문법 보존', () => {
  it.each([
    ['././assets/teaser.composition.json', ['assets/teaser.composition.json']],
    ['C:\\assets\\logo.PNG', ['/assets/logo.PNG']],
    ['https://example.test/assets/logo.png?size=2', ['/example.test/assets/logo.png']],
    ['a.png/b.wav c.png/tail', ['a.png/b.wav', 'c.png']],
    ['a.png/.hidden', ['a.png']],
    ['.png ..png .env .hidden.png', ['..png', '.hidden.png']],
    ['foo.png.unknown', ['foo.png']],
    ['foo.png.bogus', []],
    ['foo.png_suffix foo.tsxa', []],
    ['foo.png-suffix foo.wav#fragment', ['foo.png', 'foo.wav']],
    ['foo.png가 bar.png😀', ['foo.png', 'bar.png']],
    ['a.png\u00a0b.wav\u2028c.mp4\u3000d.json', ['a.png', 'b.wav', 'c.mp4', 'd.json']],
    ['[a.png],(b.wav);{c.mp4}|<d.json>*e.md=f.ts:g.glb?"h.jpg"',
      ['a.png', 'b.wav', 'c.mp4', 'd.json', 'e.md', 'f.ts', 'g.glb', 'h.jpg']],
  ])('%s', (text: string, expected: string[]) => {
    expect(extractFileMentions(text)).toEqual(expected);
  });

  it('정규화한 뒤 중복을 걷고 알려진 이름만 상한에 센다', () => {
    expect(extractFileMentions('./a.png a.png ././a.png foo.xyz b.wav c.mp4', 2)).toEqual(['a.png', 'b.wav']);
    expect(extractFileMentions('a.png', 0)).toEqual([]);
    expect(extractFileMentions('a.png', -1)).toEqual([]);
    expect(extractFileMentions('')).toEqual([]);
  });
});

describe('extractFileMentions — 긴 낱말이 메인 스레드를 붙들지 않는다', () => {
  it('256KiB dotless/base64/경로 뒤의 파일까지 읽고 긴 유효 이름도 보존한다', () => {
    // 동기 정규식 회귀는 Vitest 자신의 타이머까지 막는다. 별도 프로세스를 넉넉한 10초 안에
    // 끝내므로 느린 CI를 밀리초로 재지 않으면서, 과거의 수십 초~수분짜리 역추적은 안전하게 끊는다.
    const moduleUrl = new URL('../../../shared/dist/fileMentions.js', import.meta.url).href;
    const script = `
      import { extractFileMentions } from ${JSON.stringify(moduleUrl)};
      const size = 256 * 1024;
      const dotless = 'A'.repeat(size);
      const base64 = 'AB+/'.repeat(size / 4);
      const path = 'segment/'.repeat(size / 8);
      const longName = extractFileMentions(dotless + '.png');
      process.stdout.write(JSON.stringify({
        dotless: extractFileMentions(dotless + ' late.png'),
        base64: extractFileMentions('data:image/png;base64,' + base64 + '" after.mp4'),
        path: extractFileMentions(path + 'payload late.wav'),
        longNameCount: longName.length,
        longNameLength: longName[0]?.length,
        longNameSuffix: longName[0]?.slice(-4),
      }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      dotless: ['late.png'],
      base64: ['after.mp4'],
      path: ['late.wav'],
      longNameCount: 1,
      longNameLength: 256 * 1024 + 4,
      longNameSuffix: '.png',
    });
  });
});
