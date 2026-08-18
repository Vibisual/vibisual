import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_FILE_MAX_BYTES } from '@vibisual/shared';
import type { WorkspaceEol, WorkspaceFileContent, WorkspaceFileSaveResult } from '@vibisual/shared';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.5 #17-27 v4.87 — IDE 내장 편집창의 디스크 창구(파일 한 개 읽기·쓰기).
 *
 * 탐색기(`workspaceExplorer.ts`)가 "폴더 한 겹"을 담당하듯 여기는 "파일 한 개"만 담당한다.
 * 경로 가드는 새로 만들지 않고 탐색기의 `resolveWorkspacePath` 를 그대로 쓴다 — 두 개의 가드는
 * 언젠가 서로 어긋나고, 어긋난 쪽이 곧 구멍이 된다.
 *
 * 여기서 쓰는 파일은 **사용자의 소스 파일**이라 §3.2.1 체크포인트 창구(원자적 쓰기·백업)를 타지 않는다 —
 * 그 인프라는 우리가 소유한 상태 파일을 위한 것이고, 남의 파일에 `.bak` 을 흩뿌릴 자리가 아니다.
 * 대신 덮어쓰기 사고는 `mtimeMs` 대조(= 읽은 뒤 디스크가 바뀌었으면 거절)로 막는다.
 *
 * 상태 없는 순수 조회/쓰기라 클래스가 아니라 함수 둘로 둔다.
 */

/** 이진 판정에 훑는 앞부분 길이(bytes) — NUL 이 이 안에 없으면 텍스트로 취급한다. */
const BINARY_SNIFF_BYTES = 8_000;

/** 저장 실패 사유 — 호출부가 HTTP 코드로 옮긴다. */
export type WorkspaceFileSaveError = 'outside' | 'not-found' | 'conflict' | 'too-large' | 'readonly' | 'write-failed';

/** 디스크가 쓰기를 막는 오류 코드 — Perforce 체크아웃 전 파일·`attrib +r`·권한·읽기 전용 마운트. */
const READ_ONLY_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

/** 쓰기 비트(소유자 write) — 잠금 판정과 해제가 같은 한 비트를 본다. */
const OWNER_WRITE = 0o200;

function isPermissionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && READ_ONLY_ERROR_CODES.has(code);
}

/**
 * §5.5 #17-27 ⑫ — 이 파일이 **디스크 쪽에서 잠겨 있는가**(파일은 있는데 쓸 수 없음).
 *
 * 윈도우에서 `W_OK` 는 읽기 전용 속성(`FILE_ATTRIBUTE_READONLY`)을 보므로 Perforce 가 걸어 둔 잠금이
 * 그대로 잡힌다. ACL 까지는 못 재지만, 못 잰 경우는 저장 시도가 `readonly` 로 갈라 답한다.
 */
