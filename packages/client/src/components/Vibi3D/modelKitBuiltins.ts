import type { Vibi3DBuiltinModule, Vibi3DArchitectureRecipe } from '@vibisual/shared';
import type * as THREE from 'three';
import { buildArchitectureObject } from './modelArchitecture.js';

const BUILTINS: Record<Vibi3DBuiltinModule, Vibi3DArchitectureRecipe> = {
  'korean-retail/window': { kind: 'facade', width: 2, floors: 1, height: 2.3, bays: 1, bandHeight: 0, acDensity: 0, eavesDepth: 0, floorModules: [['window']] },
  'korean-retail/storefront-glass': { kind: 'storefront', style: 'glass' },
  'korean-retail/storefront-wood': { kind: 'storefront', style: 'wood' },
  'korean-retail/storefront-shutter': { kind: 'storefront', style: 'shutter' },
  'street/bollard': { kind: 'prop', style: 'bollard' }, 'street/bench': { kind: 'prop', style: 'bench' },
  'street/planter': { kind: 'prop', style: 'planter' }, 'street/light': { kind: 'prop', style: 'streetLight' },
};
/** Generated locally from native recipes; no asset download or external authoring process. */
export function buildModelKitBuiltin(builtin: Vibi3DBuiltinModule, id: string): THREE.Object3D {
  return buildArchitectureObject({ ...BUILTINS[builtin], detail: 'architectural' }, id);
}
