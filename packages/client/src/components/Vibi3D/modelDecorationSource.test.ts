import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { loadModelSource, serializeModelSource } from './modelSource.js';

const ref = `vibi-blob:${'a'.repeat(64)}.png`;
vi.mock('../Creation/creationBlobs.js', () => ({ resolveCreationBlobs: vi.fn(async (_project, payload) =>
  JSON.parse(JSON.stringify(payload).replaceAll(/vibi-blob:[a-f0-9]{64}\.png/g, 'data:image/png;base64,AAAA'))) }));

describe('decoration metadata during blob hydration', () => {
  it('restores immutable authoring references while image bytes are hydrated', async () => {
    const root = new THREE.Group();
    for (const key of ['vibi3dSignRecipe', 'vibi3dDecalRecipe', 'vibi3dMascotRecipe']) {
      const node = new THREE.Group(); node.name = key; node.userData[key] = { source: { kind: 'blob', ref } }; root.add(node);
    }
    const payload = serializeModelSource(root, []), loaded = await loadModelSource(payload, 'decorations', 'project');
    for (const node of loaded.object.children) expect(node.userData[node.name].source).toEqual({ kind: 'blob', ref });
    const reopened = serializeModelSource(loaded.object, [], payload);
    expect(JSON.stringify(reopened)).toContain(ref);
    expect(JSON.stringify(reopened)).not.toContain('data:image/png;base64,AAAA');
  });
});
