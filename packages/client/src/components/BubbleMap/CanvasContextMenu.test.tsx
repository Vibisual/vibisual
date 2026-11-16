import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { CanvasContextMenu } from './CanvasContextMenu.js';

vi.mock('../../apps/registry.js', () => ({ INTERNAL_APPS: [] }));
vi.mock('./useCanvasMenuPlacement.js', () => ({ useCanvasMenuPlacement: () => 'right' }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useOutsidePressDismiss: () => undefined }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GATED_ROWS = ['createSpec', 'createLab', 'createShelf'].map((k) => `canvas.contextMenu.${k}`);
const initialState = useGraphStore.getState();
let renderer: ReactTestRenderer | undefined;

function mount(debugMode: boolean): string[] {
  const noop = vi.fn();
  act(() => {
    useGraphStore.setState({ debugMode, interiorView: null, currentFolderId: null });
    renderer = create(createElement(CanvasContextMenu, {
      x: 0, y: 0, canvasX: 0, canvasY: 0,
      onCreateCustomAgent: noop, onCreateCmdAgent: noop, onCreateAutoAgent: noop, onCreatePipeline: noop,
      onCreateWorktree: noop, onCreateCapture: noop, onCreateAppBubble: noop, onCreatePlay: noop,
      onCreateSpec: noop, onCreateLab: noop, onCreateShelf: noop, onClose: noop,
    }));
  });
  return renderer!.root.findAllByType('span').flatMap((s) => s.children.filter((c): c is string => typeof c === 'string'));
}

beforeEach(() => {
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  useGraphStore.setState(initialState, true);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  useGraphStore.setState(initialState, true);
  vi.unstubAllGlobals();
});

describe('canvas menu exposure gate', () => {
  it('hides spec board, agent lab and script shelf outside debug mode', () => {
    const rows = mount(false);
    expect(rows).toContain('canvas.contextMenu.createCapture');
    for (const row of GATED_ROWS) expect(rows).not.toContain(row);
  });

  it('shows them in debug mode', () => {
    expect(mount(true)).toEqual(expect.arrayContaining(GATED_ROWS));
  });
});
