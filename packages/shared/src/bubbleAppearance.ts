/** Canvas paint choices. Shape, content, behavior and status meaning stay independent. */
export const BUBBLE_SKINS = [
  { id: 'outline', name: 'Outline', i18nKey: 'options.appearance.bubbleSkins.outline' },
  { id: 'signal', name: 'Signal Rim', i18nKey: 'options.appearance.bubbleSkins.signal' },
  { id: 'twin', name: 'Twin Rim', i18nKey: 'options.appearance.bubbleSkins.twin' },
  { id: 'frost', name: 'Frost Rim', i18nKey: 'options.appearance.bubbleSkins.frost' },
  { id: 'halo', name: 'Halo Rim', i18nKey: 'options.appearance.bubbleSkins.halo' },
] as const;

export const BUBBLE_EDGE_STYLES = [
  { id: 'wire', name: 'Fine Wire', i18nKey: 'options.appearance.edgeStyles.wire' },
  { id: 'dash', name: 'Signal Dash', i18nKey: 'options.appearance.edgeStyles.dash' },
  { id: 'beads', name: 'Dot Chain', i18nKey: 'options.appearance.edgeStyles.beads' },
  { id: 'glow', name: 'Soft Glow', i18nKey: 'options.appearance.edgeStyles.glow' },
  { id: 'rail', name: 'Dual Rail', i18nKey: 'options.appearance.edgeStyles.rail' },
] as const;

export type BubbleSkin = (typeof BUBBLE_SKINS)[number]['id'];
export type BubbleEdgeStyle = (typeof BUBBLE_EDGE_STYLES)[number]['id'];

/** Missing preferences use these values without rewriting an existing settings file. */
export const DEFAULT_BUBBLE_SKIN: BubbleSkin = 'signal';
export const DEFAULT_BUBBLE_EDGE_STYLE: BubbleEdgeStyle = 'dash';

export function resolveBubbleSkin(value: unknown): BubbleSkin {
  return BUBBLE_SKINS.find(skin => skin.id === value)?.id ?? DEFAULT_BUBBLE_SKIN;
}

export function resolveBubbleEdgeStyle(value: unknown): BubbleEdgeStyle {
  return BUBBLE_EDGE_STYLES.find(style => style.id === value)?.id ?? DEFAULT_BUBBLE_EDGE_STYLE;
}
