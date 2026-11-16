import { describe, expect, it } from 'vitest';
import type { ActivityEdge, BubbleData } from '@vibisual/shared';
import { normalizeDedicatedHidden } from '@vibisual/shared';
import {
  classifyDedicatedItem,
  GENERAL_DEDICATED_PROFILE,
  IMAGE_DEDICATED_PROFILE,
  MODEL_DEDICATED_PROFILE,
  SOUND_DEDICATED_PROFILE,
  VIDEO_DEDICATED_PROFILE,
} from '../apps/dedicatedProfiles.js';
import { bundleInfoOf, bundleInteriorIds } from './constellationView.js';
import { isDedicatedHubNodeId } from './dedicatedBubbleInfo.js';
import { dedicatedHubPanels, dedicatedHubSourcesOf, dedicatedSatInfos, planDedicatedHubs, type DedicatedHubSource, type DedicatedPlanInput } from './dedicatedBubbleView.js';

function bubble(id: string, over: Partial<BubbleData> = {}): BubbleData {
  return { id, label: id, bubbleType: 'file', path: id, status: 'idle', activity: 1, ...over } as BubbleData;
}
const card = (id: string, over: Partial<BubbleData> = {}): BubbleData =>
  bubble(id, { bubbleType: 'agent', customCreated: true, agentForm: 'card', ...over });
const edge = (agent: string, target: string): ActivityEdge =>
  ({ id: `${agent}->${target}`, source: agent, target, label: '', timestamp: 0, isActive: false });

const GENERAL: readonly DedicatedHubSource[] = [{ appId: null, profile: GENERAL_DEDICATED_PROFILE, color: null, glow: null }];
const VIDEO: readonly DedicatedHubSource[] = [{ appId: 'vibistudio', profile: VIDEO_DEDICATED_PROFILE, color: '#111111', glow: '#222222' }];

function input(over: Partial<DedicatedPlanInput>): DedicatedPlanInput {
  return { agents: [], folders: [], edges: [], satellites: {}, hubSourcesOf: () => GENERAL, label: (key) => key, ...over };
}

