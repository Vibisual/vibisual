/**
 * §5.13 (V) 37-11 · (T-6) — **zip 리더**(우리가 쓴 것 — 새 의존성 0). Node 내장 `zlib` 의 `inflateRawSync` 로 deflate 를 풀고,
 * 저장(stored)도 받는다. 그 밖의 압축 방식·암호·분할 압축은 이유와 함께 거절한다.
 *
 * **zip slip 거절**: 이름이 절대 경로이거나(`/`·`\`·드라이브 문자) `..` 조각을 가지면 그 항목은 버린다 — 풀 자리 밖으로 쓰는 일이
 * 없게. 크기 상한(항목 하나·합계·개수)을 넘으면 거기서 멈춘다(압축 폭탄을 다 풀지 않는다).
 */
import zlib from 'node:zlib';

export interface ZipEntry {
  /** `/` 구분, 앞뒤 `/` 없음. 폴더 항목은 돌려주지 않는다. */
  readonly name: string;
  readonly data: Buffer;
}

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 2000, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 풀 자리 안에 머무는 안전한 이름인가(상대 · `..` 없음 · 빈 조각 없음). */
export function isSafeZipName(name: string): boolean {
  if (name === '' || name.includes('\0')) return false;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return false;
  const parts = n.split('/').filter((p) => p !== '');
  if (parts.length === 0) return false;
  return parts.every((p) => p !== '..' && p !== '.');
}

/** zip 바이트를 푼다. 실패하면 영문 이유로 던진다. */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  // 끝에서부터 중앙 디렉터리 끝 표지를 찾는다(주석이 붙어 있을 수 있다 — 최대 65535 + 22).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory).');
  const disk = buf.readUInt16LE(eocd + 4);
  if (disk !== 0) throw new Error('Multi-part zip files are not supported.');
  const count = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (cenOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported.');
  if (cenOffset + cenSize > buf.length) throw new Error('The zip file is truncated.');
  if (count > limits.maxEntries) throw new Error(`The zip file has too many entries (${count}).`);

  const out: ZipEntry[] = [];
  let total = 0;
  let p = cenOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new Error('The zip central directory is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    // 비트 11 = UTF-8 이름. 아니면 옛 코드 페이지라 라틴으로 읽는다(안전 검사는 그대로 걸린다).
    const name = ((flags & 0x800) !== 0 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 폴더
    if ((flags & 0x1) !== 0) throw new Error(`Encrypted zip entries are not supported (${name}).`);
    if (!isSafeZipName(name)) continue; // zip slip — 버린다
    if (size > limits.maxEntryBytes) throw new Error(`A zip entry is too large (${name}).`);
    total += size;
    if (total > limits.maxTotalBytes) throw new Error('The zip file expands beyond the size limit.');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`The zip entry header is damaged (${name}).`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes });
    else throw new Error(`Unsupported zip compression method ${method} (${name}).`);
    if (data.length !== size) throw new Error(`The zip entry size does not match (${name}).`);
    out.push({ name: name.split('/').filter((s) => s !== '').join('/'), data });
  }
  return out;
}
