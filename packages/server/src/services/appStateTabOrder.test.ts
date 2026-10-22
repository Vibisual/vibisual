/**
 * §5.4 #14-2 (C-1) — 프로젝트 탭 순서를 `AppState.openProjects` 에 남기는 저장 경로(`appStateReorderOpenProjects`).
 *
 *  1. 놓은 순서가 디스크에 남아, 껐다 켠(모듈을 새로 읽은) 뒤에도 그 순서로 읽힌다 — 사용자 보고의 본체.
 *  2. **순서만** 바뀐다 — 보내지 않은 프로젝트는 제자리, 열려 있지 않은 경로는 끼어들지 않는다
 *     (클라가 쥔 옛 목록으로 통째 덮으면 그 사이 열린 프로젝트가 다음 부팅에 사라진다).
 *  3. 바뀐 것이 없으면 쓰지 않는다(매 드롭이 디스크를 두드리지 않게) — 백업 회전도 돌지 않는다.
 *  4. 다른 칸(핀·기본·마지막 활성)은 건드리지 않는다.
 *
 * ⚠ 실제 홈의 `~/.vibisual/app-state.json` 을 건드리지 않게 `VIBISUAL_HOME` 을 임시 폴더로 돌리고, 모듈을 시험마다
 *   새로 읽는다(경로가 모듈을 읽을 때 정해진다). 파일은 **먼저 써 둔다** — 없으면 옛 위치 이주 경로를 탄다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env['VIBISUAL_HOME'];
let home = '';

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-taborder-home-')));
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
  fs.writeFileSync(stateFile(), JSON.stringify({ openProjects: [], updatedAt: 1, ...state }), 'utf-8');
}

function readOpenProjects(): string[] {
  return (JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as { openProjects: string[] }).openProjects;
}

async function loadModule(): Promise<typeof import('./appState.js')> {
  return import('./appState.js');
}

const A = '/work/alpha';
const B = '/work/beta';
const C = '/work/gamma';

describe('§5.4 #14-2 (C-1) 프로젝트 탭 순서 저장', () => {
  it('놓은 순서가 남아 껐다 켠 뒤에도 그 순서다', async () => {
    writeState({ openProjects: [A, B, C], lastActiveProject: C });
    const m = await loadModule();
    expect(m.appStateReorderOpenProjects([C, A, B])).toBe(true);
    expect(readOpenProjects()).toEqual([C, A, B]);

    // 껐다 켠다 — 모듈 캐시를 버리고 디스크에서 다시 읽는다.
    vi.resetModules();
    const reloaded = await loadModule();
    expect(reloaded.loadAppState().openProjects).toEqual([C, A, B]);
  });

  it('보내지 않은 프로젝트는 제자리, 열려 있지 않은 경로는 끼어들지 않는다', async () => {
    writeState({ openProjects: [A, B, C] });
    const m = await loadModule();
    // B 는 별창으로 빠져 줄에 없었다 · '/work/closed' 는 이미 닫힌 탭이다.
    expect(m.appStateReorderOpenProjects([C, '/work/closed', A])).toBe(true);
    expect(m.loadAppState().openProjects).toEqual([C, B, A]);
  });

  it('바뀐 것이 없으면 쓰지 않는다', async () => {
    writeState({ openProjects: [A, B, C] });
    const m = await loadModule();
    const before = fs.statSync(stateFile()).mtimeMs;
    expect(m.appStateReorderOpenProjects([A, C])).toBe(false);
    expect(m.appStateReorderOpenProjects([])).toBe(false);
    expect(fs.statSync(stateFile()).mtimeMs).toBe(before);
    expect(fs.existsSync(`${stateFile()}.bak1`)).toBe(false);
  });

  it('다른 칸(핀·기본·마지막 활성)은 그대로다', async () => {
    writeState({ openProjects: [A, B, C], pinnedProjects: [B], defaultProject: A, lastActiveProject: C });
    const m = await loadModule();
    m.appStateReorderOpenProjects([B, C, A]);
    const s = m.loadAppState();
    expect(s.openProjects).toEqual([B, C, A]);
    expect(s.pinnedProjects).toEqual([B]);
    expect(s.defaultProject).toBe(A);
    expect(s.lastActiveProject).toBe(C);
  });

  it('새로 연 프로젝트는 여전히 줄 끝에 붙는다 — 순서 저장이 여닫기를 바꾸지 않는다', async () => {
    writeState({ openProjects: [A, B] });
    const m = await loadModule();
    m.appStateReorderOpenProjects([B, A]);
    m.appStateAddOpenProject(C, 'gamma');
    expect(m.loadAppState().openProjects).toEqual([B, A, C]);
  });
});
