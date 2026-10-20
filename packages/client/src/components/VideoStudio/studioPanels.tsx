import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { PrecisionSheetProps } from './PrecisionSheet.js';
import type { HistoryPanelProps } from './HistoryPanel.js';
import type { HistoryCompareProps } from './HistoryCompare.js';
import type { VariantCompareProps } from './VariantCompare.js';
import type { StyleDrawerProps } from './StyleDrawer.js';
import type { LibrariesPanelProps } from './LibrariesPanel.js';
import type { FrameStripViewerProps } from './FrameStripViewer.js';
import type { VideoSourcesDrawer } from './VideoSourcesDrawer.js';
import type { VideoRequestReview } from './VideoRequestReview.js';
import type { ExportDialogProps } from './ExportDialog.js';

/**
 * §5.13 (X) 39-2 — 처음엔 **닫혀 있는 판은 첫 청크 밖**에 둔다(정밀 편집 · 판 기록 · 판 비교 · 두 엔진 비교 · 스타일 서랍 ·
 * 라이브러리 · 원본 · 프레임 띠). 스튜디오가 첫 그림을 세운 뒤 한가할 때 미리 받아 두므로(`preloadStudioPanels`) 처음 열 때도
 * 기다리지 않는다. 받기 전에 열면 그 자리는 한순간 비었다가 선다(판이 원래 미끄러져 들어오는 자리다 — 쓰는 쪽이 `Suspense` 로 감싼다).
 */
interface LazyPanel<P> {
  readonly Component: LazyExoticComponent<ComponentType<P>>;
  readonly preload: () => Promise<unknown>;
}

function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>): LazyPanel<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = (): Promise<ComponentType<P>> => {
    // 받다가 실패하면 다음에 다시 받는다(한 번의 일시 오류로 판이 영영 안 서지 않게).
    pending ??= load().catch((err: unknown) => { pending = null; throw err; });
    return pending;
  };
  return { Component: lazy(async () => ({ default: await preload() })), preload };
}

const precision = lazyPanel<PrecisionSheetProps>(async () => (await import('./PrecisionSheet.js')).PrecisionSheet);
const history = lazyPanel<HistoryPanelProps>(async () => (await import('./HistoryPanel.js')).HistoryPanel);
const historyCompare = lazyPanel<HistoryCompareProps>(async () => (await import('./HistoryCompare.js')).HistoryCompare);
const variantCompare = lazyPanel<VariantCompareProps>(async () => (await import('./VariantCompare.js')).VariantCompare);
const styleDrawer = lazyPanel<StyleDrawerProps>(async () => (await import('./StyleDrawer.js')).StyleDrawer);
const libraries = lazyPanel<LibrariesPanelProps>(async () => (await import('./LibrariesPanel.js')).LibrariesPanel);
const frameStrip = lazyPanel<FrameStripViewerProps>(async () => (await import('./FrameStripViewer.js')).FrameStripViewer);
const sources = lazyPanel<Parameters<typeof VideoSourcesDrawer>[0]>(async () => (await import('./VideoSourcesDrawer.js')).VideoSourcesDrawer);
const requestReview = lazyPanel<Parameters<typeof VideoRequestReview>[0]>(async () => (await import('./VideoRequestReview.js')).VideoRequestReview);
/** §5.13 (AA) 42-8 — 내보내기 설정 창(열 때만 — 첫 청크 밖). */
const exportDialog = lazyPanel<ExportDialogProps>(async () => (await import('./ExportDialog.js')).ExportDialog);

export const LazyPrecisionSheet = precision.Component;
export const LazyHistoryPanel = history.Component;
export const LazyHistoryCompare = historyCompare.Component;
export const LazyVariantCompare = variantCompare.Component;
export const LazyStyleDrawer = styleDrawer.Component;
export const LazyLibrariesPanel = libraries.Component;
export const LazyFrameStripViewer = frameStrip.Component;
export const LazyVideoSourcesDrawer = sources.Component;
export const LazyVideoRequestReview = requestReview.Component;
export const LazyExportDialog = exportDialog.Component;

const ALL: readonly LazyPanel<never>[] = [precision, history, historyCompare, variantCompare, styleDrawer, libraries, frameStrip, sources, requestReview, exportDialog] as unknown as readonly LazyPanel<never>[];

/** 닫힌 판을 전부 미리 받는다(한 번 받은 것은 모듈 캐시라 다시 안 받는다). 실패는 조용히 — 실제로 열 때 다시 받는다. */
export function preloadStudioPanels(): void {
  for (const panel of ALL) void panel.preload().catch(() => undefined);
}
