import { describe, expect, it } from 'vitest';

import { CHAPTER_THUMB_AT } from './chapterThumbs.js';
import { EXPORT_COMPANION_SUFFIX, EXPORT_FILE_NAME_MAX_BYTES } from './constants.js';
import { docPosterTime } from './docPoster.js';
import { buildChapterList, chapterClock, chapterListEntries, thumbnailTime, wantsSubtitleFile } from './exportExtras.js';
import { numberedName, utf8Bytes } from './exportNames.js';
import { DEFAULT_EXPORT_EXTRAS, DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from './exportSettings.js';
import { createEmptyDoc } from './ops.js';
import { normalizeRenderOutput } from './renderSpec.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { ResolvedTimeline, VideoChapter } from './types.js';

/** §5.13 (AA) 42-13 — 함께 내기의 순수 계산. */

function timelineOf(chapters: readonly Pick<VideoChapter, 'id' | 'title' | 'duration'>[]): ResolvedTimeline {
  const doc = { ...createEmptyDoc('d', 'Doc', 1), chapters: chapters.map((c) => ({ ...c, status: 'done' as const })) };
  return resolveTimeline(doc);
}

const three = timelineOf([
  { id: 'a', title: 'Intro', duration: 42.7 },
  { id: 'b', title: '', duration: 60 },
  { id: 'c', title: '  Wrap\nup ', duration: 30 },
]);

describe('설정 — 함께 내기는 기본 끔, 모르는 값은 끔으로', () => {
  it('옛 설정 파일(칸이 없다)은 모두 끔으로 읽힌다', () => {
    expect(normalizeExportSettings({ format: 'webm' }).extras).toEqual(DEFAULT_EXPORT_EXTRAS);
    expect(DEFAULT_EXPORT_SETTINGS.extras).toEqual({ thumbnail: false, chapters: false, subtitles: false });
  });

  it('켠 것만 켜지고 참·거짓이 아닌 값은 버린다', () => {
    expect(normalizeExportSettings({ extras: { thumbnail: true, chapters: 'yes', subtitles: 1, gif: true } }).extras)
      .toEqual({ thumbnail: true, chapters: false, subtitles: false });
  });

  it('일감의 놓는 방법에 선택·썸네일 시각·이름틀이 실린다', () => {
    const out = normalizeRenderOutput({ extras: { thumbnail: true, chapters: true }, thumbnailAt: 12.5, chapterLabel: '장면 {n}' });
    expect(out.extras).toEqual({ thumbnail: true, chapters: true, subtitles: false });
    expect(out.thumbnailAt).toBe(12.5);
    expect(out.chapterLabel).toBe('장면 {n}');
  });

  it('썸네일 시각은 유한한 0 이상의 수만 받는다', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '3', null, 10 ** 9]) {
      expect(normalizeRenderOutput({ thumbnailAt: bad }).thumbnailAt).toBeNull();
    }
    expect(normalizeRenderOutput({}).extras).toEqual(DEFAULT_EXPORT_EXTRAS);
  });
});

describe('자막 파일 — 따로 내기는 늘 함께, 그 밖에는 체크를 따른다', () => {
  it.each([
    ['separate', false, true],
    ['burn', true, true],
    ['none', true, true],
    ['burn', false, false],
    ['none', false, false],
  ] as const)('자막 %s · 체크 %s → %s', (captions, subtitles, want) => {
    expect(wantsSubtitleFile({ ...DEFAULT_EXPORT_EXTRAS, subtitles }, captions)).toBe(want);
  });

  it('설정 없이 걸린 종전 일감은 내지 않는다', () => {
    expect(wantsSubtitleFile(null, null)).toBe(false);
  });
});

describe('챕터 목록', () => {
  it('초는 내림하고 두 자리로 적는다', () => {
    expect(chapterClock(0, false)).toBe('00:00');
    expect(chapterClock(42.99, false)).toBe('00:42');
    expect(chapterClock(125, false)).toBe('02:05');
    expect(chapterClock(3725, true)).toBe('1:02:05');
    expect(chapterClock(59, true)).toBe('0:00:59');
  });

  it('장면마다 한 줄 — 빈 제목은 이름틀로, 줄바꿈이 든 제목은 한 줄로', () => {
    expect(buildChapterList(three, null, '장면 {n}')).toBe('00:00 Intro\n00:42 장면 2\n01:42 Wrap up\n');
  });

  it('이름틀이 없거나 순번 자리가 없으면 #n', () => {
    expect(chapterListEntries(three, null, null)[1]?.title).toBe('#2');
    expect(chapterListEntries(three, null, 'Scene')[1]?.title).toBe('#2');
  });

  it('구간 렌더는 걸친 장면만, 구간 시작을 0 으로 옮긴다(걸쳐 들어온 장면은 0 에서)', () => {
    expect(buildChapterList(three, { start: 50, end: 110 }, 'S{n}')).toBe('00:00 S2\n00:52 Wrap up\n');
  });

  it('한 시간을 넘는 줄이 있으면 전부 시:분:초', () => {
    const long = timelineOf([{ id: 'a', title: 'One', duration: 3700 }, { id: 'b', title: 'Two', duration: 10 }]);
    expect(buildChapterList(long)).toBe('0:00:00 One\n1:01:40 Two\n');
  });

  it('길이 0 인 장면은 빠지고, 장면이 없으면 빈 글', () => {
    const withEmpty = timelineOf([{ id: 'a', title: 'A', duration: 5 }, { id: 'b', title: 'B', duration: 0 }, { id: 'c', title: 'C', duration: 5 }]);
    expect(buildChapterList(withEmpty)).toBe('00:00 A\n00:05 C\n');
    expect(buildChapterList(timelineOf([]))).toBe('');
  });
});

describe('썸네일 시각', () => {
  it('고른 시각을 쓰되 마지막 프레임을 넘지 않는다', () => {
    expect(thumbnailTime(12, 60)).toBe(12);
    expect(thumbnailTime(500, 60)).toBeCloseTo(60 - 1 / 30);
  });

  it('고른 시각이 없으면 문서 갤러리 포스터와 같은 자리', () => {
    expect(thumbnailTime(null, 100)).toBe(docPosterTime(100));
    expect(thumbnailTime(undefined, 0)).toBe(0);
  });

  it('구간 렌더에서 구간 밖이면 그 구간의 대표 시각으로 옮긴다', () => {
    const range = { start: 20, end: 40 };
    expect(thumbnailTime(25, 100, range)).toBe(25);
    expect(thumbnailTime(5, 100, range)).toBeCloseTo(20 + 20 * CHAPTER_THUMB_AT);
    expect(thumbnailTime(40, 100, range)).toBeCloseTo(20 + 20 * CHAPTER_THUMB_AT);
    expect(thumbnailTime(null, 100, range)).toBeCloseTo(20 + 20 * CHAPTER_THUMB_AT);
  });
});

describe('딸림 파일 이름 — 세 OS 의 이름 상한 안', () => {
  it('가장 긴 줄기 + 번호 + 가장 긴 꼬리도 255바이트를 넘지 않는다', () => {
    const stem = numberedName('가'.repeat(200), 999);
    expect(utf8Bytes(stem)).toBeLessThanOrEqual(EXPORT_FILE_NAME_MAX_BYTES);
    for (const suffix of Object.values(EXPORT_COMPANION_SUFFIX)) expect(utf8Bytes(`${stem}${suffix}`)).toBeLessThanOrEqual(255);
  });
});
