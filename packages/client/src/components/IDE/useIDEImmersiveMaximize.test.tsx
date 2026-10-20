import { useCallback, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { useIDEImmersiveMaximize } from './useIDEImmersiveMaximize.js';

type Options = Parameters<typeof useIDEImmersiveMaximize>[0];
type PaneOptions = Partial<Pick<Options, 'project' | 'paneKey' | 'enabled'>> & { initialMaximized?: boolean };
type PaneState = ReturnType<typeof useIDEImmersiveMaximize> & { maximized: boolean };
const renderers = new Set<ReactTestRenderer>();

function mountPane(options: PaneOptions = {}) {
  let current!: PaneState;
  let setMaximized!: (value: boolean) => void;
  let renderer!: ReactTestRenderer;
  const onMaximized = vi.fn();

  function Probe(): null {
    const [maximized, updateMaximized] = useState(options.initialMaximized ?? false);
    setMaximized = updateMaximized;
    const handleMaximized = useCallback((value: boolean): void => {
      onMaximized(value);
      updateMaximized(value);
    }, []);
    current = {
      ...useIDEImmersiveMaximize({
        project: 'project-a',
        paneKey: 'pane-a',
        ...options,
        maximized,
        onMaximized: handleMaximized,
      }),
      maximized,
    };
    return null;
  }

  act(() => { renderer = create(<Probe />); });
  renderers.add(renderer);
  return {
    get state(): PaneState { return current; },
    onMaximized,
    cycle(): void { act(() => { current.cycle(); }); },
    setMaximized(value: boolean): void { act(() => { setMaximized(value); }); },
    unmount(): void {
      act(() => { renderer.unmount(); });
      renderers.delete(renderer);
    },
  };
}

beforeEach(() => { useProjectImmersionStore.getState().exit(); });

afterEach(() => {
  act(() => { for (const renderer of renderers) renderer.unmount(); });
  renderers.clear();
  useProjectImmersionStore.getState().exit();
});

describe('IDE immersive maximize', () => {
  it('cycles through normal, maximized, immersive fullscreen and back to normal', () => {
    const pane = mountPane();
    expect(pane.state).toMatchObject({
      maximized: false, immersive: false, hidden: false, fillsWindow: false, nextAction: 'maximize',
    });

    pane.cycle();
    expect(pane.state).toMatchObject({
      maximized: true, immersive: false, hidden: false, fillsWindow: false, nextAction: 'immerse',
    });
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(pane.onMaximized.mock.calls).toEqual([[true]]);

    pane.cycle();
    expect(pane.state).toMatchObject({
      maximized: true, immersive: true, hidden: false, fillsWindow: true, nextAction: 'restore',
    });
    expect(useProjectImmersionStore.getState().immersiveIDE).toEqual({ project: 'project-a', paneKey: 'pane-a' });
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(pane.onMaximized.mock.calls).toEqual([[true]]);

    pane.cycle();
    expect(pane.state).toMatchObject({
      maximized: false, immersive: false, hidden: false, fillsWindow: false, nextAction: 'maximize',
    });
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(pane.onMaximized.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps two size stages when the project is already immersive and preserves project immersion', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    const pane = mountPane();
    expect(pane.state).toMatchObject({ maximized: false, fillsWindow: false, nextAction: 'maximize' });

    pane.cycle();
    expect(pane.state).toMatchObject({
      maximized: true, immersive: false, hidden: false, fillsWindow: true, nextAction: 'restore',
    });
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();

    pane.cycle();
    expect(pane.state).toMatchObject({
      maximized: false, immersive: false, hidden: false, fillsWindow: false, nextAction: 'maximize',
    });
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(pane.onMaximized.mock.calls).toEqual([[true], [false]]);
  });

  it('shows the immersive owner and hides other panes until the owner restores', () => {
    const owner = mountPane();
    const sibling = mountPane({ paneKey: 'pane-b' });
    const otherProject = mountPane({ project: 'project-b', paneKey: 'pane-c' });
    owner.cycle();
    expect(sibling.state.hidden).toBe(false);
    expect(otherProject.state.hidden).toBe(false);

    owner.cycle();
    expect(owner.state).toMatchObject({ hidden: false, immersive: true, fillsWindow: true });
    expect(sibling.state).toMatchObject({ hidden: true, immersive: false, fillsWindow: false });
    expect(otherProject.state).toMatchObject({ hidden: true, immersive: false, fillsWindow: false });

    owner.cycle();
    expect(owner.state.hidden).toBe(false);
    expect(sibling.state.hidden).toBe(false);
    expect(otherProject.state.hidden).toBe(false);
  });

  it('keeps all project panes usable during project immersion without assigning an IDE owner', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    const first = mountPane();
    const second = mountPane({ paneKey: 'pane-b' });
    expect(first.state.hidden).toBe(false);
    expect(second.state.hidden).toBe(false);

    first.cycle();
    expect(first.state).toMatchObject({ hidden: false, maximized: true, fillsWindow: true });
    expect(second.state).toMatchObject({ hidden: false, maximized: false, fillsWindow: false });

    second.cycle();
    expect(first.state).toMatchObject({ hidden: false, maximized: true, fillsWindow: true });
    expect(second.state).toMatchObject({ hidden: false, maximized: true, fillsWindow: true });
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
  });

  it('exits the third stage when dragging, docking or another layout action clears maximized', () => {
    const owner = mountPane();
    const sibling = mountPane({ paneKey: 'pane-b' });
    owner.cycle();
    owner.cycle();
    expect(sibling.state.hidden).toBe(true);

    owner.setMaximized(false);
    expect(owner.state).toMatchObject({
      maximized: false, immersive: false, hidden: false, fillsWindow: false, nextAction: 'maximize',
    });
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(sibling.state.hidden).toBe(false);
    expect(owner.onMaximized.mock.calls).toEqual([[true]]);
  });

  it('releases immersion and reveals other panes when the owner unmounts', () => {
    const owner = mountPane();
    const sibling = mountPane({ paneKey: 'pane-b' });
    owner.cycle();
    owner.cycle();
    expect(sibling.state.hidden).toBe(true);

    owner.unmount();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(sibling.state.hidden).toBe(false);
  });

  it('preserves the active owner when a different pane unmounts', () => {
    const owner = mountPane();
    const sibling = mountPane({ paneKey: 'pane-b' });
    owner.cycle();
    owner.cycle();

    sibling.unmount();
    expect(useProjectImmersionStore.getState().immersiveIDE).toEqual({ project: 'project-a', paneKey: 'pane-a' });
    expect(owner.state).toMatchObject({
      maximized: true, immersive: true, hidden: false, fillsWindow: true, nextAction: 'restore',
    });
  });

  it.each([false, true])('leaves native or disabled panes and immersion unchanged when maximized is %s', (initialMaximized) => {
    useProjectImmersionStore.getState().toggle('project-b');
    useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a');
    const pane = mountPane({ enabled: false, initialMaximized });
    expect(pane.state).toMatchObject({
      maximized: initialMaximized, immersive: false, hidden: false, fillsWindow: false,
    });

    pane.cycle();
    expect(pane.state.maximized).toBe(initialMaximized);
    expect(pane.onMaximized).not.toHaveBeenCalled();
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-b');
    expect(useProjectImmersionStore.getState().immersiveIDE).toEqual({ project: 'project-a', paneKey: 'pane-a' });

    pane.unmount();
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-b');
    expect(useProjectImmersionStore.getState().immersiveIDE).toEqual({ project: 'project-a', paneKey: 'pane-a' });
  });
});
