import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import { VideoTimeline, type VideoTimelineProps } from './VideoTimeline.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string): string => key }) }));
let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });
const key = 'panel.videoStudio.timelineEditor.';
function document(): VideoDoc {
  const empty = createEmptyDoc('test', 'Timeline', 1);
  return { ...empty, tracks: [
    { id: 'visual', kind: 'visual', label: 'Visual', items: [
      { id: 'clip', label: 'Clip', kind: 'footage', assetId: 'video', at: 2, duration: 4 },
      { id: 'end', kind: 'text', at: 8, duration: 2 },
    ] }, { id: 'audio', kind: 'audio', items: [] },
  ], assets: { video: { id: 'video', kind: 'video', source: { kind: 'file', path: 'clip.mp4' }, duration: 10 } } };
}
function mount(overrides: Partial<VideoTimelineProps> = {}): VideoTimelineProps {
  const props = { doc: document(), playhead: 1, selectedItemId: 'clip', onSeek: vi.fn(), onSelectItem: vi.fn(), onApplyOps: vi.fn(), ...overrides };
  act(() => { view = create(createElement(VideoTimeline, props), {
    createNodeMock: node => node.props.role === 'slider' ? { getBoundingClientRect: () => ({ left: 176, width: 824 }) } : { scrollLeft: 0 },
  }); });
  return props;
}
function button(name: string) { return view!.root.findAllByType('button').find(node => node.props['aria-label'] === `${key}${name}`)!; }
function clip() { return view!.root.findByProps({ 'data-timeline-item': 'clip' }); }
function moveButton() { return clip().findAllByType('button')[0]!; }
function pointer(clientX: number, extra: Record<string, unknown> = {}) {
  return { clientX, button: 0, buttons: 1, pointerId: 1, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() }, ...extra };
}
function keyboard(key: string, shiftKey = false) { return { key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }; }

describe('VideoTimeline interactions', () => {
  it('uses the same ruler origin in track gutters and seeks to a valid frame', () => {
    const props = mount();
    const slider = view!.root.findByProps({ role: 'slider' });
    act(() => slider.props.onPointerDown(pointer(588)));
    expect(props.onSeek).toHaveBeenLastCalledWith(5);
    act(() => view!.root.findByProps({ 'data-timeline-track': 'visual' }).props.onPointerDown(pointer(1000)));
    expect(props.onSeek).toHaveBeenLastCalledWith(299 / 30);
    expect(view!.root.findAllByProps({ 'data-timeline-playhead': 'true' })).toHaveLength(2);
  });
  it('ignores pointer moves until a scrub starts and after cancellation', () => {
    const props = mount();
    const slider = view!.root.findByProps({ role: 'slider' });
    act(() => slider.props.onPointerMove(pointer(588)));
    expect(props.onSeek).not.toHaveBeenCalled();
    act(() => slider.props.onPointerDown(pointer(588)));
    act(() => slider.props.onPointerCancel());
    act(() => slider.props.onPointerMove(pointer(800)));
    expect(props.onSeek).toHaveBeenCalledTimes(1);
  });
  it('supports frame, ten-frame, Home and last-frame keyboard seeking', () => {
    const props = mount();
    const slider = view!.root.findByProps({ role: 'slider' });
    act(() => slider.props.onKeyDown(keyboard('ArrowRight')));
    expect(props.onSeek).toHaveBeenLastCalledWith(31 / 30);
    act(() => slider.props.onKeyDown(keyboard('ArrowLeft', true)));
    expect(props.onSeek).toHaveBeenLastCalledWith(20 / 30);
    act(() => slider.props.onKeyDown(keyboard('Home')));
    expect(props.onSeek).toHaveBeenLastCalledWith(0);
    act(() => slider.props.onKeyDown(keyboard('End')));
    expect(props.onSeek).toHaveBeenLastCalledWith(299 / 30);
  });
  it('previews dragging without saving and commits once when released', () => {
    const props = mount();
    act(() => moveButton().props.onPointerDown(pointer(400)));
    act(() => moveButton().props.onPointerMove(pointer(482.4)));
    expect(props.onApplyOps).not.toHaveBeenCalled();
    expect(clip().props.style.left).toBe('30%');
    act(() => moveButton().props.onPointerUp(pointer(482.4)));
    expect(props.onApplyOps).toHaveBeenCalledExactlyOnceWith([{ op: 'updateItem', itemId: 'clip', patch: { at: 3 } }]);
    act(() => moveButton().props.onPointerUp(pointer(482.4)));
    expect(props.onApplyOps).toHaveBeenCalledTimes(1);
  });
  it('cancels pointer gestures without saving, including changes from another editor', () => {
    const props = mount();
    act(() => moveButton().props.onPointerDown(pointer(400)));
    act(() => moveButton().props.onPointerMove(pointer(482.4)));
    act(() => moveButton().props.onKeyDown(keyboard('Escape')));
    expect(clip().props.style.left).toBe('20%');
    act(() => moveButton().props.onPointerUp(pointer(482.4)));
    expect(props.onApplyOps).not.toHaveBeenCalled();
    act(() => moveButton().props.onPointerDown(pointer(400)));
    act(() => view!.update(createElement(VideoTimeline, { ...props, doc: { ...props.doc, version: 2 } })));
    act(() => moveButton().props.onPointerUp(pointer(482.4)));
    expect(props.onApplyOps).not.toHaveBeenCalled();
  });
  it('selects without writing for clicks and blocks edits when disabled', () => {
    const props = mount();
    act(() => moveButton().props.onPointerDown(pointer(400)));
    act(() => moveButton().props.onPointerUp(pointer(401)));
    expect(props.onSelectItem).toHaveBeenCalledWith('clip');
    expect(props.onApplyOps).not.toHaveBeenCalled();
    act(() => view!.update(createElement(VideoTimeline, { ...props, disabled: true })));
    act(() => moveButton().props.onPointerDown(pointer(400)));
    act(() => moveButton().props.onPointerUp(pointer(482.4)));
    act(() => moveButton().props.onKeyDown(keyboard('ArrowRight')));
    expect(props.onApplyOps).not.toHaveBeenCalled();
  });
  it('trims media with source offsets and toggles renderer-specific track flags', () => {
    const props = mount();
    act(() => clip().findAllByType('button')[1]!.props.onPointerDown(pointer(400)));
    act(() => clip().findAllByType('button')[1]!.props.onPointerUp(pointer(482.4)));
    expect(props.onApplyOps).toHaveBeenLastCalledWith([{ op: 'updateItem', itemId: 'clip', patch: { at: 3, duration: 3, trimStart: 1 } }]);
    act(() => button('hideTrack').props.onClick());
    expect(props.onApplyOps).toHaveBeenLastCalledWith([{ op: 'updateTrack', trackId: 'visual', patch: { hidden: true } }]);
    act(() => button('muteTrack').props.onClick());
    expect(props.onApplyOps).toHaveBeenLastCalledWith([{ op: 'updateTrack', trackId: 'audio', patch: { muted: true } }]);
  });
  it('changes zoom and snap without writing the document', () => {
    const props = mount();
    expect(button('zoomOut').props.disabled).toBe(true);
    act(() => button('zoomIn').props.onClick());
    expect(button('zoomOut').props.disabled).toBe(false);
    const snap = view!.root.findAllByType('button').find(node => node.children.includes(`${key}snap`))!;
    expect(snap.props['aria-pressed']).toBe(true);
    act(() => snap.props.onClick());
    expect(snap.props['aria-pressed']).toBe(false);
    expect(props.onApplyOps).not.toHaveBeenCalled();
  });
});
