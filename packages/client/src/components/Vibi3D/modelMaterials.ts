import * as THREE from 'three';
import { VIBI3D_MATERIAL_MAP_SLOTS, validateVibi3DMaterial, type Vibi3DMaterial, type Vibi3DMaterialMapSlot, type Vibi3DMaterialMapSource } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { materialPresetProperties } from './proceduralMaterialPixels.js';
import { cachedMaterialTexture, configureMaterialTexture, proceduralTexture, type MaterialPixelCache } from './modelProceduralTextures.js';
import { normalizeProceduralValues } from './modelProceduralValues.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';

export type ModelMaterialTextures = Partial<Record<Vibi3DMaterialMapSlot, THREE.Texture>>;
type ProceduralSource = Extract<Vibi3DMaterialMapSource, { kind: 'procedural' }>;

const sides = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;
const metadata = (material: THREE.Material): Vibi3DMaterial => validateVibi3DMaterial(material.userData['vibi3dMaterial']) ?? {};
const slots = (object: THREE.Object3D): THREE.Material[] => {
  const value = (object as THREE.Mesh).material; return Array.isArray(value) ? value : value ? [value] : [];
};

export function readModelMaterial(object: THREE.Object3D): Vibi3DMaterial | undefined {
  const material = slots(object)[0]; if (!(material instanceof THREE.MeshStandardMaterial)) return undefined;
  const stored = metadata(material);
  return validateVibi3DMaterial({ ...stored, color: proceduralTexture(material.map) ? stored.color ?? `#${material.color.getHexString()}` : `#${material.color.getHexString()}`,
    roughness: proceduralTexture(material.roughnessMap) ? stored.roughness ?? material.roughness : material.roughness,
    metalness: material.metalness, opacity: material.opacity, emissive: `#${material.emissive.getHexString()}`, emissiveIntensity: material.emissiveIntensity,
    transparent: material.transparent, alphaTest: material.alphaTest, side: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.BackSide ? 'back' : 'front',
    envMapIntensity: material.envMapIntensity, polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor, polygonOffsetUnits: material.polygonOffsetUnits,
    ...(material instanceof THREE.MeshPhysicalMaterial ? { physical: { transmission: material.transmission, ior: material.ior, thickness: material.thickness, clearcoat: material.clearcoat } } : {}),
  }) ?? undefined;
}

function standardMaterial(source: THREE.Material, physical: boolean): THREE.MeshStandardMaterial {
  if (source instanceof THREE.MeshStandardMaterial && (!physical || source instanceof THREE.MeshPhysicalMaterial)) return source;
  const next = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  if (source instanceof THREE.MeshStandardMaterial) THREE.MeshStandardMaterial.prototype.copy.call(next, source);
  else {
    THREE.Material.prototype.copy.call(next, source);
    const colored = source as THREE.MeshBasicMaterial;
    if (colored.color instanceof THREE.Color) next.color.copy(colored.color);
    if (colored.map) next.map = colored.map;
    if (colored.alphaMap) next.alphaMap = colored.alphaMap;
  }
  return next;
}

