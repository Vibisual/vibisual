import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from './ops.js';
import { REQUEST_CHECK_FRAME_BUDGET, checkVideoRequirements, validVideoRequirements, videoBaseline } from './requestReview.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { VideoDoc } from './types.js';

const now = { yieldNow: async () => undefined };
function fixture(): VideoDoc {
  return {
    ...createEmptyDoc('review', 'Product'),
    tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 'bg', kind: 'shape', at: 0, duration: 10 }, { id: 'price', kind: 'text', at: 7, duration: 3, props: { text: '$29' } }] }],
    requirements: [{ id: 'price', kind: 'ending-text', text: '$29', lastSeconds: 3 }],
  };
}
const check = (doc: VideoDoc, options: Parameters<typeof checkVideoRequirements>[2] = now) => checkVideoRequirements(doc, resolveTimeline(doc), { ...now, ...options });

describe('request checks distinguish evidence', () => {
  it('checks native text at every final output frame, including a missing single frame', async () => {
    const doc = fixture();
    expect((await check(doc))[0]?.status).toBe('passed');
    const bad = { ...doc, tracks: doc.tracks.map(track => ({ ...track, items: track.items.map(item => item.id === 'price' ? { ...item, at: 7 + 1 / doc.fps, duration: 3 - 1 / doc.fps } : item) })) };
    expect((await check(bad))[0]).toMatchObject({ status: 'failed', at: 7, reason: 'text-missing' });
  });
  it('does not mistake hidden native text or a visual judgement without current evidence for success', async () => {
    const doc = fixture();
    const hidden = { ...doc, tracks: doc.tracks.map(track => ({ ...track, hidden: true })) };
    expect((await check(hidden))[0]?.status).toBe('failed');
    const visual: VideoDoc = { ...doc, requirements: [{ id: 'shape', kind: 'visual', description: 'Same product', evidence: { framePath: 'checks/frame.png', at: 0, docVersion: doc.version - 1, verdict: 'passed', note: 'Inspected cap and body.' } }] };
    expect((await check(visual))[0]).toMatchObject({ status: 'unverified', evidence: 'checks/frame.png', reason: 'stale-evidence' });
  });
  it('a visual verdict counts only with a frame file that really exists', async () => {
    const doc = fixture();
    const visual: VideoDoc = { ...doc, requirements: [{ id: 'shape', kind: 'visual', description: 'Same product', evidence: { framePath: 'checks/frame.png', at: 2, docVersion: doc.version, verdict: 'passed', note: 'Cap and body match.' } }] };
    expect((await check(visual, { frameExists: () => false }))[0]).toMatchObject({ status: 'unverified', reason: 'frame-missing' });
    expect((await check(visual, { frameExists: async (path) => path === 'checks/frame.png' }))[0]).toMatchObject({ status: 'passed', at: 2 });
    expect((await check(visual, {}))[0]?.status).toBe('unverified');
  });
  it('verifies a pinned source version AND that a visible item really uses it', async () => {
    const base: VideoDoc = { ...fixture(), assets: { model: { id: 'model', kind: 'model', source: { kind: 'file', path: 'p.vibi3d' }, creationSource: { id: 'product', revision: 2, appId: 'vibi3d' } } } };
    const pin = (revision: number): VideoDoc => ({ ...base, requirements: [{ id: 'pin', kind: 'source-revision', assetId: 'model', sourceId: 'product', revision }] });
    expect((await check(pin(1)))[0]).toMatchObject({ status: 'failed', reason: 'pinned-revision-differs' });
    // The right revision on an asset nobody draws used to pass.
    expect((await check(pin(2)))[0]).toMatchObject({ status: 'failed', reason: 'not-used' });
    const used = pin(2);
    const withItem: VideoDoc = { ...used, tracks: [...used.tracks, { id: 'm', kind: 'visual', items: [{ id: 'bottle', kind: 'model', assetId: 'model', at: 0, duration: 4 }] }] };
    expect((await check(withItem))[0]?.status).toBe('passed');
    const disabled: VideoDoc = { ...withItem, tracks: withItem.tracks.map(track => ({ ...track, items: track.items.map(item => item.id === 'bottle' ? { ...item, enabled: false } : item) })) };
    expect((await check(disabled))[0]).toMatchObject({ status: 'failed', reason: 'not-used' });
    expect(validVideoRequirements(pin(1).requirements)).toBe(true);
    expect(validVideoRequirements([{ id: 'bad', kind: 'ending-text', text: 'x', lastSeconds: NaN }])).toBe(false);
    expect(validVideoRequirements([pin(1).requirements![0], pin(1).requirements![0]])).toBe(false);
  });
  it('text that a scene or composition draws is "cannot verify", never a silent fail or pass', async () => {
    const doc: VideoDoc = {
      ...fixture(),
      tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 'title', kind: 'scene', sceneId: 'title', at: 0, duration: 10, props: { title: '$29' } }] }],
    };
    expect((await check(doc))[0]).toMatchObject({ status: 'unverified', reason: 'scene-text' });
  });
  it('all text checks share one 20,000-frame budget (a total, not per check)', async () => {
    const doc = fixture();
    const many: VideoDoc = { ...doc, requirements: Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, kind: 'ending-text' as const, text: '$29', lastSeconds: 3 })) };
    const frames = Math.ceil(3 * doc.fps);
    const results = await check(many, { budget: frames * 2 });
    expect(results.map(result => result.status)).toEqual(['passed', 'passed', 'unverified']);
    expect(results[2]).toMatchObject({ reason: 'frame-budget' });
    expect(REQUEST_CHECK_FRAME_BUDGET).toBe(20_000);
  });
  it('yields to the event loop while sampling and can be stopped', async () => {
    const doc = fixture();
    const long: VideoDoc = { ...doc, tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 'price', kind: 'text', at: 0, duration: 300, props: { text: '$29' } }] }], requirements: [{ id: 'all', kind: 'ending-text', text: '$29', lastSeconds: 300 }] };
    let yields = 0;
    await checkVideoRequirements(long, resolveTimeline(long), { yieldNow: async () => { yields += 1; } });
    expect(yields).toBeGreaterThan(10);
    const controller = new AbortController();
    const running = checkVideoRequirements(long, resolveTimeline(long), { signal: controller.signal, yieldNow: async () => { controller.abort(); } });
    await expect(running).rejects.toBeDefined();
  });
  it('"only the selection changed" and "kept as it is" compare with the recorded base', async () => {
    const doc = fixture();
    const only: VideoDoc = { ...doc, requirements: [{ id: 'only', kind: 'selected-only', itemIds: ['price'], base: videoBaseline(doc) }, { id: 'keep', kind: 'preserved', itemIds: ['bg'], base: videoBaseline(doc, ['bg']) }] };
    expect((await check(only)).map(result => result.status)).toEqual(['passed', 'passed']);
    const priceEdited: VideoDoc = { ...only, tracks: only.tracks.map(track => ({ ...track, items: track.items.map(item => item.id === 'price' ? { ...item, props: { text: '$19' } } : item) })) };
    expect((await check(priceEdited)).map(result => result.status)).toEqual(['passed', 'passed']);
    const bgMoved: VideoDoc = { ...only, tracks: only.tracks.map(track => ({ ...track, items: track.items.map(item => item.id === 'bg' ? { ...item, at: 1 } : item) })) };
    const results = await check(bgMoved);
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'other-items-changed' });
    expect(results[1]).toMatchObject({ status: 'failed', reason: 'items-changed' });
    const bgRemoved: VideoDoc = { ...only, tracks: only.tracks.map(track => ({ ...track, items: track.items.filter(item => item.id !== 'bg') })) };
    expect((await check(bgRemoved))[1]).toMatchObject({ status: 'failed', reason: 'items-missing' });
    expect(validVideoRequirements(only.requirements)).toBe(true);
    expect(validVideoRequirements([{ id: 'x', kind: 'preserved', itemIds: [], base: { version: 1, items: {} } }])).toBe(false);
  });
});
