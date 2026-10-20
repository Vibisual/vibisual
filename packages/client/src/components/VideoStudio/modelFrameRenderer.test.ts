import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import type { DrawOp } from '@vibisual/video/render';
import { ModelFrameRenderer } from './videoModelFrames.js';
import type { VideoModelScene } from './videoModelScene.js';

/** §5.13 (R-10) item 5 — two models visible at the same time each get their own picture. */
interface FakeCanvas { width: number; height: number; painted: string[]; getContext: () => { drawImage: () => void } }
function setup() {
  let onScreen = '';
  const listeners: ((event: Event) => void)[] = [];
  let created = 0;
  const renderer = () => {
    created += 1;
    return {
      domElement: { addEventListener: (_: string, listener: (event: Event) => void) => listeners.push(listener) },
      setPixelRatio: vi.fn(), setClearColor: vi.fn(), setSize: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(), outputColorSpace: '',
    } as unknown as THREE.WebGLRenderer;
  };
  const canvases: FakeCanvas[] = [];
  const canvas = (width: number, height: number): FakeCanvas => {
    const out: FakeCanvas = { width, height, painted: [], getContext: () => ({ drawImage: () => { out.painted.push(onScreen); } }) };
    canvases.push(out);
    return out;
  };
  const frames = new ModelFrameRenderer(renderer, canvas as unknown as (w: number, h: number) => HTMLCanvasElement, () => undefined);
  const model = (name: string) => ({ renderOp: () => { onScreen = name; } }) as unknown as VideoModelScene;
  const op = { transform: { width: 320, height: 180 } } as unknown as DrawOp;
  return { frames, model, op, canvases, listeners, created: () => created };
}

describe('(5) model frames', () => {
  it('copies each render into its own canvas in the same step, so the first slot keeps the first model', async () => {
    const { frames, model, op } = setup();
    // The two slots of one frame ask at the same time (Promise.all in the stage and the canvas preview).
    const [first, second] = await Promise.all([Promise.resolve().then(() => frames.draw(model('bottle'), op)), Promise.resolve().then(() => frames.draw(model('cap'), op))]);
    expect(first).not.toBe(second);
    expect((first as unknown as FakeCanvas).painted).toEqual(['bottle']);
    expect((second as unknown as FakeCanvas).painted).toEqual(['cap']);
  });

  it('uses one renderer for every frame, and builds a new one after the GL context was lost', () => {
    const { frames, model, op, listeners, created } = setup();
    frames.draw(model('a'), op);
    frames.draw(model('b'), op);
    expect(created()).toBe(1);
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listeners[0]!(event);
    expect(event.preventDefault).toHaveBeenCalled();
    frames.draw(model('c'), op);
    expect(created()).toBe(2);
  });

  it('every preview and export path asks the provider for a finished frame, never for the shared renderer canvas', () => {
    const sources = import.meta.glob('../../../../video/src/render/{htmlStage,canvas2d}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(2);
    for (const source of Object.values(sources)) {
      expect(source).toContain('getModelFrame');
      expect(source).not.toMatch(/renderer\.domElement/);
    }
  });
});