/** Replacement textures are owned clones. Unmentioned maps and scalar values survive ordinary edits. */
function editSlot(original: THREE.Material, change: Vibi3DMaterial, prepared: ModelMaterialTextures, cache: MaterialPixelCache): THREE.MeshStandardMaterial {
  const previous = metadata(original); const switching = change.preset !== undefined && change.preset !== previous.preset;
  const defaults = change.preset ? materialPresetProperties(change.preset) : {};
  const merged: Vibi3DMaterial = { ...(switching ? defaults : previous), ...change,
    ...(change.params ? { params: { ...(switching ? {} : previous.params), ...change.params } } : {}),
    ...(change.physical ? { physical: { ...(switching ? defaults.physical : previous.physical), ...change.physical } } : {}),
    ...(change.maps ? { maps: { ...(switching ? {} : previous.maps), ...change.maps } } : {}),
  };
  const authored = original.userData['vibi3dProceduralVersion'] === 2;
  const regenerate = !!merged.preset && (change.preset !== undefined || change.params !== undefined || change.wear !== undefined || change.seed !== undefined
    || change.resolution !== undefined || change.tileSize !== undefined);
  const colorEdit = authored && change.color !== undefined, roughnessEdit = authored && change.roughness !== undefined;
  if (regenerate || authored) normalizeProceduralValues(merged, change, previous, original.userData['vibi3dProceduralVersion'], switching);
  // Only tracked preset defaults follow this toggle; explicit and unmarked legacy transmission values stay owned by the user.
  const autoTransmission = merged.preset === 'glass' && change.physical?.transmission === undefined
    && (switching || original.userData['vibi3dAutoTransmission'] === true);
  const adjustTransmission = autoTransmission && (switching || change.params?.fakeInterior !== undefined);
  if (adjustTransmission) merged.physical = { ...merged.physical, transmission: merged.params?.fakeInterior ? 0.08 : 0.9 };
  const values: Vibi3DMaterial = switching ? { ...defaults, ...change, physical: merged.physical } : { ...change };
  if (adjustTransmission) values.physical = merged.physical;
  const material = standardMaterial(original, !!merged.physical);
  if (switching || change.physical?.transmission !== undefined) material.userData['vibi3dAutoTransmission'] = autoTransmission;
  if (switching) {
    delete material.userData['vibi3dCustomMaps'];
    for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) material[slot] = null;
    material.opacity = 1; material.transparent = false; material.alphaTest = 0; material.emissive.set('#000000'); material.emissiveIntensity = 1;
    material.normalScale.set(1, 1); material.aoMapIntensity = 1;
    if (material instanceof THREE.MeshPhysicalMaterial) Object.assign(material, { transmission: 0, ior: 1.5, thickness: 0, clearcoat: 0 });
  }
  if (values.color) material.color.set(values.color);
  if (values.emissive) material.emissive.set(values.emissive);
  for (const key of ['roughness', 'metalness', 'opacity', 'emissiveIntensity', 'alphaTest', 'envMapIntensity', 'polygonOffsetFactor', 'polygonOffsetUnits'] as const) {
    if (values[key] !== undefined) material[key] = values[key]!;
  }
  if (change.params?.metalness !== undefined && change.metalness === undefined) material.metalness = change.params.metalness;
  if (values.transparent !== undefined) material.transparent = values.transparent;
  else if (values.opacity !== undefined) material.transparent = values.opacity < 1 || !!material.alphaMap;
  if (values.side) material.side = sides[values.side];
  if (values.polygonOffset !== undefined) material.polygonOffset = values.polygonOffset;
  if (material instanceof THREE.MeshPhysicalMaterial && values.physical) Object.assign(material, values.physical);
  const mappingChanged = switching || regenerate || !!change.maps || change.rotation !== undefined || change.offset !== undefined;
  if (mappingChanged) merged.tileSize ??= merged.preset ? materialPresetProperties(merged.preset).tileSize : [1, 1];
  for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) {
    const source = change.maps?.[slot]?.source;
    let next: THREE.Texture | null | undefined;
    if (prepared[slot]) next = prepared[slot]!.clone();
    else if (source?.kind === 'procedural') next = cachedMaterialTexture(cache, slot, source, merged);
    else if (source) throw new CreationUiError('image-source-unavailable');
    else if ((regenerate || (colorEdit && slot === 'map') || (roughnessEdit && slot === 'roughnessMap'))
      && !merged.maps?.[slot] && !material.userData['vibi3dCustomMaps']?.[slot] && ['map', 'normalMap', 'roughnessMap', 'aoMap'].includes(slot)) {
      const source = { kind: 'procedural' as const, preset: merged.preset!, seed: merged.seed, params: merged.params, wear: merged.wear, resolution: merged.resolution };
      next = cachedMaterialTexture(cache, slot, source, merged);
    } else if (mappingChanged && material[slot]) next = material[slot]!.clone();
    if (next) { configureMaterialTexture(next, slot, merged); material[slot] = next; }
    if (source && material.userData['vibi3dCustomMaps']) delete material.userData['vibi3dCustomMaps'][slot];
  }
  if (regenerate) material.userData['vibi3dProceduralVersion'] = 2;
  if (proceduralTexture(material.map)) material.color.set('#ffffff');
  if (proceduralTexture(material.roughnessMap)) material.roughness = 1;
  // A baked illuminated graphic has one image link: emission follows that image when the user advances it.
  if (material.userData['vibi3dLinkedEmission'] && material.map) material.emissiveMap = material.map;
  material.userData['vibi3dMaterial'] = structuredClone(merged);
  material.needsUpdate = true; return material;
}

export function applyModelMaterial(object: THREE.Object3D, change: Vibi3DMaterial, prepared: ModelMaterialTextures = {}): void {
  let changed = false; const cache: MaterialPixelCache = new Map();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh; if (!mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material => editSlot(material, change, prepared, cache)) : editSlot(mesh.material, change, prepared, cache);
    changed = true;
  });
  if (!changed) throw new CreationUiError('no-editable-material');
  refreshModelMetricUvs(object);
}

export function createModelMaterial(change: Vibi3DMaterial = {}, prepared: ModelMaterialTextures = {}): THREE.MeshStandardMaterial {
  return editSlot(new THREE.MeshStandardMaterial({ color: '#8b5cf6' }), change, prepared, new Map());
}
