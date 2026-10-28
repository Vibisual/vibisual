import fs from 'node:fs';
import path from 'node:path';
import { workspaceEntryNameError } from '@vibisual/shared';
import type {
  WorkspaceEntryDeleteResult,
  WorkspaceEntryResult,
  WorkspacePathKind,
} from '@vibisual/shared';
import { isWithinRoot, pathKey } from './pathKey.js';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.5 #17-19 ⑦⑧ — 탐색기의 네 디스크 변경. 가드는 `resolveWorkspacePath`, 이름 판정은 shared `workspaceEntryNameError`(화면과 한 벌 — 두 벌이면 구멍).
 * 모듈 상태는 실행 형태가 주입하는 휴지통 통로 하나다.
 */

/** 되돌릴 수 없는 쓰기라 사유를 좁게 나눈다 — 호출부가 HTTP 코드와 화면 문구로 옮긴다. */
export type WorkspaceMutateError =
  /** 루트 밖(`..`) 을 가리켰다 */
  | 'outside'
  /** 루트 자신을 바꾸거나 지우려 했다 — 탐색기가 서 있는 땅이다 */
  | 'root'
  /** 이름이 규칙에 맞지 않는다(사유는 shared 판정이 안다) */
  | 'invalid-name'
  /** 같은 이름이 이미 있다 */
  | 'exists'
  /** 대상이 없다(그 사이 밖에서 지워졌을 수 있다) */
  | 'not-found'
  /** 권한·잠금으로 디스크가 거절했다 */
  | 'denied'
  /** 폴더를 자기 자신(또는 자기 하위)으로 옮기려 했다 — 트리가 스스로를 삼킨다 */
  | 'into-self'
  /** 다른 볼륨이라 `rename` 이 안 된다(정션·심볼릭 링크로 물린 경우) */
  | 'cross-device'
  /** 그 밖의 실패 */
  | 'failed';

export type WorkspaceMutateOutcome<T> = { ok: true; result: T } | { ok: false; error: WorkspaceMutateError };

/**
 * 휴지통 통로 — Electron `shell.trashItem` 을 주입받는다(세 OS 휴지통 구현을 다시 만들지 않는다).
 * 주입이 없으면(브라우저 개발 서버) 영구 삭제이고 응답 `trashed: false` 로 알린다.
 */
export type WorkspaceTrashItem = (absPath: string) => Promise<void>;

let trashItem: WorkspaceTrashItem | null = null;

/** 실행 형태(데스크톱 main)가 부팅 때 한 번 꽂는다. `null` 을 주면 다시 영구 삭제로 돌아간다. */
export function setWorkspaceTrash(fn: WorkspaceTrashItem | null): void {
  trashItem = fn;
}

/** 지금 이 실행 형태가 휴지통을 쓸 수 있는가(화면이 되물음 문구를 고르는 데 쓴다). */
export function isWorkspaceTrashAvailable(): boolean {
  return trashItem !== null;
}

/** 권한·잠금으로 막힌 것인가 — 이 사유만 사용자가 손쓸 수 있는 것이라 따로 답한다. */
function isPermissionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EBUSY';
}

/** 부모 폴더 상대 경로('' = 루트). `a/b/c.ts` → `a/b`. */
function parentRelOf(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx < 0 ? '' : rel.slice(0, idx);
}

