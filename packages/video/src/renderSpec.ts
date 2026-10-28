/** §5.13 (AA) 42-2·42-4 — 렌더 일감의 모양(순수): `RenderSpec`(일꾼이 읽는다) · `RenderOutputSpec`(서버가 읽는다). 설정에서 지어지고 서버·일꾼·화면이 같은 거르개를 쓴다. */

import { EXPORT_MIN_RANGE_S } from './constants.js';
import { normalizeExportSettings, type ExportAfter, type ExportCaptions, type ExportConflict, type ExportFormat, type ExportQuality, type ExportSettings } from './exportSettings.js';
import { exportText, record } from './exportValues.js';
import type { VideoDoc } from './types.js';

/** 구간(문서 시각, 초). */
export interface ExportRange {
  readonly start: number;
  readonly end: number;
}

/** 일꾼이 그리는 방법 — 일감에 실린다(42-4). */
export interface RenderSpec {
  readonly format: ExportFormat;
  readonly quality: ExportQuality;
  readonly scale: number;
  readonly fps: number | null;
  readonly audio: boolean;
  /** 이 렌더에서만 음소거할 트랙(42-3 개별). */
  readonly mutedTracks: readonly string[];
  readonly captions: ExportCaptions;
  /** null = 처음부터 끝까지. */
  readonly range: ExportRange | null;
}

/** 서버가 결과를 놓는 방법 — 일감에 실린다(42-2·42-7). */
export interface RenderOutputSpec {
  readonly dir: string | null;
  readonly fileName: string;
  readonly conflict: ExportConflict;
  readonly after: ExportAfter;
  readonly keepAwake: boolean;
  /** `{scene}` 자리 값(장면별 렌더). */
  readonly scene: string | null;
  /** `{n}` 자리 값(한 번에 건 일감 안의 순번, 0 부터). */
  readonly index: number | null;
  /** 끝난 뒤 OS 알림 글 — 거는 화면이 사용자 언어로 짓는다(앱 main 몫은 번역을 모른다 — 42-7). */
  readonly notice: { readonly done: string; readonly failed: string } | null;
}

/** 트랙·아이템 id 모양(문서 id 와 같은 규칙보다 넓게 — 에이전트가 지은 id 도 받는다). */
function isTrackId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
}

/** 구간을 다듬는다 — 순서·음수·최소 길이. 못 쓰는 구간이면 null(= 전체). */
export function normalizeRange(raw: unknown, duration?: number): ExportRange | null {
  const r = record(raw);
  const s = r['start'];
  const e = r['end'];
  if (typeof s !== 'number' || typeof e !== 'number' || !Number.isFinite(s) || !Number.isFinite(e)) return null;
  let start = Math.max(0, Math.min(s, e));
  let end = Math.max(s, e);
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
    start = Math.min(start, duration);
    end = Math.min(end, duration);
  }
  return end - start >= EXPORT_MIN_RANGE_S ? { start, end } : null;
}

export function normalizeRenderSpec(raw: unknown): RenderSpec {
  const r = record(raw);
  const base = normalizeExportSettings(r);
  const muted = Array.isArray(r['mutedTracks']) ? r['mutedTracks'].filter(isTrackId) : [];
  return {
    format: base.format,
    quality: base.quality,
    scale: base.scale,
    fps: base.fps,
    audio: base.audio,
    mutedTracks: [...new Set(muted)].slice(0, 64),
    captions: base.captions,
    range: normalizeRange(r['range']),
  };
}

export function normalizeRenderOutput(raw: unknown): RenderOutputSpec {
  const r = record(raw);
  const base = normalizeExportSettings({ ...r, outputDir: r['dir'] });
  const notice = record(r['notice']);
  const done = exportText(notice['done']);
  const failed = exportText(notice['failed']);
  const index = r['index'];
  return {
    dir: base.outputDir,
    fileName: base.fileName,
    conflict: base.conflict,
    after: base.after,
    keepAwake: base.keepAwake,
    scene: exportText(r['scene']),
    index: typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 10_000 ? index : null,
    notice: done !== null && failed !== null ? { done, failed } : null,
  };
}

/** 설정 + 그 렌더 한 번의 값 → 일감에 실을 그리기 방법. */
export function specFromSettings(settings: ExportSettings, extra: { readonly mutedTracks?: readonly string[]; readonly range?: ExportRange | null } = {}): RenderSpec {
  return {
    format: settings.format,
    quality: settings.quality,
    scale: settings.scale,
    fps: settings.fps,
    audio: settings.audio,
    mutedTracks: [...(extra.mutedTracks ?? [])],
    captions: settings.captions,
    range: extra.range ?? null,
  };
}

/** 결과 파일 확장자. */
export function renderExtension(spec: Pick<RenderSpec, 'format'>): 'mp4' | 'webm' | 'wav' {
  return spec.format === 'wav' ? 'wav' : spec.format === 'mp4' ? 'mp4' : 'webm';
}

/** 배율을 건 출력 크기 — 짝수로 맞춘다(H.264 4:2:0 · VP9 도 짝수가 안전하다). */
export function scaledSize(size: VideoDoc['size'], scale: number): { width: number; height: number } {
  const s = Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1;
  const even = (n: number): number => Math.max(2, Math.round((n * s) / 2) * 2);
  return s === 1 ? { width: size.width, height: size.height } : { width: even(size.width), height: even(size.height) };
}
