import * as THREE from 'three';
import { creationIntentId } from '../Creation/creationApi.js';
import { normalizedSurfaceUvs } from './modelSurfaceUvs.js';
import { refreshModelSurfaceWear } from './modelSurfaceWear.js';

interface MetricProjection { axes: [number, number]; offset: [number, number] }
function metricProjection(geometry: THREE.BufferGeometry): MetricProjection | undefined {
  const value = geometry.userData['vibi3dMetricUvProjection'];
  if (!value || typeof value !== 'object' || !Array.isArray(value.axes) || value.axes.length !== 2
    || !value.axes.every((axis: unknown) => Number.isInteger(axis) && Number(axis) >= 0 && Number(axis) <= 2) || value.axes[0] === value.axes[1]
    || !Array.isArray(value.offset) || value.offset.length !== 2 || !value.offset.every((offset: unknown) => typeof offset === 'number' && Number.isFinite(offset))) return undefined;
  return { axes: [value.axes[0], value.axes[1]], offset: [value.offset[0], value.offset[1]] };
}

/** Meter-valued planar UVs per triangle; a texture repeat divides these by its tile dimensions. */
export function metricUvGeometry(source: THREE.BufferGeometry, scale: THREE.Vector3): THREE.BufferGeometry {
  // Parameterized geometry serializers regenerate their original UVs; store the actual meter-valued buffers instead.
  const geometry = source.index ? source.toNonIndexed() : new THREE.BufferGeometry().copy(source);
  const projection = metricProjection(source);
  geometry.uuid = projection ? creationIntentId('metric-uv', source.uuid, scale.toArray(), projection) : creationIntentId('metric-uv', source.uuid, scale.toArray());
  const positions = geometry.getAttribute('position'); const values = new Float32Array(positions.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 3) {
    a.fromBufferAttribute(positions, index); b.fromBufferAttribute(positions, index + 1); c.fromBufferAttribute(positions, index + 2);
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const axes: [number, number] = projection?.axes ?? (Math.abs(normal.x) >= Math.max(Math.abs(normal.y), Math.abs(normal.z)) ? [2, 1]
      : Math.abs(normal.y) >= Math.abs(normal.z) ? [0, 2] : [0, 1]);
    for (let vertex = index; vertex < Math.min(index + 3, positions.count); vertex++) {
      a.fromBufferAttribute(positions, vertex).multiply(scale);
      values[vertex * 2] = a.getComponent(axes[0]) + (projection?.offset[0] ?? 0) * scale.getComponent(axes[0]);
      values[vertex * 2 + 1] = a.getComponent(axes[1]) + (projection?.offset[1] ?? 0) * scale.getComponent(axes[1]);
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(values, 2));
  geometry.setAttribute('uv1', new THREE.BufferAttribute(values.slice(), 2));
  geometry.userData['vibi3dMetricUvScale'] = scale.toArray();
  return geometry;
}

/** Geometry is replaced, never edited in place, so shared meshes and undo snapshots retain their UVs. */
export function refreshModelMetricUvs(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object.morphTargetInfluences?.length) return;
    if (object.userData['vibi3dUvMode'] === 'image') return;
    // Instanced buckets need each placement's world scale; refreshModelKit owns those UVs and frozen prototypes.
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData['vibi3dKitLibrary'] || node.userData['vibi3dKitBucket']) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(material => material.userData['vibi3dMaterial']?.tileSize)) return;
    const scale = object.getWorldScale(new THREE.Vector3()); scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    if (JSON.stringify(object.geometry.userData['vibi3dMetricUvScale']) !== JSON.stringify(scale.toArray())) object.geometry = metricUvGeometry(object.geometry, scale);
    if (materials.some(material => (material as THREE.MeshStandardMaterial).map?.userData['vibi3dInteriorMap'])) object.geometry = normalizedSurfaceUvs(object.geometry, 2);
    refreshModelSurfaceWear(object, scale);
  });
}
