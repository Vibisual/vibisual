import type { Dispatch, KeyboardEventHandler, ReactNode, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { buildRemoveChapterOps } from '@vibisual/video';
import type {
  ResolvedTimeline,
  VideoChapter,
  VideoDoc,
  VideoDocOp,
  VideoFormatId,
  VideoItem,
  VideoRecipe,
} from '@vibisual/video';

import type { AppChrome } from '../../apps/appChrome.js';
import { useGraphStore } from '../../stores/graphStore.js';
import type { VideoStudioViewProps } from './VideoStudioView.js';
import type { StudioDoc } from './useStudioDoc.js';
import type { StudioPlayback } from './useStudioPlayback.js';
import type { StudioAgent } from './useStudioAgent.js';
import type { StudioChatLine } from './useStudioConversation.js';
import type { StudioHistory } from './useStudioHistory.js';
import type { PassChange } from './usePassChange.js';
import type { StudioRender } from './useStudioRender.js';
import type { StudioStartState } from './useStudioStart.js';
import type { StudioComposerState } from './useStudioComposer.js';
import type { StudioEditing } from './useStudioEditing.js';
import type { StudioToasts } from './useStudioToasts.js';
import type { StudioNotes } from './useStudioNotes.js';
import type { PreviewInteraction } from './usePreviewInteraction.js';
import type { RailDrawer } from './StudioRail.js';
import type { ComposerChip } from './StudioComposer.js';
import { MediaDrawer } from './MediaDrawer.js';
import { PartsDrawer } from './PartsDrawer.js';
import { NotesDrawer } from './NotesDrawer.js';
import { StudioChangeCard } from './StudioChangeCard.js';
import { ExportMenu } from './ExportMenu.js';
import { HistoryCompare } from './HistoryCompare.js';
import { StudioSteps } from './StudioSteps.js';
import { FrameStripViewer } from './FrameStripViewer.js';
import { PlanCards } from './PlanCards.js';
import { ValueCard } from './ValueCard.js';
import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';

/**
 * §5.13 (V) 37-1 — 스튜디오 상태 → 화면 부품 props 조립(셸을 묶기 전용으로 두려고 떼었다). 무엇이 어느 칸에 서는지가 이 파일 한
 * 곳에서 보인다: 시작 화면이면 입력창 하나, 아니면 레일·미리보기·구슬 줄(+ 기획 카드)·AI 패널(또는 판 기록)·정밀 편집.
 */
export interface StudioUiState {
  readonly drawer: RailDrawer | null;
  readonly aiCollapsed: boolean;
  readonly historyOpen: boolean;
  readonly precisionOpen: boolean;
  readonly safeArea: boolean;
  readonly zoom: 'fit' | 'actual';
  readonly interaction: 'none' | 'point' | 'note';
  readonly compare: readonly string[];
  readonly compareOpen: boolean;
  readonly strip: { readonly image: string; readonly times: readonly number[]; readonly title: string } | null;
  /** 판 기록을 연 때의 AI 판 수(머리줄 숫자를 거두는 자리). */
  readonly historySeen: number;
  /** 빈 문서 레시피로 편집 화면을 고른 문서(시작 화면을 거둔다). */
  readonly editorFor: string | null;
  readonly chapterMenu: { readonly chapterId: string; readonly anchor: HTMLElement } | null;
  readonly seamMenu: { readonly chapterId: string; readonly anchor: HTMLElement } | null;
  readonly markerMenu: { readonly id: string; readonly anchor: HTMLElement } | null;
  /** §5.13 (V) 37-4 — 기획 카드를 접었다(장면 구슬 줄만 남긴다). */
  readonly planCollapsed: boolean;
}

export const INITIAL_UI: StudioUiState = {
  drawer: null, aiCollapsed: false, historyOpen: false, precisionOpen: false, safeArea: false, zoom: 'fit', interaction: 'none',
  compare: [], compareOpen: false, strip: null, historySeen: 0, editorFor: null, chapterMenu: null, seamMenu: null, markerMenu: null,
  planCollapsed: false,
};

/** 3·4 라운드가 채우는 자리(장면 메뉴·전환·검수·부품·스타일·대본·비트·내보내기). 없으면 그 칸이 서지 않는다. */
export interface StudioExtras {
  readonly overlays?: ReactNode;
  readonly styleDrawer?: ReactNode;
  readonly transcriptDrawer?: ReactNode;
  readonly libraries?: ReactNode;
  readonly parts?: Pick<import('./PartsDrawer.js').PartsDrawerProps, 'parts' | 'onUsePart' | 'transitions' | 'onTransition' | 'seamReady'>;
  readonly markers?: import('./SceneStrip.js').SceneStripProps['markers'];
  readonly beats?: readonly number[];
  readonly aiActions?: ReactNode;
  readonly exportMenu?: (close: () => void) => ReactNode;
  /** §5.13 (T-8) — 정밀 편집 표지 줄의 [다시 모으기]. */
  readonly cues?: { readonly onRecollect: () => void; readonly busy: boolean };
}

export interface StudioViewInputs {
  readonly t: TFunction;
  readonly accent: string;
  readonly hosted: boolean;
  readonly inMainWindow: boolean;
  readonly chrome: AppChrome | null;
  readonly projectName: string;
  readonly projectId: string;
  /** 저장된 문서(판본·장면 연산의 기준). */
  readonly doc: VideoDoc | null;
  /** 값 손잡이의 덮어쓰기를 입힌 사본(미리보기·값 카드가 본다). */
  readonly previewDoc: VideoDoc | null;
  readonly timeline: ResolvedTimeline | null;
  readonly studio: StudioDoc;
  readonly playback: StudioPlayback;
  readonly edits: { undo: () => Promise<void>; redo: () => Promise<void>; canUndo: boolean; canRedo: boolean; applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean> };
  readonly editing: StudioEditing;
  readonly agent: StudioAgent;
  readonly conversation: { readonly lines: readonly StudioChatLine[]; readonly busy: boolean };
  readonly history: StudioHistory;
  readonly passChange: PassChange;
  readonly render: StudioRender;
  readonly start: StudioStartState;
  readonly composer: StudioComposerState;
  readonly notes: StudioNotes;
  readonly interaction: PreviewInteraction;
  readonly thumbs: Readonly<Record<string, string | null>>;
  readonly setProp: (itemId: string, key: string, value: unknown) => void;
  readonly ui: StudioUiState;
  readonly setUi: Dispatch<SetStateAction<StudioUiState>>;
  readonly selectedItemId: string | null;
  readonly setSelectedItemId: (id: string | null) => void;
  readonly toasts: StudioToasts;
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  readonly stageHostRef: RefObject<HTMLDivElement>;
  readonly previewMode: 'canvas' | 'stage';
  readonly disabled: boolean;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly format: VideoFormatId | null;
  readonly recipes: readonly VideoRecipe[];
  /** 기획 카드 [이대로 만들기]. */
  readonly onApprovePlan: () => void;
  /** [고칠 점 n개 맡기기]. */
  readonly onHandNotes: () => void;
  /** 장면 구슬 줄 자리의 [장면으로 나누기]. */
  readonly onDeriveChapters: () => void;
  readonly extras: StudioExtras;
}

function isEmptyDoc(doc: VideoDoc): boolean {
  return doc.tracks.every((track) => track.items.length === 0) && (doc.chapters?.length ?? 0) === 0;
}

/** 시작 화면을 보일까 — 문서가 없거나, 비어 있고 아직 한 바퀴도 맡기지 않았고, 사용자가 편집 화면을 고르지 않았을 때. */
export function showStartScreen(doc: VideoDoc | null, passes: number, editorFor: string | null): boolean {
  return !doc || (isEmptyDoc(doc) && passes === 0 && editorFor !== doc.id);
}

export function buildStudioViewProps(a: StudioViewInputs): VideoStudioViewProps {
  const { t, doc, ui, setUi, playback, agent } = a;
  const view = a.previewDoc ?? doc;
  const startMode = showStartScreen(doc, a.history.passes.length, ui.editorFor);
  const aiRevisions = a.history.entries.filter((e) => e.by === 'ai').length;
  const chapters = a.timeline?.chapters ?? [];
  const selected = a.timeline?.items.find((item) => item.id === a.selectedItemId);
  const selectedChapterId = selected?.item.chapterId ?? (selected && typeof selected.item.at !== 'number' && 'chapter' in selected.item.at ? selected.item.at.chapter : null);
  const working = a.studio.activity?.status === 'open' ? a.studio.activity : null;
  const workingChapter = working?.focus ? chapters.find((c) => c.id === working.focus) : undefined;
  const hasCaptions = !!doc?.tracks.some((track) => track.items.some((item) => item.kind === 'caption' && (item.cues?.length ?? 0) > 0));
  const prepareElsewhere = !a.inMainWindow;
  const setInteraction = (mode: StudioUiState['interaction']): void => setUi((u) => ({ ...u, interaction: mode }));
  const applyOps = (ops: readonly VideoDocOp[]): void => { if (ops.length > 0) void a.edits.applyOps(ops); };
  const activeNote = a.interaction.activeNoteId ? a.notes.notes.find((n) => n.id === a.interaction.activeNoteId) : undefined;

  const chips: ComposerChip[] = [
    ...a.composer.pointed.map((p, i): ComposerChip => ({ id: `pointed-${i}`, icon: 'point', label: p.text ? `“${p.text.slice(0, 24)}”` : t('panel.videoStudio.ai.pointedChip', { kind: t(`panel.videoStudio.values.kind_${p.kind}`) }), onRemove: () => a.composer.removePointed(i) })),
    ...(activeNote && activeNote.status !== 'closed' ? [{ id: `note-${activeNote.id}`, icon: 'note' as const, label: t('panel.videoStudio.notes.pinTitle', { n: activeNote.n }), onRemove: () => a.interaction.setActiveNoteId(null) }] : []),
    ...a.composer.assets.map(({ asset, label }): ComposerChip => ({ id: asset.id, icon: 'attach', label, onRemove: () => a.composer.removeAsset(asset.id) })),
    ...(doc && a.composer.useTime ? [{ id: 'time', icon: 'history' as const, label: t('panel.videoStudio.ai.timeChip', { time: formatClock(playback.playhead) }), onRemove: () => a.composer.setUseTime(false) }] : []),
  ];

  const openIde = agent.agent ? (): void => {
    const agentId = agent.agent?.id;
    if (!agentId) return;
    if (a.inMainWindow) useGraphStore.getState().openIDEOverlay(agentId, agent.sessionId ? { focus: { sessionId: agent.sessionId } } : undefined);
    else void window.api?.overlay?.open({ agentId, projectId: a.projectId, expanded: true });
  } : null;

  const activityText = workingChapter
    ? t('panel.videoStudio.strip.chapter', { n: workingChapter.index + 1, title: workingChapter.chapter.title })
    : working ? t('panel.videoStudio.ai.working') : null;

  // §5.13 (V) 37-4 — 기획 카드: 기획·짓는 중인 장면이 있으면(접지 않았으면) 구슬 줄 위에 선다.
  const planVisible = chapters.some((c) => c.chapter.status !== 'done') && !ui.planCollapsed;
  const mediaName = (assetId: string): string => {
    const asset = doc?.assets[assetId];
    const owner = doc?.tracks.flatMap((tr) => tr.items).find((it) => it.assetId === assetId);
    return owner?.label ?? (asset?.source.kind === 'file' ? asset.source.path.split('/').pop() ?? assetId : assetId);
  };
  const updateChapter = (chapterId: string, patch: Partial<Omit<VideoChapter, 'id'>>): void => applyOps([{ op: 'updateChapter', chapterId, patch }]);

  // §5.13 (V) 37-7 — 맡기기는 AI 패널 한 자리(열린 메모가 있을 때만).
  const openNotes = a.notes.open.length;
  const aiActions: ReactNode = (openNotes > 0 || a.extras.aiActions || agent.engine === 'codex') ? (
    <>
      {openNotes > 0 ? (
        <button type="button" disabled={agent.sending} onClick={a.onHandNotes}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[12px] font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-40">
          <StudioIcon name="notes" className="h-3.5 w-3.5" />{t('panel.videoStudio.notes.handoff', { count: openNotes })}
        </button>
      ) : null}
      {agent.engine === 'codex' ? (
        <label className="flex items-start gap-2 text-[12px] text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={a.composer.imageGeneration} onChange={(e) => a.composer.setImageGeneration(e.target.checked)} />
          <span>
            <span className="block">{t('panel.videoStudio.ai.allowImages')}</span>
            {a.composer.imageGeneration ? <span className="block text-slate-500">{t('panel.videoStudio.ai.allowImagesNote')}</span> : null}
          </span>
        </label>
      ) : null}
      {a.extras.aiActions ?? null}
    </>
  ) : null;

  const railDrawer: ReactNode = !doc || !view ? null
    : ui.drawer === 'media' ? (
      <MediaDrawer doc={view} disabled={a.disabled} importing={a.editing.importing} onImport={(files) => { void a.editing.importFiles(files); }} onAddAsset={a.editing.addAsset}
        {...(a.extras.libraries ? { libraries: a.extras.libraries } : {})} />
    ) : ui.drawer === 'parts' ? (
      <PartsDrawer disabled={a.disabled} onAddScene={a.editing.addScene} onAddText={a.editing.addText} onAddShape={a.editing.addShape}
        onAddComposition={() => { void a.editing.addComposition(); }}
        parts={a.extras.parts?.parts ?? []} onUsePart={a.extras.parts?.onUsePart ?? (() => undefined)}
        transitions={a.extras.parts?.transitions ?? []} onTransition={a.extras.parts?.onTransition ?? (() => undefined)} seamReady={a.extras.parts?.seamReady ?? false} />
    ) : ui.drawer === 'notes' ? (
      <NotesDrawer notes={a.notes.notes} activeId={a.interaction.activeNoteId} disabled={a.disabled}
        onSeek={(note) => { a.interaction.setActiveNoteId(note.id); playback.seek(note.t); }}
        onText={a.notes.setText} onStatus={(id, status) => a.notes.setStatus(id, status)} onRemove={a.notes.remove} />
    ) : ui.drawer === 'style' ? (a.extras.styleDrawer ?? null)
      : ui.drawer === 'transcript' ? (a.extras.transcriptDrawer ?? null)
        : null;

  const valueCard: ReactNode = selected && view && !startMode ? (
    <ValueCard
      key={selected.id}
      doc={view}
      resolved={selected}
      disabled={a.disabled}
      onSetProp={a.setProp}
      onUpdate={(itemId, patch: Partial<Omit<VideoItem, 'id'>>) => applyOps([{ op: 'updateItem', itemId, patch }])}
      composition={a.editing.compositionActions}
      onClose={() => a.setSelectedItemId(null)}
    />
  ) : null;

  const nextNoteNumber = a.notes.notes.reduce((m, n) => Math.max(m, n.n), 0) + 1;

  return {
    accent: a.accent,
    hosted: a.hosted,
    chrome: a.chrome,
    header: {
      title: doc?.title ?? null,
      onRename: a.editing.rename,
      docs: a.studio.docs,
      currentDocId: doc?.id ?? null,
      onOpenDoc: (id) => { void a.studio.openDoc(id); },
      onNewDoc: () => { a.studio.closeDoc(); setUi((u) => ({ ...u, historyOpen: false, precisionOpen: false, drawer: null })); },
      format: a.format,
      onFormat: a.editing.setFormat,
      historyOpen: ui.historyOpen,
      onToggleHistory: () => setUi((u) => ({ ...u, historyOpen: !u.historyOpen })),
      historyBadge: Math.max(0, aiRevisions - ui.historySeen),
      exportProgress: a.render.progress,
      exportMenu: a.extras.exportMenu ?? ((close) => (
        <ExportMenu format={a.format ?? 'landscape'} busy={a.render.busy} canExport={playback.duration > 0} hasCaptions={hasCaptions}
          captions="burn" onCaptions={() => undefined} download={a.render.download}
          transparent={{ onExport: () => { void a.render.renderMp4(undefined, { transparent: true }); } }}
          onMp4={() => { void a.render.renderMp4(); }} onPng={() => { void a.render.savePng(); }} onSrt={() => undefined}
          onPreset={() => { void a.render.renderMp4(); }} close={close} />
      )),
      disabled: a.disabled,
    },
    start: startMode ? {
      recipes: a.recipes, recipeId: a.start.recipeId, onRecipe: a.start.onRecipe, prompt: a.start.prompt, onPrompt: a.start.setPrompt,
      format: a.start.format, onFormat: a.start.setFormat, length: a.start.length, onLength: a.start.setLength,
      engine: agent.engine, onEngine: agent.setEngine, preparation: agent.preparation, onPrepare: agent.prepare, prepareElsewhere,
      materials: a.start.materials.map((m) => ({ id: m.id, name: m.file.name, kind: m.file.type })), onAddMaterials: a.start.addMaterials,
      onRemoveMaterial: a.start.removeMaterial, recent: a.studio.docs, onOpenDoc: (id) => { void a.studio.openDoc(id); },
      onSubmit: (live) => { void a.start.submit(live); }, busy: a.start.busy || agent.sending,
    } : null,
    rail: startMode || !doc ? null : {
      open: ui.drawer,
      onOpen: (drawer) => setUi((u) => ({ ...u, drawer })),
      hasTranscript: hasCaptions,
      openNotes,
      drawer: railDrawer,
    },
    preview: startMode || !doc || !view ? null : {
      doc: view, mode: a.previewMode, canvasRef: a.canvasRef, stageHostRef: a.stageHostRef, zoom: ui.zoom, safeArea: ui.safeArea, interaction: ui.interaction,
      rings: a.interaction.rings, pins: a.interaction.pins, edit: a.interaction.edit,
      onHover: a.interaction.onHover,
      onLeave: a.interaction.onLeave,
      onPress: a.interaction.onPress,
      onDoublePress: a.interaction.onDoublePress,
      onPin: (id) => {
        a.interaction.setActiveNoteId(id);
        const note = a.notes.notes.find((n) => n.id === id);
        if (note) playback.seek(note.t);
        setUi((u) => ({ ...u, drawer: 'notes' }));
      },
      onDropFiles: (files) => { void a.editing.importFiles(files); },
      noteDraft: a.interaction.noteDraft ? { x: a.interaction.noteDraft.x, y: a.interaction.noteDraft.y, n: nextNoteNumber } : null,
      onNoteCommit: a.interaction.commitNote,
      onNoteCancel: a.interaction.cancelNote,
      empty: playback.duration > 0 ? null : (
        <div className="flex flex-col items-center gap-3 text-center">
          <StudioSteps step={working || chapters.length > 0 ? 1 : 0} />
          <p className="max-w-sm text-[13px] text-slate-400">
            {chapters.some((c) => c.chapter.status === 'plan') ? t('panel.videoStudio.preview.planReady')
              : working ? t('panel.videoStudio.preview.planning') : t('panel.videoStudio.preview.empty')}
          </p>
        </div>
      ),
    },
    controls: startMode || !doc ? null : {
      playing: playback.playing, playhead: playback.playhead, duration: playback.duration, loop: playback.loop, safeArea: ui.safeArea, zoom: ui.zoom,
      interaction: ui.interaction, precisionOpen: ui.precisionOpen, disabled: a.disabled,
      onPlay: playback.togglePlay, onStep: (n) => playback.seek(playback.playhead + n / playback.fps), onLoop: playback.toggleLoop,
      onSafeArea: () => setUi((u) => ({ ...u, safeArea: !u.safeArea })), onZoom: () => setUi((u) => ({ ...u, zoom: u.zoom === 'fit' ? 'actual' : 'fit' })),
      onInteraction: setInteraction, onPrecision: () => setUi((u) => ({ ...u, precisionOpen: !u.precisionOpen })),
    },
    strip: startMode || !doc ? null : {
      duration: playback.duration, playhead: playback.playhead,
      chapters: chapters.map((c) => ({ id: c.id, index: c.index, title: c.chapter.title, start: c.start, end: c.end, status: c.chapter.status, thumb: a.thumbs[c.id] ?? null, transition: c.chapter.transition?.kind ?? null, seam: c.start + c.overlapIn / 2 })),
      selectedChapterId: selectedChapterId ?? null, glow: a.studio.glow.chapters, workingChapterId: working?.focus ?? null,
      markers: a.extras.markers ?? [],
      noteDots: a.notes.notes.filter((n) => n.status !== 'closed').map((n) => ({ id: n.id, n: n.n, t: n.t, status: n.status })),
      beats: a.extras.beats ?? [],
      disabled: a.disabled,
      canDerive: chapters.length === 0 && playback.duration > 0,
      onSeek: playback.seek,
      onSelectChapter: (id) => { const c = chapters.find((x) => x.id === id); if (c) playback.seek(c.start); },
      onReorder: (chapterId, before) => applyOps([{ op: 'moveChapter', chapterId, ...(before ? { beforeChapterId: before } : {}) }]),
      onChapterMenu: (chapterId, anchor) => setUi((u) => ({ ...u, chapterMenu: { chapterId, anchor } })),
      onSeam: (chapterId, anchor) => setUi((u) => ({ ...u, seamMenu: { chapterId, anchor } })),
      // §5.13 (V) 37-12 — 이음매를 끌어 옮긴다 = 앞 장면 길이를 그만큼(상대 앵커라 뒤 장면이 따라온다).
      onSeamMove: (chapterId, delta) => {
        const c = chapters.find((ch) => ch.id === chapterId);
        const prev = c ? chapters[c.index - 1] : undefined;
        if (!prev) return;
        void a.edits.applyOps([{ op: 'updateChapter', chapterId: prev.id, patch: { duration: Math.max(0.1, Math.round((prev.duration + delta) * 1000) / 1000) } }]);
      },
      onMarker: (id, anchor) => setUi((u) => ({ ...u, markerMenu: { id, anchor } })),
      onNoteDot: (id) => {
        a.interaction.setActiveNoteId(id);
        const note = a.notes.notes.find((n) => n.id === id);
        if (note) playback.seek(note.t);
        setUi((u) => ({ ...u, drawer: 'notes' }));
      },
      onDerive: a.onDeriveChapters,
    },
    above: startMode || !doc ? null : planVisible ? (
      <PlanCards
        chapters={chapters}
        thumbs={a.thumbs}
        mediaName={mediaName}
        workingChapterId={working?.focus ?? null}
        fps={doc.fps}
        disabled={a.disabled}
        busy={agent.sending}
        onUpdate={updateChapter}
        onMove={(chapterId, before) => applyOps([{ op: 'moveChapter', chapterId, ...(before ? { beforeChapterId: before } : {}) }])}
        onAdd={(after) => {
          const id = `ch-${Date.now().toString(36)}`;
          const next = after ? chapters.find((c) => c.id === after) : undefined;
          const before = next ? chapters[next.index + 1]?.id : undefined;
          applyOps([{ op: 'addChapter', chapter: { id, title: t('panel.videoStudio.plan.newChapter'), duration: 3, status: 'plan' }, ...(before ? { beforeChapterId: before } : {}) }]);
        }}
        onRemove={(chapterId) => {
          const c = chapters.find((x) => x.id === chapterId);
          if (!c || !doc || !a.timeline) return;
          // 기획 장면은 아이템이 없다 — 장면만 지운다. 지어진 장면은 그 아이템과 함께(되돌릴 수 있다).
          const tl = a.timeline;
          applyOps(buildRemoveChapterOps(doc, chapterId, (itemId) => tl.items.find((it) => it.id === itemId)?.start));
        }}
        onSeek={playback.seek}
        onApprove={a.onApprovePlan}
        onCollapse={() => setUi((u) => ({ ...u, planCollapsed: true }))}
      />
    ) : chapters.some((c) => c.chapter.status !== 'done') ? (
      <button type="button" onClick={() => setUi((u) => ({ ...u, planCollapsed: false }))}
        className="flex shrink-0 items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100">
        <StudioIcon name="chevronDown" className="h-3.5 w-3.5 rotate-180" />{t('panel.videoStudio.plan.expand')}
      </button>
    ) : null,
    ai: startMode || !doc ? null : {
      collapsed: ui.aiCollapsed, onToggleCollapsed: () => setUi((u) => ({ ...u, aiCollapsed: !u.aiCollapsed })),
      engine: agent.engine, onEngine: agent.setEngine, preparation: agent.preparation, onPrepare: agent.prepare, prepareElsewhere,
      agentName: agent.agent?.label ?? null, running: (agent.agent?.running ?? false) || a.conversation.busy, activityText,
      valueCard,
      lines: a.conversation.lines,
      changeCard: (a.passChange.lines.length > 0 || a.passChange.report) ? (
        <StudioChangeCard lines={a.passChange.lines} report={a.passChange.report} open={a.passChange.open}
          onJump={(target) => {
            if (target.itemId) {
              a.setSelectedItemId(target.itemId);
              const item = a.timeline?.items.find((x) => x.id === target.itemId);
              if (item) playback.seek(item.start);
            } else if (target.chapterId) {
              const c = chapters.find((x) => x.id === target.chapterId);
              if (c) playback.seek(c.start);
            }
          }}
          onUndoPass={a.passChange.pass?.startRev ? () => {
            const rev = a.passChange.pass?.startRev;
            if (!rev) return;
            void a.history.restore(rev).then((restored) => { a.studio.setDoc(restored); a.toasts.success('panel.videoStudio.toast.passUndone'); }).catch(a.toasts.error);
          } : null} />
      ) : null,
      actions: aiActions,
      composer: {
        text: a.composer.text, onText: a.composer.setText, chips, suggestions: a.passChange.report?.suggestions ?? [],
        onAttach: (files) => { void a.composer.attach(files); }, onSend: (live) => { void a.composer.send(live); },
        canSend: !agent.sending && (a.composer.text.trim() !== '' || a.composer.assets.length > 0 || a.composer.pointed.length > 0) && agent.preparation[agent.engine] === null,
        busy: agent.sending || a.composer.attaching, disabled: false, placeholder: t('panel.videoStudio.ai.placeholder'),
      },
      onOpenIde: openIde,
    },
    history: ui.historyOpen && doc ? {
      entries: a.history.entries, stills: a.history.stills, onNeedStill: a.history.requestStill,
      onCheckpoint: () => { void a.history.checkpoint().then(() => a.toasts.success('panel.videoStudio.toast.checkpoint')); },
      onRestore: (revId) => { void a.history.restore(revId).then((restored) => { a.studio.setDoc(restored); a.toasts.success('panel.videoStudio.toast.restored'); }).catch(a.toasts.error); },
      onDelete: (revId) => { void a.history.remove(revId); },
      compare: ui.compare,
      onToggleCompare: (revId) => setUi((u) => ({ ...u, compare: u.compare.includes(revId) ? u.compare.filter((x) => x !== revId) : [...u.compare, revId].slice(-2) })),
      onOpenCompare: () => setUi((u) => ({ ...u, compareOpen: true })),
      onClose: () => setUi((u) => ({ ...u, historyOpen: false, compare: [] })),
      busy: a.disabled,
    } : null,
    precision: ui.precisionOpen && doc && view && !startMode ? {
      timeline: {
        doc: view, playhead: playback.playhead, selectedItemId: a.selectedItemId, onSeek: playback.seek, onSelectItem: a.setSelectedItemId, onApplyOps: applyOps, disabled: a.disabled,
        ...(a.extras.cues ? { onRecollectCues: a.extras.cues.onRecollect, recollectingCues: a.extras.cues.busy } : {}),
      },
      inspector: { doc: view, selectedItemId: a.selectedItemId, disabled: a.disabled, onApplyOps: applyOps, composition: a.editing.compositionActions, onSetProp: a.setProp, playhead: playback.playhead },
      undo: { run: () => { void a.edits.undo(); }, disabled: !a.edits.canUndo },
      redo: { run: () => { void a.edits.redo(); }, disabled: !a.edits.canRedo },
      split: { run: a.editing.split, disabled: !a.editing.canSplit },
      duplicate: { run: a.editing.duplicate, disabled: !selected },
      toggle: { run: a.editing.toggle, disabled: !selected },
      remove: { run: a.editing.remove, disabled: !selected },
      disabled: a.disabled,
      onClose: () => setUi((u) => ({ ...u, precisionOpen: false })),
    } : null,
    overlays: (
      <>
        {ui.strip ? <FrameStripViewer strip={ui.strip} onClose={() => setUi((u) => ({ ...u, strip: null }))} /> : null}
        {ui.compareOpen && doc && ui.compare.length === 2 ? (() => {
          const [ra, rb] = ui.compare;
          const ea = a.history.entries.find((e) => e.id === ra);
          const eb = a.history.entries.find((e) => e.id === rb);
          return ea && eb ? <HistoryCompare project={a.projectName} docId={doc.id} a={ea} b={eb} onClose={() => setUi((u) => ({ ...u, compareOpen: false }))} /> : null;
        })() : null}
        {a.extras.overlays ?? null}
      </>
    ),
    toasts: a.toasts.toasts,
    onDismissToast: a.toasts.dismiss,
    onKeyDown: a.onKeyDown,
  };
}
