import type { Dispatch, SetStateAction } from 'react';
import type { VideoFormatId } from '@vibisual/video';

import type { VideoStudioViewProps } from './VideoStudioView.js';
import type { StudioUiState } from './studioViewProps.js';
import type { StudioPaletteState } from './studioCommandTypes.js';

/**
 * §5.13 (V) 37-22 (D) — 팔레트가 부르는 동작을 **화면 손잡이와 같은 함수**에서 가져온다(머리줄·레일·조작 줄·AI 패널 props,
 * 내보내기 판과 같은 `exporter`). 문서 열기는 갤러리와 같은 `header.docs` · `header.onOpenDoc`.
 */
export interface PaletteStateInputs {
  readonly view: VideoStudioViewProps;
  readonly ui: StudioUiState;
  readonly setUi: Dispatch<SetStateAction<StudioUiState>>;
  readonly hasDoc: boolean;
  readonly playing: boolean;
  readonly loop: boolean;
  readonly hasSelection: boolean;
  readonly escapable: boolean;
  readonly canExport: boolean;
  readonly hasCaptions: boolean;
  /** 판 기록의 [저장점 찍기]와 같은 함수. */
  readonly checkpoint: () => void;
  readonly exporter: {
    readonly renderNow: () => void;
    readonly preset: (format: VideoFormatId) => void;
    readonly png: () => void;
    readonly srt: () => void;
  };
  readonly openExport: (tab: 'settings' | 'queue') => void;
}

export function buildPaletteState(a: PaletteStateInputs): StudioPaletteState {
  const { view, ui, setUi } = a;
  const header = view.header;
  return {
    hasDoc: a.hasDoc,
    startMode: view.start !== null,
    playing: a.playing,
    loop: a.loop,
    muted: ui.muted,
    safeArea: ui.safeArea,
    zoom: ui.zoom,
    fullscreen: view.fullscreen === true,
    interaction: ui.interaction,
    hasSelection: a.hasSelection,
    escapable: a.escapable,
    drawer: ui.drawer,
    hasTranscript: view.rail?.hasTranscript === true,
    hasCode: view.rail?.hasCode === true,
    precisionOpen: ui.precisionOpen,
    historyOpen: ui.historyOpen,
    aiCollapsed: ui.aiCollapsed,
    format: header.format,
    canExport: a.canExport,
    hasCaptions: a.hasCaptions,
    docs: header.docs,
    currentDocId: header.currentDocId,
    // 레일 단추와 같은 상태 — 팔레트는 열기만 한다(이미 열린 서랍을 닫지 않는다).
    openDrawer: (drawer) => (view.rail ? view.rail.onOpen(drawer) : setUi((u) => ({ ...u, drawer }))),
    togglePrecision: () => (view.controls ? view.controls.onPrecision() : setUi((u) => ({ ...u, precisionOpen: !u.precisionOpen }))),
    toggleHistory: header.onToggleHistory,
    checkpoint: a.checkpoint,
    toggleAi: () => (view.ai ? view.ai.onToggleCollapsed() : setUi((u) => ({ ...u, aiCollapsed: !u.aiCollapsed }))),
    setFormat: header.onFormat,
    openDoc: header.onOpenDoc,
    newDoc: header.onNewDoc,
    refreshDocs: () => { void header.onRefreshDocs(); },
    renderNow: a.exporter.renderNow,
    exportPreset: a.exporter.preset,
    exportSettings: () => a.openExport('settings'),
    exportQueue: () => a.openExport('queue'),
    png: a.exporter.png,
    srt: a.exporter.srt,
    undoPass: view.ai?.onUndoPass ?? null,
    sceneChat: view.ai?.sceneChat ?? null,
  };
}
