import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelEditor } from './modelEditor.js';
import { buildModelSign } from './modelSign.js';
import { prepareLocalGraphicTexture } from './modelLocalTexture.js';
import { modelTextureReferences, pinModelTexture } from './modelTextureReferences.js';
import { serializeModelSource } from './modelSource.js';

const api = vi.hoisted(() => ({ externalizeForSave: vi.fn() }));
vi.mock('../Creation/creationBlobs.js', () => api);
const ref = `vibi-blob:${'a'.repeat(64)}.png`, png = 'data:image/png;base64,iVBORw0KGgo=';
const image = { width: 3, height: 2 } as HTMLImageElement;
const drawImage = vi.fn(), toDataURL = vi.fn(() => png);
beforeEach(() => {
  api.externalizeForSave.mockReset().mockResolvedValue(ref); drawImage.mockClear(); toDataURL.mockClear();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL }) });
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  pinModelTexture(texture, { id: 'old-art', revision: 1 }, 'sign', 'map', 'old-link');
  const sign = buildModelSign({ kind: 'panel', lit: true, source: { kind: 'vibimage', docId: 'old-art' } }, 'sign', { sourceTexture: texture });
  const root = new THREE.Group(); root.add(sign); const editor = new ModelEditor(root);
  const target = sign.children.find(node => node.userData['vibi3dDecorationKey'] === 'artwork-front') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  return { root, sign, editor, target };
}

describe('local uploads on regenerable graphics', () => {
  it('bakes PNG through the existing blob store and replaces the old pin, recipe and emission in one undo step', async () => {
    const { root, sign, editor, target } = fixture(), prior = target.material.map, links = modelTextureReferences(root, []);
    const source = await prepareLocalGraphicTexture('project', root, target, image);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0); expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(api.externalizeForSave).toHaveBeenCalledWith('project', png, { stringMin: 0 });
    const next = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
    editor.applyTexture(editor.getId(target)!, next, 0, 'user-image.jpg', false, source);
    expect(target.material.map!.source).toBe(next.source); expect(target.material.emissiveMap).toBe(target.material.map);
    expect(target.material.userData['vibi3dMaterial'].maps.map.source).toEqual({ kind: 'blob', ref });
    expect(sign.userData['vibi3dSignRecipe'].source).toEqual({ kind: 'blob', ref });
    expect(modelTextureReferences(root, links)).toEqual([]);
    expect(JSON.stringify(serializeModelSource(root, []))).toContain(ref);
    const regenerated = buildModelSign({ ...sign.userData['vibi3dSignRecipe'], lit: false }, 'sign', { sourceTexture: next });
    expect(regenerated.userData['vibi3dSignRecipe'].source).toEqual({ kind: 'blob', ref });
    editor.undo(); expect(target.material.map).toBe(prior); expect(sign.userData['vibi3dSignRecipe'].source.docId).toBe('old-art');
    expect(modelTextureReferences(root, links)).toEqual(links); expect(editor.canUndo).toBe(false);
    editor.redo(); expect(target.material.map!.source).toBe(next.source); expect(modelTextureReferences(root, links)).toEqual([]);
  });

  it('leaves the current image and recipe intact when blob persistence fails or an intervening edit makes the upload stale', async () => {
    const { root, sign, editor, target } = fixture(), before = serializeModelSource(root, []);
    api.externalizeForSave.mockRejectedValueOnce(new Error('blob-upload-failed'));
    await expect(prepareLocalGraphicTexture('project', root, target, image)).rejects.toThrow('blob-upload-failed');
    expect(serializeModelSource(root, [])).toEqual(before); expect(editor.revision).toBe(0);
    const source = await prepareLocalGraphicTexture('project', root, target, image), oldMap = target.material.map;
    editor.apply({ type: 'update', id: 'sign', position: [2, 0, 0] }, 0);
    expect(() => editor.applyTexture(editor.getId(target)!, new THREE.Texture(), 0, 'upload.png', false, source)).toThrow('model-changed');
    expect(target.material.map).toBe(oldMap); expect(sign.userData['vibi3dSignRecipe'].source.docId).toBe('old-art');
  });

  it('keeps ordinary imported textures off the blob preparation path and rejects oversized graphic sources', async () => {
    const root = new THREE.Group(), mesh = new THREE.Mesh(); root.add(mesh);
    expect(await prepareLocalGraphicTexture('', root, mesh, image)).toBeUndefined(); expect(api.externalizeForSave).not.toHaveBeenCalled();
    const graphic = fixture();
    await expect(prepareLocalGraphicTexture('project', graphic.root, graphic.target, { width: 4097, height: 1 } as HTMLImageElement)).rejects.toThrow('source-too-large');
    expect(api.externalizeForSave).not.toHaveBeenCalled();
  });
});
