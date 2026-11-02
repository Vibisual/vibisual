import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathKey } from './pathKey.js';
import { ProjectGraphManager } from './projectGraphManager.js';

// `registerProject` 는 `~/.vibisual/app-state.json` 에 열린 프로젝트를 실제로 적는다 — 시험 폴더가 쌓이지 않게 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/** §4 폴더 우클릭 — 고른 그 폴더를 연다(표식 승격 ❌ · 워크트리만 부모로) · 탭은 표시명으로 고른다. */

const tmpDirs: string[] = [];
function makeDir(tag: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vibi-chosen-${tag}-`)));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 시험과 무관 */ }
  }
});

const samePath = (a: string, b: string): boolean => pathKey(a) === pathKey(b);

describe('§4 폴더 우클릭 — 고른 그 폴더', () => {
  it('저장소(.git) 안의 폴더를 골라도 저장소 루트가 아니라 그 폴더가 프로젝트다', () => {
    const repo = makeDir('repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const sub = path.join(repo, 'packages', 'client');
    fs.mkdirSync(sub, { recursive: true });

    const manager = new ProjectGraphManager();
    const chosen = manager.registerChosenFolder(sub);
    expect(samePath(chosen.path, sub)).toBe(true);
    expect(chosen.name).toBe('client');

    // [폴더 열기]는 종전대로 표식 루트로 올린다.
    const picked = new ProjectGraphManager().registerProject(sub);
    expect(samePath(picked.path, repo)).toBe(true);
  });

  it('표식이 없는 폴더(SVN 작업본 등)도 그 폴더 그대로', () => {
    const root = makeDir('svn');
    fs.mkdirSync(path.join(root, '.svn'));
    const content = path.join(root, 'trunk', 'Content');
    fs.mkdirSync(content, { recursive: true });
    const info = new ProjectGraphManager().registerChosenFolder(content);
    expect(samePath(info.path, content)).toBe(true);
  });

  it('워크트리는 탭이 아니라 부모 캔버스의 버블 — 부모 프로젝트가 열린다', () => {
    const parent = makeDir('wt');
    const wt = path.join(parent, '.claude', 'worktrees', 'feature-a');
    fs.mkdirSync(wt, { recursive: true });
    const info = new ProjectGraphManager().registerChosenFolder(wt);
    expect(samePath(info.path, parent)).toBe(true);
    expect(info.parentProjectPath).toBeUndefined();
  });
});

describe('§4 · §5.4 #14 — 탭 표시명', () => {
  it('basename 이 하나면 이름 그대로, 둘이 열리면 스냅샷과 같은 `이름 (구분자)`', () => {
    const a = path.join(makeDir('a'), 'proj-a', 'trunk');
    const b = path.join(makeDir('b'), 'proj-b', 'trunk');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });

    const manager = new ProjectGraphManager();
    const first = manager.registerChosenFolder(a);
    expect(manager.displayNameForPath(first.path)).toBe('trunk');

    const second = manager.registerChosenFolder(b);
    const nameA = manager.displayNameForPath(first.path);
    const nameB = manager.displayNameForPath(second.path);
    expect(nameA).toBe('trunk (proj-a)');
    expect(nameB).toBe('trunk (proj-b)');
    // 렌더러가 고를 이름이 실제 탭 키와 같아야 한다.
    expect(Object.keys(manager.getSnapshot().projects).sort()).toEqual([nameA, nameB].sort());
  });

  it('탭이 아닌 경로는 null', () => {
    const manager = new ProjectGraphManager();
    expect(manager.displayNameForPath(path.join(makeDir('none'), 'x'))).toBeNull();
  });
});
