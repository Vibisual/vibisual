import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationCandidateSummary, CreationHead } from '@vibisual/shared';
import type { AppCanvasFaceProps } from '../../apps/registry.js';
import type { ImageCandidate, ImageSourceDoc } from './imageApi.js';
import { newImageDocument, newImageLayer, type ImageDocument } from '../Creation/imageSource.js';
import { ImageSourceFace } from './ImageSourceFace.js';

const api = vi.hoisted(() => ({ head: vi.fn(), read: vi.fn(), summaries: vi.fn(), candidate: vi.fn(), render: vi.fn(), copy: vi.fn(), accept: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Creation/useCreationHead.js', () => ({ useCreationHead: api.head }));
vi.mock('./imageApi.js', () => ({ readImageDoc: api.read, imageCandidateSummaries: api.summaries, readImageCandidate: api.candidate, acceptImageCandidate: api.accept }));
vi.mock('../Creation/imageRender.js', () => ({ renderImageBlob: api.render }));
vi.mock('../IDE/imageClipboard.js', () => ({ resolveClipboardSurface: () => ({}), copyImageToClipboard: api.copy }));

let view: ReactTestRenderer | undefined;
let head: CreationHead;
let source: ImageSourceDoc;
const props: AppCanvasFaceProps & { workRef: string } = {
  projectId: '/project', workRef: 'source', file: '', version: 0, width: 260, height: 160, glow: '#abcdef', icon: null, thumb: null, thumbLoading: false,
};
const picture = (name: string): ImageDocument => {
  const payload = newImageDocument();
  payload.layers = [{ ...newImageLayer(payload, 'shape', name), id: name }];
  return payload;
};
const candidate = (id: string, createdAt = 1, baseRevision = 1): ImageCandidate => ({
  id, createdAt, baseRevision, status: 'pending', label: id, input: '', payload: picture(id),
});
const summary = ({ payload: _payload, ...item }: ImageCandidate): CreationCandidateSummary => item;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const mount = async (): Promise<void> => { await act(async () => { view = create(<ImageSourceFace {...props} />); }); };
const refresh = async (next: Partial<CreationHead>): Promise<void> => {
  head = { ...head, ...next };
  await act(async () => { view!.update(<ImageSourceFace {...props} />); });
};
const text = (): string => JSON.stringify(view!.toJSON());
const imageUrl = (): string => view!.root.findByType('img').props.src as string;

beforeEach(() => {
  vi.resetAllMocks();
  head = { id: 'source', appId: 'vibimage', revision: 1, candidateStamp: 0, pendingCandidates: 0, updatedAt: 1 };
  source = { id: 'source', appId: 'vibimage', schemaVersion: 1, title: 'Image', revision: 1, payload: newImageDocument(),
    links: [], lockedPaths: [], parameters: {}, createdAt: 1, updatedAt: 1, label: '', author: 'user' };
  api.head.mockImplementation(() => head);
  api.read.mockImplementation(async () => source);
  api.summaries.mockResolvedValue([]);
  api.render.mockImplementation(async (payload: ImageDocument) => new Blob([JSON.stringify(payload)]));
  api.copy.mockResolvedValue({ ok: true });
  let serial = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++serial}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.restoreAllMocks(); });

describe('Vibimage node proposal previews', () => {
  it('shows an empty state for the initial source, then displays a proposal when only its candidate stamp changes', async () => {
    await mount();
    expect(view!.root.findAllByType('img')).toHaveLength(0);
    expect(text()).toContain('panel.apps.vibimage.empty');
    expect(api.render).not.toHaveBeenCalled();

    const draft = candidate('Embarrassed dokkaebi');
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockResolvedValue(draft);
    await refresh({ candidateStamp: 1, pendingCandidates: 1 });
    expect(imageUrl()).toBe('blob:preview-1');
    expect(api.render).toHaveBeenLastCalledWith(draft.payload, '/project', 'svg');
    expect(text()).toContain('panel.apps.vibimage.editor.compare');
    expect(text()).toContain(draft.label);
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.accept).not.toHaveBeenCalled();

    await act(async () => { view!.root.findByProps({ 'aria-label': 'panel.apps.canvas.copyImage' }).props.onClick({ stopPropagation() {} }); });
    expect(api.render).toHaveBeenLastCalledWith(draft.payload, '/project', 'png');
    expect(api.copy).toHaveBeenCalledTimes(1);
    expect(api.accept).not.toHaveBeenCalled();
  });

  it('chooses the newest proposal for the current revision, excluding newer stale proposals', async () => {
    source = { ...source, revision: 2, payload: picture('accepted') }; head = { ...head, revision: 2, candidateStamp: 1, pendingCandidates: 3 };
    const older = candidate('older', 10, 2); const latest = candidate('latest', 20, 2); const stale = candidate('stale', 30, 1);
    api.summaries.mockResolvedValue([summary(stale), summary(older), summary(latest)]); api.candidate.mockResolvedValue(latest);
    await mount();
    expect(api.candidate).toHaveBeenCalledWith('/project', 'source', latest.id);
    expect(api.render).toHaveBeenLastCalledWith(latest.payload, '/project', 'svg');

    api.summaries.mockResolvedValue([summary(stale)]);
    await refresh({ candidateStamp: 2, pendingCandidates: 1 });
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(text()).toContain('panel.creation.staleShort');
    expect(text()).toContain('panel.apps.vibimage.editor.staleCandidate');
    expect(api.candidate).toHaveBeenCalledTimes(1);
  });

  it('still renders an intentionally blank proposal or a later blank source revision', async () => {
    const draft = { ...candidate('Clear the image'), payload: newImageDocument() };
    head = { ...head, candidateStamp: 1, pendingCandidates: 1 };
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockResolvedValue(draft);
    await mount();
    expect(imageUrl()).toBe('blob:preview-1');
    expect(api.render).toHaveBeenLastCalledWith(draft.payload, '/project', 'svg');
    source = { ...source, revision: 2, payload: draft.payload };
    await refresh({ revision: 2, candidateStamp: 2, pendingCandidates: 0 });
    expect(imageUrl()).toBe('blob:preview-2');
    expect(text()).not.toContain('panel.apps.vibimage.empty');
  });

  it('restores the accepted image after discard and follows the source revision after acceptance', async () => {
    source = { ...source, payload: picture('accepted') };
    const draft = candidate('proposal');
    head = { ...head, candidateStamp: 1, pendingCandidates: 1 };
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockResolvedValue(draft);
    await mount();
    await refresh({ candidateStamp: 2, pendingCandidates: 0 });
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(text()).not.toContain('panel.apps.vibimage.editor.compare');
    expect(api.read).toHaveBeenCalledTimes(1);

    source = { ...source, revision: 2, payload: draft.payload };
    await refresh({ revision: 2, candidateStamp: 3 });
    expect(api.render).toHaveBeenLastCalledWith(draft.payload, '/project', 'svg');
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('panel.apps.vibimage.editor.compare');
  });

  it('keeps the displayed URL valid while a replacement is loading and revokes it after replacing and unmounting', async () => {
    source = { ...source, payload: picture('accepted') };
    await mount();
    const previous = imageUrl();
    const draft = candidate('proposal'); const pending = deferred<ImageCandidate>();
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockReturnValue(pending.promise);
    await refresh({ candidateStamp: 1, pendingCandidates: 1 });
    expect(imageUrl()).toBe(previous);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(previous);
    await act(async () => { pending.resolve(draft); });
    expect(imageUrl()).not.toBe(previous);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previous);
    const replacement = imageUrl();
    act(() => view!.unmount()); view = undefined;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(replacement);
  });

  it('falls back to the accepted image and reports a failed proposal read or render', async () => {
    source = { ...source, payload: picture('accepted') };
    const draft = candidate('broken');
    head = { ...head, candidateStamp: 1, pendingCandidates: 1 };
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockRejectedValue(new Error('missing'));
    await mount();
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(text()).toContain('panel.apps.vibimage.loadFailed');
    api.candidate.mockResolvedValue(draft);
    api.render.mockRejectedValueOnce(new Error('bad-picture'));
    await refresh({ candidateStamp: 2 });
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(text()).toContain('panel.apps.vibimage.loadFailed');
  });

  it('ignores a candidate whose body was accepted or became stale after the list was read', async () => {
    source = { ...source, payload: picture('accepted') };
    const draft = candidate('racing');
    head = { ...head, candidateStamp: 1, pendingCandidates: 1 };
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockResolvedValue({ ...draft, status: 'accepted' });
    await mount();
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    api.candidate.mockResolvedValue({ ...draft, baseRevision: 2 });
    await refresh({ candidateStamp: 2 });
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(text()).not.toContain('panel.apps.vibimage.editor.compare');
  });

  it('does not let a delayed proposal from a previous source replace the new source', async () => {
    const draft = candidate('old-proposal'); const pending = deferred<ImageCandidate>();
    head = { ...head, candidateStamp: 1, pendingCandidates: 1 };
    api.summaries.mockResolvedValue([summary(draft)]); api.candidate.mockReturnValue(pending.promise);
    await mount();
    source = { ...source, id: 'other', payload: picture('other') }; head = { ...head, id: 'other', candidateStamp: 0, pendingCandidates: 0 };
    await act(async () => { view!.update(<ImageSourceFace {...props} workRef="other" />); });
    const next = imageUrl();
    await act(async () => { pending.resolve(draft); });
    expect(imageUrl()).toBe(next);
    expect(api.render).toHaveBeenLastCalledWith(source.payload, '/project', 'svg');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
