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
 * §4 (첫 실행 온보딩) — **온보딩 중에 고른 UI 언어가 살아남는다.**
 *
 * 실제 사고: 설치·로그인 팝업은 프로젝트가 하나도 없는 상태에서 뜨는데, 그때 `setUiLocale` 은
 * 0개 인스턴스를 돌아 **아무 데도 남지 않았다**. 그러다 폴더를 고르는 순간 새 인스턴스가
 * 기본값 `'en'` 으로 서고 그 값이 스냅샷으로 밀려와, 방금 고른 한국어가 영어로 되돌아갔다.
 * (그 팝업의 백드롭이 헤더 언어 전환기까지 덮고 있었으므로, 되돌아가면 다시 고를 자리도 없었다.)
 */

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

function tmpProject(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-locale-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

describe('온보딩 중(프로젝트 0개)에 고른 UI 언어', () => {
  it('인스턴스가 없어도 남고, 변경으로 신고된다', () => {
    const manager = new ProjectGraphManager();
    expect(manager.getUiLocale()).toBe('en');

    // 예전에는 여기서 false 를 돌려주고(=바뀐 것 없음) 값도 사라졌다.
    expect(manager.setUiLocale('ko')).toBe(true);
    expect(manager.getUiLocale()).toBe('ko');
  });

  it('그 뒤 폴더를 고르면 새 프로젝트가 그 언어를 물려받는다 — 영어로 되돌아가지 않는다', () => {
    const manager = new ProjectGraphManager();
    manager.setUiLocale('ko');

    manager.registerProject(tmpProject('seed'));

    expect(manager.getUiLocale()).toBe('ko');
    expect(manager.getSnapshot().uiLocale).toBe('ko');
  });

  it('같은 값을 다시 넣으면 변경 아님 — 불필요한 저장·브로드캐스트를 안 부른다', () => {
    const manager = new ProjectGraphManager();
    expect(manager.setUiLocale('ja')).toBe(true);
    expect(manager.setUiLocale('ja')).toBe(false);
  });

  it('프로젝트를 연 뒤 바꾸면 그 프로젝트에도 실린다', () => {
    const manager = new ProjectGraphManager();
    manager.registerProject(tmpProject('after'));

    expect(manager.setUiLocale('de')).toBe(true);
    expect(manager.getSnapshot().uiLocale).toBe('de');

    // 그 뒤에 여는 두 번째 프로젝트도 같은 언어로 선다(창마다 언어가 갈리지 않게).
    manager.registerProject(tmpProject('after2'));
    expect(manager.getSnapshot().uiLocale).toBe('de');
  });
});
