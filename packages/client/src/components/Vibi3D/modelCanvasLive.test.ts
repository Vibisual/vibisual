import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadLiveModelSource } from './modelCanvasLive.js';

describe('editable source preview loading', () => {
  it('distinguishes a valid empty starting document from unreadable geometry', async () => {
    const empty = { format: 'vibi3d', version: 1, scene: new THREE.Group().toJSON(), clips: [] };
    const loaded = await loadLiveModelSource('project', empty, 'New model');
    expect(loaded).toMatchObject({ ok: true, model: { empty: true, radius: 1 } });
    if (loaded.ok) {
      expect(loaded.model.center.toArray()).toEqual([0, 0, 0]);
      loaded.model.dispose();
    }
    expect(await loadLiveModelSource('project', {}, 'Bad source')).toEqual({ ok: false, reason: 'failed' });
  });
  it('frames the actual source geometry and stable part metadata without needing a GLB', async () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), new THREE.MeshStandardMaterial());
    mesh.userData['vibi3dId'] = 'body'; mesh.position.set(3, 0, 0); root.add(mesh); root.updateMatrixWorld(true);
    const loaded = await loadLiveModelSource('project', { format: 'vibi3d', version: 1, scene: root.toJSON(), clips: [] }, 'Case');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.model.center.x).toBe(3);
      expect(loaded.model.radius).toBe(2);
      expect(loaded.model.object.children[0]!.userData['vibi3dId']).toBe('body');
      loaded.model.dispose();
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
