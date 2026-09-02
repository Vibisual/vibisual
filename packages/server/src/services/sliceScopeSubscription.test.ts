import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentReport } from '@vibisual/shared';
import { SCOPABLE_SLICE_KEYS, ALWAYS_SHIPPED_SLICES, SLICE_SCOPE_GROUPS } from '@vibisual/shared';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 **실제로 건드린다** —
//   임시 폴더가 그 목록에 쌓이면 다음 부팅에서 유령 탭이 복원된다(쓰기만 막는다).
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §9 슬라이스 스코프 — **창 선언의 합집합 규약**(스코프드 구독의 세 번째 축).
 *
 * 프로젝트 축·폴더 축과 규약이 같다. 여기서 못 박는 것은 그 규약이 **스냅샷에 실제로 걸리는가**다:
 *  · 아무도 선언 안 함 / 선언 안 한 창이 하나라도 있음 → 전량(`scopedSlices` 미탑재).
 *  · 좁혔더라도 **전역 집계·탭 표시·캔버스 골격은 그대로** 흐른다(§9 ④ — 줄면 기능 손상이다).
 *  · **내부 조회용 스냅샷은 절대 좁히지 않는다** — REST·dispatch 가 좁아지면 "없는 에이전트"가 된다.
 */

const tmpDirs: string[] = [];

function makeManager(): { manager: ProjectGraphManager; name: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-sscope-')));
  tmpDirs.push(dir);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(dir).name;
  return { manager, name };
}

const report = (agentId: string, id: string): AgentReport =>
  ({ id, agentId, did: 'did ' + id, userActions: [], createdAt: Date.now() } as unknown as AgentReport);

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('§9 슬라이스 스코프 — 선언 합집합', () => {
  it('아무도 선언하지 않으면 전량이다(침묵은 축소가 아니다)', () => {
    const { manager } = makeManager();
    expect(manager.getEffectiveSliceScope()).toBeNull();
    expect(manager.getBroadcastSnapshot().scopedSlices).toBeUndefined();
  });

  it('빈 배열 선언도 범위다 — "나는 스코프 대상 슬라이스를 안 읽는다"', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], undefined, []);

    expect([...(manager.getEffectiveSliceScope() ?? [])]).toEqual([]);
    // 되돌려 주는 값이 `[]` 라는 것이 곧 "범위를 적용했다" 는 신고다(undefined 와 다르다).
    expect(manager.getBroadcastSnapshot().scopedSlices).toEqual([]);
  });

  it('슬라이스 축을 모르는 창이 하나라도 있으면 통째로 전량으로 되돌아간다', () => {
    const { manager, name } = makeManager();
    const modern = {};
    const legacy = {};
    manager.setClientProjectScope(modern, [name], undefined, []);
    manager.setClientProjectScope(legacy, [name]);            // slices 미선언 = 구버전

    expect(manager.getEffectiveSliceScope()).toBeNull();
    expect(manager.getBroadcastSnapshot().scopedSlices).toBeUndefined();
  });

  it('그 구버전 창이 닫히면 다시 좁아진다', () => {
    const { manager, name } = makeManager();
    const modern = {};
    const legacy = {};
    manager.setClientProjectScope(modern, [name], undefined, ['ideLane']);
    manager.setClientProjectScope(legacy, [name]);
    manager.clearClientProjectScope(legacy);

    expect(manager.getEffectiveSliceScope()?.has('agentReports')).toBe(true);
  });

  it('창이 여럿이면 합집합이다 — 한 창만 IDE 를 열어도 그 묶음이 전부 실린다', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], undefined, []);
    manager.setClientProjectScope({}, [name], undefined, ['ideLane']);

    const scope = manager.getEffectiveSliceScope();
    expect(scope?.has('sessionGoals')).toBe(true);
    expect(scope?.has('verificationRuns')).toBe(true);
  });

  it('같은 창이 IDE 를 닫으면 옛 선언은 남지 않는다(범위가 넓어진 채 굳지 않는다)', () => {
    const { manager, name } = makeManager();
    const win = {};
    manager.setClientProjectScope(win, [name], undefined, ['ideLane']);
    manager.setClientProjectScope(win, [name], undefined, []);

    expect([...(manager.getEffectiveSliceScope() ?? [])]).toEqual([]);
  });

  it('창이 닫히면 그 슬라이스 선언도 함께 빠진다(프로젝트·폴더 선언과 같은 수명)', () => {
    const { manager, name } = makeManager();
    const win = {};
    manager.setClientProjectScope(win, [name], undefined, []);
    manager.clearClientProjectScope(win);

    expect(manager.getEffectiveSliceScope()).toBeNull();
  });

  it('모르는 그룹 이름은 걸러진다(전선에서 온 값을 그대로 믿지 않는다)', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], undefined, ['ideLane', 'nope', '__proto__', '']);

    const scope = manager.getEffectiveSliceScope();
    expect(scope?.has('agentReports')).toBe(true);
    // 아는 그룹 하나 분량만 들어왔다(모르는 이름이 무언가를 더 실어 오지 않는다).
    expect([...(scope ?? [])].sort()).toEqual([...SLICE_SCOPE_GROUPS.ideLane].sort());
  });
});