export function isReadOnlyFile(abs: string): boolean {
  try {
    fs.accessSync(abs, fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

/**
 * §5.5 #17-27 ⑫ — 읽기 전용 잠금을 푼다(쓰기 비트를 켠다). 성공 여부만 돌려준다.
 *
 * 버전 관리 명령(`p4 edit` 등)은 **실행하지 않는다** — 우리 권한은 파일 속성 한 비트까지이고,
 * 체크아웃 여부는 사용자·에이전트의 판단이다.
 */
function clearReadOnlyBit(abs: string, mode: number): boolean {
  try {
    fs.chmodSync(abs, mode | OWNER_WRITE);
    return true;
  } catch {
    return false;
  }
}

export type WorkspaceFileSaveOutcome =
  | { ok: true; result: WorkspaceFileSaveResult }
  | { ok: false; error: WorkspaceFileSaveError; mtimeMs?: number };

/** 버퍼 앞부분에 NUL 바이트가 있으면 이진 파일로 본다(에디터·git 이 쓰는 것과 같은 어림값). */
function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** 원본 줄바꿈 판정 — `\r\n` 이 하나라도 있으면 crlf(윈도우 파일을 lf 로 바꿔 저장하지 않기 위함). */
export function detectEol(text: string): WorkspaceEol {
  return text.includes('\r\n') ? 'crlf' : 'lf';
}

/** 편집창에 넘길 형태로 정규화 — 줄바꿈은 항상 `\n`, BOM 은 떼어 낸다(저장 시 다시 붙이지 않는다). */
function normalizeText(raw: string): string {
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return noBom.replace(/\r\n/g, '\n');
}

/**
 * `root` 아래 `relPath` 파일 한 개를 읽는다. 루트 밖이거나 파일이 아니면 null(호출부가 403/404 로 옮긴다).
 *
 * 상한을 넘으면 **앞부분만** 담고 `truncated: true` 로 알린다 — 열어서 볼 수는 있게 하되
 * 저장은 막는다(클라이언트가 읽기 전용으로 연다).
 */
export function readWorkspaceFile(
  root: string,
  relPath: string,
  limit: number = WORKSPACE_FILE_MAX_BYTES,
): WorkspaceFileContent | null {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved || resolved.rel === '') return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.abs);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(resolved.abs);
  } catch {
    return null;
  }

  const truncated = buf.length > limit;
  const slice = truncated ? buf.subarray(0, limit) : buf;
  const binary = looksBinary(slice);
  const raw = binary ? '' : slice.toString('utf8');

  return {
    root: path.resolve(root),
    path: resolved.rel,
    text: binary ? '' : normalizeText(raw),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    truncated,
    binary,
    readOnly: isReadOnlyFile(resolved.abs),
    eol: detectEol(raw),
  };
}

/**
 * 파일을 덮어쓴다. `baseMtimeMs` 는 **클라이언트가 읽을 때 본 수정 시각**이라,
 * 그 사이 디스크가 바뀌었으면(에이전트가 같은 파일을 고쳤을 때가 바로 이 경우다) `conflict` 로 거절한다.
 * 사용자가 화면에서 "그래도 저장" 을 고르면 `baseMtimeMs <= 0` 으로 다시 보내 대조를 건너뛴다.
 *
 * §5.5 #17-27 ⑫ — 디스크가 잠근 파일(Perforce 체크아웃 전 파일 등)은 `readonly` 로 갈라 답하고,
 * 사용자가 [읽기 전용 해제하고 저장] 을 고르면 `clearReadOnly` 로 다시 와 쓰기 비트를 켠 뒤 저장한다.
 */
export function writeWorkspaceFile(
  root: string,
  relPath: string,
  text: string,
  eol: WorkspaceEol,
  baseMtimeMs: number,
  limit: number = WORKSPACE_FILE_MAX_BYTES,
  clearReadOnly = false,
): WorkspaceFileSaveOutcome {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved || resolved.rel === '') return { ok: false, error: 'outside' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.abs);
    if (!stat.isFile()) return { ok: false, error: 'not-found' };
  } catch {
    return { ok: false, error: 'not-found' };
  }

  // 소수점 ms 는 파일시스템마다 반올림이 달라, 1ms 이내 차이는 같은 것으로 본다.
  if (baseMtimeMs > 0 && Math.abs(stat.mtimeMs - baseMtimeMs) > 1) {
    return { ok: false, error: 'conflict', mtimeMs: stat.mtimeMs };
  }

  const body = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  if (Buffer.byteLength(body, 'utf8') > limit) return { ok: false, error: 'too-large' };

  // ⑫ 잠긴 파일 — 사용자가 풀라고 했을 때만 쓰기 비트를 켠다(되돌려 걸지 않는다).
  if (clearReadOnly) clearReadOnlyBit(resolved.abs, stat.mode);

  try {
    fs.writeFileSync(resolved.abs, body, 'utf8');
    const after = fs.statSync(resolved.abs);
    return {
      ok: true,
      result: {
        root: path.resolve(root),
        path: resolved.rel,
        size: after.size,
        mtimeMs: after.mtimeMs,
        readOnly: isReadOnlyFile(resolved.abs),
      },
    };
  } catch (err) {
    // 잠금을 이미 풀어 본 뒤에도 막혔으면 우리가 할 수 있는 것은 끝났다 — 같은 버튼을 또 권하지 않는다.
    if (!clearReadOnly && isPermissionError(err)) return { ok: false, error: 'readonly' };
    return { ok: false, error: 'write-failed' };
  }
}
