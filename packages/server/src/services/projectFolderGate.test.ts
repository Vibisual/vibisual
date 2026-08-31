import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 실제로 건드린다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §4 (첫 실행 온보딩) ③ — **폴더를 고르기 전에는 아무것도 만들지 않는다.**
 *
 * 실제 사고: 앱을 갓 깔고 폴더를 한 번도 고르지 않은 사용자가 캔버스 우클릭 → "커스텀 에이전트"
 * 를 눌렀더니, 매니저가 `registerProject(process.cwd())` 로 **임시 등록**을 해 버렸다. Finder 로
 * 띄운 mac 앱의 `process.cwd()` 는 `/` 라 `path.basename('/') === ''` → 이름이 빈 프로젝트 탭
 * 하나와 **파일시스템 루트에 매인 에이전트**가 조용히 생겼다. 사용자 눈에는 "폴더를 고른 적도
 * 없는데 빈 것이 생성됐다" 로 보인다.
 */

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

function tmpProject(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-folder-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

describe('폴더를 고르기 전 생성 요청', () => {
  it('커스텀 에이전트·Auto·파이프라인 모두 만들지 않고 null 을 돌려준다', () => {
    const manager = new ProjectGraphManager();
    expect(manager.hasOpenProject()).toBe(false);

    expect(manager.createCustomAgent('', { x: 0, y: 0 }, null)).toBeNull();
    expect(manager.createAutoAgent('', { x: 0, y: 0 }, null)).toBeNull();
    expect(manager.createPipeline('pipeline-subagent', '', { x: 0, y: 0 }, null)).toBeNull();
  });

  it('거절하면서 프로젝트를 지어내지 않는다 — 이름 없는 탭이 생기던 자리', () => {
    const manager = new ProjectGraphManager();
    manager.createCustomAgent('', { x: 0, y: 0 }, null);

    // 예전에는 여기서 `process.cwd()` 가 프로젝트로 등록돼 탭이 하나 생겼다.
    expect(manager.getVisibleTopLevelProjects()).toHaveLength(0);
    expect(manager.hasOpenProject()).toBe(false);
  });

  it('폴더를 고른 뒤에는 평소대로 만들어진다', () => {
    const manager = new ProjectGraphManager();
    const name = manager.registerProject(tmpProject('ok')).name;
    expect(manager.hasOpenProject()).toBe(true);

    const agent = manager.createCustomAgent('Worker', { x: 1, y: 2 }, name);
    expect(agent).not.toBeNull();
    expect(agent?.label).toBe('Worker');
  });
});

describe('프로젝트 이름', () => {
  it('basename 이 비는 경로(드라이브·파일시스템 루트)에도 읽을 수 있는 이름이 붙는다', () => {
    // `path.basename('/')` 도 `path.basename('C:/')` 도 '' 다. 이름이 비면 탭에 글자가 하나도
    // 없이 배지만 떠서 그게 어느 폴더인지 알 길이 사라진다(실측: mac 에서 이름 없는 탭 하나).
    const manager = new ProjectGraphManager();
    const root = process.platform === 'win32' ? `${process.cwd().slice(0, 2)}/` : '/';
    const info = manager.registerProject(root);
    expect(info.name).not.toBe('');
  });
});

describe('열린 프로젝트 판정(hasOpenProject)', () => {
  it('× 로 닫은 탭은 "고른 폴더" 로 세지 않는다 — 보이지도 않는 탭에 버블이 매이면 안 된다', () => {
    const manager = new ProjectGraphManager();
    const name = manager.registerProject(tmpProject('hidden')).name;
    expect(manager.hasOpenProject()).toBe(true);

    manager.hideProject(name);
    expect(manager.hasOpenProject()).toBe(false);

    manager.showProject(name);
    expect(manager.hasOpenProject()).toBe(true);
  });
});
