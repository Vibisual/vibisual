import type { Vibi3DArchitectureRecipe, Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';
import { architecturalPlant, architecturalTree } from './architectureVegetation.js';
type Prop = Extract<Vibi3DArchitectureRecipe, { kind: 'prop' }>;

function wire(parts: ArchitectureParts, recipe: Prop): void {
  const anchors = recipe.path ?? [[-3, 5, 0], [3, 5, 0]], sag = recipe.sag ?? 0.6;
  const points: Vibi3DVec3[] = [], steps = Math.max(1, Math.min(8, Math.floor(127 / (anchors.length - 1))));
  anchors.slice(0, -1).forEach((from, span) => {
    const to = anchors[span + 1]!;
    for (let sample = 0; sample < steps; sample++) {
      const t = sample / steps;
      points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - sag * 4 * t * (1 - t), from[2] + (to[2] - from[2]) * t]);
    }
  });
  points.push([...anchors.at(-1)!]); parts.pathMesh(parts.root, 'cable', points, recipe.radius ?? 0.015, 'rubber');
}

function pole(parts: ArchitectureParts, recipe: Prop): void {
  const height = recipe.height ?? 7, span = recipe.width ?? 1.5;
  parts.cylinder(parts.root, 'pole', recipe.radius ?? 0.14, height, [0, height / 2, 0], 'painted-concrete', 0.1);
  for (const [name, offset] of [['upper', 0.5], ['lower', 1.1]] as const) {
    parts.box(parts.root, `${name}-crossarm`, [span, 0.08, 0.1], [0, height - offset, 0], 'aluminium');
    for (const side of [-1, 1]) parts.cylinder(parts.root, `${name}-${side < 0 ? 'left' : 'right'}-insulator`, 0.07, 0.2, [side * span * 0.4, height - offset + 0.1, 0], 'plastic');
  }
}

function streetLight(parts: ArchitectureParts, recipe: Prop): void {
  const height = recipe.height ?? 5, reach = recipe.width ?? 1.2;
  parts.pathMesh(parts.root, 'post', [[0, 0, 0], [0, height * 0.85, 0], [reach * 0.25, height, 0], [reach, height, 0]], recipe.radius ?? 0.055);
  if (parts.detailed) parts.roundedBox(parts.root, 'housing', [0.6, 0.16, 0.3], [reach, height, 0], 'aluminium');
  else parts.box(parts.root, 'housing', [0.6, 0.16, 0.3], [reach, height, 0], 'aluminium');
  parts.box(parts.root, 'lamp', [0.5, 0.015, 0.22], [reach, height - 0.09, 0], 'emissive-acrylic', { emissive: D.colors.fixture, emissiveIntensity: 0.35 });
}

function tree(parts: ArchitectureParts, recipe: Prop): void {
  const height = recipe.height ?? 4, width = recipe.width ?? 2.3, trunk = height * 0.5;
  if (parts.detailed) architecturalTree(parts, width, height, recipe.radius ?? 0.12);
  else {
  parts.cylinder(parts.root, 'trunk', recipe.radius ?? 0.12, trunk, [0, trunk / 2, 0], 'wood-planks', 0.07);
  for (const [name, x, y, z] of [['crown', 0, 0.72, 0], ['left', -0.23, 0.61, 0.12], ['right', 0.24, 0.59, -0.1]] as const) {
    const leaf = parts.sphere(parts.root, name, width * 0.4, [width * x, height * y, width * z], 'plastic', { params: { color: D.colors.greenery, secondaryColor: '#344b2b', contrast: 0.8 }, roughness: 0.95 });
    leaf.scale.set(1, height / width * 0.6, 1);
  }
  }
  parts.box(parts.root, 'tree-pit', [width * 0.6, 0.08, width * 0.6], [0, 0.04, 0], 'granite');
}

