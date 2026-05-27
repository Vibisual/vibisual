import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// appState.ts 는 import 시점에 os.homedir() 로 `~/.vibisual/app-state.json` 경로를 고정한다.
// 테스트를 사용자 실제 홈과 격리하기 위해 homedir 을 임시 디렉토리로 모킹(hoisted).
const TEST_HOME = path.join(os.tmpdir(), `vibisual-appstate-test-${process.pid}-${Date.now()}`);
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => TEST_HOME }, homedir: () => TEST_HOME };
});

const APP_STATE_FILE = path.join(TEST_HOME, '.vibisual', 'app-state.json');

// 모킹 적용 후 import (top-level import 면 hoist 순서 보장 안 되므로 dynamic).
const {
  loadAppState,
  saveAppState,
  appStateAddOpenProject,
  appStateRemoveOpenProject,
  appStateGetProjectName,
  appStatePruneStaleProjectNames,
  _resetAppStateCache,
} = await import('../appState.js');

function writeRawAppState(obj: unknown): void {
  fs.mkdirSync(path.dirname(APP_STATE_FILE), { recursive: true });
  fs.writeFileSync(APP_STATE_FILE, JSON.stringify(obj), 'utf-8');
}

beforeEach(() => {
  _resetAppStateCache();
  try { fs.rmSync(APP_STATE_FILE, { force: true }); } catch { /* noop */ }
});

afterAll(() => {
  try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('AppState v1.63 — 경로 식별 (projectId = 정규화 절대경로)', () => {
  it('같은 basename·다른 경로 프로젝트 2개가 동시에 열려도 둘 다 보존된다 (#2 회귀)', () => {
    const added1 = appStateAddOpenProject('C:/work/client', 'client');
    const added2 = appStateAddOpenProject('D:/other/client', 'client');
    expect(added1).toBe(true);
    expect(added2).toBe(true);

    const st = loadAppState();
    expect(st.openProjects).toHaveLength(2);
    expect(st.openProjects).toEqual(
      expect.arrayContaining(['C:/work/client', 'D:/other/client']),
    );
    // 표시 이름 캐시는 경로별로 독립 보존.
    expect(appStateGetProjectName('C:/work/client')).toBe('client');
    expect(appStateGetProjectName('D:/other/client')).toBe('client');
  });

  it('같은 경로(대소문자/슬래시/trailing 차이)는 중복 등록되지 않는다', () => {
    appStateAddOpenProject('C:/Work/App', 'App');
    const again = appStateAddOpenProject('c:\\work\\app\\', 'App');
    expect(again).toBe(false);
    expect(loadAppState().openProjects).toHaveLength(1);
  });

  it('닫기는 경로 기준으로 해당 프로젝트만 제거하고 동명이는 유지한다', () => {
    appStateAddOpenProject('C:/work/client', 'client');
    appStateAddOpenProject('D:/other/client', 'client');
    const removed = appStateRemoveOpenProject('C:/work/client');
    expect(removed).toBe(true);

    const st = loadAppState();
    expect(st.openProjects).toEqual(['D:/other/client']);
  });

  it('pin/lastActive/default 가 같은 경로면 닫을 때 함께 해제된다', () => {
    appStateAddOpenProject('C:/work/api', 'api');
    saveAppState({
      ...loadAppState(),
      pinnedProjects: ['C:/work/api'],
      lastActiveProject: 'C:/work/api',
      defaultProject: 'C:/work/api',
    });
    appStateRemoveOpenProject('C:/work/api');
    const st = loadAppState();
    expect(st.openProjects).toHaveLength(0);
    expect(st.pinnedProjects).toHaveLength(0);
    expect(st.lastActiveProject).toBeNull();
    expect(st.defaultProject).toBeNull();
  });

  it('구 name-array AppState 를 path-array 로 1회 마이그레이션한다 (v1.52(c) 미구현분)', () => {
    writeRawAppState({
      openProjects: ['client', 'api'],
      pinnedProjects: ['client'],
      lastActiveProject: 'api',
      defaultProject: null,
      projectPaths: { client: 'C:/work/client', api: 'C:/work/api' },
      updatedAt: 123,
    });
    _resetAppStateCache();
    const st = loadAppState();
    expect(st.openProjects).toEqual(
      expect.arrayContaining(['C:/work/client', 'C:/work/api']),
    );
    expect(st.openProjects.every((p) => p.includes('/'))).toBe(true);
    expect(st.pinnedProjects).toEqual(['C:/work/client']);
    expect(st.lastActiveProject).toBe('C:/work/api');
    // 표시 이름 캐시가 마이그레이션 중 채워진다.
    expect(appStateGetProjectName('C:/work/client')).toBe('client');
  });

  it('마이그레이션 시 projectPaths 에 경로가 없는 엔트리는 drop 된다', () => {
    writeRawAppState({
      openProjects: ['client', 'ghost'],
      pinnedProjects: [],
      lastActiveProject: null,
      defaultProject: null,
      projectPaths: { client: 'C:/work/client' },
      updatedAt: 1,
    });
    _resetAppStateCache();
    const st = loadAppState();
    expect(st.openProjects).toEqual(['C:/work/client']);
  });

  it('appStatePruneStaleProjectNames 는 디스크 부재 경로의 표시명 캐시만 제거한다 (#3)', () => {
    appStateAddOpenProject('C:/work/alive', 'alive');
    appStateAddOpenProject('C:/work/dead', 'dead');
    const removed = appStatePruneStaleProjectNames((p) => p.includes('alive'));
    expect(removed).toBe(1);
    expect(appStateGetProjectName('C:/work/alive')).toBe('alive');
    // dead 는 캐시에서 빠져 basename 폴백.
    expect(appStateGetProjectName('C:/work/dead')).toBe('dead');
  });
});
