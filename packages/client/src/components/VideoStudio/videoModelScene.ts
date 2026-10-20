import type * as THREE from 'three';
import type { DrawOp, PickedElement } from '@vibisual/video/render';
import { ModelScene, parseModelAsset } from '../Creation/modelScene.js';
import type { renderStudioView } from '../Creation/studioLighting.js';
import { objectDocumentRect, objectLocalPoint } from './videoObjectCoordinates.js';

export { renderModelSourceStill } from '../Creation/modelScene.js';

/** The shared product renderer, addressed by Vibistudio draw ops (box transform, source time, item props). */
export class VideoModelScene extends ModelScene {
  seek(op: DrawOp): void {
    this.seekFrame(op.transform.width, op.transform.height, op.sourceTime, op.resolved.item.props ?? {});
  }
  renderOp(
    renderer: THREE.WebGLRenderer, op: DrawOp, width: number, height: number,
    environment?: (scene: THREE.Scene, renderer: THREE.WebGLRenderer, level: number) => void,
    renderView?: typeof renderStudioView,
  ): void {
    this.renderTo(renderer, width, height, op.sourceTime, op.resolved.item.props ?? {}, environment, renderView);
  }
  pick(op: DrawOp, x: number, y: number): PickedElement | null {
    const box = op.transform;
    const local = objectLocalPoint(box, x, y);
    const hit = this.pickAt(local.x, local.y, box.width, box.height);
    if (!hit) return null;
    return {
      path: `object:${hit.objectId}`, objectId: hit.objectId, adapter: 'vibi3d', tag: hit.tag, text: hit.text, prop: null,
      rect: objectDocumentRect(box, hit.rect), properties: hit.properties,
    };
  }
}

export async function loadVideoModel(bytes: ArrayBuffer, path: string, renderer?: THREE.WebGLRenderer): Promise<VideoModelScene> {
  const parts = await parseModelAsset(bytes, path, renderer);
  return new VideoModelScene(parts.object, parts.clips);
}
