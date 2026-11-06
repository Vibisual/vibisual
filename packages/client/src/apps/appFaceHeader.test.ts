import { afterEach, describe, expect, it } from 'vitest';
import { APP_BUBBLE_PENDING_MS, APP_CANVAS_FACE } from '@vibisual/shared';

import { __resetFaceHeadersForTest, faceHeaderView, markFaceSeen, nextFaceHeader, peekFaceHeader, reportFaceHeader } from './appFaceHeader.js';
import { stageAspectToSend } from './appStageAspect.js';

/** §5.4 #36 (J) ⑥ — 앱 화면이 알린 머리줄: 처음 알린 열쇠는 본 것, 열쇠가 바뀌면 안 본 변경, 올리거나 고르면 본 것. */
describe('§5.4 #36 (J) ⑥ 머리줄 · 안 본 변경', () => {
  afterEach(() => __resetFaceHeadersForTest());

  it('처음 알린 열쇠는 본 것이다(켤 때의 판본)', () => {
    const first = nextFaceHeader(undefined, { title: ' Launch ', changeKey: '3' });
    expect(first).toEqual({ title: 'Launch', changeKey: '3', seenKey: '3' });
    expect(faceHeaderView(first)).toEqual({ title: 'Launch', unseen: false });
  });

  it('열쇠가 바뀌면 안 본 변경 — 본 것으로 치면 걷힌다', () => {
    reportFaceHeader('n1', { title: 'Doc', changeKey: '3' });
    expect(peekFaceHeader('n1')).toEqual({ title: 'Doc', unseen: false });
    reportFaceHeader('n1', { title: 'Doc', changeKey: '5' });
    expect(peekFaceHeader('n1').unseen).toBe(true);
    markFaceSeen('n1');
    expect(peekFaceHeader('n1').unseen).toBe(false);
    // 같은 열쇠를 다시 알려도 본 것은 그대로다 · 노드마다 따로다.
    reportFaceHeader('n1', { title: 'Doc', changeKey: '5' });
    expect(peekFaceHeader('n1').unseen).toBe(false);
    expect(peekFaceHeader('n2')).toEqual({ title: null, unseen: false });
  });

  it('제목이 비면 걷고(코어가 종전 이름으로), null 은 제목만 걷고 본 것은 남긴다', () => {
    const base = nextFaceHeader(undefined, { title: 'Doc', changeKey: '2' });
    expect(nextFaceHeader(base, { title: '   ' }).title).toBeNull();
    expect(nextFaceHeader(base, null)).toEqual({ title: null, changeKey: '2', seenKey: '2' });
    expect(faceHeaderView(undefined)).toEqual({ title: null, unseen: false });
  });
});

/** §5.4 #36 (J) ① — 앱 화면이 알린 비율은 저장값과 다를 때만, 같은 값은 한 창(`APP_BUBBLE_PENDING_MS`) 안에 다시 보내지 않는다. */
describe('§5.4 #36 (J) ① 결과 칸 비율 보내기', () => {
  it('저장값과 같으면 보내지 않고, 다르면 자른 값을 보낸다', () => {
    expect(stageAspectToSend(16 / 9, 16 / 9, undefined, 0)).toBeUndefined();
    expect(stageAspectToSend(undefined, 9 / 16, undefined, 0)).toBeCloseTo(9 / 16);
    expect(stageAspectToSend(undefined, 100, undefined, 0)).toBe(APP_CANVAS_FACE.stageAspectMax);
  });

  it('PATCH 전에 떠난 스냅샷이 칸을 되돌려도 같은 값은 한 창 안에 다시 보내지 않는다', () => {
    const last = { aspect: 9 / 16, at: 1000 };
    expect(stageAspectToSend(undefined, 9 / 16, last, 1000 + APP_BUBBLE_PENDING_MS - 1)).toBeUndefined();
    expect(stageAspectToSend(undefined, 9 / 16, last, 1000 + APP_BUBBLE_PENDING_MS + 1)).toBeCloseTo(9 / 16);
  });

  it('지우기(null)는 저장값이 있을 때만 · 못 쓰는 값은 무시', () => {
    expect(stageAspectToSend(1, null, undefined, 0)).toBeNull();
    expect(stageAspectToSend(undefined, null, undefined, 0)).toBeUndefined();
    expect(stageAspectToSend(1, Number.NaN, undefined, 0)).toBeUndefined();
  });
});
