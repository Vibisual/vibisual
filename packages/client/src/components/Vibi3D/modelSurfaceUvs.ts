import * as THREE from 'three';
import { creationIntentId } from '../Creation/creationApi.js';

/** One complete image per projected face; surface maps continue using independent metre-valued UVs. */
export function normalizedSurfaceUvs(source: THREE.BufferGeometry, channel: 2 | 3): THREE.BufferGeometry {
  const key = `vibi3dNormalizedUv${channel}`;
  if (source.userData[key]) return source;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.uuid = creationIntentId('surface-uv', source.uuid, channel);
  geometry.computeBoundingBox(); const bounds = geometry.boundingBox!;
  const span = bounds.getSize(new THREE.Vector3()), position = geometry.getAttribute('position');
  const values = new Float32Array(position.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index); b.fromBufferAttribute(position, index + 1); c.fromBufferAttribute(position, index + 2);
    normal.crossVectors(b.sub(a), c.sub(a));
    const axes: [number, number] = Math.abs(normal.x) >= Math.max(Math.abs(normal.y), Math.abs(normal.z)) ? [2, 1]
      : Math.abs(normal.y) >= Math.abs(normal.z) ? [0, 2] : [0, 1];
    for (let vertex = index; vertex < index + 3; vertex++) {
      a.fromBufferAttribute(position, vertex).sub(bounds.min);
      values[vertex * 2] = a.getComponent(axes[0]) / Math.max(span.getComponent(axes[0]), 1e-9);
      values[vertex * 2 + 1] = a.getComponent(axes[1]) / Math.max(span.getComponent(axes[1]), 1e-9);
    }
  }
  geometry.setAttribute(`uv${channel}`, new THREE.BufferAttribute(values, 2)); geometry.userData[key] = true;
  return geometry;
}
