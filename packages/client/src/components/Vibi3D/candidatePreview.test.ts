import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CreationCandidateSummary } from '@vibisual/shared';
import { CandidatePreviewStage, PreviewModelCache, mergeCandidateSummaries, type PreviewRenderer } from './candidatePreview.js';
import type { LoadedModel } from './modelIO.js';

/** A renderer that only counts (the lifecycle is what is under test, not WebGL). */
function fakeRenderer(): PreviewRenderer & { renders: THREE.Object3D[][]; disposed: number } {
  const renderer = {
    renders: [] as THREE.Object3D[][], disposed: 0,
    render(scene: THREE.Scene) { renderer.renders.push(scene.children.filter((child) => !(child instanceof THREE.Light))); },
    dispose() { renderer.disposed += 1; },
  };
  return renderer;
}
function setup() {
  const parsed: string[] = [];
  const released: THREE.Object3D[] = [];
  const renderers: ReturnType<typeof fakeRenderer>[] = [];
  const cache = new PreviewModelCache(
    async (payload): Promise<LoadedModel> => {
      const name = String((payload as { name: string }).name);
      parsed.push(name);
      const object = new THREE.Group(); object.name = name;
      return { object, clips: [], fileName: name };
    },
    (model) => released.push(model.object),
    2,
  );
  const stage = new CandidatePreviewStage({ cache, width: 480, height: 270, createRenderer: () => { const r = fakeRenderer(); renderers.push(r); return r; } });
  return { cache, stage, parsed, released, renderers };
}

describe('candidate preview lifecycle', () => {
  it('supplies the currently shown model to the common renderer across before/after and context recovery', async () => {
    const cache = new PreviewModelCache(async (payload) => ({ object: Object.assign(new THREE.Group(), { name: String(payload) }), clips: [], fileName: 'model' }), () => undefined);
    const renderer = fakeRenderer(); const shown: string[] = [];
    const stage = new CandidatePreviewStage({ cache, width: 480, height: 270, createRenderer: () => renderer,
      renderView: (scene, target, camera, object) => { shown.push(object.name); target.render(scene, camera); },
    });
    await stage.show('before', () => 'Before');
    await stage.show('after', () => 'After');
    stage.contextRestored();
    expect(shown).toEqual(['Before', 'After', 'After']);
    expect(stage.rendererCount).toBe(1);
    stage.dispose();
  });
  it('(2) keeps one renderer while switching before/after and never parses a shown source twice', async () => {
    const { stage, parsed, renderers } = setup();
    expect(await stage.show('candidate:c@2', () => ({ name: 'after' }))).toBe(true);
    expect(await stage.show('doc:model@2', () => ({ name: 'before' }))).toBe(true);
    expect(await stage.show('candidate:c@2', () => ({ name: 'after-again' }))).toBe(true);
    expect(await stage.show('doc:model@2', () => ({ name: 'before-again' }))).toBe(true);
    expect(parsed).toEqual(['after', 'before']);
    expect(renderers).toHaveLength(1);
    expect(stage.rendererCount).toBe(1);
    // Exactly one source is in the scene at a time — the one last asked for.
    const frames = renderers[0]!.renders;
    expect(frames.every((frame) => frame.length === 1)).toBe(true);
    expect(frames.map((frame) => frame[0]!.name)).toEqual(['after', 'before', 'after', 'before']);
  });

  it('shows only the newest request when an older read finishes later', async () => {
    const { cache, renderers } = setup();
    let finishSlow!: (value: unknown) => void;
    const stage = new CandidatePreviewStage({ cache, width: 480, height: 270, createRenderer: () => { const r = fakeRenderer(); renderers.push(r); return r; } });
    const slow = stage.show('slow', () => new Promise((resolve) => { finishSlow = resolve; }));
    expect(await stage.show('fast', () => ({ name: 'fast' }))).toBe(true);
    finishSlow({ name: 'slow' });
    expect(await slow).toBe(false);
    expect(stage.current?.name).toBe('fast');
  });

  it('releases the renderer once and every parsed source (also one still parsing) when the review closes', async () => {
    const { stage, cache, released, renderers } = setup();
    await stage.show('a', () => ({ name: 'a' }));
    let finish: ((value: unknown) => void) | undefined;
    const pending = cache.get('b', () => new Promise((resolve) => { finish = resolve; }));
    stage.dispose();
    stage.dispose();
    expect(renderers[0]!.disposed).toBe(1);
    while (!finish) await Promise.resolve();
    finish({ name: 'b' });
    await pending;
    await Promise.resolve();
    expect(released.map((object) => object.name).sort()).toEqual(['a', 'b']);
    await expect(stage.show('c', () => ({ name: 'c' }))).rejects.toThrow();
  });

  it('keeps at most `limit` parsed sources and releases the least recently used', async () => {
    const { cache, released } = setup();
    await cache.get('a', () => ({ name: 'a' }));
    await cache.get('b', () => ({ name: 'b' }));
    await cache.get('a', () => ({ name: 'a' }));
    await cache.get('c', () => ({ name: 'c' }));
    await Promise.resolve();
    expect(released.map((object) => object.name)).toEqual(['b']);
    expect(cache.size).toBe(2);
  });

  it('a failed read can be tried again', async () => {
    const { cache, parsed } = setup();
    await expect(cache.get('x', () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await Promise.resolve();
    await cache.get('x', () => ({ name: 'x' }));
    expect(parsed).toEqual(['x']);
  });
});

describe('candidate polling', () => {
  const summary = (id: string, createdAt: number, extra: Partial<CreationCandidateSummary> = {}): CreationCandidateSummary => ({
    id, baseRevision: 2, label: id, input: '', createdAt, status: 'pending', ...extra,
  });
  it('(2) a poll with the same candidates returns the same list object (nothing re-renders or re-reads)', () => {
    const previous = [summary('a', 1), summary('b', 2)];
    const merged = mergeCandidateSummaries(previous, [summary('a', 1), summary('b', 2)]);
    expect(merged).toBe(previous);
  });
  it('keeps unchanged entries and takes only the changed one (by id and createdAt)', () => {
    const previous = [summary('a', 1), summary('b', 2)];
    const merged = mergeCandidateSummaries(previous, [summary('a', 1), summary('b', 5), summary('c', 6)]);
    expect(merged).not.toBe(previous);
    expect(merged[0]).toBe(previous[0]);
    expect(merged[1]).not.toBe(previous[1]);
    expect(merged[1]!.createdAt).toBe(5);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(mergeCandidateSummaries(previous, [summary('a', 1)])).toEqual([previous[0]]);
    expect(mergeCandidateSummaries(previous, [summary('a', 1, { baseRevision: 3 }), summary('b', 2)])[0]).not.toBe(previous[0]);
  });
});
