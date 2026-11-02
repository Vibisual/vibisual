import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TidySort } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { useKeymapStore } from '../../stores/keymap.js';
import { CanvasControls } from './CanvasControls.js';

const flow = vi.hoisted(() => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), setState: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => children,
  useReactFlow: () => flow,
  useStoreApi: () => ({ setState: flow.setState }),
  useStore: (selector: (state: { nodesDraggable: boolean; nodesConnectable: boolean; elementsSelectable: boolean }) => unknown) => selector({
    nodesDraggable: true, nodesConnectable: true, elementsSelectable: true,
  }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useIsMobile', () => ({ useIsNarrowViewport: () => false }));
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => undefined,
  appOutputExtensions: () => [],
  workspaceOpenClaims: () => [],
}));

const initialState = useGraphStore.getState();
const initialKeymap = useKeymapStore.getState();
const onTidy = vi.fn<(sort: TidySort) => void>();
const hydrateProject = vi.fn().mockResolvedValue(undefined);
let renderer: ReactTestRenderer | undefined;

function render(): void {
  act(() => { renderer = create(<CanvasControls onTidy={onTidy} tidyBusy={false} tidyDisabled={false} />); });
}

function button(label: string): ReactTestInstance {
  return renderer!.root.findByProps({ 'aria-label': `canvas.controls.${label}` });
}

function heatButton(): ReactTestInstance {
  return renderer!.root.find((node) => node.type === 'button'
    && String(node.props['aria-label']).startsWith('canvas.controls.heatmap'));
}

function click(node: ReactTestInstance): void { act(() => node.props.onClick()); }

function legend(): ReactTestInstance[] {
  return renderer!.root.findAllByProps({ 'aria-label': 'canvas.heatmap.curveLabel' });
}

function sortRows(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.type === 'button'
    && String(node.props.title).startsWith('canvas.tidy.sort.'));
}

function sortRow(sort: TidySort): ReactTestInstance {
  return sortRows().find((node) => node.props.title.startsWith(`canvas.tidy.sort.${sort} `))!;
}

function closePanels(): void {
  act(() => useGraphStore.getState().closeCanvasControlPanels());
}

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState(initialState, true);
  useGraphStore.setState({
    activeProject: 'test-project', hydratingProjects: {}, hydrateProject,
    heatmapMode: false, heatLegendOpen: false, heatAxis: 'read', heatCurve: 'linear',
    readCountRange: { max: 100 }, writeCountRange: { max: 80 },
    readCountQuantiles: [], writeCountQuantiles: [], tidyPanelOpen: false, tidySort: 'status',
  });
  useProjectImmersionStore.getState().exit();
  useKeymapStore.getState().applyOverrides({});
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  useGraphStore.setState(initialState, true);
  useProjectImmersionStore.getState().exit();
  useKeymapStore.setState(initialKeymap, true);
});

describe('CanvasControls dismissible panels', () => {
  it('dismisses both panels without disabling heatmap or losing chosen axis, curve and sort', () => {
    render();
    click(heatButton());
    click(button('tidy'));
    click(renderer!.root.findByProps({ title: 'canvas.heatmap.axisWrite' }));
    act(() => legend()[0]!.props.onChange({ target: { value: 'cbrt' } }));
    click(sortRow('recent'));
    expect(legend()).toHaveLength(1);
    expect(sortRows()).toHaveLength(5);
    expect(onTidy).toHaveBeenCalledExactlyOnceWith('recent');

    closePanels();

    expect(legend()).toHaveLength(0);
    expect(sortRows()).toHaveLength(0);
    expect(useGraphStore.getState()).toMatchObject({
      heatmapMode: true, heatLegendOpen: false, heatAxis: 'write', heatCurve: 'cbrt',
      tidyPanelOpen: false, tidySort: 'recent',
    });
    expect(heatButton().props['aria-pressed']).toBe(true);
    expect(heatButton().props['aria-expanded']).toBe(false);
    expect(button('tidy').props['aria-expanded']).toBe(false);
    expect(onTidy).toHaveBeenCalledTimes(1);
  });

  it('reopens a dismissed legend before toggling heatmap off, then enables both together', () => {
    render();
    click(heatButton());
    act(() => {
      useGraphStore.getState().setHeatAxis('write');
      useGraphStore.getState().setHeatCurve('log');
    });
    closePanels();

    click(heatButton());
    expect(legend()).toHaveLength(1);
    expect(heatButton().props['aria-pressed']).toBe(true);
    expect(heatButton().props['aria-expanded']).toBe(true);
    expect(useGraphStore.getState()).toMatchObject({ heatmapMode: true, heatAxis: 'write', heatCurve: 'log' });

    click(heatButton());
    expect(legend()).toHaveLength(0);
    expect(useGraphStore.getState()).toMatchObject({ heatmapMode: false, heatLegendOpen: false });
    expect(heatButton().props['aria-pressed']).toBe(false);
    expect(heatButton().props['aria-expanded']).toBe(false);

    click(heatButton());
    expect(legend()).toHaveLength(1);
    expect(useGraphStore.getState()).toMatchObject({ heatmapMode: true, heatLegendOpen: true, heatAxis: 'write', heatCurve: 'log' });
    expect(onTidy).not.toHaveBeenCalled();
  });

  it('reopens tidy with the selected criterion and runs only when a criterion is chosen', () => {
    render();
    click(button('tidy'));
    expect(onTidy).not.toHaveBeenCalled();
    click(sortRow('heat'));
    expect(onTidy).toHaveBeenCalledExactlyOnceWith('heat');
    closePanels();

    click(button('tidy'));
    expect(sortRows()).toHaveLength(5);
    expect(sortRow('heat').props['aria-pressed']).toBe(true);
    expect(button('tidy').props['aria-expanded']).toBe(true);
    expect(onTidy).toHaveBeenCalledTimes(1);
    expect(legend()).toHaveLength(0);
    expect(useGraphStore.getState().heatmapMode).toBe(false);

    click(sortRow('lineage'));
    expect(onTidy).toHaveBeenLastCalledWith('lineage');
    expect(onTidy).toHaveBeenCalledTimes(2);
    expect(sortRows()).toHaveLength(5);
  });

  it('keeps panels open while other toolbar controls perform their original actions', () => {
    render();
    click(heatButton());
    click(button('tidy'));
    click(button('zoomIn'));
    click(button('zoomOut'));
    click(button('refresh'));
    click(button('lock'));
    click(button('immersiveMode'));

    expect(flow.zoomIn).toHaveBeenCalledTimes(1);
    expect(flow.zoomOut).toHaveBeenCalledTimes(1);
    expect(hydrateProject).toHaveBeenCalledExactlyOnceWith('test-project');
    expect(flow.setState).toHaveBeenCalledExactlyOnceWith({
      nodesDraggable: false, nodesConnectable: false, elementsSelectable: false,
    });
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('test-project');
    expect(legend()).toHaveLength(1);
    expect(sortRows()).toHaveLength(5);
    expect(useGraphStore.getState()).toMatchObject({ heatmapMode: true, heatLegendOpen: true, tidyPanelOpen: true });
    expect(button('zoomIn').props['aria-expanded']).toBeUndefined();
    expect(onTidy).not.toHaveBeenCalled();
  });
});
