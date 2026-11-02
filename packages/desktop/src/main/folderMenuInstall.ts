// §4 폴더 우클릭으로 프로젝트 열기 — Windows 설치기가 설치 끝에 부르는 등록 모드(`--vibisual-register-folder-menu`).
// 재설치는 옛 제거기가 메뉴를 걷고 시작해, 새 앱이 다 켜질 때까지 메뉴가 비어 있었다 — 설치하는 그 자리에서 다시 적는다.
// 켬/끔·메뉴 글자는 켜진 앱과 같은 값(user-defaults.json)을 따르고, 적는 일은 `applyFolderContextMenu` 한 곳이 한다.

import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { isFolderContextMenuEnabled } from '@vibisual/shared';
import type { FolderContextMenuStatus, UserDefaults } from '@vibisual/shared';
import { applyFolderContextMenu, folderMenuExePath, nodeFolderMenuIo, VIBISUAL_BUNDLE_ID } from './folderContextMenu';
import { readSplashCache } from './splashCache';
import { resolveSplashLocale } from './splashPolicy';
import { isSplashLocale } from './splashStrings';
import { mainStrings } from './strings';

/** 서버 `userDefaultsService` 와 같은 자리. */
export function userDefaultsFile(home: string): string {
  return path.join(home, '.vibisual', 'user-defaults.json');
}

/** 없거나 깨졌으면 null — 그때는 기본값(켬)으로 적는다. */
export function readUserDefaultsFile(file: string): UserDefaults | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as UserDefaults : null;
  } catch {
    return null;
  }
}

/** 메뉴 글자의 언어 — 설정한 UI 언어 → 지난 실행의 화면 언어(스플래시 캐시) → OS 언어 → `en`. */
export function folderMenuLocale(saved: unknown, cached: string | null | undefined, osLocale: string): string {
  return resolveSplashLocale(isSplashLocale(saved) ? saved : cached, osLocale);
}

export async function registerFolderMenuAtInstall(): Promise<FolderContextMenuStatus> {
  const home = homedir();
  const defaults = readUserDefaultsFile(userDefaultsFile(home));
  const locale = folderMenuLocale(defaults?.appearance?.uiLocale, readSplashCache()?.locale, app.getLocale());
  return applyFolderContextMenu({
    platform: process.platform,
    enabled: isFolderContextMenuEnabled(defaults),
    packaged: app.isPackaged,
    label: mainStrings(locale).folderContextMenuLabel,
    exePath: folderMenuExePath(process.platform, process.env, process.execPath),
    home,
    env: process.env,
    tmpDir: tmpdir(),
    bundleId: VIBISUAL_BUNDLE_ID,
    io: nodeFolderMenuIo(process.env),
  });
}

/** crash.log 한 줄 — 설치기는 결과를 버리므로 여기 남은 것이 유일한 흔적이다. */
export function describeInstallRun(status: FolderContextMenuStatus): string {
  if (status.installed) return `[folder-menu] installer run: written (${status.targets.join(', ')})`;
  const why = status.reason ?? (status.enabled ? 'unknown' : 'turned off in Options');
  return `[folder-menu] installer run: not written (${why}${status.error ? ` — ${status.error}` : ''})`;
}
