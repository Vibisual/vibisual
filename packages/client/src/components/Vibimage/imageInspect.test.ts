import { describe, expect, it } from 'vitest';

import type { ImageDocument, ImageLayer } from '../Creation/imageSource.js';
import { imageLayerAt, imageStageFit, imageStageLevels, imageViewerLevels, type ImageInspectContext } from './imageInspect.js';

/**
 * §5.4 #15 (C) — 그림 앱을 Alt 인스펙터로 집으면 편집기는 그 자리의 맨 위 레이어(→ 그림 판 전체)를, 보기 화면은 그 그림과 픽셀
 * 좌표를 답한다. 종전에는 편집기가 어느 원본·어느 레이어인지 모르는 SVG 도형으로, 보기 화면은 무대 통째로 집혔다.
 */

function layer(id: string, name: string, kind: ImageLayer['kind'], box: [number, number, number, number], over: Partial<ImageLayer> = {}): ImageLayer {
  const [x, y, width, height] = box;
  return { id, kind, name, x, y, width, height, fill: '#112233', opacity: 1, locked: false, visible: true, anchor: 'start', ...over };
}

const doc: ImageDocument = {
  format: 'vibimage', version: 1, width: 1000, height: 500, background: '#ffffff',
  style: { fontFamily: 'Arial', foreground: '#000000', accent: '#ff0000', margin: 64 },
  layers: [
    layer('l-bg', 'Background', 'shape', [0, 0, 1000, 500], { shape: 'rect' }),
    layer('l-text', 'Title', 'text', [100, 100, 400, 100], { text: 'Hello world' }),
    layer('l-ellipse', 'Dot', 'shape', [600, 100, 200, 200], { shape: 'ellipse' }),
    layer('l-hidden', 'Hidden', 'text', [100, 100, 400, 100], { visible: false, text: 'secret' }),
    layer('l-img', 'Logo', 'image', [700, 350, 200, 100], { locked: true }),
  ],
};
const saved: ImageInspectContext = { projectId: 'My Project', source: { id: 'src-1', revision: 5, title: 'Poster' }, unsaved: false };
const labels = { canvas: 'Canvas' };
/** 400×400 판에 1000×500 문서 — 0.4 배, 위아래 100px 여백. */
const box = { width: 400, height: 400 };
const at = (docX: number, docY: number): { x: number; y: number; width: number; height: number } => ({ x: docX * 0.4, y: 100 + docY * 0.4, ...box });

