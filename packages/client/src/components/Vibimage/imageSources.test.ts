import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationDoc, CreationLink } from '@vibisual/shared';
import type { CreationCommitInput } from '../Creation/creationApi.js';
import { IMAGE_LINK_ROLE, addLinkedImage, imageLayerOrigin, updateLinkedImage } from './imageSources.js';
import { newImageDocument, newImageLayer } from './imageDocument.js';
import type { ImageSourceDoc } from './imageApi.js';
const api = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn(), still: vi.fn(), raster: vi.fn() }));
vi.mock('../Creation/creationApi.js', async (original) => ({ ...await original<object>(), readCreationRevision: api.read }));
vi.mock('./imageApi.js', async (original) => ({ ...await original<object>(), commitImageDoc: api.commit }));
vi.mock('../Creation/imageRender.js', () => ({ blobDataUrl: async (blob: Blob) => `data:image/png;base64,${await blob.text()}`, renderImageBlob: api.raster }));
vi.mock('../Creation/modelScene.js', () => ({ renderModelSourceStill: api.still }));
let target: ImageSourceDoc; let model: CreationDoc; let link: CreationLink;
beforeEach(() => {
  vi.clearAllMocks();
  const payload = newImageDocument();
  payload.layers = [{ ...newImageLayer(payload, 'image', 'Product'), id: 'product', source: 'data:image/png;base64,b2xk', x: 20, y: 40, width: 900, height: 850 },
    { ...newImageLayer(payload, 'text', 'Price'), id: 'price', text: '$39' }];
  link = { id: 'product-link', sourceId: 'model', sourceRevision: 1, role: IMAGE_LINK_ROLE.model, targets: ['product'] };
  target = { schemaVersion: 1, id: 'poster', appId: 'vibimage', title: 'Poster', revision: 2, payload, parameters: {}, lockedPaths: [],
    links: [link], createdAt: 1, updatedAt: 2, label: '', author: 'user' };
  model = { ...target, id: 'model', appId: 'vibi3d', title: 'Perfume', revision: 3, links: [], payload: { format: 'vibi3d', scene: {}, clips: [] } };
  api.read.mockResolvedValue(model);
  api.still.mockResolvedValue(new Blob(['bmV3'], { type: 'image/png' }));
  api.commit.mockImplementation(async (_root: string, doc: ImageSourceDoc, body: CreationCommitInput) => ({ ...doc, ...body, revision: doc.revision + 1 }));
});
describe('linked model product image', () => {
  it('renders the shared model adapter, pins the source revision and marks the layer as a 3D render (not an imported photo)', async () => {
    const result = await addLinkedImage('/project', target, { id: 'model', revision: 3 });
    expect(api.read).toHaveBeenCalledWith('/project', 'model', 3);
    expect(api.still).toHaveBeenCalledWith('/project', model.payload, 952, 952);
    expect(result.payload.layers.slice(0, 2)).toEqual(target.payload.layers);
    const added = result.links.at(-1)!;
    expect(added).toMatchObject({ sourceId: 'model', sourceRevision: 3, role: 'model-render' });
    expect(added).not.toHaveProperty('policy');
    expect(imageLayerOrigin(result.links, added.targets[0]!)).toBe('model-render');
    expect(imageLayerOrigin(result.links, 'price')).toBe('import');
    expect(api.commit.mock.calls[0]![1].revision).toBe(2);
  });
  it('selectively updates linked pixels from an immutable revision without changing placement or unrelated text', async () => {
    const result = await updateLinkedImage('/project', target, link, 3);
    expect(api.read).toHaveBeenCalledWith('/project', 'model', 3);
    expect(result!.payload.layers[0]).toEqual({ ...target.payload.layers[0], source: 'data:image/png;base64,bmV3' });
    expect(result!.payload.layers[1]).toEqual(target.payload.layers[1]);
    expect(result!.links[0]?.sourceRevision).toBe(3); expect(target.links[0]?.sourceRevision).toBe(1);
  });
  it('leaves a role it cannot redraw to the shared fallback (null)', async () => {
    expect(await updateLinkedImage('/project', target, { ...link, role: 'video-clip' }, 3)).toBeNull();
    expect(api.commit).not.toHaveBeenCalled();
  });
  it('does not replace a pinned or protected image when rendering fails or its layer is locked', async () => {
    api.still.mockRejectedValueOnce(new Error('model-renderer-unavailable'));
    await expect(updateLinkedImage('/project', target, link, 3)).rejects.toThrow('model-renderer-unavailable');
    target.payload.layers[0]!.locked = true;
    await expect(updateLinkedImage('/project', target, link, 3)).rejects.toThrow('object-protected');
    expect(api.commit).not.toHaveBeenCalled(); expect(target.links[0]?.sourceRevision).toBe(1);
  });
});