describe('classifyDedicatedItem', () => {
  const file = (path: string) => ({ kind: 'file', path }) as const;

  it('routes video work by what the file is for', () => {
    const p = VIDEO_DEDICATED_PROFILE;
    expect(classifyDedicatedItem(p, file('a/final-sheet.jpg'))).toBe('image');
    expect(classifyDedicatedItem(p, file('a/demo.mp4'))).toBe('video');
    expect(classifyDedicatedItem(p, file('a/subtitles.srt'))).toBe('script');
    expect(classifyDedicatedItem(p, file('docs/대본_1화.md'))).toBe('script');
    expect(classifyDedicatedItem(p, file('audio/narration_01.mp3'))).toBe('narration');
    expect(classifyDedicatedItem(p, file('audio/bgm.mp3'))).toBe('music');
    expect(classifyDedicatedItem(p, file('fx/fire_fx.mp4'))).toBe('effect');
    expect(classifyDedicatedItem(p, file('grade/teal.cube'))).toBe('effect');
    expect(classifyDedicatedItem(p, { kind: 'command', name: 'FFmpeg' })).toBe('tool');
  });

  it('leaves unrelated work out of an app bubble', () => {
    const p = VIDEO_DEDICATED_PROFILE;
    expect(classifyDedicatedItem(p, file('docs/readme.md'))).toBeNull();
    expect(classifyDedicatedItem(p, file('build.py'))).toBeNull();
    expect(classifyDedicatedItem(p, { kind: 'command', name: 'Python' })).toBeNull();
    expect(classifyDedicatedItem(p, { kind: 'domain' })).toBeNull();
  });

  it('does not read a hint out of the middle of a word', () => {
    expect(classifyDedicatedItem(VIDEO_DEDICATED_PROFILE, file('audio/volume_up.mp3'))).toBe('music');
    expect(classifyDedicatedItem(VIDEO_DEDICATED_PROFILE, file('images/solution.png'))).toBe('image');
    expect(classifyDedicatedItem(VIDEO_DEDICATED_PROFILE, file('audio/narrationTrack.wav'))).toBe('narration');
  });

  it('accepts Windows separators in a path hint', () => {
    expect(classifyDedicatedItem(VIDEO_DEDICATED_PROFILE, file('C:\\work\\scripts\\ep1.md'))).toBe('script');
  });

  it('declares the other apps', () => {
    expect(classifyDedicatedItem(SOUND_DEDICATED_PROFILE, file('a/whoosh.wav'))).toBe('sfx');
    expect(classifyDedicatedItem(SOUND_DEDICATED_PROFILE, file('a/voice.wav'))).toBe('voice');
    expect(classifyDedicatedItem(MODEL_DEDICATED_PROFILE, file('a/ship.glb'))).toBe('model');
    expect(classifyDedicatedItem(MODEL_DEDICATED_PROFILE, file('a/ship_albedo.png'))).toBe('texture');
    expect(classifyDedicatedItem(MODEL_DEDICATED_PROFILE, file('a/ship.mtl'))).toBe('material');
    expect(classifyDedicatedItem(IMAGE_DEDICATED_PROFILE, file('a/logo.svg'))).toBe('vector');
    expect(classifyDedicatedItem(IMAGE_DEDICATED_PROFILE, file('a/photo.jpg'))).toBe('image');
    expect(classifyDedicatedItem(IMAGE_DEDICATED_PROFILE, file('a/poster.psd'))).toBe('design');
  });

  it('keeps everything when no app is linked', () => {
    const p = GENERAL_DEDICATED_PROFILE;
    expect(classifyDedicatedItem(p, file('a/readme.md'))).toBe('doc');
    expect(classifyDedicatedItem(p, file('a/thing.unknownext'))).toBe('other');
    expect(classifyDedicatedItem(p, { kind: 'command', name: 'Python' })).toBe('tool');
    expect(classifyDedicatedItem(p, { kind: 'domain' })).toBe('web');
  });
});

describe('dedicatedHubSourcesOf', () => {
  const apps = { a: { dedicated: VIDEO_DEDICATED_PROFILE, color: '#1', glow: '#2' }, b: { color: '#3', glow: '#4' } } as const;
  const appOf = (id: string) => apps[id as keyof typeof apps];
  const link = (appId: string, ids: string[], projectName = 'p') => ({ appId, linkedAgentIds: ids, projectName });

  it('gives one hub per linked app and one per app kind', () => {
    const out = dedicatedHubSourcesOf('x', [link('a', ['x']), link('a', ['x'])], 'p', appOf);
    expect(out.map((s) => s.appId)).toEqual(['a']);
  });

  it('falls back to the general hub', () => {
    expect(dedicatedHubSourcesOf('x', [], 'p', appOf)[0]?.profile.id).toBe('general');
    expect(dedicatedHubSourcesOf('x', [link('b', ['x'])], 'p', appOf)[0]?.profile.id).toBe('general');
  });

  it('ignores apps of other projects', () => {
    expect(dedicatedHubSourcesOf('x', [link('a', ['x'], 'other')], 'p', appOf)[0]?.profile.id).toBe('general');
  });
});

