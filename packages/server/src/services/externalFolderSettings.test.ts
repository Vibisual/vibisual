import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS, EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT, EXTERNAL_TOP_BUDGET_DEFAULT } from '@vibisual/shared';

const originalHome = process.env['VIBISUAL_HOME'];
let home: string;

function stateFile(): string {
  return path.join(home, '.vibisual', 'app-state.json');
}

function writeState(state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify({ openProjects: [], ...state }), 'utf8');
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-external-settings-')));
  process.env['VIBISUAL_HOME'] = home;
  // 실제 홈이나 옛 저장분 마이그레이션을 건드리지 않는다.
  writeState({});
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env['VIBISUAL_HOME'];
  else process.env['VIBISUAL_HOME'] = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('외부 폴더 통합 깊이 설정', () => {
  it('깊이가 없는 구버전 저장분은 기본 단계를 쓰고 기존 예산을 보존한다', async () => {
    writeState({ externalTopBudget: 7 });
    const state = await import('./appState.js');
    expect(state.appStateGetExternalFolderMergeDepth()).toBe(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
    expect(state.appStateGetExternalTopBudget()).toBe(7);
  });

  it('예산·깊이를 함께 저장하고 다른 설정 저장과 재시작 뒤에도 유지한다', async () => {
    const state = await import('./appState.js');
    expect(state.appStateSetExternalFolderSettings({ budget: 8, mergeDepth: 5 })).toEqual({ budget: 8, mergeDepth: 5 });
    state.appStateSetWebGroup({ maxPerAgent: 4 });
    const disk = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
    expect(disk['externalTopBudget']).toBe(8);
    expect(disk['externalFolderMergeDepth']).toBe(5);

    vi.resetModules();
    const restarted = await import('./appState.js');
    expect(restarted.appStateGetExternalTopBudget()).toBe(8);
    expect(restarted.appStateGetExternalFolderMergeDepth()).toBe(5);
    expect(restarted.appStateGetWebGroup().maxPerAgent).toBe(4);
  });

  it('부분 저장은 다른 값을 보존하고 깊이 0은 끄기로 유지한다', async () => {
    const state = await import('./appState.js');
    expect(state.appStateSetExternalFolderSettings({ mergeDepth: 0 })).toEqual({ budget: EXTERNAL_TOP_BUDGET_DEFAULT, mergeDepth: 0 });
    expect(state.appStateSetExternalFolderSettings({ budget: 6 })).toEqual({ budget: 6, mergeDepth: 0 });
    expect(state.appStateSetExternalFolderSettings({ mergeDepth: 4 })).toEqual({ budget: 6, mergeDepth: 4 });
    expect(state.appStateSetExternalFolderSettings({})).toEqual({ budget: 6, mergeDepth: 4 });
    expect(state.appStateSetExternalFolderSettings(null)).toEqual({ budget: 6, mergeDepth: 4 });
  });

  it('개별 setter도 다른 값을 지키고 범위를 정규화한다', async () => {
    const state = await import('./appState.js');
    state.appStateSetExternalFolderMergeDepth(6);
    state.appStateSetExternalTopBudget(7);
    expect(state.appStateGetExternalFolderMergeDepth()).toBe(6);
    expect(state.appStateSetExternalFolderMergeDepth(999)).toBe(EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS.MAX);
    expect(state.appStateGetExternalTopBudget()).toBe(7);
  });

  it('전체 상태 저장은 읽기 메모도 무효화한다', async () => {
    const state = await import('./appState.js');
    expect(state.appStateGetExternalFolderMergeDepth()).toBe(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
    state.saveAppState({ ...state.loadAppState(), externalFolderMergeDepth: 5 });
    expect(state.appStateGetExternalFolderMergeDepth()).toBe(5);
  });

  it('저장이 실패하면 두 값 모두 이전 상태를 유지하고 호출부에 실패를 알린다', async () => {
    const state = await import('./appState.js');
    state.appStateSetExternalFolderSettings({ budget: 8, mergeDepth: 4 });
    const persistence = await import('./statePersistence.js');
    vi.spyOn(persistence, 'atomicWriteFileSync').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => state.appStateSetExternalFolderSettings({ budget: 2, mergeDepth: 0 })).toThrow('disk full');
    expect(state.appStateGetExternalTopBudget()).toBe(8);
    expect(state.appStateGetExternalFolderMergeDepth()).toBe(4);
    const disk = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
    expect(disk['externalTopBudget']).toBe(8);
    expect(disk['externalFolderMergeDepth']).toBe(4);
  });

  it('매니저의 깊이 변경은 열린 프로젝트와 이후 생성한 프로젝트의 실제 묶음에 함께 적용된다', async () => {
    const { ProjectGraphManager } = await import('./projectGraphManager.js');
    const manager = new ProjectGraphManager();
    // 실제 프로젝트 저장소 등록을 피하고 생성·전파 경로만 사용한다(상태 저장은 위 임시 홈으로 격리).
    const internal = manager as unknown as {
      createInstance(cwd: string): import('./projectGraph.js').ProjectGraph;
      instances: Map<string, import('./projectGraph.js').ProjectGraph>;
    };
    function addProject(name: string) {
      const cwd = path.join(home, name);
      fs.mkdirSync(cwd);
      const graph = internal.createInstance(cwd);
      graph.registerProject(cwd);
      internal.instances.set(cwd, graph);
      for (const folder of ['alpha', 'beta']) {
        const externalFile = path.join(home, 'external', folder, 'file.txt');
        fs.mkdirSync(path.dirname(externalFile), { recursive: true });
        fs.writeFileSync(externalFile, 'x', 'utf8');
        graph.processHookEvent({
          session_id: name,
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_use_id: `${name}-${folder}`,
          tool_input: { file_path: externalFile, old_string: 'x', new_string: 'y' },
          cwd,
        });
      }
      return graph;
    }
    const topExternals = (graph: import('./projectGraph.js').ProjectGraph) =>
      graph.getSnapshot().topFolders.filter((node) => node.bubbleType === 'external_folder');

    manager.setExternalFolderMergeDepth(20);
    const first = addProject('project-one');
    expect(topExternals(first)).toHaveLength(2);
    manager.setExternalFolderMergeDepth(1);
    expect(topExternals(first)).toHaveLength(1);

    const second = addProject('project-two');
    expect(topExternals(second)).toHaveLength(1);
    manager.setExternalFolderMergeDepth(20);
    expect(topExternals(first)).toHaveLength(2);
    expect(topExternals(second)).toHaveLength(2);
  });
});
