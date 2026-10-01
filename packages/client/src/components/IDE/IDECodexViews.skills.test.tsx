import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, CodexInventory } from '@vibisual/shared';
import { IDECodexSkillsView } from './IDECodexViews.js';

const fixture = vi.hoisted(() => ({
  state: null as ReturnType<typeof makeState> | null,
  agentId: 'agent',
  // 창 슬롯의 고른 탭(`skillTabs`) — 칸이 내려가도 남는 자리라 칸 밖에 둔다.
  skillTabs: {} as Record<string, string>,
  paneListeners: new Set<() => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// 실제 pane 처럼 구독한다 — 칸이 props 없는 memo 라 에이전트가 바뀌면 구독이 다시 그리게 한다.
vi.mock('./idePane.js', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void): (() => void) => {
    fixture.paneListeners.add(listener);
    return () => { fixture.paneListeners.delete(listener); };
  };
  return {
    useIDEPaneKey: () => 'pane-a',
    useIDEPaneValue: (select: (pane: { agentId: string; activeSessionId: string; skillTabs: Record<string, string> }) => unknown) =>
      select({
        agentId: useSyncExternalStore(subscribe, () => fixture.agentId),
        activeSessionId: 'session',
        skillTabs: useSyncExternalStore(subscribe, () => fixture.skillTabs),
      }),
    readIDEPane: () => ({ agentId: fixture.agentId, activeSessionId: 'session' }),
  };
});
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
    setIDESkillTab: vi.fn((key: string, tab: string | null) => {
      const next = { ...fixture.skillTabs };
      if (tab === null) delete next[key];
      else next[key] = tab;
      fixture.skillTabs = next;
      fixture.paneListeners.forEach((listener) => listener());
    }),
  };
}
let view: ReactTestRenderer | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fixture.state = makeState();
  fixture.agentId = 'agent';
  fixture.skillTabs = {};
  vi.stubGlobal('window', {});
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
    ? { ok: true, result: { status: 'shared', name: 'review', path: '/project/.agents/skills/review' } }
    : { ok: true, provider: 'codex', skills: [{ id: 'source', name: 'review', description: '', sourceProvider: 'claude', scope: 'project', sourcePath: '/project/.claude/skills/review', status: 'available', issues: [] }] })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => { view = create(createElement(IDECodexSkillsView)); });
}
function tabs(): ReactTestInstance[] {
  return view!.root.findAll((node) => node.type === 'button' && node.props.role === 'tab');
}
function tab(provider: string): ReactTestInstance {
  return tabs().find((node) => node.props['data-skill-tab'] === provider)!;
}
function shareButton(): ReactTestInstance | undefined {
  return view!.root.findAllByType('button').find((node) => node.children.includes('ide.skillSharing.shareAndUse'));
}
async function openSharingTab(): Promise<void> {
  await act(async () => tab('claude').props.onClick());
}
async function shareFromPane(): Promise<void> {
  await render();
  await openSharingTab();
  const button = shareButton()!;
  expect(button).toBeDefined();
  await act(async () => button.props.onClick());
}

describe('Codex skills pane — own engine first, other engine behind a tab', () => {
  it('opens on the agent’s own Codex tab first and keeps the Claude list behind the second tab', async () => {
    await render();
    expect(tabs().map((node) => node.props['data-skill-tab'])).toEqual(['codex', 'claude']);
    expect(tabs().map((node) => node.props['aria-selected'])).toEqual([true, false]);
    expect(shareButton()).toBeUndefined();
    // 공유 목록은 뒤 탭에 있어도 개수는 탭에 적힌다.
    expect(tab('claude').findAll((node) => node.type === 'span').map((node) => node.children.join(''))).toEqual(['Claude', '1']);

    await openSharingTab();
    expect(tabs().map((node) => node.props['aria-selected'])).toEqual([false, true]);
    expect(shareButton()).toBeDefined();
  });

  it('returns to the own tab when another agent is selected', async () => {
    await render();
    await openSharingTab();
    fixture.agentId = 'agent-2';
    await act(async () => { fixture.paneListeners.forEach((listener) => listener()); });
    expect(tab('codex').props['aria-selected']).toBe(true);
    expect(shareButton()).toBeUndefined();
  });

  // 좁은 창은 세션을 바꾸면 서랍을 닫고 사이드바를 내린다 — 칸이 다시 서도 같은 에이전트의 탭은 남는다(②).
  it('keeps the picked tab when the pane is taken down and put back for the same agent', async () => {
    await render();
    await openSharingTab();
    await act(async () => view?.unmount());
    await render();
    expect(tabs().map((node) => node.props['aria-selected'])).toEqual([false, true]);
    expect(shareButton()).toBeDefined();
  });

  it('keeps this agent’s pick after visiting another agent, whether or not a tab was picked there', async () => {
    await render();
    await openSharingTab();
    const switchTo = async (agentId: string): Promise<void> => {
      fixture.agentId = agentId;
      await act(async () => { fixture.paneListeners.forEach((listener) => listener()); });
    };
    await switchTo('agent-2');
    await switchTo('agent');
    expect(tab('claude').props['aria-selected']).toBe(true);
    // 다른 에이전트에서도 탭을 골랐다 와도 결과가 같다(종전에는 여기서 사라졌다).
    await switchTo('agent-2');
    await openSharingTab();
    await switchTo('agent');
    expect(tab('claude').props['aria-selected']).toBe(true);
    // 자기 탭으로 되돌리면 기억을 지운다.
    await act(async () => tab('codex').props.onClick());
    expect(fixture.skillTabs).toEqual({ 'agent-2': 'claude' });
  });

  // 서버는 스킬을 못 읽으면 빈 목록 + 사유를 보낸다 — 그대로 적으면 "Codex 0"·"아직 스킬이 없습니다"가 된다(③).
  it('leaves the Codex count blank and shows the reason when the skill list could not be read', async () => {
    fixture.state!.codexInventory = {
      mcpServers: [], skills: [], plugins: [], hooks: [], agentsDocs: [], checkedAt: 1, errors: { skills: 'exit 1' },
    } as CodexInventory;
    await render();
    expect(tab('codex').findAll((node) => node.type === 'span').map((node) => node.children.join(''))).toEqual(['Codex']);
    const body = JSON.stringify(view!.toJSON());
    expect(body).toContain('ide.codex.readFailed');
    expect(body).not.toContain('ide.codex.skills.empty');
  });

  it('reloads the list on the visible tab only — one reload control for both lists', async () => {
    await render();
    await openSharingTab();
    const reads = fetchMock.mock.calls.length;
    const reload = view!.root.findAllByType('button').find((node) => node.children.includes('ide.codex.reload'))!;
    await act(async () => reload.props.onClick());
    expect(fetchMock.mock.calls.length).toBe(reads + 1);
    expect(fixture.state!.refreshCodexInventory).not.toHaveBeenCalled();
    expect(view!.root.findAll((node) => node.props.title === 'ide.skillSharing.refresh')).toHaveLength(0);
  });

  it('applies the search box to the tab being viewed', async () => {
    await render();
    await openSharingTab();
    const search = view!.root.findByType('input');
    await act(async () => search.props.onChange({ target: { value: 'zzz' } }));
    expect(shareButton()).toBeUndefined();
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.noMatch');
  });
});

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
