import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  WORKSPACE_FILE_MAX_BYTES,
  WORKSPACE_IMAGE_MAX_BYTES,
  isWorkspaceImageBakeable,
  isWorkspaceImagePath,
  workspaceImageMime,
} from '@vibisual/shared';
import type { WorkspaceEol, WorkspaceFileContent, WorkspaceFileSaveResult } from '@vibisual/shared';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.5 #17-27 — 내장 편집창의 파일 한 개 읽기·쓰기. 가드는 탐색기의 `resolveWorkspacePath`(둘이면 어긋난 쪽이 구멍).
 * 사용자 소스라 §3.2.1 체크포인트 창구(원자적 쓰기·`.bak`)를 타지 않는다 — `mtimeMs` + 바이트 지문으로 외부 변경을 대조하고 같은 폴더 임시 파일로 교체한다.
 */

/** 이진 판정에 훑는 앞부분 길이(bytes) — NUL 이 이 안에 없으면 텍스트로 취급한다. */
const BINARY_SNIFF_BYTES = 8_000;

/** 저장 실패 사유 — 호출부가 HTTP 코드로 옮긴다. */
export type WorkspaceFileSaveError =
  | 'outside'
  | 'not-found'
  | 'conflict'
  | 'too-large'
  | 'readonly'
  | 'write-failed'
  /** §5.5 #17-25 ④-1 — 원본 형식으로 구울 수 없는 이미지(svg·gif·ico·bmp·avif)에 저장 시도. */
  | 'unsupported';

/** 디스크가 쓰기를 막는 오류 코드 — Perforce 체크아웃 전 파일·`attrib +r`·권한·읽기 전용 마운트. */
const READ_ONLY_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

/** 쓰기 비트(소유자 write) — 잠금 판정과 해제가 같은 한 비트를 본다. */
const OWNER_WRITE = 0o200;

