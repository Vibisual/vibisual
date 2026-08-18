/**
 * 타임라인 해소기 (SCENARIO.md §5.13 (D)(E)).
 *
 * 문서에 적힌 **상대 앵커와 `'auto'` 길이**를 실제 초 단위 시각으로 푼다.
 * 렌더러는 이 결과만 보고 그리므로, 시간 계산의 진실은 오직 이 파일 하나다.
 *
 * 순수 함수인 이유: 시간 계산은 화면 없이 전부 검증할 수 있어야 하고, 렌더 백엔드가
 * 셋(§5.13 (F))이나 되므로 백엔드마다 시간이 다르게 나오는 일이 있어서는 안 된다.
 *
 * 설계 결정 두 가지를 여기 적어 둔다:
 *
 * 1. **꺼 둔 아이템도 시각은 계산한다.** `enabled:false` 를 타임라인에서 통째로 빼면
 *    그 아이템을 앵커로 삼던 뒤쪽이 전부 밀린다. 컷 하나를 잠깐 꺼 보는 것이 영상
 *    전체를 재배치하는 일이 되어서는 안 된다. 그래서 시각은 그대로 두고 렌더에서만
 *    빠지며, 전체 길이 계산에서도 빠진다.
 * 2. **실패해도 던지지 않는다.** 잘못된 앵커 하나가 문서 전체를 못 열게 만들면
 *    에이전트가 스스로 고칠 방법이 없다. 문제 있는 아이템만 빼고 나머지는 그리되,
 *    무엇이 왜 빠졌는지를 `diagnostics` 로 남긴다.
 */

import type {
  ResolveDiagnostic,
  ResolvedItem,
  ResolvedTimeline,
  TimeAnchor,
  VideoAsset,
  VideoDoc,
  VideoDuration,
  VideoItem,
  VideoTrackKind,
} from './types.js';

interface ItemEntry {
  readonly item: VideoItem;
  readonly trackId: string;
  readonly trackKind: VideoTrackKind;
  readonly trackIndex: number;
  readonly itemIndex: number;
}

/** 한 아이템의 확정된 시각. `failed` 면 진단이 이미 기록돼 있다. */
interface Timing {
  readonly start: number;
  readonly duration: number;
  readonly failed: boolean;
}

const FAILED: Timing = { start: 0, duration: 0, failed: true };

/** 앵커가 가리키는 아이템 id. 절대 시각이면 없다. */
function anchorRef(at: TimeAnchor): string | undefined {
  if (typeof at === 'number') return undefined;
  return 'after' in at ? at.after : at.start;
}

function anchorOffset(at: TimeAnchor): number {
  if (typeof at === 'number') return 0;
  return at.offset ?? 0;
}

/**
 * `'auto'` 길이를 푼다.
 *
 * 오디오·영상은 소재의 실측 길이에서 트림한 만큼을 뺀 값이고, 자막은 큐가 덮는
 * 구간이다. 그 밖의 종류(씬·도형·텍스트)는 스스로 길이를 알 방법이 없으므로
 * `'auto'` 를 쓸 수 없다 — 이건 문서 작성자의 실수이지 렌더러가 추측할 일이 아니다.
 */
function resolveAutoDuration(
  entry: ItemEntry,
  assets: Readonly<Record<string, VideoAsset>>,
  push: (d: ResolveDiagnostic) => void,
): number | undefined {
  const { item, trackId } = entry;

  if (item.kind === 'caption') {
    const cues = item.cues;
    if (!cues || cues.length === 0) {
      push({
        level: 'error',
        code: 'empty-caption',
        itemId: item.id,
        trackId,
        message: `자막 '${item.id}' 가 duration:'auto' 인데 큐가 없습니다.`,
      });
      return undefined;
    }
    let min = Infinity;
    let max = -Infinity;
    for (const cue of cues) {
      if (cue.start < min) min = cue.start;
      if (cue.end > max) max = cue.end;
    }
    return Math.max(0, max - min);
  }

  if (item.assetId === undefined) {
    push({
      level: 'error',
      code: 'auto-without-source',
      itemId: item.id,
      trackId,
      message: `'${item.id}' 는 duration:'auto' 인데 참조하는 소재가 없습니다. 초 단위 길이를 직접 지정하세요.`,
    });
    return undefined;
  }

  const asset = assets[item.assetId];
  if (!asset) {
    push({
      level: 'error',
      code: 'unknown-asset',
      itemId: item.id,
      trackId,
      message: `'${item.id}' 가 없는 소재 '${item.assetId}' 를 참조합니다.`,
    });
    return undefined;
  }

  if (asset.duration === undefined) {
    push({
      level: 'error',
      code: 'auto-without-duration',
      itemId: item.id,
      trackId,
      message: `소재 '${asset.id}' 의 길이가 아직 측정되지 않아 duration:'auto' 를 풀 수 없습니다.`,
    });
    return undefined;
  }

  return Math.max(0, asset.duration - (item.trimStart ?? 0));
}

