/**
 * §5.13 (G) 배치 요약(B) — 시각 t 화면 요소의 이름·상자·글자를 글로(순수). 그림을 열지 않고도 겹침·가림·잘림을 읽게 한다.
 * 상자·글자 상자·겹침 문턱은 모션 검수와 같은 함수·같은 값이다(두 판정이 갈리지 않게). 컴포지션 안쪽은 일꾼 표본(무대 `inspect`)으로만 안다.
 */

import { LAYOUT_MAX_CHARS, LAYOUT_MAX_LINES, LAYOUT_TEXT_MAX_CHARS } from '../constants.js';
import { formatOfSize, safeAreaRect } from '../formats.js';
import { buildDrawList, type DrawOp } from '../render/drawList.js';
import { opRect, type HitRect } from '../render/hitTest.js';
import type { ResolvedTimeline, VideoDoc, VideoItemKind } from '../types.js';
import { CONTRAST_MIN, OVERLAP_RATIO, contrastRatio, docTextBoxes, overlapArea, relativeLuminance, textOf, type ProbeText } from './motionReview.js';

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutElement {
  /** 그리는 순서 번호(1부터 — 클수록 위). 컴포지션 안쪽은 `<부모>.<k>`. */
  readonly ref: string;
  readonly kind: VideoItemKind | 'inner';
  readonly itemId: string;
  readonly label?: string;
  readonly chapterId?: string;
  /** 컴포지션 안 요소의 CSS 경로. */
  readonly path?: string;
  readonly box: LayoutBox;
  readonly text?: string;
  readonly fontSize?: number;
  readonly opacity?: number;
  readonly rotation?: number;
  readonly contrast?: number;
  /** 사람이 읽는 표시(`overlaps #4` · `covered by #2` · `clipped right 30px` · `offscreen` · `outside safe area` · `low contrast 2.1:1`). */
  readonly flags: readonly string[];
}

export interface LayoutFlagCounts {
  readonly overlap: number;
  readonly covered: number;
  readonly clipped: number;
  readonly offscreen: number;
  readonly unsafe: number;
  readonly lowContrast: number;
}

export interface LayoutSummary {
  readonly t: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly safeArea: LayoutBox;
  /** 거른 뒤(`itemId`) 요소 수와 실은 수. */
  readonly total: number;
  readonly listed: number;
  readonly flags: LayoutFlagCounts;
  readonly elements: readonly LayoutElement[];
  readonly text: string;
}

export interface LayoutInput {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly t: number;
  /** 일꾼 표본의 글자(문서 글자 + 컴포지션 안 글자, 바탕 밝기 포함). 없으면 문서만. */
  readonly probeTexts?: readonly ProbeText[];
  /** 이 아이템(과 그 컴포지션 안쪽)만 싣는다. 표시는 전체를 보고 정한다. */
  readonly itemId?: string;
  readonly maxLines?: number;
  readonly maxChars?: number;
}

/** 글자를 가릴 수 있는 것 — 컴포지션·기본 씬은 바탕이 투명한 일이 흔해 넣지 않는다(오탐). */
const COVER_KINDS: ReadonlySet<VideoItemKind> = new Set(['footage', 'image', 'shape', 'model']);
/** 이보다 옅으면 가린다고 보지 않는다. */
const COVER_MIN_OPACITY = 0.5;
/** 한 요소의 `overlaps #n` 표시를 이만큼만 싣는다(나머지는 `+n more overlaps`). */
const OVERLAP_LIST_MAX = 6;

interface Work {
  ref: string;
  order: number;
  kind: LayoutElement['kind'];
  itemId: string;
  label?: string;
  chapterId?: string;
  path?: string;
  rect: HitRect;
  text?: string;
  isText: boolean;
  color?: string;
  fontSize?: number;
  opacity: number;
  rotation: number;
  bg?: number;
  contrast?: number;
  flags: string[];
}

function round(n: number): number {
  return Math.round(n);
}

