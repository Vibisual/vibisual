import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CreationCandidate, CreationCandidateSummary, CreationDoc, CreationHead, CreationValue } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { serializeModelSource } from './modelSource.js';
import { compareModelSources } from './modelComparison.js';
import { Vibi3DCandidates } from './Vibi3DCandidates.js';
import { Vibi3DCandidatePreview } from './Vibi3DCandidatePreview.js';
import { vibi3dCandidatePrompt } from './vibi3dCandidatePrompt.js';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
function fixture(locked = false): { editor: ModelEditor; doc: CreationDoc; candidate: CreationCandidate; summary: CreationCandidateSummary } {
  const editor = new ModelEditor(new THREE.Group(), [], { projectId: 'project' });
  editor.apply([{ type: 'create', id: 'body', name: 'Bottle', recipe: { kind: 'cylinder', height: 2 } }, { type: 'create', id: 'lid', name: 'Lid', recipe: { kind: 'cylinder', height: 0.4 } }], 0);
  if (locked) editor.apply({ type: 'protect', id: 'lid', locked: true }, editor.revision);
  const payload = serializeModelSource(editor.object, editor.clips);
  const changed = structuredClone(payload);
  const lid = changed.scene.object.children![1] as unknown as { matrix: number[] };
  lid.matrix![13] = 3;
  const doc: CreationDoc = { schemaVersion: 1, id: 'model', appId: 'vibi3d', title: 'Product', revision: 2, payload: payload as unknown as CreationValue,
    parameters: {}, lockedPaths: [], links: [], createdAt: 1, updatedAt: 1, label: '', author: 'user', canUndo: true };
  const candidate: CreationCandidate = { id: 'candidate', baseRevision: 2, payload: changed as unknown as CreationValue, label: 'Move lid', input: 'Raise only the lid', createdAt: 2, status: 'pending' };
  const { payload: _payload, ...summary } = candidate;
  return { editor, doc, candidate, summary };
}
const head = (stamp: number): CreationHead => ({ id: 'model', appId: 'vibi3d', revision: 2, updatedAt: 1, candidateStamp: stamp, pendingCandidates: 1 });
interface Calls { list: number; body: number; posts: string[] }
function serve(summary: CreationCandidateSummary, candidate: CreationCandidate): Calls {
  const calls: Calls = { list: 0, body: 0, posts: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });
    if (init?.method === 'POST') {
      calls.posts.push(url);
      if (url.includes('/rebase')) return json({ candidate: { ...summary, id: 'moved', baseRevision: 2, rebasedFrom: summary.id } });
      if (url.includes('/discard')) return json({ candidate: { ...summary, status: 'discarded' } });
      return json({ discarded: 1 });
    }
    if (url.includes('/candidates/')) { calls.body += 1; return json({ candidate }); }
    calls.list += 1;
    return json({ candidates: [summary] });
  }));
  return calls;
}
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function button(key: string) { return renderer!.root.findAllByType('button').find((node) => node.children.join('') === key); }
async function openReview(props: Parameters<typeof Vibi3DCandidates>[0], select = 'candidate'): Promise<void> {
  await act(async () => { renderer = create(createElement(Vibi3DCandidates, props)); });
  await act(async () => { renderer!.root.findByType('details').props.onToggle({ currentTarget: { open: true } }); await tick(); });
  await act(async () => { renderer!.root.findByType('select').props.onChange({ target: { value: select } }); await tick(); });
}
const previewKey = (): string | undefined => (renderer!.root.findByType(Vibi3DCandidatePreview).props as { item: { key: string } | null }).item?.key;

