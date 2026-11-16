import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasControls } from './CanvasControls.js';

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  useStore: (select: (state: unknown) => unknown) => select({ nodesDraggable: true }),
  useStoreApi: () => ({ setState: vi.fn() }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useIsMobile.js', () => ({ useIsNarrowViewport: () => false }));
vi.mock('../../hooks/useHeatScale.js', () => ({ useHeatScale: () => null }));
vi.mock('../Shortcuts/useBindingLabel.js', () => ({ useTitleWithBinding: (label: string) => label }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (state: unknown) => unknown) => select({ activeProject: null }),
}));
vi.mock('../../stores/projectImmersion.js', () => ({
  useProjectImmersionStore: (select: (state: unknown) => unknown) => select({ immersiveProject: null }),
}));

let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });

function Canvas(): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  return createElement(CanvasControls, {
    activityBubblesVisible: visible,
    onToggleActivityBubbles: () => setVisible((current) => !current),
    onTidy: vi.fn(), tidyBusy: false, tidyDisabled: false,
  });
}

describe('canvas activity visibility control', () => {
  it('replaces zoom buttons with a toggle that starts off and updates its name and pressed state', () => {
    act(() => { view = create(createElement(Canvas)); });
    const buttons = (): ReturnType<ReactTestRenderer['root']['findAllByType']> => view!.root.findAllByType('button');
    expect(buttons().some((b) => /zoomIn|zoomOut/.test(b.props['aria-label'] as string))).toBe(false);
    const show = buttons().find((b) => b.props['aria-label'] === 'canvas.bubbleMenu.showBubbles')!;
    expect(show.props['aria-pressed']).toBe(false);
    act(() => show.props.onClick());
    const hide = buttons().find((b) => b.props['aria-label'] === 'canvas.bubbleMenu.hideBubbles')!;
    expect(hide.props['aria-pressed']).toBe(true);
    act(() => hide.props.onClick());
    expect(buttons().find((b) => b.props['aria-label'] === 'canvas.bubbleMenu.showBubbles')?.props['aria-pressed']).toBe(false);
  });
});
