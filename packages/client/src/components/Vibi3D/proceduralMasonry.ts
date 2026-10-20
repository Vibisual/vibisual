/** Distance to the complete interlocking joint, including the two short horizontal connectors. */
export function interlockingJointDistance(fx: number, fy: number, width: number, height: number): number {
  const x = fx * width, y = fy * height, lower = height * 0.25, upper = height * 0.75, inset = width * 0.13;
  let squared = Math.min(y, height - y) ** 2;
  const segment = (left: number, bottom: number, right: number, top: number): void => {
    const dx = x - Math.max(left, Math.min(right, x)), dy = y - Math.max(bottom, Math.min(top, y));
    squared = Math.min(squared, dx * dx + dy * dy);
  };
  for (const edge of [0, width]) {
    segment(edge, 0, edge, lower); segment(edge, upper, edge, height);
    segment(edge - inset, lower, edge - inset, upper);
    segment(edge - inset, lower, edge, lower); segment(edge - inset, upper, edge, upper);
  }
  return Math.sqrt(squared);
}

/** groutWidth is the complete joint width; antialias narrow joints without inventing a thick dark border. */
export function masonryJointMasks(distance: number, groutWidth: number, bevelWidth: number, texel: number): { grout: number; bevel: number } {
  const half = groutWidth / 2, radius = texel / 2;
  const coverage = Math.max(0, Math.min(half, distance + radius) - Math.max(-half, distance - radius)) / texel;
  const ramp = Math.max(0, Math.min(1, (half + bevelWidth + radius * 0.5 - distance) / (bevelWidth + radius * 0.5)));
  return { grout: coverage, bevel: ramp * ramp * (3 - 2 * ramp) };
}
