/** Heat hue is data; lighting only gives it depth. Shared by nodes and legend. */
const mix = (color: string, amount: number, base = '#0d131c'): string =>
  `color-mix(in srgb, ${color} ${amount}%, ${base})`;

export const heatmapFill = (color: string): string => mix(color, 48);

/** A broad lower glow, shaded label area and small reflected light. No animated
 * filters or transparency to the canvas: light/dark themes show the same data. */
export function heatmapMaterial(color: string): string {
  return [
    'radial-gradient(ellipse at 28% 16%, rgb(255 255 255 / 12%), transparent 38%)',
    `radial-gradient(ellipse at 50% 36%, ${mix(color, 20)} 12%, ${mix(color, 28)} 40%, transparent 72%)`,
    `radial-gradient(ellipse at 50% 110%, ${mix(color, 78)} 8%, ${heatmapFill(color)} 52%, ${mix(color, 16)} 88%)`,
  ].join(', ');
}
