import { describe, it, expect } from 'vitest';
import {
  MAIN_SESSION_DRAG_VALUE,
  SESSION_DRAG_MIME,
  SPLIT_DROP,
  decodeSessionDrag,
  dragHasSession,
  dragIsSession,
  dragOwnerMatches,
  dropAxis,
  dropPreviewBox,
  edgeBandPx,
  encodeSessionDrag,
  fitsSplit,
  sessionIdMime,
  sessionOwnerMime,
  splitDropLabelKey,
  resolveDropSide,
  splitterDeltaRatio,
  type SplitRect,
} from './splitDrop.js';

/**
 * §5.5 #17-34 — 드롭 판정 기하 회귀.
 *
 * 고정하는 약속: 판정(`resolveDropSide`)과 미리보기(`dropPreviewBox`)가 **같은 표**를 읽어,
 * 파란 박스가 가리킨 자리에 정확히 앉는다. 좁은 칸에서도 네 변과 가운데가 모두 집힌다.
 */

const rect: SplitRect = { left: 100, top: 50, width: 400, height: 300 };
const cx = rect.left + rect.width / 2;
const cy = rect.top + rect.height / 2;

describe('resolveDropSide', () => {
  it('가운데는 교체', () => {
    expect(resolveDropSide(rect, cx, cy)).toBe('center');
  });

  it('네 변을 각각 집는다', () => {
    expect(resolveDropSide(rect, rect.left + 4, cy)).toBe('left');
    expect(resolveDropSide(rect, rect.left + rect.width - 4, cy)).toBe('right');
    expect(resolveDropSide(rect, cx, rect.top + 4)).toBe('top');
    expect(resolveDropSide(rect, cx, rect.top + rect.height - 4)).toBe('bottom');
  });

  it('칸 밖 좌표도 가장 가까운 변으로 떨어진다(판정 실패 ❌)', () => {
    expect(resolveDropSide(rect, rect.left - 80, cy)).toBe('left');
    expect(resolveDropSide(rect, cx, rect.top + rect.height + 80)).toBe('bottom');
  });

  it('모서리는 띠 두께로 잰 상대 거리로 가른다', () => {
    // 좌상단 모서리 — 같은 5px 라도 띠가 두꺼운 쪽(가로 112px > 세로 84px)이 상대적으로 더 "가깝다".
    expect(resolveDropSide(rect, rect.left + 5, rect.top + 5)).toBe('left');
    // 세로가 더 긴 칸이면 같은 자리에서 판정이 뒤집힌다(축 길이에 따라 자연히 갈린다).
    expect(resolveDropSide({ left: 0, top: 0, width: 300, height: 400 }, 5, 5)).toBe('top');
  });

  it('아주 좁은 칸에서도 가운데가 남는다', () => {
    const thin: SplitRect = { left: 0, top: 0, width: 120, height: 90 };
    expect(resolveDropSide(thin, 60, 45)).toBe('center');
    expect(resolveDropSide(thin, 2, 45)).toBe('left');
    expect(resolveDropSide(thin, 60, 2)).toBe('top');
  });

  it('넓은 칸의 띠는 비율이, 좁은 칸은 하한이, 극단적으로 좁은 칸은 상한이 정한다', () => {
    expect(edgeBandPx(1000)).toBeCloseTo(1000 * SPLIT_DROP.edgeBandRatio, 6);
    expect(edgeBandPx(80)).toBeCloseTo(SPLIT_DROP.minEdgeBandPx, 6);
    // 60px 짜리 칸에서 하한(28px)을 그대로 쓰면 양쪽 띠가 만나 가운데가 사라진다 → 상한이 잡는다.
    expect(edgeBandPx(60)).toBeCloseTo(60 * SPLIT_DROP.maxEdgeBandRatio, 6);
    expect(edgeBandPx(0)).toBe(0);
  });

  it('크기 0 인 칸은 판정 자체를 포기하고 교체로 본다', () => {
    expect(resolveDropSide({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe('center');
  });
});

describe('dropPreviewBox / dropAxis', () => {
  it('네 변은 절반을, 가운데는 칸 전체를 그린다', () => {
    expect(dropPreviewBox('left')).toEqual({ leftPct: 0, topPct: 0, widthPct: 50, heightPct: 100 });
    expect(dropPreviewBox('right')).toEqual({ leftPct: 50, topPct: 0, widthPct: 50, heightPct: 100 });
    expect(dropPreviewBox('top')).toEqual({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: 50 });
    expect(dropPreviewBox('bottom')).toEqual({ leftPct: 0, topPct: 50, widthPct: 100, heightPct: 50 });
    expect(dropPreviewBox('center')).toEqual({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 });
  });

  it('좌우는 row, 상하는 col, 가운데는 나누지 않는다', () => {
    expect(dropAxis('left')).toBe('row');
    expect(dropAxis('right')).toBe('row');
    expect(dropAxis('top')).toBe('col');
    expect(dropAxis('bottom')).toBe('col');
    expect(dropAxis('center')).toBeNull();
  });
});

describe('드래그 짐표', () => {
  it('세션 id 는 그대로, 메인 탭은 전용 값으로 실린다', () => {
    expect(encodeSessionDrag('sub-1')).toBe('sub-1');
    expect(encodeSessionDrag(null)).toBe(MAIN_SESSION_DRAG_VALUE);
    expect(decodeSessionDrag('sub-1')).toEqual({ sessionId: 'sub-1' });
    expect(decodeSessionDrag(MAIN_SESSION_DRAG_VALUE)).toEqual({ sessionId: null });
  });

  it('빈 짐표는 우리 짐이 아니다(메인 탭과 혼동 ❌)', () => {
    expect(decodeSessionDrag('')).toBeNull();
    expect(decodeSessionDrag(null)).toBeNull();
    expect(decodeSessionDrag(undefined)).toBeNull();
  });

  it('종류만 보고 세션 드래그를 알아본다(OS 파일·탭 순서와 구분)', () => {
    expect(dragHasSession([SESSION_DRAG_MIME, 'text/plain'])).toBe(true);
    expect(dragHasSession(['Files'])).toBe(false);
    expect(dragHasSession(['text/plain'])).toBe(false);
    expect(dragHasSession([])).toBe(false);
  });
});

describe('QA — 떨굴 수 없는 자리', () => {
  it('소유자 표식이 다르면 남의 세션이다(드래그 중에 이미 안다)', () => {
    const mine = sessionOwnerMime('agent-1');
    expect(dragOwnerMatches([SESSION_DRAG_MIME, mine], 'agent-1')).toBe(true);
    expect(dragOwnerMatches([SESSION_DRAG_MIME, mine], 'agent-2')).toBe(false);
    // MIME 은 소문자로 정규화되므로 대소문자가 섞여도 같은 것으로 본다.
    expect(dragOwnerMatches([sessionOwnerMime('Agent-1')], 'agent-1')).toBe(true);
  });

  it('소유자 표식이 아예 없으면 막지 않는다(옛 짐표 호환)', () => {
    expect(dragOwnerMatches([SESSION_DRAG_MIME, 'text/plain'], 'agent-1')).toBe(true);
  });

  it('양쪽이 글자를 담을 수 없는 크기면 나누지 않는다', () => {
    const narrow: SplitRect = { left: 0, top: 0, width: 320, height: 900 };
    expect(fitsSplit(narrow, 'right')).toBe(false); // 320px 을 좌우로 = 각 158px
    expect(fitsSplit(narrow, 'bottom')).toBe(true); // 세로는 넉넉하다
    expect(fitsSplit(narrow, 'center')).toBe(true); // 교체는 크기와 무관
    const wide: SplitRect = { left: 0, top: 0, width: 1200, height: 300 };
    expect(fitsSplit(wide, 'left')).toBe(true);
    expect(fitsSplit(wide, 'top')).toBe(false); // 300px 을 위아래로 = 각 148px
  });

  it('이 자리가 이미 보여 주는 세션이면 드래그 중에 알아본다(헛손질 예고)', () => {
    const types = [SESSION_DRAG_MIME, sessionIdMime('sub-1')];
    expect(dragIsSession(types, 'sub-1')).toBe(true);
    expect(dragIsSession(types, 'sub-2')).toBe(false);
    // 메인 탭(null)도 자기 표식을 갖는다 — 빈 값과 헷갈리지 않게.
    expect(dragIsSession([sessionIdMime(null)], null)).toBe(true);
    expect(dragIsSession([sessionIdMime('sub-1')], null)).toBe(false);
    // 표식이 없으면(옛 짐표) 막지 않는다.
    expect(dragIsSession([SESSION_DRAG_MIME], 'sub-1')).toBe(false);
  });

  it('미리보기 문구는 이유마다 하나씩 — 판정과 같은 표에서 고른다', () => {
    expect(splitDropLabelKey('right', null)).toBe('ide.split.previewSplit');
    expect(splitDropLabelKey('center', null)).toBe('ide.split.previewReplace');
    expect(splitDropLabelKey('right', 'limit')).toBe('ide.split.limit');
    expect(splitDropLabelKey('right', 'foreign')).toBe('ide.split.foreignSession');
    expect(splitDropLabelKey('bottom', 'tooSmall')).toBe('ide.split.tooSmall');
    expect(splitDropLabelKey('center', 'same')).toBe('ide.split.alreadyHere');
  });
});

describe('splitterDeltaRatio', () => {
  it('끈 거리를 컨테이너 길이 대비 비율로 바꾼다', () => {
    expect(splitterDeltaRatio(400, 100)).toBeCloseTo(0.25, 6);
    expect(splitterDeltaRatio(400, -40)).toBeCloseTo(-0.1, 6);
  });

  it('컨테이너가 0 이면 움직이지 않는다(0 나눗셈 ❌)', () => {
    expect(splitterDeltaRatio(0, 100)).toBe(0);
  });
});
