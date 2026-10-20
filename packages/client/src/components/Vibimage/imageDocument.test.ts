import { describe, expect, it } from 'vitest';
import { imageVariant, isImageDocument, newImageDocument, newImageLayer, patchImageLayer, reorderImageLayer } from './imageDocument.js';
import { IMAGE_LINE_HEIGHT, imageFont, imageSvg, wrapTextToWidth } from './imageRender.js';
import { imageReviewChecks } from './imageReviewChecks.js';
import type { ImageCandidate, ImageSourceDoc } from './imageApi.js';

function fixture() {
  const payload = newImageDocument();
  payload.layers = [{ ...newImageLayer(payload, 'text', 'Price'), id: 'price', text: '$39' },
    { ...newImageLayer(payload, 'shape', 'Logo'), id: 'logo', locked: true }];
  const source: ImageSourceDoc = { id: 'image', appId: 'vibimage', schemaVersion: 1, title: 'Product', revision: 4, payload,
    parameters: { imageRequest: 'Change only the price', imageSelection: ['price'], imageRequestRevision: 4 },
    links: [], lockedPaths: ['/layers/@logo'], createdAt: 1, updatedAt: 2, label: '', author: 'user' };
  return { source, proposal: (next = payload): ImageCandidate => ({ id: 'candidate', baseRevision: 4, payload: next, label: 'Price change', input: '', status: 'pending', createdAt: 3 }) };
}
describe('editable image source and request checks', () => {
  it('round trips layer ids, project style and a flat imported photo without inventing layers', () => {
    const { source } = fixture();
    source.payload.layers.push({ ...newImageLayer(source.payload, 'image', 'Photo'), source: 'photos/product.png' });
    const reopened: unknown = JSON.parse(JSON.stringify(source.payload));
    expect(isImageDocument(reopened)).toBe(true);
    expect(reopened).toEqual(source.payload);
    expect(source.payload.layers.filter((layer) => layer.kind === 'image')).toHaveLength(1);
  });
  it('rejects unsafe references, duplicate identities and fractional output sizes before SVG rendering', () => {
    const { source } = fixture();
    for (const path of ['../secret.png', 'https://remote/x.png', 'javascript:alert(1)', 'C:\\x.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(isImageDocument({ ...source.payload, layers: [{ ...newImageLayer(source.payload, 'image', 'Photo'), source: path }] })).toBe(false);
    }
    expect(isImageDocument({ ...source.payload, layers: [source.payload.layers[0], source.payload.layers[0]] })).toBe(false);
    expect(isImageDocument({ ...source.payload, width: 1920.5 })).toBe(false);
    expect(isImageDocument({ ...source.payload, background: '#12345' })).toBe(false);
  });
  it('targets one id while preserving protected elements, and escapes rendered text and ids', () => {
    const { source, proposal } = fixture();
    const next = patchImageLayer(source.payload, 'price', { text: '<script>alert("x")</script> & $42' });
    expect(next.layers[1]).toBe(source.payload.layers[1]);
    expect(patchImageLayer(next, 'logo', { fill: '#ff0000' }).layers[1]).toBe(source.payload.layers[1]);
    expect(imageReviewChecks(source, proposal(next))).toMatchObject({ changed: ['price'], selectedOnly: true, blocked: false });
    const svg = imageSvg(next);
    expect(svg).toContain('data-layer-id="price"');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
  it('blocks outside-selection edits, protected deletion and canvas changes rather than calling them a successful visual review', () => {
    const { source, proposal } = fixture();
    expect(imageReviewChecks(source, proposal({ ...source.payload, layers: source.payload.layers.slice(0, 1) })))
      .toMatchObject({ changed: ['logo'], outside: ['logo'], protectedChanged: true, blocked: true });
    expect(imageReviewChecks(source, proposal({ ...source.payload, width: 1920 }))).toMatchObject({ canvasChanged: true, blocked: true });
    expect(imageReviewChecks(source, proposal({ ...source.payload, layers: [...source.payload.layers, newImageLayer(source.payload, 'text', 'Unexpected')] })).outside).toHaveLength(1);
  });
  it('derived ratios reflow text, fill full-canvas backgrounds and keep other layers whole, without dropping identities', () => {
    const { source } = fixture();
    source.payload.width = 1920; source.payload.height = 1080;
    source.payload.layers[0] = { ...source.payload.layers[0]!, text: 'A long product title that has to flow onto more lines', width: 1400, height: 160, x: 250, y: 80, fontSize: 96 };
    source.payload.layers[1] = { ...source.payload.layers[1]!, width: 300, height: 150, x: 1500, y: 800 };
    source.payload.layers.unshift({ ...newImageLayer(source.payload, 'shape', 'Backdrop'), id: 'backdrop', x: 0, y: 0, width: 1920, height: 1080 });
    const measure = (text: string, font: string): number => text.length * Number(/^(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.55;
    const portrait = imageVariant(source.payload, 1080, 1920, measure);
    expect([portrait.width, portrait.height]).toEqual([1080, 1920]);
    expect(portrait.layers.map((layer) => layer.id)).toEqual(source.payload.layers.map((layer) => layer.id));
    // A background covering the old canvas covers the new one (it is not shrunk into the middle).
    expect(portrait.layers[0]).toMatchObject({ x: 0, y: 0, width: 1080, height: 1920 });
    // Text takes the new safe width and flows again — more lines, a box tall enough for them.
    const title = portrait.layers[1]!;
    const lines = wrapTextToWidth(title.text!, title.width, imageFont(title.fontSize!, source.payload.style.fontFamily), measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(title.height).toBeGreaterThanOrEqual(lines.length * title.fontSize! * IMAGE_LINE_HEIGHT);
    expect(title.x).toBeGreaterThanOrEqual(portrait.style.margin - 0.001);
    expect(title.x + title.width).toBeLessThanOrEqual(portrait.width - portrait.style.margin + 0.001);
    // Other layers keep their proportions and stay inside the safe area.
    const logo = portrait.layers[2]!; const old = source.payload.layers[2]!;
    expect(logo.width / logo.height).toBeCloseTo(old.width / old.height);
    expect(logo.x + logo.width).toBeLessThanOrEqual(portrait.width - portrait.style.margin + 0.001);
    expect(isImageDocument(portrait)).toBe(true);
    // The logo is locked: it does not move.
    expect(reorderImageLayer(source.payload, 'logo', -1)).toBe(source.payload);
  });
});
