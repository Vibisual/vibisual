import type { Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { architecturalKerb } from './architectureKerb.js';
type Street = Extract<Vibi3DArchitectureRecipe, { kind: 'street' }>;

/** Street length follows X. Left/right sidewalks lie at negative/positive Z relative to the road centre. */
export function buildStreet(parts: ArchitectureParts, recipe: Street): void {
  const length = recipe.length ?? D.street.length, road = recipe.roadWidth ?? D.street.road, sidewalk = recipe.sidewalkWidth ?? D.street.sidewalk;
  const kerb = recipe.kerbHeight ?? D.street.kerb, lanes = recipe.lanes ?? 2, colors = recipe.blockColors ?? D.street.colors;
  parts.box(parts.root, 'road', [length, D.slab, road], [0, -D.slab / 2, 0], 'asphalt');
  const sideNames = recipe.sidewalks === 'left' ? ['left'] : recipe.sidewalks === 'right' ? ['right'] : ['left', 'right'];
  for (const name of sideNames) {
    const sign = name === 'left' ? -1 : 1, side = parts.group(parts.root, `${name}-sidewalk`);
    const thickness = Math.max(D.slab, kerb);
    parts.box(side, 'paving', [length, thickness, sidewalk], [0, kerb - thickness / 2, sign * (road + sidewalk) / 2], 'pavers', { params: { color: colors[0], secondaryColor: colors[1] } });
    if (kerb > 0) {
      if (parts.detailed) architecturalKerb(parts, side, length, kerb, road, sign);
      else parts.box(side, 'kerb', [length, kerb, 0.18], [0, kerb / 2, sign * (road / 2 + 0.09)], 'kerb');
    }
  }
  if (recipe.laneMarkings !== false) for (let lane = 1; lane < lanes; lane++) {
    const group = parts.group(parts.root, `lane-divider-${lane}`);
    for (let x = -length / 2 + 1.5; x < length / 2; x += 4.5) parts.box(group, `dash-at-${x}`, [Math.min(2.5, length / 2 - x), 0.005, 0.1], [x, 0.004, -road / 2 + road * lane / lanes], 'painted-concrete', { params: { color: D.colors.marking }, wear: 0.65 });
  }
  if (recipe.crosswalk) {
    const group = parts.group(parts.root, 'crosswalk', [-length * 0.3, 0.006, 0]);
    for (let z = -road / 2 + 0.3; z < road / 2 - 0.2; z += 0.8) parts.box(group, `stripe-at-${z.toFixed(2)}`, [Math.min(2.5, length / 3), 0.005, 0.4], [0, 0, z], 'painted-concrete', { params: { color: D.colors.marking }, wear: 0.5 });
  }
  const manholes = recipe.manholes ?? 1;
  for (let cover = 0; cover < manholes; cover++) {
    const x = -length / 2 + length * (cover + 1) / (manholes + 1);
    const group = parts.group(parts.root, `manhole-${cover}`, [x, 0, road * 0.18]);
    parts.cylinder(group, 'rim', 0.36, 0.025, [0, 0.005, 0], 'rust');
    parts.cylinder(group, 'lid', 0.33, 0.03, [0, 0.01, 0], 'corrugated-metal');
  }
}
