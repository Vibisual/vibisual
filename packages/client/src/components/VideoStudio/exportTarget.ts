import { formatOfSize, normalizeRange, type ExportPlanDoc, type ExportPlanPiece, type ExportRange, type ResolvedTimeline, type VideoDoc, type VideoFormatId } from '@vibisual/video';

import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (AA) 42-4 — 내보내기 한 번의 **대상**(무엇을)과 그 계산(순수). 설정 창이 고르고, `useStudioExport` 가 일감으로 펼친다.
 */
export interface ExportTarget {
  readonly docIds: readonly string[];
  readonly ownFormat: boolean;
  readonly extraFormats: readonly VideoFormatId[];
  readonly rangeMode: 'all' | 'range' | 'scenes';
  readonly range: ExportRange;
  readonly sceneIds: readonly string[];
  /** 이 렌더에서만 소리를 뺄 트랙(지금 문서와 그 파생 문서). */
  readonly mutedTracks: readonly string[];
}

/** 지금 · 대기열에(멈춘 채) · 예약. */
export type ExportMode = 'now' | 'queue' | 'schedule';

/**
 * 지금 문서를 나누는 조각(구간 · 고른 장면마다 · 전체 = 빈 목록). 구간을 골랐는데 쓸 수 없는 구간이면 null — 조용히 전체를
 * 렌더하지 않는다(사람이 구간을 고친다).
 */
export function piecesOf(target: ExportTarget, timeline: ResolvedTimeline | null, sceneName: (index: number, title: string) => string): ExportPlanPiece[] | null {
  if (target.rangeMode === 'range') {
    const range = normalizeRange(target.range, timeline?.duration);
    return range ? [{ range, scene: null }] : null;
  }
  if (target.rangeMode === 'scenes' && timeline) {
    const chosen = new Set(target.sceneIds);
    return timeline.chapters
      .filter((c) => chosen.has(c.id) && c.end - c.start > 0)
      .map((c) => ({ range: { start: c.start, end: c.end }, scene: sceneName(c.index, c.chapter.title) }));
  }
  return [];
}

/** 계획의 문서 목록 — 지금 문서는 그 판형, 다른 문서는 목록이 실은 크기로(옛 서버면 지금 문서의 판형). */
export function planDocsOf(target: ExportTarget, doc: VideoDoc, docs: readonly DocSummary[]): ExportPlanDoc[] {
  const known = new Map(docs.map((x) => [x.id, x]));
  const out: ExportPlanDoc[] = [];
  for (const id of target.docIds) {
    if (id === doc.id) { out.push({ id, title: doc.title, format: formatOfSize(doc.size) }); continue; }
    const other = known.get(id);
    if (!other) continue;
    out.push({ id, title: other.title, format: other.width && other.height ? formatOfSize({ width: other.width, height: other.height }) : formatOfSize(doc.size) });
  }
  return out;
}

/** 글 한 장을 파일로 받는다(SRT). */
export function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-subrip;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
