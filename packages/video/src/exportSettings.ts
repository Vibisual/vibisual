/**
 * §5.13 (AA) 42-1 — 내보내기 설정·프리셋(순수). 설정 창과 서버가 같은 거르개를 쓴다(한쪽만 새 값을 알면 저장한 설정이 기본값으로 돌아간다).
 * 모르는 값은 기본값으로 바꾼다(옛 파일도 읽힌다 — §3.2.1-5).
 */

import { EXPORT_DEFAULT_FILE_NAME, EXPORT_PRESETS_MAX, EXPORT_TEXT_MAX } from './constants.js';
import { bool, exportDir, exportFps, exportText, oneOf, record } from './exportValues.js';

export { exportDir, exportFps, exportText } from './exportValues.js';

/** 형식 — `webm-alpha` 는 모션만 투명 배경(38-3), `wav` 는 소리만. */
export type ExportFormat = 'mp4' | 'webm' | 'webm-alpha' | 'wav';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['mp4', 'webm', 'webm-alpha', 'wav'];

/** 화질 — 렌더 코어의 `EncodeQualityLevel` 이름 그대로(그래서 일꾼이 옮겨 적지 않고 넘긴다). */
export type ExportQuality = 'low' | 'medium' | 'high' | 'very-high';
export const EXPORT_QUALITIES: readonly ExportQuality[] = ['low', 'medium', 'high', 'very-high'];

/** 자막 — 굽기 · 따로 내기(자막을 숨기고 그 옆에 SRT) · 빼기. */
export type ExportCaptions = 'burn' | 'separate' | 'none';
export const EXPORT_CAPTIONS: readonly ExportCaptions[] = ['burn', 'separate', 'none'];

/** 같은 이름의 파일이 있을 때 — 번호 붙이기 · 덮어쓰기. */
export type ExportConflict = 'number' | 'overwrite';
export const EXPORT_CONFLICTS: readonly ExportConflict[] = ['number', 'overwrite'];

/** 해상도 배율(문서 크기 기준). */
export const EXPORT_SCALES: readonly number[] = [1, 0.75, 0.5];
/** 프레임 수 고르기(없으면 문서대로). */
export const EXPORT_FPS_CHOICES: readonly number[] = [24, 25, 30, 60];

/** 끝난 뒤 — 폴더에서 보이기 · OS 알림 · 캔버스 노드에 담기(§5.13 (L) 종전 동작). */
export interface ExportAfter {
  readonly reveal: boolean;
  readonly notify: boolean;
  readonly deliver: boolean;
}

export interface ExportSettings {
  readonly format: ExportFormat;
  readonly quality: ExportQuality;
  readonly scale: number;
  /** null = 문서의 fps. */
  readonly fps: number | null;
  /** false = 내보내기 음소거(소리 트랙 없는 영상). */
  readonly audio: boolean;
  readonly captions: ExportCaptions;
  /** null = 종전 자리(`.vibisual/video/out/`). 절대 경로 — OS 폴더 창으로만 고른다(42-2). */
  readonly outputDir: string | null;
  /** 파일 이름 규칙(`{title}` 등 — `exportNames.ts`). */
  readonly fileName: string;
  readonly conflict: ExportConflict;
  readonly after: ExportAfter;
  /** 렌더가 도는 동안 OS 절전을 막는다. */
  readonly keepAwake: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  quality: 'high',
  scale: 1,
  fps: null,
  audio: true,
  captions: 'burn',
  outputDir: null,
  fileName: EXPORT_DEFAULT_FILE_NAME,
  conflict: 'number',
  after: { reveal: false, notify: true, deliver: true },
  keepAwake: true,
};

/** 이름 붙여 저장한 설정 한 벌(내 프리셋). */
export interface ExportPreset {
  readonly id: string;
  readonly name: string;
  readonly settings: ExportSettings;
}

/** `<프로젝트>/.vibisual/video/export-settings.json` 의 모양. */
export interface ExportSettingsFile {
  readonly schemaVersion: 1;
  readonly last: ExportSettings;
  readonly presets: readonly ExportPreset[];
}

export function normalizeExportSettings(raw: unknown): ExportSettings {
  const r = record(raw);
  const after = record(r['after']);
  const d = DEFAULT_EXPORT_SETTINGS;
  const scale = typeof r['scale'] === 'number' && EXPORT_SCALES.includes(r['scale']) ? r['scale'] : d.scale;
  return {
    format: oneOf(r['format'], EXPORT_FORMATS, d.format),
    quality: oneOf(r['quality'], EXPORT_QUALITIES, d.quality),
    scale,
    fps: exportFps(r['fps']),
    audio: bool(r['audio'], d.audio),
    captions: oneOf(r['captions'], EXPORT_CAPTIONS, d.captions),
    outputDir: exportDir(r['outputDir']),
    fileName: exportText(r['fileName']) ?? d.fileName,
    conflict: oneOf(r['conflict'], EXPORT_CONFLICTS, d.conflict),
    after: {
      reveal: bool(after['reveal'], d.after.reveal),
      notify: bool(after['notify'], d.after.notify),
      deliver: bool(after['deliver'], d.after.deliver),
    },
    keepAwake: bool(r['keepAwake'], d.keepAwake),
  };
}

/** 프리셋 id 모양 — 파일·주소에 그대로 써도 되는 글자만. */
export function isSafePresetId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function normalizeExportSettingsFile(raw: unknown): ExportSettingsFile {
  const r = record(raw);
  const presets: ExportPreset[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r['presets']) ? r['presets'] : []) {
    const p = record(item);
    const id = p['id'];
    const name = exportText(p['name'], EXPORT_TEXT_MAX);
    if (!isSafePresetId(id) || name === null || seen.has(id)) continue;
    seen.add(id);
    presets.push({ id, name, settings: normalizeExportSettings(p['settings']) });
    if (presets.length >= EXPORT_PRESETS_MAX) break;
  }
  return { schemaVersion: 1, last: normalizeExportSettings(r['last']), presets };
}
