import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getLocale: () => 'en-US', isPackaged: true } }));

import { describeInstallRun, folderMenuLocale, readUserDefaultsFile, userDefaultsFile } from './folderMenuInstall';
import { mainStrings } from './strings';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibisual-folder-menu-install-'));
  dirs.push(dir);
  const file = join(dir, 'user-defaults.json');
  writeFileSync(file, content);
  return file;
}

describe('설치기의 메뉴 등록 — 켜진 앱과 같은 값', () => {
  it('설정 파일은 서버와 같은 자리', () => {
    expect(userDefaultsFile(join('h', 'me'))).toBe(join('h', 'me', '.vibisual', 'user-defaults.json'));
  });

  it('설정을 읽는다 · 없거나 깨졌으면 null(= 기본값 켬)', () => {
    const on = tempFile(JSON.stringify({ advanced: { folderContextMenu: false }, appearance: { uiLocale: 'ko' } }));
    expect(readUserDefaultsFile(on)?.advanced?.folderContextMenu).toBe(false);
    expect(readUserDefaultsFile(tempFile('{ broken'))).toBeNull();
    expect(readUserDefaultsFile(tempFile('[1,2]'))).toBeNull();
    expect(readUserDefaultsFile(join(tmpdir(), 'vibisual-no-such-dir', 'user-defaults.json'))).toBeNull();
  });

  it('메뉴 글자 언어 — 설정한 UI 언어 → 지난 화면 언어 → OS 언어 → en', () => {
    expect(folderMenuLocale('ko', 'ja', 'de-DE')).toBe('ko');
    expect(folderMenuLocale(undefined, 'ja', 'de-DE')).toBe('ja');
    expect(folderMenuLocale('xx', null, 'de-DE')).toBe('de');
    expect(folderMenuLocale(undefined, undefined, 'tlh')).toBe('en');
    expect(mainStrings(folderMenuLocale('ko', null, 'en-US')).folderContextMenuLabel).toBe('Vibisual에서 프로젝트 열기');
  });

  it('설치기는 결과를 버린다 — crash.log 한 줄이 유일한 흔적', () => {
    expect(describeInstallRun({ enabled: true, installed: true, targets: ['windows-explorer'] }))
      .toBe('[folder-menu] installer run: written (windows-explorer)');
    expect(describeInstallRun({ enabled: false, installed: false, targets: [] }))
      .toBe('[folder-menu] installer run: not written (turned off in Options)');
    expect(describeInstallRun({ enabled: true, installed: false, targets: [], reason: 'error', error: 'reg.exe exit 1' }))
      .toBe('[folder-menu] installer run: not written (error — reg.exe exit 1)');
  });
});
