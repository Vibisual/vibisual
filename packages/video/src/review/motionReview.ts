/**
 * §5.13 (V) 37-9 — **모션 검수** 여덟 가지 (순수 — (T-14) 2단계 '모션 검수' 앞당김).
 *
 * ① 읽을 시간이 모자란 글자 ② 판형별 안전 영역 침범 ③ 글자끼리 겹침 ④ 낮은 대비 ⑤ 빈 화면 ⑥ 자막 잘림 ⑦ 무음 ⑧ 비트 어긋남.
 *
 * 문서만으로 보는 것(①②③⑤⑥⑦⑧)은 여기서 끝나고, 픽셀이 있어야 보는 것(④ 대비 · ⑤ 그릴 것이 있는데 평평한 화면 · 컴포지션 안의
 * 글자 상자)은 **일꾼이 찍은 표본**(`FrameProbe`)을 받아 같은 함수가 본다 — 스튜디오(장면 구슬 줄 위 표시)와 에이전트
 * (`GET /doc/:id/review` · `frames=1`)가 같은 결과를 받는다. 판정이 보수적인 이유는 오탐이 잦으면 사람이 표시를 안 보게 되기
 * 때문이다(종전 자동 검수와 같은 원칙). 비트 어긋남은 **코드가 계산한 고치기 연산**을 함께 준다(AI 가 말한 숫자를 쓰지 않는다).
 */

import { SAFE_AREAS, formatOfSize } from '../formats.js';
import { chapterIdOf, chapterMap, isUnpickedVariant } from '../chapters.js';
import { buildDrawList, type DrawOp } from '../render/drawList.js';
import { textBounds, type HitRect } from '../render/hitTest.js';
import type { ResolvedItem, ResolvedTimeline, VideoDoc, VideoDocOp } from '../types.js';

export type MotionCode = 'read-time' | 'safe-area' | 'text-overlap' | 'low-contrast' | 'blank' | 'caption-clip' | 'silence' | 'off-beat';

export interface MotionFinding {
  /** 같은 문제는 같은 id(무시 목록이 문서가 바뀌어도 살아남게) — `<code>:<대상>:<시각>`. */
  readonly id: string;
  readonly code: MotionCode;
  readonly level: 'error' | 'warn' | 'info';
  readonly t: number;
  readonly end?: number;
  readonly itemId?: string;
  readonly chapterId?: string;
  /** 에이전트가 읽는 영문 한 줄. 화면은 `code` + `values` 로 번역한다. */
  readonly message: string;
  readonly values?: Readonly<Record<string, string | number>>;
  /** 코드가 계산한 고치기 연산(비트 맞추기). */
  readonly fix?: readonly VideoDocOp[];
}

/** 일꾼 프레임 하나에서 본 글자 상자(문서 픽셀). */
export interface ProbeText {
  readonly itemId: string;
  readonly text: string;
  readonly rect: HitRect;
  /** CSS 색 문자열(`rgb(…)`·`#…`). */
  readonly color?: string;
  readonly fontSize?: number;
  /** 그 상자 아래 프레임의 평균 밝기(0~1, 상대 휘도) — 일꾼이 잰다. */
  readonly bgLuminance?: number;
}

/** 일꾼이 찍은 표본 하나. */
export interface FrameProbe {
  readonly t: number;
  /** 컴포지션 안의 보이는 글자(무대 `inspect`) + 일꾼이 잰 아래 밝기. */
  readonly texts: readonly ProbeText[];
  /** 그 시각 프레임이 평평한가(그릴 것이 있는데 빈 화면). */
  readonly flat: boolean;
}

/** 한글·한자·가나 — 초당 7자. 라틴 — 초당 3.2낱말 + 1.2초(§5.13 (V) 37-9). */
const CJK_CHARS_PER_SEC = 7;
const LATIN_WORDS_PER_SEC = 3.2;
const LATIN_BASE_SEC = 1.2;
/** 빈 화면·무음으로 볼 최소 길이(초). */
const GAP_MIN_SEC = 0.25;
const SILENCE_MIN_SEC = 1.0;
/** 비트 어긋남 문턱(초). */
const BEAT_TOLERANCE_SEC = 0.12;
/** 낮은 대비 문턱(WCAG 대비비). */
const CONTRAST_MIN = 3;
/** 자막이 넘는다고 볼 줄 수. */
const CAPTION_MAX_LINES = 2;
/** 겹침으로 볼 비율(작은 상자 넓이 대비). */
const OVERLAP_RATIO = 0.2;

