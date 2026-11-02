// §4 폴더 우클릭으로 프로젝트 열기 — OS 메뉴가 넘긴 폴더를 실행 인자에서 꺼낸다.
// 시작 진입점(bootstrap)이 정적으로 읽으므로 node 내장만 쓴다(`bootstrap.test.ts`).

import path from 'node:path';

export const FOLDER_OPEN_ARG = '--vibisual-open-folder';

/** Windows 설치기가 설치 끝에 한 번 부르는 등록 모드 — 잠금·창·서버 없이 메뉴만 적고 끝난다(`folderMenuInstall.ts`). */
export const FOLDER_MENU_REGISTER_ARG = '--vibisual-register-folder-menu';

export function isFolderMenuRegisterRun(argv: readonly string[]): boolean {
  return argv.includes(FOLDER_MENU_REGISTER_ARG);
}

/**
 * 두 꼴을 받는다. ① `--vibisual-open-folder=<경로>` — Windows 레지스트리·셸 스크립트. 한 토큰이라 순서가 바뀌어도 안 깨진다.
 * ② 맨 `--vibisual-open-folder` + 위치 인자 — Linux .desktop은 따옴표 안에 %f를 못 쓴다. Chromium이 두 번째 실행의 스위치를 재배치·삽입하므로 위치 인자 전부를 본다.
 * 절대경로만 돌려준다 — 폴더인지는 받는 쪽이 디스크로 확인한다.
 */
export function folderPathsFromArgv(argv: readonly string[], platform: NodeJS.Platform): string[] {
  const out: string[] = [];
  const add = (raw: string): void => {
    const p = normalizeFolderArg(raw, platform);
    if (p && !out.includes(p)) out.push(p);
  };
  let bare = false;
  // Windows 의 Chromium 은 스위치 이름을 소문자로 접는다 — 이름만 접어 비교하고 값은 원문 그대로 쓴다.
  for (const a of argv.slice(1)) {
    const lower = a.toLowerCase();
    if (lower.startsWith(`${FOLDER_OPEN_ARG}=`)) add(a.slice(FOLDER_OPEN_ARG.length + 1));
    else if (lower === FOLDER_OPEN_ARG) bare = true;
  }
  if (bare) {
    for (const a of argv.slice(1)) {
      if (!a.startsWith('-')) add(a);
    }
  }
  return out;
}

/** 따옴표·`file://` 주소·끝 구분자를 벗긴다. 절대경로가 아니면 null. */
export function normalizeFolderArg(raw: string, platform: NodeJS.Platform): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix;
  // `"C:\"` 는 CommandLineToArgvW 가 `\"` 를 따옴표로 읽어 `C:"` 로 온다(폴더 안 빈 곳 우클릭의 %V 가 드라이브 루트일 때).
  let s = raw.trim().replace(/^"+/, '').replace(/"+$/, '').trim();
  if (!s) return null;
  if (/^file:\/\//i.test(s)) {
    const fromUri = filePathFromUri(s, platform);
    if (!fromUri) return null;
    s = fromUri;
  }
  if (platform === 'win32') {
    s = s.replace(/\//g, '\\');
    if (/^[a-zA-Z]:$/.test(s)) s += '\\';
  }
  if (!p.isAbsolute(s)) return null;
  // `C:foo`(드라이브 상대)는 절대경로가 아니다 — isAbsolute 가 거른다.
  s = p.normalize(s);
  const root = p.parse(s).root;
  while (s.length > root.length && /[\\/]$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** `file:///srv/a/b` · `file:///C:/a` · `file://server/share/a`(Windows UNC). 그 밖의 호스트는 로컬이 아니다. */
function filePathFromUri(uri: string, platform: NodeJS.Platform): string | null {
  let u: URL;
  try { u = new URL(uri); } catch { return null; }
  let pathname: string;
  try { pathname = decodeURIComponent(u.pathname); } catch { return null; }
  const host = u.hostname && u.hostname !== 'localhost' ? u.hostname : '';
  if (platform === 'win32') {
    if (host) return `\\\\${host}${pathname.replace(/\//g, '\\')}`;
    return pathname.replace(/^\/([a-zA-Z]:)/, '$1');
  }
  return host ? null : pathname;
}
