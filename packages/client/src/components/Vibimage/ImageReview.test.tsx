import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationCandidateSummary } from '@vibisual/shared';
import { newImageDocument, newImageLayer, type ImageDocument } from '../Creation/imageSource.js';
import type { ImageCandidate, ImageSourceDoc } from './imageApi.js';
import { ImageReview } from './ImageReview.js';

const api = vi.hoisted(() => ({ revision: vi.fn(), stage: vi.fn(), translate: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: api.translate }) }));
vi.mock('./imageApi.js', async (original) => ({ ...await original<object>(), readImageRevision: api.revision }));
vi.mock('./ImageStage.js', () => ({ ImageStage: (props: { doc: ImageDocument }) => { api.stage(props); return createElement('image-stage', props); } }));

type Props = ComponentProps<typeof ImageReview>;
let view: ReactTestRenderer | undefined;
let props: Props;
const picture = (name: string): ImageDocument => {
  const payload = newImageDocument();
  return { ...payload, layers: [{ ...newImageLayer(payload, 'shape', name), id: name }] };
};
const source = (id = 'source', revision = 1): ImageSourceDoc => ({
  id, revision, appId: 'vibimage', schemaVersion: 1, title: id, payload: picture(id),
  links: [], lockedPaths: [], parameters: { imageRequestRevision: revision, imageSelection: [] },
  createdAt: 1, updatedAt: 1, label: '', author: 'user',
});
const candidate = (id = 'proposal', baseRevision = 1): ImageCandidate => ({
  id, baseRevision, label: id, createdAt: 1, status: 'pending', input: '', payload: picture(id),
});
const summary = ({ payload: _payload, ...item }: ImageCandidate): CreationCandidateSummary => item;
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const mount = async (): Promise<void> => { await act(async () => { view = create(<ImageReview {...props} />); }); };
const update = async (next: Partial<Props>): Promise<void> => {
  props = { ...props, ...next };
  await act(async () => { view!.update(<ImageReview {...props} />); });
};
const stages = (): ImageDocument[] => view!.root.findAllByType('image-stage' as never).map((item) => item.props.doc as ImageDocument);
const button = (label: string) => view!.root.findAllByType('button').find((item) => item.children.includes(`panel.apps.vibimage.editor.${label}`))!;
const text = (): string => JSON.stringify(view!.toJSON());