describe('planDedicatedHubs', () => {
  it('leaves the canvas untouched without a speech-bubble agent', () => {
    const agents = [bubble('a', { bubbleType: 'agent' })];
    const folders = [bubble('f1')];
    const edges = [edge('a', 'f1')];
    const plan = planDedicatedHubs(input({ agents, folders, edges }));
    expect(plan.folders).toBe(folders);
    expect(plan.edges).toBe(edges);
    expect(plan.hubs).toEqual([]);
  });

  it('folds activity bubbles under one hub and dissolves folders into their files', () => {
    const agents = [card('a')];
    const folders = [bubble('docs', { bubbleType: 'internal_folder' }), bubble('root.md')];
    const edges = [edge('a', 'docs'), edge('a', 'root.md')];
    const satellites = { docs: [bubble('docs/a.png'), bubble('docs/b.md')] };
    const plan = planDedicatedHubs(input({ agents, folders, edges, satellites }));
    expect(plan.folders).toEqual([]);
    expect(plan.edges).toEqual([]);
    expect(plan.hubs).toHaveLength(1);
    const counts = Object.fromEntries(plan.hubs[0]!.categories.map((c) => [c.id, c.members.length]));
    expect(counts['image']).toBe(1);
    expect(counts['doc']).toBe(2);
  });

  it('restores everything when the agent is back in bubble form', () => {
    const folders = [bubble('docs', { bubbleType: 'internal_folder' })];
    const edges = [edge('a', 'docs')];
    const plan = planDedicatedHubs(input({ agents: [bubble('a', { bubbleType: 'agent', customCreated: true })], folders, edges }));
    expect(plan.folders).toBe(folders);
    expect(plan.edges).toBe(edges);
  });

  it('attaches only related items to an app hub', () => {
    const plan = planDedicatedHubs(input({
      agents: [card('a')],
      folders: [bubble('a.jpg'), bubble('build.py'), bubble('b.mp4')],
      edges: [edge('a', 'a.jpg'), edge('a', 'build.py'), edge('a', 'b.mp4')],
      hubSourcesOf: () => VIDEO,
    }));
    expect(plan.folders).toEqual([]);
    const shown = plan.hubs[0]!.categories.flatMap((c) => c.members.map((m) => m.id));
    expect(shown.sort()).toEqual(['a.jpg', 'b.mp4']);
  });

  it('keeps a linked app hub standing when empty, but no general hub', () => {
    const empty = { agents: [card('a')], folders: [], edges: [] };
    expect(planDedicatedHubs(input({ ...empty, hubSourcesOf: () => VIDEO })).hubs).toHaveLength(1);
    expect(planDedicatedHubs(input(empty)).hubs).toHaveLength(0);
  });

  it('does not fold what another form of agent still shows, pins, or a hidden-bubbles agent', () => {
    const shared = planDedicatedHubs(input({
      agents: [card('a'), bubble('b', { bubbleType: 'agent' })],
      folders: [bubble('s.png')],
      edges: [edge('a', 's.png'), edge('b', 's.png')],
    }));
    expect(shared.folders.map((f) => f.id)).toEqual(['s.png']);

    const pinned = planDedicatedHubs(input({ agents: [card('a')], folders: [bubble('p.png', { preservePinned: true })], edges: [edge('a', 'p.png')] }));
    expect(pinned.folders.map((f) => f.id)).toEqual(['p.png']);

    const folders = [bubble('h.png')];
    const hiding = planDedicatedHubs(input({ agents: [card('a', { bubblesHidden: true })], folders, edges: [edge('a', 'h.png')] }));
    expect(hiding.folders).toBe(folders);
    expect(hiding.hubs).toEqual([]);
  });

  it('gives a shared file to the most recently active speech-bubble agent', () => {
    const plan = planDedicatedHubs(input({
      agents: [card('old', { lastActivity: 1 }), card('new', { lastActivity: 9 })],
      folders: [bubble('s.png')],
      edges: [edge('old', 's.png'), edge('new', 's.png')],
    }));
    expect(plan.hubs.map((h) => h.agentId)).toEqual(['new']);
  });

  it('lets the first linked app claim a file', () => {
    const plan = planDedicatedHubs(input({
      agents: [card('a')],
      folders: [bubble('s.png')],
      edges: [edge('a', 's.png')],
      hubSourcesOf: () => [...VIDEO, { appId: 'vibimage', profile: IMAGE_DEDICATED_PROFILE, color: '#3', glow: '#4' }],
    }));
    expect(plan.hubs.map((h) => h.categories.reduce((n, c) => n + c.members.length, 0))).toEqual([1, 0]);
  });

  it('marks unchecked kinds per profile', () => {
    const plan = planDedicatedHubs(input({
      agents: [card('a', { dedicatedHidden: ['video:image', 'general:doc'] })],
      folders: [bubble('s.png')],
      edges: [edge('a', 's.png')],
      hubSourcesOf: () => VIDEO,
    }));
    const hub = plan.hubs[0]!;
    expect(hub.categories.find((c) => c.id === 'image')?.hidden).toBe(true);
    expect(hub.categories.find((c) => c.id === 'script')?.hidden).toBe(false);
  });
});

