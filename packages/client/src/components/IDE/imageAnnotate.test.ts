import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_HISTORY_LIMIT,
  ANNOTATION_TOOLS,
  EMPTY_ANNOTATION_HISTORY,
  arrowHead,
  baseBadgeRadius,
  baseFontSize,
  baseStrokeWidth,
  canRedo,
  canUndo,
  clearAnnotations,
  commitAnnotation,
  createAnnotation,
  distance,
  extendAnnotation,
  isCommittable,
  isDragTool,
  nextBadgeIndex,
  normalizeBox,
  penPathD,
  redoAnnotations,
  toImagePoint,
  undoAnnotations,
  withAlpha,
  type Annotation,
  type AnnotationHistory,
  type AnnotationStyle,
} from './imageAnnotate.js';

// §5.5 #17-25 v4.80 — 주석 좌표·모델은 DOM 없이 검증한다(이미지 상자를 인자로 받는 순수 함수).

const natural = { w: 1600, h: 900 };
const style: AnnotationStyle = { color: '#ef4444', strokeWidth: 4, fontSize: 32, badgeRadius: 20 };

function shape(id: string, from: { x: number; y: number }, to: { x: number; y: number }): Annotation {
  const ann = createAnnotation({ id, tool: 'rect', at: from, style });
  return extendAnnotation(ann, to);
}

describe('toImagePoint', () => {
  const rect = { x: 100, y: 50, w: 800, h: 450 }; // 화면에 절반 크기로 그려진 상태

  it('화면 좌표를 원본 픽셀로 되돌린다', () => {
    expect(toImagePoint({ x: 500, y: 275 }, rect, natural)).toEqual({ x: 800, y: 450 });
  });

  it('상자 좌상단은 원점', () => {
    expect(toImagePoint({ x: 100, y: 50 }, rect, natural)).toEqual({ x: 0, y: 0 });
  });

  it('이미지 밖으로 끌어도 안쪽으로 클램프된다', () => {
    expect(toImagePoint({ x: -400, y: 9999 }, rect, natural)).toEqual({ x: 0, y: 900 });
  });

  it('상자 크기가 0이면 원점을 준다(0 나눗셈 ❌)', () => {
    expect(toImagePoint({ x: 10, y: 10 }, { x: 0, y: 0, w: 0, h: 0 }, natural)).toEqual({ x: 0, y: 0 });
  });
});

