import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSTELLATION, type AppBubble, type BubbleData } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { EMPTY_APP_WORK_PLAN, type AppWorkPlan } from '../../utils/appWorkView.js';
import { useCardTaskStore } from './agentCardTaskState.js';
import { useAppWorkPlan } from './useAppWorkPlan.js';

type TestGraphState = Pick<ReturnType<typeof useGraphStore.getState>,
  'queuedCommands' | 'completedCommands' | 'projects' | 'agentProjects' | 'activeProject'>;
type Input = Parameters<typeof useAppWorkPlan>[0];

vi.mock('../../stores/graphStore.js', async () => {
  const { create: createStore } = await import('zustand');
  return { useGraphStore: createStore<TestGraphState>(() => ({
    queuedCommands: {}, completedCommands: {}, projects: {}, agentProjects: {}, activeProject: null,
  })) };
});
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => ({ id: 'model-editor', name: 'Model Editor', glow: '#B9A8E0' }),
  appOutputExtensions: () => ['.glb'],
}));

const AGENT = 'agent-visible';
const APP = 'app-model-fixture';
const app: AppBubble = {
  id: APP, appId: 'model-editor', projectName: 'fixture', linkedAgentIds: [AGENT],
  x: 0, y: 0, width: 300, height: 200, createdAt: 1,
};

function bubble(id: string, bubbleType: BubbleData['bubbleType']): BubbleData {
  return { id, label: id, bubbleType, path: id, status: 'idle', activity: 1 };
}

function workFile(id: string): BubbleData {
  return {
    ...bubble(id, 'file'), path: `${id}.mjs`, absolutePath: `/projects/fixture/${id}.mjs`,
    appWork: { [APP]: { w: 1, at: 1 } },
  };
}

function input(overrides: Partial<Input> = {}): Input {
  return {
    enabled: true, agents: [bubble(AGENT, 'agent')], folders: [], satellites: {}, appBubbles: [app],
    ...overrides,
  };
}

const renderers: ReactTestRenderer[] = [];

function mount(initial: Input): { readonly plan: AppWorkPlan; update: (next: Input) => void } {
  let plan = EMPTY_APP_WORK_PLAN;
  function Probe({ value }: { value: Input }): null {
    plan = useAppWorkPlan(value);
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(createElement(Probe, { value: initial })); });
  renderers.push(renderer!);
  return {
    get plan(): AppWorkPlan { return plan; },
    update(next: Input): void { act(() => renderer.update(createElement(Probe, { value: next }))); },
  };
}

beforeEach(() => {
  useGraphStore.setState({
    queuedCommands: {},
    completedCommands: {
      [AGENT]: [{
        id: 'command-fixture', text: 'Build the model', timestamp: 1,
        subAgentId: null, status: 'completed', appNodeIds: [APP],
      }],
    },
    projects: {}, agentProjects: {}, activeProject: null,
  });
  useCardTaskStore.setState({ entries: {} });
});

afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
});

describe('useAppWorkPlan — files in the current canvas', () => {
  it('does not count tagged satellites whose parents are outside the current view', () => {
    // More than one orbit can hold: stale entries must create neither work nor overflow.
    const hidden = Array.from({ length: CONSTELLATION.moonMax + 2 }, (_, i) => workFile(`hidden-${i}-work`));
    const { plan } = mount(input({ satellites: {
      'folder-outside-view': hidden,
      'agent-outside-view': [workFile('other-agent-work')],
    } }));

    expect(plan.focusByAgent.get(AGENT)).toEqual([APP]);
    expect(plan.hubs.get(APP)?.work).toEqual([]);
    expect(plan.hubs.get(APP)?.overflow).toEqual([]);
    expect(plan.keepIds.size).toBe(0);
    expect(plan.hiddenWorkIds.size).toBe(0);
  });

  it('includes radial files and satellites of both visible folders and visible agents', () => {
    const folder = bubble('folder-visible', 'internal_folder');
    const radial = workFile('radial-work');
    const folderWork = workFile('folder-work');
    const agentWork = workFile('agent-work');
    const { plan } = mount(input({
      folders: [folder, radial],
      satellites: {
        [folder.id]: [folderWork],
        [AGENT]: [agentWork],
        'folder-outside-view': [workFile('hidden-work')],
      },
    }));

    expect(new Set(plan.hubs.get(APP)?.work.map((file) => file.fileId)))
      .toEqual(new Set([radial.id, folderWork.id, agentWork.id]));
    expect(plan.keepIds).toEqual(new Set(
      [radial, folderWork, agentWork].flatMap((file) => [file.id, `sat-${file.id}`]),
    ));
    expect(plan.hubs.get(APP)?.overflow).toEqual([]);
    expect(plan.hiddenWorkIds.size).toBe(0);
  });

  it('counts a shared file only once when two visible parents contain it', () => {
    const folder = bubble('folder-visible', 'internal_folder');
    const shared = workFile('shared-work');
    const { plan } = mount(input({
      folders: [folder],
      satellites: { [folder.id]: [shared], [AGENT]: [{ ...shared }] },
    }));

    expect(plan.hubs.get(APP)?.work.map((file) => file.fileId)).toEqual([shared.id]);
    expect(plan.hubs.get(APP)?.overflow).toEqual([]);
    expect(plan.keepIds).toEqual(new Set([shared.id, `sat-${shared.id}`]));
  });

  it('removes a former parent’s work after the parent leaves the view', () => {
    const folder = bubble('folder-visible', 'internal_folder');
    const work = workFile('folder-work');
    const satellites = { [folder.id]: [work] };
    const view = mount(input({ folders: [folder], satellites }));
    expect(view.plan.hubs.get(APP)?.work.map((file) => file.fileId)).toEqual([work.id]);

    // Stored satellites remain in the snapshot even after their parent stops being rendered.
    view.update(input({ satellites }));
    expect(view.plan.hubs.get(APP)?.work).toEqual([]);
    expect(view.plan.hubs.get(APP)?.overflow).toEqual([]);
    expect(view.plan.keepIds.size).toBe(0);
    expect(view.plan.hiddenWorkIds.size).toBe(0);
  });
});
