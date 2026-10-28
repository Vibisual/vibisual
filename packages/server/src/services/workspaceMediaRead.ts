import path from 'node:path';
import { isWorkspaceMediaFile } from '@vibisual/shared';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/** 읽기 판정 둘 — 라우트와 흘려 보내는 갈래가 같은 것을 쓴다. */
export interface WorkspaceMediaReadGuards {
  /** 이 루트가 열린 프로젝트 루트 안인가(`isWithinOpenableRoots`). */
  readonly isOpenableRoot: (resolvedRoot: string) => boolean;
  /** 이 절대경로가 지금 버블로 떠 있는 노드의 경로인가(`hasNodeAbsolutePath`). */
  readonly isBubblePath: (absPath: string) => boolean;
}

/**
 * §5.1 #2-1 (A) — 미디어 창구(`GET /api/workspace-media`) 읽기 경로 판정. 루트 밖은 그 파일이 지금 버블로 떠 있을 때만 연다 — 열기 라우트 셋의 `hasNodeAbsolutePath` 그대로(새 가드 ❌).
 * 화면에 없는 임의 경로는 막는다(페어링된 모바일도 닿는다). 해석은 `resolveWorkspacePath` 하나. 쓰기(PUT)는 이 판정을 쓰지 않는다 — 루트 안만.
 */
export function resolveWorkspaceMediaRead(
  root: string,
  relPath: string,
  deps: WorkspaceMediaReadGuards,
): { abs: string; rel: string } | null {
  const resolvedRoot = path.resolve(root);
  const resolved = resolveWorkspacePath(resolvedRoot, relPath);
  if (!resolved) return null;
  if (deps.isOpenableRoot(resolvedRoot) || deps.isBubblePath(resolved.abs)) return resolved;
  return null;
}

/**
 * §5.5 #17-27 ⑥ · §5.1 #2-1 (A) — 편집창 읽기(`GET /api/workspace-file`) 경로 판정, 미디어 창구와 같은 두 기준.
 * 루트 밖은 버블로 떠 있을 때만 `outside: true`(보기만). 쓰기(PUT)는 이 판정을 쓰지 않는다(루트 안만).
 */
export function resolveWorkspaceFileRead(
  root: string,
  relPath: string,
  deps: WorkspaceMediaReadGuards,
): { readonly outside: boolean } | null {
  const resolvedRoot = path.resolve(root);
  if (deps.isOpenableRoot(resolvedRoot)) return { outside: false };
  const resolved = resolveWorkspacePath(resolvedRoot, relPath);
  // 그 폴더 자신(`.` · 빈 경로)은 읽을 파일이 아니다 — 폴더 버블도 버블 경로라 여기서 먼저 거른다.
  if (!resolved || path.resolve(resolved.abs) === resolvedRoot) return null;
  return deps.isBubblePath(resolved.abs) ? { outside: true } : null;
}

/**
 * §5.13 40-1 — vibproxy 갈래(`vibproxy://proxy/api/workspace-media?root=&path=`)로 낼 파일. 라우트 판정 + 미디어 표 형식만(`isWorkspaceMediaFile`) —
 * 같은 출처 프리뷰도 닿는 길이라 코드·설정·키는 내지 않는다(표 밖은 IPC 길).
 */
export function resolveWorkspaceMediaStream(
  query: URLSearchParams,
  deps: WorkspaceMediaReadGuards,
): { abs: string; rel: string } | null {
  const root = query.get('root');
  const relPath = query.get('path');
  if (!root || !relPath) return null;
  const resolved = resolveWorkspaceMediaRead(root, relPath, deps);
  if (!resolved || resolved.rel === '' || !isWorkspaceMediaFile(resolved.abs)) return null;
  return resolved;
}

/** 서버가 떠 있는 동안의 판정(서버 상태를 물린 것). 뜨기 전·내린 뒤에는 없다 — 그때 흘려 보내는 갈래는 아무것도 내지 않는다. */
let liveGuards: WorkspaceMediaReadGuards | null = null;

/** 서버가 라우트를 세울 때 그 판정을 건다(라우트와 흘려 보내는 갈래가 같은 것을 쓰게). */
export function setWorkspaceMediaReadGuards(guards: WorkspaceMediaReadGuards | null): void {
  liveGuards = guards;
}

/** 데스크톱 main 의 vibproxy 미디어 갈래가 부른다 — 낼 파일의 절대경로, 못 내면 null. */
export function resolveWorkspaceMediaStreamFile(query: URLSearchParams): string | null {
  const guards = liveGuards;
  if (!guards) return null;
  return resolveWorkspaceMediaStream(query, guards)?.abs ?? null;
}
