import { createElement, type ComponentProps, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationCandidateSummary } from '@vibisual/shared';
import { newImageDocument, newImageLayer } from './imageDocument.js';
import type { ImageSourceDoc } from './imageApi.js';
import { useImageDocument } from './useImageDocument.js';
import { ImageEditor } from './ImageEditor.js';
import { VibimageShell } from './VibimageShell.js';
import { ImageReview } from './ImageReview.js';
import { ImageStage } from './ImageStage.js';
import { ImageToolbar } from './ImageToolbar.js';
import { ImageSourcePicker } from './ImageSourcePicker.js';
import { ImageAgentPanel } from './ImageAgentPanel.js';
import { ImagePhotoTools } from './ImagePhotoTools.js';
import { SourceConnections } from '../Creation/SourceConnections.js';

const hooks = vi.hoisted(() => ({ document: vi.fn(), output: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./useImageDocument.js', () => ({ useImageDocument: hooks.document }));
vi.mock('./useImageExport.js', () => ({ useImageExport: hooks.output }));
vi.mock('../../apps/appWindowLifecycle.js', () => ({ useAppWindowTarget: vi.fn(), useAppWindowTransferGuard: vi.fn() }));
vi.mock('../../apps/appWindowCloseGuard.js', () => ({ useAppWindowCloseGuard: vi.fn() }));
vi.mock('../../utils/appDialog.js', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/platform.js', () => ({ shortcutLabel: (key: string) => key }));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => children }));
vi.mock('../Creation/SourceConnections.js', () => ({ SourceConnections: () => null }));
vi.mock('./ImageToolbar.js', () => ({ ImageToolbar: () => null }));
vi.mock('./ImageStage.js', () => ({ ImageStage: () => null }));
vi.mock('./ImageInspector.js', () => ({ ImageInspector: () => null }));
vi.mock('./ImageAgentPanel.js', () => ({ ImageAgentPanel: () => null }));
vi.mock('./ImagePhotoTools.js', () => ({ ImagePhotoTools: () => null }));
vi.mock('./ImageReview.js', () => ({ ImageReview: () => null }));
vi.mock('./ImageSourcePicker.js', () => ({ ImageSourcePicker: () => null }));
vi.mock('./VibimageViewer.js', () => ({ VibimageViewer: () => null }));

type EditorState = ReturnType<typeof useImageDocument>;
type EditorProps = ComponentProps<typeof ImageEditor>;
type ReviewProps = ComponentProps<typeof ImageReview>;
const mounted = new Set<ReactTestRenderer>();

function source(id = 'picture', revision = 2): ImageSourceDoc {
  return { schemaVersion: 1, id, appId: 'vibimage', title: id, revision, payload: newImageDocument(),
    parameters: {}, lockedPaths: [], links: [], createdAt: 1, updatedAt: revision, label: '', author: 'user' };
}
function candidate(id: string, createdAt = 3, overrides: Partial<CreationCandidateSummary> = {}): CreationCandidateSummary {
  return { id, baseRevision: 2, label: `Drawing ${id}`, input: '', createdAt, status: 'pending', ...overrides };
}
function editorState(overrides: Partial<EditorState> = {}): EditorState {
  const doc = source();
  return {
    doc, draft: doc.payload, title: doc.title, docs: [doc], failedDocs: [], candidates: [], remote: null,
    busy: false, error: '', dirty: false, canUndo: false, canRedo: false,
    setTitle: vi.fn(), change: vi.fn(), endEdit: vi.fn(), open: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(doc), accept: vi.fn().mockResolvedValue(true), discard: vi.fn().mockResolvedValue(true),
    cleanup: vi.fn().mockResolvedValue(true), rebase: vi.fn().mockResolvedValue(null), readCandidate: vi.fn(),
    copy: vi.fn().mockResolvedValue(undefined), adopt: vi.fn(), receive: vi.fn(), refreshDocs: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(), useRemote: vi.fn(), fresh: vi.fn(), undo: vi.fn().mockResolvedValue(undefined), redo: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
function fixture(initial: Partial<EditorState> = {}, throughShell = false) {
  let state = editorState(initial);
  let props: EditorProps = { appId: 'vibimage', params: { projectId: '/project', ref: state.doc?.id ?? '', appWindowHosted: '1' } };
  const output = { busy: false, error: '', paths: [], run: vi.fn().mockResolvedValue(undefined) };
  hooks.document.mockImplementation(() => state);
  hooks.output.mockReturnValue(output);
  const Component = throughShell ? VibimageShell : ImageEditor;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(createElement(Component, props)); });
  mounted.add(renderer);
  return {
    renderer, output,
    get state() { return state; },
    update(next: Partial<EditorState>, nextParams?: Record<string, string>) {
      state = { ...state, ...next };
      if (nextParams) props = { ...props, params: { ...props.params, ...nextParams } };
      act(() => renderer.update(createElement(Component, props)));
    },
    review: () => renderer.root.findByType(ImageReview).props as ReviewProps,
    reviews: () => renderer.root.findAllByType(ImageReview),
    stage: () => renderer.root.findByType(ImageStage).props as ComponentProps<typeof ImageStage>,
    toolbar: () => renderer.root.findByType(ImageToolbar).props as ComponentProps<typeof ImageToolbar>,
    back() { act(() => this.review().onClose()); },
    compare(label: string) {
      const button = renderer.root.findAllByType('button').find((item) => item.children.includes(label));
      expect(button, `Compare button for ${label}`).toBeDefined();
      act(() => button!.props.onClick());
    },
    shortcut(key: string, shiftKey = false) {
      const event = { key, ctrlKey: true, metaKey: false, shiftKey, target: null, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      act(() => renderer.root.findByProps({ 'data-shortcut-scope': 'dialog' }).props.onKeyDown(event));
      return event;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('HTMLElement', class HTMLElement {});
});
afterEach(() => {
  act(() => mounted.forEach((renderer) => renderer.unmount()));
  mounted.clear();
  vi.unstubAllGlobals();
});

describe('ImageEditor follows the generated picture shown on its canvas node', () => {
  it('opens the same drawing through the source-node VibimageShell entry point used by double-click', () => {
    const generated = candidate('dokkaebi');
    const h = fixture({ candidates: [generated] }, true);
    expect(h.renderer.root.findAllByType(ImageEditor)).toHaveLength(1);
    expect(hooks.document).toHaveBeenLastCalledWith('/project', 'picture');
    expect(h.review().summary).toEqual(generated);
    expect(h.state.draft.layers).toHaveLength(0);
    expect(h.state.save).not.toHaveBeenCalled();
    expect(h.state.accept).not.toHaveBeenCalled();
  });

  it('opens the newest pending candidate for the current revision without committing the blank original', () => {
    const latest = candidate('latest', 10);
    const h = fixture({ candidates: [candidate('older', 5), latest, candidate('stale', 30, { baseRevision: 1 }),
      candidate('accepted', 40, { status: 'accepted' }), candidate('discarded', 50, { status: 'discarded' })] });
    expect(h.review().summary).toEqual(latest);
    expect(h.review().source).toBe(h.state.doc);
    expect(h.state.change).not.toHaveBeenCalled();
    expect(h.state.save).not.toHaveBeenCalled();
    expect(h.state.accept).not.toHaveBeenCalled();
    expect(JSON.stringify(h.renderer.toJSON())).toContain(latest.label);
  });

  it('shows an arriving drawing while the editor is open and follows later proposals automatically', () => {
    const h = fixture();
    expect(h.reviews()).toHaveLength(0);
    expect(h.stage().doc.layers).toHaveLength(0);
    const first = candidate('first');
    h.update({ candidates: [first] });
    expect(h.review().summary.id).toBe('first');
    h.update({ candidates: [candidate('second', 4), first] });
    expect(h.review().summary.id).toBe('second');
    expect(h.state.change).not.toHaveBeenCalled();
  });

  it('keeps Back on the original across polling, then reveals a newly arriving candidate', () => {
    const first = candidate('first');
    const h = fixture({ candidates: [first] });
    h.back();
    expect(h.reviews()).toHaveLength(0);
    expect(h.stage().doc).toBe(h.state.draft);
    h.update({ candidates: [{ ...first }] });
    expect(h.reviews()).toHaveLength(0);
    h.update({ candidates: [first, candidate('newer', 4)] });
    expect(h.review().summary.id).toBe('newer');
  });

  it('preserves an explicitly compared older or stale candidate when newer proposals arrive', () => {
    const stale = candidate('stale', 1, { baseRevision: 1 });
    const latest = candidate('latest');
    const h = fixture({ candidates: [stale, latest] });
    h.back();
    h.compare(stale.label);
    expect(h.review().summary.id).toBe(stale.id);
    h.update({ candidates: [stale, latest, candidate('newest', 9)] });
    expect(h.review().summary.id).toBe(stale.id);
  });

  it('keeps unsaved work visible when a proposal arrives, allowing an explicit disabled comparison', () => {
    const draft = newImageDocument();
    draft.layers = [newImageLayer(draft, 'text', 'My unsaved drawing')];
    const h = fixture({ dirty: true, draft });
    const proposal = candidate('generated');
    h.update({ candidates: [proposal] });
    expect(h.reviews()).toHaveLength(0);
    expect(h.stage().doc).toBe(draft);
    expect(h.state.change).not.toHaveBeenCalled();
    h.compare(proposal.label);
    expect(h.review().disabled).toBe(true);
    h.back();
    expect(h.stage().doc).toBe(draft);
    expect(h.state.save).not.toHaveBeenCalled();
  });

  it('does not replace the photo tools with a newly arriving comparison', () => {
    const h = fixture();
    act(() => h.toolbar().onTools());
    h.update({ candidates: [candidate('generated')] });
    expect(h.reviews()).toHaveLength(0);
    const tools = h.renderer.root.findByType(ImagePhotoTools);
    expect(tools.props.doc).toBe(h.state.draft);
    act(() => tools.props.onClose());
    expect(h.review().summary.id).toBe('generated');
  });

  it('chooses the remaining valid proposal when the currently selected candidate disappears', () => {
    const older = candidate('older', 1);
    const latest = candidate('latest', 2);
    const h = fixture({ candidates: [older, latest] });
    h.back();
    h.compare(latest.label);
    h.update({ candidates: [older] });
    expect(h.review().summary.id).toBe('older');
    h.update({ candidates: [] });
    expect(h.reviews()).toHaveLength(0);
    expect(h.stage().doc).toBe(h.state.draft);
  });

  it('shows the accepted source after acceptance and does not automatically reopen stale proposals', async () => {
    const selected = candidate('selected', 4);
    const h = fixture({ candidates: [selected, candidate('older', 3)] });
    const review = h.review();
    await act(async () => { expect(await review.onAccept()).toBe(true); });
    expect(h.state.accept).toHaveBeenCalledWith(selected);
    const accepted = source('picture', 3);
    accepted.payload.layers = [newImageLayer(accepted.payload, 'shape', 'Accepted drawing')];
    h.update({ doc: accepted, draft: accepted.payload, candidates: [candidate('older', 3)] });
    act(() => review.onClose());
    expect(h.reviews()).toHaveLength(0);
    expect(h.stage().doc).toBe(accepted.payload);
  });

  it('shows the next available candidate after discarding a displayed proposal', async () => {
    const older = candidate('older', 2);
    const latest = candidate('latest', 3);
    const h = fixture({ candidates: [older, latest] });
    const review = h.review();
    await act(async () => { expect(await review.onDiscard()).toBe(true); });
    expect(h.state.discard).toHaveBeenCalledWith(latest.id);
    h.update({ candidates: [older] });
    act(() => review.onClose());
    expect(h.review().summary.id).toBe(older.id);
  });

  it('does not replace a different selected comparison when an earlier rebase finishes late', async () => {
    const stale = candidate('stale', 1, { baseRevision: 1 });
    const latest = candidate('latest', 3);
    let finish!: (id: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const h = fixture({ candidates: [stale, latest], rebase: vi.fn().mockReturnValue(pending) });
    h.back();
    h.compare(stale.label);
    let rebase!: Promise<string | null>;
    act(() => { rebase = h.review().onRebase(); });
    expect(h.state.rebase).toHaveBeenCalledWith(stale.id);
    h.back();
    h.compare(latest.label);
    const rebased = candidate('rebased', 5);
    h.update({ candidates: [stale, latest, rebased] });
    await act(async () => { finish(rebased.id); await rebase; });
    expect(h.review().summary.id).toBe(latest.id);
  });

  it('resets a Back choice for another document and for another project with matching document/candidate ids', () => {
    const proposal = candidate('same-candidate');
    const h = fixture({ candidates: [proposal] });
    h.back();
    const other = source('other-picture');
    h.update({ doc: other, draft: other.payload, candidates: [proposal] });
    expect(h.review().source.id).toBe(other.id);
    h.back();
    h.update({}, { projectId: '/another-project' });
    expect(h.review().root).toBe('/another-project');
    expect(h.review().summary.id).toBe(proposal.id);
  });

  it('hides original edit/export/link/agent controls and consumes save/history shortcuts during comparison', () => {
    const h = fixture({ candidates: [candidate('generated')] });
    for (const pane of [ImageToolbar, ImageSourcePicker, SourceConnections]) {
      expect(h.renderer.root.findAllByType(pane)).toHaveLength(0);
    }
    const panel = h.renderer.root.findByType(ImageAgentPanel);
    expect(panel.parent?.props.hidden).toBe(true);
    expect(panel.props.busy).toBe(true);
    for (const key of ['s', 'z', 'y']) {
      const event = h.shortcut(key);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    }
    h.shortcut('z', true);
    expect(h.state.save).not.toHaveBeenCalled();
    expect(h.state.undo).not.toHaveBeenCalled();
    expect(h.state.redo).not.toHaveBeenCalled();
    expect(h.output.run).not.toHaveBeenCalled();
    h.back();
    expect(h.renderer.root.findAllByType(ImageToolbar)).toHaveLength(1);
    h.shortcut('s');
    expect(h.state.save).toHaveBeenCalledOnce();
  });

  it('preserves the mounted agent panel and its connection while comparison hides its controls', () => {
    const h = fixture();
    const panel = h.renderer.root.findByType(ImageAgentPanel);
    expect(panel.parent?.props.hidden).toBe(false);
    expect(panel.props.busy).toBe(false);
    h.update({ candidates: [candidate('generated')] });
    expect(h.renderer.root.findByType(ImageAgentPanel)).toBe(panel);
    expect(panel.parent?.props.hidden).toBe(true);
    expect(panel.props.busy).toBe(true);
    h.back();
    expect(h.renderer.root.findByType(ImageAgentPanel)).toBe(panel);
    expect(panel.parent?.props.hidden).toBe(false);
    expect(panel.props.busy).toBe(false);
  });

  it('keeps normal source editing and export available when no current pending candidate exists', () => {
    const h = fixture({ candidates: [candidate('old', 4, { baseRevision: 1 }), candidate('done', 5, { status: 'accepted' })] });
    expect(h.reviews()).toHaveLength(0);
    act(() => h.toolbar().onExport('png', false));
    expect(h.output.run).toHaveBeenCalledWith('png', false);
    act(() => h.toolbar().onAdd('shape'));
    expect(h.state.change).toHaveBeenCalledWith(expect.objectContaining({ layers: [expect.objectContaining({ kind: 'shape' })] }));
  });
});
