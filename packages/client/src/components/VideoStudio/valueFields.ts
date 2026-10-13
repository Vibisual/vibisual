/**
 * §5.13 (V) 37-5 — **값 손잡이**의 모델(순수 — 화면 없음): 고른 아이템을 종류 있는 값 목록으로 바꾼다.
 *
 * - 코드 컴포지션: 컴포지션이 선언한 값(`asset.propsDecl` — `vibi-props`)을 순서 그대로. 값은 `props[name]`, 없으면 선언 기본값.
 * - 기본 씬·글자·도형·자막·소리: 종전 필드표(`videoInspectorFields` — 렌더러가 실제로 읽는 것만)를 종류에 맞는 손잡이로
 *   (색 열쇠 → 원형 색 견본, 글꼴 → 글꼴 목록, 고르기 → 조각 단추, 초 단위 숫자 → 시각, 그 밖 숫자 → 끌기 숫자).
 *
 * 화면(`StudioValueControls`)은 이 목록만 그리고, 바꾼 값은 `toPropValue` 로 문서 값이 된다(목록 필드는 줄마다 한 항목).
 */
import type { TFunction } from 'i18next';
import type { CompositionPropType, VideoAsset, VideoDoc, VideoItem } from '@vibisual/video';

import { inspectorFields, INSPECTOR_OPTION_LABELS } from './videoInspectorFields.js';

export interface ValueOption {
  readonly value: string;
  readonly label: string;
}

export interface ValueField {
  /** `props` 열쇠. */
  readonly key: string;
  readonly type: CompositionPropType;
  readonly label: string;
  readonly description?: string | undefined;
  readonly value: string | number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly options?: readonly ValueOption[] | undefined;
  readonly multiline?: boolean | undefined;
  /** 줄마다 한 항목인 목록 값(저장할 때 줄로 가른다). */
  readonly list?: boolean | undefined;
}

/** 색 손잡이로 그리는 기본 필드 열쇠. */
const COLOR_KEYS = new Set(['color', 'accent', 'fill', 'stroke', 'boxColor', 'highlightColor']);
/** 초 단위 숫자(시각 손잡이). */
const TIME_KEYS = new Set(['fadeIn', 'fadeOut', 'stagger', 'perLine']);

/**
 * 안전한 시스템 글꼴 — 세 OS 어디서나 이름이 풀리는 일반 글꼴군과 흔한 글꼴(없으면 브라우저가 다음 것으로 넘어간다).
 * 스타일 카드 글꼴·가져온 글꼴이 앞에 선다.
 */
export const SAFE_SYSTEM_FONTS: readonly string[] = [
  'system-ui', 'sans-serif', 'serif', 'monospace', 'Georgia', 'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Times New Roman', 'Courier New',
];

/** 글꼴 목록 — 스타일 카드 글꼴 · 이 문서에 가져온 글꼴 · 안전한 시스템 글꼴(같은 이름은 한 번). */
export function fontOptions(doc: VideoDoc, current?: string): ValueOption[] {
  const names: string[] = [];
  if (doc.style?.fontFamily) names.push(doc.style.fontFamily);
  for (const asset of Object.values(doc.assets)) {
    if (asset.kind !== 'font' || asset.source.kind !== 'file') continue;
    const base = asset.source.path.split('/').pop() ?? asset.id;
    names.push(base.replace(/\.(woff2?|ttf|otf)$/i, ''));
  }
  names.push(...SAFE_SYSTEM_FONTS);
  if (current && current.trim() !== '') names.unshift(current);
  return [...new Set(names)].map((name) => ({ value: name, label: name }));
}

/** 프로젝트 기준 경로 둘 사이의 상대 주소(`/` 구분) — 컴포지션 폴더에서 그림 소재로. */
export function relativeUrl(fromFolder: string, toPath: string): string {
  const from = fromFolder.split('/').filter((s) => s !== '' && s !== '.');
  const to = toPath.split('/').filter((s) => s !== '' && s !== '.');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1;
  const up = from.slice(i).map(() => '..');
  return [...up, ...to.slice(i)].join('/');
}

