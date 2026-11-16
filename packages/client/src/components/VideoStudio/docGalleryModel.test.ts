import { describe, expect, it } from 'vitest';

import {
  GALLERY_PAGE, docLabel, docRatioLabel, formatDocLength, formatEditedAt, galleryKeyAction, galleryLayout, galleryRows, searchKey,
} from './docGalleryModel.js';
import type { DocSummary } from './videoApi.js';

const doc = (id: string, title: string, updatedAt: number, extra: Partial<DocSummary> = {}): DocSummary => ({ id, title, updatedAt, version: 1, ...extra });

describe('문서 갤러리 — 검색·정렬', () => {
  const docs = [doc('a', 'Alpha Intro', 100), doc('b', '가을 여행', 300), doc('c', 'alpha outro', 200), doc('d', '', 50)];

  it('기본은 고친 시각 최근순이고 개수를 자르지 않는다', () => {
    expect(galleryRows(docs, '').map((d) => d.id)).toEqual(['b', 'c', 'a', 'd']);
    const many = Array.from({ length: 500 }, (_, i) => doc(`d${i}`, `Doc ${i}`, i));
    expect(galleryRows(many, '')).toHaveLength(500);
    expect(galleryRows(many, '')[0]?.id).toBe('d499');
  });

  it('제목 부분 일치 — 대소문자를 가리지 않고 검색 중에도 최근순', () => {
    expect(galleryRows(docs, 'ALPHA').map((d) => d.id)).toEqual(['c', 'a']);
    expect(galleryRows(docs, '  intro ').map((d) => d.id)).toEqual(['a']);
    expect(galleryRows(docs, 'zzz')).toEqual([]);
  });

  it('입력 중인 한글(자모)도 같은 글자로 맞춘다 — 분해형 입력은 합쳐서 견준다', () => {
    const composed = '가을 여행';
    const decomposed = composed.normalize('NFD');
    expect(searchKey(decomposed)).toBe(searchKey(composed));
    expect(galleryRows(docs, decomposed).map((d) => d.id)).toEqual(['b']);
    expect(galleryRows(docs, '가을').map((d) => d.id)).toEqual(['b']);
    expect(galleryRows(docs, '가').map((d) => d.id)).toEqual(['b']);
  });

  it('제목이 비었으면 id 로 보이고 id 로도 찾힌다', () => {
    expect(docLabel(docs[3] as DocSummary)).toBe('d');
    expect(galleryRows(docs, 'd').some((d) => d.id === 'd')).toBe(true);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const copy = [...docs];
    galleryRows(docs, 'a');
    expect(docs).toEqual(copy);
  });
});

describe('문서 갤러리 — 글자', () => {
  it('판형은 크기에서 — 모르면 null', () => {
    expect(docRatioLabel({ width: 1920, height: 1080 })).toBe('16:9');
    expect(docRatioLabel({ width: 1080, height: 1920 })).toBe('9:16');
    expect(docRatioLabel({ width: 1080, height: 1080 })).toBe('1:1');
    expect(docRatioLabel({})).toBeNull();
  });

  it('길이는 m:ss, 한 시간 넘으면 h:mm:ss, 모르면 null', () => {
    expect(formatDocLength(0)).toBe('0:00');
    expect(formatDocLength(65.4)).toBe('1:05');
    expect(formatDocLength(3725)).toBe('1:02:05');
    expect(formatDocLength(undefined)).toBeNull();
    expect(formatDocLength(Number.NaN)).toBeNull();
  });

  it('고친 시각은 2주 안이면 상대 표기, 넘으면 날짜', () => {
    const now = Date.UTC(2026, 10, 11, 12, 0, 0);
    expect(formatEditedAt(now - 5 * 60_000, now, 'en')).toMatch(/5 minutes ago/);
    expect(formatEditedAt(now - 3 * 3_600_000, now, 'en')).toMatch(/3 hours ago/);
    expect(formatEditedAt(now - 40 * 86_400_000, now, 'en')).toMatch(/\d/);
    expect(formatEditedAt(now - 40 * 86_400_000, now, 'en')).not.toMatch(/ago/);
  });
});

describe('문서 갤러리 — 배치', () => {
  it('창 폭 등급마다 열 수가 다르고 좁은 창은 가로 줄 한 열', () => {
    expect(galleryLayout('narrow')).toMatchObject({ columns: 1, row: true, gridClass: 'grid-cols-1' });
    expect(galleryLayout('compact')).toMatchObject({ columns: 2, row: false, gridClass: 'grid-cols-2' });
    expect(galleryLayout('regular')).toMatchObject({ columns: 3, gridClass: 'grid-cols-3' });
    expect(galleryLayout('unmeasured').columns).toBe(3);
    expect(galleryLayout('wide')).toMatchObject({ columns: 4, gridClass: 'grid-cols-4' });
  });

  it('판 폭은 화면 폭에 clamp 한다(고정 폭 ❌)', () => {
    for (const tier of ['narrow', 'compact', 'regular', 'wide'] as const) expect(galleryLayout(tier).panelClass).toContain('100vw');
  });

  it('처음 그리는 카드 수는 상한이 아니라 한 쪽이다', () => {
    expect(GALLERY_PAGE).toBeGreaterThan(0);
  });
});

describe('문서 갤러리 — 검색 칸 키', () => {
  it('한글 조합 중에는 어떤 키도 가로채지 않는다', () => {
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape']) {
      expect(galleryKeyAction(key, { composing: true, count: 5, active: 1 })).toEqual({ kind: 'none' });
    }
  });

  it('위·아래는 한 칸씩 가장자리에서 멈추고 Enter 는 열기, Esc 는 닫기', () => {
    expect(galleryKeyAction('ArrowDown', { composing: false, count: 3, active: 0 })).toEqual({ kind: 'move', index: 1 });
    expect(galleryKeyAction('ArrowDown', { composing: false, count: 3, active: 2 })).toEqual({ kind: 'move', index: 2 });
    expect(galleryKeyAction('ArrowUp', { composing: false, count: 3, active: 0 })).toEqual({ kind: 'move', index: 0 });
    expect(galleryKeyAction('Enter', { composing: false, count: 3, active: 1 })).toEqual({ kind: 'open' });
    expect(galleryKeyAction('Escape', { composing: false, count: 0, active: -1 })).toEqual({ kind: 'close' });
  });

  it('결과가 없으면 Enter·화살표는 아무 일도 하지 않고 좌우 키는 커서 몫이다', () => {
    expect(galleryKeyAction('Enter', { composing: false, count: 0, active: -1 })).toEqual({ kind: 'none' });
    expect(galleryKeyAction('ArrowDown', { composing: false, count: 0, active: -1 })).toEqual({ kind: 'none' });
    expect(galleryKeyAction('ArrowLeft', { composing: false, count: 3, active: 1 })).toEqual({ kind: 'none' });
    expect(galleryKeyAction('Home', { composing: false, count: 3, active: 1 })).toEqual({ kind: 'none' });
  });
});
