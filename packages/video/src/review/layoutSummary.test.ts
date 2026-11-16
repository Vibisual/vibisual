import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem, VideoTrack } from '../types.js';
import { summarizeLayout } from './layoutSummary.js';
import type { ProbeText } from './motionReview.js';

/** 아이템 하나씩 제 트랙에 — 트랙 순서가 곧 그리는 순서(#1 이 맨 아래). */
function docWith(items: VideoItem[], extra: Partial<VideoDoc> = {}): VideoDoc {
  const base = createEmptyDoc('layout', 'Layout', 1);
  const tracks: VideoTrack[] = items.map((item, i) => ({ id: `v${i + 1}`, kind: 'visual', items: [item] }));
  return { ...base, ...extra, tracks: [...tracks, ...base.tracks.filter((t) => t.kind !== 'visual')] };
}

const text = (id: string, words: string, transform: VideoItem['transform'], extra: Partial<VideoItem> = {}): VideoItem => ({
  id, kind: 'text', at: 0, duration: 6, props: { text: words, fontSize: 64 }, transform, ...extra,
});

describe('§5.13 (G) layout summary — elements at a moment as text', () => {
  const doc = docWith([
    { id: 'bg', kind: 'shape', at: 0, duration: 6, props: { shape: 'rect', fill: '#111' } },
    text('t1', 'Hello world', { x: 200, y: 100, width: 800, height: 200 }, { label: 'Title' }),
    text('t2', 'Overlapping words', { x: 240, y: 120, width: 800, height: 200 }),
    text('t3', 'Off the edge', { x: 1700, y: 900, width: 400, height: 100 }),
    { id: 'card', kind: 'shape', at: 0, duration: 6, props: { shape: 'rect', fill: '#fff' }, transform: { x: 1650, y: 850, width: 600, height: 300 } },
  ]);
  const timeline = resolveTimeline(doc);

  it('lists every drawn item in drawing order with its kind, id, label, box and words', () => {
    const s = summarizeLayout({ doc, timeline, t: 1 });
    expect(s.total).toBe(5);
    expect(s.listed).toBe(5);
    expect(s.elements.map((e) => `${e.ref}:${e.itemId}`)).toEqual(['1:bg', '2:t1', '3:t2', '4:t3', '5:card']);
    expect(s.elements[0]?.box).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(s.elements[1]).toMatchObject({ kind: 'text', label: 'Title', text: 'Hello world', fontSize: 64 });
    const lines = s.text.split('\n');
    expect(lines[0]).toContain('1920x1080 (landscape)');
    expect(lines[0]).toContain('later # = drawn on top');
    expect(lines.find((l) => l.startsWith('#2 '))).toMatch(/^#2 text "t1" \(Title\) box \d+,\d+ \d+x\d+ · "Hello world" · 64px/);
  });

  it('flags overlapping texts, clipped and unsafe texts, and a later opaque shape that covers a text', () => {
    const s = summarizeLayout({ doc, timeline, t: 1 });
    const flags = (id: string) => s.elements.find((e) => e.itemId === id)?.flags ?? [];
    expect(flags('t1')).toContain('overlaps #3');
    expect(flags('t2')).toContain('overlaps #2');
    expect(flags('t3').some((f) => /^clipped right \d+px$/.test(f))).toBe(true);
    expect(flags('t3')).toContain('outside safe area');
    expect(flags('t3')).toContain('covered by #5');
    // The background shape is drawn first — it never covers what is drawn after it.
    expect(flags('t1').some((f) => f.startsWith('covered by'))).toBe(false);
    expect(s.flags).toMatchObject({ overlap: 2, covered: 1, unsafe: 1 });
    expect(s.flags.clipped).toBeGreaterThanOrEqual(1);
    expect(s.text).toContain('! ');
  });

  it('puts the elements inside a composition under it as #n.k with their CSS path, size and contrast', () => {
    const comp: VideoItem = { id: 'comp', kind: 'composition', at: 0, duration: 6, assetId: 'c1', transform: { x: 0, y: 0, width: 1920, height: 1080 } };
    const withComp = docWith([text('t1', 'Hello world', { x: 200, y: 100, width: 800, height: 200 }), comp], {
      assets: { c1: { id: 'c1', kind: 'composition', source: { kind: 'file', path: 'comp/index.html' }, duration: 6 } },
    });
    const probeTexts: ProbeText[] = [
      { itemId: 'comp', text: 'Inner headline', path: 'h1.title', rect: { x: 300, y: 130, width: 500, height: 80 }, color: '#ffffff', fontSize: 48, bgLuminance: 0.95 },
      { itemId: 'comp', text: 'Way off', path: 'p.note', rect: { x: 2000, y: 20, width: 100, height: 40 }, color: '#000000', fontSize: 20 },
    ];
    const s = summarizeLayout({ doc: withComp, timeline: resolveTimeline(withComp), t: 1, probeTexts });
    const inner = s.elements.filter((e) => e.kind === 'inner');
    expect(inner.map((e) => `${e.ref} ${e.path}`)).toEqual(['2.1 h1.title', '2.2 p.note']);
    expect(inner[0]).toMatchObject({ text: 'Inner headline', fontSize: 48, contrast: 1.1 });
    expect(inner[0]?.flags).toContain('low contrast 1.1:1');
    expect(inner[0]?.flags).toContain('overlaps #1');
    expect(inner[1]?.flags).toContain('offscreen');
    expect(s.text).toContain('  #2.1 h1.title box 300,130 500x80 · "Inner headline" · 48px · contrast 1.1:1');
  });

  it('caps the listing — flagged elements first, then the topmost — and says how many were left out', () => {
    const s = summarizeLayout({ doc, timeline, t: 1, maxLines: 3 });
    expect(s.total).toBe(5);
    expect(s.listed).toBe(3);
    // t1, t2, t3 carry flags; bg and card do not.
    expect(s.elements.map((e) => e.itemId)).toEqual(['t1', 't2', 't3']);
    expect(s.text.split('\n').at(-1)).toBe('… 2 more elements not listed — narrow with item=<itemId>');
    const tiny = summarizeLayout({ doc, timeline, t: 1, maxChars: 200 });
    expect(tiny.text.length).toBeLessThanOrEqual(200 + 80);
    expect(tiny.listed).toBeLessThan(5);
  });

  it('narrows to one item but keeps the flags computed against everything on screen', () => {
    const s = summarizeLayout({ doc, timeline, t: 1, itemId: 't2' });
    expect(s.total).toBe(1);
    expect(s.elements[0]?.flags).toContain('overlaps #2');
    expect(summarizeLayout({ doc, timeline, t: 1, itemId: 'nope' }).text).toContain('item "nope" is not drawn at this time');
  });

  it('is the same text for the same document, time and probe', () => {
    expect(summarizeLayout({ doc, timeline, t: 1 }).text).toBe(summarizeLayout({ doc, timeline: resolveTimeline(doc), t: 1 }).text);
  });
});

describe('§5.13 (G) layout summary — one element with hundreds of overlaps', () => {
  const same = { x: 200, y: 100, width: 800, height: 200 };
  const many = docWith(Array.from({ length: 700 }, (_, i) => text(`t${i + 1}`, `Word ${i + 1}`, same)));
  const timeline = resolveTimeline(many);

  it('keeps each line short so some elements are still listed, with the rest of the overlaps counted', () => {
    const s = summarizeLayout({ doc: many, timeline, t: 1 });
    expect(s.listed).toBeGreaterThan(0);
    expect(s.text.length).toBeLessThanOrEqual(8_000 + 80); // 끝의 "… n more" 줄 몫
    const line = s.text.split('\n').find((l) => l.startsWith('#1 '));
    expect(line).toContain('overlaps #2, overlaps #3');
    expect(line).toContain('+693 more overlaps');
    expect(s.flags.overlap).toBe(700);
  });

  it('lists the narrowed element, in text and in the JSON elements', () => {
    const s = summarizeLayout({ doc: many, timeline, t: 1, itemId: 't5' });
    expect(s.total).toBe(1);
    expect(s.listed).toBe(1);
    expect(s.text).toContain('#5 text "t5"');
    expect(s.text).not.toContain('not listed');
    const flags = s.elements[0]?.flags ?? [];
    expect(flags.length).toBeLessThanOrEqual(7);
    expect(flags).toContain('+693 more overlaps');
  });
});
