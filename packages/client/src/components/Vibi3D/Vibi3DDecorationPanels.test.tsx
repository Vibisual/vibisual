import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DDecalPanel } from './Vibi3DDecalPanel.js';
import { Vibi3DMascotPanel } from './Vibi3DMascotPanel.js';
import { Vibi3DImageSourceField } from './Vibi3DImageSourceField.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const snapshot: Vibi3DSnapshot = { sessionId: 'session', projectId: 'project', fileName: 'model', revision: 0, selectedId: 'wall', nodes: [
  { id: 'wall', name: 'Wall', type: 'Mesh', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], recipe: { kind: 'wall', width: 4, height: 3, thickness: 0.2 } },
] };
const button = (text: string) => renderer.root.findAllByType('button').find(node => node.children.includes(text))!;

describe('decal and mascot tools', () => {
  it('uses a selected wall local front position and the common source field', () => {
    const onCommand = vi.fn(); act(() => { renderer = create(createElement(Vibi3DDecalPanel, { snapshot, disabled: false, onCommand })); });
    expect(button('panel.vibi3d.decals.add').props.disabled).toBe(true);
    act(() => renderer.root.findByType(Vibi3DImageSourceField).props.onChange({ kind: 'vibimage', docId: 'drawing' }));
    act(() => button('panel.vibi3d.decals.add').props.onClick());
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'decal', target: 'wall', position: [0, 1.5, 0.1], source: { kind: 'vibimage', docId: 'drawing' } }));
  });

  it('updates the same decal ID and blocks protected edits', () => {
    const onCommand = vi.fn(), selected: Vibi3DSnapshot = { ...snapshot, nodes: [{ ...snapshot.nodes[0]!, id: 'sticker', decal: {
      target: 'wall', position: [0, 0, 0.1], normal: [0, 0, 1], size: [1, 1], source: { kind: 'vibimage', docId: 'drawing' },
    } }], selectedId: 'sticker' };
    act(() => { renderer = create(createElement(Vibi3DDecalPanel, { snapshot: selected, disabled: false, onCommand })); });
    act(() => button('panel.vibi3d.decals.update').props.onClick());
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'decal', id: 'sticker' }));
    act(() => renderer.update(createElement(Vibi3DDecalPanel, { snapshot: { ...selected, nodes: [{ ...selected.nodes[0]!, locked: true }] }, disabled: false, onCommand })));
    expect(button('panel.vibi3d.decals.update').props.disabled).toBe(true);
  });

  it('adds a native character and requires an image for the standee option', () => {
    const onCommand = vi.fn(); act(() => { renderer = create(createElement(Vibi3DMascotPanel, { snapshot, disabled: false, onCommand })); });
    act(() => button('panel.vibi3d.mascots.add').props.onClick()); expect(onCommand).toHaveBeenCalledWith({ type: 'mascot', style: 'round', height: 1.6 });
    act(() => renderer.root.findByProps({ 'aria-label': 'panel.vibi3d.mascots.style' }).props.onChange({ target: { value: 'standee' } }));
    expect(button('panel.vibi3d.mascots.add').props.disabled).toBe(true);
    act(() => renderer.root.findByType(Vibi3DImageSourceField).props.onChange({ kind: 'vibimage', docId: 'drawing' }));
    expect(button('panel.vibi3d.mascots.add').props.disabled).toBe(false);
    act(() => button('panel.vibi3d.mascots.add').props.onClick()); expect(onCommand).toHaveBeenLastCalledWith({ type: 'mascot', style: 'standee', height: 1.6, source: { kind: 'vibimage', docId: 'drawing' } });
  });
});
