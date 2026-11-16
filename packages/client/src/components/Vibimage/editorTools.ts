import type { EditorIconName } from './editorIcons.js';

/** §5.13 (R-9) 레이어 편집기 ① — 왼쪽 도구 막대. 새 도구는 이 표에 한 줄(단축키는 앞 글자가 막대 툴팁에 실린다). */
export type EditorTool = 'move' | 'hand' | 'zoom' | 'text' | 'rect' | 'ellipse';
export type DrawTool = Extract<EditorTool, 'text' | 'rect' | 'ellipse'>;

export interface EditorToolSpec { id: EditorTool; icon: EditorIconName; label: string; keys: readonly string[] }
export const EDITOR_TOOLS: readonly EditorToolSpec[] = [
  { id: 'move', icon: 'move', label: 'toolMove', keys: ['v'] },
  { id: 'hand', icon: 'hand', label: 'toolHand', keys: ['h'] },
  { id: 'zoom', icon: 'zoom', label: 'toolZoom', keys: ['z'] },
  { id: 'text', icon: 'text', label: 'toolText', keys: ['t'] },
  { id: 'rect', icon: 'rect', label: 'toolRect', keys: ['r', 'u'] },
  { id: 'ellipse', icon: 'ellipse', label: 'toolEllipse', keys: ['o', 'e'] },
];

export function isDrawTool(tool: EditorTool): tool is DrawTool {
  return tool === 'text' || tool === 'rect' || tool === 'ellipse';
}
export function toolForKey(key: string): EditorTool | null {
  const k = key.toLowerCase();
  return EDITOR_TOOLS.find((tool) => tool.keys.includes(k))?.id ?? null;
}
