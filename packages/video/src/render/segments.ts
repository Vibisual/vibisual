/**
 * §5.13 (E-1)(E-2) 구간 계획과 열쇠(순수). 열쇠 = 그 구간에 그려지는 것 전부 — 하나라도 빠지면 낡은 조각이 조용히 섞인다.
 * 세 백엔드가 `buildDrawList` 만 보고 그리므로 프레임마다 그 목록을 통째로 적는다(고른 칸만 적지 않는다 — 새 칸이 저절로 들어오게).
 */

import { RENDER_SEGMENT_CACHE_VERSION, RENDER_SEGMENT_SECONDS } from '../constants.js';
import { stableStringify } from '../hashItem.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import { buildDrawList, type DrawOp } from './drawList.js';

/** 구간 하나(프레임 번호는 렌더 구간 시작부터). */
export interface SegmentSpan {
  readonly index: number;
  readonly firstFrame: number;
  readonly frames: number;
}

/** 구간 하나의 프레임 수 — 마지막 프레임 시각이 늘 `RENDER_SEGMENT_SECONDS` 안쪽이다(반올림이라 키프레임이 구간 첫 프레임 하나뿐). */
export function segmentFrameCount(fps: number): number {
  return Math.max(1, Math.round(RENDER_SEGMENT_SECONDS * fps));
}

export function planSegments(totalFrames: number, fps: number): SegmentSpan[] {
  const size = segmentFrameCount(fps);
  const out: SegmentSpan[] = [];
  for (let first = 0; first < totalFrames; first += size) {
    out.push({ index: out.length, firstFrame: first, frames: Math.min(size, totalFrames - first) });
  }
  return out;
}

/** 결과 비트열을 바꾸는 인코딩 설정. `decoder` = 이 기기 인코더가 실제로 낸 디코더 설정 지문(구현이 바뀌면 열쇠도 바뀐다). */
export interface SegmentEncodeKey {
  readonly container: string;
  readonly codec: string;
  readonly quality: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly alpha: boolean;
  readonly decoder: string;
}

/** 문서 밖에서 오는 것. */
export interface SegmentEnv {
  /** 엔진 판(User-Agent 등) — 같은 문서도 엔진이 다르면 픽셀이 다르다. */
  readonly engine: string;
  /** 소재 id → 파일 지문(크기·수정 시각). 선언은 그대로인데 파일만 바뀐 것을 잡는다. */
  readonly files: Readonly<Record<string, string>>;
  /** 문서 전체에 걸리는 파일(스타일 글꼴·로고·가져온 라이브러리)의 지문. */
  readonly shared: string;
}

export interface SegmentKeyInput {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  /** 렌더 구간 시작(문서 초). */
  readonly start: number;
  readonly fps: number;
  readonly spans: readonly SegmentSpan[];
  readonly backend: string;
  readonly encode: SegmentEncodeKey;
  readonly env: SegmentEnv;
}

/** 그림에 닿지 않거나(제목·판 번호·기록) 그리기 목록으로 이미 들어오는(트랙·소재·장면) 문서 칸. 여기 없는 칸은 모르는 새 칸까지 열쇠에 든다. */
const DOC_KEYS_OUTSIDE = new Set(['id', 'title', 'version', 'tracks', 'assets', 'chapters', 'derivedFrom', 'requirements', 'createdAt', 'updatedAt']);
/** 아이템 선언에서 빼는 칸 — 시작 시각(통째로 밀려도 같은 그림)과 자막 큐 목록(보이는 큐만 프레임마다 적는다). */
const ITEM_KEYS_OUTSIDE = new Set(['at', 'cues']);

/** 부동소수 꼬리를 버린다 — 통째로 민 아이템의 `t - start` 가 끝자리만 달라 다른 열쇠가 되지 않게. */
function trim6(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
  if (Array.isArray(value)) return value.map(trim6);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim6(v);
    return out;
  }
  return value;
}

function without(source: object, skip: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) if (!skip.has(k)) out[k] = v;
  return out;
}

