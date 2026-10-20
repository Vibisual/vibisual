import { formatClipTime, type AudioDoc, type AudioTimelineClip, type AudioTrack } from '@vibisual/audio';
import type { InspectorPickLevel, InspectorPickLevels, InspectorPickPoint } from '../../utils/inspectorPick.js';
import { SOUND_API } from './soundApi.js';
import type { SoundRange } from './soundConfig.js';

/**
 * §5.4 #15 (C) — Alt 인스펙터가 소리 화면 안을 집는다. 파형은 캔버스 한 장이고 트랙 줄은 SVG 라, 브라우저는 그 판만 안다 —
 * 그래서 "그 자리가 몇 초이고 거기서 무엇이 울리나"를 문서로 답한다. 복사 글은 받는 AI 가 문서 API 로 바로 고칠 수 있게
 * 문서·트랙·클립의 안정 id 와 프로젝트 초를 싣는다(에이전트 위임 규약 `audioDelegate.ts` 와 같은 좌표).
 */

export interface SoundInspectContext {
  readonly projectId: string;
  readonly doc: AudioDoc;
  /** 원본 듣기 중이면 그 클립 — 파형에는 그 클립만 들린다(`sourceAuditionDoc`). */
  readonly auditionClipId: string | null;
}

/** 화면과 같은 글 — 칸 이름에 쓴다. */
export interface SoundInspectLabels {
  /** 이름 없는 트랙. */
  readonly track: string;
  /** 고른 구간 칸 — `구간 00:01.20–00:03.40`. */
  readonly range: (start: string, end: string) => string;
}

/** 파형의 "그 시각" 칸 — 커서 둘레의 가는 띠(px). */
const MOMENT_HALF_WIDTH = 3;
/** 트랙 줄 SVG 의 viewBox(`SoundTracks`) — 클립 상자의 세로 자리와 최소 폭. */
export const SOUND_LANE_VIEW = { width: 1000, height: 42, clipTop: 5, clipHeight: 32, clipMinWidth: 4 } as const;

const seconds = (value: number): string => `${value.toFixed(3)}s`;
const quote = (text: string): string => JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function trackName(track: AudioTrack, labels: SoundInspectLabels): string {
  return track.label ?? labels.track;
}

function clipName(doc: AudioDoc, clip: AudioTimelineClip): string {
  return clip.label ?? doc.assets[clip.assetId]?.name ?? clip.id;
}

function docDuration(doc: AudioDoc): number {
  return Math.max(0, ...doc.tracks.flatMap((track) => track.clips.map((clip) => clip.at + clip.duration)));
}

interface ClipHit {
  readonly track: AudioTrack;
  readonly clip: AudioTimelineClip;
}

/** 그 시각에 실제로 들리는 클립 — 믹스 규칙(`renderDoc` — 음소거·솔로·꺼진 클립)과 원본 듣기를 따른다. */
export function soundingClipsAt(ctx: SoundInspectContext, t: number): readonly ClipHit[] {
  const solo = ctx.doc.tracks.some((track) => track.solo);
  const hits: ClipHit[] = [];
  for (const track of ctx.doc.tracks) {
    for (const clip of track.clips) {
      if (t < clip.at || t >= clip.at + clip.duration) continue;
      if (ctx.auditionClipId !== null) {
        if (clip.id === ctx.auditionClipId) hits.push({ track, clip });
        continue;
      }
      if (track.muted || (solo && !track.solo) || clip.enabled === false) continue;
      hits.push({ track, clip });
    }
  }
  return hits;
}

/** 받는 AI 가 읽는 클립 한 줄 — 프로젝트 초 · 원본 초 · 상태. */
export function describeSoundClip(doc: AudioDoc, track: AudioTrack, clip: AudioTimelineClip, labels: SoundInspectLabels): string {
  const asset = doc.assets[clip.assetId];
  const flags = [
    clip.enabled === false ? 'disabled' : '',
    track.muted ? 'track muted' : '',
    clip.locked ? 'locked' : '',
  ].filter(Boolean);
  return `clip ${quote(clipName(doc, clip))} id "${clip.id}" on track ${quote(trackName(track, labels))} id "${track.id}"`
    + ` (project ${seconds(clip.at)}–${seconds(clip.at + clip.duration)}, from ${seconds(clip.sourceStart)} of ${asset ? `asset ${quote(asset.name)} id "${asset.id}"` : `asset "${clip.assetId}"`}`
    + `${flags.length ? `, ${flags.join(', ')}` : ''})`;
}

/** 복사 글 세 줄 — 문서 · 가리킨 것 · 고치는 길(이 문서의 실제 주소). */
export function buildSoundPickClipboard(ctx: SoundInspectContext, pointed: string): string {
  const route = `$VIBISUAL_BASE${SOUND_API}/doc/${encodeURIComponent(ctx.doc.id)}`;
  const query = `?project=${encodeURIComponent(ctx.projectId)}`;
  return [
    `[Sound] document "${ctx.doc.id}" (${quote(ctx.doc.title)}, version ${ctx.doc.version}, ${seconds(docDuration(ctx.doc))}) in project ${quote(ctx.projectId)}`,
    `[Pointed] ${pointed}`,
    `[Hint] This is sound document data, not app code. Change it through the Vibisound API: GET ${route}${query} for the latest version`
      + ` (and GET $VIBISUAL_BASE${SOUND_API}/capabilities for operations), then POST ${route}/patch. Times are project seconds unless noted.`,
  ].join('\n');
}