/** 새 파일·폴더(`parentRel` '' = 루트 바로 아래). 겹침 검사 뒤에도 실패 플래그(`wx`/`mkdir`)로 만든다 — 그 사이 생긴 같은 이름을 덮지 않고 `exists`. */
export function createWorkspaceEntry(
  root: string,
  parentRel: string,
  name: string,
  kind: WorkspacePathKind,
): WorkspaceMutateOutcome<WorkspaceEntryResult> {
  if (workspaceEntryNameError(name) !== null) return { ok: false, error: 'invalid-name' };

  const parent = resolveWorkspacePath(root, parentRel);
  if (!parent) return { ok: false, error: 'outside' };

  try {
    if (!fs.statSync(parent.abs).isDirectory()) return { ok: false, error: 'not-found' };
  } catch {
    return { ok: false, error: 'not-found' };
  }

  // 이름을 이어 붙인 뒤 **다시 한 번** 루트 안인지 본다 — 이름 판정이 구분자를 막지만,
  // 가드는 마지막 경로에 대해 서는 것이 옳다(판정이 느슨해져도 여기서 걸린다).
  const target = resolveWorkspacePath(root, parent.rel ? `${parent.rel}/${name}` : name);
  if (!target || target.rel === '') return { ok: false, error: 'outside' };
  if (fs.existsSync(target.abs)) return { ok: false, error: 'exists' };

  try {
    if (kind === 'directory') {
      fs.mkdirSync(target.abs);
    } else {
      // `wx` = 이미 있으면 실패(빈 파일을 덮어쓰지 않는다).
      fs.writeFileSync(target.abs, '', { flag: 'wx' });
    }
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'EEXIST') return { ok: false, error: 'exists' };
    if (isPermissionError(err)) return { ok: false, error: 'denied' };
    return { ok: false, error: 'failed' };
  }

  return {
    ok: true,
    result: {
      root: path.resolve(root),
      path: target.rel,
      parent: parent.rel,
      name,
      isDirectory: kind === 'directory',
    },
  };
}

/** 이름 바꾸기 — 같은 폴더 안에서만. 대소문자만 바꾸면 win/mac 에서 `existsSync` 가 참이라, `pathKey` 로 자기 자신인지 먼저 가른다. */
export function renameWorkspaceEntry(
  root: string,
  relPath: string,
  name: string,
): WorkspaceMutateOutcome<WorkspaceEntryResult> {
  if (workspaceEntryNameError(name) !== null) return { ok: false, error: 'invalid-name' };

  const from = resolveWorkspacePath(root, relPath);
  if (!from) return { ok: false, error: 'outside' };
  if (from.rel === '') return { ok: false, error: 'root' };

  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(from.abs).isDirectory();
  } catch {
    return { ok: false, error: 'not-found' };
  }

  const parentRel = parentRelOf(from.rel);
  const to = resolveWorkspacePath(root, parentRel ? `${parentRel}/${name}` : name);
  if (!to || to.rel === '') return { ok: false, error: 'outside' };

  const sameEntry = pathKey(to.abs) === pathKey(from.abs);
  if (!sameEntry && fs.existsSync(to.abs)) return { ok: false, error: 'exists' };
  // 이름이 한 글자도 안 바뀐 경우 — 디스크를 건드리지 않고 성공으로 답한다(rename 은 no-op 이다).
  if (to.abs === from.abs) {
    return { ok: true, result: { root: path.resolve(root), path: from.rel, parent: parentRel, name, isDirectory } };
  }

  try {
    fs.renameSync(from.abs, to.abs);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return { ok: false, error: 'not-found' };
    if (isPermissionError(err)) return { ok: false, error: 'denied' };
    return { ok: false, error: 'failed' };
  }

  return {
    ok: true,
    result: { root: path.resolve(root), path: to.rel, parent: parentRel, name, isDirectory },
  };
}

/**
 * 옮기기 — 사는 폴더만 바꾼다. ⓐ 제자리면 손대지 않고 성공 ⓑ 자기 하위로는 먼저 막는다(`renameSync` 오류가 win `EPERM`·linux `EINVAL` 로 갈린다)
 * ⓒ 목적지 겹침은 `exists`(`pathKey` 로 — 대소문자만 다른 이웃은 win/mac 에서 같은 파일).
 */