describe('3D candidate review', () => {
  it('compares only affected stable objects and flags changed protected objects', () => {
    const plain = fixture();
    expect(compareModelSources(plain.doc.payload, plain.candidate.payload)).toEqual([{ id: 'lid', name: 'Lid', kind: 'changed', protected: false }]);
    const locked = fixture(true);
    expect(compareModelSources(locked.doc.payload, locked.candidate.payload)[0]?.protected).toBe(true);
    expect(compareModelSources(locked.doc.payload, locked.doc.payload)).toEqual([]);
  });

  it('lists nothing until opened, reads the body only when chosen, switches before/after, and adopts only on request', async () => {
    const { doc, candidate, summary } = fixture(); const accept = vi.fn(async () => undefined);
    const calls = serve(summary, candidate);
    await act(async () => { renderer = create(createElement(Vibi3DCandidates, { projectId: 'project', doc, head: head(1), disabled: false, onAccept: accept, onRevert: vi.fn() })); });
    expect(calls.list).toBe(0);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    await openReview({ projectId: 'project', doc, head: head(1), disabled: false, onAccept: accept, onRevert: vi.fn() });
    expect(calls).toMatchObject({ list: 1, body: 1 });
    expect(previewKey()).toBe('candidate:candidate@2');
    act(() => button('panel.vibi3d.review.before')!.props.onClick());
    expect(previewKey()).toBe('doc:model@2');
    act(() => button('panel.vibi3d.review.after')!.props.onClick());
    expect(previewKey()).toBe('candidate:candidate@2');
    expect(accept).not.toHaveBeenCalled();
    await act(async () => { button('panel.vibi3d.review.accept')!.props.onClick(); await tick(); });
    expect(accept).toHaveBeenCalledWith(candidate);
  });

  it('(2) a poll keeps the chosen candidate and its preview — the list is read again only when the stamp moved, the body never', async () => {
    const { doc, candidate, summary } = fixture();
    const calls = serve(summary, candidate);
    const props = { projectId: 'project', doc, head: head(1), disabled: false, onAccept: vi.fn(), onRevert: vi.fn() };
    await openReview(props);
    expect(previewKey()).toBe('candidate:candidate@2');
    await act(async () => { renderer!.update(createElement(Vibi3DCandidates, { ...props, head: { ...head(1), updatedAt: 5 } })); await tick(); });
    expect(calls.list).toBe(1);
    await act(async () => { renderer!.update(createElement(Vibi3DCandidates, { ...props, head: head(2) })); await tick(); });
    expect(calls.list).toBe(2);
    expect(calls.body).toBe(1);
    expect(previewKey()).toBe('candidate:candidate@2');
  });

  it.each(['locked', 'stale', 'dirty'])('blocks unsafe adoption when %s', async (reason) => {
    const { doc, candidate, summary } = fixture(reason === 'locked');
    if (reason === 'stale') { candidate.baseRevision = 1; summary.baseRevision = 1; }
    serve(summary, candidate);
    const accept = vi.fn(async () => undefined);
    await openReview({ projectId: 'project', doc, head: head(1), disabled: reason === 'dirty', onAccept: accept, onRevert: vi.fn() });
    expect(button('panel.vibi3d.review.accept')!.props.disabled).toBe(true); expect(accept).not.toHaveBeenCalled();
  });

  it('moves a stale candidate onto the current version and selects the rebased one', async () => {
    const { doc, candidate, summary } = fixture(); candidate.baseRevision = 1; summary.baseRevision = 1;
    const calls = serve(summary, candidate);
    await openReview({ projectId: 'project', doc, head: head(1), disabled: false, onAccept: vi.fn(), onRevert: vi.fn() });
    await act(async () => { button('panel.creation.rebase')!.props.onClick(); await tick(); });
    expect(calls.posts.some((url) => url.includes('/candidates/candidate/rebase'))).toBe(true);
    expect(renderer!.root.findByType('select').props.value).toBe('moved');
  });

  it('discards one candidate and cleans up outdated ones', async () => {
    const { doc, candidate, summary } = fixture(); summary.baseRevision = 1;
    const calls = serve(summary, candidate);
    await openReview({ projectId: 'project', doc, head: head(1), disabled: false, onAccept: vi.fn(), onRevert: vi.fn() });
    await act(async () => { button('ide.verify.demo.discard')!.props.onClick(); await tick(); });
    expect(calls.posts.some((url) => url.includes('/candidates/candidate/discard'))).toBe(true);
    await act(async () => { button('panel.creation.cleanupStale')!.props.onClick(); await tick(); });
    expect(calls.posts.some((url) => url.includes('/candidates-cleanup'))).toBe(true);
  });

  it('prompts the agent to propose against a version and selected ID without adopting its own work', () => {
    const { doc, editor } = fixture(); editor.select('lid');
    const prompt = vibi3dCandidatePrompt(editor.snapshot(), doc, 'make lid gold');
    expect(prompt).toContain('propose {label}'); expect(prompt).toContain('baseRevision'); expect(prompt).toContain('"selectedId":"lid"');
    expect(prompt).toContain('Never accept your own candidate'); expect(prompt).toContain('preserve newer human edits');
    expect(prompt).toContain('409 stale-base'); expect(prompt).toContain('candidate-limit'); expect(prompt).toContain('vibi-blob:');
    expect(prompt).not.toContain('prefer the installed Blender authoring kit');
    const blender = vibi3dCandidatePrompt(editor.snapshot(), doc, 'Use Blender to make the lid gold');
    expect(blender).toContain('/candidates'); expect(blender).toContain('baseRevision');
    expect(blender).toContain('Never accept your own candidate');
  });
});
