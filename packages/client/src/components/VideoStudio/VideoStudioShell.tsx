import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH } from '@vibisual/shared';
import {
  VIDEO_RECIPES,
  createEmptyDoc,
  deriveChapterOps,
  docHasCompositions,
  formatOfSize,
  resolveTimeline,
  type VideoDoc,
  type VideoDocOp,
} from '@vibisual/video';

import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { APP_BUBBLE_PARAM, getInternalApp, type AppShellProps } from '../../apps/registry.js';
import { useAppChrome } from '../../apps/appChrome.js';
import { VideoStudioView } from './VideoStudioView.js';
import { useVideoEdits } from './useVideoEdits.js';
import { useVideoAudio } from './useVideoAudio.js';
import { useVideoRenderer } from './useVideoRenderer.js';
import { useStagePreview } from './useStagePreview.js';
import { useStudioToasts } from './useStudioToasts.js';
import { useStudioDoc } from './useStudioDoc.js';
import { useStudioPlayback } from './useStudioPlayback.js';
import { useStudioAgent } from './useStudioAgent.js';
import { useStudioConversation } from './useStudioConversation.js';
import { useStudioHistory } from './useStudioHistory.js';
import { useStudioEditing } from './useStudioEditing.js';
import { useStudioRender } from './useStudioRender.js';
import { useStudioKeys } from './useStudioKeys.js';
import { usePassChange } from './usePassChange.js';
import { useStudioStart } from './useStudioStart.js';
import { useStudioComposer } from './useStudioComposer.js';
import { useLocalProps } from './useLocalProps.js';
import { useStudioNotes } from './useStudioNotes.js';
import { useChapterThumbs } from './useChapterThumbs.js';
import { usePreviewInteraction } from './usePreviewInteraction.js';
import { useStudioParts } from './useStudioParts.js';
import { useMotionReview } from './useMotionReview.js';
import { buildStudioExtras } from './studioExtras.js';
import { useBeatAnalysis } from './useBeatAnalysis.js';
import { useCueRecollect } from './useCueRecollect.js';
import { TranscriptDrawer } from './TranscriptDrawer.js';
import { useStudioVariants } from './useStudioVariants.js';
import { VariantCompare } from './VariantCompare.js';
import { useStudioExport } from './useStudioExport.js';
import { ExportMenu } from './ExportMenu.js';
import { ensureStudioMotion, StudioAccentContext } from './studioMotion.js';
import { buildStudioViewProps, INITIAL_UI, type StudioUiState } from './studioViewProps.js';

/**
 * §5.13 Vibistudio — 스튜디오 창(앱 셸). §5.13 (V) 개편으로 다시 지었다.
 *
 * `#app=vibistudio&mode=main&projectId=…`(앱 안 창·분리된 창 모두)로 뜬다. 데이터는 같은 in-process 서버에 IPC 로 붙는다.
 * 이 파일은 상태 훅을 묶기만 한다 — 문서(`useStudioDoc`) · 재생 · 손 편집(`useStudioEditing`) · 값 손잡이(`useLocalProps`) ·
 * 가리키기·메모(`usePreviewInteraction`·`useStudioNotes`) · AI(`useStudioAgent` + `useStudioConversation` — IDE 스트림을 읽는다) ·
 * 판 기록 · 내보내기 · 단축키. 화면 조립은 `studioViewProps.tsx`, 배치는 `VideoStudioView.tsx`. 스틸·렌더 일감은 숨은 일꾼 창이
 * 처리하고(§5.13 (T-4)) 이 창은 걸고 지켜보기만 한다.
 */

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

/** 이 앱의 id — 이 문서에 묶인 캔버스 노드를 고를 때 쓴다(레지스트리 항목과 같은 값). */
const APP_ID = 'vibistudio';

