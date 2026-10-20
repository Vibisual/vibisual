import * as THREE from 'three';
import { validateVibi3DSignRecipe, type CreationDoc, type CreationLink, type Vibi3DCommand, type Vibi3DSignRecipe } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { disposeModel } from './modelIO.js';
import { defaultSignRecipe, prepareModelSign } from './modelSign.js';
import { hasExternalMaterialSources, prepareMaterialSources } from './modelMaterialSources.js';
import { isPreparedInstalled } from './modelPreparedGraphics.js';

export function needsPreparedVibi3DCommands(commands: readonly Vibi3DCommand[]): boolean {
  return commands.some(command => ['sign', 'decal', 'mascot'].includes(command.type)) || hasExternalMaterialSources(commands);
}
/** Prepare fonts and immutable images outside the atomic edit; command order supplies intermediate sign recipes. */
export async function prepareVibi3DCommands(projectId: string, document: CreationDoc | null, input: readonly Vibi3DCommand[],
  commandId: string, object: THREE.Object3D, links: CreationLink[] = document?.links ?? []) {
  const commands = structuredClone(input) as Vibi3DCommand[];
  const prior = new Map<string, THREE.Object3D>(); object.traverse(node => { if (typeof node.userData['vibi3dId'] === 'string') prior.set(node.userData['vibi3dId'], node); });
  const signs = new Map<string, Vibi3DSignRecipe>();
  const preparedSigns: Record<number, THREE.Group> = {};
  let materials: Awaited<ReturnType<typeof prepareMaterialSources>> | undefined;
  const dispose = (): void => {
    materials?.dispose();
    // Installed signs have a parent. Their resources now belong to the editor/history.
    for (const sign of Object.values(preparedSigns)) if (!isPreparedInstalled(sign)) disposeModel(sign);
  };
  try {
    for (const [index, command] of commands.entries()) {
      if (command.type !== 'sign' && command.type !== 'decal' && command.type !== 'mascot') continue;
      command.id ??= creationIntentId('native-object', commandId, index);
      const key = command.type === 'sign' ? 'vibi3dSignRecipe' : command.type === 'decal' ? 'vibi3dDecalRecipe' : 'vibi3dMascotRecipe';
      const previous = prior.get(command.id)?.userData[key];
      if (command.type !== 'sign') { if (!command.source && previous?.source) command.source = structuredClone(previous.source); continue; }
      const { type: _type, id: _id, name: _name, parentId: _parent, position: _position, rotation: _rotation, ...patch } = command;
      const before = signs.get(command.id) ?? validateVibi3DSignRecipe(previous);
      const defaults = defaultSignRecipe(command.kind ?? before?.kind);
      const recipe = validateVibi3DSignRecipe({ ...defaults, ...(before ?? (command.source && command.text === undefined ? { text: '' } : {})), ...patch });
      if (!recipe) throw new CreationUiError('invalid-command');
      signs.set(command.id, recipe); Object.assign(command, recipe);
    }
    if (hasExternalMaterialSources(commands)) {
      if (!document || !projectId) throw new CreationUiError('vibi3d-source-unavailable');
      materials = await prepareMaterialSources(projectId, document, commands, commandId, links, object);
    }
    const resolved = materials?.commands ?? commands;
    for (const [index, command] of resolved.entries()) if (command.type === 'sign') {
      const { type: _type, id: _id, name: _name, parentId: _parent, position: _position, rotation: _rotation, ...recipe } = command;
      preparedSigns[index] = await prepareModelSign(recipe as Vibi3DSignRecipe, command.id!, { sourceTexture: materials?.materialMaps[index]?.map });
    }
    const decorationTextures = Object.fromEntries(Object.entries(materials?.materialMaps ?? {}).flatMap(([index, maps]) => maps.map ? [[index, maps.map]] : []));
    return { commands: resolved, materialMaps: materials?.materialMaps, decorationTextures, preparedSigns, dispose };
  } catch (error) { dispose(); throw error; }
}