describe('normalizeBox', () => {
  it('어느 방향으로 끌어도 같은 상자가 나온다', () => {
    const a = normalizeBox({ x: 10, y: 20 }, { x: 110, y: 220 });
    const b = normalizeBox({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(a).toEqual({ x: 10, y: 20, w: 100, h: 200 });
    expect(b).toEqual(a);
  });
});

describe('기본 치수', () => {
  it('짧은 변에 비례한다 — 4K 스크린샷에서 선이 사라지지 않게', () => {
    expect(baseStrokeWidth({ w: 3840, h: 2160 })).toBeGreaterThan(baseStrokeWidth({ w: 800, h: 600 }));
  });

  it('아주 작은 이미지에서도 하한을 지킨다', () => {
    expect(baseStrokeWidth({ w: 40, h: 40 })).toBe(2);
    expect(baseFontSize({ w: 40, h: 40 })).toBe(14);
    expect(baseBadgeRadius({ w: 40, h: 40 })).toBe(12);
  });

  it('크기가 0이어도 폴백 값을 준다', () => {
    expect(baseStrokeWidth({ w: 0, h: 0 })).toBe(3);
    expect(baseFontSize({ w: 0, h: 0 })).toBe(16);
    expect(baseBadgeRadius({ w: 0, h: 0 })).toBe(14);
  });
});

describe('arrowHead', () => {
  it('첫 점은 화살표 끝점 그대로', () => {
    const [tip] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(tip).toEqual({ x: 100, y: 0 });
  });

  it('미늘 두 점은 끝점 뒤쪽에 대칭으로 놓인다', () => {
    const [, left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeLessThan(100);
    expect(left.y).toBeCloseTo(-right.y, 6);
  });

  it('화살표가 짧으면 화살촉도 그 길이를 넘지 않는다', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 5, y: 0 };
    const [, left] = arrowHead(from, to, 40);
    expect(distance(to, left)).toBeLessThanOrEqual(5.001);
  });
});

describe('penPathD', () => {
  it('점이 없으면 빈 문자열', () => {
    expect(penPathD([])).toBe('');
  });

  it('점 하나는 길이 0 선분(round cap 으로 점이 찍힌다)', () => {
    expect(penPathD([{ x: 3, y: 4 }])).toBe('M 3 4 L 3 4');
  });

  it('여러 점은 중간점 2차 베지어로 이어진다', () => {
    const d = penPathD([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 0 15 5');
    expect(d.endsWith('L 20 10')).toBe(true);
  });
});

describe('withAlpha', () => {
  it('hex 를 rgba 로 바꾼다', () => {
    expect(withAlpha('#ef4444', 0.28)).toBe('rgba(239, 68, 68, 0.28)');
  });

  it('hex 가 아니면 원문 그대로(깨진 색으로 그리지 않는다)', () => {
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});

describe('createAnnotation / extendAnnotation', () => {
  it('드래그 도구는 시작점=끝점으로 태어난다', () => {
    const ann = createAnnotation({ id: 'a', tool: 'rect', at: { x: 5, y: 6 }, style });
    expect(ann).toMatchObject({ tool: 'rect', from: { x: 5, y: 6 }, to: { x: 5, y: 6 }, strokeWidth: 4 });
  });

  it('펜은 점을 잇되 너무 촘촘한 점은 버린다', () => {
    let ann = createAnnotation({ id: 'p', tool: 'pen', at: { x: 0, y: 0 }, style });
    ann = extendAnnotation(ann, { x: 0.5, y: 0 });
    expect(ann.tool === 'pen' && ann.points.length).toBe(1);
    ann = extendAnnotation(ann, { x: 10, y: 0 });
    expect(ann.tool === 'pen' && ann.points.length).toBe(2);
  });

  it('글자·배지는 드래그로 변하지 않는다', () => {
    const badge = createAnnotation({ id: 'n', tool: 'number', at: { x: 1, y: 1 }, style, badgeIndex: 3 });
    expect(extendAnnotation(badge, { x: 99, y: 99 })).toBe(badge);
    expect(badge).toMatchObject({ index: 3, radius: 20 });
  });

  it('드래그 도구 판정 — 글자·배지는 클릭 배치', () => {
    expect(ANNOTATION_TOOLS.filter((t) => !isDragTool(t))).toEqual(['text', 'number']);
  });
});

describe('isCommittable', () => {
  it('3px 미만 도형은 버린다(잘못 누른 클릭이 스택을 채우지 않게)', () => {
    expect(isCommittable(shape('a', { x: 0, y: 0 }, { x: 2, y: 2 }))).toBe(false);
    expect(isCommittable(shape('b', { x: 0, y: 0 }, { x: 40, y: 30 }))).toBe(true);
  });

  it('빈 글자는 버리고, 내용이 있으면 통과', () => {
    expect(isCommittable(createAnnotation({ id: 't', tool: 'text', at: { x: 0, y: 0 }, style, text: '   ' }))).toBe(false);
    expect(isCommittable(createAnnotation({ id: 't', tool: 'text', at: { x: 0, y: 0 }, style, text: '여기' }))).toBe(true);
  });

  it('배지는 클릭 한 번이 곧 완성', () => {
    expect(isCommittable(createAnnotation({ id: 'n', tool: 'number', at: { x: 0, y: 0 }, style }))).toBe(true);
  });

  it('점 하나짜리 펜은 버린다', () => {
    const pen = createAnnotation({ id: 'p', tool: 'pen', at: { x: 0, y: 0 }, style });
    expect(isCommittable(pen)).toBe(false);
    expect(isCommittable(extendAnnotation(pen, { x: 20, y: 20 }))).toBe(true);
  });
});

describe('nextBadgeIndex', () => {
  it('배지가 없으면 1', () => {
    expect(nextBadgeIndex([])).toBe(1);
  });

  it('지우고 다시 그려도 번호가 겹치지 않게 최댓값 +1', () => {
    const items: Annotation[] = [
      createAnnotation({ id: 'n1', tool: 'number', at: { x: 0, y: 0 }, style, badgeIndex: 1 }),
      createAnnotation({ id: 'n2', tool: 'number', at: { x: 0, y: 0 }, style, badgeIndex: 7 }),
      shape('r', { x: 0, y: 0 }, { x: 50, y: 50 }),
    ];
    expect(nextBadgeIndex(items)).toBe(8);
  });
});

describe('되돌리기 스택', () => {
  const a = shape('a', { x: 0, y: 0 }, { x: 40, y: 40 });
  const b = shape('b', { x: 50, y: 50 }, { x: 90, y: 90 });

  it('커밋 → 되돌리기 → 다시 하기 왕복', () => {
    let h: AnnotationHistory = commitAnnotation(commitAnnotation(EMPTY_ANNOTATION_HISTORY, a), b);
    expect(h.items).toHaveLength(2);
    expect(canUndo(h)).toBe(true);
    h = undoAnnotations(h);
    expect(h.items).toEqual([a]);
    expect(canRedo(h)).toBe(true);
    h = redoAnnotations(h);
    expect(h.items).toEqual([a, b]);
    expect(canRedo(h)).toBe(false);
  });

  it('새로 그리면 다시 하기 가지가 잘린다', () => {
    let h = commitAnnotation(EMPTY_ANNOTATION_HISTORY, a);
    h = undoAnnotations(h);
    h = commitAnnotation(h, b);
    expect(h.future).toHaveLength(0);
    expect(h.items).toEqual([b]);
  });

  it('전체 지우기도 되돌릴 수 있다', () => {
    let h = commitAnnotation(EMPTY_ANNOTATION_HISTORY, a);
    h = clearAnnotations(h);
    expect(h.items).toEqual([]);
    expect(undoAnnotations(h).items).toEqual([a]);
  });

  it('빈 상태에서 지우기·되돌리기·다시 하기는 no-op', () => {
    expect(clearAnnotations(EMPTY_ANNOTATION_HISTORY)).toBe(EMPTY_ANNOTATION_HISTORY);
    expect(undoAnnotations(EMPTY_ANNOTATION_HISTORY)).toBe(EMPTY_ANNOTATION_HISTORY);
    expect(redoAnnotations(EMPTY_ANNOTATION_HISTORY)).toBe(EMPTY_ANNOTATION_HISTORY);
    expect(canUndo(EMPTY_ANNOTATION_HISTORY)).toBe(false);
  });

  it('과거 스택은 상한을 넘지 않는다', () => {
    let h: AnnotationHistory = EMPTY_ANNOTATION_HISTORY;
    for (let i = 0; i < ANNOTATION_HISTORY_LIMIT + 20; i++) {
      h = commitAnnotation(h, shape(`s${i}`, { x: 0, y: 0 }, { x: 40, y: 40 }));
    }
    expect(h.past.length).toBe(ANNOTATION_HISTORY_LIMIT);
    expect(h.items).toHaveLength(ANNOTATION_HISTORY_LIMIT + 20);
  });
});