function fileRevision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 원본을 먼저 잘라 쓰지 않는다. 같은 디렉터리에서 완성한 파일만 교체하고, 실패하면 원본을 보존한다. */
function replaceWorkspaceBytes(
  abs: string,
  bytes: Buffer,
  stat: fs.Stats,
  baseMtimeMs: number,
  baseRevision: string | undefined,
  clearReadOnly: boolean,
): { ok: true; stat: fs.Stats; revision: string } | { ok: false; error: 'conflict'; mtimeMs: number } {
  // 링크 자체를 파일로 바꾸지 않고, 공통 경로 가드가 검증한 대상 파일을 저장한다.
  const target = fs.realpathSync(abs);
  const originalRevision = fileRevision(fs.readFileSync(target));
  if (baseMtimeMs > 0 && baseRevision !== undefined && originalRevision !== baseRevision) {
    return { ok: false, error: 'conflict', mtimeMs: stat.mtimeMs };
  }
  if (clearReadOnly) clearReadOnlyBit(target, stat.mode);

  // POSIX rename은 대상 쓰기 권한 없이도 가능하므로, 기존 읽기 전용 보호를 먼저 확인한다.
  const writable = fs.openSync(target, 'r+');
  let mode: number;
  try { mode = fs.fstatSync(writable).mode; } finally { fs.closeSync(writable); }

  const temporary = path.join(path.dirname(target), `.vibisual-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, 'wx', mode);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fchmodSync(fd, mode); // umask로 실행 비트·기존 쓰기 권한이 달라지지 않게 한다.
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }

    // 준비 중 에이전트가 파일을 바꿨으면, 강제 저장 요청도 그 새 변경까지 덮지는 않는다.
    const latest = fs.statSync(target);
    if (latest.mtimeMs !== stat.mtimeMs || fileRevision(fs.readFileSync(target)) !== originalRevision) {
      return { ok: false, error: 'conflict', mtimeMs: latest.mtimeMs };
    }
    fs.renameSync(temporary, target);
    return { ok: true, stat: fs.statSync(target), revision: fileRevision(bytes) };
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* 교체 성공이면 임시 이름은 이미 없다. */ }
  }
}

function isPermissionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && READ_ONLY_ERROR_CODES.has(code);
}

/** §5.5 #17-27 ⑫ — 디스크 쪽 잠금인가. 윈도우 `W_OK` 는 읽기 전용 속성을 봐 Perforce 잠금이 잡힌다. ACL 은 못 재고, 그때는 저장이 `readonly` 로 답한다. */
export function isReadOnlyFile(abs: string): boolean {
  try {
    fs.accessSync(abs, fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

/** §5.5 #17-27 ⑫ — 읽기 전용 비트를 푼다. `p4 edit` 같은 버전 관리 명령은 돌리지 않는다(체크아웃은 사용자·에이전트 판단). */
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
    revision: fileRevision(buf),
    truncated,
    binary,
    // ⑭ 그림으로 열 자리인가 — 판정을 여기서 끝내 클라이언트가 두 값을 다시 조합하지 않게 한다.
    image: binary && isWorkspaceImagePath(resolved.rel),
    readOnly: isReadOnlyFile(resolved.abs),
    eol: detectEol(raw),
  };
}

/**
 * 덮어쓴다. `baseMtimeMs`(읽을 때 본 시각)와 디스크가 다르면 `conflict`, "그래도 저장"은 `baseMtimeMs <= 0`.
 * §5.5 #17-27 ⑫ — 잠긴 파일은 `readonly`, [읽기 전용 해제하고 저장] 이면 `clearReadOnly` 로 비트를 켜고 저장한다.
 */
export function writeWorkspaceFile(
  root: string,
  relPath: string,
  text: string,
  eol: WorkspaceEol,
  baseMtimeMs: number,
  limit: number = WORKSPACE_FILE_MAX_BYTES,
  clearReadOnly = false,
  baseRevision?: string,
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

  try {
    const saved = replaceWorkspaceBytes(resolved.abs, Buffer.from(body, 'utf8'), stat, baseMtimeMs, baseRevision, clearReadOnly);
    if (!saved.ok) return saved;
    const after = saved.stat;
    return {
      ok: true,
      result: {
        root: path.resolve(root),
        path: resolved.rel,
        size: after.size,
        mtimeMs: after.mtimeMs,
        revision: saved.revision,
        readOnly: isReadOnlyFile(resolved.abs),
      },
    };
  } catch (err) {
    // 잠금을 이미 풀어 본 뒤에도 막혔으면 우리가 할 수 있는 것은 끝났다 — 같은 버튼을 또 권하지 않는다.
    if (!clearReadOnly && isPermissionError(err)) return { ok: false, error: 'readonly' };
    return { ok: false, error: 'write-failed' };
  }
}

/**
 * §5.5 #17-27 ⑭ — 미리보기용 이미지 바이트. 상한(`WORKSPACE_IMAGE_MAX_BYTES`)이 달라 텍스트 창구와 가르고, 가드는 같은 `resolveWorkspacePath`.
 * 잘라 보내지 않는다 — 상한을 넘으면 null(화면은 `이진 파일 — 읽기 전용` 안내).
 */
export function readWorkspaceImage(
  root: string,
  relPath: string,
  limit: number = WORKSPACE_IMAGE_MAX_BYTES,
): { bytes: Buffer; mime: string; size: number; mtimeMs: number; revision: string } | null {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved || resolved.rel === '') return null;
  if (!isWorkspaceImagePath(resolved.rel)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.abs);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  if (stat.size > limit) return null;

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(resolved.abs);
  } catch {
    return null;
  }

  if (bytes.length > limit) return null;
  return { bytes, mime: workspaceImageMime(resolved.rel), size: bytes.length, mtimeMs: stat.mtimeMs, revision: fileRevision(bytes) };
}

/**
 * §5.5 #17-25 ④-1 — 주석을 구운 이미지로 덮어쓴다(mtime 대조는 텍스트와 같다). 줄바꿈·BOM 없이 바이트 그대로.
 * `canvas.toBlob` 이 못 굽는 확장자(svg·gif·ico·bmp·avif)는 `unsupported` — 조용히 PNG 를 쓰면 확장자·내용이 어긋난다.
 */
export function writeWorkspaceImage(
  root: string,
  relPath: string,
  bytes: Buffer,
  baseMtimeMs: number,
  limit: number = WORKSPACE_IMAGE_MAX_BYTES,
  baseRevision?: string,
): WorkspaceFileSaveOutcome {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved || resolved.rel === '') return { ok: false, error: 'outside' };
  if (!isWorkspaceImageBakeable(resolved.rel)) return { ok: false, error: 'unsupported' };
  if (bytes.length > limit) return { ok: false, error: 'too-large' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.abs);
    if (!stat.isFile()) return { ok: false, error: 'not-found' };
  } catch {
    return { ok: false, error: 'not-found' };
  }

  // 텍스트 저장과 같은 어림값 — 소수점 ms 반올림 차이는 같은 것으로 본다.
  if (baseMtimeMs > 0 && Math.abs(stat.mtimeMs - baseMtimeMs) > 1) {
    return { ok: false, error: 'conflict', mtimeMs: stat.mtimeMs };
  }

  try {
    const saved = replaceWorkspaceBytes(resolved.abs, bytes, stat, baseMtimeMs, baseRevision, false);
    if (!saved.ok) return saved;
    const after = saved.stat;
    return {
      ok: true,
      result: {
        root: path.resolve(root),
        path: resolved.rel,
        size: after.size,
        mtimeMs: after.mtimeMs,
        revision: saved.revision,
        readOnly: isReadOnlyFile(resolved.abs),
      },
    };
  } catch (err) {
    if (isPermissionError(err)) return { ok: false, error: 'readonly' };
    return { ok: false, error: 'write-failed' };
  }
}