/** 아이템 하나의 선언 전문 + 그 소재의 선언·파일 지문. 스타일 기본값이 얹힌 뒤의 아이템을 적는다(그리기 목록이 건네는 그것). */
function itemDecl(op: DrawOp, doc: VideoDoc, env: SegmentEnv): string {
  const item = op.resolved.item;
  const assetId = item.assetId;
  return stableStringify({
    item: without(item, ITEM_KEYS_OUTSIDE),
    trackKind: op.resolved.trackKind,
    duration: trim6(op.resolved.duration),
    asset: assetId === undefined ? null : doc.assets[assetId] ?? null,
    file: assetId === undefined ? null : env.files[assetId] ?? null,
  });
}

/** 한 프레임의 그리기 한 줄 — 선언은 아이템 id 로 가리키고(구간 서술에 한 번만 싣는다) 그 시각의 값만 적는다. */
function opLine(op: DrawOp, t: number): string {
  return stableStringify(trim6({
    id: op.itemId,
    kind: op.kind,
    z: op.z,
    localTime: op.localTime,
    sourceTime: op.sourceTime,
    progress: op.progress,
    transform: op.transform,
    clip: op.clip,
    filter: op.filter,
    vignette: op.vignette,
    synthetic: op.synthetic,
    // 자막 큐와 단어 강조는 문서 시각이다 — 자막만 절대 시각을 적는다.
    ...(op.kind === 'caption' ? { cues: op.cues, t } : {}),
  }));
}

/**
 * 구간 하나의 서술(열쇠가 되기 전의 글)을 내는 함수. 구간마다 따로 부른다 — 긴 문서의 서술을 한꺼번에 들지 않게(한 구간이 수백 KB).
 * 직렬화는 JS 에 둔다: 재료가 JS 객체(그리기 목록)라 WASM 으로 넘기려면 같은 직렬화를 먼저 해야 한다. 실측 7,200프레임(4분) 서술+SHA-256 약 75ms — §5.13 (E-10).
 */
export function segmentDescriber(input: SegmentKeyInput): (span: SegmentSpan) => string {
  const { doc, timeline, fps, env } = input;
  const head = stableStringify({
    version: RENDER_SEGMENT_CACHE_VERSION,
    backend: input.backend,
    engine: env.engine,
    shared: env.shared,
    encode: input.encode,
    segmentFrames: segmentFrameCount(fps),
    doc: without(doc, DOC_KEYS_OUTSIDE),
  });
  // 스타일은 문서 전역이라 같은 아이템의 선언은 구간이 달라도 같다 — 한 번만 직렬화한다.
  const decls = new Map<string, string>();
  return (span) => {
    const used = new Set<string>();
    const frames: string[] = [];
    for (let j = 0; j < span.frames; j += 1) {
      const t = input.start + (span.firstFrame + j) / fps;
      const ops = buildDrawList(doc, timeline, t);
      for (const op of ops) {
        used.add(op.itemId);
        if (!decls.has(op.itemId)) decls.set(op.itemId, itemDecl(op, doc, env));
      }
      frames.push(ops.map((op) => opLine(op, t)).join(','));
    }
    const items = [...used].sort().map((id) => `${JSON.stringify(id)}=${decls.get(id) ?? ''}`);
    return `${head}\nframes=${span.frames}\n${items.join('\n')}\n${frames.join('\n')}`;
  };
}

/** 구간마다의 서술. 시험이 "무엇이 들어갔나"를 직접 본다. */
export function segmentDescriptors(input: SegmentKeyInput): string[] {
  const describe = segmentDescriber(input);
  return input.spans.map(describe);
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 은 엔진 네이티브(WebCrypto — 브라우저·Node 공통)를 쓴다. 보안 문맥이 아니면 없다. */
export function canHashSegments(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

/** 구간마다의 열쇠(64자 16진수). */
export async function segmentKeys(input: SegmentKeyInput): Promise<string[]> {
  const describe = segmentDescriber(input);
  const out: string[] = [];
  // 구간마다 서술 → 해시(기다리는 사이 일꾼 창의 숨소리·취소 확인이 돈다).
  for (const span of input.spans) out.push(await sha256Hex(describe(span)));
  return out;
}
