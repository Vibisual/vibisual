import { describe, expect, it } from 'vitest';
import {
  fileUrlToPath, localLinkTargets, presentedFilesIn, PresentedFileTracker, type PresentedEventLike,
} from '@vibisual/shared';

const text = (content: string, extra: Partial<PresentedEventLike> = {}): PresentedEventLike => ({
  subAgentId: 's1', eventType: 'text', content, turnId: 't1', ...extra,
});

describe('presented file links', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('turns file URLs into paths on %s', (platform) => {
    const url = platform === 'win32' ? 'file:///C:/Out/my%20sheet.png' : 'file:///srv/out/my%20sheet.png';
    expect(fileUrlToPath(url, platform)).toBe(platform === 'win32' ? 'C:/Out/my sheet.png' : '/srv/out/my sheet.png');
    expect(fileUrlToPath('/srv/plain.png', platform)).toBe('/srv/plain.png');
  });

  it('keeps linked previews our app opens and drops code, web addresses and plain mentions', () => {
    const prose = [
      '[시트](file:///C:/Out/sheet.png) [보고서](C:\\Out\\report.pdf) [영상](<C:/Out/my clip.mp4>)',
      '[검수표](Docs/Temp/검수표.html#요약) [코드](src/app.ts) [웹](https://example.com/a.png) /plain/path.png',
      '`[예시](C:/Out/inline.png)`',
      '```md',
      '[펜스](C:/Out/fenced.png)',
      '```',
      '[다시](file:///C:/Out/sheet.png)',
    ].join('\n');
    expect(presentedFilesIn(prose, 'win32')).toEqual([
      { path: 'C:/Out/sheet.png', relative: false },
      { path: 'C:\\Out\\report.pdf', relative: false },
      { path: 'C:/Out/my clip.mp4', relative: false },
      { path: 'Docs/Temp/검수표.html', relative: true },
    ]);
  });

  it('lists every local destination for callers that pick their own kinds', () => {
    expect(localLinkTargets('[a](src/app.ts) [b](/srv/x.png) [c](#top) [d](~/x.png)', 'linux')).toEqual([
      { path: 'src/app.ts', relative: true },
      { path: '/srv/x.png', relative: false },
    ]);
  });
});

describe('presented file tracker', () => {
  it('stitches a link split across streamed chunks and reports it once per turn', () => {
    const tracker = new PresentedFileTracker('win32');
    expect(tracker.take(text('완성: [시트](C:/Ou'))).toEqual([]);
    expect(tracker.take(text('t/sheet.pn'))).toEqual([]);
    expect(tracker.take(text('g) 확인하세요\n'))).toEqual([{ path: 'C:/Out/sheet.png', relative: false }]);
    expect(tracker.take(text('', { imagePath: 'C:\\Out\\sheet.png' }))).toEqual([]);
    expect(tracker.take(text('[시트](C:/Out/sheet.png)', { turnId: 't2' }))).toEqual([{ path: 'C:/Out/sheet.png', relative: false }]);
  });

  it('reports an engine picture line by itself', () => {
    const tracker = new PresentedFileTracker('win32');
    expect(tracker.take(text('texture-sheet.png', { imagePath: 'C:\\Proj\\tmp\\texture-sheet.png' })))
      .toEqual([{ path: 'C:\\Proj\\tmp\\texture-sheet.png', relative: false }]);
  });

  it('does not read links inside inline code or fences even when they arrive in pieces', () => {
    const tracker = new PresentedFileTracker('linux');
    expect(tracker.take(text('`[예시](/srv/a.png)'))).toEqual([]);
    expect(tracker.take(text('` 와\n'))).toEqual([]);
    expect(tracker.take(text('```md\n[펜스](/srv/b.png)\n'))).toEqual([]);
    expect(tracker.take(text('```\n[밖](/srv/c.png)\n'))).toEqual([{ path: '/srv/c.png', relative: false }]);
  });

  it('cuts runs where the conversation cuts bubbles but not at status chips', () => {
    const tracker = new PresentedFileTracker('linux');
    tracker.take(text('[a](/srv/a'));
    expect(tracker.take({ subAgentId: 's1', eventType: 'system', content: '[status]', turnId: 'older-turn' })).toEqual([]);
    expect(tracker.take(text('.png)'))).toEqual([{ path: '/srv/a.png', relative: false }]);
    tracker.take(text('[b](/srv/b'));
    tracker.take({ subAgentId: 's1', eventType: 'tool_use', content: '{}', turnId: 't1' });
    expect(tracker.take(text('.png)'))).toEqual([]);
    tracker.take(text('[c](/srv/c'));
    expect(tracker.take(text('.png)', { nestedUnderToolUseId: 'task-1' }))).toEqual([]);
  });

  it('ignores files our app does not open and keeps sessions apart', () => {
    const tracker = new PresentedFileTracker('linux');
    expect(tracker.take(text('[코드](/srv/app.ts) [메모](/srv/notes.md) [모델](/srv/hero.glb)\n')))
      .toEqual([{ path: '/srv/hero.glb', relative: false }]);
    expect(tracker.take(text('[모델](/srv/hero.glb)\n', { subAgentId: 's2' })))
      .toEqual([{ path: '/srv/hero.glb', relative: false }]);
  });
});
