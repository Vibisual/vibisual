import type * as THREE from 'three';
import { validateVibi3DArchitectureRecipe, type Vibi3DArchitectureKind, type Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { buildBuilding, buildRooftop } from './architectureBuilding.js';
import { buildFacade } from './architectureFacade.js';
import { buildStorefront } from './architectureStorefront.js';
import { buildStreet } from './architectureStreet.js';
import { buildProp } from './architectureProps.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';

const DEFAULTS: { [K in Vibi3DArchitectureKind]: Extract<Vibi3DArchitectureRecipe, { kind: K }> } = {
  building: { kind: 'building', footprint: { kind: 'rect', width: 12, depth: 9 }, floors: D.facade.floors, groundFloorHeight: D.facade.ground, upperFloorHeight: D.facade.upper, roof: 'flat' },
  facade: { kind: 'facade', windowDepth: D.facade.windowDepth, bandHeight: D.facade.band, eavesDepth: D.facade.eaves, acDensity: D.facade.acDensity, side: 'front' },
  storefront: { kind: 'storefront', width: D.storefront.width, height: D.storefront.height, depth: D.storefront.depth, style: 'glass', door: 'right', signBandHeight: D.storefront.signBand, awning: true, projectingSign: true },
  rooftop: { kind: 'rooftop', width: D.roof.width, depth: D.roof.depth, railingHeight: D.roof.railingHeight, waterTank: true, antenna: true },
  street: { kind: 'street', length: D.street.length, roadWidth: D.street.road, sidewalkWidth: D.street.sidewalk, sidewalks: 'both', lanes: 2, laneMarkings: true, kerbHeight: D.street.kerb, crosswalk: false, manholes: 1, blockColors: [...D.street.colors] },
  prop: { kind: 'prop', style: 'planter' },
};

export function defaultArchitectureRecipe(kind: Vibi3DArchitectureKind): Vibi3DArchitectureRecipe { return { ...structuredClone(DEFAULTS[kind]), detail: 'architectural' }; }

const propDefaults = {
  utilityPole: { width: 1.5, height: 7, radius: 0.14 }, wire: { radius: 0.015, sag: 0.6 }, streetLight: { width: 1.2, height: 5, radius: 0.055 },
  tree: { width: 2.3, height: 4, radius: 0.12 }, bollard: { height: 0.85, radius: 0.08 }, bench: { width: 1.5, height: 0.85, depth: 0.5 },
  sandwichBoard: { width: 0.65, height: 1.1, depth: 0.5 }, planter: { height: 0.6, radius: 0.3 },
} as const;

/** Native kit foundations: every part remains an editable mesh/group, with stable semantic identities and authored materials. */
export function buildArchitectureObject(input: Vibi3DArchitectureRecipe, id: string): THREE.Group {
  // Saved recipes without detail are the original generator. Only callers creating new objects opt into architectural detail.
  const recipe = validateVibi3DArchitectureRecipe({ ...structuredClone(DEFAULTS[input.kind]), ...(input.kind === 'prop' ? propDefaults[input.style ?? 'planter'] : {}), ...input });
  if (!recipe) throw new RangeError('architecture-recipe-invalid');
  const parts = new ArchitectureParts(id, recipe.detail ?? 'draft');
  switch (recipe.kind) {
    case 'building': buildBuilding(parts, recipe); break;
    case 'facade': buildFacade(parts, recipe); break;
    case 'storefront': buildStorefront(parts, recipe); break;
    case 'rooftop': buildRooftop(parts, recipe); break;
    case 'street': buildStreet(parts, recipe); break;
    case 'prop': buildProp(parts, recipe); break;
  }
  parts.root.name = recipe.kind;
  parts.root.userData['vibi3dArchitectureRecipe'] = structuredClone(recipe);
  refreshModelMetricUvs(parts.root);
  return parts.root;
}