export function VideoStudioShell({ params }: AppShellProps): React.JSX.Element {
  const projectId = params['projectId'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const inMainWindow = !!params['appWindowId'];
  const bubbleId = params[APP_BUBBLE_PARAM] ?? '';
  const initial = useRef({ projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' });
  if (initial.current.projectId !== projectId) initial.current = { projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' };
  useWebSocket(WS_URL);
  const { t } = useTranslation();
  const chrome = useAppChrome();
  useEffect(() => { ensureStudioMotion(); }, []);
  const accent = getInternalApp(APP_ID)?.glow ?? 'currentColor';

  const projects = useGraphStore((s) => s.projects);
  const project = useMemo(() => Object.values(projects).find((p) => p.path === projectId || p.name === projectId), [projects, projectId]);
  const projectName = project?.name ?? projectId;
  const projectRoot = project?.path ?? projectId;

  const toasts = useStudioToasts();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const resetEditsRef = useRef<() => void>(() => undefined);
  const studio = useStudioDoc({
    projectName,
    docParam: initial.current.docId,
    fileParam: initial.current.file,
    onError: toasts.error,
    onFileUnreadable: (name) => toasts.info('panel.videoStudio.fileUnreadable', { name }),
    onSwitch: () => { resetEditsRef.current(); setSelectedItemId(null); },
  });
  const doc = studio.doc;
  const openedDoc = useRef(false);
  if (doc) openedDoc.current = true;
  useAppWindowTarget(params, doc || openedDoc.current ? { ref: doc?.id, file: undefined } : null);
  useAppWindowTransferGuard(params, async () => studio.pendingWork.current === 0);
  // §5.13 (V) 37-1 — 창 제목 = 문서 제목(앱 이름 대신). 창이 머리줄 자리를 주는 곳에서만.
  useEffect(() => {
    chrome?.setTitle(doc?.title ?? null);
    return () => chrome?.setTitle(null);
  }, [chrome, doc?.title]);

  const statusToToast = useCallback((message: string): void => {
    if (!message) return;
    if (message === t('panel.videoStudio.reloaded')) toasts.info('panel.videoStudio.reloaded');
    else toasts.error(message);
  }, [t, toasts]);

  const edits = useVideoEdits(projectName, doc, studio.setDoc, statusToToast, studio.pendingWork);
  resetEditsRef.current = edits.reset;
  // §5.13 (V) 37-5 — 값 손잡이: 화면은 덮어쓰기를 입힌 사본(previewDoc)을 본다. 저장은 뒤에서 묶어 한 번.
  const localProps = useLocalProps(doc, edits.applyOps);
  const previewDoc = localProps.previewDoc;
  const timeline = useMemo(() => (previewDoc ? resolveTimeline(previewDoc) : null), [previewDoc]);

  const renderer = useVideoRenderer(projectName, previewDoc);
  const audioResume = useRef<() => void>(() => undefined);
  const playback = useStudioPlayback(doc, () => audioResume.current());
  const audio = useVideoAudio(projectName, doc, playback.playing, playback.playhead, playback.loop, statusToToast);
  audioResume.current = audio.resume;

  const [ui, setUi] = useState<StudioUiState>(INITIAL_UI);

  const editing = useStudioEditing({
    projectName, projectRoot, doc, setDoc: studio.setDoc, playhead: playback.playhead, selectedItemId, setSelectedItemId,
    applyOps: edits.applyOps, disabled: edits.busy, pendingWork: studio.pendingWork, openSequence: studio.openSequence,
    onError: toasts.error, onStrip: (strip) => setUi((u) => ({ ...u, strip })), refreshDocs: studio.refreshDocs,
  });

  // ─── AI ───
  const agent = useStudioAgent({ projectName, docId: doc?.id ?? '', docTitle: doc?.title ?? '', bubbleId });
  const conversation = useStudioConversation(agent.agent?.id ?? null, agent.sessionId);
  const history = useStudioHistory(projectName, doc?.id ?? '', studio.reloadTick, toasts.error);
  const passChange = usePassChange(projectName, doc, studio.activity, history.passes);
  const notes = useStudioNotes(projectName, doc?.id ?? '', studio.reloadTick, toasts.error);
  const appBubbles = useGraphStore((s) => s.appBubbles);
  const boundBubbles = useCallback((docId: string) => (appBubbles ?? []).filter((b) =>
    b.appId === APP_ID && b.projectName === projectName && (b.ref === docId || b.id === bubbleId)), [appBubbles, projectName, bubbleId]);

  // 바퀴가 끝나면(보고가 왔다) 메모도 다시 읽는다 — 보고의 `notesFixed` 가 '고침' 으로 바꿨다.
  const lastReportAt = passChange.report?.reportedAt ?? 0;
  useEffect(() => { if (lastReportAt > 0) notes.refresh(); }, [lastReportAt, notes.refresh]);

  const render = useStudioRender({
    projectName, doc, playhead: playback.playhead, renderer, boundBubbles,
    onError: toasts.error, onDone: (note) => toasts.success(note ? 'panel.videoStudio.toast.renderDoneNote' : 'panel.videoStudio.renderDone', note ? { note } : undefined),
    onCuesStale: () => toasts.info('panel.videoStudio.toast.cuesStale'),
  });
  const disabled = edits.busy || editing.importing || render.busy;

  const start = useStudioStart({
    projectName, projectRoot, studio, agent, onError: toasts.error,
    onSent: (docId) => { toasts.success('panel.videoStudio.toast.sent'); history.refresh(); setUi((u) => ({ ...u, editorFor: docId })); },
    openEditor: (docId, drawer) => setUi((u) => ({ ...u, drawer, editorFor: docId })),
  });
  const composer = useStudioComposer({ projectName, doc, playback, selectedItemId, agent, applyOps: edits.applyOps, disabled, onError: toasts.error, onSent: () => { toasts.success('panel.videoStudio.toast.sent'); history.refresh(); } });

  // ─── 미리보기 ───
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const hasCompositions = useMemo(() => (previewDoc ? docHasCompositions(previewDoc) : false), [previewDoc]);
  const lastStageNotice = useRef('');
  const stagePreview = useStagePreview({
    enabled: hasCompositions, project: projectName, doc: previewDoc, media: renderer.media, host: stageHostRef,
    onEvent: (_itemId, event) => {
      if (event.kind === 'cue') return;
      const detail = event.kind === 'error' ? event.message : `blocked: ${event.url}`;
      if (detail === lastStageNotice.current) return;
      lastStageNotice.current = detail;
      toasts.error(new Error(detail));
    },
  });
  const drawLoop = useRef<{ busy: boolean; want: number | null }>({ busy: false, want: null });
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  useEffect(() => {
    if (!previewDoc) return;
    if (hasCompositions) { stagePreview.seek(playback.playhead); return; }
    if (!canvasRef.current) return;
    const loop = drawLoop.current;
    loop.want = playback.playhead;
    if (loop.busy) return;
    loop.busy = true;
    void (async () => {
      try {
        while (loop.want !== null) {
          const at = loop.want;
          loop.want = null;
          const canvas = canvasRef.current;
          if (!canvas) break;
          await rendererRef.current.drawPreview(canvas, at);
        }
      } catch (err) {
        toasts.error(err);
      } finally {
        loop.busy = false;
      }
    })();
    // 미리보기는 문서(덮어쓰기 포함)·재생 머리가 바뀔 때만 다시 그린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDoc, playback.playhead, renderer, hasCompositions, stagePreview.seek]);

  // §5.13 (V) 37-4·37-8 — 장면 대표 프레임(기획 카드·구슬). 저장된 문서 기준(일꾼이 찍는 것은 디스크의 문서다).
  const savedTimeline = useMemo(() => (doc ? resolveTimeline(doc) : null), [doc]);
  const thumbs = useChapterThumbs(projectName, doc, savedTimeline);

  // §5.13 (V) 37-6·37-7 — 미리보기 손짓(가리키기·메모·제자리 고치기).
  const interaction = usePreviewInteraction({
    doc: previewDoc,
    timeline,
    playhead: playback.playhead,
    mode: hasCompositions ? 'stage' : 'canvas',
    interaction: ui.interaction,
    selectedItemId,
    setSelectedItemId,
    pickAt: stagePreview.pickAt,
    addPointed: composer.addPointed,
    pointed: composer.pointed,
    notes: notes.notes,
    addNote: notes.add,
    onSetProp: localProps.setProp,
    onNoteAdded: () => setUi((u) => ({ ...u, drawer: 'notes' })),
  });

  // 판 기록을 열면 그때까지의 AI 판은 본 것으로 친다(머리줄 숫자).
  const aiRevisions = history.entries.filter((e) => e.by === 'ai').length;
  useEffect(() => { if (ui.historyOpen) setUi((u) => (u.historySeen === aiRevisions ? u : { ...u, historySeen: aiRevisions })); }, [ui.historyOpen, aiRevisions]);

  // ─── 장면·메모가 여는 바퀴 ───

  /** §5.13 (V) 37-4 — [이대로 만들기]: 기획 장면을 승인하고 '짓기' 바퀴를 보낸다. */
  const approvePlan = useCallback((): void => {
    if (!doc || !savedTimeline) return;
    const plan = savedTimeline.chapters.filter((c) => c.chapter.status === 'plan');
    if (plan.length === 0) return;
    void (async () => {
      localProps.flush();
      const ok = await edits.applyOps(plan.map((c): VideoDocOp => ({ op: 'updateChapter', chapterId: c.id, patch: { status: 'approved' } })));
      if (!ok) return;
      await composer.sendPass(t('panel.videoStudio.plan.buildRequest', { count: plan.length }), 'build');
      history.refresh();
      setUi((u) => ({ ...u, planCollapsed: false }));
    })();
  }, [doc, savedTimeline, localProps, edits, composer, t, history]);

  /** §5.13 (V) 37-7 — [고칠 점 n개 맡기기]: 열린 메모를 한 바퀴로 보내고 '보냄' 으로 적는다. */
  const handNotes = useCallback((): void => {
    const open = notes.open;
    if (open.length === 0) return;
    void (async () => {
      const passId = await composer.sendPass(t('panel.videoStudio.notes.handoffRequest', { count: open.length }), 'notes', {
        notes: open.map((n) => ({
          id: n.id, n: n.n, t: n.t, x: n.x, y: n.y, text: n.text,
          ...(n.itemId ? { itemId: n.itemId } : {}),
          ...(n.element ? { path: n.element } : {}),
        })),
      });
      if (!passId) return;
      for (const n of open) notes.setStatus(n.id, 'sent', passId);
      history.refresh();
    })();
  }, [notes, composer, t, history]);

  /** §5.13 (V) 37-4 — 장면이 없는 옛 문서: 첫 화면 트랙의 컷 경계로 장면을 짓는다(되돌릴 수 있다). */
  const deriveChapters = useCallback((): void => {
    if (!doc || !savedTimeline) return;
    const ops = deriveChapterOps(doc, savedTimeline, (i, label) => label?.trim() || t('panel.videoStudio.strip.chapterN', { n: i + 1 }));
    if (ops.length === 0) { toasts.info('panel.videoStudio.toast.nothingToDerive'); return; }
    void edits.applyOps(ops);
  }, [doc, savedTimeline, t, toasts, edits]);

  const onKeyDown = useStudioKeys({
    disabled, hasMedia: playback.duration > 0, canSplit: editing.canSplit,
    undo: () => void edits.undo(), redo: () => void edits.redo(), duplicate: editing.duplicate, remove: editing.remove, split: editing.split,
    togglePlay: playback.togglePlay, step: (n) => playback.seek(playback.playhead + n / playback.fps), toggleLoop: playback.toggleLoop,
    toggleSafe: () => setUi((u) => ({ ...u, safeArea: !u.safeArea })), toggleZoom: () => setUi((u) => ({ ...u, zoom: u.zoom === 'fit' ? 'actual' : 'fit' })),
    setInteraction: (mode) => setUi((u) => ({ ...u, interaction: u.interaction === mode ? 'none' : mode })),
    escape: () => {
      if (interaction.noteDraft) { interaction.cancelNote(); return true; }
      if (ui.strip || ui.compareOpen || ui.interaction !== 'none' || ui.chapterMenu || ui.seamMenu || ui.markerMenu) {
        setUi((u) => ({ ...u, strip: null, compareOpen: false, interaction: 'none', chapterMenu: null, seamMenu: null, markerMenu: null }));
        return true;
      }
      return false;
    },
  });

  // ─── 3라운드 — 부품 서랍(37-11) · 모션 검수(37-9) · 구슬 메뉴·이음매·스타일·가져오기 ───
  const parts = useStudioParts({
    project: projectName, doc, timeline: savedTimeline, open: ui.drawer === 'parts', applyOps: edits.applyOps,
    onSelect: setSelectedItemId, onError: toasts.error, onSaved: () => undefined,
  });
  const review = useMotionReview(projectName, doc, savedTimeline, lastReportAt);
  // §5.13 (V) 37-12 — 음악을 넣으면 비트를 잰다(서버가 그 칸만 얹는다). §5.13 (T-8) — 표지 줄의 [다시 모으기].
  useBeatAnalysis(projectName, doc, studio.setDoc);
  const cueRecollect = useCueRecollect(projectName, doc, studio.setDoc, toasts.error);
  // §5.13 (V) 37-14 — 두 엔진 나란히(갈래 둘 · 비교 판).
  const variants = useStudioVariants({
    t, doc, timeline: savedTimeline, applyOps: edits.applyOps, composer, onError: toasts.error,
    endedPassIds: history.entries.flatMap((e) => (e.kind === 'pass-end' && e.passId ? [e.passId] : [])),
  });
  // §5.13 (V) 37-15 — 내보내기 단추 하나(MP4·PNG·SRT·프리셋·자막 굽기/따로).
  const exporter = useStudioExport({ projectName, doc, render, onError: toasts.error, onInfo: toasts.info, onDerived: () => { void studio.refreshDocs(); } });
  const hasCaptionCues = !!doc?.tracks.some((track) => track.items.some((item) => item.kind === 'caption' && (item.cues?.length ?? 0) > 0));
  const compareChapter = variants.compareChapterId ? savedTimeline?.chapters.find((c) => c.id === variants.compareChapterId) : undefined;
  const extras = buildStudioExtras({
    t, projectName, doc, timeline: savedTimeline, playhead: playback.playhead, engine: agent.engine, sending: agent.sending, disabled,
    ui, setUi, applyOps: (ops) => { void edits.applyOps(ops); }, composer, parts, review, toasts,
    addPack: (path, label) => { void editing.addCompositionFromPath(path, label); },
    // 갈래가 이미 있으면 비교 판을 다시 연다(엔진을 다시 돌리지 않는다).
    onVariants: (chapterId) => {
      const has = (doc?.chapters?.find((c) => c.id === chapterId)?.variants?.length ?? 0) >= 2;
      if (has) variants.openCompare(chapterId);
      else void variants.start(chapterId);
    },
    more: {
      cues: cueRecollect,
      exportMenu: (close) => (
        <ExportMenu format={doc ? formatOfSize(doc.size) : 'landscape'} busy={render.busy} canExport={(savedTimeline?.duration ?? 0) > 0}
          hasCaptions={hasCaptionCues} captions={exporter.captions} onCaptions={exporter.setCaptions} download={render.download}
          transparent={{ onExport: exporter.transparent }} onMp4={exporter.mp4} onPng={exporter.png} onSrt={exporter.srt} onPreset={exporter.preset} close={close} />
      ),
      overlays: doc && compareChapter ? (
        <VariantCompare project={projectName} doc={doc} chapter={compareChapter} media={renderer.media} disabled={disabled}
          onPick={(variantId) => variants.pick(compareChapter.id, variantId)}
          onDropUnpicked={() => variants.dropUnpicked(compareChapter.id)}
          onClose={variants.closeCompare} />
      ) : null,
      // §5.13 (V) 37-13 — 대본 서랍(자막이 있을 때 레일에 선다). 자르기는 되돌리기 이력으로 간다.
      transcriptDrawer: doc && savedTimeline ? (
        <TranscriptDrawer doc={doc} timeline={savedTimeline} playhead={playback.playhead} disabled={disabled}
          onSeek={playback.seek} onCut={(ops) => edits.applyOps(ops)} />
      ) : null,
    },
  });

  const view = buildStudioViewProps({
    t, accent, hosted, inMainWindow, chrome, projectName, projectId: projectRoot, doc, previewDoc, timeline, studio, playback, edits, editing,
    agent, conversation, history, passChange, render, start, composer, notes, interaction, thumbs, setProp: localProps.setProp,
    ui, setUi, selectedItemId, setSelectedItemId, toasts, canvasRef, stageHostRef,
    previewMode: hasCompositions ? 'stage' : 'canvas', disabled, onKeyDown,
    format: doc ? formatOfSize(doc.size) : null, recipes: VIDEO_RECIPES,
    onApprovePlan: approvePlan, onHandNotes: handNotes, onDeriveChapters: deriveChapters, extras,
  });
  return (
    <StudioAccentContext.Provider value={accent}>
      <VideoStudioView {...view} />
    </StudioAccentContext.Provider>
  );
}

/** 빈 문서 하나를 만들어 주는 헬퍼 — 테스트와 초기 화면이 같은 모양을 쓰게. */
export function blankDoc(title: string): VideoDoc {
  return createEmptyDoc(`vid-${Date.now().toString(36)}`, title);
}
