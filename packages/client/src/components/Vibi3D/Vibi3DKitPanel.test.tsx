import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DKitPanel } from './Vibi3DKitPanel.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: 'root', fileName: 'model', revision: 0, selectedId: 'source', lighting: 1,
  nodes: [{ id: 'source', name: 'Source', type: 'Mesh', parentId: 'root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  kitModules: [{ id: 'module', name: 'Existing', revision: 3, prototypeId: 'prototype', instances: 12 }] };
const button = (key: string) => renderer.root.findAllByType('button').find(node => node.children.includes(`panel.vibi3d.kit.${key}`))!;
function mount(value = snapshot) { const onCommand = vi.fn(); act(() => { renderer = create(createElement(Vibi3DKitPanel, { snapshot: value, disabled: false, onCommand })); }); return onCommand; }

describe('module kit controls', () => {
  it('defines a built-in module and replaces a module from selected source with its current revision', () => {
    const command = mount(); act(() => button('addBuiltin').props.onClick());
    expect(command.mock.calls[0]![0]).toMatchObject({ type: 'kitModule', builtin: 'korean-retail/window' });
    expect(command.mock.calls[0]![0].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    act(() => button('updateModule').props.onClick()); expect(command.mock.calls[1]![0]).toEqual({ type: 'kitModule', id: 'module', sourceId: 'source', expectedModuleRevision: 3 });
  });
  it('places and arrays the selected module with one snap setting and does not expose GPU indices', () => {
    const command = mount(); act(() => button('place').props.onClick()); act(() => button('addArray').props.onClick());
    expect(command.mock.calls[0]![0]).toMatchObject({ type: 'place', moduleId: 'module', expectedModuleRevision: 3, snap: 0.25 });
    expect(command.mock.calls[1]![0]).toMatchObject({ type: 'array', moduleId: 'module', counts: [3, 1, 1], step: [2, 0, 0], snap: 0.25 });
    expect(command.mock.calls[0]![0].id).not.toBe(command.mock.calls[1]![0].id);
  });
  it('can replace a logical placement but forbids turning it into a nested module', () => {
    const command = mount({ ...snapshot, nodes: [{ ...snapshot.nodes[0]!, instance: { moduleId: 'other', moduleRevision: 1, placementId: 'source' } }] });
    expect(button('defineSelection').props.disabled).toBe(true); expect(button('updateModule').props.disabled).toBe(true);
    act(() => button('replace').props.onClick()); expect(command.mock.calls[0]![0]).toMatchObject({ type: 'place', id: 'source', moduleId: 'module' });
  });
});
