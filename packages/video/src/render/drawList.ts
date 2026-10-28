/** §5.13 (E) 그리기 목록 — "시각 t 에 무엇을 어디에"를 순수 함수 하나로(백엔드 셋에 흩어지면 같은 문서가 방식마다 달라진다). 씬을 재실행하지 않고 목록만 뽑는다. */

import type { CaptionCue, ResolvedChapter, ResolvedItem, ResolvedTimeline, VideoDoc, VideoItemKind, VideoKeyframe, VideoTransform } from '../types.js';
import { chapterIdOf, chapterMap, isUnpickedVariant } from '../chapters.js';
import { sampleKeyframes } from '../keyframes.js';
import { effectsToFilter } from './effects.js';
import { flashAlpha, intersectRect, transitionEffect, type TransitionRect } from './transitions.js';

/** 기본값이 채워진 배치. 백엔드는 이 값만 보고 그린다. */
export interface ResolvedTransform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly scale: number;
}

export interface DrawOp {
  readonly itemId: string;
  readonly kind: VideoItemKind;
  /** 그리는 순서. 작을수록 먼저(뒤에) 그린다 — 트랙 순서가 곧 앞뒤다. */
  readonly z: number;
  /** 아이템이 시작한 뒤 흐른 시간(초). 씬 애니메이션의 입력. */
  readonly localTime: number;
  /** 0~1 진행률. 길이가 0이면 1로 본다. */
  readonly progress: number;
  readonly transform: ResolvedTransform;
  /** 소재 안에서 읽어야 할 시각(초). 트림을 반영한 값이다. */
  readonly sourceTime: number;
  readonly resolved: ResolvedItem;
  /** `caption` 에서 지금 보여야 할 큐들. 다른 종류에서는 빈 배열. */
  readonly cues: readonly CaptionCue[];
  /** §5.13 (V) 37-8 — 전환이 잘라 보이게 한 사각형(문서 픽셀). 이 밖은 그리지 않는다. */
  readonly clip?: TransitionRect;
  /** §5.13 (V) 37-8 — 문서에 없는 덧그림(빛 번짐). 고르기·가리키기 대상이 아니다. */
  readonly synthetic?: true;
  /** §5.13 (W) 38-5 — 이펙트를 접은 CSS 필터 문자열(DOM `filter` · canvas `ctx.filter` 가 같은 값을 쓴다). 없으면 그대로. */
  readonly filter?: string;
  /** §5.13 (W) 38-5 — 비네트 세기 0~1(상자 위에 덧칠). */
  readonly vignette?: number;
}

/** §5.13 (V) 37-8 — 빛 번짐 덧그림의 색(영상 그림 — 화면 테마가 아니다). */
const FLASH_FILL = '#FFFFFF';

/**
 * §5.13 (V) 37-10 — 문서 스타일이 있으면 기본 씬·글자·도형·자막의 **기본값**이 그 스타일에서 온다(아이템이 직접 적은 값이
 * 이긴다). 세 백엔드가 모두 아이템 `props` 를 읽으므로 그리기 목록 한 곳에서 기본값을 얹는다 — 장면마다 팔레트가 따로 놀지 않게.
 */
function styleDefaults(kind: VideoItemKind, style: VideoDoc['style']): Readonly<Record<string, unknown>> | null {
  if (!style) return null;
  const font = style.fontFamily ? { fontFamily: style.fontFamily } : {};
  switch (kind) {
    case 'text':
      return { color: style.fg, ...font };
    case 'caption':
      // §5.13 (V) 37-12 — 단어 강조의 강조색도 스타일 강조색이 기본이다.
      return { color: style.fg, highlightColor: style.accent, ...font };
    case 'scene':
      return { color: style.fg, accent: style.accent, ...font };
    case 'shape':
      return { fill: style.accent };
    default:
      return null;
  }
}

function withStyleDefaults(resolved: ResolvedItem, style: VideoDoc['style']): ResolvedItem {
  const defaults = styleDefaults(resolved.kind, style);
  if (!defaults) return resolved;
  return { ...resolved, item: { ...resolved.item, props: { ...defaults, ...(resolved.item.props ?? {}) } } };
}

/**
 * 시각 t 에 이 장면이 전환 구간에 있으면 그 효과(들어옴/나감). 장면 밖·전환 없음이면 null.
 * 들어오는 전환은 장면 시작부터 겹침 길이까지, 나가는 전환은 **다음 장면**의 들어오는 겹침 구간이다.
 */
