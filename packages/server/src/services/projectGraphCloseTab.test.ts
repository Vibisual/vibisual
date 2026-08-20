import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 에 열린 프로젝트를 **실제로 기록한다**.
//   테스트가 만든 임시 폴더가 그 목록에 쌓이면 다음 부팅에서 유령 탭을 복원하려 든다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §5.4 #14 v1.34 — **프로젝트 탭 × 는 한 번에 닫힌다**(닫힘 = `hiddenProjects` SSOT).
 *
 * 탭 닫기는 두 단계로 흐른다 — `DELETE /api/projects/:name`(hide + stub 제거 + openProjects 제거)
 * 뒤에 클라가 `unload-project` 를 보내 인메모리 그래프를 해제한다. 그런데 `unloadProject` 는
 * 해제한 프로젝트를 **stub 으로 강등**(= 탭에 다시 등장)하므로, 방금 사용자가 닫은 프로젝트가
 * 그 강등으로 되살아나 "한 번 눌러선 안 닫히고 두 번 눌러야 닫히는" 증상이 된다.
 * 사용자가 닫은 프로젝트(hidden)는 강등 대상이 아니라는 것이 이 테스트가 못 박는 규약이다.
 * 반대로 **유휴 해제**(사용자가 닫지 않은 배경 탭)는 종전대로 stub 이 남아야 한다 —
 * 그 stub 이 사라지면 열어 둔 탭이 저절로 없어진다.
 */

const tmpDirs: string[] = [];

function makeProjectDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-close-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

/** 스냅샷에 그 경로의 탭이 하나라도 보이는가(hydrated 든 stub 이든). */
function tabVisible(manager: ProjectGraphManager, projectPath: string): boolean {
  const snap = manager.getSnapshot();
  const key = projectPath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const inProjects = Object.values(snap.projects).some(
    (p) => p.path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') === key,
  );
  const inStubs = Object.values(snap.stubProjects ?? {}).some(
    (m) => m.project.path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') === key,
  );
  return inProjects || inStubs;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('§5.4 #14 v1.34 — 프로젝트 탭 닫기', () => {
  it('닫기(× 1회) 뒤 이어지는 unload 가 탭을 stub 으로 되살리지 않는다', () => {
    const manager = new ProjectGraphManager();
    const dir = makeProjectDir('once');
    const info = manager.registerProject(dir);
    expect(tabVisible(manager, info.path)).toBe(true);

    // ① DELETE /api/projects/:name 이 하는 일 그대로.
    expect(manager.hideProject(info.name)).toBe(true);
    manager.removeStubFromMap(info.path);
    expect(tabVisible(manager, info.path)).toBe(false);

    // ② 그 직후 클라가 보내는 unload-project.
    expect(manager.unloadProject(info.path).ok).toBe(true);

    // 여기서 stub 으로 되살아나면 사용자는 "닫기를 눌렀는데 안 사라진다" 를 본다.
    expect(tabVisible(manager, info.path)).toBe(false);
  });

  it('닫기와 unload 순서가 뒤바뀌어도(unload 가 먼저 도착) 닫은 탭은 돌아오지 않는다', () => {
    const manager = new ProjectGraphManager();
    const dir = makeProjectDir('race');
    const info = manager.registerProject(dir);

    expect(manager.hideProject(info.name)).toBe(true);
    expect(manager.unloadProject(info.path).ok).toBe(true);
    manager.removeStubFromMap(info.path);

    expect(tabVisible(manager, info.path)).toBe(false);
  });

  it('사용자가 닫지 않은 프로젝트의 유휴 해제는 종전대로 stub 을 남긴다(탭 유지)', () => {
    const manager = new ProjectGraphManager();
    const dir = makeProjectDir('idle');
    const info = manager.registerProject(dir);

    expect(manager.unloadProject(info.path).ok).toBe(true);

    // 열어 둔 탭은 메모리에서만 내려갔을 뿐 화면에는 남아야 한다.
    expect(tabVisible(manager, info.path)).toBe(true);
    const snap = manager.getSnapshot();
    expect(Object.values(snap.stubProjects ?? {}).some((m) => m.project.path === info.path)).toBe(true);
  });
});
