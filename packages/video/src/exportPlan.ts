/**
 * §5.13 (AA) 42-3·42-4·42-5 — 내보내기 한 번의 계획과 그 렌더 한 번의 문서 사본 (순수).
 *
 * - 소리를 내는 트랙 목록과 그 렌더에서만 음소거한 사본(문서는 바뀌지 않는다 — `withoutCaptions` 와 같은 방식).
 * - 구간 렌더의 프레임 계획(프레임 시각은 문서 시각, 파일 시각은 0 부터).
 * - [렌더] 한 번이 줄에 세우는 일감(문서 × 판형 × 장면).
 * - 대기열 한 줄의 경과·남은 시간·초당 프레임(멈춘 시간은 뺀다).
 */

import { EXPORT_BATCH_MAX } from './constants.js';
import type { ExportRange } from './renderSpec.js';
import type { VideoDoc, VideoFormatId } from './types.js';

/** 소리를 내는 트랙 한 줄. */
export interface AudibleTrack {
  readonly id: string;
  readonly label: string | null;
  readonly kind: 'audio' | 'visual';
  /** 문서에서 이미 음소거한 트랙(정밀 편집 — 다른 축). */
  readonly muted: boolean;
  /** 문서 트랙 순번(이름이 없을 때 "트랙 n" 으로 쓴다). */
  readonly index: number;
}

/** 소리를 내는 트랙 — 소리 트랙과, 소리가 있는 실사가 든 화면 트랙(`audioItemsAt` 과 같은 판정). */
export function audibleTracks(doc: VideoDoc): AudibleTrack[] {
  const out: AudibleTrack[] = [];
  doc.tracks.forEach((track, index) => {
    const audible = track.kind === 'audio'
      || (track.kind === 'visual' && track.items.some((it) => it.kind === 'footage' && (it.assetId ? doc.assets[it.assetId]?.hasAudio !== false : false)));
    if (!audible) return;
    out.push({ id: track.id, label: track.label?.trim() || null, kind: track.kind === 'audio' ? 'audio' : 'visual', muted: track.muted === true, index });
  });
  return out;
}

/** 그 렌더 한 번만 음소거한 사본. 뺄 트랙이 없으면 같은 문서를 돌려준다. */
export function withMutedTracks(doc: VideoDoc, trackIds: readonly string[]): VideoDoc {
  if (trackIds.length === 0) return doc;
  const muted = new Set(trackIds);
  if (!doc.tracks.some((t) => muted.has(t.id) && t.muted !== true)) return doc;
  return { ...doc, tracks: doc.tracks.map((t) => (muted.has(t.id) ? { ...t, muted: true } : t)) };
}

/** 렌더할 프레임 계획. */
export interface RenderFramePlan {
  /** 문서 시각(초). */
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly frames: number;
}

/**
 * 구간·프레임 수를 건 프레임 계획. 프레임 수는 올림한다(마지막 프레임을 잃지 않게 — `totalFrames` 와 같은 규칙, 부동소수 꼬리는
 * 버린다). 구간이 없으면 처음~끝.
 */
export function renderFramePlan(duration: number, docFps: number, opts: { readonly fps?: number | null; readonly range?: ExportRange | null } = {}): RenderFramePlan {
  const fps = opts.fps !== undefined && opts.fps !== null && opts.fps > 0 ? opts.fps : docFps;
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const start = opts.range ? Math.max(0, Math.min(opts.range.start, total)) : 0;
  const end = opts.range ? Math.max(start, Math.min(opts.range.end, total)) : total;
  const span = end - start;
  const frames = span <= 0 || fps <= 0 ? 0 : Math.max(1, Math.ceil(span * fps - 1e-6));
  return { start, end, fps, frames };
}

/** 대기열 한 줄의 시간 값(필요한 칸만). */
export interface RenderTimingInput {
  readonly status: string;
  readonly progress: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly pausedMs?: number;
  /** 지금 멈춰 있으면 멈춘 시각. */
  readonly pausedAt?: number;
  readonly frame?: number;
}

