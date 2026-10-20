import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DShotPanel } from './Vibi3DShotPanel.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const shot = { id: 'corner', name: 'Corner', position: [2, 1.6, 5] as [number, number, number], target: [0, 3, 0] as [number, number, number], lens: 24, aspect: '9:16' as const };
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: 'project', fileName: 'model', revision: 1, selectedId: null, nodes: [], shots: [shot], activeShotId: shot.id, camera: shot };
describe('saved shot controls', () => {
  it('addresses shots by stable id and outputs only selected views', () => {
    const command = vi.fn(), onStills = vi.fn(), onVideo = vi.fn(); let ui!: ReactTestRenderer;
    act(() => { ui = create(createElement(Vibi3DShotPanel, { snapshot, disabled: false, onCommand: command, actions: { onStills, onVideo } })); });
    const click = (key: string): void => { act(() => ui.root.findAllByType('button').find(button => button.children.join('') === `panel.vibi3d.shots.${key}`)!.props.onClick()); };
    click('select'); expect(command).toHaveBeenLastCalledWith({ type: 'camera', shot: { id: 'corner', name: 'Corner' } });
    click('still'); expect(onStills).toHaveBeenLastCalledWith(['corner']);
    click('video'); expect(onVideo).toHaveBeenLastCalledWith(['corner'], false);
    click('remove'); expect(command).toHaveBeenLastCalledWith({ type: 'shotRemove', id: 'corner' });
    act(() => ui.unmount());
  });
  it('saves a new portrait lens view with a fresh stable id and blocks duplicate names', () => {
    const command = vi.fn(); let ui!: ReactTestRenderer;
    act(() => { ui = create(createElement(Vibi3DShotPanel, { snapshot, disabled: false, onCommand: command, readView: () => shot })); });
    const name = ui.root.findAllByType('input').find(input => input.props.maxLength === 120)!;
    const add = () => ui.root.findAllByType('button').find(button => button.children.join('') === 'panel.vibi3d.shots.add')!;
    act(() => name.props.onChange({ target: { value: 'Corner' } })); expect(add().props.disabled).toBe(true);
    act(() => name.props.onChange({ target: { value: 'Shop' } })); act(() => add().props.onClick());
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'camera', lens: 24, aspect: '9:16', shot: { id: expect.any(String), name: 'Shop' } }));
    expect(command.mock.calls[0]![0].shot.id).not.toBe('corner'); act(() => ui.unmount());
  });
});
