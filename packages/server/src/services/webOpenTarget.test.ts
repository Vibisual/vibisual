/**
 * §5.23 「더블클릭」 — `AppState.webOpenTarget` 저장·읽기(기본은 바깥 브라우저). 다른 설정 저장과 서로 칸을 떨어뜨리지 않는다.
 * ⚠ `VIBISUAL_HOME` 을 임시 폴더로 돌리고 모듈을 시험마다 새로 읽는다. 파일은 먼저 써 둔다(없으면 옛 위치 이주 경로).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WEB_GROUP_DEFAULTS, WEB_OPEN_TARGET_DEFAULT, normalizeWebOpenTarget } from '@vibisual/shared';

const prevHome = process.env['VIBISUAL_HOME'];
let home = '';

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-webopen-home-')));
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

function readState(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Record<string, unknown>;
}

async function loadModule(): Promise<typeof import('./appState.js')> {
  return import('./appState.js');
}

describe('§5.23 더블클릭 여는 곳 — 정규화', () => {
  it('아는 값은 그대로, 모르는 값·빠진 값은 바깥 브라우저', () => {
    expect(WEB_OPEN_TARGET_DEFAULT).toBe('external');
    expect(normalizeWebOpenTarget('iframe')).toBe('iframe');
    expect(normalizeWebOpenTarget('external')).toBe('external');
    expect(normalizeWebOpenTarget(undefined)).toBe('external');
    expect(normalizeWebOpenTarget(null)).toBe('external');
    expect(normalizeWebOpenTarget('IFRAME')).toBe('external');
    expect(normalizeWebOpenTarget(1)).toBe('external');
  });
});

describe('§5.23 더블클릭 여는 곳 — 저장과 읽기', () => {
  it('저장된 것이 없으면 바깥 브라우저다', async () => {
    writeState({});
    const m = await loadModule();
    expect(m.appStateGetWebOpenTarget()).toBe('external');
  });

  it('고른 값은 파일에 남고 다시 읽어도 그대로다', async () => {
    writeState({});
    const m = await loadModule();
    expect(m.appStateSetWebOpenTarget('iframe')).toBe('iframe');
    expect(m.appStateGetWebOpenTarget()).toBe('iframe');
    expect(readState()['webOpenTarget']).toBe('iframe');

    vi.resetModules();
    const again = await loadModule();
    expect(again.appStateGetWebOpenTarget()).toBe('iframe');
  });

  it('모르는 값은 기본값으로 접혀 저장된다', async () => {
    writeState({});
    const m = await loadModule();
    expect(m.appStateSetWebOpenTarget('webview')).toBe('external');
    expect(readState()['webOpenTarget']).toBe('external');
  });

  it('디스크의 모르는 값은 읽을 때 기본값이다', async () => {
    writeState({ webOpenTarget: 'nonsense' });
    const m = await loadModule();
    expect(m.appStateGetWebOpenTarget()).toBe('external');
  });
});

describe('§5.23 더블클릭 여는 곳 — 다른 칸과 서로 떨어뜨리지 않는다', () => {
  it('다른 설정을 저장해도 여는 곳이 남는다', async () => {
    writeState({ webOpenTarget: 'iframe' });
    const m = await loadModule();
    m.appStateSetWebGroup({ maxPerAgent: 3 });
    m.appStateSetExternalTopBudget(5);
    expect(readState()['webOpenTarget']).toBe('iframe');
    expect(m.appStateGetWebOpenTarget()).toBe('iframe');
  });

  it('여는 곳을 저장해도 묶기 설정이 남는다', async () => {
    writeState({ webGroup: { ...WEB_GROUP_DEFAULTS, maxPerAgent: 2 } });
    const m = await loadModule();
    m.appStateSetWebOpenTarget('iframe');
    expect(m.appStateGetWebGroup()).toEqual({ ...WEB_GROUP_DEFAULTS, maxPerAgent: 2 });
    expect((readState()['webGroup'] as Record<string, unknown>)['maxPerAgent']).toBe(2);
  });
});
