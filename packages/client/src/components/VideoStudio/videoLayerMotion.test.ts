import { describe, expect, it, vi } from 'vitest';
import type { DrawOp } from '@vibisual/video/render';
import { LAYER_MOTION_DEFAULT, layerPose, readLayerMotions } from './videoLayerMotion.js';
import { VideoMediaProvider } from './videoMediaProvider.js';

/**
 * §5.13 (R-10) §4 — a still editable image becomes a moving scene layer by layer. The motion lives on the video item
 * (`props.layerMotion`); the image source and its layers stay as they are.
 */
describe('per-layer motion of an editable image', () => {
  it('reads only valid motions: unknown presets and "none" are left out, broken numbers fall back, times are bounded', () => {
    const motions = readLayerMotions({ layerMotion: {
      title: { preset: 'rise', delay: 0.5, duration: 1 },
      logo: { preset: 'spin', delay: 0, duration: 1 },
      backdrop: { preset: 'none' },
      price: { preset: 'fade', delay: Number.NaN, duration: -3 },
      badge: { preset: 'zoom', delay: 10_000, duration: 2 },
    } });
    expect(Object.keys(motions).sort()).toEqual(['badge', 'price', 'title']);
    expect(motions['title']).toEqual({ preset: 'rise', delay: 0.5, duration: 1 });
    expect(motions['price']).toEqual({ preset: 'fade', delay: 0, duration: 0.05 });
    expect(motions['badge']!.delay).toBe(600);
    expect(readLayerMotions({ layerMotion: ['title'] })).toEqual({});
    expect(readLayerMotions(undefined)).toEqual({});
    expect(LAYER_MOTION_DEFAULT.preset).toBe('fade');
  });

  it('hides a layer until its delay, moves it in, and leaves it exactly where the image put it', () => {
    const rise = { preset: 'rise' as const, delay: 0.5, duration: 1 };
    expect(layerPose(rise, 0.2, 80).opacity).toBe(0);
    const middle = layerPose(rise, 1, 80);
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.dy).toBeGreaterThan(0);
    expect(layerPose(rise, 1.5, 80)).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
    expect(layerPose({ preset: 'slide-left', delay: 0, duration: 1 }, 0.2, 80).dx).toBeGreaterThan(0);
    expect(layerPose({ preset: 'slide-right', delay: 0, duration: 1 }, 0.2, 80).dx).toBeLessThan(0);
    expect(layerPose({ preset: 'zoom', delay: 0, duration: 1 }, 0.1, 80).scale).toBeLessThan(1);
    // A layer without motion stays as drawn.
    expect(layerPose(undefined, 0, 80)).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
  });

  it('a still without motion keeps the plain picture, and nothing is read for it', async () => {
    const open = vi.fn(async () => new Blob(['{}'], { type: 'application/json' }));
    const assets = { poster: { id: 'poster', kind: 'image' as const, source: { kind: 'file' as const, path: '.vibisual/video/assets/poster.vibimage' } } };
    const provider = new VideoMediaProvider({ assets, loader: { open } });
    const op = (props?: Record<string, unknown>) => ({ kind: 'image', localTime: 1, resolved: { item: { id: 'still', kind: 'image', assetId: 'poster', at: 0, duration: 5, ...(props ? { props } : {}) } } }) as unknown as DrawOp;
    expect(await provider.getItemFrame(op())).toBeNull();
    expect(await provider.getItemFrame(op({ layerMotion: { title: { preset: 'none' } } }))).toBeNull();
    expect(open).not.toHaveBeenCalled();
    provider.dispose();
  });

  it('the preview and the export both ask for the moving frame before the still picture', () => {
    const sources = import.meta.glob('../../../../video/src/render/{htmlStage,canvas2d}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(2);
    for (const source of Object.values(sources)) expect(source).toMatch(/getItemFrame\?\.\(op\)\)\s*\?\?\s*await this\.opts\.media\.getImage\(assetId\)/);
  });
});
