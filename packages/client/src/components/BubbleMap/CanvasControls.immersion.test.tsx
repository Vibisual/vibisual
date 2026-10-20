import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { CanvasControls } from './CanvasControls.js';
import { useKeymapStore } from '../../stores/keymap.js';

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  setState: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => children,
  useReactFlow: () => flow,
  useStoreApi: () => ({ setState: flow.setState }),
  useStore: (selector: (state: { nodesDraggable: boolean; nodesConnectable: boolean; elementsSelectable: boolean }) => unknown) => selector({
    nodesDraggable: true, nodesConnectable: true, elementsSelectable: true,
  }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsNarrowViewport: () => false }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

let renderer: ReactTestRenderer | undefined;

function render(): void {
  act(() => { renderer = create(<CanvasControls onTidy={vi.fn()} tidyBusy={false} tidyDisabled={false} />); });
}

function button(label: string): ReactTestInstance {
  return renderer!.root.findByProps({ 'aria-label': `canvas.controls.${label}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectImmersionStore.getState().exit();
  useKeymapStore.getState().applyOverrides({});
  useGraphStore.setState({
    activeProject: 'project-a',
    hydratingProjects: {},
    heatmapMode: false,
    tidyPanelOpen: false,
    toggleHeatmapMode: vi.fn(),
    toggleTidyPanel: vi.fn(),
    setTidySort: vi.fn(),
  });
});

afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  useProjectImmersionStore.getState().exit();
});

describe('CanvasControls project immersion button', () => {
  it('toggles the current project with an updated pressed state and exit label without fitting the canvas', () => {
    render();
    expect(button('immersiveMode').props['aria-pressed']).toBe(false);
    expect(button('immersiveMode').props.disabled).toBe(false);
    expect(button('immersiveMode').props.title).toBe('canvas.controls.immersiveMode (F11)');

    act(() => { button('immersiveMode').props.onClick(); });
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    expect(button('exitImmersiveMode').props['aria-pressed']).toBe(true);
    expect(button('exitImmersiveMode').props.title).toBe('canvas.controls.exitImmersiveMode (F11)');

    act(() => { button('exitImmersiveMode').props.onClick(); });
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(button('immersiveMode').props['aria-pressed']).toBe(false);
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.zoomIn).not.toHaveBeenCalled();
    expect(flow.zoomOut).not.toHaveBeenCalled();
  });

  it('disables immersion when there is no active project and ignores a stale click', () => {
    useGraphStore.setState({ activeProject: null });
    render();
    expect(button('immersiveMode').props.disabled).toBe(true);

    act(() => { button('immersiveMode').props.onClick(); });
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(flow.fitView).not.toHaveBeenCalled();
  });

  it('updates the hover hint when the same command is remapped or unbound', () => {
    render();
    act(() => { useKeymapStore.getState().applyOverrides({ 'global.projectImmersion': 'F10' }); });
    expect(button('immersiveMode').props.title).toBe('canvas.controls.immersiveMode (F10)');
    act(() => { useKeymapStore.getState().applyOverrides({ 'global.projectImmersion': null }); });
    expect(button('immersiveMode').props.title).toBe('canvas.controls.immersiveMode');
  });
});