function bench(parts: ArchitectureParts, recipe: Prop): void {
  const width = recipe.width ?? 1.5, height = recipe.height ?? 0.85, depth = recipe.depth ?? 0.5, seat = height * 0.52;
  if (parts.detailed) {
    const C = A.bench, seating = parts.group(parts.root, 'seat'), back = parts.group(parts.root, 'back');
    for (let slat = 0; slat < C.seatSlats; slat++) {
      const z = -depth / 2 + depth * (slat + 0.5) / C.seatSlats;
      parts.roundedBox(seating, `slat-at-${z.toFixed(4)}`, [width, Math.min(C.thickness, height / 8), depth / C.seatSlats - Math.min(C.gap, depth / C.seatSlats / 4)],
        [0, seat, z], 'wood-planks');
    }
    for (let slat = 0; slat < C.backSlats; slat++) {
      const y = seat + (height - seat) * (slat + 0.5) / C.backSlats;
      parts.roundedBox(back, `slat-at-${y.toFixed(4)}`, [width, (height - seat) / C.backSlats - Math.min(C.gap, (height - seat) / C.backSlats / 4), Math.min(C.thickness, depth / 4)],
        [0, y, -depth / 2], 'wood-planks');
    }
  } else {
  parts.box(parts.root, 'seat', [width, 0.08, depth], [0, seat, 0], 'wood-planks');
  parts.box(parts.root, 'back', [width, height - seat, 0.08], [0, (height + seat) / 2, -depth / 2], 'wood-planks');
  }
  for (const side of [-1, 1]) parts.box(parts.root, side < 0 ? 'left-leg' : 'right-leg', [0.08, seat, depth * 0.8], [side * width * 0.35, seat / 2, 0], 'aluminium');
}

function sandwichBoard(parts: ArchitectureParts, recipe: Prop): void {
  const width = recipe.width ?? 0.65, height = recipe.height ?? 1.1, depth = recipe.depth ?? 0.5;
  for (const side of [-1, 1]) {
    const panel = parts.box(parts.root, side < 0 ? 'rear-panel' : 'front-panel', [width, height, 0.04], [0, height / 2, side * depth / 4], 'wood-planks');
    panel.rotation.x = -side * Math.atan2(depth / 2, height);
  }
  parts.box(parts.root, 'hinge', [width, 0.04, 0.04], [0, height, 0], 'aluminium');
}

function planter(parts: ArchitectureParts, recipe: Prop): void {
  const radius = recipe.radius ?? (recipe.width ? recipe.width / 2 : 0.3), height = recipe.height ?? 0.6;
  const points: Vibi3DVec3[] = [[0, 0, 0], [radius * 0.65, 0, 0], [radius, height, 0], [radius * 0.9, height, 0], [radius * 0.55, 0.08, 0], [0, 0.08, 0]];
  // The open lathe profile makes a real rim and interior instead of a solid flower-pot cylinder.
  parts.mesh(parts.root, 'pot', { kind: 'lathe', points }, [0, 0, 0], 'plastic', { params: { color: D.colors.ceramic }, roughness: 0.9 });
  parts.cylinder(parts.root, 'soil', radius * 0.85, 0.06, [0, height * 0.85, 0], 'asphalt');
  if (parts.detailed) architecturalPlant(parts, radius, height);
  else parts.sphere(parts.root, 'plant', radius * 0.9, [0, height + radius * 0.5, 0], 'plastic', { params: { color: D.colors.greenery }, roughness: 0.95 });
}

const builders = { utilityPole: pole, wire, streetLight, tree, bench, sandwichBoard, planter,
  bollard: (parts: ArchitectureParts, recipe: Prop): void => {
    const height = recipe.height ?? 0.85, radius = recipe.radius ?? 0.08;
    parts.cylinder(parts.root, 'post', radius, height, [0, height / 2, 0], 'rubber');
    parts.cylinder(parts.root, 'reflector', radius * 1.03, height * 0.08, [0, height * 0.78, 0], 'aluminium');
  },
};
export function buildProp(parts: ArchitectureParts, recipe: Prop): void { builders[recipe.style ?? 'planter'](parts, recipe); }
