import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor, type CodeEditorBodyMenuContext } from './CodeEditor.js';
import { installInputCompositionGuard } from '../../utils/inputComposition.js';

vi.mock('../../hooks/useCommand.js', () => ({ useCommand: () => undefined }));
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));

afterEach(() => { vi.unstubAllGlobals(); });

function fixture(): {
  renderer: ReactTestRenderer; field: HTMLTextAreaElement; change: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>; actions: CodeEditorBodyMenuContext['actions'];
  resolveClipboard: (value: string) => void; dispose: () => void; compose: () => void;
} {
  const view = Object.assign(new EventTarget(), { requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn() });
  const dispose = installInputCompositionGuard(view as unknown as Window);
  const exec = vi.fn(() => false);
  const document = { activeElement: null as unknown, execCommand: exec, defaultView: view };
  vi.stubGlobal('document', document);
  let resolveClipboard: (value: string) => void = () => undefined;
  vi.stubGlobal('navigator', { clipboard: { readText: () => new Promise<string>((resolve) => { resolveClipboard = resolve; }) } });
  const field = Object.assign(new EventTarget(), {
    tagName: 'TEXTAREA', value: 'a😀b', selectionStart: 1, selectionEnd: 3, isConnected: true,
    ownerDocument: document, focus: () => { document.activeElement = field; }, select: vi.fn(),
    setSelectionRange: (start: number, end: number) => { field.selectionStart = start; field.selectionEnd = end; },
  }) as unknown as HTMLTextAreaElement;
  document.activeElement = field;
  const change = vi.fn();
  let actions: CodeEditorBodyMenuContext['actions'] | undefined;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(CodeEditor, {
      text: field.value, language: 'text', readOnly: false, onChange: change, onSave: vi.fn(),
      buildBodyMenu: (ctx) => { actions = ctx.actions; return []; },
    }), { createNodeMock: (node) => node.type === 'textarea' ? field : {} });
  });
  act(() => renderer.root.findByType('textarea').props.onContextMenu({
    currentTarget: field, preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 0, clientY: 0,
  }));
  return {
    renderer, field, change, exec, actions: actions!, resolveClipboard: (value) => resolveClipboard(value),
    dispose: () => { act(() => renderer.unmount()); dispose(); },
    compose: () => {
      const event = new Event('compositionstart');
      Object.defineProperty(event, 'target', { value: field }); view.dispatchEvent(event);
    },
  };
}

describe('CodeEditor uses the original live input surface', () => {
  it('candidate Tab never indents and regular Tab still does', () => {
    const h = fixture(); const preventDefault = vi.fn();
    const press = (nativeEvent: { keyCode?: number; isComposing?: boolean }) => act(() => {
      h.renderer.root.findByType('textarea').props.onKeyDown({ key: 'Tab', currentTarget: h.field, nativeEvent, preventDefault });
    });
    press({ keyCode: 229 }); press({ isComposing: true });
    expect(h.change).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
    press({ keyCode: 9 }); expect(h.change).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it.each(['another field', 'changed value', 'changed selection', 'detached', 'composition'])(
    'late paste is cancelled after %s', async (reason) => {
      const h = fixture(); h.actions.paste();
      if (reason === 'another field') Object.defineProperty(h.field.ownerDocument, 'activeElement', { value: {} });
      else if (reason === 'changed value') h.field.value = 'new';
      else if (reason === 'changed selection') h.field.selectionStart = h.field.selectionEnd = 4;
      else if (reason === 'detached') Object.defineProperty(h.field, 'isConnected', { value: false });
      else h.compose();
      await act(async () => { h.resolveClipboard('日本語'); await Promise.resolve(); });
      expect(h.change).not.toHaveBeenCalled(); expect(h.exec).not.toHaveBeenCalled();
      h.dispose();
    },
  );

  it('a valid asynchronous paste keeps the full Unicode text', async () => {
    const h = fixture(); h.actions.paste();
    await act(async () => { h.resolveClipboard('한글 e\u0301 عربي'); await Promise.resolve(); });
    expect(h.change).toHaveBeenCalledWith('a한글 e\u0301 عربيb');
    h.dispose();
  });

  it('composing selection does not run undo/redo or selectAll on another active field', () => {
    const h = fixture(); h.compose();
    h.actions.undo(); h.actions.redo(); h.actions.selectAll();
    expect(h.exec).not.toHaveBeenCalled(); expect(h.field.select).not.toHaveBeenCalled();
    h.dispose();
  });
});
