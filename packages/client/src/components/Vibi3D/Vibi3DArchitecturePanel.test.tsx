import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIBI3D_ARCHITECTURE_KINDS, type Vibi3DSnapshot, type Vibi3DNode } from '@vibisual/shared';
import { Vibi3DArchitecturePanel } from './Vibi3DArchitecturePanel.js';
import { NumberField } from '../Creation/NumberField.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
const label = (key: string) => `panel.vibi3d.architecture.${key}`;
const base: Vibi3DSnapshot = { sessionId: 'scene', projectId: 'project', fileName: 'Scene', revision: 0, nodes: [], selectedId: null, lighting: 1 };
const node: Vibi3DNode = { id: 'facade', name: 'Facade', type: 'Group', parentId: 'root', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  architecture: { kind: 'facade', width: 12, bays: 3, floorHeights: [4.2, 3.1] } };
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

describe('architecture controls', () => {
  it('creates each component type through its shared command and edits the selected stable id', () => {
    const command = vi.fn();
    act(() => { renderer = create(<Vibi3DArchitecturePanel snapshot={base} disabled={false} onCommand={command} />); });
    const select = renderer.root.findByProps({ 'aria-label': label('kind') });
    expect(select.findAllByType('option').map(item => item.props.value)).toEqual([...VIBI3D_ARCHITECTURE_KINDS]);
    act(() => select.props.onChange({ target: { value: 'street' } }));
    act(() => renderer.root.findByType('button').props.onClick());
    expect(command.mock.calls[0]![0]).toMatchObject({ type: 'street', roadWidth: 6, sidewalkWidth: 3 });
    act(() => renderer.update(<Vibi3DArchitecturePanel snapshot={{ ...base, nodes: [node], selectedId: node.id }} disabled={false} onCommand={command} />));
    const floors = renderer.root.findAllByType(NumberField).find(field => field.props.label === label('floors'))!;
    act(() => floors.props.onCommit(3));
    expect(command).toHaveBeenLastCalledWith({ type: 'facade', id: 'facade', floors: 3, floorHeights: [4.2, 3.1, 3.1] }, undefined);
  });

  it('preserves open ground-floor bays when editing an upper-floor module and blocks protected regeneration', () => {
    const command = vi.fn(); const snapshot = { ...base, nodes: [node], selectedId: node.id };
    act(() => { renderer = create(<Vibi3DArchitecturePanel snapshot={snapshot} disabled={false} onCommand={command} />); });
    const module = renderer.root.findByProps({ 'aria-label': `${label('floor')} 2 ${label('bay')} 2` });
    act(() => module.props.onChange({ target: { value: 'balcony' } }));
    expect(command).toHaveBeenLastCalledWith({ type: 'facade', id: 'facade', floorModules: [['open', 'open', 'open'], ['window', 'balcony', 'window']] }, undefined);
    act(() => renderer.update(<Vibi3DArchitecturePanel snapshot={{ ...snapshot, nodes: [{ ...node, locked: true }] }} disabled={false} onCommand={command} />));
    const width = renderer.root.findAllByType(NumberField).find(field => field.props.label === label('width'))!;
    expect(width.props.disabled).toBe(true); act(() => width.props.onCommit(15)); expect(command).toHaveBeenCalledTimes(1);
  });
});
