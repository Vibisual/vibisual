import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasContextMenu } from './CanvasContextMenu.js';
import { useGraphStore } from '../../stores/graphStore.js';

vi.mock('./useCanvasMenuPlacement.js', () => ({ useCanvasMenuPlacement: () => 'right' }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useOutsidePressDismiss: () => undefined }));
vi.mock('react-i18next', async original => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

let view: ReactTestRenderer | undefined;
const initialState = useGraphStore.getState();
afterEach(() => { act(() => view?.unmount()); view = undefined; useGraphStore.setState(initialState, true); vi.unstubAllGlobals(); });

describe('memo entry in the real canvas app menu', () => {
  it('opens Apps and creates a memo bubble at the chosen canvas location', () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const createApp = vi.fn(), close = vi.fn(), noop = vi.fn();
    act(() => {
      useGraphStore.setState({ debugMode: false, interiorView: null, currentFolderId: null });
      view = create(createElement(CanvasContextMenu, {
        x: 30, y: 40, canvasX: 100, canvasY: 200,
        onCreateCustomAgent: noop, onCreateCmdAgent: noop, onCreateAutoAgent: noop,
        onCreatePipeline: noop, onCreateWorktree: noop, onCreateCapture: noop,
        onCreateAppBubble: createApp, onCreatePlay: noop, onCreateSpec: noop,
        onCreateLab: noop, onCreateShelf: noop, onClose: close,
      }));
    });
    const apps = view!.root.findAllByType('button').find(button => button.findAllByType('span').some(span => span.children.includes('canvas.contextMenu.apps')))!;
    act(() => apps.props.onClick());
    expect(apps.props['aria-expanded']).toBe(true);
    const memo = view!.root.findAllByType('button').find(button => button.findAllByType('span').some(span => span.children.includes('panel.apps.memo.name')));
    expect(memo).toBeDefined();
    act(() => memo!.props.onClick());
    expect(createApp).toHaveBeenCalledWith('memo', 100, 200);
    expect(close).toHaveBeenCalledOnce();
  });
});
