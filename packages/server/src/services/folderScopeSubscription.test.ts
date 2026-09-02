import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 **실제로 건드린다** —
//   임시 폴더가 그 목록에 쌓이면 다음 부팅에서 유령 탭이 복원된다(쓰기만 막는다).
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §9 폴더 스코프 — **창 선언의 합집합 규약**.
 *
 * 프로젝트 축과 규칙은 같지만 **한 군데가 결정적으로 다르다**: 폴더 축에서는 "빈 배열"과
 * "미선언"이 서로 다른 뜻이다.
 *   · `folders: []`  = "나는 지금 폴더 밖(메인 뷰)이다" — 좁혀도 되는 **유효한 선언**
 *   · `folders` 없음 = "나는 폴더 축을 모른다"(구버전 클라) — 좁히면 **그 창의 폴더 내부가 빈다**
 *
 * 이 구분을 잃으면 증상이 조용하다. 구버전 창 하나가 붙어 있는 동안 그 창에서만 폴더가
 * 안 열리고, 서버 로그에는 아무것도 남지 않는다.
 */

const tmpDirs: string[] = [];

function makeManager(): { manager: ProjectGraphManager; name: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-fscope-'));
  tmpDirs.push(dir);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(dir).name;
  return { manager, name };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

describe('§9 폴더 스코프 — 선언 합집합', () => {
  it('아무도 선언하지 않으면 전량이다(침묵은 축소가 아니다)', () => {
    const { manager } = makeManager();
    expect(manager.getEffectiveFolderScope()).toBeNull();
    expect(manager.getBroadcastSnapshot().scopedFolders).toBeUndefined();
  });

  it('폴더 축을 아는 창이 빈 배열을 선언하면 그것도 범위다 — 메인 뷰는 좁혀도 된다', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], []);

    expect(manager.getEffectiveFolderScope()).toEqual(new Set());
    // 되돌려 주는 값이 `[]` 라는 것이 곧 "폴더 범위를 적용했다" 는 신고다(undefined 와 다르다).
    expect(manager.getBroadcastSnapshot().scopedFolders).toEqual([]);
  });

  it('폴더 축을 모르는 창이 하나라도 있으면 통째로 전량으로 되돌아간다', () => {
    const { manager, name } = makeManager();
    const modern = {};
    const legacy = {};
    manager.setClientProjectScope(modern, [name], ['folder-1']);
    manager.setClientProjectScope(legacy, [name]);            // folders 미선언 = 구버전

    expect(manager.getEffectiveFolderScope()).toBeNull();
    expect(manager.getBroadcastSnapshot().scopedFolders).toBeUndefined();
  });

  it('그 구버전 창이 닫히면 다시 좁아진다', () => {
    const { manager, name } = makeManager();
    const modern = {};
    const legacy = {};
    manager.setClientProjectScope(modern, [name], ['folder-1']);
    manager.setClientProjectScope(legacy, [name]);
    manager.clearClientProjectScope(legacy);

    expect(manager.getEffectiveFolderScope()).toEqual(new Set(['folder-1']));
  });

  it('창이 여럿이면 합집합이다 — 별창이 다른 폴더를 열어 두면 그쪽도 실려야 한다', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], ['folder-a', 'folder-a1']);
    manager.setClientProjectScope({}, [name], ['folder-b']);

    const scope = manager.getEffectiveFolderScope();
    expect([...(scope ?? [])].sort()).toEqual(['folder-a', 'folder-a1', 'folder-b']);
  });

  it('창이 닫히면 그 폴더 선언도 함께 빠진다(프로젝트 선언과 같은 수명)', () => {
    const { manager, name } = makeManager();
    const win = {};
    manager.setClientProjectScope(win, [name], ['folder-a']);
    manager.clearClientProjectScope(win);

    // 마지막 창까지 닫히면 "선언 없음" 으로 돌아간다.
    expect(manager.getEffectiveFolderScope()).toBeNull();
  });

  it('같은 창이 폴더를 옮기면 옛 선언은 남지 않는다(범위가 넓어진 채 굳지 않는다)', () => {
    const { manager, name } = makeManager();
    const win = {};
    manager.setClientProjectScope(win, [name], ['folder-a']);
    manager.setClientProjectScope(win, [name], ['folder-b']);

    expect(manager.getEffectiveFolderScope()).toEqual(new Set(['folder-b']));
  });

  it('내부 조회용 스냅샷은 폴더 범위를 적용하지 않는다(REST·dispatch 가 좁아지면 기능 손상)', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], []);

    expect(manager.getSnapshot().scopedFolders).toBeUndefined();
  });

  it('빈 문자열·비문자열은 걸러진다(전선에서 온 값을 그대로 믿지 않는다)', () => {
    const { manager, name } = makeManager();
    manager.setClientProjectScope({}, [name], ['', 'folder-a', '']);

    expect(manager.getEffectiveFolderScope()).toEqual(new Set(['folder-a']));
  });
});
