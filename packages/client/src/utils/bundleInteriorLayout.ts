import { packBundleGeometry } from '@vibisual/compute';
import type { XYPosition } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { BUNDLE_BUBBLE, FILE_FACE, fileFaceKindOf } from '@vibisual/shared';
import { calcBubbleSize, fileUsageOf } from './sizeCalc.js';

const CAPTION_WIDE_CHAR_PX = 12;
const CAPTION_NARROW_CHAR_PX = 7;
const CAPTION_WIDE_CODE_POINT = 0x1100;
const CAPTION_DURATION_PX = 44;
const LAYOUT_CACHE_MAX = 8;
const TOUCH_EPSILON = 1e-6;
const CONFIG_VALUES = 7;

export function captionWidthOf(bubble: Pick<BubbleData, 'label' | 'path' | 'absolutePath'>, diameter: number): number {
  let width = 0;
  for (const ch of bubble.label ?? '') {
    width += (ch.codePointAt(0) ?? 0) >= CAPTION_WIDE_CODE_POINT ? CAPTION_WIDE_CHAR_PX : CAPTION_NARROW_CHAR_PX;
  }
  const kind = fileFaceKindOf(bubble.absolutePath || bubble.path || bubble.label || '');
  if (kind === 'video' || kind === 'audio') width += CAPTION_DURATION_PX;
  return Math.min(width, Math.max(diameter * FILE_FACE.captionMaxWidth.ratio, FILE_FACE.captionMaxWidth.min));
}

function compareMembers(a: BubbleData, b: BubbleData): number {
  return (fileUsageOf(b) - fileUsageOf(a))
    || ((b.lastActivity ?? 0) - (a.lastActivity ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface BundlePackingPlan {
  readonly signature: string;
  readonly ids: readonly string[];
  readonly input: Float64Array;
  readonly directions: number;
  readonly backId: string | null;
  readonly backSize: number;
}

/** UI objects stay here. The worker receives contiguous numeric geometry only. */
export function prepareBundleInterior(
  members: readonly BubbleData[],
  back: BubbleData | null,
  center: { readonly x: number; readonly y: number },
  heat: HeatScale | undefined,
): BundlePackingPlan {
  const order = [...members].sort(compareMembers);
  const directions = Math.max(4, BUNDLE_BUBBLE.interiorSeatDirections);
  const input = new Float64Array(CONFIG_VALUES + order.length * 2 + directions * 2);
  input.set([center.x, center.y, BUNDLE_BUBBLE.interiorGap, BUNDLE_BUBBLE.interiorAspect,
    FILE_FACE.captionGap, FILE_FACE.captionLineHeight, TOUCH_EPSILON]);
  const backSize = back ? calcBubbleSize(back, undefined, heat) : 0;
  let signature = `${center.x},${center.y},${back?.id ?? ''}:${backSize}|`;
  const ids: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const member = order[i]!;
    const diameter = calcBubbleSize(member, undefined, heat);
    const radius = diameter / 2;
    const half = captionWidthOf(member, diameter) / 2;
    ids.push(member.id);
    input[CONFIG_VALUES + i * 2] = radius;
    input[CONFIG_VALUES + i * 2 + 1] = half;
    signature += `${i === 0 ? '' : '|'}${member.id}:${radius}:${half}`;
  }
  for (let k = 0; k < directions; k++) {
    const angle = (2 * Math.PI * k) / directions;
    // Host trig preserves the reference's candidate coordinates bit for bit.
    input[CONFIG_VALUES + order.length * 2 + k * 2] = Math.cos(angle);
    input[CONFIG_VALUES + order.length * 2 + k * 2 + 1] = Math.sin(angle);
  }
  return { signature, ids, input, directions, backId: back?.id ?? null, backSize };
}

const layoutCache = new Map<string, Map<string, XYPosition>>();

export function cachedBundleInterior(plan: BundlePackingPlan): Map<string, XYPosition> | undefined {
  return layoutCache.get(plan.signature);
}

export function finishBundleInterior(plan: BundlePackingPlan, output: Float64Array): Map<string, XYPosition> {
  if (output.length !== plan.ids.length * 2 + 2) throw new Error('Invalid Rust bundle result');
  const positions = new Map<string, XYPosition>();
  for (let i = 0; i < plan.ids.length; i++) positions.set(plan.ids[i]!, { x: output[i * 2]!, y: output[i * 2 + 1]! });
  if (plan.backId !== null) positions.set(plan.backId, {
    x: output[plan.ids.length * 2]! - BUNDLE_BUBBLE.interiorGap * 2 - plan.backSize,
    y: output[plan.ids.length * 2 + 1]! - plan.backSize / 2,
  });
  if (layoutCache.size >= LAYOUT_CACHE_MAX) {
    const oldest = layoutCache.keys().next().value;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  layoutCache.set(plan.signature, positions);
  return positions;
}

/** Synchronous entry for numerical verification. Interactive views use the worker. */
export function packBundleInterior(
  members: readonly BubbleData[], back: BubbleData | null,
  center: { readonly x: number; readonly y: number }, heat: HeatScale | undefined,
): Map<string, XYPosition> {
  const plan = prepareBundleInterior(members, back, center, heat);
  return cachedBundleInterior(plan) ?? finishBundleInterior(plan, packBundleGeometry(plan.input, plan.ids.length, plan.directions));
}
