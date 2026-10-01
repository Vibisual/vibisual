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
  commitFrame,
  createAnnotation,
  distance,
  extendAnnotation,
  hasEdits,
  isCommittable,
  isDragTool,
  nextBadgeIndex,
  normalizeBox,
  penPathD,
  redoAnnotations,
  referencedLayerSrcs,
  toImagePoint,
  translateAnnotations,
  undoAnnotations,
  withAlpha,
  type Annotation,
  type AnnotationHistory,
  type AnnotationStyle,
  type RasterLayer,
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

  // §5.5 #17-25 ① — 원형 자르기는 표시를 그림에 구우며 목록을 비운다. 목록만 세면 다음 배지가 다시 1 이 되어
  //   그림에 "1" 이 둘 선다("2번 영역"이라는 공유된 이름이 깨진다).
  it('원형 자르기로 구운 배지 뒤를 잇는다 — 목록이 비어도 1 로 돌아가지 않는다', () => {
    expect(nextBadgeIndex([], 3)).toBe(4);
  });

  it('구운 번호보다 목록의 번호가 크면 목록을 따른다', () => {
    const items = [createAnnotation({ id: 'n5', tool: 'number', at: { x: 0, y: 0 }, style, badgeIndex: 5 })];
    expect(nextBadgeIndex(items, 3)).toBe(6);
  });

  it('하한이 0·음수면 없는 것과 같다', () => {
    expect(nextBadgeIndex([], 0)).toBe(1);
    expect(nextBadgeIndex([], -4)).toBe(1);
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

// §5.5 #17-25 ⑦ — 자르기·알파 한 번이 "세 겹 한 벌" 단위로 같은 스택에 쌓인다.
describe('세 겹 되돌리기 (⑦)', () => {
  const a = shape('a', { x: 10, y: 10 }, { x: 90, y: 60 });
  const layer = (src: string, transparent = false): RasterLayer => ({ src, w: 400, h: 300, transparent });

  it('commitFrame 은 바탕까지 한 칸으로 쌓고 다시 하기를 비운다', () => {
    let h = commitAnnotation(EMPTY_ANNOTATION_HISTORY, a);
    h = undoAnnotations(h);
    expect(canRedo(h)).toBe(true);
    h = commitFrame(h, { items: [], base: layer('blob:crop'), marks: null });
    expect(h.base?.src).toBe('blob:crop');
    expect(h.future).toHaveLength(0);
    expect(h.past).toHaveLength(1);
  });

  it('되돌리면 바탕·구운 표시·주석이 한꺼번에 돌아온다', () => {
    let h = commitAnnotation(EMPTY_ANNOTATION_HISTORY, a);
    h = commitFrame(h, { items: [], base: layer('blob:round', true), marks: layer('blob:marks', true) });
    const undone = undoAnnotations(h);
    expect(undone.base).toBeNull();
    expect(undone.marks).toBeNull();
    expect(undone.items).toEqual([a]);
    const redone = redoAnnotations(undone);
    expect(redone.base?.src).toBe('blob:round');
    expect(redone.marks?.src).toBe('blob:marks');
    expect(redone.items).toEqual([]);
  });

  it('전체 지우기는 구운 표시까지 지우되 자르기·알파(바탕)는 남긴다', () => {
    const h = commitFrame(EMPTY_ANNOTATION_HISTORY, {
      items: [a],
      base: layer('blob:base'),
      marks: layer('blob:marks'),
    });
    const cleared = clearAnnotations(h);
    expect(cleared.items).toEqual([]);
    expect(cleared.marks).toBeNull();
    expect(cleared.base?.src).toBe('blob:base');
    expect(undoAnnotations(cleared).marks?.src).toBe('blob:marks');
  });

  it('구운 표시만 남아도 전체 지우기가 할 일이 있다', () => {
    const h = commitFrame(EMPTY_ANNOTATION_HISTORY, { items: [], base: null, marks: layer('blob:marks') });
    expect(clearAnnotations(h)).not.toBe(h);
  });

  it('구운 배지 번호(badgeFloor)는 이어 그리기·되돌리기·다시 하기에 함께 실려 다닌다', () => {
    let h = commitFrame(EMPTY_ANNOTATION_HISTORY, {
      items: [],
      base: layer('blob:round', true),
      marks: layer('blob:marks', true),
      badgeFloor: 3,
    });
    h = commitAnnotation(h, a);
    expect(h.badgeFloor).toBe(3);
    const afterCrop = undoAnnotations(h);
    expect(afterCrop.badgeFloor).toBe(3);
    const beforeCrop = undoAnnotations(afterCrop);
    expect(beforeCrop.badgeFloor).toBeUndefined(); // 자르기 전 — 아직 구운 배지가 없다
    expect(redoAnnotations(beforeCrop).badgeFloor).toBe(3);
    expect(redoAnnotations(redoAnnotations(beforeCrop)).badgeFloor).toBe(3);
  });

  it('전체 지우기는 구운 표시와 함께 그 번호도 걷는다 — 그림에서 사라진 번호는 1 부터 다시', () => {
    const h = commitFrame(EMPTY_ANNOTATION_HISTORY, { items: [], base: null, marks: layer('blob:marks', true), badgeFloor: 2 });
    const cleared = clearAnnotations(h);
    expect(cleared.badgeFloor).toBeUndefined();
    expect(nextBadgeIndex(cleared.items, cleared.badgeFloor ?? 0)).toBe(1);
    expect(undoAnnotations(cleared).badgeFloor).toBe(2);
  });

  it('바탕만 바뀌었을 때 지우기는 no-op', () => {
    const h = commitFrame(EMPTY_ANNOTATION_HISTORY, { items: [], base: layer('blob:base'), marks: null });
    expect(clearAnnotations(h)).toBe(h);
  });

  it('hasEdits — 주석·바탕·구운 표시 중 하나라도 있으면 편집이 있다', () => {
    expect(hasEdits(EMPTY_ANNOTATION_HISTORY)).toBe(false);
    expect(hasEdits({ items: [a], base: null, marks: null })).toBe(true);
    expect(hasEdits({ items: [], base: layer('x'), marks: null })).toBe(true);
    expect(hasEdits({ items: [], base: null, marks: layer('y') })).toBe(true);
  });

  it('referencedLayerSrcs 는 지금·과거·미래 칸의 래스터를 모두 센다', () => {
    let h = commitFrame(EMPTY_ANNOTATION_HISTORY, { items: [], base: layer('blob:1'), marks: null });
    h = commitFrame(h, { items: [], base: layer('blob:2'), marks: layer('blob:m2') });
    h = commitFrame(h, { items: [], base: layer('blob:3'), marks: null });
    h = undoAnnotations(h);
    expect([...referencedLayerSrcs(h)].sort()).toEqual(['blob:1', 'blob:2', 'blob:3', 'blob:m2']);
    // 되돌린 뒤 새로 쌓으면 미래 칸(blob:3)은 더 이상 가리켜지지 않는다 — 해제해도 된다.
    h = commitFrame(h, { items: [], base: layer('blob:4'), marks: null });
    expect(referencedLayerSrcs(h).has('blob:3')).toBe(false);
  });
});

describe('translateAnnotations (⑦ 사각 자르기)', () => {
  it('도형은 두 점, 글자·배지는 한 점, 펜은 모든 점을 옮긴다', () => {
    const rect = shape('r', { x: 100, y: 100 }, { x: 200, y: 150 });
    const text = createAnnotation({ id: 't', tool: 'text', at: { x: 50, y: 60 }, style, text: 'hi' });
    const badge = createAnnotation({ id: 'n', tool: 'number', at: { x: 300, y: 40 }, style, badgeIndex: 2 });
    let pen = createAnnotation({ id: 'p', tool: 'pen', at: { x: 10, y: 10 }, style });
    pen = extendAnnotation(pen, { x: 30, y: 40 });
    const [r2, t2, n2, p2] = translateAnnotations([rect, text, badge, pen], -40, -20);
    expect(r2).toMatchObject({ from: { x: 60, y: 80 }, to: { x: 160, y: 130 } });
    expect(t2).toMatchObject({ at: { x: 10, y: 40 }, text: 'hi' });
    expect(n2).toMatchObject({ at: { x: 260, y: 20 }, index: 2 });
    expect(p2).toMatchObject({ points: [{ x: -30, y: -10 }, { x: -10, y: 20 }] });
  });

  it('원본 배열·주석은 건드리지 않는다(되돌리기 앞 칸이 같은 객체를 붙든다)', () => {
    const rect = shape('r', { x: 100, y: 100 }, { x: 200, y: 150 });
    const before = JSON.stringify(rect);
    translateAnnotations([rect], 5, 5);
    expect(JSON.stringify(rect)).toBe(before);
  });
});
