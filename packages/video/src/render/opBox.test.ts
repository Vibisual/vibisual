import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem, VideoTrack } from '../types.js';
import { buildDrawList, resolveTransform } from './drawList.js';
import { opBox, opRect, textBounds } from './hitTest.js';

/** §5.13 (V) 37-21 — 손잡이 틀이 쓰는 배치 상자. 가리키기 상자(`opRect`)와 한 출처여야 한다. */
function docWith(items: VideoItem[]): VideoDoc {
  const base = createEmptyDoc('box', 'Box', 1);
  const tracks: VideoTrack[] = items.map((item, i) => ({ id: `v${i + 1}`, kind: 'visual', items: [item] }));
  return { ...base, tracks: [...tracks, ...base.tracks.filter((t) => t.kind !== 'visual')] };
}

describe('opBox — 배치 상자', () => {
  const doc = docWith([
    { id: 'card', kind: 'shape', at: 0, duration: 4, transform: { x: 100, y: 200, width: 400, height: 200, scale: 0.5 } },
    { id: 'word', kind: 'text', at: 0, duration: 4, props: { text: 'Hi', fontSize: 64 }, transform: { x: 200, y: 100, width: 800, height: 300 } },
    { id: 'full', kind: 'shape', at: 0, duration: 4 },
    { id: 'zoom', kind: 'shape', at: 0, duration: 4, transform: { x: 0, y: 0, width: 200, height: 100 }, keyframes: [{ t: 0, dx: 0, scale: 1 }, { t: 2, dx: 60, scale: 2 }] },
  ]);
  const ops = buildDrawList(doc, resolveTimeline(doc), 2);
  const op = (id: string) => ops.find((o) => o.itemId === id)!;

  it('배율은 가운데를 기준으로 줄인다 — 글자가 아닌 것은 opRect 와 같은 상자다', () => {
    expect(opBox(op('card'))).toEqual({ x: 200, y: 250, width: 200, height: 100 });
    expect(opRect(op('card'))).toEqual(opBox(op('card')));
  });

  it('글자는 어림 글자 상자가 아니라 적힌 배치 상자다', () => {
    expect(opBox(op('word'))).toEqual({ x: 200, y: 100, width: 800, height: 300 });
    expect(opRect(op('word'))).toEqual(textBounds(op('word')));
    expect(opRect(op('word')).width).toBeLessThan(800);
  });

  it('배치를 적지 않은 아이템은 화면 전체다', () => {
    expect(opBox(op('full'))).toEqual({ x: 0, y: 0, width: doc.size.width, height: doc.size.height });
    expect(resolveTransform(doc.size, undefined)).toMatchObject({ x: 0, y: 0, width: doc.size.width, height: doc.size.height, scale: 1, rotation: 0, opacity: 1 });
  });

  it('키프레임이 얹힌 그 시각의 자리다', () => {
    // 2초: dx 60 · 배율 2 → 폭 400·높이 200, 가운데 (160, 50).
    expect(opBox(op('zoom'))).toEqual({ x: -40, y: -50, width: 400, height: 200 });
  });
});
