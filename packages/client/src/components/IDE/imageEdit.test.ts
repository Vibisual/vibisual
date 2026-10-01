import { describe, it, expect } from 'vitest';
import {
  CROP_ASPECTS,
  CROP_HANDLES,
  TRIM_TOLERANCE,
  aspectRatio,
  bakedBadgeFloor,
  clampCropBox,
  colorDistances,
  colorKey,
  defaultFeather,
  dominantCorner,
  dragCropBox,
  fitAspect,
  flattenAlpha,
  fullBox,
  hasTransparency,
  isCropPending,
  isFullBox,
  mimeKeepsAlpha,
  nudgeCropBox,
  opLeavesTransparency,
  parseHexColor,
  pixelAt,
  rgbDistance,
  rgbToHex,
  setCropField,
  toleranceFromPercent,
  trimBounds,
  type PixelBuffer,
  type Rgba,
} from './imageEdit.js';
import { createAnnotation, type AnnotationStyle } from './imageAnnotate.js';

// §5.5 #17-25 ⑦ — 자르기 상자 기하와 픽셀 연산은 DOM 없이 검증한다(버퍼·상자를 인자로 받는 순수 함수).

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const RED: Rgba = { r: 220, g: 30, b: 30, a: 255 };
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

function makeBuf(width: number, height: number, fill: Rgba): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill.r;
    data[i + 1] = fill.g;
    data[i + 2] = fill.b;
    data[i + 3] = fill.a;
  }
  return { width, height, data };
}

function setPx(buf: PixelBuffer, x: number, y: number, c: Rgba): void {
  const i = (y * buf.width + x) * 4;
  buf.data[i] = c.r;
  buf.data[i + 1] = c.g;
  buf.data[i + 2] = c.b;
  buf.data[i + 3] = c.a;
}

/** 문자열 격자로 버퍼 만들기 — W 흰색 · B 검정 · R 빨강 · . 투명 · G 옅은 회색(230). */
function grid(rows: string[]): PixelBuffer {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const buf = makeBuf(width, height, WHITE);
  const colors: Record<string, Rgba> = {
    W: WHITE,
    B: BLACK,
    R: RED,
    '.': CLEAR,
    G: { r: 230, g: 230, b: 230, a: 255 },
  };
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => setPx(buf, x, y, colors[ch] ?? WHITE));
  });
  return buf;
}

function alphas(buf: PixelBuffer): number[] {
  const out: number[] = [];
  for (let i = 3; i < buf.data.length; i += 4) out.push(buf.data[i] ?? -1);
  return out;
}

describe('aspectRatio', () => {
  const natural = { w: 1600, h: 900 };

  it('자유는 null, 원본은 지금 바탕의 비율', () => {
    expect(aspectRatio('free', natural)).toBeNull();
    expect(aspectRatio('original', natural)).toBeCloseTo(16 / 9, 9);
    expect(aspectRatio('original', { w: 0, h: 0 })).toBeNull();
  });

  it('고정 비율은 너비 ÷ 높이', () => {
    expect(aspectRatio('1:1', natural)).toBe(1);
    expect(aspectRatio('4:3', natural)).toBeCloseTo(4 / 3, 9);
    expect(aspectRatio('9:16', natural)).toBeCloseTo(9 / 16, 9);
  });

  it('칩 목록의 모든 비율이 해석된다(자유 말고는 null 이 없다)', () => {
    for (const a of CROP_ASPECTS) {
      if (a === 'free') continue;
      expect(aspectRatio(a, natural)).toBeGreaterThan(0);
    }
  });
});

