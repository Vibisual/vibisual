import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import type { WorkspaceEntry, WorkspaceDirListing, WorkspacePathInfo, ExternalPathInfo } from '@vibisual/shared';
import { isWithinRoot } from './pathKey.js';
import { resolvePathWithLinks } from './pathValidator.js';

/**
 * §5.5 #17-19 — IDE 탐색기의 디스크 조회. `listFolderFiles`(§7.5 위성용)는 통째 재귀·소문자 접기·숨김 거르기라 쓰지 않는다.
 * 한 겹만, 원본 대소문자 그대로, 숨김 항목까지 읽는다.
 */

/** `relPath` 를 forward slash 로 정규화하고 앞뒤 구분자를 떨어낸다. */
function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * `root` 아래 `relPath` 를 `{ abs, rel }` 로. 루트를 벗어나면 null.
 * §5.5 #17-27 — 내장 편집창(`workspaceFile.ts`)도 이 가드 하나를 쓴다(두 벌이면 하나는 뒤처진다).
 */
export function resolveWorkspacePath(root: string, relPath: string): { abs: string; rel: string } | null {
  const rootAbs = path.resolve(root);
  const rel = normalizeRel(relPath);
  const abs = rel ? path.resolve(rootAbs, rel) : rootAbs;

  // path traversal 방지 — 대소문자 접기는 플랫폼이 정한다(win/mac 무시, linux 구분). win32 만 접으면 mac 의 정상 경로가 null 이 된다.
  if (!isWithinRoot(abs, rootAbs)) return null;

  // A project-local link may point into another project. Resolve both sides so linked
  // project roots (including macOS /tmp) remain valid, and inspect missing parents too.
  const realRoot = resolvePathWithLinks(rootAbs);
  const realAbs = resolvePathWithLinks(abs);
  if (!realRoot || !realAbs || !isWithinRoot(realAbs, realRoot)) return null;

  return { abs, rel };
}

/** dirent 가 디렉터리인지 — 심볼릭 링크는 대상까지 따라가 판정(실패하면 파일 취급). */
function isDirEntry(dirent: fs.Dirent, absPath: string): boolean {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** §5.5 #17-27 ⑬ (h) — Windows 에서 누르면 도는 확장자. `.msi`·`.ps1` 은 뺐다(설치 마법사·편집기 연결이 흔해 결과가 예상과 갈린다). */
const WIN_EXECUTABLE_EXT = new Set(['.exe', '.com', '.bat', '.cmd']);

/** POSIX 에서 실행 비트가 있을 때만 실행으로 볼 확장자(`''` = 없음). 비트만 보지 않는다 — NTFS 마운트·`umask` 로 모든 파일이 `755` 인 트리가 흔하다. */
const POSIX_EXECUTABLE_EXT = new Set(['', '.sh', '.command', '.appimage', '.bin', '.run']);

/** `fs.Stats` 중 이 판정에 필요한 부분만 — 테스트가 실제 파일 없이 표를 짤 수 있게. */
export interface ExecutableStatLike {
  isDirectory(): boolean;
  mode: number;
}

/** §5.5 #17-27 ⑬ (h) — 눌러서 실행할 수 있는가. 플랫폼마다 규칙이 갈려 서버가 정한다(클라 흉내는 판정 두 벌 — ⑬ (b)(c)). 참이면 #17-20 ④ 실행 세션으로 간다. */
export function isExecutableWorkspacePath(
  absPath: string,
  st: ExecutableStatLike,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const ext = path.extname(absPath).toLowerCase();
  if (platform === 'win32') return !st.isDirectory() && WIN_EXECUTABLE_EXT.has(ext);
  // macOS 앱 번들은 폴더지만 실행이다 — `open` 이 받는 단위가 바로 이 폴더다.
  if (st.isDirectory()) return platform === 'darwin' && ext === '.app';
  if ((st.mode & 0o111) === 0) return false;
  return POSIX_EXECUTABLE_EXT.has(ext);
}

/** §5.5 #17-27 ⑬ — 경로 한 개의 정체(파일/폴더), 없거나 루트 밖이면 null. 디렉터리를 읽지 않는다(경로가 많은 본문에서 비용이 된다). */
export function statWorkspacePath(root: string, relPath: string): WorkspacePathInfo | null {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved) return null;

  try {
    const st = fs.statSync(resolved.abs);
    return {
      root: path.resolve(root),
      path: resolved.rel,
      absPath: resolved.abs,
      kind: st.isDirectory() ? 'directory' : 'file',
      // (h) — 실행할 수 있는 것이면 화면은 열지 않고 **실행**으로 간다.
      executable: isExecutableWorkspacePath(resolved.abs, st),
    };
  } catch {
    // 없음·권한 없음·끊긴 링크 — 셋 다 "열 수 없다" 로 같다(호출부가 404 로 옮긴다).
    return null;
  }
}

/**
 * §5.5 #17-27 ⑬ (d) — 루트 밖 절대 경로 한 개의 정체(없으면 null). `executable` 을 재지 않는다 — 실어 보내면 본문 글자로 임의 경로를 실행하는 길이 열린다.
 * 루트 검사 없음(루트 밖이 전제) — 라우트가 loopback 화이트리스트 밖이라 렌더러만 닿는다(§3.7). 상대 경로는 null(서버 cwd 기준으로 엉뚱한 곳을 가리킨다).
 */
export function statExternalPath(absPath: string): ExternalPathInfo | null {
  if (!path.isAbsolute(absPath)) return null;
  const resolved = path.resolve(absPath);

  try {
    const st = fs.statSync(resolved);
    return { absPath: resolved, kind: st.isDirectory() ? 'directory' : 'file' };
  } catch {
    return null;
  }
}

/**
 * 디렉터리 한 겹을 읽어 반환. 폴더 먼저·이름순(대소문자 무시) 정렬.
 * 루트 밖이거나 디렉터리가 아니면 null(호출부가 404/403 으로 옮긴다).
 */
export function listWorkspaceDir(
  root: string,
  relPath: string,
  limit: number = WORKSPACE_DIR_ENTRY_MAX,
): WorkspaceDirListing | null {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved) return null;

  try {
    if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isDirectory()) return null;
  } catch {
    return null;
  }

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(resolved.abs, { withFileTypes: true });
  } catch {
    return null;
  }

  const entries: WorkspaceEntry[] = [];
  for (const dirent of dirents) {
    const abs = path.join(resolved.abs, dirent.name);
    const isDirectory = isDirEntry(dirent, abs);
    const entry: WorkspaceEntry = {
      name: dirent.name,
      relPath: resolved.rel ? `${resolved.rel}/${dirent.name}` : dirent.name,
      isDirectory,
    };
    if (!isDirectory) {
      // stat 실패(끊긴 링크·권한)는 크기/시각만 비우고 항목 자체는 남긴다 — 디스크에 있는 건 보여 준다.
      try {
        const st = fs.statSync(abs);
        entry.size = st.size;
        entry.mtimeMs = st.mtimeMs;
        // (R-7) — 탐색기에서 누른 것과 본문에서 누른 것이 같은 곳으로 가야 한다(같은 판정 함수).
        if (isExecutableWorkspacePath(abs, st)) entry.executable = true;
      } catch { /* 크기·시각 없이 표시 */ }
    }
    entries.push(entry);
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const truncated = entries.length > limit;
  return {
    root: path.resolve(root),
    path: resolved.rel,
    entries: truncated ? entries.slice(0, limit) : entries,
    truncated,
  };
}