function resolveDuration(
  entry: ItemEntry,
  assets: Readonly<Record<string, VideoAsset>>,
  push: (d: ResolveDiagnostic) => void,
): number | undefined {
  const raw: VideoDuration = entry.item.duration;
  if (raw === 'auto') return resolveAutoDuration(entry, assets, push);

  if (!Number.isFinite(raw) || raw < 0) {
    push({
      level: 'error',
      code: 'negative-duration',
      itemId: entry.item.id,
      trackId: entry.trackId,
      message: `'${entry.item.id}' 의 길이 ${String(raw)} 는 유효하지 않습니다.`,
    });
    return undefined;
  }
  return raw;
}

/**
 * 문서를 실제 시각으로 해소한다.
 *
 * 앵커가 서로를 가리키므로 재귀로 풀되, 방문 중인 아이템을 다시 만나면 순환으로 보고
 * 끊는다(순환은 사람이 문서를 손으로 고치다 충분히 만들 수 있는 상태이므로 앱이
 * 멈추는 대신 그 고리만 빼고 나머지를 그린다).
 */
export function resolveTimeline(doc: VideoDoc): ResolvedTimeline {
  const diagnostics: ResolveDiagnostic[] = [];
  const push = (d: ResolveDiagnostic): void => {
    diagnostics.push(d);
  };

  // 1) 아이템 수집 + 중복 id 검출.
  const entries = new Map<string, ItemEntry>();
  const order: string[] = [];

  doc.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      if (entries.has(item.id)) {
        push({
          level: 'error',
          code: 'duplicate-item-id',
          itemId: item.id,
          trackId: track.id,
          message: `아이템 id '${item.id}' 가 중복입니다. 참조가 어느 쪽을 가리키는지 알 수 없어 뒤엣것을 버립니다.`,
        });
        return;
      }
      entries.set(item.id, {
        item,
        trackId: track.id,
        trackKind: track.kind,
        trackIndex,
        itemIndex,
      });
      order.push(item.id);
    });
  });

  // 2) 앵커 해소 — 방문 상태로 순환을 잡는다.
  const timings = new Map<string, Timing>();
  const visiting = new Set<string>();

  const resolveOne = (id: string): Timing => {
    const cached = timings.get(id);
    if (cached) return cached;

    const entry = entries.get(id);
    if (!entry) return FAILED;

    if (visiting.has(id)) {
      push({
        level: 'error',
        code: 'anchor-cycle',
        itemId: id,
        trackId: entry.trackId,
        message: `'${id}' 의 앵커가 순환합니다. 이 고리에 속한 아이템은 배치할 수 없습니다.`,
      });
      timings.set(id, FAILED);
      return FAILED;
    }

    visiting.add(id);
    let result: Timing = FAILED;

    try {
      const duration = resolveDuration(entry, doc.assets, push);
      if (duration === undefined) {
        return (result = FAILED);
      }

      const at = entry.item.at;
      const refId = anchorRef(at);

      let start: number;
      if (refId === undefined) {
        start = typeof at === 'number' ? at : 0;
      } else {
        const ref = entries.get(refId);
        if (!ref) {
          push({
            level: 'error',
            code: 'unknown-anchor',
            itemId: id,
            trackId: entry.trackId,
            message: `'${id}' 가 없는 아이템 '${refId}' 를 기준으로 배치돼 있습니다.`,
          });
          return (result = FAILED);
        }
        const base = resolveOne(refId);
        if (base.failed) return (result = FAILED);

        const isAfter = typeof at !== 'number' && 'after' in at;
        start = (isAfter ? base.start + base.duration : base.start) + anchorOffset(at);
      }

      if (!Number.isFinite(start)) {
        push({
          level: 'error',
          code: 'negative-start',
          itemId: id,
          trackId: entry.trackId,
          message: `'${id}' 의 시작 시각을 계산할 수 없습니다.`,
        });
        return (result = FAILED);
      }

      // 음수 시작은 0으로 당기되 조용히 넘어가지 않는다 — 화면에는 나오는데 왜
      // 앞부분이 잘렸는지 모르는 상태가 가장 나쁘다.
      if (start < 0) {
        push({
          level: 'warn',
          code: 'negative-start',
          itemId: id,
          trackId: entry.trackId,
          message: `'${id}' 의 시작이 ${start.toFixed(3)}초로 0보다 앞이라 0으로 당겼습니다.`,
        });
        start = 0;
      }

      return (result = { start, duration, failed: false });
    } finally {
      visiting.delete(id);
      timings.set(id, result);
    }
  };

  for (const id of order) resolveOne(id);

  // 3) 결과 조립 — 시작 시각, 트랙 순서, 트랙 내 순서로 안정 정렬한다.
  const items: ResolvedItem[] = [];
  for (const id of order) {
    const entry = entries.get(id);
    const timing = timings.get(id);
    if (!entry || !timing || timing.failed) continue;
    items.push({
      id,
      trackId: entry.trackId,
      trackKind: entry.trackKind,
      kind: entry.item.kind,
      start: timing.start,
      end: timing.start + timing.duration,
      duration: timing.duration,
      item: entry.item,
    });
  }

  items.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const ea = entries.get(a.id);
    const eb = entries.get(b.id);
    if (!ea || !eb) return 0;
    if (ea.trackIndex !== eb.trackIndex) return ea.trackIndex - eb.trackIndex;
    return ea.itemIndex - eb.itemIndex;
  });

  // 4) 전체 길이 — 꺼 둔 아이템은 영상을 늘리지 않는다.
  let duration = 0;
  for (const it of items) {
    if (it.item.enabled === false) continue;
    if (it.end > duration) duration = it.end;
  }

  return { items, duration, diagnostics };
}

