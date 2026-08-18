/**
 * 그리기 목록 (SCENARIO.md §5.13 (E)).
 *
 * "시각 t 에 무엇을 어디에 그리는가"를 **순수 함수 하나**로 만든다. 백엔드가 셋이나
 * 되므로 이 계산이 백엔드 안에 흩어지면 같은 문서가 방식마다 다르게 보인다.
 *
 * 여기가 "매 프레임 재실행을 폐기한다"가 실제로 구현되는 자리다 — 씬 컴포넌트를 매
 * 프레임 다시 실행하는 대신, 선언된 값에 시각 t 를 먹여 **그릴 것의 목록만** 뽑는다.
 * 목록을 만드는 비용은 아이템 수에 비례할 뿐 씬 내부 복잡도와 무관하다.
 */

import type { CaptionCue, ResolvedItem, ResolvedTimeline, VideoDoc, VideoItemKind, VideoTransform } from '../types.js';

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

/** 트랙 순서 = 그리는 순서. 문서에 적힌 순서를 그대로 앞뒤로 쓴다. */
function trackDepth(doc: VideoDoc): Map<string, number> {
  const depth = new Map<string, number>();
  doc.tracks.forEach((track, i) => depth.set(track.id, i));
  return depth;
}

/**
 * 시각 t 에 그릴 것을 뽑는다.
 *
 * 오디오 트랙은 화면에 그릴 것이 없으므로 여기서 빠진다(소리는 별도 경로로 섞인다).
 * 꺼 둔 아이템과 숨긴 트랙도 빠지지만, **시각 계산은 이미 끝난 상태**라 그것들을
 * 빼도 남은 것의 위치가 흔들리지 않는다.
 */
export function buildDrawList(doc: VideoDoc, timeline: ResolvedTimeline, t: number): DrawOp[] {
  const depth = trackDepth(doc);
  const hidden = new Set<string>();
  for (const track of doc.tracks) {
    if (track.hidden === true) hidden.add(track.id);
  }

  const ops: DrawOp[] = [];

  for (const resolved of timeline.items) {
    if (resolved.trackKind === 'audio') continue;
    if (resolved.item.enabled === false) continue;
    if (hidden.has(resolved.trackId)) continue;
    if (t < resolved.start || t >= resolved.end) continue;

    const localTime = t - resolved.start;
    const progress = resolved.duration > 0 ? Math.min(1, Math.max(0, localTime / resolved.duration)) : 1;
    const sourceTime = (resolved.item.trimStart ?? 0) + localTime;

    const cues =
      resolved.kind === 'caption' && resolved.item.cues
        ? resolved.item.cues.filter((c) => t >= c.start && t < c.end)
        : [];

    ops.push({
      itemId: resolved.id,
      kind: resolved.kind,
      z: depth.get(resolved.trackId) ?? 0,
      localTime,
      progress,
      transform: resolveTransform(doc.size, resolved.item.transform),
      sourceTime,
      resolved,
      cues,
    });
  }

  // 같은 깊이면 타임라인 정렬(시작 시각) 순서를 유지한다 — 안정 정렬.
  ops.sort((a, b) => a.z - b.z);
  return ops;
}

/**
 * 지금 소리 나야 할 오디오 아이템.
 *
 * 화면과 분리해 두는 이유는 오디오가 프레임 단위가 아니라 구간 단위로 섞이기
 * 때문이다 — 프레임마다 물어볼 필요가 없다.
 */
export function audioItemsAt(doc: VideoDoc, timeline: ResolvedTimeline): readonly ResolvedItem[] {
  const muted = new Set<string>();
  for (const track of doc.tracks) {
    if (track.muted === true) muted.add(track.id);
  }
  return timeline.items.filter(
    (it) => it.trackKind === 'audio' && it.item.enabled !== false && !muted.has(it.trackId),
  );
}

/** 지금 보여야 할 자막 글자. 자동 검수가 "자막이 비었나"를 볼 때 쓴다. */
export function captionTextAt(ops: readonly DrawOp[]): string {
  return ops
    .filter((o) => o.kind === 'caption')
    .flatMap((o) => o.cues.map((c) => c.text))
    .join(' ')
    .trim();
}
