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
 * §5.5 #17-19 ⑦⑧ — IDE 탐색기가 디스크에 내는 **네 가지 변경**(만들기 · 이름 바꾸기 · 삭제 · 옮기기).
 *
 * 조회(`workspaceExplorer.ts`)·파일 한 개 읽고 쓰기(`workspaceFile.ts`)와 같은 결로 갈라 둔 담당이다.
 * 경로 가드는 **새로 만들지 않는다** — 탐색기의 `resolveWorkspacePath` 를 그대로 쓴다(두 개의
 * 가드는 언젠가 서로 어긋나고, 어긋난 쪽이 곧 구멍이 된다). 이름 판정도 마찬가지로 화면과 같은
 * 순수 함수(`workspaceEntryNameError`, shared)를 쓴다.
 *
 * 상태 없는 함수 셋이라 클래스가 아니다(서비스 클래스 규칙은 상태를 가진 도메인의 것이다) —
 * 단 하나의 모듈 상태는 **휴지통 통로**(아래)이고, 그것은 실행 형태가 주입하는 능력이다.
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
 * 휴지통 통로 — **Electron 이 주입한다**(`shell.trashItem`). 세 OS 의 휴지통은 구현이 전부 다르고
 * (Windows 재활용, macOS `~/.Trash`, Linux `~/.local/share/Trash` freedesktop 규약), 그 차이를
 * 이미 옳게 다루는 물건이 있는데 우리가 다시 만들 이유가 없다(§멀티플랫폼 6축 — OS 기능).
 *
 * 주입이 없는 실행 형태(브라우저에서 띄운 개발 서버)에서는 영구 삭제로 떨어지고, 그 사실은
 * 응답의 `trashed: false` 로 화면까지 전해진다 — 되돌릴 수 있는지 없는지를 숨기지 않는다.
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

/**
 * 새 파일·폴더를 만든다. `parentRel` 은 **부모 폴더**('' = 루트 바로 아래), `name` 은 이름 한 조각이다.
 *
 * 겹침 검사는 `existsSync` 로 한 번 보고, 실제 만들기도 **실패하는 플래그**(`wx`/`mkdir`)로 낸다 —
 * 검사와 쓰기 사이에 밖에서 같은 이름이 생기면 조용히 덮어쓰는 대신 `exists` 로 답해야 한다.
 */
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

/**
 * 이름을 바꾼다 — **같은 폴더 안에서만**(옮기기 ❌ — 그건 다른 기능이고, 다른 되물음이 필요하다).
 *
 * 대소문자만 바꾸는 이름 변경(`Foo.ts` → `foo.ts`)은 Windows·macOS 에서 `existsSync` 가 참이라
 * 겹침으로 오판된다. 그래서 겹침 검사는 경로 문자열이 아니라 **플랫폼이 정한 경로 키**(`pathKey`)로
 * 자기 자신인지 먼저 가른다.
 */
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
 * 옮긴다 — **이름은 그대로 두고 사는 폴더만 바꾼다**(이름 바꾸기와 갈라 둔 이유는 위 주석 그대로다:
 * 다른 되물음이 필요한 다른 기능이다).
 *
 * 막아야 하는 세 가지가 있고, 셋 다 사용자가 손으로 끌다 자연스럽게 만드는 상황이다.
 *  ⓐ **제자리** — 이미 그 폴더에 살고 있으면 디스크를 건드리지 않고 성공으로 답한다(rename no-op 과 같은 결).
 *  ⓑ **자기 자신 안으로** — 폴더를 자기 하위로 옮기면 트리가 스스로를 삼킨다. `fs.renameSync` 는
 *     플랫폼마다 다른 오류를 내므로(win `EPERM`·linux `EINVAL`) **우리가 먼저** 판정한다.
 *  ⓒ **겹침** — 목적지에 같은 이름이 이미 있으면 덮어쓰지 않고 `exists` 로 답한다. 검사는 경로 문자열이
 *     아니라 플랫폼이 정한 경로 키(`pathKey`)로 — 대소문자만 다른 이웃은 win/mac 에서 같은 파일이다.
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

/**
 * 지운다. 휴지통 통로가 꽂혀 있으면 그리로 보내고(되돌릴 수 있다), 없으면 영구 삭제한다 —
 * 어느 쪽이었는지는 `trashed` 로 그대로 알린다.
 *
 * 폴더는 안의 것까지 함께 사라진다(`recursive`). 되물음은 화면의 몫이고 여기서는 시키는 대로 한다.
 */
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
