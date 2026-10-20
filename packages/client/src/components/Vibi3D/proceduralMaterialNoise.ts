/** Integer mixing keeps the generated pixels independent of the OS, GPU and random state. */
export function materialHash(seed: number, x: number, y: number, salt = 0): number {
  let value = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
export const unitHash = (seed: number, x: number, y: number, salt = 0): number => materialHash(seed, x, y, salt) / 4294967295;
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const fract = (value: number): number => value - Math.floor(value);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
const wrap = (value: number, period: number): number => ((value % period) + period) % period;
const smooth = (value: number): number => value * value * (3 - 2 * value);

/** Periodic lattice noise: wrapping the texture does not introduce a new random seam. */
export function materialNoise(seed: number, u: number, v: number, columns: number, rows = columns, salt = 0): number {
  const x = u * columns, y = v * rows, left = Math.floor(x), top = Math.floor(y);
  const tx = smooth(fract(x)), ty = smooth(fract(y));
  const read = (a: number, b: number) => unitHash(seed, wrap(a, columns), wrap(b, rows), salt);
  return mix(mix(read(left, top), read(left + 1, top), tx), mix(read(left, top + 1), read(left + 1, top + 1), tx), ty);
}
/** A bake reuses the same lattice millions of times; cache its hashes, never the sampled pixels. */
export function materialNoiseSampler(seed: number): (u: number, v: number, columns: number, rows?: number, salt?: number) => number {
  const grids = new Map<number, Float64Array>();
  return (u, v, columns, rows = columns, salt = 0) => {
    const key = columns * 4194304 + rows * 2048 + salt;
    let grid = grids.get(key);
    const stride = columns + 1;
    if (!grid) {
      grid = new Float64Array(stride * (rows + 1));
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) grid[y * stride + x] = unitHash(seed, x % columns, y % rows, salt);
      grids.set(key, grid);
    }
    const x = u * columns, y = v * rows, floorX = Math.floor(x), floorY = Math.floor(y);
    const left = floorX < 0 || floorX >= columns ? wrap(floorX, columns) : floorX;
    const top = floorY < 0 || floorY >= rows ? wrap(floorY, rows) : floorY;
    const tx = smooth(x - floorX), ty = smooth(y - floorY), index = top * stride + left;
    return mix(mix(grid[index]!, grid[index + 1]!, tx), mix(grid[index + stride]!, grid[index + stride + 1]!, tx), ty);
  };
}
/** Bounded periodic octaves: large variation and fine detail remain independent instead of becoming pixel noise. */
export function materialFractal(seed: number, u: number, v: number, columns: number, rows = columns, salt = 0, limit = 128): number {
  let value = 0, total = 0, amplitude = 1;
  for (let octave = 0; octave < 4; octave++) {
    const x = Math.max(1, Math.min(limit, Math.round(columns * 2 ** octave)));
    const y = Math.max(1, Math.min(limit, Math.round(rows * 2 ** octave)));
    value += materialNoise(seed, u, v, x, y, salt + octave) * amplitude;
    total += amplitude; amplitude *= 0.48;
  }
  return value / total;
}
export type MaterialRGB = readonly [number, number, number];
export function materialRGB(hex: string): MaterialRGB {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
export function mixMaterialRGB(a: MaterialRGB, b: MaterialRGB, t: number): MaterialRGB {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