function chapterTransitionAt(chapters: readonly ResolvedChapter[], index: number, t: number): { kind: NonNullable<ResolvedChapter['chapter']['transition']>['kind']; phase: 'in' | 'out'; p: number } | null {
  const c = chapters[index];
  if (!c) return null;
  const tin = c.chapter.transition;
  if (tin && tin.kind !== 'cut' && c.overlapIn > 0 && t >= c.start && t < c.start + c.overlapIn) {
    return { kind: tin.kind, phase: 'in', p: (t - c.start) / c.overlapIn };
  }
  const n = chapters[index + 1];
  const tout = n?.chapter.transition;
  if (n && tout && tout.kind !== 'cut' && n.overlapIn > 0 && t >= n.start && t < n.start + n.overlapIn) {
    return { kind: tout.kind, phase: 'out', p: (t - n.start) / n.overlapIn };
  }
  return null;
}

function resolveTransform(size: VideoDoc['size'], t?: VideoTransform): ResolvedTransform {
  return {
    x: t?.x ?? 0,
    y: t?.y ?? 0,
    width: t?.width ?? size.width,
    height: t?.height ?? size.height,
    rotation: t?.rotation ?? 0,
    opacity: t?.opacity ?? 1,
    scale: t?.scale ?? 1,
  };
}

/** §5.13 (W) 38-4 — 상자의 시간 곡선을 얹는다(상대값 — 옮기고, 곱하고, 더한다). 키프레임이 없으면 그대로. */
function withKeyframes(base: ResolvedTransform, keyframes: readonly VideoKeyframe[] | undefined, localTime: number): ResolvedTransform {
  if (!keyframes || keyframes.length === 0) return base;
  const k = sampleKeyframes(keyframes, localTime);
  return {
    ...base,
    x: base.x + k.dx,
    y: base.y + k.dy,
    scale: base.scale * k.scale,
    rotation: base.rotation + k.rotation,
    opacity: base.opacity * Math.max(0, Math.min(1, k.opacity)),
  };
}

/** 트랙 순서 = 그리는 순서. 문서에 적힌 순서를 그대로 앞뒤로 쓴다. */
function trackDepth(doc: VideoDoc): Map<string, number> {
  const depth = new Map<string, number>();
  doc.tracks.forEach((track, i) => depth.set(track.id, i));
  return depth;
}

