import type { CSSProperties } from 'react';
import type { BubbleSkin, NodeStatus } from '@vibisual/shared';

export interface BubbleSurface {
  body: CSSProperties;
  inner: CSSProperties;
  specular: boolean;
  contextOpacity: number;
}

const mix = (color: string, amount: number, base: string) => `color-mix(in srgb, ${color} ${amount}%, ${base})`;

/** Paint only: node bounds, text fitting, context ratio and event targets belong
 * to the existing renderer. Semantic borders win over the chosen surface. */
export function bubbleSurface(
  skin: BubbleSkin,
  color: string,
  glow: string,
  status: NodeStatus,
  options: { highlighted?: boolean; creatingError?: boolean } = {},
): BubbleSurface {
  const surfaces: Record<BubbleSkin, BubbleSurface> = {
    outline: {
      body: { background: '#11151d', borderColor: color, borderWidth: 2.35, boxShadow: 'none' },
      inner: { borderColor: color, borderWidth: .5, opacity: .18 },
      specular: false, contextOpacity: .38,
    },
    signal: {
      body: { background: mix(color, 6, '#0d131c'), borderColor: mix(color, 74, '#e9f4ff'), borderWidth: 1.05, boxShadow: `0 0 5px ${mix(color, 25, 'transparent')}` },
      inner: { borderColor: color, borderWidth: .55, opacity: .2 },
      specular: false, contextOpacity: .46,
    },
    twin: {
      body: { background: mix(color, 5, '#10151d'), borderColor: mix(color, 82, '#d7edff'), borderWidth: 1.05, boxShadow: 'none' },
      inner: { borderColor: color, borderWidth: 1.05, opacity: .84 },
      specular: false, contextOpacity: .4,
    },
    frost: {
      body: { background: mix(color, 3, '#1b2028'), borderColor: '#c7d0dc', borderWidth: 1.3, boxShadow: 'none' },
      inner: { borderColor: color, borderWidth: 1.7, opacity: .83 },
      specular: true, contextOpacity: .46,
    },
    halo: {
      body: { background: mix(color, 7, '#0d131b'), borderColor: mix(color, 70, '#d9f1ff'), borderWidth: .95, boxShadow: `0 0 10px ${mix(glow, 38, 'transparent')}, 0 0 0 5px ${mix(color, 8, 'transparent')}` },
      inner: { borderColor: color, borderWidth: .6, opacity: .12 },
      specular: false, contextOpacity: .48,
    },
  };
  const paint = surfaces[skin];
  const semantic = status === 'active' || status === 'completed' || status === 'error' || status === 'awaiting_permission';
  if (semantic || options.highlighted) {
    // Keep existing Tailwind state/target classes authoritative; an inline
    // border or shadow must never hide activity, permission, failure, completion or hover.
    paint.body.borderColor = undefined;
    paint.body.boxShadow = undefined;
    paint.body.borderWidth = options.highlighted ? 4 : 2;
  }
  if (options.creatingError) {
    paint.body.background = 'radial-gradient(circle at 35% 35%, #fca5a5, #ef4444)';
    paint.inner.opacity = 0;
  }
  return paint;
}
