import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { inspectorPickerAt } from '../../utils/inspectorPick.js';
import { FrameStripViewer } from './FrameStripViewer.js';
import { STRIP_GAP, stripCellAt, stripColumns } from './stripGrid.js';

/** §5.13 (T-9) — 프레임 띠는 가로가 조금 긴 격자 한 장이다(8칸 → 4×2, 24칸 → 6×4). */
describe('§5.13 (T-9) 프레임 띠 격자', () => {
  it('칸 수에 맞는 열 수를 고른다', () => {
    expect(stripColumns(0)).toBe(1);
    expect(stripColumns(1)).toBe(1);
    expect(stripColumns(2)).toBe(2);
    expect(stripColumns(8)).toBe(4);
    expect(stripColumns(24)).toBe(6);
  });

  it('열은 칸 수를 넘지 않고, 격자는 세로로 길어지지 않는다', () => {
    for (let n = 1; n <= 24; n += 1) {
      const cols = stripColumns(n);
      expect(cols, `${n}칸`).toBeLessThanOrEqual(n);
      expect(Math.ceil(n / cols), `${n}칸`).toBeLessThanOrEqual(cols);
    }
  });
});

/** `composeStripGrid` 가 그린 띠 그림의 크기 — 칸 320×180, 틈 `STRIP_GAP`. */
function stripImage(count: number, cellW = 320, cellH = 180): { width: number; height: number } {
  const cols = stripColumns(count);
  const rows = Math.ceil(count / cols);
  return { width: cols * cellW + (cols + 1) * STRIP_GAP, height: rows * cellH + (rows + 1) * STRIP_GAP };
}

describe('§5.4 #15 (C) 프레임 띠의 칸 하나를 집는다', () => {
  it('그림 픽셀에서 칸 번호와 그 칸의 상자를 되짚는다(8칸 = 4×2)', () => {
    const image = stripImage(8);
    expect(stripCellAt(image, 8, STRIP_GAP + 10, STRIP_GAP + 10)).toEqual({ index: 0, rect: { x: STRIP_GAP, y: STRIP_GAP, width: 320, height: 180 } });
    expect(stripCellAt(image, 8, STRIP_GAP * 2 + 320 + 5, 50)?.index).toBe(1);
    const lastX = image.width - STRIP_GAP - 5;
    const lastY = image.height - STRIP_GAP - 5;
    expect(stripCellAt(image, 8, lastX, lastY)).toEqual({
      index: 7, rect: { x: STRIP_GAP + 3 * (320 + STRIP_GAP), y: STRIP_GAP + 180 + STRIP_GAP, width: 320, height: 180 },
    });
  });

  it('틈과 바깥, 비어 있는 마지막 줄 칸은 집지 않는다', () => {
    const image = stripImage(7);
    expect(stripCellAt(image, 7, STRIP_GAP + 320 + 2, 50)).toBeNull();
    expect(stripCellAt(image, 7, 2, 2)).toBeNull();
    expect(stripCellAt(image, 7, image.width + 4, 50)).toBeNull();
    // 7칸 = 4×2 — 둘째 줄 넷째 칸은 그려지지 않았다.
    expect(stripCellAt(image, 7, image.width - STRIP_GAP - 5, image.height - STRIP_GAP - 5)).toBeNull();
    expect(stripCellAt(image, 7, image.width - STRIP_GAP - 5 - (320 + STRIP_GAP), image.height - STRIP_GAP - 5)?.index).toBe(6);
  });

  it('띠 보기 화면은 여백 있는 그림(object-contain)에서도 그 칸을 집고, 그 시각의 복사 글을 낸다', () => {
    const natural = stripImage(8);
    const img = { naturalWidth: natural.width, naturalHeight: natural.height };
    const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const pickClipboard = vi.fn((t: number, frame: number, count: number) => `strip:${t}:${frame}/${count}`);
    let view!: ReturnType<typeof create>;
    act(() => {
      view = create(createElement(FrameStripViewer, { strip: { image: 'data:', times, title: 'Intro' }, onClose: () => undefined, pickClipboard }), {
        createNodeMock: (el) => (el.type === 'img' ? img : el.type === 'button' ? { focus: () => undefined } : {}),
      });
    });
    const picker = inspectorPickerAt(img as unknown as Element)?.picker;
    expect(picker).toBeTypeOf('function');
    // 요소 상자가 그림보다 세로로 길다 — 그림은 가운데에 반 크기로 선다.
    const scale = 0.5;
    const box = { width: natural.width * scale, height: natural.height * scale + 100 };
    const oy = 50;
    const levels = picker!({ x: (STRIP_GAP + 320 + STRIP_GAP + 10) * scale, y: oy + (STRIP_GAP + 180 + STRIP_GAP + 10) * scale, ...box });
    expect(levels).toEqual([{
      rect: { x: (STRIP_GAP * 2 + 320) * scale, y: oy + (STRIP_GAP * 2 + 180) * scale, width: 320 * scale, height: 180 * scale },
      label: '#6 · 00:02.50',
      text: 'Intro',
      clipboard: 'strip:2.5:6/8',
    }]);
    // 위아래 여백은 칸이 아니다 — 그림 그대로(DOM) 집힌다.
    expect(picker!({ x: 40, y: 10, ...box })).toEqual([]);
    act(() => view.unmount());
    expect(inspectorPickerAt(img as unknown as Element)).toBeNull();
  });
});
