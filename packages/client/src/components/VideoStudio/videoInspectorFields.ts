import type { VideoItem } from '@vibisual/video';

export interface InspectorField {
  key: string;
  label: string;
  defaultValue: string | number;
  min?: number;
  max?: number;
  multiline?: boolean;
  list?: boolean;
  options?: readonly string[];
}

// These fields mirror the properties consumed by canvas2d.ts/scenes.ts/audioMix.ts.
// Do not add a property here until a renderer actually consumes it.
const COLOR: InspectorField = { key: 'color', label: 'Color', defaultValue: '#FFFFFF' };
const ACCENT: InspectorField = { key: 'accent', label: 'Accent color', defaultValue: '#3B82F6' };
const FAMILY: InspectorField = { key: 'fontFamily', label: 'Font family', defaultValue: 'sans-serif' };
const FADE: readonly InspectorField[] = [
  { key: 'fadeIn', label: 'Fade in (s)', defaultValue: 0, min: 0 },
  { key: 'fadeOut', label: 'Fade out (s)', defaultValue: 0, min: 0 },
];

const SCENE_FIELDS: Readonly<Record<string, readonly InspectorField[]>> = {
  title: [{ key: 'title', label: 'Title', defaultValue: '', multiline: true }, { key: 'subtitle', label: 'Subtitle', defaultValue: '' }, COLOR, ACCENT],
  lowerThird: [{ key: 'name', label: 'Name', defaultValue: '' }, { key: 'role', label: 'Role', defaultValue: '' }, ACCENT],
  bulletList: [{ key: 'heading', label: 'Heading', defaultValue: '' }, { key: 'items', label: 'List items (one per line)', defaultValue: '', multiline: true, list: true }, ACCENT, { key: 'stagger', label: 'Item delay (s)', defaultValue: 0.28, min: 0 }],
  codeBlock: [{ key: 'lines', label: 'Code', defaultValue: '', multiline: true, list: true }, { ...FAMILY, defaultValue: 'ui-monospace, monospace' }, { key: 'perLine', label: 'Line delay (s)', defaultValue: 0.14, min: 0 }],
  quote: [{ key: 'text', label: 'Text', defaultValue: '', multiline: true }, { key: 'by', label: 'Attribution', defaultValue: '' }, ACCENT],
  solid: [{ key: 'color', label: 'Color', defaultValue: '#0B1120' }],
};

const SCENE_FONT_RATIO: Readonly<Record<string, number>> = { title: 0.085, lowerThird: 0.038, bulletList: 0.045, codeBlock: 0.032, quote: 0.058 };
const KIND_FIELDS: Readonly<Partial<Record<VideoItem['kind'], readonly InspectorField[]>>> = {
  text: [
    { key: 'text', label: 'Text', defaultValue: '', multiline: true }, COLOR, FAMILY,
    { key: 'fontSize', label: 'Font size', defaultValue: 64, min: 1 },
    { key: 'fontWeight', label: 'Font weight', defaultValue: '700', options: ['400', '500', '600', '700', '800', '900'] },
    { key: 'align', label: 'Alignment', defaultValue: 'center', options: ['left', 'center', 'right'] },
    { key: 'lineHeight', label: 'Line height', defaultValue: 1.3, min: 0.1 },
  ],
  shape: [
    { key: 'shape', label: 'Shape', defaultValue: 'rect', options: ['rect', 'ellipse', 'line'] },
    { key: 'fill', label: 'Fill color', defaultValue: '#3B82F6' },
    { key: 'stroke', label: 'Stroke color', defaultValue: '' },
    { key: 'strokeWidth', label: 'Stroke width', defaultValue: 0, min: 0 },
    { key: 'radius', label: 'Corner radius', defaultValue: 0, min: 0 },
  ],
  caption: [COLOR, FAMILY,
    { key: 'fontSize', label: 'Font size', defaultValue: 48, min: 1 },
    { key: 'boxColor', label: 'Caption background', defaultValue: 'rgba(0,0,0,0.62)' },
    { key: 'padding', label: 'Caption padding', defaultValue: 18, min: 0 },
    { key: 'bottom', label: 'Bottom margin', defaultValue: 96, min: 0 },
  ],
  audio: [{ key: 'volume', label: 'Volume', defaultValue: 1, min: 0 }],
  footage: [{ key: 'volume', label: 'Volume', defaultValue: 1, min: 0 }],
};

export const INSPECTOR_OPTION_LABELS: Readonly<Record<string, string>> = {
  left: 'Left', center: 'Center', right: 'Right', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line',
};

export function inspectorFields(item: VideoItem, outputHeight: number, hasAudio?: boolean): readonly InspectorField[] {
  const fields = item.kind === 'scene' ? SCENE_FIELDS[item.sceneId ?? ''] ?? [] : item.kind === 'footage' && hasAudio === false ? [] : KIND_FIELDS[item.kind] ?? [];
  const ratio = item.kind === 'scene' ? SCENE_FONT_RATIO[item.sceneId ?? ''] : undefined;
  const font: readonly InspectorField[] = ratio === undefined ? [] : [{ key: 'fontSize', label: 'Font size', defaultValue: Math.round(outputHeight * ratio), min: 1 }];
  return [...fields, ...font, ...FADE];
}
