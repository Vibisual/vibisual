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
  it('offers shadow overrides for logical instance placements', () => {
    const onCommand = vi.fn();
    const instance: Vibi3DSnapshot = { ...snapshot, nodes: [{ ...snapshot.nodes[0]!, type: 'Group',
      instance: { moduleId: 'window', moduleRevision: 1, placementId: 'cube' }, shadows: { cast: true, receive: false } }] };
    act(() => { renderer = create(createElement(Vibi3DInspector, { snapshot: instance, disabled: false, onCommand })); });
    const cast = renderer.root.findByProps({ 'aria-label': 'panel.vibi3d.look.cast' });
    act(() => cast.props.onChange({ target: { checked: false } }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'cube', shadows: { cast: false } });
  });

  it.each([2000, 10000])('keeps both object and group lists bounded with %i logical nodes', count => {
    const crowded: Vibi3DSnapshot = { ...snapshot, selectedId: null, nodes: Array.from({ length: count }, (_, index) => ({
      id: `node-${index}`, name: `Part ${index}`, type: 'Group', parentId: 'root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    })) };
    act(() => { renderer = create(createElement(Vibi3DInspector, { snapshot: crowded, disabled: false, onCommand: vi.fn() })); });
    expect(renderer.root.findAllByProps({ role: 'option' })).toHaveLength(24);
    // Shape, light and recipe controls remain small; no native select secretly mounts all logical objects.
    expect(renderer.root.findAllByType('option').length).toBeLessThan(128);
  });

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

  it('(9) restores the accepted value when an edit cannot apply (zero scale) or the input is empty — never 0 for an empty field', () => {
    const onCommand = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DInspector, { snapshot, disabled: false, onCommand })); });
    const input = () => renderer.root.findByProps({ 'aria-label': 'Scale X' });
    act(() => input().props.onFocus());
    act(() => input().props.onChange({ target: { value: '0' } }));
    act(() => input().props.onBlur());
    // A zero scale would collapse the object; the field keeps the old value instead of sending it.
    expect(onCommand).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1');
    // '0.5' can be typed character by character: each key appends to what the field shows ('0.' must stay '0.').
    act(() => input().props.onFocus());
    act(() => input().props.onChange({ target: { value: '' } }));
    for (const key of '0.5') act(() => input().props.onChange({ target: { value: `${input().props.value as string}${key}` } }));
    expect(input().props.value).toBe('0.5');
    act(() => input().props.onBlur());
    expect(onCommand).toHaveBeenCalledWith({ type: 'update', id: 'cube', scale: [0.5, 1, 1] });
    onCommand.mockClear();
    act(() => input().props.onChange({ target: { value: '' } }));
    act(() => input().props.onBlur());
    expect(onCommand).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1');
    // 0 is a valid position, so only the field itself can tell "emptied" from "typed 0".
    const positionX = () => renderer.root.findByProps({ 'aria-label': 'Position X' });
    act(() => positionX().props.onFocus());
    act(() => positionX().props.onChange({ target: { value: '' } }));
    act(() => positionX().props.onBlur());
    expect(onCommand).not.toHaveBeenCalled();
    expect(positionX().props.value).toBe('1');
  });
});
