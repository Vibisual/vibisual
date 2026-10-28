import type { WorkspaceEntry, WorkspaceEntryNameError, WorkspacePathKind } from '@vibisual/shared';
import { foldPathCase } from '../../utils/platform.js';
import type { WorkspaceMutateFailure } from './useWorkspaceExplorer.js';

/** §5.5 #17-19 — IDE 워크스페이스 탐색기의 순수 로직(트리 → 행 목록, 경로 가르기, 루트 기준 상대화). */

/** 탐색기에 실제로 그려지는 한 줄 — 엔트리 + 들여쓰기 깊이. */
export interface ExplorerRow {
  entry: WorkspaceEntry;
  /** 루트 자식 = 0 */
  depth: number;
}

/** 디렉터리 캐시 — key = 루트 기준 상대 경로('' = 루트 자신), value = 그 디렉터리의 자식들. */
export type ExplorerDirCache = Record<string, WorkspaceEntry[]>;

/** 펼침 상태대로 트리를 화면 순서의 행 목록으로 편다. 캐시에 없는 폴더는 자식 없음 — 로딩 표시는 뷰가 `expanded && !cache[relPath]` 로 한다(자리표시자 행 ❌). */
export function flattenExplorerRows(
  cache: ExplorerDirCache,
  expanded: ReadonlySet<string>,
  dirRelPath = '',
  depth = 0,
): ExplorerRow[] {
  const children = cache[dirRelPath];
  if (!children) return [];

  const rows: ExplorerRow[] = [];
  for (const entry of children) {
    rows.push({ entry, depth });
    if (entry.isDirectory && expanded.has(entry.relPath)) {
      rows.push(...flattenExplorerRows(cache, expanded, entry.relPath, depth + 1));
    }
  }
  return rows;
}

/**
 * 경로를 `{ dir, name }` 으로 가른다 — 목록에서 상위 폴더를 흐리게, 파일명을 또렷하게 그리기 위함.
 * 최상위 항목이면 `dir` 은 빈 문자열.
 */
export function splitRelPath(relPath: string): { dir: string; name: string } {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: normalized };
  return { dir: normalized.slice(0, idx), name: normalized.slice(idx + 1) };
}

/**
 * 절대 경로를 루트 기준 상대 경로로 되돌린다(Windows 대소문자·구분자 차이 흡수).
 * 루트 밖이면 절대 경로를 그대로 돌려준다 — 표시가 목적이라 숨기는 것보다 있는 그대로가 낫다.
 */
export function toRelativeFromRoot(absPath: string, root: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(absPath);
  const r = norm(root);
  if (r.length === 0) return a;
  // 케이스 접기는 플랫폼이 정한다(utils/platform.ts) — Linux 에서 접으면 이웃 폴더가 루트 안으로
  //   읽혀 엉뚱한 상대 경로가 나온다. 길이가 바뀌지 않는 foldPathCase 여야 아래 slice 가 맞다.
  const lowerA = foldPathCase(a);
  const lowerR = foldPathCase(r);
  if (lowerA === lowerR) return '';
  if (lowerA.startsWith(`${lowerR}/`)) return a.slice(r.length + 1);
  return a;
}

/**
 * 어떤 경로를 화면에 드러내기 위해 펼쳐야 하는 조상 폴더들.
 * `packages/client/src/App.tsx` → `['packages', 'packages/client', 'packages/client/src']`.
 */
export function ancestorDirs(relPath: string): string[] {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    result.push(parts.slice(0, i + 1).join('/'));
  }
  return result;
}

/** §5.5 #17-19 ③(c) — 치던 글 뒤에 경로를 붙인다(경로는 목적어 — 첫 낱말인 스킬 `insertSkill` 과 반대). 끝의 공백·줄바꿈은 그대로 둔다(`trimEnd` ❌ — 내린 줄이 사라진다). */
export function appendPathToInput(existing: string, path: string): string {
  if (!path) return existing;
  // 공백이 든 경로는 따옴표로 감싼다 — 안 감싸면 에이전트가 두 낱말로 읽는다(`Unreal Projects` 처럼
  // 공백 든 폴더는 win/mac 에 흔하다). OS 파일을 대화에 떨어뜨리는 길(`insertDroppedPaths`)이 이미
  // 쓰던 **같은 규칙**이다 — 한 입력창에 두 규칙이 있으면 그중 하나는 반드시 틀린 것으로 보인다.
  const token = /\s/.test(path) ? `"${path}"` : path;
  if (existing.length === 0) return `${token} `;
  return /\s$/.test(existing) ? `${existing}${token} ` : `${existing} ${token} `;
}

// ─── §5.5 #17-19 ⑦ 우클릭이 내는 쓰기 — 그 자리에서 치는 이름과 실패 문구 ───────────────

/** 지금 트리 안에서 이름을 치는 자리 — 새 창 대신 트리 한 행이 입력칸이 된다(VS Code 처럼, 만들 곳이 보이는 채로). */
export type ExplorerDraft =
  /** 있는 항목의 이름을 고친다 — 그 행이 통째로 입력칸이 된다. */
  | { mode: 'rename'; relPath: string; parent: string; initial: string; isDirectory: boolean }
  /** 새로 만든다 — `parent` 의 첫 자식 자리에 빈 입력칸 한 줄이 끼어든다('' = 루트). */
  | { mode: 'create'; parent: string; kind: WorkspacePathKind };

/** 이름 규칙 위반 → i18n 키. 규칙 자체는 shared(`workspaceEntryNameError`)가 쥔다. */
export function workspaceNameErrorKey(error: WorkspaceEntryNameError): string {
  switch (error) {
    case 'empty': return 'ide.explorer.ctx.err.nameEmpty';
    case 'separator': return 'ide.explorer.ctx.err.nameSeparator';
    case 'traversal': return 'ide.explorer.ctx.err.nameTraversal';
    case 'invalid-char': return 'ide.explorer.ctx.err.nameInvalidChar';
    case 'trailing': return 'ide.explorer.ctx.err.nameTrailing';
    case 'reserved': return 'ide.explorer.ctx.err.nameReserved';
    default: return 'ide.explorer.ctx.err.nameTooLong';
  }
}

/** 서버가 준 실패 사유 → i18n 키. 사유마다 사용자가 할 일이 다르므로 한 문구로 뭉개지 않는다. */
export function workspaceMutateErrorKey(error: WorkspaceMutateFailure): string {
  switch (error) {
    case 'exists': return 'ide.explorer.ctx.err.exists';
    case 'not-found': return 'ide.explorer.ctx.err.notFound';
    case 'denied': return 'ide.explorer.ctx.err.denied';
    case 'offline': return 'ide.explorer.ctx.err.offline';
    case 'root': return 'ide.explorer.ctx.err.root';
    case 'outside': return 'ide.explorer.ctx.err.outside';
    case 'invalid-name': return 'ide.explorer.ctx.err.nameInvalidChar';
    case 'into-self': return 'ide.explorer.ctx.err.intoSelf';
    case 'cross-device': return 'ide.explorer.ctx.err.crossDevice';
    default: return 'ide.explorer.ctx.err.failed';
  }
}