/** 경과(멈춘 시간 뺌)·남은 시간·초당 프레임. 모르는 값은 null(지어내지 않는다). */
export function renderTiming(job: RenderTimingInput, now: number): { elapsedMs: number | null; etaMs: number | null; fps: number | null } {
  if (job.startedAt === undefined) return { elapsedMs: null, etaMs: null, fps: null };
  const end = job.finishedAt ?? now;
  const pausedNow = job.pausedAt !== undefined ? Math.max(0, end - job.pausedAt) : 0;
  const active = Math.max(0, end - job.startedAt - (job.pausedMs ?? 0) - pausedNow);
  const p = Math.max(0, Math.min(1, job.progress));
  const etaMs = job.status === 'running' && p >= 0.01 && p < 1 ? (active * (1 - p)) / p : null;
  const fps = job.frame !== undefined && job.frame > 0 && active >= 500 ? job.frame / (active / 1000) : null;
  return { elapsedMs: active, etaMs, fps };
}

/** 계획에 드는 문서 한 벌. */
export interface ExportPlanDoc {
  readonly id: string;
  readonly title: string;
  readonly format: VideoFormatId;
}

/** 지금 문서를 나누는 한 조각(구간 · 장면 하나 · 전체). */
export interface ExportPlanPiece {
  readonly range: ExportRange | null;
  readonly scene: string | null;
}

export interface ExportPlanInput {
  readonly docs: readonly ExportPlanDoc[];
  readonly currentDocId: string | null;
  /** 각 문서의 원래 판형을 넣는가. */
  readonly ownFormat: boolean;
  /** 더 낼 판형(원래 판형과 다르면 파생 문서로). */
  readonly extraFormats: readonly VideoFormatId[];
  /** 지금 문서의 조각들(없으면 전체 하나). 다른 문서는 늘 전체다. */
  readonly pieces: readonly ExportPlanPiece[];
}

export interface ExportPlanEntry {
  readonly doc: ExportPlanDoc;
  readonly format: VideoFormatId;
  /** 그 문서의 원래 판형이 아니다 — 파생 문서로 렌더한다. */
  readonly derived: boolean;
  readonly range: ExportRange | null;
  readonly scene: string | null;
  readonly index: number;
}

/** [렌더] 한 번의 일감 목록 — 문서 × 판형 × 조각, 상한 `EXPORT_BATCH_MAX`(넘친 사실은 `truncated`). */
export function planExportJobs(input: ExportPlanInput): { entries: ExportPlanEntry[]; truncated: boolean } {
  const entries: ExportPlanEntry[] = [];
  let wanted = 0;
  for (const doc of input.docs) {
    const formats = [...new Set([...(input.ownFormat ? [doc.format] : []), ...input.extraFormats])];
    if (formats.length === 0) formats.push(doc.format);
    const pieces = doc.id === input.currentDocId && input.pieces.length > 0 ? input.pieces : [{ range: null, scene: null }];
    for (const format of formats) {
      for (const piece of pieces) {
        wanted += 1;
        if (entries.length >= EXPORT_BATCH_MAX) continue;
        entries.push({ doc, format, derived: format !== doc.format, range: piece.range, scene: piece.scene, index: entries.length });
      }
    }
  }
  return { entries, truncated: wanted > entries.length };
}

/**
 * 한 번에 여러 파일이 나오면 이름 규칙에 그 차이를 넣는다 — 장면이 갈리는데 `{scene}` 이 없으면 ` - {scene}`, 판형이 갈리는데
 * `{format}` 이 없으면 ` - {format}`(번호만 붙은 이름 셋보다 읽히는 이름이 낫다).
 */
export function batchFileName(template: string, entries: readonly ExportPlanEntry[]): string {
  let out = template;
  if (entries.some((e) => e.scene !== null) && !out.includes('{scene}')) out = `${out} - {scene}`;
  const formatsPerDoc = new Map<string, Set<VideoFormatId>>();
  for (const e of entries) {
    const set = formatsPerDoc.get(e.doc.id) ?? new Set<VideoFormatId>();
    set.add(e.format);
    formatsPerDoc.set(e.doc.id, set);
  }
  if ([...formatsPerDoc.values()].some((s) => s.size > 1) && !out.includes('{format}')) out = `${out} - {format}`;
  return out;
}
