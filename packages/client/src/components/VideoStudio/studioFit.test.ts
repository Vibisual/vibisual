import { describe, expect, it } from 'vitest';

import { NOTE_EDITOR, clampSpan, narrowChapterIds, noteEditorPlacement, type PreviewBounds } from './studioFit.js';

describe('반응형 — clampSpan(칸을 영역 안으로)', () => {
  it('들어맞으면 그대로 둔다', () => {
    expect(clampSpan(20, 80, 400)).toBe(20);
    expect(clampSpan(20, 80, 400, 8)).toBe(20);
  });

  it('끝을 넘으면 안으로 당기고, 앞을 넘으면 여백까지 민다', () => {
    expect(clampSpan(350, 80, 400)).toBe(320);
    expect(clampSpan(350, 80, 400, 8)).toBe(312);
    expect(clampSpan(-30, 80, 400, 8)).toBe(8);
  });

  it('영역이 칸보다 좁으면 앞에 맞춘다(시작이 늘 보이게)', () => {
    expect(clampSpan(50, 120, 100)).toBe(0);
    expect(clampSpan(50, 120, 100, 8)).toBe(8);
  });
});

describe('반응형 — 메모 글 칸 자리(noteEditorPlacement)', () => {
  /** 넓은 미리보기 — 1280×720 상자에 판이 꽉 찬다. */
  const wide: PreviewBounds = { width: 1280, height: 720, frameLeft: 0, frameTop: 0 };

  it('넓은 미리보기에서는 종전 자리 그대로다(핀 오른쪽·아래 12px, 폭 256)', () => {
    expect(noteEditorPlacement(200, 100, false, wide)).toEqual({ left: NOTE_EDITOR.gap, top: NOTE_EDITOR.gap, width: 256, maxHeight: 704 });
  });

  it('오른쪽 핀(flip)은 종전처럼 핀 왼쪽에 선다(right-3 과 같은 자리)', () => {
    const at = noteEditorPlacement(1000, 100, true, wide);
    expect(at.left).toBe(-NOTE_EDITOR.gap - 256);
    expect(at.top).toBe(NOTE_EDITOR.gap);
  });

  it('좁은 미리보기에서는 폭이 상자 − 여백으로 줄고 상자 밖으로 나가지 않는다', () => {
    // 폰 — 340×191 상자, 판이 꽉 찬다. 핀은 가운데 조금 오른쪽.
    const phone: PreviewBounds = { width: 340, height: 191, frameLeft: 0, frameTop: 0 };
    const at = noteEditorPlacement(180, 40, false, phone);
    expect(at.width).toBe(256);
    const boxLeft = 180 + at.left;
    expect(boxLeft).toBeGreaterThanOrEqual(NOTE_EDITOR.margin);
    expect(boxLeft + at.width).toBeLessThanOrEqual(phone.width - NOTE_EDITOR.margin);
    const tiny: PreviewBounds = { width: 200, height: 191, frameLeft: 0, frameTop: 0 };
    expect(noteEditorPlacement(100, 40, false, tiny).width).toBe(200 - NOTE_EDITOR.margin * 2);
  });

  it('아래가 모자라면 핀 위로 올린다', () => {
    const box: PreviewBounds = { width: 800, height: 450, frameLeft: 0, frameTop: 0 };
    const at = noteEditorPlacement(100, 400, false, box);
    expect(at.top).toBe(-NOTE_EDITOR.gap - NOTE_EDITOR.height);
  });

  it('위아래 다 모자라면 상자 안에 맞추고 높이 상한을 준다', () => {
    const box: PreviewBounds = { width: 340, height: 120, frameLeft: 0, frameTop: 0 };
    const at = noteEditorPlacement(100, 60, false, box);
    const boxTop = 60 + at.top;
    expect(boxTop).toBe(NOTE_EDITOR.margin);
    expect(at.maxHeight).toBe(120 - NOTE_EDITOR.margin * 2);
  });

  it('판이 상자 안에 비켜 서 있으면(여백 띠) 그 자리를 더해 상자 기준으로 맞춘다', () => {
    // 세로 영상 — 판이 상자 가운데 120px 비켜 섰다. 판 오른쪽 끝의 핀이라도 상자 안에 머문다.
    const box: PreviewBounds = { width: 360, height: 640, frameLeft: 120, frameTop: 0 };
    const at = noteEditorPlacement(110, 100, false, box);
    const boxLeft = 120 + 110 + at.left;
    expect(boxLeft + at.width).toBeLessThanOrEqual(360 - NOTE_EDITOR.margin);
  });
});

describe('반응형 — 좁은 장면 구슬(narrowChapterIds)', () => {
  const chapters = [
    { id: 'a', start: 0, end: 1 },
    { id: 'b', start: 1, end: 9 },
    { id: 'c', start: 9, end: 10 },
  ];

  it('줄 폭을 못 쟀으면 하나도 좁지 않다(넓은 배치 그대로)', () => {
    expect(narrowChapterIds(chapters, 10, 0)).toEqual([]);
    expect(narrowChapterIds(chapters, 0, 800)).toEqual([]);
  });

  it('넓은 줄에서는 짧은 장면도 제목이 선다', () => {
    // 1000px × 1/10 − 4 = 96px.
    expect(narrowChapterIds(chapters, 10, 1000)).toEqual([]);
  });

  it('좁은 줄에서는 몫이 작은 구슬만 번호로 접힌다', () => {
    // 320px × 1/10 − 4 = 28px < 48 · 320 × 8/10 − 4 = 252px.
    expect(narrowChapterIds(chapters, 10, 320)).toEqual(['a', 'c']);
  });
});
