import * as THREE from 'three';
import { validateVibi3DMascotRecipe, type Vibi3DMascotCommand } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { assertGraphicEditable, findGraphicObject, graphicParent, reconcileGraphicParts } from './modelGraphicObjects.js';
import { buildRoundMascot, buildStandeeMascot } from './modelMascotParts.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';

export function applyModelMascot(root: THREE.Object3D, command: Vibi3DMascotCommand, texture?: THREE.Texture): string {
  const id = command.id ?? crypto.randomUUID(), existing = findGraphicObject(root, id);
  if (existing && (!(existing instanceof THREE.Group) || !existing.userData['vibi3dMascotRecipe'])) throw new CreationUiError('object-id-exists');
  if (existing) assertGraphicEditable(existing, true);
  const parent = graphicParent(root, existing, command.parentId);
  const { type: _type, id: _id, name: _name, parentId: _parent, position: _position, rotation: _rotation, ...patch } = command;
  const prior = existing ? validateVibi3DMascotRecipe(existing.userData['vibi3dMascotRecipe']) : null;
  const combined = { ...prior, ...patch, ...(patch.colors ? { colors: { ...prior?.colors, ...patch.colors } } : {}) };
  if (patch.style === 'round' && patch.source === undefined) delete combined.source;
  const recipe = validateVibi3DMascotRecipe(combined);
  if (!recipe) throw new CreationUiError('invalid-mascot-recipe');
  const oldImage = existing?.children.find(child => child.userData['vibi3dMascotPart'] === 'image') as THREE.Mesh | undefined;
  const oldMap = oldImage?.material instanceof THREE.MeshStandardMaterial ? oldImage.material.map : null;
  const image = texture ?? (JSON.stringify(prior?.source) === JSON.stringify(recipe.source) ? oldMap : null);
  if (recipe.style === 'standee' && !image) throw new CreationUiError('image-source-unavailable');
  const generated = recipe.style === 'standee' ? buildStandeeMascot(recipe, id, image!) : buildRoundMascot(recipe, id);
  const object = existing as THREE.Group | undefined ?? generated;
  if (existing) reconcileGraphicParts(object, generated, id, root);
  else { object.uuid = creationIntentId('mascot-object', id); object.name = command.name ?? 'Mascot'; }
  if (command.name !== undefined) object.name = command.name;
  object.userData['vibi3dId'] = id; object.userData['vibi3dMascotRecipe'] = structuredClone(recipe);
  if (command.position) object.position.fromArray(command.position);
  if (command.rotation) object.rotation.set(...command.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
  if (object.parent !== parent) parent.add(object);
  refreshModelMetricUvs(object);
  return id;
}
