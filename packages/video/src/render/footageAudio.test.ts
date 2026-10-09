import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem } from '../types.js';
import { audioItemsAt } from './drawList.js';

function footage(id: string, extra: Partial<VideoItem> = {}): VideoItem {
  return { id, kind: 'footage', assetId: id, at: 2, duration: 3, trimStart: 1, props: { volume: 0.4, fadeIn: 0.2 }, ...extra };
}
describe('embedded footage audio', () => {
  it('mixes footage audio with audio tracks, including unmeasured legacy assets', () => {
    const doc: VideoDoc = { ...createEmptyDoc('test', 'Audio'),
      tracks: [
        { id: 'v', kind: 'visual', items: [footage('spoken'), footage('legacy'), footage('silent'), footage('off', { enabled: false }), footage('missing')] },
        { id: 'muted', kind: 'visual', muted: true, items: [footage('muted')] },
        { id: 'audio', kind: 'audio', items: [{ id: 'music', kind: 'audio', at: 0, duration: 8 }] },
      ],
      assets: Object.fromEntries([
        ['spoken', true], ['legacy', undefined], ['silent', false], ['off', true], ['muted', true],
      ].map(([id, hasAudio]) => [String(id), { id: String(id), kind: 'video' as const, source: { kind: 'file' as const, path: `${id}.mp4` }, ...(typeof hasAudio === 'boolean' ? { hasAudio } : {}) }])),
    };
    const selected = audioItemsAt(doc, resolveTimeline(doc));
    expect(selected.map(item => item.id)).toEqual(['music', 'spoken', 'legacy']);
    expect(selected.find(item => item.id === 'spoken')).toMatchObject({ start: 2, duration: 3, item: { trimStart: 1, props: { volume: 0.4, fadeIn: 0.2 } } });
  });

  it('hiding video pixels does not mute an otherwise audible clip', () => {
    const doc: VideoDoc = { ...createEmptyDoc('test', 'Audio'), tracks: [{ id: 'v', kind: 'visual', hidden: true, items: [footage('video')] }],
      assets: { video: { id: 'video', kind: 'video', source: { kind: 'file', path: 'video.mp4' }, hasAudio: true } },
    };
    expect(audioItemsAt(doc, resolveTimeline(doc)).map(item => item.id)).toEqual(['video']);
  });
});
