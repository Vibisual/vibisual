import { describe, expect, it } from 'vitest';
import { VIBI3D_LIMITS, type BubbleData, type Vibi3DSnapshot } from '@vibisual/shared';
import { creationProjectAgents as vibi3dProjectAgents } from '../Creation/creationAgents.js';
import { vibi3dAgentPrompt } from './vibi3dAgentPrompt.js';

const snapshot: Vibi3DSnapshot = { sessionId: 'scene-1', projectId: '/work/project', fileName: 'chair.glb',
  revision: 8, selectedId: 'chair-2', nodes: [] };
const agent = (id: string, more: Partial<BubbleData> = {}): BubbleData => ({ id, label: id, bubbleType: 'agent',
  path: `${id}-session`, status: 'idle', activity: 0, customCreated: true, ...more });

describe('Vibi3D scene request', () => {
  it('keeps hidden sessions live and limits document reopen to offline sessions', () => {
    const prompt = vibi3dAgentPrompt({ ...snapshot, document: { id: 'product', revision: 3, dirty: false }, runId: 'run' }, 'Continue');
    expect(prompt).toContain('/documents/product/reopen');
    expect(prompt).toContain('Closing the Vibi3D window keeps the live session and agent connection running');
    expect(prompt).toContain('do not reopen the window just because it is hidden');
    expect(prompt).toContain('Only if the session is actually offline');
    expect(prompt).not.toContain('If its window closes, POST');
    expect(prompt).toContain('Saved work drafts survive closing the view');
    expect(prompt).toContain('Full app shutdown waits for durable draft writes');
    expect(prompt).toContain('"runId":"run"');
    expect(prompt).toContain('/authoring/native-kit?projectId=');
    expect(prompt).toContain('result.captures');
    expect(prompt).toContain('Open those actual files');
    expect(prompt).toContain('never accept your own candidate');
    expect(prompt).toContain(`1 to ${VIBI3D_LIMITS.commandCount}`);
    expect(prompt).toContain(`${VIBI3D_LIMITS.requestBytes} UTF-8 JSON bytes`);
    expect(prompt).toContain('stats, capture, checkpoint, propose and resume');
    expect(prompt).toContain('sign.source or decal.source');
    expect(prompt).toContain('size:[1080,1920]');
    expect(prompt).toContain('local-transport-network-required');
  });
  it('gives the agent a live read, bounded edits, revision conflict recovery and verifiable command status', () => {
    const prompt = vibi3dAgentPrompt(snapshot, 'Make the selected chair blue');
    expect(prompt).toContain('GET /api/app/vibi3d/sessions/scene-1');
    expect(prompt).toContain('POST /api/app/vibi3d/sessions/scene-1/commands');
    expect(prompt).toContain('"selectedId":"chair-2"');
    expect(prompt).toContain('expectedRevision');
    expect(prompt).toContain('preserve human edits');
    expect(prompt).toContain('unsaved-human-edits means scene mutations are temporarily blocked');
    expect(prompt).toContain('Never discard or save the human draft through agent commands');
    expect(prompt).toContain('Wait for the user to save or discard their own edits, then GET the latest snapshot');
    expect(prompt).toContain('DEGREES');
    expect(prompt).toContain('HTTP 202 only means queued, never completed');
    expect(prompt).toContain('/image');
    expect(prompt).toContain('automatically saves each successful mutation into the AI work draft before acknowledging applied');
    expect(prompt).toContain('This does not apply the draft to the original source');
    expect(prompt).not.toContain('Initially empty documents commit revisions');
  });

  it('continues an autosaved draft without demanding source mutation or a checkpoint workflow', () => {
    const prompt = vibi3dAgentPrompt({ ...snapshot, document: { id: 'product', revision: 1, dirty: true } }, 'Refine', { workDraft: true });
    expect(prompt).toContain('Continue the automatically saved AI work draft');
    expect(prompt).toContain('Do not checkpoint, propose, accept, or commit');
    expect(prompt).not.toContain('At EVERY stage: checkpoint');
    expect(prompt).not.toContain('unsaved until');
    expect(prompt).toContain('Otherwise inspect the existing /image JPEG');
  });

  it('passes the request as data and never propagates private renderer credentials', () => {
    const privateSnapshot = { ...snapshot, rendererToken: 'private-secret-value', hiddenAuth: 'secret-auth' };
    const prompt = vibi3dAgentPrompt(privateSnapshot, 'Name says "chair"\nmake it blue');
    expect(prompt).toContain(JSON.stringify('Name says "chair"\nmake it blue'));
    expect(prompt).toContain('VIBISUAL_TOKEN');
    expect(prompt).toContain('x-vibisual-hook-token');
    expect(prompt).not.toContain('private-secret-value');
    expect(prompt).not.toContain('secret-auth');
    expect(prompt).not.toContain('rendererToken');
    expect(prompt).not.toContain('/publish');
  });

  it('distinguishes the captured animation preview from the authored transforms used for edits', () => {
    const prompt = vibi3dAgentPrompt(snapshot, 'Fix the pictured pose');
    expect(prompt).toContain('Capture pauses animation and auto-rotation at the current pose');
    expect(prompt).toContain('Node transform values describe the authored pose');
    expect(prompt).toContain('snapshot.playback identifies the animation preview time');
    expect(prompt).toContain('Editing stops the preview and applies changes to the authored state');
  });

  it('treats a renderer timeout as uncertain and forbids automatically repeating a relative edit', () => {
    const prompt = vibi3dAgentPrompt(snapshot, 'Move it one unit right');
    expect(prompt).toContain('command-timeout-refresh-state means the outcome is still uncertain, even if status says rejected');
    expect(prompt).toContain('late renderer acknowledgement may change it to applied');
    expect(prompt).toContain('Re-read the scene and poll the SAME commandId');
    expect(prompt).toContain('Do not automatically replay the edit, issue a new commandId, or calculate and submit another relative edit');
    expect(prompt).toContain('If uncertainty remains at the polling limit, report it and stop');
  });

  it('only offers available custom agents from the exact project, resolving display names to paths', () => {
    const agents = [agent('own'), agent('other'), agent('hook', { customCreated: false }),
      agent('trashed', { trashed: true }), agent('missing', { path: '' }), agent('unknown')];
    const ownership = { own: 'Project', other: 'Other', hook: 'Project', trashed: 'Project', missing: 'Project' };
    const projects = { Project: { name: 'Project', path: '/work/project' }, Other: { name: 'Other', path: '/other/project' } };
    expect(vibi3dProjectAgents(agents, ownership, projects, '/work/project').map((entry) => entry.id)).toEqual(['own']);
    expect(vibi3dProjectAgents(agents, ownership, projects, 'Project').map((entry) => entry.id)).toEqual(['own']);
    expect(vibi3dProjectAgents(agents, ownership, projects, '')).toEqual([]);
  });
});