beforeEach(() => {
  vi.clearAllMocks();
  props = { root: '/project', source: source(), summary: summary(candidate()), readCandidate: vi.fn().mockResolvedValue(candidate()), disabled: false,
    onAccept: vi.fn().mockResolvedValue(true), onDiscard: vi.fn().mockResolvedValue(true), onRebase: vi.fn().mockResolvedValue(null), onClose: vi.fn() };
  api.revision.mockResolvedValue(source());
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('Vibimage proposal review identity', () => {
  it('shows the source and proposal together without accepting either on open', async () => {
    await mount();
    expect(stages()).toEqual([props.source.payload, candidate().payload]);
    expect(text()).toContain('panel.apps.vibimage.editor.source');
    expect(text()).toContain('panel.apps.vibimage.editor.compare');
    expect(button('accept').props.disabled).toBe(false);
    expect(props.onAccept).not.toHaveBeenCalled();
    await act(async () => { button('accept').props.onClick(); });
    expect(props.onAccept).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('clears the previous picture and checks immediately when another proposal is loading, including on failure', async () => {
    await mount();
    const pending = deferred<ImageCandidate>(); const next = candidate('next');
    vi.mocked(props.readCandidate).mockReturnValue(pending.promise);
    api.stage.mockClear();
    await update({ summary: summary(next) });
    expect(stages()).toEqual([]);
    expect(api.stage).not.toHaveBeenCalled();
    expect(button('accept').props.disabled).toBe(true);
    await act(async () => { button('accept').props.onClick(); pending.reject(new Error('candidate-not-found')); });
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(stages()).toEqual([]);
    expect(text()).toContain('panel.creation.errors.candidateNotFound');
    expect(text()).not.toContain('proposal (proposal)');
  });

  it('ignores delayed proposal reads from the previous selection', async () => {
    const oldRead = deferred<ImageCandidate>();
    vi.mocked(props.readCandidate).mockReturnValue(oldRead.promise);
    await mount();
    const next = candidate('next');
    vi.mocked(props.readCandidate).mockResolvedValue(next);
    await update({ summary: summary(next) });
    expect(stages()).toEqual([props.source.payload, next.payload]);
    await act(async () => { oldRead.resolve(candidate()); });
    expect(stages()).toEqual([props.source.payload, next.payload]);
  });

  it.each(['root', 'source', 'baseRevision'] as const)('does not reuse a proposal body after changing %s', async (field) => {
    await mount();
    const next = candidate('proposal', field === 'baseRevision' ? 2 : 1);
    const pending = deferred<ImageCandidate>();
    vi.mocked(props.readCandidate).mockReturnValue(pending.promise);
    const changes = field === 'root' ? { root: '/other' } : field === 'source' ? { source: source('other') }
      : { source: source('source', 2), summary: summary(next) };
    await update(changes);
    expect(stages()).toEqual([]);
    expect(button('accept').props.disabled).toBe(true);
    await act(async () => { pending.resolve(next); });
    expect(stages()).toEqual([props.source.payload, next.payload]);
  });

  it.each([
    { status: 'accepted' as const }, { status: 'discarded' as const }, { id: 'different' }, { baseRevision: 2 },
  ])('rejects a candidate body that no longer matches the pending summary: %j', async (changed) => {
    vi.mocked(props.readCandidate).mockResolvedValue({ ...candidate(), ...changed });
    await mount();
    expect(stages()).toEqual([]);
    expect(button('accept').props.disabled).toBe(true);
    expect(text()).toContain('panel.creation.errors.candidateConflict');
    await act(async () => { button('accept').props.onClick(); });
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('waits for the matching immutable base and cannot accept a stale proposal', async () => {
    const oldBase = source(); const pending = deferred<ImageSourceDoc>();
    props.source = source('source', 2); api.revision.mockReturnValue(pending.promise);
    await mount();
    expect(api.revision).toHaveBeenCalledWith('/project', 'source', 1);
    expect(stages()).toEqual([]);
    await act(async () => { pending.resolve(oldBase); });
    expect(stages()).toEqual([oldBase.payload, candidate().payload]);
    expect(button('accept').props.disabled).toBe(true);
    await act(async () => { button('accept').props.onClick(); });
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('rejects an immutable base returned for a different source', async () => {
    props.source = source('source', 2); api.revision.mockResolvedValue(source('other'));
    await mount();
    expect(stages()).toEqual([]);
    expect(text()).toContain('panel.creation.errors.revisionNotFound');
    expect(button('accept').props.disabled).toBe(true);
  });

  it('does not carry unchecked-selection confirmation over to the next proposal', async () => {
    props.source = { ...props.source, parameters: {} };
    await mount();
    await act(async () => { button('accept').props.onClick(); });
    expect(button('acceptAnyway')).toBeDefined();
    const next = candidate('next'); vi.mocked(props.readCandidate).mockResolvedValue(next);
    await update({ summary: summary(next) });
    expect(button('accept')).toBeDefined();
    await act(async () => { button('accept').props.onClick(); });
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('keeps a newly selected review open when an earlier acceptance completes', async () => {
    const accepted = deferred<boolean>(); vi.mocked(props.onAccept).mockReturnValue(accepted.promise);
    await mount();
    await act(async () => { button('accept').props.onClick(); });
    const next = candidate('next'); vi.mocked(props.readCandidate).mockResolvedValue(next);
    await update({ summary: summary(next) });
    await act(async () => { accepted.resolve(true); });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(stages()).toEqual([props.source.payload, next.payload]);
  });

  it('does not close anything after an accepted review has already unmounted', async () => {
    const accepted = deferred<boolean>(); vi.mocked(props.onAccept).mockReturnValue(accepted.promise);
    await mount();
    await act(async () => { button('accept').props.onClick(); });
    act(() => view!.unmount()); view = undefined;
    await act(async () => { accepted.resolve(true); });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