/** 렌더에 실제로 그려질 아이템만. 꺼 둔 것과 숨긴 트랙은 여기서 빠진다. */
export function activeItems(doc: VideoDoc, timeline: ResolvedTimeline): readonly ResolvedItem[] {
  const hidden = new Set<string>();
  for (const track of doc.tracks) {
    if (track.hidden === true || track.muted === true) hidden.add(track.id);
  }
  return timeline.items.filter((it) => it.item.enabled !== false && !hidden.has(it.trackId));
}

/** 특정 시각에 살아 있는 아이템. 스틸 한 장을 뽑을 때 쓴다. */
export function itemsAt(items: readonly ResolvedItem[], t: number): readonly ResolvedItem[] {
  return items.filter((it) => t >= it.start && t < it.end);
}

/**
 * 컷 경계 목록.
 *
 * 자동 검수(§5.13 (G))가 "여기 스틸을 떠 보라"고 쓸 지점이다. 아이템이 나타나거나
 * 사라지는 순간이 곧 사람이 이상을 느끼는 지점이라 그 자리를 검사한다.
 */
export function cutPoints(items: readonly ResolvedItem[]): readonly number[] {
  const set = new Set<number>();
  for (const it of items) {
    if (it.trackKind === 'audio') continue;
    set.add(Number(it.start.toFixed(6)));
    set.add(Number(it.end.toFixed(6)));
  }
  return [...set].sort((a, b) => a - b);
}

/** 초 → 프레임. fps 는 이 경계에서만 등장한다(§5.13 (D)). */
export function secondsToFrame(t: number, fps: number): number {
  return Math.round(t * fps);
}

/** 프레임 → 초. */
export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}
