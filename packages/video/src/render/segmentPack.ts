/**
 * §5.13 (E-3)(E-9) 구간 조각의 본문 모양과 검사(순수 — 브라우저·Node 공통).
 * 본문 = [머리 길이 u32 LE][머리 글 JSON][패킷 바이트를 이은 것]. 서버의 머리(표식 + 본문 SHA-256)는 이 바깥이다.
 */

import { stableStringify } from '../hashItem.js';

/** 구간 안 패킷 하나(디코드 순서로 보관한다). `frame` = 구간 안 프레임 번호 — 파일 시각은 붙일 때 정수로 계산한다. */
export interface SegmentPacket {
  readonly frame: number;
  readonly key: boolean;
  readonly data: Uint8Array;
  /** 투명 배경의 알파 곁 데이터(없으면 null). */
  readonly alpha: Uint8Array | null;
}

export interface EncodedSegment {
  readonly frames: number;
  /** 디코더 설정 글(`decoderConfigText`) — 잇기 기준. */
  readonly decoder: string;
  readonly packets: readonly SegmentPacket[];
}

const PACK_VERSION = 1;
const HEAD_LENGTH_BYTES = 4;
/** 머리 글 상한 — 2초 구간의 패킷 표는 수 KB 다. 넘으면 깨진 것으로 본다. */
const HEAD_MAX_BYTES = 4 * 1024 * 1024;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function viewBytes(source: unknown): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return null;
}

/** 엔진 객체(`VideoColorSpace` 등)는 열거 칸이 없다 — `toJSON` 이 있으면 그것으로 편다. */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const bytes = viewBytes(value);
  if (bytes) return { hex: toHex(bytes) };
  if (Array.isArray(value)) return value.map(plain);
  const json = (value as { toJSON?: unknown }).toJSON;
  const source = typeof json === 'function' ? (json as () => unknown).call(value) : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) out[k] = plain(v);
  return out;
}

/** 디코더 설정을 글로(칸을 정렬해 — 바이트로 같은 설정이면 같은 글). 서술 바이트는 16진수. */
export function decoderConfigText(config: object): string {
  return stableStringify(plain(config));
}

/** 글 → 디코더 설정(서술 바이트를 되살린다). 글이 아니면 null. */
export function decoderConfigFromText(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const hex = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { hex?: unknown }).hex : undefined;
    if (typeof hex === 'string' && Object.keys(v as object).length === 1) {
      const bytes = fromHex(hex);
      if (!bytes) return null;
      out[k] = bytes;
    } else {
      out[k] = v;
    }
  }
  return typeof out['codec'] === 'string' ? out : null;
}

export function packSegment(segment: EncodedSegment): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({
    v: PACK_VERSION,
    frames: segment.frames,
    decoder: segment.decoder,
    packets: segment.packets.map((p) => [p.frame, p.key ? 1 : 0, p.data.byteLength, p.alpha ? p.alpha.byteLength : -1]),
  }));
  let size = HEAD_LENGTH_BYTES + head.byteLength;
  for (const p of segment.packets) size += p.data.byteLength + (p.alpha?.byteLength ?? 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, head.byteLength, true);
  out.set(head, HEAD_LENGTH_BYTES);
  let at = HEAD_LENGTH_BYTES + head.byteLength;
  for (const p of segment.packets) {
    out.set(p.data, at);
    at += p.data.byteLength;
    if (p.alpha) { out.set(p.alpha, at); at += p.alpha.byteLength; }
  }
  return out;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** 본문 → 구간. 길이·머리·표가 하나라도 어긋나면 null(깨진 조각 — 다시 굽는다). */
export function unpackSegment(bytes: Uint8Array): EncodedSegment | null {
  if (bytes.byteLength < HEAD_LENGTH_BYTES) return null;
  const headLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (headLength === 0 || headLength > HEAD_MAX_BYTES || HEAD_LENGTH_BYTES + headLength > bytes.byteLength) return null;
  let head: unknown;
  try {
    head = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEAD_LENGTH_BYTES, HEAD_LENGTH_BYTES + headLength)));
  } catch {
    return null;
  }
  if (head === null || typeof head !== 'object') return null;
  const h = head as { v?: unknown; frames?: unknown; decoder?: unknown; packets?: unknown };
  const frames = count(h.frames);
  if (h.v !== PACK_VERSION || frames === null || typeof h.decoder !== 'string' || !Array.isArray(h.packets)) return null;
  const packets: SegmentPacket[] = [];
  let at = HEAD_LENGTH_BYTES + headLength;
  for (const row of h.packets) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const frame = count(row[0]);
    const size = count(row[2]);
    const alphaSize = row[3] === -1 ? -1 : count(row[3]);
    if (frame === null || size === null || alphaSize === null || (row[1] !== 0 && row[1] !== 1)) return null;
    if (at + size + Math.max(0, alphaSize) > bytes.byteLength) return null;
    const data = bytes.subarray(at, at + size);
    at += size;
    const alpha = alphaSize < 0 ? null : bytes.subarray(at, at + alphaSize);
    at += Math.max(0, alphaSize);
    packets.push({ frame, key: row[1] === 1, data, alpha });
  }
  // 남는 바이트가 있으면 표와 본문이 어긋난 것이다.
  if (at !== bytes.byteLength) return null;
  return { frames, decoder: h.decoder, packets };
}

/**
 * 이을 수 없는 까닭(이을 수 있으면 null) — (E-5) ②③. 프레임을 전부 요구하지는 않는다(인코더가 떨군 프레임은 한 번에 구워도 빈다).
 * @param frames 이 구간이 가져야 할 프레임 수 · @param decoder 이번 렌더의 디코더 설정 글
 */
export function segmentProblem(segment: EncodedSegment, frames: number, decoder: string): string | null {
  if (segment.frames !== frames) return 'frames';
  if (segment.decoder !== decoder) return 'decoder';
  const first = segment.packets[0];
  if (!first) return 'empty';
  if (!first.key || first.frame !== 0) return 'keyframe';
  const seen = new Set<number>();
  for (const p of segment.packets) {
    if (p.frame >= frames || seen.has(p.frame) || p.data.byteLength === 0) return 'packets';
    seen.add(p.frame);
  }
  return null;
}