function box(r: HitRect): LayoutBox {
  return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LAYOUT_TEXT_MAX_CHARS ? `${flat.slice(0, LAYOUT_TEXT_MAX_CHARS - 1)}…` : flat;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 화면 밖으로 나간 몫(px, 0.5 아래는 버린다) — 통째로 밖이면 `offscreen`. */
function edgeFlags(r: HitRect, W: number, H: number): string[] {
  if (r.width <= 0 || r.height <= 0) return [];
  if (r.x >= W || r.y >= H || r.x + r.width <= 0 || r.y + r.height <= 0) return ['offscreen'];
  const parts: string[] = [];
  const side = (name: string, px: number): void => { if (px >= 0.5) parts.push(`${name} ${round(px)}px`); };
  side('left', -r.x);
  side('top', -r.y);
  side('right', r.x + r.width - W);
  side('bottom', r.y + r.height - H);
  return parts.length > 0 ? [`clipped ${parts.join(', ')}`] : [];
}

/** 겹친 상대가 수백이면 한 줄이 글자 상한을 혼자 넘어 아무것도 실리지 않는다 — 앞 몇 개만 두고 나머지는 개수로. */
function capOverlapFlags(flags: string[]): string[] {
  const overlaps = flags.filter((f) => f.startsWith('overlaps #'));
  if (overlaps.length <= OVERLAP_LIST_MAX) return flags;
  const drop = new Set(overlaps.slice(OVERLAP_LIST_MAX));
  const out: string[] = [];
  for (const f of flags) {
    if (drop.has(f)) continue;
    out.push(f);
    if (f === overlaps[OVERLAP_LIST_MAX - 1]) out.push(`+${drop.size} more overlaps`);
  }
  return out;
}

function insideArea(r: HitRect, a: LayoutBox): boolean {
  return r.x >= a.x - 0.5 && r.y >= a.y - 0.5 && r.x + r.width <= a.x + a.width + 0.5 && r.y + r.height <= a.y + a.height + 0.5;
}

function lineOf(e: LayoutElement): string {
  const head = e.kind === 'inner'
    ? `  #${e.ref} ${e.path || '(element)'}`
    : `#${e.ref} ${e.kind} "${e.itemId}"${e.label ? ` (${clip(e.label)})` : ''}${e.chapterId ? ` [chapter ${e.chapterId}]` : ''}`;
  const parts = [`${head} box ${e.box.x},${e.box.y} ${e.box.width}x${e.box.height}`];
  if (e.text) parts.push(`"${e.text}"`);
  if (e.fontSize !== undefined) parts.push(`${round(e.fontSize)}px`);
  if (e.opacity !== undefined) parts.push(`opacity ${e.opacity}`);
  if (e.rotation !== undefined) parts.push(`rotated ${e.rotation}deg (box not rotated)`);
  if (e.contrast !== undefined) parts.push(`contrast ${e.contrast}:1`);
  const line = parts.join(' · ');
  return e.flags.length > 0 ? `${line} · ! ${e.flags.join(', ')}` : line;
}

/** 시각 t 의 배치 요약. 같은 문서·같은 시각·같은 표본이면 같은 글이다. */
export function summarizeLayout(input: LayoutInput): LayoutSummary {
  const { doc, timeline, t } = input;
  const W = doc.size.width;
  const H = doc.size.height;
  const safe = box(safeAreaRect(doc.size));
  const maxLines = Math.max(1, input.maxLines ?? LAYOUT_MAX_LINES);
  const maxChars = Math.max(200, input.maxChars ?? LAYOUT_MAX_CHARS);
  const ops: DrawOp[] = buildDrawList(doc, timeline, t).filter((op) => !op.synthetic && !(op.kind === 'caption' && op.cues.length === 0));
  const textBoxes = new Map<string, ProbeText>();
  for (const b of docTextBoxes(doc, ops)) if (!textBoxes.has(b.itemId)) textBoxes.set(b.itemId, b);
  const compositionIds = new Set(ops.filter((op) => op.kind === 'composition').map((op) => op.itemId));
  const probe = input.probeTexts ?? [];

  const work: Work[] = [];
  ops.forEach((op, i) => {
    const item = op.resolved.item;
    const docText = textBoxes.get(op.itemId);
    const sceneText = op.kind === 'scene' ? textOf(item) : '';
    const measured = docText ? probe.find((p) => p.itemId === op.itemId && p.text === docText.text) : undefined;
    const props = item.props ?? {};
    const fontSize = docText ? num(props['fontSize']) ?? (op.kind === 'caption' ? 48 : 64) : undefined;
    const tr = op.transform;
    work.push({
      ref: String(i + 1),
      order: i,
      kind: op.kind,
      itemId: op.itemId,
      ...(item.label ? { label: item.label } : {}),
      ...(item.chapterId ? { chapterId: item.chapterId } : {}),
      rect: docText ? docText.rect : opRect(op),
      ...(docText ? { text: docText.text } : sceneText ? { text: sceneText } : {}),
      isText: docText !== undefined,
      ...(docText?.color ? { color: docText.color } : {}),
      ...(fontSize !== undefined ? { fontSize } : {}),
      opacity: tr.opacity,
      rotation: tr.rotation,
      ...(measured?.bgLuminance !== undefined ? { bg: measured.bgLuminance } : {}),
      flags: [],
    });
    if (!compositionIds.has(op.itemId)) return;
    let k = 0;
    for (const inner of probe) {
      if (inner.itemId !== op.itemId) continue;
      k += 1;
      work.push({
        ref: `${i + 1}.${k}`,
        order: i,
        kind: 'inner',
        itemId: op.itemId,
        ...(inner.path ? { path: inner.path } : {}),
        rect: inner.rect,
        text: inner.text,
        isText: true,
        ...(inner.color ? { color: inner.color } : {}),
        ...(inner.fontSize ? { fontSize: inner.fontSize } : {}),
        opacity: 1,
        rotation: 0,
        ...(inner.bgLuminance !== undefined ? { bg: inner.bgLuminance } : {}),
        flags: [],
      });
    }
  });

  const texts = work.filter((w) => w.isText && w.rect.width > 0 && w.rect.height > 0);
  for (const w of work) w.flags.push(...edgeFlags(w.rect, W, H));
  for (const w of texts) {
    if (!insideArea(w.rect, safe)) w.flags.push('outside safe area');
    const fg = w.bg !== undefined && w.color ? relativeLuminance(w.color) : null;
    if (fg !== null && w.bg !== undefined) {
      w.contrast = Math.round(contrastRatio(fg, w.bg) * 10) / 10;
      if (w.contrast < CONTRAST_MIN) w.flags.push(`low contrast ${w.contrast}:1`);
    }
  }
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const x = texts[a]!;
      const y = texts[b]!;
      const small = Math.min(x.rect.width * x.rect.height, y.rect.width * y.rect.height);
      if (small > 0 && overlapArea(x.rect, y.rect) / small > OVERLAP_RATIO) {
        x.flags.push(`overlaps #${y.ref}`);
        y.flags.push(`overlaps #${x.ref}`);
      }
    }
  }
  for (const w of texts) w.flags = capOverlapFlags(w.flags);
  for (const w of texts) {
    const area = w.rect.width * w.rect.height;
    const cover = work.find((c) => c.order > w.order && c.kind !== 'inner' && COVER_KINDS.has(c.kind as VideoItemKind)
      && c.opacity >= COVER_MIN_OPACITY && overlapArea(c.rect, w.rect) / area > OVERLAP_RATIO);
    if (cover) w.flags.push(`covered by #${cover.ref}`);
  }

  const elements: LayoutElement[] = work.map((w) => ({
    ref: w.ref,
    kind: w.kind,
    itemId: w.itemId,
    ...(w.label ? { label: w.label } : {}),
    ...(w.chapterId ? { chapterId: w.chapterId } : {}),
    ...(w.path ? { path: w.path } : {}),
    box: box(w.rect),
    ...(w.text ? { text: clip(w.text) } : {}),
    ...(w.fontSize !== undefined ? { fontSize: round(w.fontSize) } : {}),
    ...(w.opacity < 1 ? { opacity: Math.round(w.opacity * 100) / 100 } : {}),
    ...(w.rotation !== 0 ? { rotation: Math.round(w.rotation * 10) / 10 } : {}),
    ...(w.contrast !== undefined ? { contrast: w.contrast } : {}),
    flags: w.flags,
  }));

  const scoped = input.itemId === undefined ? elements : elements.filter((e) => e.itemId === input.itemId);
  const having = (test: (flag: string) => boolean): number => scoped.filter((e) => e.flags.some(test)).length;
  const counts: LayoutFlagCounts = {
    overlap: having((f) => f.startsWith('overlaps ')),
    covered: having((f) => f.startsWith('covered by ')),
    clipped: having((f) => f.startsWith('clipped ')),
    offscreen: having((f) => f === 'offscreen'),
    unsafe: having((f) => f === 'outside safe area'),
    lowContrast: having((f) => f.startsWith('low contrast ')),
  };
  // 넘치면 표시 달린 것을 먼저, 나머지는 위(나중에 그린 것)부터 남기고 화면 순서로 되돌린다.
  let kept = scoped;
  if (scoped.length > maxLines) {
    const rank = scoped.map((e, i) => ({ e, i }));
    const flagged = rank.filter((r) => r.e.flags.length > 0);
    const rest = rank.filter((r) => r.e.flags.length === 0).reverse();
    kept = [...flagged, ...rest].slice(0, maxLines).sort((a, b) => a.i - b.i).map((r) => r.e);
  }
  const header = `t=${t.toFixed(2)}s · ${W}x${H} (${formatOfSize(doc.size)}) · safe area ${safe.x},${safe.y} ${safe.width}x${safe.height}`
    + ` · ${scoped.length} elements, ${scoped.filter((e) => e.flags.length > 0).length} flagged · boxes in document px, later # = drawn on top`;
  const lines = [header];
  let used = header.length;
  const listedEls: LayoutElement[] = [];
  for (const e of kept) {
    const line = lineOf(e);
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
    listedEls.push(e);
  }
  const omitted = scoped.length - listedEls.length;
  if (omitted > 0) lines.push(`… ${omitted} more elements not listed — narrow with item=<itemId>`);
  if (scoped.length === 0) lines.push(input.itemId === undefined ? 'nothing is drawn at this time' : `item "${input.itemId}" is not drawn at this time`);
  return {
    t,
    size: { width: W, height: H },
    safeArea: safe,
    total: scoped.length,
    listed: listedEls.length,
    flags: counts,
    elements: listedEls,
    text: lines.join('\n'),
  };
}

/** 그 시각에 컴포지션이 그려지나 — 아니면 일꾼에 안쪽을 묻지 않는다. */
export function compositionsAt(doc: VideoDoc, timeline: ResolvedTimeline, t: number, itemId?: string): boolean {
  return buildDrawList(doc, timeline, t).some((op) => op.kind === 'composition' && (itemId === undefined || op.itemId === itemId));
}
