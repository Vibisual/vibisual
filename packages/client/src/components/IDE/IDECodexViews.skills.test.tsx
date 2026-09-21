import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, CodexInventory } from '@vibisual/shared';
import { IDECodexSkillsView } from './IDECodexViews.js';

const fixture = vi.hoisted(() => ({ state: null as ReturnType<typeof makeState> | null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./idePane.js', () => ({
  useIDEPaneKey: () => 'pane-a',
  useIDEPaneValue: (select: (pane: { agentId: string; activeSessionId: string }) => unknown) => select({ agentId: 'agent', activeSessionId: 'session' }),
  readIDEPane: () => ({ agentId: 'agent', activeSessionId: 'session' }),
}));
vi.mock('../../stores/graphStore.js', () => ({
  agentSessionInputKey: (agent: string, session: string) => `${agent}:${session}`,
  useGraphStore: Object.assign((select: (state: ReturnType<typeof makeState>) => unknown) => select(fixture.state!), { getState: () => fixture.state! }),
}));
vi.mock('../../hooks/useAvailableSkills.js', () => ({ useAvailableSkills: () => ({ favorites: [] }), persistSkillFavorites: vi.fn() }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
function makeState() {
  return {
    codexInventory: { mcpServers: [], skills: [], plugins: [], hooks: [], agentsDocs: [], checkedAt: 1 } as CodexInventory | null,
    refreshCodexInventory: vi.fn(),
    agentConfigs: { agent: { provider: { kind: 'codex-cli', modelId: 'model' } } } as Record<string, Partial<AgentConfig>>,
    agentSessionInputs: { 'agent:session': { text: 'Existing draft' } } as Record<string, { text: string }>,
    setAgentSessionInputText: vi.fn(),
  };
}
let view: ReactTestRenderer | undefined;
beforeEach(() => {
  fixture.state = makeState();
  vi.stubGlobal('window', {});
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
    ? { ok: true, result: { status: 'shared', name: 'review', path: '/project/.agents/skills/review' } }
    : { ok: true, provider: 'codex', skills: [{ id: 'source', name: 'review', description: '', sourceProvider: 'claude', scope: 'project', sourcePath: '/project/.claude/skills/review', status: 'available', issues: [] }] }))));
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});
async function shareFromPane(): Promise<void> {
  await act(async () => { view = create(createElement(IDECodexSkillsView)); });
  const button = view!.root.findAllByType('button').find((node) => node.children.includes('ide.skillSharing.shareAndUse'))!;
  expect(button).toBeDefined();
  await act(async () => button.props.onClick());
}

describe('Codex sharing pane integration', () => {
  it('shows sharing when no native skill is installed and preserves the selected session draft', async () => {
    await shareFromPane();
    expect(fixture.state!.setAgentSessionInputText).toHaveBeenCalledExactlyOnceWith('agent', 'session', '$review \nExisting draft');
    expect(fixture.state!.refreshCodexInventory).toHaveBeenCalledExactlyOnceWith('agent');
  });

  it('shows sharing before the native inventory has loaded', async () => {
    fixture.state!.codexInventory = null;
    await shareFromPane();
    expect(fixture.state!.setAgentSessionInputText).toHaveBeenCalledExactlyOnceWith('agent', 'session', '$review \nExisting draft');
  });

  it('types the Codex invocation into the selected terminal without submitting it', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { api: { terminal: { write } } });
    fixture.state!.agentConfigs.agent!.executionMode = 'interactive-terminal';
    await shareFromPane();
    expect(write).toHaveBeenCalledExactlyOnceWith('term:agent:session', '$review ');
    expect(fixture.state!.setAgentSessionInputText).not.toHaveBeenCalled();
  });
});
