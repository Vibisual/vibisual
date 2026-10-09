import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelEditor } from './modelEditor.js';
import { UNAVAILABLE_TEXTURE, createLocalResourceResolver, disposeModel, exportModelGlb, loadLocalModel, loadWorkspaceModel, parseModel, workspaceResourceUrl } from './modelIO.js';
import { workspaceMediaUrl } from '../../utils/workspaceMedia.js';

/**
 * A minimal ASCII FBX with two textures, written the way exporters write them: the base color by
 * the author's absolute path, the bump map by a bare name. Real assets look like this (§5.13 (R-5)).
 */
function asciiFbx(): string {
  const t = (depth: number, line: string): string => '\t'.repeat(depth) + line;
  const textures = [{ id: 4000, video: 5000, name: 'Base', file: 'C:\\Users\\artist\\textures\\color.png', slot: 'DiffuseColor' }, // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    { id: 4001, video: 5001, name: 'Bump', file: 'wood.tga', slot: 'Bump' }];
  return ['; FBX 7.4.0 project file', 'FBXHeaderExtension:  {', t(1, 'FBXHeaderVersion: 1003'), t(1, 'FBXVersion: 7400'), '}',
    'Objects:  {',
    t(1, 'Geometry: 1000, "Geometry::Tri", "Mesh" {'), t(2, 'Vertices: *9 {'), t(3, 'a: 0,0,0,1,0,0,0,1,0'), t(2, '} '),
    t(2, 'PolygonVertexIndex: *3 {'), t(3, 'a: 0,1,-3'), t(2, '} '), t(1, '}'),
    t(1, 'Model: 2000, "Model::Tri", "Mesh" {'), t(2, 'Version: 232'), t(1, '}'),
    t(1, 'Material: 3000, "Material::Painted", "" {'), t(2, 'ShadingModel: "phong"'),
    t(2, 'Properties70:  {'), t(3, 'P: "DiffuseColor", "Color", "", "A",0.8,0.2,0.2'), t(2, '}'), t(1, '}'),
    ...textures.flatMap(({ id, video, name, file }) => [
      t(1, `Texture: ${id}, "Texture::${name}", "" {`), t(2, `FileName: "${file}"`), t(2, `RelativeFilename: "${file}"`), t(1, '}'),
      t(1, `Video: ${video}, "Video::${name}", "Clip" {`), t(2, `FileName: "${file}"`), t(2, `RelativeFilename: "${file}"`), t(1, '}'),
    ]),
    '}', 'Connections:  {', t(1, 'C: "OO",2000,0'), t(1, 'C: "OO",1000,2000'), t(1, 'C: "OO",3000,2000'),
    ...textures.flatMap(({ id, video, slot }) => [t(1, `C: "OP",${id},3000, "${slot}"`), t(1, `C: "OO",${video},${id}`)]),
    '}'].join('\n');
}
/** 1×1 uncompressed 32-bit TGA holding one blue pixel (stored BGRA). */
const TGA = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 8, 255, 0, 0, 255]);
type FbxMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;

/** Object URLs and `fetch` as the renderer has them; `served` maps a request URL to its bytes, anything else is 404. */
function stubFetch(served: Map<string, BlobPart> = new Map()): ReturnType<typeof vi.fn> {
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { const url = `blob:vibi3d-test/${blobs.size}`; blobs.set(url, blob as Blob); return url; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const fetchMock = vi.fn(async (input: unknown) => {
    const body = blobs.get(String(input)) ?? served.get(String(input));
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
class TestImage { src = ''; async decode(): Promise<void> { /* decoded */ } }

class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); }); }
}

