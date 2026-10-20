import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIBI3D_MATERIAL_PRESETS, type Vibi3DNode, type Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DInspector } from './Vibi3DInspector.js';
import { NumberField } from '../Creation/NumberField.js';
import { ColorField } from '../Creation/ColorField.js';
import { inspectorPickerAt } from '../../utils/inspectorPick.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
const node: Vibi3DNode = { id: 'wall', parentId: 'root', name: 'Wall', type: 'Mesh', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material: { preset: 'brick', wear: 0.2, tileSize: [1.2, 0.6] } };
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: '/project', fileName: 'Model', revision: 0, nodes: [node], selectedId: 'wall', lighting: 1 };
const label = (key: string) => `panel.vibi3d.materials.${key}`;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

describe('one material editing surface', () => {
  it('lists every preset, paints generated pixels and sends editable settings through the material command', () => {
    const onCommand = vi.fn(); const putImageData = vi.fn();
    const canvas = { getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData }) };
    act(() => { renderer = create(<Vibi3DInspector snapshot={snapshot} disabled={false} onCommand={onCommand} textureConnections={<div data-links="source" />} />, {
      createNodeMock: (element) => element.type === 'canvas' ? canvas : null,
    }); });
    const preset = renderer.root.findByProps({ 'aria-label': label('preset') });
    expect(preset.findAllByType('option').map(option => option.props.value).slice(1)).toEqual([...VIBI3D_MATERIAL_PRESETS]);
    expect(putImageData).toHaveBeenCalledOnce(); expect(new Set(putImageData.mock.calls[0]![0].data).size).toBeGreaterThan(10);
    const picker = inspectorPickerAt(canvas as unknown as Element);
    expect(picker?.picker({ x: 4, y: 6, width: 128, height: 128 })).toEqual([expect.objectContaining({
      rect: { x: 0, y: 0, width: 128, height: 128 },
      clipboard: JSON.stringify({ app: 'vibi3d', nodeId: 'wall', name: 'Wall', material: node.material }),
    })]);
    act(() => { preset.props.onChange({ target: { value: 'glass' } }); });
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'material', id: 'wall', material: { preset: 'glass' } }, undefined);
    const width = renderer.root.findAllByType(NumberField).find(field => field.props.label === label('tileWidth'))!;
    act(() => { width.props.onCommit(3); });
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'material', id: 'wall', material: { tileSize: [3, 0.6] } }, undefined);
    expect(renderer.root.findAllByProps({ 'data-links': 'source' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'aria-label': 'panel.vibi3d.authoring.roughness' })).toHaveLength(0);
  });

  it('merges palette drags, blocks locked edits, and keeps source connections visible without a selection', () => {
    const onCommand = vi.fn();
    act(() => { renderer = create(<Vibi3DInspector snapshot={snapshot} disabled={false} onCommand={onCommand} />); });
    const color = renderer.root.findAllByType(ColorField).find(field => field.props.label === label('pattern_color'))!;
    act(() => { color.props.onChange('#112233', 'preview'); color.props.onChange('#223344', 'commit'); });
    expect(onCommand.mock.calls[0]![1]).toEqual(onCommand.mock.calls[1]![1]);
    act(() => { renderer.update(<Vibi3DInspector snapshot={{ ...snapshot, nodes: [{ ...node, locked: true }] }} disabled={false} onCommand={onCommand} />); });
    const preset = renderer.root.findByProps({ 'aria-label': label('preset') }); expect(preset.props.disabled).toBe(true);
    act(() => { preset.props.onChange({ target: { value: 'glass' } }); }); expect(onCommand).toHaveBeenCalledTimes(2);
    act(() => { renderer.update(<Vibi3DInspector snapshot={{ ...snapshot, selectedId: null }} disabled={false} onCommand={onCommand} textureConnections={<div data-links="source" />} />); });
    expect(renderer.root.findAllByProps({ 'data-links': 'source' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'aria-label': label('preset') })).toHaveLength(0);
  });
  it('offers the optional interior only for glass and sends it through the existing material control', () => {
    const onCommand = vi.fn();
    act(() => { renderer = create(<Vibi3DInspector snapshot={snapshot} disabled={false} onCommand={onCommand} />); });
    expect(renderer.root.findAllByProps({ 'aria-label': label('fakeInterior') })).toHaveLength(0);
    act(() => { renderer.update(<Vibi3DInspector snapshot={{ ...snapshot, nodes: [{ ...node, material: { preset: 'glass' } }] }} disabled={false} onCommand={onCommand} />); });
    const option = renderer.root.findByProps({ 'aria-label': label('fakeInterior') }); expect(option.props.checked).toBe(false);
    act(() => { option.props.onChange({ target: { checked: true } }); });
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'material', id: 'wall', material: { params: { fakeInterior: true } } }, undefined);
  });
});