export function moveWorkspaceEntry(
  root: string,
  relPath: string,
  toDirRel: string,
): WorkspaceMutateOutcome<WorkspaceEntryResult> {
  const from = resolveWorkspacePath(root, relPath);
  if (!from) return { ok: false, error: 'outside' };
  if (from.rel === '') return { ok: false, error: 'root' };

  const toDir = resolveWorkspacePath(root, toDirRel);
  if (!toDir) return { ok: false, error: 'outside' };

  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(from.abs).isDirectory();
  } catch {
    return { ok: false, error: 'not-found' };
  }

  try {
    if (!fs.statSync(toDir.abs).isDirectory()) return { ok: false, error: 'not-found' };
  } catch {
    return { ok: false, error: 'not-found' };
  }

  // ⓑ 자기 자신(또는 자기 하위)으로는 못 간다. 판정은 루트 가드와 **같은 함수**(`isWithinRoot`)로 한다 —
  //    직접 접두사를 비교하면 이웃(`src` vs `srcery`)을 하위로 오인하고, 대소문자 접기도 손으로 정하게 된다.
  const fromKey = pathKey(from.abs);
  if (isDirectory && isWithinRoot(toDir.abs, from.abs)) return { ok: false, error: 'into-self' };

  const name = from.rel.slice(from.rel.lastIndexOf('/') + 1);
  const target = resolveWorkspacePath(root, toDir.rel ? `${toDir.rel}/${name}` : name);
  if (!target || target.rel === '') return { ok: false, error: 'outside' };

  // ⓐ 제자리 — 이미 그 폴더의 그 이름이다. 디스크를 건드리지 않는다.
  if (pathKey(target.abs) === fromKey) {
    return {
      ok: true,
      result: { root: path.resolve(root), path: from.rel, parent: parentRelOf(from.rel), name, isDirectory },
    };
  }

  // ⓒ 겹침 — 덮어쓰지 않는다(`fs.renameSync` 는 파일 위에 파일을 조용히 덮어쓴다).
  if (fs.existsSync(target.abs)) return { ok: false, error: 'exists' };

  try {
    fs.renameSync(from.abs, target.abs);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return { ok: false, error: 'not-found' };
    // 드라이브·마운트가 다르면 rename 이 안 된다 — 루트 안 이동이라 정상 경로에서는 나지 않지만,
    // 정션·심볼릭 링크로 다른 볼륨이 물려 있으면 실제로 난다. 사유를 뭉개지 않고 그대로 답한다.
    if (code === 'EXDEV') return { ok: false, error: 'cross-device' };
    if (isPermissionError(err)) return { ok: false, error: 'denied' };
    return { ok: false, error: 'failed' };
  }

  return {
    ok: true,
    result: { root: path.resolve(root), path: target.rel, parent: toDir.rel, name, isDirectory },
  };
}

/** 지운다 — 휴지통 통로가 있으면 그리로, 없으면 영구 삭제(`trashed` 로 알린다). 폴더는 `recursive`, 되물음은 화면 몫. */
export async function deleteWorkspaceEntry(
  root: string,
  relPath: string,
): Promise<WorkspaceMutateOutcome<WorkspaceEntryDeleteResult>> {
  const target = resolveWorkspacePath(root, relPath);
  if (!target) return { ok: false, error: 'outside' };
  if (target.rel === '') return { ok: false, error: 'root' };

  try {
    fs.lstatSync(target.abs);
  } catch {
    return { ok: false, error: 'not-found' };
  }

  const parent = parentRelOf(target.rel);
  const sink = trashItem;

  if (sink) {
    try {
      await sink(target.abs);
      return { ok: true, result: { root: path.resolve(root), path: target.rel, parent, trashed: true } };
    } catch (err) {
      // 휴지통이 거절했다고 **몰래 영구 삭제로 떨어지지 않는다** — 사용자가 고른 것은 되돌릴 수
      // 있는 삭제였다. 실패를 그대로 알리면 다시 시도할지 다른 방법을 쓸지는 사용자가 정한다.
      return { ok: false, error: isPermissionError(err) ? 'denied' : 'failed' };
    }
  }

  try {
    fs.rmSync(target.abs, { recursive: true, force: true });
  } catch (err) {
    if (isPermissionError(err)) return { ok: false, error: 'denied' };
    return { ok: false, error: 'failed' };
  }

  return { ok: true, result: { root: path.resolve(root), path: target.rel, parent, trashed: false } };
}
