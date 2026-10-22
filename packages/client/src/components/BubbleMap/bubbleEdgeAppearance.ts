import type { CSSProperties } from 'react';
import { REDUCED_MOTION_LOOP_SLOWDOWN, type BubbleEdgeStyle } from '@vibisual/shared';
import './bubbleEdgeAppearance.css';

/** §5.4 #31 (K): a moving dash offset repaints every tile it crosses, so travel moves 24 times a second. */
const FLOW_STEPS_PER_SECOND = 24;

function flowAnimation(variant: BubbleEdgeStyle, seconds: number): string {
  const s = Math.round(seconds * 1000) / 1000;
  return `bubble-edge-${variant}-flow ${s}s steps(${Math.round(s * FLOW_STEPS_PER_SECOND)}, end) infinite`;
}

/** Paint layers only: callers retain the one original path, marker and hit area. */
export interface BubbleEdgePaintLayer {
  role: 'underlay' | 'line' | 'travel';
  style: CSSProperties;
}

interface EdgePaintOptions {
  semantic: 'activity' | 'task';
  /** Includes the existing activity color/alpha, kind width and link-focus multipliers. */
  base: CSSProperties | undefined;
  active?: boolean;
}

/**
 * Approved E1–E5 paint, independent of endpoint geometry and business status.
 * Widths scale with the original edge so inactive/Artifact/focused widths keep
 * their hierarchy. A neutral inactive stroke is never replaced with a role hue.
 */
export function bubbleEdgeAppearance(variant: BubbleEdgeStyle, options: EdgePaintOptions): BubbleEdgePaintLayer[] {
  const { semantic, base, active = false } = options;
  const color = base?.stroke ?? '#64748b';
  const width = typeof base?.strokeWidth === 'number' ? base.strokeWidth : 2.5;
  const scale = width / 2.5;
  const opacity = typeof base?.opacity === 'number' ? base.opacity : 1;
  const common: CSSProperties = {
    ...base, fill: 'none', pointerEvents: 'none', strokeLinecap: 'round', strokeLinejoin: 'round',
    animation: 'none', strokeDasharray: 'none',
  };
  const layer = (
    role: BubbleEdgePaintLayer['role'], thickness: number, alpha: number, extra: CSSProperties = {},
  ): BubbleEdgePaintLayer => ({
    role,
    style: { ...common, stroke: color, strokeWidth: thickness * scale, opacity: opacity * alpha, ...extra },
  });

  if (semantic === 'task') {
    const dash = base?.strokeDasharray ?? '6 4';
    const layers: BubbleEdgePaintLayer[] = [];
    if (variant === 'glow' || variant === 'rail') {
      layers.push(layer('underlay', variant === 'glow' ? 5 : 4, variant === 'glow' ? .15 : .36,
        { strokeDasharray: dash }));
    }
    const thickness = { wire: 1.6, dash: 2.15, beads: 2.25, glow: 1.8, rail: 1.2 }[variant];
    layers.push(layer('line', thickness, 1, {
      strokeDasharray: dash, strokeLinecap: variant === 'dash' ? 'butt' : 'round',
    }));
    return layers;
  }

  const layers: BubbleEdgePaintLayer[] = [];
  if (variant === 'beads') layers.push(layer('underlay', .65, .24));
  if (variant === 'glow') layers.push(layer('underlay', 6.5, .16));
  if (variant === 'rail') layers.push(layer('underlay', 4.5, .9));

  const lineStyles: Record<BubbleEdgeStyle, CSSProperties> = {
    wire: {},
    dash: { strokeDasharray: '10 6', strokeLinecap: 'butt' },
    beads: { strokeDasharray: '0 9.5' },
    glow: { stroke: active ? `color-mix(in srgb, ${color} 60%, #e7f3ff)` : color },
    rail: { stroke: 'var(--color-vb-canvas, #0b0b0b)' },
  };
  const thickness = { wire: 1.2, dash: 2.15, beads: 3.1, glow: 1.55, rail: 2.15 }[variant];
  const alpha = { wire: .86, dash: .88, beads: .9, glow: .96, rail: 1 }[variant];
  layers.push(layer('line', thickness, alpha, lineStyles[variant]));

  if (active) {
    const flow = {
      wire: { width: 1.7, dash: '2 34', duration: 3.6 },
      dash: { width: 2.5, dash: '2 30', duration: 2.4 },
      beads: { width: 3.7, dash: '0 38', duration: 2.4 },
      glow: { width: 2, dash: '8 92', duration: 4 },
      rail: { width: .9, dash: '3 33', duration: 3.6 },
    }[variant];
    layers.push(layer('travel', flow.width, .95, {
      stroke: `color-mix(in srgb, ${color} 36%, #f3f8ff)`,
      strokeDasharray: flow.dash,
      strokeLinecap: variant === 'dash' ? 'butt' : 'round',
      animation: flowAnimation(variant, flow.duration),
      // Reduced motion slows this same flow instead of stopping it; bubbleEdgeAppearance.css swaps it in.
      ['--bubble-edge-flow-reduced' as string]: flowAnimation(variant, flow.duration * REDUCED_MOTION_LOOP_SLOWDOWN),
    }));
  }
  return layers;
}

/** Preserve original markerUnits scaling and opacity on the one BaseEdge.
 * Its invisible center stroke must not receive React Flow's animated dash. */
export function bubbleEdgeMarkerStyle(base: CSSProperties | undefined): CSSProperties {
  return { ...base, stroke: 'transparent', strokeDasharray: 'none', animation: 'none' };
}
