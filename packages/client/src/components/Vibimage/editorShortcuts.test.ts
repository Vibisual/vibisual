import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorKeyHandlers, type EditorShortcutActions } from './editorShortcuts.js';
import type { EditorViewport } from './useEditorViewport.js';

class FakeElement {
  constructor(private readonly tag: string) {}
  matches(selector: string): boolean { return selector.split(',').includes(this.tag); }
  closest(selector: string): FakeElement | null { return selector.split(',').includes(this.tag) ? this : null; }
  isContentEditable = false;
}

function actions(overrides: Partial<EditorShortcutActions> = {}): EditorShortcutActions {
  const viewport = { fit: vi.fn(), actual: vi.fn(), zoomStep: vi.fn() } as unknown as EditorViewport;
  return {
    reviewing: false, hasSelection: true, tool: 'move', viewport,
    undo: vi.fn(), redo: vi.fn(), save: vi.fn(), remove: vi.fn(), duplicate: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(),
    arrange: vi.fn(), nudge: vi.fn(), endNudge: vi.fn(), editText: vi.fn(() => true), setTool: vi.fn(), setPanning: vi.fn(),
    ...overrides,
  };
}
function key(init: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; repeat?: boolean; target?: unknown }) {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, code: '', target: new FakeElement('div'),
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init } as unknown as React.KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

beforeEach(() => { vi.stubGlobal('HTMLElement', FakeElement); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('layer editor keys (§5.13 (R-9) 레이어 편집기 ⑦)', () => {
  it('switches tools by letter, never with a modifier or Alt (Alt belongs to the inspector)', () => {
    const a = actions();
    const h = editorKeyHandlers(a);
    h.onKeyDown(key({ key: 't' })); h.onKeyDown(key({ key: 'U' })); h.onKeyDown(key({ key: 'o', altKey: true }));
    expect(a.setTool).toHaveBeenNthCalledWith(1, 'text');
    expect(a.setTool).toHaveBeenNthCalledWith(2, 'rect');
    expect(a.setTool).toHaveBeenCalledTimes(2);
  });
  it('Ctrl and ⌘ are the same chord; brackets are read by code so keyboard layouts agree', () => {
    const a = actions();
    const h = editorKeyHandlers(a);
    h.onKeyDown(key({ key: 'd', ctrlKey: true })); h.onKeyDown(key({ key: 'a', metaKey: true }));
    h.onKeyDown(key({ key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true })); h.onKeyDown(key({ key: '[', code: 'BracketLeft', metaKey: true }));
    expect(a.duplicate).toHaveBeenCalledOnce();
    expect(a.selectAll).toHaveBeenCalledOnce();
    expect(a.arrange).toHaveBeenNthCalledWith(1, 'front');
    expect(a.arrange).toHaveBeenNthCalledWith(2, 'backward');
  });
  it('nudges 1px, 10px with Shift, and closes the nudge step on key up', () => {
    const a = actions();
    const h = editorKeyHandlers(a);
    h.onKeyDown(key({ key: 'ArrowLeft' })); h.onKeyDown(key({ key: 'ArrowDown', shiftKey: true })); h.onKeyUp(key({ key: 'ArrowDown' }));
    expect(a.nudge).toHaveBeenNthCalledWith(1, -1, 0);
    expect(a.nudge).toHaveBeenNthCalledWith(2, 0, 10);
    expect(a.endNudge).toHaveBeenCalledOnce();
  });
  it('zooms with Shift+1 / Shift+0 / + / − and deselects with Escape', () => {
    const a = actions();
    const h = editorKeyHandlers(a);
    h.onKeyDown(key({ key: '!', code: 'Digit1', shiftKey: true })); h.onKeyDown(key({ key: ')', code: 'Digit0', shiftKey: true }));
    h.onKeyDown(key({ key: '=' })); h.onKeyDown(key({ key: '-' })); h.onKeyDown(key({ key: 'Escape' }));
    expect(a.viewport.fit).toHaveBeenCalledOnce();
    expect(a.viewport.actual).toHaveBeenCalledOnce();
    expect(a.viewport.zoomStep).toHaveBeenNthCalledWith(1, 1);
    expect(a.viewport.zoomStep).toHaveBeenNthCalledWith(2, -1);
    expect(a.clearSelection).toHaveBeenCalledOnce();
  });
  it('holds Space to pan, but a focused button keeps Space and Enter (releasing would press it)', () => {
    const a = actions();
    const h = editorKeyHandlers(a);
    const down = key({ key: ' ', code: 'Space' });
    h.onKeyDown(down); h.onKeyUp(key({ key: ' ', code: 'Space' }));
    expect(down.preventDefault).toHaveBeenCalled();
    expect(a.setPanning).toHaveBeenNthCalledWith(1, true);
    expect(a.setPanning).toHaveBeenNthCalledWith(2, false);
    const onButton = key({ key: ' ', code: 'Space', target: new FakeElement('button') });
    h.onKeyDown(onButton); h.onKeyDown(key({ key: 'Enter', target: new FakeElement('button') }));
    expect(onButton.preventDefault).not.toHaveBeenCalled();
    expect(a.setPanning).toHaveBeenCalledTimes(2);
    expect(a.editText).not.toHaveBeenCalled();
  });
  it('typing fields own their keys; a proposal under review swallows edits', () => {
    const a = actions();
    editorKeyHandlers(a).onKeyDown(key({ key: 'Delete', target: new FakeElement('input') }));
    expect(a.remove).not.toHaveBeenCalled();
    const review = actions({ reviewing: true });
    const del = key({ key: 'Delete' });
    editorKeyHandlers(review).onKeyDown(del); editorKeyHandlers(review).onKeyDown(key({ key: 'd', ctrlKey: true }));
    expect(del.preventDefault).toHaveBeenCalled();
    expect(review.remove).not.toHaveBeenCalled();
    expect(review.duplicate).not.toHaveBeenCalled();
  });
});