describe('clampCropBox', () => {
  const natural = { w: 100, h: 80 };

  it('그림 밖으로 나간 상자를 안으로 민다', () => {
    expect(clampCropBox({ x: -10, y: -5, w: 50, h: 40 }, natural)).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(clampCropBox({ x: 90, y: 0, w: 50, h: 10 }, natural)).toEqual({ x: 50, y: 0, w: 50, h: 10 });
  });

  it('반올림은 변 단위 — 오른쪽 변이 반올림 때문에 밀리지 않는다', () => {
    expect(clampCropBox({ x: 10.4, y: 0, w: 20.4, h: 10 }, natural)).toEqual({ x: 10, y: 0, w: 21, h: 10 });
  });

  it('너비·높이는 최소 1, 최대 그림 크기', () => {
    expect(clampCropBox({ x: 5, y: 5, w: 0, h: 0 }, natural)).toEqual({ x: 5, y: 5, w: 1, h: 1 });
    expect(clampCropBox({ x: 0, y: 0, w: 500, h: 500 }, natural)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('-0 이 새지 않는다', () => {
    const box = clampCropBox({ x: -0.2, y: -0.3, w: 10, h: 10 }, natural);
    expect(Object.is(box.x, 0)).toBe(true);
    expect(Object.is(box.y, 0)).toBe(true);
  });

  it('fullBox·isFullBox 왕복', () => {
    expect(isFullBox(fullBox(natural), natural)).toBe(true);
    expect(isFullBox({ x: 0, y: 0, w: 99, h: 80 }, natural)).toBe(false);
  });
});

describe('fitAspect', () => {
  const natural = { w: 1600, h: 900 };

  it('지금 상자 안에서 그 비율로 가장 큰 상자를 가운데에', () => {
    expect(fitAspect(fullBox(natural), 1, natural)).toEqual({ x: 350, y: 0, w: 900, h: 900 });
    expect(fitAspect(fullBox(natural), 16 / 9, natural)).toEqual(fullBox(natural));
  });

  it('세로 비율도 상자를 벗어나지 않는다', () => {
    const box = fitAspect(fullBox(natural), 9 / 16, natural);
    expect(box.h).toBe(900);
    expect(box.w / box.h).toBeCloseTo(9 / 16, 2);
    expect(box.x + box.w / 2).toBeCloseTo(800, 0);
  });

  it('자유(null)는 가두기만', () => {
    expect(fitAspect({ x: -5, y: 0, w: 100, h: 100 }, null, natural)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('dragCropBox', () => {
  const natural = { w: 1000, h: 800 };
  const origin = { x: 100, y: 100, w: 400, h: 200 };

  it('안쪽 끌기는 크기를 두고 옮기며, 그림 밖으로 나가지 않는다', () => {
    const drag = { handle: 'move' as const, start: { x: 200, y: 150 }, origin };
    expect(dragCropBox(drag, { x: 300, y: 250 }, null, natural)).toEqual({ x: 200, y: 200, w: 400, h: 200 });
    expect(dragCropBox(drag, { x: 5000, y: 5000 }, null, natural)).toEqual({ x: 600, y: 600, w: 400, h: 200 });
  });

  it('자유 변 끌기는 움직인 만큼만 그 변을 옮긴다', () => {
    const drag = { handle: 'e' as const, start: { x: 500, y: 200 }, origin };
    expect(dragCropBox(drag, { x: 600, y: 250 }, null, natural)).toEqual({ x: 100, y: 100, w: 500, h: 200 });
  });

  it('반대편 변을 넘겨 끌어도 뒤집히지 않고 1px 로 멈춘다', () => {
    const drag = { handle: 'w' as const, start: { x: 100, y: 200 }, origin };
    expect(dragCropBox(drag, { x: 900, y: 200 }, null, natural)).toEqual({ x: 499, y: 100, w: 1, h: 200 });
  });

  it('자유 모서리는 두 변을 함께', () => {
    const drag = { handle: 'nw' as const, start: { x: 100, y: 100 }, origin };
    expect(dragCropBox(drag, { x: 50, y: 20 }, null, natural)).toEqual({ x: 50, y: 20, w: 450, h: 280 });
  });

  it('비율 모서리는 맞은편 모서리가 닻, 많이 바뀐 축이 크기를 정한다', () => {
    const se = { handle: 'se' as const, start: { x: 500, y: 300 }, origin };
    expect(dragCropBox(se, { x: 600, y: 300 }, 2, natural)).toEqual({ x: 100, y: 100, w: 500, h: 250 });
    const nw = { handle: 'nw' as const, start: { x: 100, y: 100 }, origin };
    expect(dragCropBox(nw, { x: 0, y: 100 }, 2, natural)).toEqual({ x: 0, y: 50, w: 500, h: 250 });
  });

  it('비율 모서리는 남은 자리에서 멈춘다(비율 유지)', () => {
    const se = { handle: 'se' as const, start: { x: 500, y: 300 }, origin };
    const box = dragCropBox(se, { x: 1000, y: 800 }, 2, natural);
    expect(box).toEqual({ x: 100, y: 100, w: 900, h: 450 });
    expect(box.w / box.h).toBe(2);
  });

  it('비율 변 끌기는 다른 축이 가운데를 지키며 따라온다', () => {
    const e = { handle: 'e' as const, start: { x: 500, y: 200 }, origin };
    expect(dragCropBox(e, { x: 700, y: 200 }, 2, natural)).toEqual({ x: 100, y: 50, w: 600, h: 300 });
    const s = { handle: 's' as const, start: { x: 300, y: 300 }, origin };
    expect(dragCropBox(s, { x: 300, y: 400 }, 2, natural)).toEqual({ x: 0, y: 100, w: 600, h: 300 });
  });

  it('새로 긋기는 누른 점이 닻 — 어느 방향으로도', () => {
    const drag = { handle: 'new' as const, start: { x: 200, y: 200 }, origin };
    expect(dragCropBox(drag, { x: 100, y: 150 }, null, natural)).toEqual({ x: 100, y: 150, w: 100, h: 50 });
    expect(dragCropBox(drag, { x: 260, y: 220 }, 1, natural)).toEqual({ x: 200, y: 200, w: 60, h: 60 });
  });

  it('비율로 새로 긋다 가장자리에 닿으면 비율을 지키며 줄어든다', () => {
    const drag = { handle: 'new' as const, start: { x: 950, y: 700 }, origin };
    expect(dragCropBox(drag, { x: 1000, y: 800 }, 1, natural)).toEqual({ x: 950, y: 700, w: 50, h: 50 });
  });

  it('손잡이 8개가 모두 상자를 그림 안에 남긴다', () => {
    for (const handle of CROP_HANDLES) {
      const box = dragCropBox({ handle, start: { x: 300, y: 200 }, origin }, { x: -500, y: 5000 }, 4 / 3, natural);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(natural.w);
      expect(box.y + box.h).toBeLessThanOrEqual(natural.h);
      expect(box.w).toBeGreaterThanOrEqual(1);
      expect(box.h).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('nudgeCropBox · setCropField', () => {
  const natural = { w: 1000, h: 800 };
  const box = { x: 100, y: 100, w: 400, h: 200 };

  it('화살표는 크기를 두고 옮기며 가장자리에서 멈춘다', () => {
    expect(nudgeCropBox(box, 10, -1, natural)).toEqual({ x: 110, y: 99, w: 400, h: 200 });
    expect(nudgeCropBox(box, -200, 0, natural)).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  });

  it('위치 칸은 상자가 넘치지 않게 가둔다', () => {
    expect(setCropField(box, 'x', 900, null, natural)).toEqual({ x: 600, y: 100, w: 400, h: 200 });
    expect(setCropField(box, 'y', -30, null, natural)).toEqual({ x: 100, y: 0, w: 400, h: 200 });
  });

  it('크기 칸은 1..그림 크기, 넘치면 왼쪽으로 민다', () => {
    expect(setCropField(box, 'w', 2000, null, natural)).toEqual({ x: 0, y: 100, w: 1000, h: 200 });
    expect(setCropField(box, 'h', 0, null, natural)).toEqual({ x: 100, y: 100, w: 400, h: 1 });
  });

  it('비율이 고정이면 반대쪽 변이 따라오고, 그림을 넘으면 둘 다 줄인다', () => {
    expect(setCropField(box, 'w', 300, 2, natural)).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    expect(setCropField(box, 'h', 700, 2, natural)).toEqual({ x: 0, y: 100, w: 1000, h: 500 });
  });

  it('숫자가 아니면 그대로', () => {
    expect(setCropField(box, 'w', Number.NaN, null, natural)).toBe(box);
    expect(setCropField(box, 'x', Number.POSITIVE_INFINITY, null, natural)).toBe(box);
  });
});

describe('isCropPending', () => {
  const natural = { w: 200, h: 100 };

  it('그림 전체를 잡은 사각형은 할 일이 없다', () => {
    expect(isCropPending(fullBox(natural), 'rect', natural)).toBe(false);
    expect(isCropPending({ x: 0, y: 0, w: 199, h: 100 }, 'rect', natural)).toBe(true);
  });

  it('원형은 전체여도 모서리를 걷는다', () => {
    expect(isCropPending(fullBox(natural), 'ellipse', natural)).toBe(true);
  });

  it('상자가 없거나 그림을 아직 못 읽었으면 없다', () => {
    expect(isCropPending(null, 'ellipse', natural)).toBe(false);
    expect(isCropPending(fullBox(natural), 'ellipse', { w: 0, h: 0 })).toBe(false);
  });
});

describe('colorKey', () => {
  // 검정 고리 안에 흰 점 하나 — "이어진 영역만"이면 안쪽 흰색은 남아야 한다.
  const ring = [
    'WWWWW',
    'WBBBW',
    'WBWBW',
    'WBBBW',
    'WWWWW',
  ];

  it('이어진 영역만 — 누른 점에서 번진 배경만 투명, 고리 속 흰색은 남는다', () => {
    const buf = grid(ring);
    const out = colorKey(buf, { color: WHITE, tolerance: 10, contiguous: true, seeds: [{ x: 0, y: 0 }] });
    expect(out.changed).toBe(16);
    expect(pixelAt(out.buffer, { x: 2, y: 2 }).a).toBe(255);
    expect(pixelAt(out.buffer, { x: 0, y: 0 }).a).toBe(0);
    expect(pixelAt(out.buffer, { x: 1, y: 1 }).a).toBe(255);
  });

  it('끄면 그림 전체에서 그 색을 뺀다', () => {
    const out = colorKey(grid(ring), { color: WHITE, tolerance: 10, contiguous: false });
    expect(out.changed).toBe(17);
    expect(pixelAt(out.buffer, { x: 2, y: 2 }).a).toBe(0);
  });

  it('입력 버퍼는 건드리지 않는다(되돌리기 앞 칸·미리보기 캐시가 붙든다)', () => {
    const buf = grid(ring);
    colorKey(buf, { color: WHITE, tolerance: 10, contiguous: false });
    expect(alphas(buf).every((a) => a === 255)).toBe(true);
  });

  it('오차 바로 바깥 띠는 거리에 비례해 반투명이 된다', () => {
    const out = colorKey(grid(['WGB']), {
      color: WHITE,
      tolerance: 10,
      feather: 20,
      contiguous: true,
      seeds: [{ x: 0, y: 0 }],
    });
    // 회색(230) 은 거리 25 — (25-10)/(20+1) 만큼 남는다.
    expect(alphas(out.buffer)).toEqual([0, Math.round((255 * 15) / 21), 255]);
    expect(out.changed).toBe(2);
  });

  it('띠는 한 줄뿐 — 띠끼리 번지지 않는다', () => {
    const out = colorKey(grid(['WGGB']), {
      color: WHITE,
      tolerance: 10,
      feather: 20,
      contiguous: true,
      seeds: [{ x: 0, y: 0 }],
    });
    expect(alphas(out.buffer)[2]).toBe(255);
  });

  it('전체 모드에서도 띠는 투명이 된 픽셀 옆에만 생긴다', () => {
    const out = colorKey(grid(['GBW']), { color: WHITE, tolerance: 10, feather: 20, contiguous: false });
    expect(alphas(out.buffer)).toEqual([255, 255, 0]);
  });

  it('이미 투명한 픽셀은 번짐이 지나가는 길이다', () => {
    const out = colorKey(grid(['W.WBW']), { color: WHITE, tolerance: 10, contiguous: true, seeds: [{ x: 0, y: 0 }] });
    expect(alphas(out.buffer)).toEqual([0, 0, 0, 255, 255]);
    expect(out.changed).toBe(2);
  });

  it('출발점이 없거나 그림 밖이면 아무것도 빼지 않는다', () => {
    const buf = grid(ring);
    expect(colorKey(buf, { color: WHITE, tolerance: 10, contiguous: true }).changed).toBe(0);
    expect(colorKey(buf, { color: WHITE, tolerance: 10, contiguous: true, seeds: [{ x: -1, y: 99 }] }).changed).toBe(0);
  });

  it('미리 잰 거리를 넘겨도 같은 결과(슬라이더 캐시)', () => {
    const buf = grid(ring);
    const distances = colorDistances(buf, WHITE);
    const a = colorKey(buf, { color: WHITE, tolerance: 30, contiguous: false });
    const b = colorKey(buf, { color: WHITE, tolerance: 30, contiguous: false, distances });
    expect(alphas(b.buffer)).toEqual(alphas(a.buffer));
  });

  it('맞는 색이 없으면 changed 0', () => {
    const out = colorKey(grid(['BBB']), { color: WHITE, tolerance: 10, contiguous: false });
    expect(out.changed).toBe(0);
  });
});

describe('dominantCorner', () => {
  it('가장 많이 겹치는 귀퉁이 색과 그 귀퉁이들', () => {
    const got = dominantCorner(grid(['WBBW', 'BBBB', 'WBBR']), TRIM_TOLERANCE);
    expect(got?.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(got?.seeds).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 2 }]);
  });

  it('동률이면 앞 귀퉁이(왼쪽 위)가 이긴다', () => {
    const got = dominantCorner(grid(['WW', 'RR']), TRIM_TOLERANCE);
    expect(got?.color).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('skipTransparent — 투명한 귀퉁이는 후보에서 뺀다', () => {
    const buf = grid(['..', 'WR']);
    expect(dominantCorner(buf, TRIM_TOLERANCE)?.transparent).toBe(true);
    const got = dominantCorner(buf, TRIM_TOLERANCE, { skipTransparent: true });
    expect(got?.transparent).toBe(false);
    expect(got?.color).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('귀퉁이가 전부 투명이고 skipTransparent 면 null', () => {
    expect(dominantCorner(grid(['.W.', 'WWW', '.W.']), TRIM_TOLERANCE, { skipTransparent: true })).toBeNull();
  });
});

describe('trimBounds', () => {
  it('흰 여백을 걷은 가장 작은 상자', () => {
    expect(trimBounds(grid([
      'WWWWWW',
      'WWRRWW',
      'WWRBWW',
      'WWWWWW',
    ]))).toEqual({ x: 2, y: 1, w: 2, h: 2 });
  });

  it('투명 여백도 걷는다', () => {
    expect(trimBounds(grid([
      '.....',
      '...R.',
      '.....',
    ]))).toEqual({ x: 3, y: 1, w: 1, h: 1 });
  });

  it('압축 잡티 정도는 배경으로 본다', () => {
    const buf = grid(['WWWW', 'WRWW', 'WWWW']);
    setPx(buf, 3, 2, { r: 250, g: 249, b: 252, a: 255 });
    expect(trimBounds(buf)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('그림 전체가 배경이면 null', () => {
    expect(trimBounds(grid(['WWW', 'WWW']))).toBeNull();
  });
});

describe('flattenAlpha', () => {
  it('투명은 채울 색으로, 반투명은 알파 합성으로, 불투명은 그대로', () => {
    const buf = makeBuf(3, 1, WHITE);
    setPx(buf, 0, 0, { r: 10, g: 20, b: 30, a: 0 });
    setPx(buf, 1, 0, { r: 0, g: 0, b: 0, a: 128 });
    setPx(buf, 2, 0, RED);
    const out = flattenAlpha(buf, { r: 255, g: 255, b: 255 });
    expect(pixelAt(out, { x: 0, y: 0 })).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    const mid = Math.round(255 * (1 - 128 / 255));
    expect(pixelAt(out, { x: 1, y: 0 })).toEqual({ r: mid, g: mid, b: mid, a: 255 });
    expect(pixelAt(out, { x: 2, y: 0 })).toEqual(RED);
    expect(hasTransparency(out)).toBe(false);
    // 입력은 그대로
    expect(pixelAt(buf, { x: 0, y: 0 }).a).toBe(0);
  });
});

describe('작은 도우미', () => {
  it('hasTransparency', () => {
    expect(hasTransparency(grid(['WW']))).toBe(false);
    expect(hasTransparency(grid(['W.']))).toBe(true);
  });

  it('pixelAt 은 그림 밖 좌표를 가장자리로 가둔다', () => {
    const buf = grid(['WR']);
    expect(pixelAt(buf, { x: 99, y: -3 })).toEqual(RED);
    expect(pixelAt(buf, { x: 0.9, y: 0.9 })).toEqual(WHITE);
  });

  it('rgbDistance 는 세 채널 차이 중 가장 큰 값', () => {
    expect(rgbDistance({ r: 10, g: 200, b: 30 }, { r: 20, g: 150, b: 35 })).toBe(50);
  });

  it('hex 왕복', () => {
    expect(parseHexColor('#1a2B3c')).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseHexColor('fff')).toBeNull();
    expect(parseHexColor('#12345z')).toBeNull();
    expect(rgbToHex({ r: 26, g: 43, b: 60 })).toBe('#1a2b3c');
    expect(rgbToHex({ r: 300, g: -4, b: 7.6 })).toBe('#ff0008');
  });

  it('jpeg 만 알파를 못 담는다', () => {
    expect(mimeKeepsAlpha('image/jpeg')).toBe(false);
    expect(mimeKeepsAlpha('IMAGE/JPG')).toBe(false);
    expect(mimeKeepsAlpha('image/png')).toBe(true);
    expect(mimeKeepsAlpha('image/webp')).toBe(true);
  });

  it('오차 % → 0..255', () => {
    expect(toleranceFromPercent(10)).toBe(26);
    expect(toleranceFromPercent(0)).toBe(0);
    expect(toleranceFromPercent(150)).toBe(255);
    expect(toleranceFromPercent(Number.NaN)).toBe(0);
  });

  it('띠 너비는 오차가 클수록 넓다', () => {
    expect(defaultFeather(0)).toBe(4);
    expect(defaultFeather(40)).toBeGreaterThan(defaultFeather(10));
  });

  it('opLeavesTransparency — jpeg 덮어쓰기 판정', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(opLeavesTransparency(null, false)).toBe(false);
    expect(opLeavesTransparency(null, true)).toBe(true);
    expect(opLeavesTransparency({ kind: 'crop', box, shape: 'rect' }, false)).toBe(false);
    expect(opLeavesTransparency({ kind: 'crop', box, shape: 'ellipse' }, false)).toBe(true);
    expect(opLeavesTransparency({ kind: 'key', color: WHITE, seeds: [], tolerance: 10, contiguous: true }, false)).toBe(true);
    expect(opLeavesTransparency({ kind: 'fill', color: WHITE }, true)).toBe(false);
  });
});

// §5.5 #17-25 ① — 원형 자르기는 표시를 그림에 구우며 목록을 비운다. 그때 구운 번호를 남겨야 다음 배지가 1 로 돌아가지 않는다.
describe('bakedBadgeFloor', () => {
  const style: AnnotationStyle = { color: '#ef4444', strokeWidth: 4, fontSize: 32, badgeRadius: 20 };
  const badge = (id: string, index: number) =>
    createAnnotation({ id, tool: 'number', at: { x: 0, y: 0 }, style, badgeIndex: index });

  it('구울 목록의 가장 큰 번호를 남긴다', () => {
    expect(bakedBadgeFloor({ items: [badge('a', 1), badge('b', 2), badge('c', 3)] })).toBe(3);
  });

  it('두 번째 원형 자르기 — 앞서 구운 번호를 잇는다', () => {
    expect(bakedBadgeFloor({ items: [], badgeFloor: 3 })).toBe(3);
    expect(bakedBadgeFloor({ items: [badge('d', 4)], badgeFloor: 3 })).toBe(4);
  });

  it('목록의 번호가 앞서 구운 번호보다 크면 목록을 따른다', () => {
    expect(bakedBadgeFloor({ items: [badge('e', 5)], badgeFloor: 3 })).toBe(5);
  });

  it('배지가 없으면 0 — 되돌리기 칸에 싣지 않는다', () => {
    expect(bakedBadgeFloor({ items: [] })).toBe(0);
  });
});
