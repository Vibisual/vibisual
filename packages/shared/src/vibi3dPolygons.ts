export type Vibi3DPoint2 = readonly [number, number];
const EPSILON = 1e-8;
const cross = (a: Vibi3DPoint2, b: Vibi3DPoint2, c: Vibi3DPoint2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onEdge(point: Vibi3DPoint2, a: Vibi3DPoint2, b: Vibi3DPoint2): boolean {
  return Math.abs(cross(a, b, point)) <= EPSILON && point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON
    && point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}
function intersects(a: Vibi3DPoint2, b: Vibi3DPoint2, c: Vibi3DPoint2, d: Vibi3DPoint2): boolean {
  const abC = cross(a, b, c); const abD = cross(a, b, d); const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  const opposite = (left: number, right: number): boolean => (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
  return (opposite(abC, abD) && opposite(cdA, cdB)) || onEdge(a, c, d) || onEdge(b, c, d) || onEdge(c, a, b) || onEdge(d, a, b);
}
function edgesCross(a: readonly Vibi3DPoint2[], b: readonly Vibi3DPoint2[]): boolean {
  return a.some((point, index) => b.some((other, offset) => intersects(point, a[(index + 1) % a.length]!, other, b[(offset + 1) % b.length]!)));
}
function inside(point: Vibi3DPoint2, ring: readonly Vibi3DPoint2[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!; const b = ring[i]!;
    if (onEdge(point, a, b)) return false;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
/** Rings omit the repeated closing vertex. Touching/crossing edges and zero-area rings are rejected. */
export function isSimpleVibi3DPolygon(ring: readonly Vibi3DPoint2[]): boolean {
  if (ring.length < 3 || ring.length > 128) return false;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!; const b = ring[(i + 1) % ring.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersects(a, b, ring[j]!, ring[(j + 1) % ring.length]!)) return false;
    }
  }
  return Math.abs(area) > EPSILON;
}
export function validVibi3DPolygonHoles(outer: readonly Vibi3DPoint2[], holes: readonly (readonly Vibi3DPoint2[])[]): boolean {
  if (!isSimpleVibi3DPolygon(outer) || holes.length > 32 || outer.length + holes.reduce((sum, hole) => sum + hole.length, 0) > 1024) return false;
  return holes.every((hole, index) => isSimpleVibi3DPolygon(hole) && hole.every(point => inside(point, outer)) && !edgesCross(outer, hole)
    && holes.slice(0, index).every(other => !edgesCross(hole, other) && !inside(hole[0]!, other) && !inside(other[0]!, hole)));
}