const CJK = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/g;

/** 그 글을 읽는 데 드는 시간(초). */
export function readingSeconds(text: string): number {
  const clean = text.trim();
  if (clean === '') return 0;
  const cjk = (clean.match(CJK) ?? []).length;
  const latinWords = clean.replace(CJK, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  let need = 0;
  if (cjk > 0) need += cjk / CJK_CHARS_PER_SEC;
  if (latinWords > 0) need += latinWords / LATIN_WORDS_PER_SEC + LATIN_BASE_SEC;
  return need;
}

/** 씬별로 화면에 글이 되는 값. */
const SCENE_TEXT_KEYS: Readonly<Record<string, readonly string[]>> = {
  title: ['title', 'subtitle'],
  lowerThird: ['name', 'role'],
  bulletList: ['heading', 'items'],
  quote: ['text', 'by'],
  codeBlock: ['lines'],
};

function textOf(item: ResolvedItem['item']): string {
  const props = item.props ?? {};
  const keys = item.kind === 'text' ? ['text'] : item.kind === 'scene' ? SCENE_TEXT_KEYS[item.sceneId ?? ''] ?? [] : [];
  return keys.map((k) => {
    const v = props[k];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(' ') : typeof v === 'string' ? v : '';
  }).filter((s) => s.trim() !== '').join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function inside(r: HitRect, area: { left: number; top: number; right: number; bottom: number }, w: number, h: number): boolean {
  return r.x >= area.left * w - 0.5 && r.y >= area.top * h - 0.5 && r.x + r.width <= area.right * w + 0.5 && r.y + r.height <= area.bottom * h + 0.5;
}

function overlapArea(a: HitRect, b: HitRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** CSS 색 → 상대 휘도(0~1). 못 읽으면 null. */
export function relativeLuminance(color: string): number | null {
  const c = color.trim().toLowerCase();
  let r: number; let g: number; let b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
  if (hex) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    r = parseInt(full.slice(0, 2), 16); g = parseInt(full.slice(2, 4), 16); b = parseInt(full.slice(4, 6), 16);
  } else if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  } else if (c === 'white') { r = 255; g = 255; b = 255; } else if (c === 'black') { r = 0; g = 0; b = 0; } else return null;
  const lin = (v: number): number => {
    const s = Math.max(0, Math.min(255, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 시각 구간 합집합의 빈틈([from, to) 안). */
function gaps(intervals: readonly [number, number][], from: number, to: number, min: number): [number, number][] {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let cursor = from;
  for (const [a, b] of sorted) {
    if (a > cursor && a - cursor >= min) out.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
    if (cursor >= to) break;
  }
  if (to - cursor >= min) out.push([cursor, to]);
  return out;
}

/** 그 시각의 그릴 것 중 문서 글자 상자(글자 아이템·자막 띠). */
function docTextBoxes(doc: VideoDoc, ops: readonly DrawOp[]): ProbeText[] {
  const out: ProbeText[] = [];
  for (const op of ops) {
    if (op.synthetic) continue;
    if (op.kind === 'text') {
      const text = textOf(op.resolved.item);
      if (text !== '') {
        const color = typeof op.resolved.item.props?.['color'] === 'string' ? (op.resolved.item.props['color'] as string) : '#FFFFFF';
        out.push({ itemId: op.itemId, text, rect: textBounds(op), color });
      }
    } else if (op.kind === 'caption' && op.cues.length > 0) {
      const fontSize = typeof op.resolved.item.props?.['fontSize'] === 'number' ? (op.resolved.item.props['fontSize'] as number) : 48;
      const bottom = typeof op.resolved.item.props?.['bottom'] === 'number' ? (op.resolved.item.props['bottom'] as number) : 96;
      const lines = Math.max(1, captionLines(doc, op.cues.map((c) => c.text).join(' '), fontSize));
      const h = fontSize * 1.3 * lines + fontSize * 1.2;
      out.push({ itemId: op.itemId, text: op.cues.map((c) => c.text).join(' '), rect: { x: doc.size.width * 0.07, y: doc.size.height - bottom - h, width: doc.size.width * 0.86, height: h } });
    }
  }
  return out;
}

/** 시각 t 의 문서 글자 상자(글자 아이템·자막 띠) — 일꾼이 그 아래 밝기를 재려고 쓴다. */
export function docTextBoxesAt(doc: VideoDoc, timeline: ResolvedTimeline, t: number): ProbeText[] {
  return docTextBoxes(doc, buildDrawList(doc, timeline, t));
}

/** 자막 한 덩어리가 몇 줄이 되나(폭 추정 — 라틴 0.55·그 밖 1 글자폭). */
export function captionLines(doc: VideoDoc, text: string, fontSize: number): number {
  const width = doc.size.width * 0.86 - fontSize * 2;
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x2e80 ? 0.55 * fontSize : fontSize;
  return Math.max(1, Math.ceil(w / Math.max(1, width)));
}

/** 표본을 찍을 시각 — 컷 경계 조금 안쪽 + 긴 아이템의 가운데(상한 안에서 고르게). */
export function reviewSampleTimes(timeline: ResolvedTimeline, max = 40): number[] {
  const set = new Set<number>();
  const eps = 0.05;
  for (const it of timeline.items) {
    if (it.trackKind === 'audio') continue;
    set.add(round2(Math.min(it.end - eps, it.start + eps)));
    if (it.duration > 2) set.add(round2(it.start + it.duration / 2));
  }
  const times = [...set].filter((t) => t >= 0 && t < timeline.duration).sort((a, b) => a - b);
  if (times.length <= max) return times;
  const step = times.length / max;
  return Array.from({ length: max }, (_, i) => times[Math.floor(i * step)] ?? 0);
}

/** 강한 비트(문서 시각) — 음악 아이템(`props.role === 'music'`, 없으면 비트를 가진 첫 소리)의 소재 비트를 문서 시각으로 옮긴다. */
export function strongBeatsInDoc(doc: VideoDoc, timeline: ResolvedTimeline): number[] {
  const audio = timeline.items.filter((it) => it.trackKind === 'audio' && it.item.enabled !== false);
  const pick = audio.find((it) => it.item.props?.['role'] === 'music') ?? audio.find((it) => (it.item.assetId ? doc.assets[it.item.assetId]?.beatsStrong?.length ?? 0 : 0) > 0);
  if (!pick?.item.assetId) return [];
  const asset = doc.assets[pick.item.assetId];
  const trim = pick.item.trimStart ?? 0;
  return (asset?.beatsStrong ?? [])
    .map((b) => pick.start + (b - trim))
    .filter((t) => t >= pick.start && t < pick.end);
}

function nearest(values: readonly number[], t: number): number | null {
  let best: number | null = null;
  for (const v of values) if (best === null || Math.abs(v - t) < Math.abs(best - t)) best = v;
  return best;
}

/** 모션 검수. `probes` 가 있으면(일꾼 프레임) 대비·평평한 화면·컴포지션 안 글자까지 본다. */
export function reviewMotion(doc: VideoDoc, timeline: ResolvedTimeline, probes: readonly FrameProbe[] = []): MotionFinding[] {
  const out: MotionFinding[] = [];
  const seen = new Set<string>();
  const push = (f: MotionFinding): void => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    out.push(f);
  };
  const W = doc.size.width;
  const H = doc.size.height;
  const area = SAFE_AREAS[formatOfSize(doc.size)];
  const chapters = chapterMap(doc);
  const visible = timeline.items.filter((it) => it.item.enabled !== false && !isUnpickedVariant(chapters, it.item)
    && !doc.tracks.find((tr) => tr.id === it.trackId)?.hidden);

  // ① 읽을 시간 — 글자 아이템·씬 글·자막 큐.
  for (const it of visible) {
    if (it.kind === 'caption') {
      for (const cue of it.item.cues ?? []) {
        const need = readingSeconds(cue.text);
        const have = cue.end - cue.start;
        if (need > 0 && have + 0.05 < need) {
          push({ id: `read-time:${it.id}:${round2(cue.start)}`, code: 'read-time', level: 'warn', t: cue.start, end: cue.end, itemId: it.id,
            message: `Caption "${cue.text.slice(0, 60)}" is on screen ${have.toFixed(1)}s but needs about ${need.toFixed(1)}s to read.`,
            values: { have: round2(have), need: round2(need) } });
        }
      }
      continue;
    }
    const text = textOf(it.item);
    const need = readingSeconds(text);
    const cid = chapterIdOf(it.item);
    if (need > 0 && it.duration + 0.05 < need) {
      push({ id: `read-time:${it.id}:${round2(it.start)}`, code: 'read-time', level: 'warn', t: it.start, end: it.end, itemId: it.id,
        ...(cid ? { chapterId: cid } : {}),
        message: `Text "${text.slice(0, 60)}" is on screen ${it.duration.toFixed(1)}s but needs about ${need.toFixed(1)}s to read.`,
        values: { have: round2(it.duration), need: round2(need) } });
    }
  }

  // ②③⑥ — 표본 시각마다 문서 글자 상자(+ 일꾼이 본 컴포지션 글자).
  const probeAt = new Map(probes.map((p) => [round2(p.t), p]));
  const times = new Set<number>([...reviewSampleTimes(timeline), ...probes.map((p) => round2(p.t))]);
  for (const t of [...times].sort((a, b) => a - b)) {
    const ops = buildDrawList(doc, timeline, t);
    const probe = probeAt.get(t);
    // 문서 글자 상자 + 일꾼이 본 글자(같은 아이템·같은 글이면 하나로 — 일꾼이 잰 아래 밝기만 얹는다).
    const boxes: ProbeText[] = docTextBoxes(doc, ops);
    for (const pt of probe?.texts ?? []) {
      const same = boxes.findIndex((b) => b.itemId === pt.itemId && b.text === pt.text);
      const prev = boxes[same];
      if (same >= 0 && prev) boxes[same] = { ...prev, ...(pt.bgLuminance !== undefined ? { bgLuminance: pt.bgLuminance } : {}) };
      else boxes.push(pt);
    }
    for (const box of boxes) {
      if (!inside(box.rect, area, W, H)) {
        push({ id: `safe-area:${box.itemId}:${box.text.slice(0, 24)}`, code: 'safe-area', level: 'warn', t, itemId: box.itemId,
          message: `"${box.text.slice(0, 60)}" goes outside the ${formatOfSize(doc.size)} safe area (screen UI may cover it).`,
          values: { text: box.text.slice(0, 40) } });
      }
      // ④ 대비 — 일꾼이 잰 아래 밝기가 있을 때만.
      if (box.bgLuminance !== undefined && box.color) {
        const fg = relativeLuminance(box.color);
        if (fg !== null) {
          const ratio = contrastRatio(fg, box.bgLuminance);
          if (ratio < CONTRAST_MIN) {
            push({ id: `low-contrast:${box.itemId}:${box.text.slice(0, 24)}`, code: 'low-contrast', level: 'warn', t, itemId: box.itemId,
              message: `"${box.text.slice(0, 60)}" has low contrast against its background (${ratio.toFixed(1)}:1, aim for 3:1 or more).`,
              values: { ratio: round2(ratio), text: box.text.slice(0, 40) } });
          }
        }
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const small = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
        if (small > 0 && overlapArea(a.rect, b.rect) / small > OVERLAP_RATIO) {
          push({ id: `text-overlap:${[a.itemId, b.itemId].sort().join('+')}:${a.text.slice(0, 12)}|${b.text.slice(0, 12)}`, code: 'text-overlap', level: 'warn', t, itemId: a.itemId,
            message: `Texts "${a.text.slice(0, 40)}" and "${b.text.slice(0, 40)}" overlap.`,
            values: { a: a.text.slice(0, 30), b: b.text.slice(0, 30) } });
        }
      }
    }
    // ⑤ 그릴 것이 있는데 평평한 화면(일꾼 프레임).
    if (probe?.flat && ops.some((op) => !op.synthetic)) {
      push({ id: `blank:flat:${round2(t)}`, code: 'blank', level: 'error', t, ...(ops[0] ? { itemId: ops[0].itemId } : {}),
        message: `At ${t.toFixed(2)}s there are items to draw but the frame is empty.`, values: { t: round2(t) } });
    }
  }

  // ⑥ 자막 잘림 — 줄 수가 둘을 넘는 큐.
  for (const it of visible) {
    if (it.kind !== 'caption') continue;
    const fontSize = typeof it.item.props?.['fontSize'] === 'number' ? (it.item.props['fontSize'] as number) : 48;
    for (const cue of it.item.cues ?? []) {
      const lines = captionLines(doc, cue.text, fontSize);
      if (lines > CAPTION_MAX_LINES) {
        push({ id: `caption-clip:${it.id}:${round2(cue.start)}`, code: 'caption-clip', level: 'warn', t: cue.start, end: cue.end, itemId: it.id,
          message: `Caption "${cue.text.slice(0, 60)}" needs ${lines} lines (more than ${CAPTION_MAX_LINES}); split it or shorten it.`,
          values: { lines } });
      }
    }
  }

  // ⑤ 빈 화면 — 그릴 것이 하나도 없는 구간.
  const visual = visible.filter((it) => it.trackKind !== 'audio').map((it): [number, number] => [it.start, it.end]);
  if (timeline.duration > 0 && visual.length > 0) {
    for (const [a, b] of gaps(visual, 0, timeline.duration, GAP_MIN_SEC)) {
      push({ id: `blank:${round2(a)}`, code: 'blank', level: 'error', t: a, end: b,
        message: `Nothing is drawn from ${a.toFixed(2)}s to ${b.toFixed(2)}s.`, values: { from: round2(a), to: round2(b) } });
    }
  }

  // ⑦ 무음 — 소리가 있는 문서에서 소리 빈 구간.
  const sound = visible.filter((it) => it.trackKind === 'audio').map((it): [number, number] => [it.start, it.end]);
  if (sound.length > 0 && timeline.duration > 0) {
    for (const [a, b] of gaps(sound, 0, timeline.duration, SILENCE_MIN_SEC)) {
      push({ id: `silence:${round2(a)}`, code: 'silence', level: 'info', t: a, end: b,
        message: `No sound from ${a.toFixed(2)}s to ${b.toFixed(2)}s.`, values: { from: round2(a), to: round2(b) } });
    }
  }

  // ⑧ 비트 어긋남 — 장면 경계·전환 가운데가 가장 가까운 강한 비트에서 문턱 넘게.
  const beats = strongBeatsInDoc(doc, timeline);
  if (beats.length > 0) {
    timeline.chapters.forEach((c, i) => {
      if (i === 0) return;
      const prev = timeline.chapters[i - 1];
      const mark = c.start + c.overlapIn / 2;
      const beat = nearest(beats, mark);
      if (beat === null || !prev) return;
      const delta = beat - mark;
      if (Math.abs(delta) <= BEAT_TOLERANCE_SEC) return;
      // 앞 장면의 길이를 그만큼 바꾸면 이 경계(와 뒤 장면 전부)가 비트로 옮겨 간다 — 상대 앵커라 그림이 따라온다.
      const nextDuration = Math.max(0.1, prev.duration + delta);
      push({ id: `off-beat:${c.id}`, code: 'off-beat', level: 'info', t: mark, chapterId: c.id,
        message: `The cut into chapter "${c.chapter.title}" is ${Math.abs(delta).toFixed(2)}s off the nearest strong beat.`,
        values: { offset: round2(Math.abs(delta)), n: i + 1 },
        fix: [{ op: 'updateChapter', chapterId: prev.id, patch: { duration: Math.round(nextDuration * 1000) / 1000 } }] });
    });
  }

  return out.sort((a, b) => a.t - b.t);
}