/** 컴포지션의 그림 값으로 고를 수 있는 문서 그림 소재(값 = 컴포지션 폴더에서의 상대 주소). */
export function imageOptions(doc: VideoDoc, composition: VideoAsset | undefined, label: (asset: VideoAsset) => string): ValueOption[] {
  const htmlPath = composition?.source.kind === 'file' ? composition.source.path.replace(/\\/g, '/') : '';
  const folder = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/')) : '';
  const out: ValueOption[] = [];
  for (const asset of Object.values(doc.assets)) {
    if (asset.kind !== 'image' || asset.source.kind !== 'file') continue;
    out.push({ value: folder ? relativeUrl(folder, asset.source.path.replace(/\\/g, '/')) : asset.source.path, label: label(asset) });
  }
  return out;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 고른 아이템의 값 손잡이 목록. */
export function itemValueFields(doc: VideoDoc, item: VideoItem, t: TFunction): ValueField[] {
  const props = item.props ?? {};
  const asset = item.assetId ? doc.assets[item.assetId] : undefined;
  if (item.kind === 'composition') {
    const assetLabel = (a: VideoAsset): string => {
      const owner = doc.tracks.flatMap((tr) => tr.items).find((it) => it.assetId === a.id);
      return owner?.label ?? (a.source.kind === 'file' ? a.source.path.split('/').pop() ?? a.id : a.id);
    };
    return (asset?.propsDecl ?? []).map((decl): ValueField => {
      const raw = props[decl.name];
      const fallback = decl.default ?? (decl.type === 'number' || decl.type === 'time' ? 0 : '');
      const value = typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw)) ? raw : fallback;
      const options = decl.type === 'choice'
        ? (decl.options ?? []).map((o) => ({ value: o, label: o }))
        : decl.type === 'font' ? fontOptions(doc, typeof value === 'string' ? value : undefined)
          : decl.type === 'image' ? imageOptions(doc, asset, assetLabel) : undefined;
      return {
        key: decl.name,
        type: decl.type,
        label: decl.label ?? decl.name,
        description: decl.description,
        value,
        min: decl.min,
        max: decl.max,
        step: decl.step,
        options,
        multiline: decl.multiline,
      };
    });
  }
  return inspectorFields(item, doc.size.height, asset?.hasAudio).map((field): ValueField => {
    const raw = props[field.key];
    const label = t(`panel.videoStudio.editor.props.${field.labelKey ?? field.key}`, { defaultValue: field.label });
    if (typeof field.defaultValue === 'number') {
      return {
        key: field.key,
        type: TIME_KEYS.has(field.key) ? 'time' : 'number',
        label,
        value: numberOr(raw, field.defaultValue),
        min: field.min,
        max: field.max,
        step: TIME_KEYS.has(field.key) ? 0.05 : undefined,
      };
    }
    if (field.list) {
      const value = Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string').join('\n') : '';
      return { key: field.key, type: 'text', label, value, multiline: true, list: true };
    }
    const value = typeof raw === 'string' ? raw : field.defaultValue;
    if (field.options) {
      // §5.13 (V) 37-12 — 단어 강조를 켰는데 낱말 시각이 없는 큐가 있으면 추정한다는 사실을 손잡이 설명에 적는다.
      const estimated = field.key === 'highlight' && value === 'word' && (item.cues ?? []).some((cue) => !cue.words?.length);
      return {
        key: field.key,
        type: 'choice',
        label,
        value,
        ...(estimated ? { description: t('panel.videoStudio.editor.wordsEstimated') } : {}),
        options: field.options.map((o) => ({
          value: o,
          label: INSPECTOR_OPTION_LABELS[o] ? t(`panel.videoStudio.editor.options.${o}`, { defaultValue: INSPECTOR_OPTION_LABELS[o] }) : o,
        })),
      };
    }
    if (field.key === 'fontFamily') return { key: field.key, type: 'font', label, value, options: fontOptions(doc, value) };
    if (COLOR_KEYS.has(field.key)) return { key: field.key, type: 'color', label, value };
    return { key: field.key, type: 'text', label, value, multiline: field.multiline };
  });
}

/** 손잡이 값 → 문서 값(목록 필드는 줄마다 한 항목, 숫자는 범위 안으로). */
export function toPropValue(field: ValueField, raw: string | number): unknown {
  if (field.list) return String(raw).split('\n');
  if (field.type === 'number' || field.type === 'time') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return field.value;
    const lo = field.min ?? -Infinity;
    const hi = field.max ?? Infinity;
    return Math.min(hi, Math.max(lo, n));
  }
  return raw;
}

/** 아이템 글자 값의 열쇠 — 제자리 고치기(더블클릭)가 고치는 값. 글자가 없는 종류면 null. */
export function inlineTextKey(item: VideoItem): string | null {
  if (item.kind === 'text') return 'text';
  if (item.kind === 'scene') {
    switch (item.sceneId) {
      case 'title': return 'title';
      case 'lowerThird': return 'name';
      case 'bulletList': return 'heading';
      case 'quote': return 'text';
      default: return null;
    }
  }
  return null;
}
