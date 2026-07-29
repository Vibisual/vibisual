import { describe, it, expect } from 'vitest';
import { CAPTURE_BUBBLE_DEFAULTS } from '@vibisual/shared';
import { computeCaptureDragSnap, computeCaptureResizeSnap, type SnapRect } from './captureSnap.js';

// §5.9 캡처 버블 이어 붙이기(자석 스냅) 단위 테스트.
// 좌표 계산이 컴포넌트 안에 있으면 회귀를 못 잡으므로 순수 유틸로 떼어 굳힌다.

const T = 12; // 임계값(캔버스 단위)

function rect(id: string, x: number, y: number, width = 320, height = 180): SnapRect {
  return { id, x, y, width, height };
}

describe('computeCaptureDragSnap', () => {
  it('이웃이 없으면 좌표를 그대로 돌려주고 가이드선도 없다', () => {
    const r = rect('a', 137, 291);
    const out = computeCaptureDragSnap(r, [], T);
    expect(out.x).toBe(137);
    expect(out.y).toBe(291);
    expect(out.guides).toEqual([]);
  });

  it('옆 버블 오른변에 왼변을 0px 로 맞대 붙인다(듀얼 모니터 배치)', () => {
    const other = rect('left', 0, 0);
    const out = computeCaptureDragSnap(rect('a', 313, 4), [other], T);
    expect(out.x).toBe(320); // other.x + other.width — 이음선 간격 0
    expect(out.y).toBe(0); // 위변 정렬도 함께 걸린다
    expect(out.guides.some((g) => g.axis === 'x' && g.position === 320 && g.butt)).toBe(true);
  });

  it('세로로 거의 겹치지 않는 버블에는 맞대기가 걸리지 않는다(스치는 착시 방지)', () => {
    const other = rect('far', 0, 900);
    const out = computeCaptureDragSnap(rect('a', 313, 4), [other], T);
    expect(out.x).toBe(313); // 맞대기 후보 제외 + 정렬 후보는 임계값 밖
    expect(out.guides).toEqual([]);
  });

  it('같은 거리에서는 정렬보다 맞대기를 고른다', () => {
    const butt = rect('butt', 0, 0); // 오른변 320 → 맞대기 후보(거리 10)
    const align = rect('align', 300, 900); // 왼변 300 → 정렬 후보(거리 10, 겹침 없음)
    const out = computeCaptureDragSnap(rect('a', 310, 0), [butt, align], T);
    expect(out.x).toBe(320);
  });

  it('아래에 붙일 때는 위변 맞대기 + 왼변 정렬이 함께 걸려 가이드선 2개가 나온다', () => {
    const above = rect('above', 0, 0);
    const right = rect('right', 320, 0);
    const out = computeCaptureDragSnap(rect('a', 3, 175), [above, right], T);
    expect(out.y).toBe(180); // above 의 아래변에 맞대기
    expect(out.x).toBe(0); // above 의 왼변에 정렬
    expect(out.guides).toHaveLength(2);
    expect(out.guides.filter((g) => g.butt)).toHaveLength(1);
  });

  it('대각선 코너만 스치는 위치에는 붙지 않는다(겹침 없는 이웃은 이웃이 아니다)', () => {
    const other = rect('base', 0, 0);
    const out = computeCaptureDragSnap(rect('a', 315, 175), [other], T);
    expect(out.x).toBe(315);
    expect(out.y).toBe(175);
    expect(out.guides).toEqual([]);
  });

  it('임계값 밖이면 아무것도 건드리지 않는다', () => {
    const other = rect('left', 0, 0);
    const out = computeCaptureDragSnap(rect('a', 400, 300), [other], T);
    expect(out.x).toBe(400);
    expect(out.y).toBe(300);
    expect(out.guides).toEqual([]);
  });

  it('가이드선 구간은 두 버블을 아우른다(어디에 붙었는지 눈으로 잇게)', () => {
    const other = rect('left', 0, 0, 320, 180);
    const out = computeCaptureDragSnap(rect('a', 313, 100, 320, 400), [other], T);
    const vertical = out.guides.find((g) => g.axis === 'x');
    expect(vertical).toBeDefined();
    expect(vertical?.from).toBe(0); // other 의 위변
    expect(vertical?.to).toBe(500); // dragged 의 아래변(100 + 400)
  });

  it('자기 자신은 스냅 대상에서 제외한다', () => {
    const self = rect('a', 0, 0);
    const out = computeCaptureDragSnap(rect('a', 5, 5), [self], T);
    expect(out.x).toBe(5);
    expect(out.y).toBe(5);
  });

  it('세 개를 나란히 이어 붙일 수 있다(트리플 모니터 — 가운데 버블 오른변에 붙기)', () => {
    const first = rect('m1', 0, 0);
    const second = rect('m2', 320, 0);
    const out = computeCaptureDragSnap(rect('m3', 634, 3), [first, second], T);
    expect(out.x).toBe(640); // second 의 오른변
    expect(out.y).toBe(0);
  });
});

describe('computeCaptureResizeSnap', () => {
  it('오른변을 옆 버블 왼변에 붙여 틈을 없앤다', () => {
    const other = rect('right', 400, 0);
    const out = computeCaptureResizeSnap(rect('a', 0, 0, 394, 180), [other], T);
    expect(out.x).toBe(0);
    expect(out.width).toBe(400); // 오른변 394 → 400(other.x)
    expect(out.guides.some((g) => g.axis === 'x' && g.butt)).toBe(true);
  });

  it('왼변을 붙일 때는 오른변을 고정한 채 폭을 보정한다', () => {
    const other = rect('left', 0, 0, 200, 180);
    const out = computeCaptureResizeSnap(rect('a', 206, 0, 300, 180), [other], T);
    expect(out.x).toBe(200); // other 의 오른변
    expect(out.width).toBe(306); // 오른변(506) 유지
  });

  it('아래변도 같은 방식으로 붙는다', () => {
    const other = rect('below', 0, 400);
    const out = computeCaptureResizeSnap(rect('a', 0, 0, 320, 396), [other], T);
    expect(out.height).toBe(400);
  });

  it('최소 크기를 깨는 스냅은 버린다', () => {
    const other = rect('right', 155, 0);
    const out = computeCaptureResizeSnap(rect('a', 0, 0, 165, 180), [other], T);
    expect(out.width).toBe(165); // 155 로 붙이면 MIN_WIDTH 미만 → 무시
    expect(CAPTURE_BUBBLE_DEFAULTS.MIN_WIDTH).toBeGreaterThan(155);
  });

  it('이웃이 없으면 사각형을 그대로 돌려준다', () => {
    const out = computeCaptureResizeSnap(rect('a', 10, 20, 300, 200), [], T);
    expect(out).toEqual({ x: 10, y: 20, width: 300, height: 200, guides: [] });
  });
});
