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
 * §5.1 #2-1 (A) — 미디어 창구(`GET /api/workspace-media`) **읽기**의 경로 판정.
 *
 * 루트가 열린 프로젝트 안이면 종전 그대로다. 루트 밖이면 **그 파일 자체가 지금 버블로 떠 있는 노드의 경로**일 때만 연다 —
 * 열기 라우트 셋(`open-node-file`·`open-node-folder`·`open-external`)이 이미 쓰는 두 번째 기준(`hasNodeAbsolutePath`)
 * 그대로다(새 가드 발명 ❌). 종전에는 루트 밖을 통째로 막아, 에이전트가 프로젝트 밖에서 만든 그림이 캔버스에 떠 있어도
 * 미리보기도 그림 창도 비었다(2026-10-21 사용자 보고).
 *
 * - 화면에 없는 임의 절대경로는 그대로 막는다 — 페어링된 모바일 기기도 이 창구에 닿는다.
 * - 경로 해석은 탐색기·편집창과 같은 `resolveWorkspacePath` 하나다(`..` · 링크로 그 폴더 밖을 가리키면 null).
 * - **쓰기(PUT)는 이 판정을 쓰지 않는다** — 루트 안만 쓴다.
 *
 * 판정 둘을 인자로 받는 이유는 시험이다 — 라우트는 서버 상태(열린 프로젝트·그래프)를 물려 부른다.
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
 * §5.13 40-1 — 패키지 앱이 이 창구의 읽기를 **흘려 보내는 갈래**(`vibproxy://proxy/api/workspace-media?root=&path=`)로 받을 때
 * 낼 파일(절대경로). 판정은 위 라우트와 같은 한 벌이고, 하나를 더 본다 — **미디어 표에 있는 형식만**(`isWorkspaceMediaFile`).
 * 그 갈래는 같은 출처의 프리뷰 페이지도 닿는 길이라 코드·설정·키 파일은 내지 않는다(표 밖은 종전 IPC 길 — 화면도 같은 표로 가른다).
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
