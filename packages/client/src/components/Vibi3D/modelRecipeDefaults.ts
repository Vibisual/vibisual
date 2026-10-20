import type { Vibi3DRecipe } from '@vibisual/shared';

export function defaultRecipe(kind: Vibi3DRecipe['kind']): Vibi3DRecipe {
  const square: [number, number, number][] = [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]];
  switch (kind) {
    case 'box': return { kind, width: 1, height: 1, depth: 1 };
    case 'roundedBox': return { kind, width: 1, height: 1, depth: 1, bevelRadius: 0.1, bevelSegments: 3 };
    case 'capsule': return { kind, radius: 0.3, height: 1.4 };
    case 'plane': return { kind, width: 1, height: 1 };
    case 'cylinder': return { kind, radius: 0.5, radiusTop: 0.5, height: 1 };
    case 'cone': return { kind, radius: 0.5, height: 1 };
    case 'sphere': return { kind, radius: 0.5 };
    case 'torus': return { kind, radius: 0.5, tube: 0.15 };
    case 'lathe': return { kind, points: [[0, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [0.25, 1.2, 0], [0, 1.2, 0]] };
    case 'extrude': return { kind, depth: 0.3, points: square };
    case 'path': return { kind, tube: 0.1, points: [[-1, 0, 0], [0, 1, 0], [1, 0, 0]] };
    case 'sweep': return { kind, profile: square.map(([x, y, z]) => [x * 0.2, y * 0.2, z]), path: [[0, 0, 0], [0, 1, 0], [1, 1, 0]] };
    case 'stairs': return { kind, width: 1.2, height: 1.5, depth: 2, steps: 5 };
    case 'wall': return { kind, width: 4, height: 3, thickness: 0.25, openings: [] };
  }
}
