import * as THREE from 'three';
import { buildVibi3DStatsWarnings, type Vibi3DStats } from '@vibisual/shared';
import { objectMaterials } from './modelAuthoring.js';
import { modelObjectVisible } from './modelBounds.js';

function internal(node: THREE.Object3D): boolean {
  for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) {
    if (parent.userData['vibi3dKitLibrary'] || parent.userData['vibi3dKitBucket']) return true;
  }
  return false;
}
function imageBytes(image: unknown, texture: THREE.Texture): number {
  if (Array.isArray(image)) return image.reduce((sum, face) => sum + imageBytes(face, texture), 0);
  if (!image || typeof image !== 'object') return 0;
  const source = image as { width?: number; height?: number; depth?: number; data?: ArrayBufferView };
  if (source.data && ArrayBuffer.isView(source.data)) return source.data.byteLength;
  const width = Number(source.width), height = Number(source.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 0;
  const channels = texture.format === THREE.RedFormat ? 1 : texture.format === THREE.RGFormat ? 2 : 4;
  const bytes = texture.type === THREE.FloatType || texture.type === THREE.UnsignedIntType || texture.type === THREE.IntType ? 4
    : texture.type === THREE.HalfFloatType || texture.type === THREE.UnsignedShortType || texture.type === THREE.ShortType ? 2 : 1;
  return width * height * Math.max(1, Number(source.depth) || 1) * channels * bytes;
}

/** Base scene draw calls and allocated texture bytes are estimates, not renderer.info texture counts. */
export function modelSceneStats(root: THREE.Object3D, sceneRevision: number): Vibi3DStats {
  let objects = 0, instances = 0, triangles = 0, drawCalls = 0, textureBytes = 0;
  const sources = new Set<string>();
  root.traverse(node => {
    if (node !== root && !internal(node)) {
      objects++;
      if (node.userData['vibi3dInstance']) instances++;
      else if (node instanceof THREE.InstancedMesh) instances += node.count;
    }
  });
  root.traverseVisible(node => {
    // Library prototypes are never uploaded; render buckets ARE rendered and count their instances.
    if (!modelObjectVisible(node)) return;
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry, count = node instanceof THREE.InstancedMesh ? node.count : 1;
    const total = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    const start = Math.max(0, geometry.drawRange.start), end = Math.min(total, start + geometry.drawRange.count);
    const materials = objectMaterials(node);
    const ranges = Array.isArray(node.material) ? geometry.groups : [{ start, count: end - start, materialIndex: 0 }];
    for (const range of ranges) {
      if (!materials[range.materialIndex ?? 0]?.visible || count === 0) continue;
      const rendered = Math.max(0, Math.min(end, range.start + range.count) - Math.max(start, range.start));
      if (rendered > 0) { drawCalls++; triangles += Math.floor(rendered / 3) * count; }
    }
    for (const material of materials) for (const value of Object.values(material)) {
      if (!(value instanceof THREE.Texture)) continue;
      // WebGLTextures shares the upload for one immutable Source and compatible sampling/storage settings.
      const key = [value.source.uuid, value.type, value.format, value.internalFormat, value.generateMipmaps, value.minFilter,
        value.magFilter, value.wrapS, value.wrapT, value.flipY, value.colorSpace].join(':');
      if (sources.has(key)) continue; sources.add(key);
      const mipmaps = value.mipmaps as Array<{ data?: ArrayBufferView }>;
      const compressed = (value as THREE.CompressedTexture).isCompressedTexture;
      const explicit = compressed && mipmaps?.length ? mipmaps.reduce((sum, level) => sum + (level.data?.byteLength ?? 0), 0) : 0;
      textureBytes += explicit || Math.ceil(imageBytes(value.image, value) * (value.generateMipmaps ? 4 / 3 : 1));
    }
  });
  const result: Omit<Vibi3DStats, 'warnings'> = { sceneRevision, objects, instances, triangles, drawCalls,
    drawCallsSource: 'estimated', textureBytes: Math.round(textureBytes), textureBytesEstimated: true };
  return { ...result, warnings: buildVibi3DStatsWarnings(result) };
}
