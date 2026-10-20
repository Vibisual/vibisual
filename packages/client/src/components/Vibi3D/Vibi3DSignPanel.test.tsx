import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DSignPanel } from './Vibi3DSignPanel.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer; afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: 'root', fileName: 'model', revision: 0, selectedId: null, lighting: 1, nodes: [] };
function mount(value = snapshot) { const onCommand = vi.fn(); act(() => { renderer = create(createElement(Vibi3DSignPanel, { snapshot: value, disabled: false, onCommand })); }); return onCommand; }
const button = (key: string) => renderer.root.findAllByType('button').find(node => node.children.includes(`panel.vibi3d.sign.${key}`))!;
describe('editable sign controls', () => {
  it('adds a fictional sign with bundled font and exposes shipped OFL files', () => {
    const command = mount(); act(() => button('add').props.onClick()); expect(command.mock.calls[0]![0]).toMatchObject({ type: 'sign', text: '모퉁이 상점', font: 'sans' });
    expect(renderer.root.findAllByType('a')).toHaveLength(4); expect(renderer.root.findAllByType('a').filter(link => link.props.href.includes('OFL.txt'))).toHaveLength(3);
    expect(renderer.root.findAllByType('a').some(link => link.props.href.includes('opentype-LICENSE.txt'))).toBe(true);
  });
  it('updates the selected stable sign id after editing and preserves its source recipe', () => {
    const command = mount({ ...snapshot, selectedId: 'sign', nodes: [{ id: 'sign', name: 'Sign', type: 'Group', parentId: 'root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], sign: { kind: 'projecting', text: '상점', source: { kind: 'vibimage', docId: 'design' } } }] });
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '모퉁이' } })); act(() => button('update').props.onClick());
    expect(command.mock.calls[0]![0]).toMatchObject({ type: 'sign', id: 'sign', kind: 'projecting', text: '모퉁이', source: { kind: 'vibimage', docId: 'design' } });
  });
  it('disables editing a protected sign', () => {
    mount({ ...snapshot, selectedId: 'sign', nodes: [{ id: 'sign', name: 'Sign', type: 'Group', parentId: 'root', locked: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], sign: { kind: 'channel', text: '상점' } }] });
    expect(button('update').props.disabled).toBe(true); expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
  });
});
