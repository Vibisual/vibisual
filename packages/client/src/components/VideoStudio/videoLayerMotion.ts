/**
 * §5.13 (R-10) — a still editable image becomes a moving scene layer by layer. The image source keeps every layer
 * and adjustment untouched; the motion lives on the video item as `props.layerMotion[layerId]`.
 */
export const LAYER_MOTION_PRESETS = ['none', 'fade', 'rise', 'slide-left', 'slide-right', 'zoom'] as const;
export type LayerMotionPreset = typeof LAYER_MOTION_PRESETS[number];
export interface LayerMotion { preset: LayerMotionPreset; delay: number; duration: number }
export const LAYER_MOTION_DEFAULT: LayerMotion = { preset: 'fade', delay: 0, duration: 0.6 };
const MAX_SECONDS = 600;

function seconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_SECONDS, Math.max(0, value)) : fallback;
}
/** Valid motions only — unknown presets and broken numbers are ignored instead of breaking the render. */
export function readLayerMotions(props: Readonly<Record<string, unknown>> | undefined): Record<string, LayerMotion> {
  const raw = props?.['layerMotion'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, LayerMotion> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const motion = value as Record<string, unknown>;
    const preset = LAYER_MOTION_PRESETS.find((name) => name === motion['preset']);
    if (!preset || preset === 'none') continue;
    out[id] = { preset, delay: seconds(motion['delay'], 0), duration: Math.max(0.05, seconds(motion['duration'], LAYER_MOTION_DEFAULT.duration)) };
  }
  return out;
}
export function hasLayerMotion(props: Readonly<Record<string, unknown>> | undefined): boolean {
  return Object.keys(readLayerMotions(props)).length > 0;
}

export interface LayerPose { opacity: number; dx: number; dy: number; scale: number }
const REST: LayerPose = { opacity: 1, dx: 0, dy: 0, scale: 1 };
/** Pose of one layer `t` seconds into the item; `travel` is how far a slide/rise starts away (in image pixels). */
export function layerPose(motion: LayerMotion | undefined, t: number, travel: number): LayerPose {
  if (!motion || motion.preset === 'none') return REST;
  const raw = (t - motion.delay) / motion.duration;
  const p = Math.min(1, Math.max(0, raw));
  const eased = 1 - (1 - p) ** 3;
  const opacity = raw < 0 ? 0 : eased;
  switch (motion.preset) {
    case 'fade': return { ...REST, opacity };
    case 'rise': return { ...REST, opacity, dy: (1 - eased) * travel };
    case 'slide-left': return { ...REST, opacity, dx: (1 - eased) * travel };
    case 'slide-right': return { ...REST, opacity, dx: -(1 - eased) * travel };
    case 'zoom': return { ...REST, opacity, scale: 0.85 + 0.15 * eased };
    default: return REST;
  }
}
