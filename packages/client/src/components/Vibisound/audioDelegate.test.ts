import { describe, expect, it } from 'vitest';
import type { AgentConfig, BubbleData } from '@vibisual/shared';
import type { AudioDoc } from '@vibisual/audio';
import { audioDelegateAgents, buildAudioDelegatePrompt } from './audioDelegate.js';

// Fixtures intentionally contain only the fields consumed by the pure selector.
const agent = (id: string, patch: Partial<BubbleData> = {}): BubbleData => ({
  id, path: id, bubbleType: 'agent', customCreated: true, ...patch,
} as BubbleData);
const config = (patch: Partial<AgentConfig>): AgentConfig => patch as AgentConfig;

describe('Vibisound agent scope', () => {
  it('accepts only editable headless Claude agents in the exact project', () => {
    const agents = [agent('ok'), agent('other'), agent('hook', { customCreated: false }),
      agent('trash', { trashed: true }), agent('cmd'), agent('local'), agent('codex'), agent('missing', { path: '' })];
    const owners = Object.fromEntries(agents.map((a) => [a.id, a.id === 'other' ? '/other' : '/project']));
    const configs = { cmd: config({ executionMode: 'interactive-terminal' }),
      local: config({ provider: { kind: 'local-llama', modelId: 'local' } }),
      codex: config({ provider: { kind: 'codex-cli', modelId: '' } }) };
    expect(audioDelegateAgents(agents, owners, configs, '/project', 'linux').map((a) => a.id)).toEqual(['ok']);
    expect(audioDelegateAgents(agents, owners, configs, '', 'linux')).toEqual([]);
  });
  it('uses the platform path rules, preserving Linux case and worktree boundaries', () => {
    expect(audioDelegateAgents([agent('a')], { a: 'C:\\Work\\Project' }, {}, 'c:/work/project', 'win32')).toHaveLength(1);
    expect(audioDelegateAgents([agent('a')], { a: '/work/Project' }, {}, '/work/project', 'linux')).toHaveLength(0);
    expect(audioDelegateAgents([agent('a')], { a: '/work/project/branch' }, {}, '/work/project', 'linux')).toHaveLength(0);
  });
});

describe('Vibisound editing handoff', () => {
  const doc: AudioDoc = { schemaVersion: 1, id: 'doc/one', title: 'Mix', version: 3, sampleRate: 48000, channels: 2,
    tracks: [{ id: 'track', clips: [{ id: 'clip', assetId: 'asset', at: 10, sourceStart: 2, duration: 8, locked: true }] }],
    assets: {}, createdAt: 1, updatedAt: 1 };
  it('requires a fresh version and states the project/clip/source coordinate distinction', () => {
    const prompt = buildAudioDelegatePrompt({ projectId: '/work/a b', doc, selectedClipId: 'clip',
      selection: { start: 12, end: 15 }, request: 'Lower the selection', requestId: 'sound-123' });
    expect(prompt).toContain('First GET /api/app/vibisound/doc/doc%2Fone?project=%2Fwork%2Fa%20b');
    expect(prompt).toContain('"selectionInProjectSeconds"');
    expect(prompt).toContain('CLIP-LOCAL seconds');
    expect(prompt).toContain('SOURCE-ASSET seconds');
    expect(prompt).toContain('"locked": true');
    expect(prompt).toContain('Do not unlock or alter locked clips');
    expect(prompt).toContain('"baseVersion":<latest version>');
    expect(prompt).toContain('On HTTP 409');
    expect(prompt).toContain('Never print or embed credential values');
    expect(prompt).not.toContain('http://127.0.0.1:');
  });
});
