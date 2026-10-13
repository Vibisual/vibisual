import type { ResolvedTimeline, VideoDoc, VideoDocOp, VideoItem } from '@vibisual/video';

/**
 * §5.13 (T-8) — 정밀 편집 **표지 줄**에 세울 것들(순수). 줄은 하나, 출처는 둘이다: 컴포지션이 알린 표지(위에서 내려온다)와
 * 음악 비트(아래에서 올라온다 — (V) 37-12). 시각은 전부 문서 시각(아이템 시작 + 소재 시각 − 앞 트림)이고, 아이템의 보이는
 * 구간 밖은 세우지 않는다(해소기의 `cue-outside` 와 같은 선).
 */
export interface CueMark {
  readonly key: string;
  readonly name: string;
  /** 문서 시각(초). */
  readonly t: number;
  /** 표지를 알린 composition 아이템. */
  readonly itemId: string;
  /** 코드가 바뀌어 다시 모으는 중(흐리게). */
  readonly stale: boolean;
  /** 이 표지에 묶인 아이템들. */
  readonly bound: readonly string[];
}

export interface BeatMark {
  readonly key: string;
  readonly t: number;
  readonly strong: boolean;
}

export interface TimelineSignals {
  readonly cues: readonly CueMark[];
  readonly beats: readonly BeatMark[];
  /** 표지를 부르는 컴포지션 중 다시 모으는 중인 것이 있다. */
  readonly collecting: boolean;
  /** 표지를 부르는 컴포지션이 하나라도 놓여 있다(표지가 아직 없어도 줄을 세운다). */
  readonly hasCueSources: boolean;
}

/** 한 줄에 세울 비트 상한(긴 음악에서 DOM 이 수천 개로 불지 않게). */
const BEAT_MARK_MAX = 1500;

function cueAnchor(item: VideoItem): { cue: string; item: string } | null {
  const at = item.at;
  return typeof at === 'object' && at !== null && 'cue' in at ? { cue: at.cue, item: at.item } : null;
}

export function collectTimelineSignals(doc: VideoDoc, timeline: ResolvedTimeline): TimelineSignals {
  const boundBy = new Map<string, string[]>();
  for (const track of doc.tracks) {
    for (const item of track.items) {
      const anchor = cueAnchor(item);
      if (!anchor) continue;
      const key = `${anchor.item}\u0000${anchor.cue}`;
      boundBy.set(key, [...(boundBy.get(key) ?? []), item.id]);
    }
  }

  const cues: CueMark[] = [];
  const beats: BeatMark[] = [];
  let collecting = false;
  let hasCueSources = false;
  for (const resolved of timeline.items) {
    const assetId = resolved.item.assetId;
    const asset = assetId === undefined ? undefined : doc.assets[assetId];
    if (!asset) continue;
    const trim = resolved.item.trimStart ?? 0;
    const inside = (local: number): number | null => {
      const t = resolved.start + (local - trim);
      return t >= resolved.start - 1e-6 && t <= resolved.end + 1e-6 ? t : null;
    };
    if (resolved.kind === 'composition' && (asset.usesCues === true || (asset.cues?.length ?? 0) > 0)) {
      hasCueSources = true;
      const stale = asset.usesCues === true && asset.cuesHash !== asset.contentHash;
      if (stale) collecting = true;
      for (const cue of asset.cues ?? []) {
        const t = inside(cue.t);
        if (t === null) continue;
        cues.push({
          key: `${resolved.id}:${cue.name}:${cue.t}`,
          name: cue.name,
          t,
          itemId: resolved.id,
          stale,
          bound: boundBy.get(`${resolved.id}\u0000${cue.name}`) ?? [],
        });
      }
    }
    if (resolved.trackKind === 'audio' && asset.beats && asset.beats.length > 0 && beats.length < BEAT_MARK_MAX) {
      const strong = new Set(asset.beatsStrong ?? []);
      for (const beat of asset.beats) {
        if (beats.length >= BEAT_MARK_MAX) break;
        const t = inside(beat);
        if (t !== null) beats.push({ key: `${resolved.id}:${beat}`, t, strong: strong.has(beat) });
      }
    }
  }
  cues.sort((a, b) => a.t - b.t);
  return { cues, beats, collecting, hasCueSources };
}

/** 고른 아이템을 그 표지에 묶는 연산(앞뒤 여백 0 — 떼면 그 자리 숫자로 풀린다). 묶을 수 없으면 빈 배열. */
export function bindToCueOps(doc: VideoDoc, itemId: string, mark: CueMark): VideoDocOp[] {
  if (itemId === mark.itemId) return [];
  const exists = doc.tracks.some((track) => track.items.some((item) => item.id === itemId));
  if (!exists) return [];
  return [{ op: 'updateItem', itemId, patch: { at: { cue: mark.name, item: mark.itemId } } }];
}

/** 표지에서 떼는 연산 — 지금 해소된 시작 시각(숫자)으로 남긴다. 해소되지 않은 아이템이면 표지 시각으로. */
export function unbindFromCueOps(timeline: ResolvedTimeline, itemId: string, fallback: number): VideoDocOp[] {
  const resolved = timeline.items.find((item) => item.id === itemId);
  const start = Math.round((resolved?.start ?? fallback) * 1000) / 1000;
  return [{ op: 'updateItem', itemId, patch: { at: Math.max(0, start) } }];
}
