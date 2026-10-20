import { describe, expect, it } from 'vitest';
import { createEmptyDoc, hitTest, resolveTimeline, type VideoDoc } from '@vibisual/video';
import { pickMediaElement } from '@vibisual/video/render';
import { newImageDocument, newImageLayer } from '../Creation/imageSource.js';
import { buildStudioAgentContext } from './studioAgentMessage.js';
import { asksInside, pointedFromPick } from './usePreviewInteraction.js';
import { VideoMediaProvider } from './videoMediaProvider.js';

/** §5.13 (R-10) item 4 — a Vibimage layer chosen in the video preview reaches the agent's context. */
function fixture(): { doc: VideoDoc; provider: VideoMediaProvider } {
  const image = newImageDocument();
  image.layers = [
    { ...newImageLayer(image, 'shape', 'Backdrop'), id: 'backdrop', x: 0, y: 0, width: 1080, height: 1080 },
    { ...newImageLayer(image, 'text', 'Title'), id: 'title', text: 'Summer sale', x: 100, y: 100, width: 500, height: 200, fontSize: 80 },
  ];
  const doc: VideoDoc = {
    ...createEmptyDoc('promo', 'Promo'), size: { width: 1080, height: 1080 },
    assets: { poster: { id: 'poster', kind: 'image', source: { kind: 'file', path: '.vibisual/video/assets/poster.vibimage' }, creationSource: { id: 'poster-src', revision: 4, appId: 'vibimage' } } },
    tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'still', kind: 'image', assetId: 'poster', at: 0, duration: 5 }] }],
  };
  const provider = new VideoMediaProvider({ assets: doc.assets, loader: { open: async () => new Blob([JSON.stringify(image)], { type: 'application/json' }) } });
  return { doc, provider };
}

describe('(4) choosing an editable image layer in a video', () => {
  it('asks the image adapter on both previews (canvas and stage), not only for models', () => {
    expect(asksInside('image', 'canvas')).toBe(true);
    expect(asksInside('image', 'stage')).toBe(true);
    expect(asksInside('model', 'canvas')).toBe(true);
  });

  it('picks the top layer under the point and hands id, box, properties and source revision to the agent message', async () => {
    const { doc, provider } = fixture();
    const timeline = resolveTimeline(doc);
    const hit = hitTest(doc, timeline, 1, 300, 200)!;
    expect(hit.op.kind).toBe('image');
    const element = await pickMediaElement(provider, hit.op, 300, 200);
    expect(element).toMatchObject({ objectId: 'title', adapter: 'vibimage', path: 'layer:title' });
    expect(element!.rect).toMatchObject({ x: 100, y: 100, width: 500, height: 200 });
    expect(element!.properties).toMatchObject({ id: 'title', kind: 'text', text: 'Summer sale' });
    const pointed = pointedFromPick(doc, hit, { op: hit.op, element: element!, rect: element!.rect }, 1);
    expect(pointed).toMatchObject({ itemId: 'still', objectId: 'title', adapter: 'vibimage', source: { id: 'poster-src', revision: 4, appId: 'vibimage' } });
    const context = buildStudioAgentContext({
      projectName: 'demo', doc: { id: 'promo', title: 'Promo', version: 1 }, playhead: 1, duration: 5, passId: 'pass-1', mode: 'revise', pointed: [pointed],
    });
    expect(context).toContain('object id "title", adapter vibimage');
    expect(context).toContain('editable source poster-src revision 4 (vibimage)');
    expect(context).toContain('"text":"Summer sale"');
    provider.dispose();
  });

  it('falls back to the background layer outside the title, and to nothing outside the picture', async () => {
    const { doc, provider } = fixture();
    const timeline = resolveTimeline(doc);
    const hit = hitTest(doc, timeline, 1, 900, 900)!;
    expect((await pickMediaElement(provider, hit.op, 900, 900))?.objectId).toBe('backdrop');
    provider.dispose();
  });
});
