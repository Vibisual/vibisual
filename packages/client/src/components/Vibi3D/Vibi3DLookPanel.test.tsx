import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DLookPanel } from './Vibi3DLookPanel.js';
import { Vibi3DInspector } from './Vibi3DInspector.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer;
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: '/project', fileName: 'Model', revision: 0, nodes: [], selectedId: null, lighting: 1.7 };
const label = (key: string) => `panel.vibi3d.look.${key}`;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
describe('scene look controls', () => {
  it('uses look commands and merges one slider drag while making a later drag independent', () => {
    const onCommand = vi.fn();
    act(() => { renderer = create(<Vibi3DLookPanel snapshot={snapshot} disabled={false} onCommand={onCommand} />); });
    const control = renderer.root.findByProps({ 'aria-label': label('exposure') });
    act(() => { control.props.onChange({ target: { value: '1.2' } }); control.props.onChange({ target: { value: '1.4' } }); });
    expect(onCommand.mock.calls[0]?.[0]).toEqual({ type: 'look', exposure: 1.2 });
    expect(onCommand.mock.calls[0]?.[1]).toEqual(onCommand.mock.calls[1]?.[1]);
    act(() => { control.props.onPointerUp(); control.props.onChange({ target: { value: '1.6' } }); });
    expect(onCommand.mock.calls[2]?.[1]).not.toEqual(onCommand.mock.calls[0]?.[1]);
  });
  it('replaces the old intensity handle and exposes accessible preset, effects and quality controls', () => {
    act(() => { renderer = create(<Vibi3DInspector snapshot={snapshot} disabled={true} onCommand={vi.fn()} />); });
    expect(renderer.root.findAllByProps({ 'aria-label': 'panel.vibi3d.lighting' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': label('intensity') })).toHaveLength(1);
    for (const key of ['intensity', 'preset', 'sunIntensity', 'toneMapping', 'shadows', 'ao', 'bloom', 'fog', 'quality']) {
      expect(renderer.root.findByProps({ 'aria-label': label(key) }).props.disabled).toBe(true);
    }
    expect(renderer.root.findByProps({ 'aria-label': label('intensity') }).props.value).toBe(1.7);
  });
});