beforeEach(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  vi.stubGlobal('ProgressEvent', class extends Event { constructor(type: string) { super(type); } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Vibi3D model IO', () => {
  it('exports and reloads real GLB preserving IDs, edits, hidden objects, lighting, and animation', async () => {
    const object = new THREE.Group();
    object.name = 'EditableRoot';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
    mesh.name = 'AnimatedBox';
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    hidden.name = 'Hidden'; hidden.visible = false;
    object.add(mesh, hidden);
    const clip = new THREE.AnimationClip('move', 1, [new THREE.VectorKeyframeTrack('AnimatedBox.position', [0, 1], [0, 0, 0, 4, 0, 0])]);
    const editor = new ModelEditor(object, [clip], { projectId: 'project', fileName: 'model.glb' });
    const meshId = editor.getId(mesh)!;
    editor.apply([{ type: 'update', id: meshId, position: [1, 2, 3], scale: [2, 2, 2], color: '#336699' }, { type: 'lighting', intensity: 2.5 }], 0);
    mesh.material.wireframe = true;
    const bytes = await exportModelGlb(object, [clip]);
    expect(new DataView(bytes).getUint32(0, true)).toBe(0x46546c67);
    const loaded = await parseModel('.glb', bytes);
    const reopened = new ModelEditor(loaded.object, loaded.clips, { projectId: 'project', fileName: 'saved.glb' });
    expect(reopened.snapshot().nodes).toHaveLength(3);
    expect(reopened.getId(reopened.object)).toBe(editor.getId(object));
    const reloadedMesh = reopened.findObject(meshId) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(reloadedMesh.position.toArray()).toEqual([1, 2, 3]);
    expect(reloadedMesh.scale.toArray()).toEqual([2, 2, 2]);
    expect(reloadedMesh.material.color.getHexString()).toBe('336699');
    expect(reloadedMesh.material.wireframe).toBe(false);
    expect(mesh.material.wireframe).toBe(true);
    expect(reopened.lighting).toBe(2.5);
    expect(loaded.clips).toHaveLength(1);
    expect(loaded.clips[0]?.name).toBe('move');
    const mixer = new THREE.AnimationMixer(loaded.object);
    mixer.clipAction(loaded.clips[0]!).play(); mixer.update(0.5);
    expect(reloadedMesh.position.x).toBeCloseTo(2);
    mixer.stopAllAction();
    expect(reloadedMesh.position.toArray()).toEqual([1, 2, 3]);
    disposeModel(object); disposeModel(loaded.object);
  });

  it('opens a local GLTF with a separate binary companion and releases its object URLs', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ uri: 'triangle%20data.bin', byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    };
    const primary = new File([JSON.stringify(gltf)], 'triangle.gltf');
    const companion = new File([positions], 'triangle data.bin');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loaded = await loadLocalModel([primary, companion]);
    expect(loaded.object.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(revoke).toHaveBeenCalledTimes(1);
    await expect(loadLocalModel([primary])).rejects.toThrow(/Missing companion/);
    disposeModel(loaded.object);
  });

  it('keeps relative folder mapping exact and refuses ambiguous missing companions', () => {
    const model = new File([''], 'scene.gltf');
    Object.defineProperty(model, 'webkitRelativePath', { value: 'project/models/scene.gltf' });
    const right = new File([''], 'color.png');
    Object.defineProperty(right, 'webkitRelativePath', { value: 'project/textures/color.png' });
    const wrong = new File([''], 'color.png');
    Object.defineProperty(wrong, 'webkitRelativePath', { value: 'other/color.png' });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:color');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const resolver = createLocalResourceResolver([model, right, wrong], model);
    expect(resolver.resolve('../textures/color.png')).toBe('blob:color');
    expect(create).toHaveBeenCalledWith(right);
    // Two candidates share the name: a texture is skipped rather than guessed, a buffer stops the load.
    expect(resolver.resolve('missing/color.png')).toBe(UNAVAILABLE_TEXTURE);
    expect(() => resolver.resolve('missing/scene.bin')).toThrow(/Missing companion/);
    expect(resolver.resolve('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    resolver.dispose(); resolver.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('opens OBJ material libraries supplied as companion files', async () => {
    const obj = new File(['mtllib colors.mtl\no Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Blue\nf 1 2 3\n'], 'triangle.obj');
    const mtl = new File(['newmtl Blue\nKd 0 0 1\n'], 'colors.mtl');
    const loaded = await loadLocalModel([obj, mtl]);
    const mesh = loaded.object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
    expect(mesh.material.color.getHexString()).toBe('0000ff');
    expect(mesh.geometry.getAttribute('position').count).toBe(3);
    disposeModel(loaded.object);
  });

  it('routes workspace resources through the existing media route on Windows paths', () => {
    const url = workspaceResourceUrl('C:/work space', 'models\\props\\room.gltf', '..\\textures\\wall%20color.png');
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/workspace-media');
    expect(parsed.searchParams.get('root')).toBe('C:/work space');
    expect(parsed.searchParams.get('path')).toBe('models/textures/wall color.png');
    // A texture recorded by the author's absolute path is looked for next to the model.
    const authored = new URL(workspaceResourceUrl('C:/work space', 'models\\props\\room.fbx', 'D:\\artist\\maps\\wall color.png'), 'http://localhost');
    expect(authored.searchParams.get('path')).toBe('models/props/wall color.png');
    expect(() => workspaceResourceUrl('project', 'model.gltf', 'https://example.com/remote.bin')).toThrow(/External/);
  });

  it('opens an FBX whose texture is missing, decodes its TGA companion, and names what it skipped', async () => {
    stubFetch();
    const loaded = await loadLocalModel([new File([asciiFbx()], 'scene.fbx'), new File([TGA], 'wood.tga')]);
    const mesh = loaded.object.getObjectByProperty('isMesh', true) as FbxMesh;
    expect(loaded.missingTextures).toEqual(['color.png']);
    // Left in place, a texture that never loads draws the surface black; cleared, the material color shows.
    expect(mesh.material.map).toBeNull();
    const bump = mesh.material.bumpMap as THREE.DataTexture;
    expect(bump).toBeInstanceOf(THREE.DataTexture);
    expect(bump.version).toBeGreaterThan(0);
    expect([bump.image.width, bump.image.height, ...bump.image.data!]).toEqual([1, 1, 0, 0, 255, 255]);
    disposeModel(loaded.object);
  });

  it('fetches workspace textures instead of letting an <img> request /api, and opens without an absent one', async () => {
    const media = (path: string): string => workspaceMediaUrl('C:/project', path);
    const fetchMock = stubFetch(new Map<string, BlobPart>([[media('models/scene.fbx'), asciiFbx()], [media('models/color.png'), new Uint8Array([137, 80, 78, 71])]]));
    vi.stubGlobal('Image', TestImage);
    const loaded = await loadWorkspaceModel('C:/project', 'models/scene.fbx');
    const mesh = loaded.object.getObjectByProperty('isMesh', true) as FbxMesh;
    expect(fetchMock).toHaveBeenCalledWith(media('models/color.png'));
    expect(mesh.material.map?.image).toBeInstanceOf(TestImage);
    expect(mesh.material.bumpMap).toBeNull();
    expect(loaded.missingTextures).toEqual(['wood.tga']);
    disposeModel(loaded.object);
  });

  it('rejects workspace fetch errors and unsupported models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadWorkspaceModel('root', 'missing.glb')).rejects.toThrow('404');
    await expect(loadLocalModel([new File([''], 'notes.txt')])).rejects.toThrow('Select a GLB');
    await expect(parseModel('.txt', new ArrayBuffer(0))).rejects.toThrow('Unsupported');
  });

  it('disposes shared geometry, material, and textures once', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeTexture = vi.spyOn(texture, 'dispose');
    disposeModel(root);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
  });
});