describe('§9 슬라이스 스코프 — 스냅샷에 실제로 걸린다', () => {
  it('범위 밖 슬라이스는 스냅샷에서 사라지고, 실은 목록이 되돌아온다', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));

    expect(manager.getBroadcastSnapshot().agentReports?.['a1']).toBeDefined();

    manager.setClientProjectScope({}, [name], undefined, []);
    const scoped = manager.getBroadcastSnapshot();

    expect(scoped.agentReports).toBeUndefined();
    expect(scoped.scopedSlices).toEqual([]);
  });

  it('IDE 를 열었다고 선언하면 그 슬라이스가 다시 실린다', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));
    manager.setClientProjectScope({}, [name], undefined, ['ideLane']);

    const scoped = manager.getBroadcastSnapshot();
    expect(scoped.agentReports?.['a1']).toBeDefined();
    expect(scoped.scopedSlices).toContain('agentReports');
  });

  it('플러그인만 읽으면 그 둘만 실린다 — IDE 묶음까지 따라오지 않는다', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));
    manager.setClientProjectScope({}, [name], undefined, ['pluginAgentData']);

    const scoped = manager.getBroadcastSnapshot();
    expect(scoped.agentReports?.['a1']).toBeDefined();
    expect(scoped.scopedSlices?.sort()).toEqual(['agentReports', 'agentReviews']);
    expect(scoped.sessionGoals).toBeUndefined();
  });

  it('뺄 수 없는 슬라이스는 최대로 좁힌 선언에서도 그대로 있다(§9 ④)', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], undefined, []);
    const scoped = manager.getBroadcastSnapshot();

    // 전역 집계·탭 표시
    expect(scoped.projects[name]).toBeDefined();
    expect(scoped.projectAgentCounts).toBeDefined();
    expect(typeof scoped.activeAgentCount).toBe('number');
    expect(scoped.agentPhase).toBeDefined();
    expect(scoped.appState).toBeDefined();
    expect(scoped.fileSizeRange).toBeDefined();
    // 캔버스 골격
    expect(Array.isArray(scoped.agents)).toBe(true);
    expect(Array.isArray(scoped.topFolders)).toBe(true);
    expect(Array.isArray(scoped.edges)).toBe(true);
    expect(scoped.nodeProjects).toBeDefined();
    expect(scoped.agentProjects).toBeDefined();
    // "절대 안 뺀다" 표의 항목 중 스냅샷에 실린 것은 하나도 지워지지 않는다.
    const full = manager.getSnapshot() as unknown as Record<string, unknown>;
    const rec = scoped as unknown as Record<string, unknown>;
    for (const key of Object.keys(ALWAYS_SHIPPED_SLICES)) {
      if (full[key] === undefined) continue;
      expect(rec[key], key + ' 가 슬라이스 스코프에 지워졌다').toBeDefined();
    }
  });

  it('내부 조회용 스냅샷은 슬라이스 범위를 적용하지 않는다(REST·dispatch 가 좁아지면 기능 손상)', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));
    manager.setClientProjectScope({}, [name], undefined, []);

    const internal = manager.getSnapshot();
    expect(internal.scopedSlices).toBeUndefined();
    expect(internal.agentReports?.['a1']).toBeDefined();
  });

  it('범위 안 슬라이스는 내부 스냅샷과 값이 같다(좁혀도 왕복 등가)', () => {
    const { manager, name } = makeManager();
    manager.addAgentReport(report('a1', 'r1'));
    manager.setClientProjectScope({}, [name], undefined, ['ideLane']);

    const internal = manager.getSnapshot() as unknown as Record<string, unknown>;
    const scoped = manager.getBroadcastSnapshot() as unknown as Record<string, unknown>;
    for (const key of SCOPABLE_SLICE_KEYS) {
      if (!(manager.getEffectiveSliceScope()?.has(key) ?? false)) continue;
      expect(scoped[key], key + ' 가 어긋났다').toEqual(internal[key]);
    }
  });
});