describe('dedicatedSatInfos', () => {
  const build = (over: Partial<DedicatedPlanInput>, taken: Iterable<string> = []) => {
    const plan = planDedicatedHubs(input(over));
    return { plan, infos: dedicatedSatInfos(plan, { agents: over.agents ?? [], heat: undefined, taken: new Set(taken) }) };
  };
  const agents = [card('a')];

  it('chains agent → hub → single bubble', () => {
    const { infos } = build({ agents, folders: [bubble('a.png')], edges: [edge('a', 'a.png')] });
    expect(infos.map((s) => [s.bubble.id, s.parentId])).toEqual([
      ['sat-bundle-dedicated-hub-a-general', 'a'],
      ['sat-a.png', 'sat-bundle-dedicated-hub-a-general'],
    ]);
    expect(isDedicatedHubNodeId(infos[0]!.bubble.id)).toBe(true);
    expect(isDedicatedHubNodeId(infos[1]!.bubble.id)).toBe(false);
  });

  it('promotes two of a kind to a bundle with moons', () => {
    const { infos } = build({
      agents,
      folders: [bubble('a.png', { lastActivity: 1 }), bubble('b.png', { lastActivity: 3 }), bubble('c.png', { lastActivity: 2 })],
      edges: ['a.png', 'b.png', 'c.png'].map((f) => edge('a', f)),
    });
    const hubId = 'sat-bundle-dedicated-hub-a-general';
    const bundleId = 'sat-bundle-dedicated-cat-a-general-image';
    expect(infos.map((s) => [s.bubble.id, s.parentId])).toEqual([
      [hubId, 'a'],
      [bundleId, hubId],
      ['sat-b.png', bundleId],
      ['sat-c.png', bundleId],
    ]);
    const info = bundleInfoOf(infos[1]!.bubble);
    expect(info?.source).toBe('dedicated');
    expect(info?.count).toBe(3);
  });

  it('opens a document bundle even though documents are not a preview kind', () => {
    const { infos } = build({
      agents,
      folders: [bubble('a.md'), bubble('b.md')],
      edges: [edge('a', 'a.md'), edge('a', 'b.md')],
    });
    const info = bundleInfoOf(infos[1]!.bubble)!;
    expect(bundleInteriorIds(info, {}).sort()).toEqual(['a.md', 'b.md']);
  });

  it('hides unchecked kinds but keeps the hub to re-check them', () => {
    const { infos, plan } = build({
      agents: [card('a', { dedicatedHidden: ['general:image'] })],
      folders: [bubble('a.png')],
      edges: [edge('a', 'a.png')],
    });
    expect(infos.map((s) => s.bubble.id)).toEqual(['sat-bundle-dedicated-hub-a-general']);
    expect(dedicatedHubPanels(plan)[0]?.rows.find((r) => r.id === 'image')).toMatchObject({ hidden: true, count: 1 });
  });

  it('skips a file another agent already shows on this screen', () => {
    const { infos } = build({ agents, folders: [bubble('a.png')], edges: [edge('a', 'a.png')] }, ['sat-a.png']);
    expect(infos.map((s) => s.bubble.id)).toEqual(['sat-bundle-dedicated-hub-a-general']);
  });
});

describe('normalizeDedicatedHidden', () => {
  it('keeps well-formed entries, sorted and unique', () => {
    expect(normalizeDedicatedHidden(['video:image', 'audio:x', 'video:image', 'bad', 3, 'a:b:c'])).toEqual(['audio:x', 'video:image']);
  });
});
