import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, BubbleData, CodexEffectiveConfig, SubAgent, UserDefaults } from '@vibisual/shared';
import { IDEStatusBar } from './IDEStatusBar.js';

const fixture = vi.hoisted(() => ({
  state: null as ReturnType<typeof makeState> | null,
  codexConfig: null as CodexEffectiveConfig | 'failed' | null,
  readConfig: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key === 'ide.statusBar.modelUnknown' ? '모름' : key }),
}));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (state: ReturnType<typeof makeState>) => unknown) => select(fixture.state!),
}));
vi.mock('../Panel/ContextInsurancePopup.js', () => ({ ContextInsurancePopup: () => null }));
vi.mock('../Panel/AgentConfigPopup.js', () => ({ AgentConfigPopup: () => null }));
vi.mock('../Codex/useCodexEffectiveConfig.js', () => ({
  useCodexEffectiveConfig: (enabled: boolean, agentId?: string) => {
    fixture.readConfig(enabled, agentId);
    return fixture.codexConfig;
  },
}));

const agent: BubbleData = {
  id: 'codex-agent', label: 'Codex agent', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0,
};
const session: SubAgent = {
  id: 'new-session', sessionId: 'new-thread', label: 'New session', parentAgentId: agent.id,
  status: 'idle', createdAt: 1, lastActivityAt: 1,
};

function makeState() {
  // The main engine is Claude: Codex must read its own global preferences.
  const userDefaults: UserDefaults = {
    updatedAt: 1,
    engineChoice: { kind: 'claude', chosenAt: 1 },
    agentConfig: { effort: 'max' },
    engineConfigs: { codex: { provider: { kind: 'codex-cli', modelId: 'chosen-model', reasoningEffort: 'high' } } },
  };
  return {
    userDefaults,
    agentConfigs: {
      [agent.id]: { provider: { kind: 'codex-cli', modelId: 'chosen-model', modelName: 'Chosen model' } },
    } as Record<string, Partial<AgentConfig>>,
    agentProjects: { [agent.id]: 'Agent project' } as Record<string, string>,
    projects: { 'Agent project': { path: '/project' }, 'Other project': { path: '/other' } },
    activeProject: 'Other project',
    codexModels: { models: [
      { slug: 'other-model', displayName: 'Other model', reasoningLevels: ['high'], defaultReasoningLevel: 'high' },
      { slug: 'chosen-model', displayName: 'Chosen model', reasoningLevels: ['low', 'medium', 'high', 'xhigh'], defaultReasoningLevel: 'medium' },
    ] },
    modelRegistry: undefined,
    acknowledgedSubAgents: {}, sessionFocusGlow: {}, contextInsurance: [], diffComments: {},
    // 상태바는 §2.4 생존 판정 재료를 탭바·분할 칸과 **같은 인자**로 집는다(백그라운드 작업 포함).
    //   `useSessionLivenessFacts` 가 `subAgents`·`subAgentStreams`·`queuedCommands` 를 모두 읽으므로
    //   셋을 다 세워 둔다 — 하나라도 비면 훅이 store 를 뒤지다 터져서, 정작 재려던 effort 는
    //   한 번도 판정되지 않은 채 다섯 건이 같은 TypeError 로 떨어진다(픽스처가 낡은 것이지 코드가
    //   깨진 것이 아니라서 증상만 보면 오진하기 쉽다). 보고 있는 세션도 목록에 실어 둔다 —
    //   `pickSources` 는 그 sub 를 못 찾으면 "판단 근거 없음" 으로 물러난다(§2.4).
    subAgents: { [agent.id]: [session] } as Record<string, SubAgent[]>,
    subAgentStreams: {} as Record<string, unknown[]>,
    queuedCommands: {} as Record<string, unknown[]>,
    runningSubagentTasks: {} as Record<string, unknown>,
    insurancePopupOpen: false,
    setInsurancePopupOpen: vi.fn(), addCommand: vi.fn(), clearDiffComments: vi.fn(),
  };
}

function renderBar(activeSession: SubAgent = session): string {
  return renderToStaticMarkup(createElement(IDEStatusBar, { agent, activeSession, isCustom: true, sessionCount: 1 }));
}

function expectEffort(level: string, activeSession?: SubAgent): void {
  const html = renderBar(activeSession);
  expect(html).toContain(`>· ${level}<`);
  expect(html).not.toContain('· 모름');
}

beforeEach(() => {
  fixture.state = makeState();
  fixture.codexConfig = null;
  fixture.readConfig.mockClear();
});

describe('IDEStatusBar Codex inherited effort', () => {
  it('shows the global Codex effort in a new session and follows later global changes', () => {
    expectEffort('high');
    fixture.state!.userDefaults.engineConfigs!.codex!.provider!.reasoningEffort = 'xhigh';
    expectEffort('xhigh');
  });

  it('uses the agent project over global defaults even while another project is selected', () => {
    fixture.state!.userDefaults.projectEngineConfigs = {
      '/project': { codex: { provider: { kind: 'codex-cli', modelId: '', reasoningEffort: 'xhigh' } } },
      '/other': { codex: { provider: { kind: 'codex-cli', modelId: '', reasoningEffort: 'low' } } },
    };
    expectEffort('xhigh');
  });

  it('keeps the individual effort when global and project settings change', () => {
    fixture.state!.agentConfigs[agent.id]!.provider!.reasoningEffort = 'low';
    expectEffort('low');
    fixture.state!.userDefaults.engineConfigs!.codex!.provider!.reasoningEffort = 'xhigh';
    fixture.state!.userDefaults.projectEngineConfigs = {
      '/project': { codex: { provider: { kind: 'codex-cli', modelId: '', reasoningEffort: 'medium' } } },
    };
    expectEffort('low');
  });

  it('shows the agent Codex config value instead of unknown or an older session value', () => {
    delete fixture.state!.userDefaults.engineConfigs!.codex!.provider!.reasoningEffort;
    fixture.codexConfig = {
      cwd: '/project', checkedAt: 1,
      layers: [{ source: 'project', path: '/project/.codex/config.toml', values: { reasoningEffort: 'xhigh' } }],
    };
    expectEffort('xhigh', { ...session, modelName: 'chosen-model', reasoningEffort: 'low' });
    expect(fixture.readConfig).toHaveBeenCalledWith(true, agent.id);
  });

  it('uses the selected model default after confirming there is no file override', () => {
    delete fixture.state!.userDefaults.engineConfigs!.codex!.provider!.reasoningEffort;
    fixture.codexConfig = { cwd: '/project', checkedAt: 1, layers: [] };
    expectEffort('medium');
  });
});
