import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CreationDoc, CreationLink, Vibi3DCommand } from '@vibisual/shared';
import { prepareMaterialSources, pinnedMaterialRevision } from './modelMaterialSources.js';
import { readTextureSource, renderTextureSource } from './modelImageLink.js';

vi.mock('./modelImageLink.js', () => ({ readTextureSource: vi.fn(), renderTextureSource: vi.fn() }));
const doc = { id: 'building', links: [], revision: 3 } as unknown as CreationDoc;
const link: CreationLink = { id: 'label-link', sourceId: 'label', sourceRevision: 2, role: 'model-texture', targets: ['wall'] };
const command = (sourceId: string): Vibi3DCommand => ({ type: 'material', id: 'wall', material: { maps: { map: { source: { kind: 'vibimage', docId: sourceId } } } } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readTextureSource).mockImplementation(async (_project, id, revision) => ({ id, revision: revision ?? 9 }) as CreationDoc);
  vi.mocked(renderTextureSource).mockImplementation(async () => ({ texture: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), hasAlpha: false }));
});
describe('agent material sources', () => {
  it('pins existing exact references and reuses known revisions for a new target', () => {
    expect(pinnedMaterialRevision([link], 'label', 'wall', 'map')).toBe(2);
    expect(pinnedMaterialRevision([link], 'label', 'new-wall', 'normalMap')).toBe(2);
    expect(pinnedMaterialRevision([link], 'new-label', 'wall', 'map')).toBeUndefined();
  });
  it('respects ancestor pins and refuses to collapse mixed child revisions', () => {
    const root = new THREE.Group(); const parent = new THREE.Group(); parent.userData['vibi3dId'] = 'facade'; root.add(parent);
    const child = new THREE.Group(); child.userData['vibi3dId'] = 'wall'; parent.add(child);
    const pins: CreationLink[] = [{ ...link, targets: ['facade'], sourceRevision: 1 }, { ...link, id: 'newer', targets: ['elsewhere'], sourceRevision: 2 }];
    expect(pinnedMaterialRevision(pins, 'label', 'wall', 'map', root)).toBe(1);
    pins[1]!.targets = ['wall'];
    expect(() => pinnedMaterialRevision(pins, 'label', 'facade', 'map', root)).toThrow('user-decision-required');
  });
  it('resolves batch slots separately and shares only immutable source pixels', async () => {
    const prepared = await prepareMaterialSources('project', doc, [command('label'), command('other'), command('label')], 'run-command', [link]);
    expect(vi.mocked(readTextureSource).mock.calls).toEqual([['project', 'label', 2], ['project', 'other', undefined]]);
    expect(prepared.materialMaps[0]!.map!.userData['vibi3dSource']).toMatchObject({ docId: 'label', revision: 2, linkId: 'label-link' });
    expect(prepared.materialMaps[1]!.map!.userData['vibi3dSource']).toMatchObject({ docId: 'other', revision: 9 });
    expect(prepared.materialMaps[0]!.map).not.toBe(prepared.materialMaps[2]!.map);
    expect(prepared.materialMaps[0]!.map!.source).toBe(prepared.materialMaps[2]!.map!.source);
    prepared.dispose();
  });
  it('assigns a stable id to an externally textured create without mutating its request', async () => {
    const input: Vibi3DCommand[] = [{ type: 'create', name: 'Wall', recipe: { kind: 'plane' }, material: { maps: { normalMap: { source: { kind: 'vibimage', docId: 'label' } } } } }];
    const first = await prepareMaterialSources('project', doc, input, 'command-a');
    const retry = await prepareMaterialSources('project', doc, input, 'command-a');
    expect(first.commands).toEqual(retry.commands);
    expect(first.commands[0]).toHaveProperty('id'); expect(input[0]).not.toHaveProperty('id');
    first.dispose(); retry.dispose();
  });
  it('releases all prepared textures if a later source fails', async () => {
    const texture = new THREE.DataTexture(); const released = vi.fn(); texture.addEventListener('dispose', released);
    vi.mocked(renderTextureSource).mockResolvedValue({ texture, hasAlpha: false });
    vi.mocked(readTextureSource).mockResolvedValueOnce({ id: 'label', revision: 2 } as CreationDoc).mockRejectedValueOnce(new Error('source missing'));
    await expect(prepareMaterialSources('project', doc, [command('label'), command('missing')], 'command-a')).rejects.toThrow('source missing');
    expect(released).toHaveBeenCalledOnce();
  });
});
