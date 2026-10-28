/**
 * §5.23 — `AppState.webGroup` 저장·읽기·이주(`webFoldPerAgent` 만 켰으면 최대 1). 저장은 준 칸만, 다른 설정 저장에 떨어지지 않는다.
 * ⚠ 실제 `~/.vibisual/app-state.json` 을 건드리지 않게 `VIBISUAL_HOME` 을 임시 폴더로 돌리고 모듈을 시험마다 새로 읽는다(경로가 import 때 정해진다).
 * 파일은 먼저 써 둔다 — 없으면 옛 위치 이주 경로를 탄다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WEB_GROUP_DEFAULTS, WEB_GROUP_MAX_BOUNDS } from '@vibisual/shared';

const prevHome = process.env['VIBISUAL_HOME'];
let home = '';

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-webgroup-home-')));
  process.env['VIBISUAL_HOME'] = home;
  vi.resetModules();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['VIBISUAL_HOME'];
  else process.env['VIBISUAL_HOME'] = prevHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
});

function stateFile(): string {
  return path.join(home, '.vibisual', 'app-state.json');
}

function writeState(state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify({ openProjects: [], ...state }), 'utf-8');
}

async function loadModule(): Promise<typeof import('./appState.js')> {
  return import('./appState.js');
}

describe('§5.23 묶기 설정 — 읽기와 이주', () => {
  it('저장된 것이 없으면 기본값(켬)이다', async () => {
    writeState({});
    const m = await loadModule();
    expect(m.appStateGetWebGroup()).toEqual(WEB_GROUP_DEFAULTS);
  });

  it('종전 접어 보기만 켜 둔 사용자는 최대 1개로 읽는다', async () => {
    writeState({ webFoldPerAgent: true });
    const m = await loadModule();
    expect(m.appStateGetWebGroup()).toEqual({ ...WEB_GROUP_DEFAULTS, maxPerAgent: 1 });
  });

  it('종전 접어 보기를 꺼 둔 사용자는 기본값이다', async () => {
    writeState({ webFoldPerAgent: false });
    const m = await loadModule();
    expect(m.appStateGetWebGroup()).toEqual(WEB_GROUP_DEFAULTS);
  });

  it('새 설정이 저장돼 있으면 그것이 이긴다 — 종전 값은 보지 않는다', async () => {
    writeState({ webFoldPerAgent: true, webGroup: { sameSite: false, byKind: true, maxPerAgent: 9 } });
    const m = await loadModule();
    expect(m.appStateGetWebGroup()).toEqual({ sameSite: false, byKind: true, maxPerAgent: 9 });
  });

  it('저장된 값이 범위 밖이면 접어서 읽는다', async () => {
    writeState({ webGroup: { sameSite: true, byKind: true, maxPerAgent: 500 } });
    const m = await loadModule();
    expect(m.appStateGetWebGroup().maxPerAgent).toBe(WEB_GROUP_MAX_BOUNDS.MAX);
  });
});

describe('§5.23 묶기 설정 — 저장', () => {
  it('준 칸만 바꾼다 — 빠진 칸은 지금 값을 지키고, 범위 밖은 접힌다', async () => {
    writeState({});
    const m = await loadModule();
    expect(m.appStateSetWebGroup({ byKind: false })).toEqual({ ...WEB_GROUP_DEFAULTS, byKind: false });
    expect(m.appStateSetWebGroup({ maxPerAgent: 999 })).toEqual({ ...WEB_GROUP_DEFAULTS, byKind: false, maxPerAgent: WEB_GROUP_MAX_BOUNDS.MAX });
    expect(m.appStateGetWebGroup()).toEqual({ ...WEB_GROUP_DEFAULTS, byKind: false, maxPerAgent: WEB_GROUP_MAX_BOUNDS.MAX });
  });

  it('모양이 틀린 값은 지금 값을 바꾸지 않는다', async () => {
    writeState({ webGroup: { sameSite: false, byKind: false, maxPerAgent: 3 } });
    const m = await loadModule();
    expect(m.appStateSetWebGroup('nonsense')).toEqual({ sameSite: false, byKind: false, maxPerAgent: 3 });
  });

  it('저장한 값이 파일에 남아 다시 읽어도 같다', async () => {
    writeState({});
    const first = await loadModule();
    first.appStateSetWebGroup({ sameSite: false, byKind: true, maxPerAgent: 2 });
    const onDisk = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as { webGroup?: unknown };
    expect(onDisk.webGroup).toEqual({ sameSite: false, byKind: true, maxPerAgent: 2 });

    vi.resetModules();
    const second = await loadModule();
    expect(second.appStateGetWebGroup()).toEqual({ sameSite: false, byKind: true, maxPerAgent: 2 });
  });

  it('다른 설정을 저장해도 이 칸이 떨어지지 않는다', async () => {
    writeState({});
    const m = await loadModule();
    m.appStateSetWebGroup({ maxPerAgent: 4 });
    m.appStateSetExternalTopBudget(7);

    vi.resetModules();
    const again = await loadModule();
    expect(again.appStateGetWebGroup().maxPerAgent).toBe(4);
    expect(again.appStateGetExternalTopBudget()).toBe(7);
  });
});
