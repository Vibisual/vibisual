import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { Vibi3DObjectList, modelListRange } from './Vibi3DObjectList.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const nodes = (count: number): Vibi3DSnapshot['nodes'] => Array.from({ length: count }, (_, index) => ({
  id: `placement-${index}`, name: `Window ${index}`, type: 'Group', parentId: null,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
}));
const rows = () => renderer.root.findAllByProps({ role: 'option' });

describe('virtual logical-object list', () => {
  it.each([2000, 10000])('mounts only viewport rows for %i objects and scrolls to stable IDs', count => {
    const onSelect = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DObjectList, { nodes: nodes(count), selectedId: null, disabled: false, onSelect })); });
    expect(rows()).toHaveLength(12);
    expect(rows()[0]!.props['aria-setsize']).toBe(count);
    act(() => renderer.root.findByType(ScrollFade).props.onViewport({ scrollTop: 44 * 1500, clientHeight: 264, scrollHeight: 44 * count }));
    expect(rows()).toHaveLength(12); expect(rows()[0]!.props['aria-posinset']).toBe(1498);
    act(() => rows()[3]!.props.onClick()); expect(onSelect).toHaveBeenLastCalledWith('placement-1500');
  });

  it('filters by stable ID, keeps the selected ID on reorder and supports keyboard ends', () => {
    const onSelect = vi.fn(); const list = nodes(10000);
    act(() => { renderer = create(createElement(Vibi3DObjectList, { nodes: list, selectedId: 'placement-9999', disabled: false, onSelect })); });
    act(() => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'placement-9999' } }));
    expect(rows()).toHaveLength(1); expect(rows()[0]!.props['aria-selected']).toBe(true);
    act(() => renderer.update(createElement(Vibi3DObjectList, { nodes: [...list].reverse(), selectedId: 'placement-9999', disabled: false, onSelect })));
    expect(rows()[0]!.props['aria-selected']).toBe(true);
    act(() => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value: '' } }));
    act(() => renderer.root.findByProps({ role: 'listbox' }).props.onKeyDown({ key: 'End', preventDefault: vi.fn() }));
    expect(onSelect).toHaveBeenLastCalledWith('placement-0');
  });

  it('blocks keyboard selection while disabled and bounds an oversized scroll offset', () => {
    const onSelect = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DObjectList, { nodes: nodes(2000), selectedId: null, disabled: true, onSelect })); });
    act(() => renderer.root.findByProps({ role: 'listbox' }).props.onKeyDown({ key: 'End', preventDefault: vi.fn() }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(modelListRange(0, 10000)).toEqual({ start: 0, end: 0 });
    expect(modelListRange(2000, 1000000)).toEqual({ start: 1999, end: 2000 });
  });

  it('windows group multi-selection and keeps keyboard cursor movement separate from toggling', () => {
    const onSelect = vi.fn();
    act(() => { renderer = create(createElement(Vibi3DObjectList, { nodes: nodes(10000), selectedId: null, selectedIds: ['placement-1'], label: 'Group', disabled: false, onSelect })); });
    expect(rows()).toHaveLength(12); expect(rows()[1]!.props['aria-selected']).toBe(true);
    const list = () => renderer.root.findByProps({ role: 'listbox' });
    expect(list().props['aria-multiselectable']).toBe(true);
    act(() => list().props.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() }));
    expect(onSelect).not.toHaveBeenCalled();
    act(() => list().props.onKeyDown({ key: ' ', preventDefault: vi.fn() }));
    expect(onSelect).toHaveBeenLastCalledWith('placement-0');
    expect(list().props['aria-activedescendant']).toBe(rows()[0]!.props.id);
  });
});