/** 오디오 트랙·꺼 둔 아이템·숨긴 트랙은 빠진다. 시각 계산이 끝난 뒤라 빼도 남은 것의 위치가 흔들리지 않는다. */
export function buildDrawList(doc: VideoDoc, timeline: ResolvedTimeline, t: number): DrawOp[] {
  const depth = trackDepth(doc);
  const hidden = new Set<string>();
  for (const track of doc.tracks) {
    if (track.hidden === true) hidden.add(track.id);
  }

  const ops: DrawOp[] = [];
  // §5.13 (V) 37-14 — 고르지 않은 갈래는 그리지 않는다(문서에는 남는다).
  const chapters = chapterMap(doc);
  // §5.13 (V) 37-8 — 장면 id → 해소된 장면의 순번(전환 구간 판정).
  const chapterIndex = new Map(timeline.chapters.map((c, i) => [c.id, i]));
  const full: TransitionRect = { x: 0, y: 0, width: doc.size.width, height: doc.size.height };

  for (const resolved of timeline.items) {
    if (resolved.trackKind === 'audio') continue;
    if (resolved.item.enabled === false) continue;
    if (isUnpickedVariant(chapters, resolved.item)) continue;
    if (hidden.has(resolved.trackId)) continue;
    if (t < resolved.start || t >= resolved.end) continue;

    const localTime = t - resolved.start;
    const progress = resolved.duration > 0 ? Math.min(1, Math.max(0, localTime / resolved.duration)) : 1;
    const sourceTime = (resolved.item.trimStart ?? 0) + localTime;

    const cues =
      resolved.kind === 'caption' && resolved.item.cues
        ? resolved.item.cues.filter((c) => t >= c.start && t < c.end)
        : [];

    let transform = withKeyframes(resolveTransform(doc.size, resolved.item.transform), resolved.item.keyframes, localTime);
    let clip: TransitionRect | undefined;
    const chapterId = chapterIdOf(resolved.item);
    const index = chapterId !== undefined ? chapterIndex.get(chapterId) : undefined;
    const active = index !== undefined ? chapterTransitionAt(timeline.chapters, index, t) : null;
    if (active) {
      const fx = transitionEffect(active.kind, active.phase, active.p, doc.size);
      if (fx.opacity <= 0) continue;
      transform = { ...transform, x: transform.x + fx.dx, y: transform.y + fx.dy, scale: transform.scale * fx.scale, opacity: transform.opacity * fx.opacity };
      if (fx.clip) clip = intersectRect(fx.clip, full);
    }

    // §5.13 (W) 38-5 — 이펙트는 아이템 단위로 한 번 접는다(세 백엔드가 같은 문자열을 쓴다).
    const fx = effectsToFilter(resolved.item.effects);
    ops.push({
      itemId: resolved.id,
      kind: resolved.kind,
      z: depth.get(resolved.trackId) ?? 0,
      localTime,
      progress,
      transform,
      sourceTime,
      resolved: withStyleDefaults(resolved, doc.style),
      cues,
      ...(clip ? { clip } : {}),
      ...(fx.filter !== '' ? { filter: fx.filter } : {}),
      ...(fx.vignette > 0 ? { vignette: fx.vignette } : {}),
    });
  }

  // 같은 깊이면 타임라인 정렬(시작 시각) 순서를 유지한다 — 안정 정렬.
  ops.sort((a, b) => a.z - b.z);

  // §5.13 (V) 37-8 — 빛 번짐: 그 전환 구간 동안 맨 위에 흰 덧그림 하나(가운데에서 가장 밝다).
  const top = ops.reduce((m, op) => Math.max(m, op.z), 0) + 1;
  for (const c of timeline.chapters) {
    const tr = c.chapter.transition;
    if (!tr || tr.kind !== 'flash' || c.overlapIn <= 0 || t < c.start || t >= c.start + c.overlapIn) continue;
    const p = (t - c.start) / c.overlapIn;
    const id = `__transition-flash-${c.id}`;
    const item = { id, kind: 'shape' as const, at: c.start, duration: c.overlapIn, props: { shape: 'rect', fill: FLASH_FILL } };
    ops.push({
      itemId: id,
      kind: 'shape',
      z: top,
      localTime: t - c.start,
      progress: p,
      transform: { ...resolveTransform(doc.size, undefined), opacity: flashAlpha(p) },
      sourceTime: t - c.start,
      resolved: { id, trackId: '__transition', trackKind: 'visual', kind: 'shape', start: c.start, end: c.start + c.overlapIn, duration: c.overlapIn, item },
      cues: [],
      synthetic: true,
    });
  }
  return ops;
}

/**
 * §5.13 (Y) 40-2 ① — 실효 이득 0(볼륨 0·트랙 음소거·꺼 둔 아이템·고르지 않은 갈래)은 뺀다 — 안 빼면 볼륨 0 실사까지 통째로 받아 디코딩한다.
 * 미리보기와 렌더가 이 한 함수를 쓴다(37-12 같은 믹서).
 */
export function audioItemsAt(doc: VideoDoc, timeline: ResolvedTimeline): readonly ResolvedItem[] {
  const muted = new Set<string>();
  for (const track of doc.tracks) {
    if (track.muted === true) muted.add(track.id);
  }
  const chapters = chapterMap(doc);
  return timeline.items.filter((it) => {
    if (it.item.enabled === false || muted.has(it.trackId) || isUnpickedVariant(chapters, it.item)) return false;
    const volume = it.item.props?.['volume'];
    if (typeof volume === 'number' && Number.isFinite(volume) && volume <= 0) return false;
    if (it.trackKind === 'audio') return true;
    if (it.kind !== 'footage') return false;
    const asset = it.item.assetId ? doc.assets[it.item.assetId] : undefined;
    // Legacy video assets have no probe result: let the audio decoder decide.
    return asset !== undefined && asset.hasAudio !== false;
  });
}

/** 지금 보여야 할 자막 글자. 자동 검수가 "자막이 비었나"를 볼 때 쓴다. */
export function captionTextAt(ops: readonly DrawOp[]): string {
  return ops
    .filter((o) => o.kind === 'caption')
    .flatMap((o) => o.cues.map((c) => c.text))
    .join(' ')
    .trim();
}
