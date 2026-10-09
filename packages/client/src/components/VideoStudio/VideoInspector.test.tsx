import { createElement } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc, type VideoItem } from '@vibisual/video';
import { VideoInspector } from './VideoInspector.js';
import { StudioNumberField, StudioTextField } from './StudioField.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }) }));
let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });

function docWith(item: VideoItem): VideoDoc {
  const kind = item.kind === 'audio' ? 'audio' : item.kind === 'caption' ? 'caption' : 'visual';
  return { ...createEmptyDoc('test-doc', 'Demo'), tracks: [
    { id: 'primary', kind, items: [item] }, { id: 'second', kind, items: [] },
    { id: 'wrong-kind', kind: kind === 'visual' ? 'audio' : 'visual', items: [] },
  ] };
}
function mount(doc: VideoDoc, id: string | null = 'clip', disabled = false) {
  const onApplyOps = vi.fn();
  act(() => { view = create(createElement(VideoInspector, { doc, selectedItemId: id, disabled, onApplyOps })); });
  return onApplyOps;
}
function field(label: string): ReactTestInstance {
  return view!.root.findAll((node) => (node.type === StudioNumberField || node.type === StudioTextField) && node.props.label === label)[0]!;
}
function edit(label: string, value: string): void {
  const control = (): ReactTestInstance => field(label).findAll((node) => node.type === 'input' || node.type === 'textarea')[0]!;
  act(() => control().props.onChange({ target: { value } }));
  act(() => control().props.onBlur());
}
function select(label: string): ReactTestInstance { return view!.root.findAllByType('select').find((node) => node.props['aria-label'] === label)!; }
const title: VideoItem = { id: 'clip', kind: 'scene', sceneId: 'title', at: 0, duration: 5, props: { title: 'Before', subtitle: 'Keep', customData: 7 }, transform: { x: 10, y: 20 } };

describe('VideoInspector', () => {
  it('edits output settings through document operations', () => {
    const apply = mount(docWith(title), null);
    edit('Video title', 'New video');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'setDoc', patch: { title: 'New video' } }]);
    act(() => select('Output size').props.onChange({ target: { value: 'portrait' } }));
    expect(apply).toHaveBeenLastCalledWith([{ op: 'setDoc', patch: { size: { width: 1080, height: 1920 } } }]);
    edit('Frame rate (fps)', '29.97');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'setDoc', patch: { fps: 29.97 } }]);
  });

  it('merges scene content and transform edits without discarding sibling properties', () => {
    const apply = mount(docWith(title));
    edit('Title', 'Updated\ntitle');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'updateItem', itemId: 'clip', patch: { props: { title: 'Updated\ntitle', subtitle: 'Keep', customData: 7 } } }]);
    edit('X (px)', '120');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'updateItem', itemId: 'clip', patch: { transform: { x: 120, y: 20 } } }]);
    edit('Opacity', '1.2');
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it.each(['scene', 'audio', 'caption'] as const)('only moves %s clips to compatible tracks, including forged selections', (kind) => {
    const apply = mount(docWith({ ...title, kind }));
    const trackSelect = select('Track');
    expect(trackSelect.findAllByType('option').map((node) => node.props.value)).toEqual(['primary', 'second']);
    act(() => trackSelect.props.onChange({ target: { value: 'wrong-kind' } }));
    act(() => trackSelect.props.onChange({ target: { value: 'missing' } }));
    expect(apply).not.toHaveBeenCalled();
    act(() => trackSelect.props.onChange({ target: { value: 'second' } }));
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ op: 'moveItem', itemId: 'clip', toTrackId: 'second' }]);
  });

  it('keeps relative timing links when the resolved start changes', () => {
    const doc = docWith({ ...title, at: { after: 'anchor', offset: 1 } });
    const first = doc.tracks[0]!;
    const apply = mount({ ...doc, tracks: [{ ...first, items: [{ ...title, id: 'anchor', duration: 2 }, ...first.items] }, ...doc.tracks.slice(1)] });
    expect(field('Start (s)').props.value).toBe(3);
    edit('Start (s)', '4.5');
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ op: 'updateItem', itemId: 'clip', patch: { at: { after: 'anchor', offset: 2.5 } } }]);
  });

  it('caps source trim and duration to measured media and exposes actual audio properties', () => {
    const doc = docWith({ id: 'clip', kind: 'audio', at: 0, duration: 4, assetId: 'voice', props: { volume: 0.8 } });
    const apply = mount({ ...doc, assets: { voice: { id: 'voice', kind: 'audio', duration: 6, source: { kind: 'file', path: 'voice.wav' } } } });
    edit('Source in (s)', '4');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'updateItem', itemId: 'clip', patch: { trimStart: 4, duration: 2 } }]);
    edit('Duration (s)', '7');
    edit('Source in (s)', '6');
    expect(apply).toHaveBeenCalledTimes(1);
    edit('Fade in (s)', '0.25');
    expect(apply).toHaveBeenLastCalledWith([{ op: 'updateItem', itemId: 'clip', patch: { props: { volume: 0.8, fadeIn: 0.25 } } }]);
    expect(view!.root.findAllByType(StudioNumberField).some((node) => node.props.label === 'X (px)')).toBe(false);
  });

  it('edits caption text while keeping cue timing and removing obsolete word alignment', () => {
    const apply = mount(docWith({ id: 'clip', kind: 'caption', at: 1, duration: 3, cues: [{ start: 1, end: 4, text: 'Old words', words: [{ t: 1, text: 'Old' }] }] }));
    edit('Caption {{number}}', 'New sentence');
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ op: 'updateItem', itemId: 'clip', patch: { cues: [{ start: 1, end: 4, text: 'New sentence' }] } }]);
  });

  it.each([true, false])('offers footage volume only for potentially audible media: %s', (hasAudio) => {
    const doc = docWith({ id: 'clip', kind: 'footage', at: 0, duration: 5, assetId: 'video' });
    const apply = mount({ ...doc, assets: { video: { id: 'video', kind: 'video', source: { kind: 'file', path: 'video.mp4' }, hasAudio } } });
    expect(view!.root.findAllByType(StudioNumberField).some(node => node.props.label === 'Volume')).toBe(hasAudio);
    if (hasAudio) {
      edit('Volume', '0.4');
      expect(apply).toHaveBeenCalledExactlyOnceWith([{ op: 'updateItem', itemId: 'clip', patch: { props: { volume: 0.4 } } }]);
    }
  });

  it('does not emit edits while disabled', () => {
    const apply = mount(docWith(title), 'clip', true);
    edit('Title', 'Ignored');
    act(() => select('Track').props.onChange({ target: { value: 'second' } }));
    act(() => select('Output size').props.onChange({ target: { value: 'square' } }));
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    ['lowerThird', 'Name', 'New name', 'name', 'New name'],
    ['bulletList', 'List items (one per line)', 'One\nTwo', 'items', ['One', 'Two']],
    ['codeBlock', 'Code', 'const a = 1;\nrun(a);', 'lines', ['const a = 1;', 'run(a);']],
    ['quote', 'Attribution', 'Author', 'by', 'Author'],
    ['solid', 'Color', '#123456', 'color', '#123456'],
  ])('edits renderer properties for the %s scene', (sceneId, label, value, prop, expected) => {
    const apply = mount(docWith({ ...title, sceneId: String(sceneId), props: {} }));
    edit(String(label), String(value));
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ op: 'updateItem', itemId: 'clip', patch: { props: { [String(prop)]: expected } } }]);
  });
});