describe('그림 편집기 무대 — 맨 위 레이어 → 그림 판', () => {
  it('fits the document like the SVG viewBox (meet, centered)', () => {
    expect(imageStageFit(doc, box)).toEqual({ scale: 0.4, x: 0, y: 100 });
  });

  it('picks the top visible layer and then the whole canvas, naming the source and layer for the agent', () => {
    const levels = imageStageLevels(doc, saved, labels, at(300, 150));
    expect(levels.map((l) => l.label)).toEqual(['Title', 'Canvas 1000×500']);
    expect(levels[0]!.text).toBe('Hello world');
    expect(levels[0]!.rect).toEqual({ x: 40, y: 140, width: 160, height: 40 });
    expect(levels[1]!.rect).toEqual({ x: 0, y: 100, width: 400, height: 200 });
    const copied = levels[0]!.clipboard;
    expect(copied).toContain('[Image] source "src-1" ("Poster", revision 5, 1000x500) in project "My Project"');
    expect(copied).toContain('[Pointed] layer "Title" id "l-text" (text, x 100, y 100, 400x100, layer 2 of 5) at (300, 150) — text "Hello world"');
    expect(copied).toContain('GET $VIBISUAL_BASE/api/app/creation/docs/src-1?projectId=My%20Project first, then propose the change with POST $VIBISUAL_BASE/api/app/creation/docs/src-1/candidates');
    expect(levels[1]!.clipboard).toContain('[Pointed] the whole canvas 1000x500 (background #ffffff, 5 layers) at (300, 150)');
  });

  it('skips hidden layers, honours ellipse shapes, and marks locked layers', () => {
    expect(imageLayerAt(doc, 300, 150)?.id).toBe('l-text');
    expect(imageLayerAt(doc, 700, 200)?.id).toBe('l-ellipse');
    // 타원 상자의 모서리는 타원 밖 — 그 아래 배경이 집힌다.
    expect(imageLayerAt(doc, 610, 110)?.id).toBe('l-bg');
    const logo = imageStageLevels(doc, saved, labels, at(800, 400));
    expect(logo[0]!.label).toBe('Logo');
    expect(logo[0]!.clipboard).toContain('(image, x 700, y 350, 200x100, layer 5 of 5, locked)');
  });

  it('answers nothing in the letterbox margin outside the picture', () => {
    expect(imageStageLevels(doc, saved, labels, { x: 200, y: 50, ...box })).toEqual([]);
  });

  it('tells an unsaved draft, unsaved edits and a proposal apart', () => {
    const draft = imageStageLevels(doc, { projectId: 'My Project', source: null, unsaved: true }, labels, at(300, 150))[0]!.clipboard;
    expect(draft).toContain('[Image] unsaved draft (1000x500) in project "My Project" — not saved as a source yet');
    expect(draft).toContain('Ask the user to save it in Vibimage first');
    const dirty = imageStageLevels(doc, { ...saved, unsaved: true }, labels, at(300, 150))[0]!.clipboard;
    expect(dirty).toContain('— the editor has unsaved edits');
    const proposal = imageStageLevels(doc, { ...saved, proposal: { id: 'cand-1', baseRevision: 4 } }, labels, at(300, 150))[0]!.clipboard;
    expect(proposal).toContain('[Image] proposal "cand-1" for source "src-1" ("Poster", based on revision 4, 1000x500) in project "My Project" — preview, not adopted');
    expect(proposal).toContain('GET $VIBISUAL_BASE/api/app/creation/docs/src-1/candidates/cand-1?projectId=My%20Project reads this proposal');
    expect(proposal).toContain('never accept it yourself');
  });
});

describe('그림 보기 화면 — 그 그림과 픽셀 좌표', () => {
  const file = { projectId: 'My Project', path: 'assets/photo.png', name: 'photo.png' };
  const view = { stageWidth: 800, stageHeight: 600, naturalWidth: 400, naturalHeight: 200, scale: 1, offsetX: 0, offsetY: 0 };

  it('picks the picture with the pixel under the cursor', () => {
    const levels = imageViewerLevels(view, file, { x: 400, y: 300, width: 800, height: 600 });
    expect(levels).toHaveLength(1);
    expect(levels[0]!.rect).toEqual({ x: 200, y: 200, width: 400, height: 200 });
    expect(levels[0]!.label).toBe('photo.png');
    expect(levels[0]!.text).toBe('(200, 100) · 400×200');
    expect(levels[0]!.clipboard).toContain('[Image] picture file "assets/photo.png" in project "My Project" (400x200 px)');
    expect(levels[0]!.clipboard).toContain('[Pointed] pixel (200, 100) of the picture (origin top-left)');
  });

  it('follows zoom and pan, clips the box to the stage, and leaves the backdrop to the DOM', () => {
    const zoomed = imageViewerLevels({ ...view, scale: 2, offsetX: 100, offsetY: -50 }, file, { x: 500, y: 250, width: 800, height: 600 });
    expect(zoomed[0]!.text).toBe('(200, 100) · 400×200');
    expect(zoomed[0]!.rect).toEqual({ x: 100, y: 50, width: 700, height: 400 });
    expect(imageViewerLevels(view, file, { x: 100, y: 100, width: 800, height: 600 })).toEqual([]);
  });

  it('maps the visible size when the stage sits under CSS zoom', () => {
    const levels = imageViewerLevels(view, file, { x: 200, y: 150, width: 400, height: 300 });
    expect(levels[0]!.text).toBe('(200, 100) · 400×200');
    expect(levels[0]!.rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });
});
