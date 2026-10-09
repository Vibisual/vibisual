import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DInspector } from './Vibi3DInspector.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));

let renderer: ReactTestRenderer;
const snapshot: Vibi3DSnapshot = {
  sessionId: 'scene', projectId: 'project', fileName: 'model.glb', revision: 0, selectedId: 'cube', lighting: 1,
  nodes: [{ id: 'cube', name: 'Cube', type: 'Mesh', parentId: null, position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }],
};
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

describe('Vibi3D numeric inspector', () => {
  it('commits on blur while preserving other axes and follows a later AI update', () => {
    const onCommand = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DInspector, { snapshot, disabled: false, onCommand })); });
    const input = () => renderer.root.findByProps({ 'aria-label': 'Position X' });
    act(() => input().props.onChange({ target: { value: '4.5' } }));
    expect(onCommand).not.toHaveBeenCalled();
    act(() => input().props.onBlur());
    expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'cube', position: [4.5, 2, 3] });
    const updated: Vibi3DSnapshot = { ...snapshot, revision: 1, nodes: [{ ...snapshot.nodes[0]!, position: [9, 2, 3] }] };
    act(() => renderer.update(createElement(Vibi3DInspector, { snapshot: updated, disabled: false, onCommand })));
    expect(input().props.value).toBe('9');
  });

  it('restores the accepted value when an edit is rejected or the input is empty', () => {
    // Root rejects scale=0 and leaves the snapshot unchanged.
    const onCommand = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DInspector, { snapshot, disabled: false, onCommand })); });
    const input = () => renderer.root.findByProps({ 'aria-label': 'Scale X' });
    act(() => input().props.onChange({ target: { value: '0' } }));
    act(() => input().props.onBlur());
    expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'cube', scale: [0, 1, 1] });
    expect(input().props.value).toBe('1');
    onCommand.mockClear();
    act(() => input().props.onChange({ target: { value: '' } }));
    act(() => input().props.onBlur());
    expect(onCommand).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1');
  });
});
