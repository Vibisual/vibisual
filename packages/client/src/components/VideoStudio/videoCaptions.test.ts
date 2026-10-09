import { describe, expect, it } from 'vitest';
import { applyPatch, buildDrawList, captionTextAt, createEmptyDoc, resolveTimeline } from '@vibisual/video';
import { buildCaptionOps, parseSrt } from './videoCaptions.js';

describe('SRT import', () => {
  it('accepts BOM, CRLF, multiline text, fractional timestamps, and sorts unsorted cues', () => {
    expect(parseSrt('\uFEFF2\r\n00:00:04,500 --> 00:00:06,200\r\nSecond\r\nline\r\n\r\n1\r\n00:00:01.025 --> 00:00:03.000\r\nFirst')).toEqual([
      { start: 1.025, end: 3, text: 'First' }, { start: 4.5, end: 6.2, text: 'Second\nline' },
    ]);
    expect(parseSrt(' \n')).toEqual([]);
  });

  it.each([
    '1\n00:01:00,000 --> 00:00:02,000\nBackwards',
    '1\n00:00:02,000 --> 00:00:02,000\nZero',
    '1\n00:60:00,000 --> 00:61:00,000\nInvalid minutes',
    '1\n00:00:00,000 --> 00:00:01,000\n',
    '1\n00:00:00,000 --> 00:00:01,000\nGood\n\n2\nBroken\nLost',
  ])('rejects a malformed import rather than dropping a subtitle', input => {
    expect(() => parseSrt(input)).toThrow(/Invalid SRT cue/);
  });

  it('preserves millisecond absolute cue times and renders an imported late-start subtitle', () => {
    const doc = { ...createEmptyDoc('captions', 'SRT', 100), tracks: [] };
    const cues = parseSrt('1\n00:00:10,025 --> 00:00:12,500\nHello\n\n2\n00:00:15,250 --> 00:00:16,000\nWorld');
    const ops = buildCaptionOps(doc, cues, 'Subtitles');
    const result = applyPatch(doc, { baseVersion: doc.version, ops });
    if (!result.ok) throw new Error('Patch rejected');
    const timeline = resolveTimeline(result.doc);
    expect(timeline.diagnostics).toEqual([]);
    expect(timeline.items[0]).toMatchObject({ trackKind: 'caption', start: 10.025, duration: 5.975 });
    expect(captionTextAt(buildDrawList(result.doc, timeline, 10.5))).toBe('Hello');
    expect(captionTextAt(buildDrawList(result.doc, timeline, 14))).toBe('');
    expect(captionTextAt(buildDrawList(result.doc, timeline, 15.5))).toBe('World');
    expect(buildCaptionOps(doc, [{ start: NaN, end: 1, text: 'Bad' }], '')).toEqual([]);
    expect(buildCaptionOps(doc, [], '')).toEqual([]);
  });
});
