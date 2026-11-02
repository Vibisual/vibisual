import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCheckpoint, UiLocale } from '@vibisual/shared';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 실제로 건드린다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §4 — UI 언어는 앱 전체 값 하나다. 프로젝트 체크포인트마다 옛 언어가 남아 있어도 재시작·업데이트 뒤
 * 복원 순서나 보고 있는 탭에 따라 화면 언어가 뒤집히면 안 된다.
 */

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

function tmpProject(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-locale-restore-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

/** 그 언어로 저장된 프로젝트 체크포인트 한 벌(다른 앱 실행에서 저장된 것처럼). */
function savedCheckpoint(tag: string, locale: UiLocale): ProjectCheckpoint {
  const earlier = new ProjectGraphManager();
  const info = earlier.registerProject(tmpProject(tag));
  earlier.setUiLocale(locale);
  const cp = earlier.toProjectCheckpoint(info.name);
  expect(cp.uiLocale).toBe(locale);
  return cp;
}

describe('§4 UI 언어 — 재시작 뒤 프로젝트의 옛 언어가 앱 언어를 덮지 않는다', () => {
  it('저장된 앱 언어가 있으면 다른 언어로 저장된 체크포인트를 복원해도 그대로이고, 다음 저장에도 앱 언어가 실린다', () => {
    const cp = savedCheckpoint('de', 'de');
    const manager = new ProjectGraphManager();
    manager.setUiLocale('ko'); // 부팅 — user-defaults 의 언어를 복원 전에 넣는다

    manager.restoreFromCheckpoint(cp);

    expect(manager.getUiLocale()).toBe('ko');
    expect(manager.getSnapshot().uiLocale).toBe('ko');
    expect(manager.toProjectCheckpoint(cp.project.name).uiLocale).toBe('ko');
  });

  it('설정 파일에 언어가 없는 옛 저장분 — 처음 복원한 프로젝트 언어로 정해지고 뒤 프로젝트가 바꾸지 못한다', () => {
    const first = savedCheckpoint('first', 'ko');
    const second = savedCheckpoint('second', 'ja');
    const manager = new ProjectGraphManager();

    manager.restoreFromCheckpoint(first);
    manager.restoreFromCheckpoint(second);

    expect(manager.getUiLocale()).toBe('ko');
    expect(manager.getSnapshot().uiLocale).toBe('ko');
    expect(manager.toProjectCheckpoint(second.project.name).uiLocale).toBe('ko');
  });

  it('복원 뒤 새로 연 폴더도 앱 언어로 서고, 그 탭만 보는 방송도 기본값 en 으로 바뀌지 않는다', () => {
    const cp = savedCheckpoint('boot', 'ko');
    const manager = new ProjectGraphManager();
    manager.restoreFromCheckpoint(cp);

    const freshPath = tmpProject('fresh');
    const fresh = manager.registerProject(freshPath);
    manager.setBootViewProject(freshPath);

    expect(manager.toProjectCheckpoint(fresh.name).uiLocale).toBe('ko');
    expect(manager.getBroadcastSnapshot().uiLocale).toBe('ko');
  });
});
