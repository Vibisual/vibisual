import type { ArrangeMode } from './imageArrange.js';
import { toolForKey, type EditorTool } from './editorTools.js';
import type { EditorViewport } from './useEditorViewport.js';

/** Space·Enter 는 초점 받은 단추·목록 줄의 것이다(누르기) — 편집기가 가로채면 손을 뗄 때 그 단추가 눌린다. */
function controlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('button,a,[role="option"],[role="tab"]');
}

/** Typing in a field owns its keys (its own undo, its own delete). */
export function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable);
}

export interface EditorShortcutActions {
  /** 시안을 보는 중 — 원본 편집 단축키를 삼킨다(뒤의 원본이 바뀌지 않게). */
  reviewing: boolean;
  hasSelection: boolean;
  undo: () => void;
  redo: () => void;
  save: () => void;
  remove: () => void;
  duplicate: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  arrange: (mode: ArrangeMode) => void;
  nudge: (dx: number, dy: number) => void;
  endNudge: () => void;
  /** Enter — 고른 글자 레이어를 그 자리에서 고친다. */
  editText: () => boolean;
  tool: EditorTool;
  setTool: (tool: EditorTool) => void;
  setPanning: (on: boolean) => void;
  viewport: EditorViewport;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * §5.13 (R-9) 레이어 편집기 ⑦ — 편집기 뿌리의 키. 판정은 `ctrlKey||metaKey`(멀티플랫폼 5축), 표시는 각 단추의 `shortcutLabel()`.
 * Alt 는 인스펙터 몫이라 쓰지 않는다. 대괄호는 자판마다 Shift 글자가 달라 `code` 로 본다.
 */
export function editorKeyHandlers(a: EditorShortcutActions): { onKeyDown: (event: React.KeyboardEvent) => void; onKeyUp: (event: React.KeyboardEvent) => void } {
  const take = (event: React.KeyboardEvent): void => { event.preventDefault(); event.stopPropagation(); };
  return {
    onKeyDown: (event) => {
      if (typingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const name = event.key.toLowerCase();
      if (a.reviewing) {
        // A proposal is being inspected, not the editable source behind it.
        if ((mod && ['s', 'z', 'y', 'd', 'a'].includes(name)) || event.key === 'Delete' || event.key === 'Backspace') take(event);
        return;
      }
      if (mod && name === 'z') { take(event); if (event.shiftKey) a.redo(); else a.undo(); return; }
      if (mod && name === 'y') { take(event); a.redo(); return; }
      if (mod && name === 's') { take(event); a.save(); return; }
      if (mod && name === 'd') { take(event); a.duplicate(); return; }
      if (mod && name === 'a') { take(event); a.selectAll(); return; }
      if (mod && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
        take(event);
        const up = event.code === 'BracketRight';
        a.arrange(event.shiftKey ? (up ? 'front' : 'back') : (up ? 'forward' : 'backward'));
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { if (a.hasSelection) { take(event); a.remove(); } return; }
      const arrow = ARROWS[event.key];
      if (arrow && a.hasSelection) { take(event); const step = event.shiftKey ? 10 : 1; a.nudge(arrow[0] * step, arrow[1] * step); return; }
      if (event.key === 'Escape') {
        if (a.hasSelection) { take(event); a.clearSelection(); } else if (a.tool !== 'move') { take(event); a.setTool('move'); }
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && controlTarget(event.target)) return;
      if (event.key === 'Enter') { if (a.editText()) take(event); return; }
      if (event.key === ' ' || event.code === 'Space') { take(event); if (!event.repeat) a.setPanning(true); return; }
      if (event.shiftKey && event.code === 'Digit1') { take(event); a.viewport.fit(); return; }
      if (event.shiftKey && event.code === 'Digit0') { take(event); a.viewport.actual(); return; }
      if (event.key === '+' || event.key === '=') { take(event); a.viewport.zoomStep(1); return; }
      if (event.key === '-' || event.key === '_') { take(event); a.viewport.zoomStep(-1); return; }
      const tool = event.shiftKey ? null : toolForKey(event.key);
      if (tool) { take(event); a.setTool(tool); }
    },
    onKeyUp: (event) => {
      if ((event.key === ' ' || event.code === 'Space') && !typingTarget(event.target) && !controlTarget(event.target)) { event.preventDefault(); a.setPanning(false); }
      else if (event.key === ' ' || event.code === 'Space') a.setPanning(false);
      if (ARROWS[event.key]) a.endNudge();
    },
  };
}
