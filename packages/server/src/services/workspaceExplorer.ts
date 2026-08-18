import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import type { WorkspaceEntry, WorkspaceDirListing, WorkspacePathInfo } from '@vibisual/shared';

/**
 * §5.5 #17-19 v4.71 — IDE 워크스페이스 탐색기의 디스크 조회.
 *
 * 이미 있는 `ProjectGraph.listFolderFiles`(§7.5 위성 선택용)를 쓰지 않는 이유는 세 가지다 —
 * 그쪽은 (a) 폴더를 **통째로 재귀**해 읽고(대형 저장소에서 수만~수십만 엔트리),
 * (b) 경로를 **소문자로 정규화**하며(위성 매칭 규약), (c) 숨김 폴더·`node_modules` 류를
 * **걸러 낸다**. 위성 토글에는 맞지만 "VS Code 처럼 보이는 탐색기"에는 셋 다 틀리다.
 *
 * 그래서 여기서는 **한 겹만**, **원본 대소문자 그대로**, **숨김 항목까지** 읽는다.
 * 상태를 갖지 않는 순수 조회라 클래스가 아니라 함수 하나로 둔다(서비스 클래스 규칙은
 * 상태를 가진 도메인에 대한 것이다).
 */

/** `relPath` 를 forward slash 로 정규화하고 앞뒤 구분자를 떨어낸다. */
function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * `root` 아래 `relPath`(디렉터리든 파일이든)를 해석한다. 루트를 벗어나면(`..` 등) null.
 * 반환값은 { abs: 절대경로, rel: 정규화된 상대경로 }.
 *
 * §5.5 #17-27 v4.87 — 내장 편집창(`workspaceFile.ts`)도 **이 가드 하나**를 그대로 쓴다
 * (탐색기와 편집창이 서로 다른 경로 검사를 갖는 순간 둘 중 하나는 반드시 뒤처진다).
 */
export function resolveWorkspacePath(root: string, relPath: string): { abs: string; rel: string } | null {
  const rootAbs = path.resolve(root);
  const rel = normalizeRel(relPath);
  const abs = rel ? path.resolve(rootAbs, rel) : rootAbs;

  // path traversal 방지 — 대소문자 무시 비교(Windows).
  const isWin = process.platform === 'win32';
  const a = isWin ? abs.toLowerCase() : abs;
  const r = isWin ? rootAbs.toLowerCase() : rootAbs;
  if (a !== r && !a.startsWith(r + path.sep)) return null;

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

/**
 * §5.5 #17-27 ⑬ — 경로 **한 개**의 정체(파일/폴더)를 잰다. 없거나 루트 밖이면 null.
 *
 * 스트림 본문에 적힌 경로가 진짜인지, 진짜라면 편집창으로 열지 탐색기로 열지 가르는 유일한 판정이다.
 * `listWorkspaceDir` 처럼 디렉터리를 **읽지 않는다** — 폴더 하나를 확인하려고 수만 엔트리를 걷는 것은
 * 본문에 경로가 여러 개 박힌 화면에서 그대로 비용이 된다. 심볼릭 링크는 `statSync` 가 대상까지 따라간다.
 */
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
    };
  } catch {
    // 없음·권한 없음·끊긴 링크 — 셋 다 "열 수 없다" 로 같다(호출부가 404 로 옮긴다).
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