function band(x0: number, x1: number, width: number, height: number): InspectorPickLevel['rect'] {
  const left = clamp(Math.min(x0, x1), 0, width);
  const right = clamp(Math.max(x0, x1), 0, width);
  return { x: left, y: 0, width: Math.max(1, right - left), height };
}

function clipLevel(ctx: SoundInspectContext, hit: ClipHit, labels: SoundInspectLabels, rect: InspectorPickLevel['rect']): InspectorPickLevel {
  return {
    rect,
    label: `${clipName(ctx.doc, hit.clip)} · ${trackName(hit.track, labels)}`,
    text: `${formatClipTime(hit.clip.at)}–${formatClipTime(hit.clip.at + hit.clip.duration)}`,
    clipboard: buildSoundPickClipboard(ctx, describeSoundClip(ctx.doc, hit.track, hit.clip, labels)),
  };
}

/**
 * 파형 — 가장 안쪽이 **그 시각**(커서 둘레의 가는 띠), 그다음 그 시각에 들리는 클립들(위 트랙부터), 고른 구간 안이면 그 구간.
 * 파형의 가로는 보이는 창(`start`~`start+span`)이고 세로는 시각과 무관하다.
 */
export function soundWaveLevels(
  ctx: SoundInspectContext,
  view: { readonly start: number; readonly span: number },
  selection: SoundRange | null,
  labels: SoundInspectLabels,
  at: InspectorPickPoint,
): InspectorPickLevels {
  if (view.span <= 0 || at.width <= 0 || at.height <= 0) return [];
  const t = view.start + clamp(at.x / at.width, 0, 1) * view.span;
  const px = (time: number): number => (time - view.start) / view.span * at.width;
  const hits = soundingClipsAt(ctx, t);
  const mode = ctx.auditionClipId !== null ? 'the original of the auditioned clip' : 'the mix';
  const here = hits.length
    ? ` — sounding: ${hits.map((hit) => describeSoundClip(ctx.doc, hit.track, hit.clip, labels)).join('; ')}`
    : ' — silence (no clip sounds here)';
  const levels: InspectorPickLevel[] = [{
    rect: band(at.x - MOMENT_HALF_WIDTH, at.x + MOMENT_HALF_WIDTH, at.width, at.height),
    label: formatClipTime(t),
    text: hits.map((hit) => clipName(ctx.doc, hit.clip)).join(', '),
    clipboard: buildSoundPickClipboard(ctx, `${seconds(t)} on ${mode}${here}`),
  }];
  for (const hit of hits) {
    levels.push(clipLevel(ctx, hit, labels, band(px(hit.clip.at), px(hit.clip.at + hit.clip.duration), at.width, at.height)));
  }
  if (selection && t >= selection.start && t < selection.end) {
    levels.push({
      rect: band(px(selection.start), px(selection.end), at.width, at.height),
      label: labels.range(formatClipTime(selection.start), formatClipTime(selection.end)),
      text: '',
      clipboard: buildSoundPickClipboard(ctx, `selected range ${seconds(selection.start)}–${seconds(selection.end)} (pointed at ${seconds(t)})`),
    });
  }
  return levels;
}

/**
 * 트랙 줄(SVG — `SoundTracks`) — 커서 아래 클립 상자, 없으면 그 트랙의 그 시각. viewBox 는 비율을 묶지 않는다
 * (`preserveAspectRatio="none"`) — 가로는 0~`duration` 초, 세로는 `SOUND_LANE_VIEW`.
 */
export function soundLaneLevels(
  ctx: SoundInspectContext,
  trackId: string,
  duration: number,
  labels: SoundInspectLabels,
  at: InspectorPickPoint,
): InspectorPickLevels {
  const track = ctx.doc.tracks.find((item) => item.id === trackId);
  if (!track || duration <= 0 || at.width <= 0 || at.height <= 0) return [];
  const sx = at.width / SOUND_LANE_VIEW.width;
  const sy = at.height / SOUND_LANE_VIEW.height;
  const vx = at.x / sx;
  const vy = at.y / sy;
  // 뒤에 그린 클립이 위에 있다 — 겹치면 그것부터.
  for (let i = track.clips.length - 1; i >= 0; i -= 1) {
    const clip = track.clips[i]!;
    const left = clip.at / duration * SOUND_LANE_VIEW.width;
    const width = Math.max(SOUND_LANE_VIEW.clipMinWidth, clip.duration / duration * SOUND_LANE_VIEW.width);
    if (vx < left || vx > left + width || vy < SOUND_LANE_VIEW.clipTop || vy > SOUND_LANE_VIEW.clipTop + SOUND_LANE_VIEW.clipHeight) continue;
    const rect = { x: left * sx, y: SOUND_LANE_VIEW.clipTop * sy, width: width * sx, height: SOUND_LANE_VIEW.clipHeight * sy };
    return [clipLevel(ctx, { track, clip }, labels, rect)];
  }
  const t = clamp(at.x / at.width, 0, 1) * duration;
  return [{
    rect: band(at.x - MOMENT_HALF_WIDTH, at.x + MOMENT_HALF_WIDTH, at.width, at.height),
    label: `${formatClipTime(t)} · ${trackName(track, labels)}`,
    text: '',
    clipboard: buildSoundPickClipboard(ctx, `${seconds(t)} on track ${quote(trackName(track, labels))} id "${track.id}" — empty (no clip here)`),
  }];
}
