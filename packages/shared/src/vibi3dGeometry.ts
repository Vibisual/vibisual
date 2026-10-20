import type { Vibi3DVec3 } from './vibi3d.js';
import { isSimpleVibi3DPolygon, validVibi3DPolygonHoles, type Vibi3DPoint2 } from './vibi3dPolygons.js';

export const VIBI3D_SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'lathe', 'extrude', 'path', 'roundedBox', 'capsule', 'sweep', 'stairs', 'wall'] as const;
export interface Vibi3DWallOpening {
  id?: string;
  /** Lower-left measured from the wall's left edge and floor. Wall origin is center-X, floor-Y, center-Z. */
  x: number; y: number; w: number; h: number;
  /** Front opening tapers inward at 45 degrees through this reveal depth. Zero makes a straight opening. */
  reveal?: number;
}
export interface Vibi3DBevel { enabled?: boolean; thickness?: number; size?: number; segments?: number }
export interface Vibi3DRecipe {
  kind: typeof VIBI3D_SHAPES[number];
  width?: number; height?: number; depth?: number; radius?: number; radiusTop?: number; tube?: number;
  /** Existing lathe/extrude profile uses x,y. Path points use x,y,z. */
  points?: Vibi3DVec3[];
  bevelRadius?: number; bevelSegments?: number;
  holes?: Vibi3DVec3[][]; bevel?: Vibi3DBevel;
  /** Closed profile (x,y,0), swept through an ordered 3D path. Closing point is implicit. */
  profile?: Vibi3DVec3[]; path?: Vibi3DVec3[];
  steps?: number; thickness?: number; openings?: Vibi3DWallOpening[];
  /** Degrees: adjacent faces smoother than this angle share normals. */
  creaseAngle?: number;
}
type Bag = Record<string, unknown>;
const bag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min = -10000, max = 10000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const only = (v: Bag, names: readonly string[]): boolean => Object.keys(v).every(key => names.includes(key));
const vec = (v: unknown): v is Vibi3DVec3 => Array.isArray(v) && v.length === 3 && v.every(item => finite(item));
const points = (v: unknown, minimum: number): v is Vibi3DVec3[] => Array.isArray(v) && v.length >= minimum && v.length <= 128 && v.every(vec);
const planar = (v: unknown): v is Vibi3DVec3[] => points(v, 3) && v.every(point => point[2] === 0);
const ring = (v: Vibi3DVec3[]): Vibi3DPoint2[] => v.map(point => [point[0], point[1]]);
const integer = (v: unknown, min: number, max: number): boolean => finite(v, min, max) && Number.isInteger(v);
function openings(value: unknown, width: number, height: number, thickness: number): value is Vibi3DWallOpening[] {
  if (!Array.isArray(value) || value.length > 32) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const hole: unknown = value[index];
    if (!bag(hole) || !only(hole, ['id', 'x', 'y', 'w', 'h', 'reveal']) || !finite(hole.x, 0, width) || !finite(hole.y, 0, height)
      || !finite(hole.w, 0.001, width) || !finite(hole.h, 0.001, height) || hole.x + hole.w > width || hole.y + hole.h > height
      || (hole.reveal !== undefined && (!finite(hole.reveal, 0, thickness) || hole.reveal * 2 >= Math.min(hole.w, hole.h)))) return false;
    if (hole.id !== undefined) {
      if (typeof hole.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(hole.id) || ids.has(hole.id)) return false;
      ids.add(hole.id);
    }
    const { x, y, w, h } = hole as unknown as Vibi3DWallOpening;
    if (value.slice(0, index).some(old => x < old.x + old.w && x + w > old.x && y < old.y + old.h && y + h > old.y)) return false;
  }
  return true;
}
/** Data-only geometry contract; the application never evaluates agent-provided code. */
export function validateVibi3DRecipe(value: unknown): Vibi3DRecipe | null {
  if (!bag(value) || !(VIBI3D_SHAPES as readonly unknown[]).includes(value.kind)
    || !only(value, ['kind', 'width', 'height', 'depth', 'radius', 'radiusTop', 'tube', 'points', 'bevelRadius', 'bevelSegments', 'holes', 'bevel', 'profile', 'path', 'steps', 'thickness', 'openings', 'creaseAngle'])) return null;
  for (const key of ['width', 'height', 'depth', 'radius', 'radiusTop', 'tube', 'thickness', 'bevelRadius']) {
    if (value[key] !== undefined && (!finite(value[key], 0) || (!['radiusTop', 'bevelRadius'].includes(key) && value[key] === 0))) return null;
  }
  if (value.creaseAngle !== undefined && !finite(value.creaseAngle, 0, 180)) return null;
  if (value.points !== undefined && !points(value.points, 2)) return null;
  if (['lathe', 'extrude', 'path'].includes(String(value.kind)) && !value.points) return null;
  if (value.kind === 'lathe' && (value.points as Vibi3DVec3[]).some(point => point[0] < 0)) return null;
  const limited: Array<[string, string[]]> = [['bevelRadius', ['roundedBox']], ['bevelSegments', ['roundedBox']], ['holes', ['extrude']], ['bevel', ['extrude']],
    ['profile', ['sweep']], ['path', ['sweep']], ['steps', ['stairs']], ['thickness', ['wall']], ['openings', ['wall']]];
  if (limited.some(([key, kinds]) => value[key] !== undefined && !kinds.includes(String(value.kind)))) return null;
  if (value.kind === 'roundedBox') {
    if (value.bevelRadius !== undefined && value.bevelRadius as number > Math.min(Number(value.width ?? 1), Number(value.height ?? 1), Number(value.depth ?? 1)) / 2) return null;
    if (value.bevelSegments !== undefined && !integer(value.bevelSegments, 1, 16)) return null;
  }
  if (value.kind === 'capsule' && Number(value.height ?? 2) < Number(value.radius ?? 0.5) * 2) return null;
  if (value.kind === 'extrude') {
    const profile = value.points as Vibi3DVec3[];
    if (profile.length < 3 || (value.holes !== undefined && (!Array.isArray(value.holes) || value.holes.length > 32 || !value.holes.every(planar)))) return null;
    if (!validVibi3DPolygonHoles(ring(profile), (value.holes as Vibi3DVec3[][] | undefined ?? []).map(ring))) return null;
    if (value.bevel !== undefined) {
      const bevel = value.bevel;
      if (!bag(bevel) || !only(bevel, ['enabled', 'thickness', 'size', 'segments']) || (bevel.enabled !== undefined && typeof bevel.enabled !== 'boolean')
        || (bevel.thickness !== undefined && !finite(bevel.thickness, 0, Number(value.depth ?? 1) / 2))
        || (bevel.size !== undefined && !finite(bevel.size, 0, 100)) || (bevel.segments !== undefined && !integer(bevel.segments, 1, 16))) return null;
    }
  }
  if (value.kind === 'sweep' && (!planar(value.profile) || !isSimpleVibi3DPolygon(ring(value.profile)) || !points(value.path, 2)
    || value.path.some((point, index, path) => index > 0 && point.every((coordinate, axis) => coordinate === path[index - 1]![axis])))) return null;
  if (value.kind === 'stairs' && value.steps !== undefined && !integer(value.steps, 1, 64)) return null;
  if (value.kind === 'wall' && !openings(value.openings ?? [], Number(value.width ?? 1), Number(value.height ?? 1), Number(value.thickness ?? 0.2))) return null;
  return structuredClone(value) as unknown as Vibi3DRecipe;
}
