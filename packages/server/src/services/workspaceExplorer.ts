import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import type { WorkspaceEntry, WorkspaceDirListing, WorkspacePathInfo, ExternalPathInfo } from '@vibisual/shared';
import { isWithinRoot } from './pathKey.js';

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

  // path traversal 방지 — 접을지 말지는 플랫폼이 정한다(win/mac 은 무시, linux 는 구분).
  //   예전에는 win32 만 접어 **mac 에서 케이스만 다른 정상 경로가 조용히 null** 이 됐다.
  if (!isWithinRoot(abs, rootAbs)) return null;

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
 * §5.5 #17-27 ⑬ (h) — Windows 에서 **누르면 그대로 도는** 확장자.
 *
 * `.msi`(설치 마법사)·`.ps1`(연결 프로그램이 편집기인 경우가 흔하다)은 일부러 뺐다 —
 * 본문의 경로를 눌렀을 때 벌어질 일이 사용자의 예상과 갈리는 것들이다.
 */
const WIN_EXECUTABLE_EXT = new Set(['.exe', '.com', '.bat', '.cmd']);

/**
 * POSIX 에서 **실행 비트가 서 있을 때만** 실행으로 볼 확장자(`''` = 확장자 없음).
 *
 * 실행 비트 하나만으로 판정하지 않는 이유는 트리마다 그 비트의 뜻이 다르기 때문이다 —
 * NTFS 마운트·`umask` 설정에 따라 저장소의 **모든 파일**이 `755` 로 보이는 트리가 흔하고,
 * 그러면 본문의 `App.tsx` 까지 실행 손잡이가 된다(⑬ (b) 가 막으려던 "가짜 손잡이" 가
 * 실행이라는 더 나쁜 형태로 돌아온다). 진짜 실행 파일은 POSIX 에서 확장자가 없거나 이 목록 안이다.
 */
const POSIX_EXECUTABLE_EXT = new Set(['', '.sh', '.command', '.appimage', '.bin', '.run']);

/** `fs.Stats` 중 이 판정에 필요한 부분만 — 테스트가 실제 파일 없이 표를 짤 수 있게. */
export interface ExecutableStatLike {
  isDirectory(): boolean;
  mode: number;
}

/**
 * §5.5 #17-27 ⑬ (h) — 이 경로를 **눌러서 실행할 수 있는가**.
 *
 * 화면이 아니라 여기서 정하는 이유는 규칙이 플랫폼마다 갈리기 때문이다 — 클라이언트가 글자 모양으로
 * 흉내 내면 같은 판정이 두 벌이 되고, 둘 중 하나는 반드시 뒤처진다(⑬ (b)(c) 와 같은 판단).
 * 참이면 화면은 편집창·탐색기 대신 #17-20 ④ 실행 세션으로 간다.
 */
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
      // (h) — 실행할 수 있는 것이면 화면은 열지 않고 **실행**으로 간다.
      executable: isExecutableWorkspacePath(resolved.abs, st),
    };
  } catch {
    // 없음·권한 없음·끊긴 링크 — 셋 다 "열 수 없다" 로 같다(호출부가 404 로 옮긴다).
    return null;
  }
}

/**
 * §5.5 #17-27 ⑬ (d) — 프로젝트 루트 **밖** 절대 경로 한 개의 정체를 잰다. 없으면 null.
 *
 * `statWorkspacePath` 와 갈라 둔 이유는 **답에 담기는 것이 다르기 때문**이다. 여기서 잰 경로가 갈 수 있는
 * 곳은 시스템 탐색기 하나뿐이라(⑬ (d)), `executable` 을 재지 않는다 — 재서 실어 보내면 화면이 "실행할 수
 * 있나" 를 묻게 되고, 그 순간 본문 글자로 임의 경로를 실행하는 길이 열린다. **재지 않는 것이 그 갈래를 막는
 * 방법**이다. 루트 검사도 하지 않는다(루트 밖인 것이 전제) — 대신 이 함수를 부르는 라우트가
 * loopback 화이트리스트 밖이라 **렌더러(사용자 창)만** 닿는다(§3.7).
 *
 * 상대 경로는 받지 않는다. 기준 없는 상대 경로는 서버의 cwd 를 뿌리로 삼아 엉뚱한 곳을 가리키므로,
 * 절대 경로가 아니면 그 자리에서 null 이다.
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
