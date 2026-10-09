import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { Canvas2DBackend } from './canvas2d.js';
import { BUILTIN_SCENES } from './scenes.js';

/** Only the canvas methods used by the renderer; record alpha at actual paint calls. */
async function paintAlphas(sceneId: string, opacity: number, fadeIn: number, fadeOut: number, time: number): Promise<number[]> {
  const alphas: number[] = [];
  const stack: number[] = [];
  const context = {
    globalAlpha: 1,
    save(): void { stack.push(this.globalAlpha); },
    restore(): void { this.globalAlpha = stack.pop() ?? 1; },
    fill(): void { alphas.push(this.globalAlpha); },
    stroke(): void { alphas.push(this.globalAlpha); },
    fillText(): void { alphas.push(this.globalAlpha); },
    fillRect(): void { alphas.push(this.globalAlpha); },
    measureText(text: string): { width: number } { return { width: text.length * 12 }; },
    clearRect(): void {}, translate(): void {}, beginPath(): void {}, roundRect(): void {}, rect(): void {}, arc(): void {},
  };
  const doc = {
    ...createEmptyDoc('render-test', 'Alpha'),
    tracks: [{ id: 'v', kind: 'visual' as const, items: [{
      id: 'scene', kind: 'scene' as const, sceneId, at: 0, duration: 4,
      transform: { opacity },
      props: { title: 'Title', subtitle: 'Subtitle', name: 'Name', role: 'Role', heading: 'Heading', items: ['One', 'Two'], lines: ['one', 'two', 'three'], text: 'Quote', by: 'Author', fadeIn, fadeOut },
    }] }],
  };
  // Fake canvas is confined to the test; production uses the browser context.
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const backend = new Canvas2DBackend({ doc, timeline: resolveTimeline(doc), scenes: BUILTIN_SCENES,
    media: { getImage: async () => null, getFrame: async () => null }, createCanvas: () => canvas,
  });
  await backend.init(doc.size);
  await backend.drawFrame(time);
  backend.dispose();
  return alphas.slice(1); // The first paint is the composition's independent black background.
}

describe.each(Object.keys(BUILTIN_SCENES))('builtin scene %s alpha', (sceneId) => {
  it.each([
    { time: 0.7, fadeIn: 0, fadeOut: 0, factor: 0.5 },
    { time: 0.7, fadeIn: 2, fadeOut: 0, factor: 0.175 },
    { time: 3.75, fadeIn: 0, fadeOut: 0.5, factor: 0.25 },
  ])('preserves opacity and clip fade for every element (%j)', async ({ time, fadeIn, fadeOut, factor }) => {
    const baseline = await paintAlphas(sceneId, 1, 0, 0, time);
    const faded = await paintAlphas(sceneId, 0.5, fadeIn, fadeOut, time);
    expect(baseline.length).toBeGreaterThan(0);
    expect(faded).toHaveLength(baseline.length);
    faded.forEach((alpha, index) => expect(alpha).toBeCloseTo(baseline[index]! * factor));
  });
});
