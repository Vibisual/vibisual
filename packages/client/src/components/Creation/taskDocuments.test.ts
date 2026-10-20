import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppTaskDocumentArgs } from '../../apps/registry.js';
const api = vi.hoisted(() => ({ readModel: vi.fn(), readImage: vi.fn(), create: vi.fn(), createImage: vi.fn(), load: vi.fn(), dispose: vi.fn() }));
vi.mock('./creationApi.js', () => ({ createCreationDoc: api.create }));
vi.mock('../Vibi3D/modelSource.js', () => ({ readModelDocument: api.readModel, serializeModelSource: () => ({ format: 'vibi3d', scene: { object: { children: [] } } }) }));
vi.mock('../Vibi3D/modelIO.js', () => ({ loadWorkspaceModel: api.load, disposeModel: api.dispose }));
vi.mock('../Vibimage/imageApi.js', () => ({ readImageDoc: api.readImage, createImageDoc: api.createImage, imagePayloadValue: (value: unknown) => JSON.parse(JSON.stringify(value)) }));
import { prepareModelTaskDocument } from '../Vibi3D/modelTaskDocument.js';
import { prepareImageTaskDocument } from '../Vibimage/imageTaskDocument.js';

const args: AppTaskDocumentArgs = { projectId: 'C:/project', projectName: 'Project', mode: 'copy', source: { ref: 'original', file: 'older.glb' }, title: 'Variant', requestId: 'retry' };
const source = { appId: 'vibi3d', id: 'original', title: 'Original', revision: 8, parameters: { dimensions: [4, 5] },
  payload: { format: 'vibi3d', generatorCode: 'build()', authoring: { tool: 'native' } }, lockedPaths: ['/scene/object'], links: [] };
beforeEach(() => {
  vi.clearAllMocks(); api.create.mockResolvedValue({ id: 'new' }); api.createImage.mockResolvedValue({ id: 'new-image' });
  api.readModel.mockResolvedValue(source); api.readImage.mockResolvedValue({ ...source, appId: 'vibimage' });
});

describe('task source identity', () => {
  it('copies the authoritative model document and its generator metadata without reading an older export', async () => {
    expect(await prepareModelTaskDocument(args)).toEqual({ ref: 'new' });
    expect(api.readModel).toHaveBeenCalledWith('C:/project', 'original'); expect(api.load).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledWith('C:/project', expect.objectContaining({ title: 'Variant', payload: source.payload, lockedPaths: source.lockedPaths, requestId: 'retry' }));
  });
  it.each([['model', prepareModelTaskDocument, api.readModel], ['image', prepareImageTaskDocument, api.readImage]] as const)(
    'does not replace a missing %s source with a blank copy', async (_name, build, read) => {
      read.mockRejectedValue(new Error('Unavailable'));
      await expect(build(args)).rejects.toThrow('Unavailable'); expect(api.create).not.toHaveBeenCalled(); expect(api.createImage).not.toHaveBeenCalled();
    },
  );
  it('creates a blank model without consuming or clearing the old scene', async () => {
    expect(await prepareModelTaskDocument({ ...args, mode: 'new' })).toEqual({ ref: 'new' });
    expect(api.readModel).not.toHaveBeenCalled(); expect(api.load).not.toHaveBeenCalled(); expect(api.dispose).toHaveBeenCalledOnce();
    expect(api.create).toHaveBeenCalledWith('C:/project', expect.objectContaining({ payload: { format: 'vibi3d', scene: { object: { children: [] } } } }));
  });
  it('creates a blank image without importing the old picture', async () => {
    expect(await prepareImageTaskDocument({ ...args, mode: 'new' })).toEqual({ ref: 'new-image' });
    expect(api.readImage).not.toHaveBeenCalled(); expect(api.createImage).toHaveBeenCalledWith('C:/project', 'Variant', expect.objectContaining({ layers: [] }), { requestId: 'retry' });
  });
});
