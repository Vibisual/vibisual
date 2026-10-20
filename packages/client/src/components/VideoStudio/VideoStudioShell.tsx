import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  STUDIO_HIDDEN_RELEASE_MS,
  VIDEO_RECIPES,
  createEmptyDoc,
  deriveChapterOps,
  docHasCompositions,
  formatOfSize,
  hitTest,
  resolveTimeline,
  scenePartAt,
  type VideoDoc,
  type VideoDocOp,
} from '@vibisual/video';
import { footagePosterRequests, pickMediaElement, type StagePick } from '@vibisual/video/render';
import { previewTextMeasure } from './previewMeasure.js';

import { useGraphStore } from '../../stores/graphStore.js';
import { StudioConnection } from './StudioConnection.js';
import { useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { APP_BUBBLE_PARAM, getInternalApp, type AppShellProps } from '../../apps/registry.js';
import { useAppChrome } from '../../apps/appChrome.js';
import { useAppVisible, useAppWindowShown } from '../../apps/appWindowVisibility.js';
import { appTimingAt } from '../../apps/appTiming.js';
import { useIdleSettle } from './useIdleSettle.js';
import { logStudioMemory, markStudio, notePreviewWait, noteStreamCold, noteStreamPlan, noteStreamReanchor, reportStudioFirstFrame, startStudioPerfSession, type StudioPerfSession } from './studioPerf.js';
import { createPreviewQueue } from './previewQueue.js';
import { previewFrameMode, SCRUB_SETTLE_MS } from './previewPolicy.js';
import { noteStudioInput, runWhenIdle, setStudioBusy } from './studioIdle.js';
import { retainStudioAudioMemory } from './studioMedia.js';
import { VideoStudioView } from './VideoStudioView.js';
import { useVideoEdits } from './useVideoEdits.js';
import { useVideoAudio } from './useVideoAudio.js';
import { useVideoRenderer } from './useVideoRenderer.js';
import { useStagePreview } from './useStagePreview.js';
import { useStudioToasts } from './useStudioToasts.js';
import { useStudioDoc } from './useStudioDoc.js';
import { useStudioPlayback } from './useStudioPlayback.js';
import { useStudioAgent } from './useStudioAgent.js';
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
import { LazyExportDialog, LazyVariantCompare, preloadStudioPanels } from './studioPanels.js';
import { useStudioExport } from './useStudioExport.js';
import { ExportMenu } from './ExportMenu.js';
import { exportDialogProps, exportSummaryText, useExportActions } from './studioExportWiring.js';
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

/** 이 앱의 id — 이 문서에 묶인 캔버스 노드를 고를 때 쓴다(레지스트리 항목과 같은 값). */
const APP_ID = 'vibistudio';

/** §5.13 (X) 39-2 — 첫 그림이 끝내 오지 않아도(빈 문서·시작 화면·오류) 미뤄 둔 일을 시작하기까지(ms). */
const SETTLE_MAX_WAIT_MS = 2500;
/** §5.13 (Y) 40-2 ⑥ — 소리 조각 데우기를 걸기 전에 잠잠하기를 기다리는 시간(ms — AI 가 연달아 고치는 동안 되풀이하지 않게). */
const AUDIO_WARM_DELAY_MS = 400;
/** §5.13 (Y) 40-12 — 재생이 이만큼(ms) 이어지면 메모리 한 줄(켜져 있을 때만). */
const PERF_PLAY_MEMORY_MS = 60_000;
/** §5.13 (Y) 40-10 ① — 실사 포스터를 만들기 전에 잠잠하기를 기다리는 시간(ms — 소재를 연달아 들이는 동안 되풀이하지 않게). */
const POSTER_PREPARE_DELAY_MS = 800;

/**
 * §5.13 (X) 39-7 — 이 창의 프로젝트 **지문**(표시명 + 경로). `projects` 맵을 통째로 구독하면 어느 탭의 메타가 바뀌어도 스튜디오
 * 전체가 다시 그려진다 — 원시 문자열이라 이 프로젝트가 실제로 바뀔 때만 깨어난다.
 */
function projectSignature(projects: Readonly<Record<string, { readonly name: string; readonly path: string }>> | undefined, projectId: string): string {
  const p = Object.values(projects ?? {}).find((x) => x.path === projectId || x.name === projectId);
  return p ? `${p.name}\u0000${p.path}` : '';
}

/** §5.13 (Z) 41-6 — 무대 미리보기의 흘려 트는 재생 계측(켜져 있을 때만 센다). */
const STAGE_PREVIEW_PERF = { cold: noteStreamCold, plan: noteStreamPlan, reanchor: noteStreamReanchor } as const;

export function VideoStudioShell({ params }: AppShellProps): React.JSX.Element {
  const projectId = params['projectId'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const inMainWindow = !!params['appWindowId'];
  const bubbleId = params[APP_BUBBLE_PARAM] ?? '';
  const initial = useRef({ projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' });
  if (initial.current.projectId !== projectId) initial.current = { projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' };
  const { t } = useTranslation();
  const chrome = useAppChrome();
  useEffect(() => { ensureStudioMotion(); markStudio('mounted'); }, []);
  const accent = getInternalApp(APP_ID)?.glow ?? 'currentColor';
  // §5.13 (X) 39-8 — 지금 보이는가(다른 탭으로 숨은 앱 안 창·최소화된 창이면 false) — 숨은 동안 폴링·무대·굽기를 쉰다.
  const visible = useAppVisible();
  const shown = useAppWindowShown();

  const projectKey = useGraphStore((s) => projectSignature(s.projects, projectId));
  const matched = projectKey === '' ? null : projectKey.split('\u0000');
  const projectName = matched?.[0] ?? projectId;
  const projectRoot = matched?.[1] ?? projectId;

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
    paused: !visible,
  });
  const doc = studio.doc;
  const docShownRef = useRef(false);
  if (doc && !docShownRef.current) { docShownRef.current = true; markStudio('doc'); }
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

  const [released, setReleased] = useState(false);
  const renderer = useVideoRenderer(projectName, previewDoc, { previewActive: !released });
  const mediaRef = useRef(renderer.media);
  mediaRef.current = renderer.media;
  // §5.13 (Y) 40-2 · 40-9 — 소리는 렌더와 같은 믹서로 재생 머리 앞 1초 창씩 섞어 붙고, 붙은 뒤로는 재생 시계의 주인이다.
  const audio = useVideoAudio(projectName, released ? null : doc, { media: renderer.media, onError: statusToToast });
  // 40-9 — 그림이 시계보다 얼마나 뒤처졌는가(초). 미리보기 줄이 아래에서 정해진 뒤 채운다.
  const frameLag = useRef<(at: number) => number>(() => 0);
  // 40-10 ① — 재생은 누르는 순간 출발한다(첫 그림·소리를 기다리지 않는다 — 기다림 표시는 실제로 뒤처질 때만).
  const playback = useStudioPlayback(doc, {
    scope: projectName, onStart: audio.resume, audio, frameLag: (at) => frameLag.current(at), onError: toasts.error,
  });

  // §5.13 (Y) 40-12 — 계측 묶음(켜져 있을 때만 — 긴 프레임·대기·놓친 프레임을 모아 열기·재생·닫기 때 한 줄씩).
  const perfSession = useRef<StudioPerfSession | null>(null);
  useEffect(() => {
    // 40-12 — 긴 프레임은 앱 여는 누름부터 센다(단독 창이면 창이 생긴 때부터).
    const session = startStudioPerfSession(appTimingAt(`open:${APP_ID}`) ?? 0);
    perfSession.current = session;
    return () => {
      session.flush('close', { droppedFrames: mediaRef.current?.droppedFrameCount() });
      void logStudioMemory('close');
      session.stop();
      if (perfSession.current === session) perfSession.current = null;
    };
  }, []);
  useEffect(() => {
    if (!playback.playing) return undefined;
    const timer = setTimeout(() => { void logStudioMemory('play-60s'); }, PERF_PLAY_MEMORY_MS);
    return () => {
      clearTimeout(timer);
      perfSession.current?.flush('play', { droppedFrames: mediaRef.current?.droppedFrameCount() });
    };
  }, [playback.playing]);

  // §5.13 (X) 39-8 — 숨은 동안 쉬기. 창 안에서 숨으면(다른 탭) 재생을 멈춘다 — 다른 창에 가렸을 때는 그대로 둔다(사람이 켠 소리를
  //   끊지 않는다). 숨은 채 `STUDIO_HIDDEN_RELEASE_MS` 가 지나면 무대(샌드박스 문서들)를 내려놓고, 돌아오면 다시 세운다.
  useEffect(() => { if (!shown && (playback.playing || playback.preparing)) playback.setPlaying(false); }, [shown, playback.playing, playback.preparing, playback.setPlaying]);
  useEffect(() => {
    // Occlusion must not close a context that is still playing. Hidden tabs stop above, then release.
    if (visible || playback.playing || playback.preparing) { setReleased(false); return; }
    const timer = setTimeout(() => setReleased(true), STUDIO_HIDDEN_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [visible, playback.playing, playback.preparing]);
  // §5.13 (Y) 40-11 — 무대를 내려놓으면 소리 조각 기억도 놓는다(이 창의 다른 스튜디오가 쓰는 동안에는 남는다).
  useEffect(() => (released ? undefined : retainStudioAudioMemory()), [released]);

  const [ui, setUi] = useState<StudioUiState>(INITIAL_UI);

  const editing = useStudioEditing({
    projectName, projectRoot, doc, setDoc: studio.setDoc, playhead: playback.playhead, readPlayhead: playback.clock.get, selectedItemId, setSelectedItemId,
    applyOps: edits.applyOps, disabled: edits.busy, pendingWork: studio.pendingWork, openSequence: studio.openSequence,
    onError: toasts.error, onStrip: (strip) => setUi((u) => ({ ...u, strip })), refreshDocs: studio.refreshDocs,
  });

  // ─── AI ───
  const agent = useStudioAgent({ projectName, docId: doc?.id ?? '', docTitle: doc?.title ?? '', bubbleId });
  // §5.13 (Y) 40-5 ② — 대화는 AI 패널이 직접 구독한다(스트림 델타가 패널만 깨운다). 셸은 세션만 넘긴다.
  const agentId = agent.agent?.id ?? null;
  const conversation = useMemo(() => ({ agentId, sessionId: agent.sessionId }), [agentId, agent.sessionId]);
  const history = useStudioHistory(projectName, doc?.id ?? '', studio.reloadTick, toasts.error);
  const passChange = usePassChange(projectName, doc, studio.activity, history.passes);
  const notes = useStudioNotes(projectName, doc?.id ?? '', studio.reloadTick, toasts.error);
  // 렌더가 끝난 순간에만 묻는다 — 구독하면 캔버스의 노드가 움직일 때마다 스튜디오 전체가 다시 그려진다(39-7).
  const boundBubbles = useCallback((docId: string) => (useGraphStore.getState().appBubbles ?? []).filter((b) =>
    b.appId === APP_ID && b.projectName === projectName && (b.ref === docId || b.id === bubbleId)), [projectName, bubbleId]);

  // 바퀴가 끝나면(보고가 왔다) 메모도 다시 읽는다 — 보고의 `notesFixed` 가 '고침' 으로 바꿨다.
  const lastReportAt = passChange.report?.reportedAt ?? 0;
  useEffect(() => { if (lastReportAt > 0) notes.refresh(); }, [lastReportAt, notes.refresh]);

  const render = useStudioRender({
    projectName, doc, playhead: playback.playhead, readPlayhead: playback.clock.get, renderer, boundBubbles, paused: !visible,
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
  const hasCompositions = useMemo(() => (previewDoc ? (docHasCompositions(previewDoc) || previewDoc.tracks.some(track => track.items.some(item => item.kind === 'model' || (item.kind === 'image' && !!previewDoc.assets[item.assetId ?? '']?.creationSource)))) : false), [previewDoc]);
  const lastStageNotice = useRef('');
  const stagePreview = useStagePreview({
    enabled: hasCompositions && !released, project: projectName, doc: previewDoc, media: renderer.media, host: stageHostRef,
    perf: STAGE_PREVIEW_PERF,
    onEvent: (_itemId, event) => {
      if (event.kind === 'cue') return;
      const detail = event.kind === 'error' ? event.message : `blocked: ${event.url}`;
      if (detail === lastStageNotice.current) return;
      lastStageNotice.current = detail;
      toasts.error(new Error(detail));
    },
  });
  const drawPreview = renderer.drawPreview;
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  // 39-3 — 캔버스 미리보기의 첫 그림이 섰는가(무대 미리보기는 `stagePreview.ready`). 문서를 갈아타면 다시 기다린다.
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasQueue = useRef<ReturnType<typeof createPreviewQueue> | null>(null);
  useEffect(() => {
    setCanvasReady(false);
    const queue = createPreviewQueue(async (at) => {
      const canvas = canvasRef.current;
      if (!canvas || released || !previewDoc || !renderer.media) return false;
      await drawPreview(canvas, at);
    }, () => setCanvasReady(true));
    canvasQueue.current = queue;
    return () => { queue.dispose(); if (canvasQueue.current === queue) canvasQueue.current = null; };
  }, [drawPreview, released, previewDoc, renderer.media]);
  /**
   * 39-6 — 미리보기는 **시계**를 따라 그린다(재생 중 프레임마다 — 화면 전체는 다시 그리지 않는다). 도는 동안 들어온 시각은 마지막
   * 하나만 남겼다가 그린다. 종전에는 이 효과가 렌더마다 새로 만들어지는 렌더러 묶음을 의존성으로 잡아, **셸이 다시 그려질 때마다**
   * (스냅샷마다) 미리보기를 한 번 더 그렸다.
   */
  const requestDraw = useCallback((at: number): Promise<boolean> => {
    const asked = performance.now();
    const drawn = hasCompositions ? stagePreview.seek(at) : canvasQueue.current?.request(at) ?? Promise.resolve(false);
    // 40-12 — 미리보기 줄 대기(청한 때 → 그려진 때 — 켜져 있을 때만 모은다).
    return drawn.then((ok) => { if (ok) notePreviewWait(performance.now() - asked); return ok; });
  }, [hasCompositions, stagePreview.seek]);
  // 40-9 — 그림이 시계보다 뒤처진 정도: 그리는 중일 때만, 마지막으로 그린 시각과의 차(처음 한 장 전에는 모른다 — 0).
  const stageDrawnAt = stagePreview.drawnAt;
  const stageBusy = stagePreview.busy;
  frameLag.current = (at: number): number => {
    const queue = hasCompositions ? { drawnAt: stageDrawnAt, busy: stageBusy } : canvasQueue.current;
    if (!queue || !queue.busy()) return 0;
    const drawnAt = queue.drawnAt();
    return drawnAt === null ? 0 : Math.max(0, at - drawnAt);
  };
  const clock = playback.clock;
  const playingRef = useRef(playback.playing);
  playingRef.current = playback.playing;
  const previewMedia = renderer.media;
  // §5.13 (Z) 41-2 — 재생 박자를 무대에 건다(컴포지션 스스로 재생 · 합성기 예약). 멈추면 무대가 그 자리를 정확한 한 장으로.
  const stageSyncPlay = stagePreview.syncPlay;
  const playbackTiming = playback.timing;
  useEffect(() => {
    if (!hasCompositions || !playback.playing) stageSyncPlay(null);
  }, [hasCompositions, playback.playing, stageSyncPlay]);
  useEffect(() => {
    if (!previewDoc) return undefined;
    // §5.13 (Y) 40-3 ③ — 재생 중이면 순서대로, 멈춘 채 연달아 옮기면(끌기) 가까운 키프레임 먼저, 손을 멈추면 정확한 한 장으로 다시.
    let lastMoveAt = -Infinity;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let scrubbing = false;
    const endScrub = (): void => { if (scrubbing) { scrubbing = false; setStudioBusy('scrubbing', false); } };
    const draw = (): void => {
      // §5.13 (Z) 41-2 — 그리기 전에 재생 기준을 맞춘다(재생 중이면 무대의 seek 는 배치만 하고 바로 끝난다).
      if (hasCompositions) stageSyncPlay(playingRef.current ? playbackTiming() : null);
      void requestDraw(clock.get()).catch((error) => toastsRef.current.error(error));
    };
    const onMove = (): void => {
      const now = performance.now();
      const mode = previewFrameMode({ playing: playingRef.current, sinceLastMoveMs: now - lastMoveAt });
      lastMoveAt = now;
      previewMedia?.setFrameMode(mode);
      if (mode === 'scrub') {
        // 40-10 ④ — 끄는 동안 배경 일이 쉰다.
        if (!scrubbing) { scrubbing = true; setStudioBusy('scrubbing', true); }
        if (settle !== null) clearTimeout(settle);
        settle = setTimeout(() => {
          settle = null;
          endScrub();
          previewMedia?.setFrameMode(playingRef.current ? 'play' : 'exact');
          draw();
        }, SCRUB_SETTLE_MS);
      }
      draw();
    };
    previewMedia?.setFrameMode(playingRef.current ? 'play' : 'exact');
    draw();
    const off = clock.subscribe(onMove);
    return () => { off(); if (settle !== null) clearTimeout(settle); endScrub(); };
  }, [previewDoc, requestDraw, clock, drawPreview, released, previewMedia, hasCompositions, stageSyncPlay, playbackTiming]);
  const previewReady = hasCompositions ? stagePreview.ready : canvasReady;
  useEffect(() => {
    if (!previewReady) return;
    reportStudioFirstFrame(APP_ID);
    // 40-12 — 열기 묶음(첫 그림까지의 긴 프레임·대기)과 메모리 한 줄.
    perfSession.current?.flush('open', { droppedFrames: mediaRef.current?.droppedFrameCount() });
    void logStudioMemory('open');
  }, [previewReady]);
  useEffect(() => {
    // §5.13 (Y) 40-2 ⑥ — 첫 그림이 선 뒤 한가할 때 재생 머리 앞 소리 조각을 미리 풀어 둔다(섞지 않는다 · 재생·끌기·입력 중에는 미룬다).
    if (!previewReady || !visible || released) return undefined;
    const abort = new AbortController();
    void runWhenIdle(() => audio.warm(clock.get()), { signal: abort.signal, delayMs: AUDIO_WARM_DELAY_MS }).catch(() => undefined);
    return () => abort.abort();
  }, [previewReady, visible, released, doc, audio.warm, clock]);
  // §5.13 (Y) 40-10 ① — 실사 아이템마다 키프레임 포스터를 한가할 때 만들어 둔다(소재를 들이거나 문서가 열린 뒤) — 데우지 못한 실사
  //   장면으로 들어가도(점프·반복) 빈 칸 대신 그 장이 먼저 서고, 첫 프레임은 뒤에서 풀린다. 재생·끌기·입력 중에는 미룬다.
  useEffect(() => {
    if (!previewMedia || !timeline || !visible || released) return undefined;
    const requests = footagePosterRequests(timeline, clock.get());
    if (requests.length === 0) return undefined;
    const abort = new AbortController();
    void runWhenIdle(() => previewMedia.preparePosters(requests, abort.signal), { signal: abort.signal, delayMs: POSTER_PREPARE_DELAY_MS }).catch(() => undefined);
    return () => abort.abort();
  }, [previewMedia, timeline, visible, released, clock]);
  // §5.13 (Y) 40-3 ⑤ — 미리보기 배율(문서 픽셀 → 화면 픽셀)을 공급자에 알린다 — 실사를 그 폭으로만 푼다. 공급자가 바뀌면 다시 건다.
  const displayScale = useRef<number | undefined>(undefined);
  const onDisplayScale = useCallback((scale: number): void => { displayScale.current = scale; previewMedia?.setDisplayScale(scale); }, [previewMedia]);
  useEffect(() => { if (displayScale.current !== undefined) previewMedia?.setDisplayScale(displayScale.current); }, [previewMedia]);

  // §5.13 (X) 39-2·39-4 — 첫 그림이 선 뒤 한가할 때부터: 닫힌 판 미리 받기 · 대표 프레임 새로 굽기 · 음악 비트 재기.
  const settled = useIdleSettle(previewReady || (!!doc && (previewDoc?.tracks.every((track) => track.items.length === 0) ?? true)), SETTLE_MAX_WAIT_MS);
  useEffect(() => { if (settled) preloadStudioPanels(); }, [settled]);

  // §5.13 (V) 37-4·37-8 — 장면 대표 프레임(기획 카드·구슬). 저장된 문서 기준(일꾼이 찍는 것은 디스크의 문서다).
  //   39-4 — 디스크에 남은 그림은 바로, 새로 굽는 일은 첫 그림이 선 뒤 · 보이는 동안만.
  const savedTimeline = useMemo(() => (doc ? resolveTimeline(doc) : null), [doc]);
  const backgroundActive = settled && visible && !playback.playing && !playback.preparing;
  const thumbs = useChapterThumbs(projectName, doc, savedTimeline, { active: backgroundActive });
  // 39-3 — 무대가 첫 그림을 세우기 전에는 지금 장면의 대표 프레임을 포스터로 먼저 띄운다.
  const posterChapter = savedTimeline?.chapters.find((c) => playback.playhead >= c.start && playback.playhead < c.end) ?? savedTimeline?.chapters[0];
  const poster = posterChapter ? thumbs[posterChapter.id] ?? null : null;
  // §5.13 (Z) 41-5 ② — 재생 중에는 시각마다 그 장면의 대표 프레임(가벼운 판). 셸은 재생 중 다시 그려지지 않으므로 함수로 넘긴다.
  const posterAt = useCallback((at: number): string | null => {
    const chapter = savedTimeline?.chapters.find((c) => at >= c.start && at < c.end) ?? savedTimeline?.chapters[0];
    return chapter ? thumbs[chapter.id] ?? null : null;
  }, [savedTimeline, thumbs]);

  // §5.13 (R-10) — 모델·편집 이미지 안쪽 고르기는 무대가 없어도(canvas2d 미리보기) 같은 공급자 어댑터로 묻는다.
  const pickRef = useRef({ previewDoc, timeline, playhead: playback.playhead, media: renderer.media, stage: hasCompositions });
  pickRef.current = { previewDoc, timeline, playhead: playback.playhead, media: renderer.media, stage: hasCompositions };
  const stagePickAt = stagePreview.pickAt;
  const pickAt = useCallback(async (x: number, y: number): Promise<StagePick | null> => {
    const cur = pickRef.current;
    if (cur.stage) return stagePickAt(x, y);
    if (!cur.previewDoc || !cur.timeline || !cur.media) return null;
    // 캔버스 미리보기 — 기본 씬은 칠한 자리로 고르고 그 안의 글자(제목·부제·목록 줄)까지 그리기와 같은 계산으로 답한다.
    const measure = previewTextMeasure();
    // §5.13 (Y) 40-5 ① — 누른 순간의 시각(재생 중이면 상태 재생 머리는 시작 자리에 머문다).
    const hit = hitTest(cur.previewDoc, cur.timeline, clock.get(), x, y, { measure });
    if (!hit) return null;
    if (hit.op.kind === 'scene') {
      const part = scenePartAt(hit.op, { doc: cur.previewDoc, size: cur.previewDoc.size }, x, y, measure);
      return part ? { op: hit.op, element: part, rect: part.rect } : { op: hit.op, rect: hit.rect };
    }
    const element = await pickMediaElement(cur.media, hit.op, x, y).catch(() => null);
    return element ? { op: hit.op, element, rect: element.rect } : { op: hit.op, rect: hit.rect };
  }, [stagePickAt, clock]);

  // §5.13 (V) 37-6·37-7 — 미리보기 손짓(가리키기·메모·제자리 고치기).
  const interaction = usePreviewInteraction({
    projectName,
    doc: previewDoc,
    timeline,
    playhead: playback.playhead,
    readPlayhead: clock.get,
    mode: hasCompositions ? 'stage' : 'canvas',
    interaction: ui.interaction,
    selectedItemId,
    setSelectedItemId,
    pickAt,
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

  const studioKeys = useStudioKeys({
    disabled, hasMedia: playback.duration > 0, canSplit: editing.canSplit,
    undo: () => void edits.undo(), redo: () => void edits.redo(), duplicate: editing.duplicate, remove: editing.remove, split: editing.split,
    togglePlay: playback.togglePlay, step: (n) => playback.seek(playback.clock.get() + n / playback.fps), toggleLoop: playback.toggleLoop,
    toggleSafe: () => setUi((u) => ({ ...u, safeArea: !u.safeArea })), toggleZoom: () => setUi((u) => ({ ...u, zoom: u.zoom === 'fit' ? 'actual' : 'fit' })),
    setInteraction: (mode) => setUi((u) => ({ ...u, interaction: u.interaction === mode ? 'none' : mode })),
    toggleMute: () => setUi((u) => ({ ...u, muted: !u.muted })),
    escape: () => {
      if (ui.exportDialog) { setUi((u) => ({ ...u, exportDialog: null })); return true; }
      if (interaction.noteDraft) { interaction.cancelNote(); return true; }
      if (ui.strip || ui.compareOpen || ui.interaction !== 'none' || ui.chapterMenu || ui.seamMenu || ui.markerMenu) {
        setUi((u) => ({ ...u, strip: null, compareOpen: false, interaction: 'none', chapterMenu: null, seamMenu: null, markerMenu: null }));
        return true;
      }
      return false;
    },
  });
  // §5.13 (Y) 40-10 ④ — 스튜디오 안에서 키를 누르는 동안(입력·단축키) 배경 일이 잠깐 쉰다.
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => { noteStudioInput(); studioKeys(event); }, [studioKeys]);

  // ─── 3라운드 — 부품 서랍(37-11) · 모션 검수(37-9) · 구슬 메뉴·이음매·스타일·가져오기 ───
  const parts = useStudioParts({
    project: projectName, doc, timeline: savedTimeline, open: ui.drawer === 'parts', applyOps: edits.applyOps,
    onSelect: setSelectedItemId, onError: toasts.error, onSaved: () => undefined,
  });
  const review = useMotionReview(projectName, doc, savedTimeline, lastReportAt);
  // §5.13 (V) 37-12 — 음악을 넣으면 비트를 잰다(서버가 그 칸만 얹는다). §5.13 (T-8) — 표지 줄의 [다시 모으기].
  //   39-2 — 비트 재기(곡 전체 디코딩 + 분석)는 첫 그림이 선 뒤에 시작한다(여는 화면과 CPU 를 다투지 않게).
  useBeatAnalysis(projectName, backgroundActive ? doc : null, studio.setDoc);
  const cueRecollect = useCueRecollect(projectName, doc, studio.setDoc, toasts.error);
  // §5.13 (V) 37-14 — 두 엔진 나란히(갈래 둘 · 비교 판).
  const variants = useStudioVariants({
    t, doc, timeline: savedTimeline, applyOps: edits.applyOps, composer, onError: toasts.error,
    endedPassIds: history.entries.flatMap((e) => (e.kind === 'pass-end' && e.passId ? [e.passId] : [])),
  });
  // §5.13 (V) 37-15 · (AA) 42 — 내보내기 단추 하나 + 설정 창 + 렌더 대기열.
  const exporter = useStudioExport({
    projectName, doc, docs: studio.docs, timeline: savedTimeline, render,
    onError: toasts.error, onInfo: toasts.info, onSuccess: toasts.success, onDerived: () => { void studio.refreshDocs(); },
  });
  const hasCaptionCues = !!doc?.tracks.some((track) => track.items.some((item) => item.kind === 'caption' && (item.cues?.length ?? 0) > 0));
  const exportFormat = doc ? formatOfSize(doc.size) : 'landscape';
  const canExport = (savedTimeline?.duration ?? 0) > 0;
  const exportSummary = useMemo(() => exportSummaryText(t, exporter.settings, doc), [t, exporter.settings, doc]);
  const exportActions = useExportActions({ render, toasts, projectName });
  const openExport = useCallback((tab: 'settings' | 'queue'): void => setUi((u) => ({ ...u, exportDialog: tab })), []);
  // §5.13 (Y) 40-5 ③ — 머리줄의 내보내기 메뉴는 렌더 중에 그리는 함수라 정체로 비교된다 — 메뉴가 기대는 값이 바뀔 때만 새로 만든다.
  const exportMenu = useCallback((close: () => void): React.ReactNode => (
    <ExportMenu format={exportFormat} canExport={canExport} hasCaptions={hasCaptionCues} summary={exportSummary} last={render.last}
      host={exportActions.host} queue={render.queue.jobs}
      onRenderNow={exporter.renderNow} onSettings={() => openExport('settings')} onQueue={() => openExport('queue')} onPreset={exporter.preset}
      onPng={exporter.png} onSrt={exporter.srt} onDownload={() => { void render.download(); }}
      onReveal={exportActions.reveal} onOpen={exportActions.open} onRetry={exportActions.retry} onControl={exportActions.control} close={close} />
  ), [exportFormat, canExport, hasCaptionCues, exportSummary, render.last, render.queue.jobs, render.download, exportActions, exporter.renderNow, exporter.preset, exporter.png, exporter.srt, openExport]);
  // §5.13 (AA) 42-3 — 미리보기 음소거·크기(창 세션 동안만 — §3.2). 소리 시계는 그대로 돈다.
  useEffect(() => { audio.setOutput(ui.muted, ui.volume); }, [audio, ui.muted, ui.volume]);
  const exportDialog = ui.exportDialog && doc ? (
    <Suspense fallback={null}>
      <LazyExportDialog {...exportDialogProps({
        t, tab: ui.exportDialog, setUi, exporter, render, actions: exportActions, doc, docs: studio.docs, timeline: savedTimeline,
        hasCaptions: hasCaptionCues, readPlayhead: playback.clock.get, toasts,
      })} />
    </Suspense>
  ) : null;
  const compareChapter = variants.compareChapterId ? savedTimeline?.chapters.find((c) => c.id === variants.compareChapterId) : undefined;
  const extras = buildStudioExtras({
    t, projectName, projectRoot, pendingWork: studio.pendingWork, doc, timeline: savedTimeline, playhead: playback.playhead, selectedItemId,
    engine: agent.engine, sending: agent.sending, disabled,
    ui, setUi, applyOps: edits.applyOps, composer, parts, review, toasts,
    addPack: (path, label) => { void editing.addCompositionFromPath(path, label); },
    // 갈래가 이미 있으면 비교 판을 다시 연다(엔진을 다시 돌리지 않는다).
    onVariants: (chapterId) => {
      const has = (doc?.chapters?.find((c) => c.id === chapterId)?.variants?.length ?? 0) >= 2;
      if (has) variants.openCompare(chapterId);
      else void variants.start(chapterId);
    },
    more: {
      cues: cueRecollect,
      exportMenu,
      overlays: (
        <>
          {doc && compareChapter ? (
            <Suspense fallback={null}>
              <LazyVariantCompare project={projectName} doc={doc} chapter={compareChapter} media={renderer.media} disabled={disabled}
                onPick={(variantId) => variants.pick(compareChapter.id, variantId)}
                onDropUnpicked={() => variants.dropUnpicked(compareChapter.id)}
                onClose={variants.closeCompare} />
            </Suspense>
          ) : null}
          {exportDialog}
        </>
      ),
      // §5.13 (V) 37-13 — 대본 서랍(자막이 있을 때 레일에 선다). 자르기는 되돌리기 이력으로 간다.
      transcriptDrawer: doc && savedTimeline ? (
        <TranscriptDrawer doc={doc} timeline={savedTimeline} playhead={playback.playhead} clock={playback.clock} disabled={disabled}
          onSeek={playback.seek} onCut={(ops) => edits.applyOps(ops)} />
      ) : null,
    },
  });

  const view = buildStudioViewProps({
    t, accent, hosted, inMainWindow, chrome, projectName, projectId: projectRoot, doc, previewDoc, timeline, studio, playback, edits, editing,
    agent, conversation, onDisplayScale, history, passChange, render, start, composer, notes, interaction, thumbs, poster, previewReady,
    previewCold: hasCompositions && stagePreview.cold, posterAt, setProp: localProps.setProp,
    ui, setUi, selectedItemId, setSelectedItemId, toasts, canvasRef, stageHostRef,
    previewMode: hasCompositions ? 'stage' : 'canvas', disabled, onKeyDown,
    format: doc ? formatOfSize(doc.size) : null, recipes: VIDEO_RECIPES,
    onApprovePlan: approvePlan, onHandNotes: handNotes, onDeriveChapters: deriveChapters, extras,
  });
  return (
    <StudioAccentContext.Provider value={accent}>
      {/* 39-1 — 단독 창만 자기 소켓을 연다(앱 안 창은 캔버스 셸의 소켓이 같은 스토어를 채운다). */}
      {!inMainWindow ? <StudioConnection projectName={matched?.[0] ?? null} /> : null}
      <VideoStudioView {...view} />
    </StudioAccentContext.Provider>
  );
}

/** 빈 문서 하나를 만들어 주는 헬퍼 — 테스트와 초기 화면이 같은 모양을 쓰게. */
export function blankDoc(title: string): VideoDoc {
  return createEmptyDoc(`vid-${Date.now().toString(36)}`, title);
}
