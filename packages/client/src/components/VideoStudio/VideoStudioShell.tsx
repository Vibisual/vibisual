import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH } from '@vibisual/shared';
import {
  FILE_DOC_ASSET_ID,
  assetsNeedingMeasurement,
  buildFileDocOps,
  buildMeasurementOps,
  createEmptyDoc,
  isUntouchedDoc,
  resolveTimeline,
  stableHash,
  type VideoDoc,
  type VideoDocOp,
} from '@vibisual/video';

import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { VideoStudioView } from './VideoStudioView.js';
import { useVideoEdits } from './useVideoEdits.js';
import { buildAddSceneOps, buildAddTextOps, buildAddShapeOps, buildAssetItemOps, buildDuplicateOps, buildSplitOps, buildRemoveOps } from './videoEditor.js';
import { parseSrt, buildCaptionOps } from './videoCaptions.js';
import { useVideoJobWorker } from './useVideoJobWorker.js';
import { useVideoAudio } from './useVideoAudio.js';
import { measureAssets, useVideoRenderer } from './useVideoRenderer.js';
import {
  createDoc,
  importVideoAsset,
  getJob,
  assetUrl,
  listDocs,
  patchDoc,
  readDoc,
  startRender,
  type DocSummary,
} from './videoApi.js';

/**
 * §5.13 Vibistudio — 스튜디오 창(여섯 번째 shell).
 *
 * `#video=1&projectId=…` 로 뜬다(DetachedShell / OverlayShell / OverlayMenuShell /
 * CommandCenterShell 에 이어). 데이터는 다른 창과 같은 in-process 서버에 IPC WS 로
 * 붙어 받는다 — 별도 hydrate 를 만들지 않는다.
 *
 * 이 창은 화면이자 **일꾼**이다. 서버는 캔버스가 없어 그릴 수 없으므로, 에이전트가
 * 건 스틸·렌더 일감을 이 창이 가져가 처리하고 결과를 돌려준다. 창이 닫혀 있으면
 * 그 요청은 시간이 지나 실패로 끝난다 — 조용히 매달려 있지 않는다.
 */

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

/** 일감을 얼마나 자주 가져가 볼지(ms). 너무 잦으면 놀고 있는 창이 CPU 를 먹는다. */

import type { AppShellProps } from '../../apps/registry.js';

// 창 판별(`parseVideoStudioHash`)은 `videoStudioHash.ts` 에 따로 있다 — 부팅 경로가
// 이 파일을 끌어오면 동적 청크 분리가 무의미해지기 때문이다(§5.13 (H)).


export function VideoStudioShell({ params }: AppShellProps): React.JSX.Element {
  const projectId = params['projectId'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const initial = useRef({ projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' });
  if (initial.current.projectId !== projectId) initial.current = { projectId, docId: params['docId'] ?? '', file: params['file'] ?? '' };
  const docParam = initial.current.docId;
  useWebSocket(WS_URL);
  const { t } = useTranslation();

  const projects = useGraphStore((s) => s.projects);

  const projectName = useMemo(() => {
    const found = Object.values(projects).find((p) => p.path === projectId || p.name === projectId);
    return found?.name ?? projectId;
  }, [projects, projectId]);


  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [doc, setDoc] = useState<VideoDoc | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [renderPct, setRenderPct] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [download, setDownload] = useState<{ url: string; name: string; docId: string } | null>(null);
  const renderBusy = useRef(false);
  const [renderJob, setRenderJob] = useState<string | null>(null);
  const openedDoc = useRef(false);
  const openSequence = useRef(0);
  const pendingWorkRef = useRef(0);
  if (doc) openedDoc.current = true;
  useAppWindowTarget(params, doc || openedDoc.current ? { ref: doc?.id, file: undefined } : null);
  useAppWindowTransferGuard(params, async () => pendingWorkRef.current === 0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useVideoRenderer(projectName, doc);
  const audio = useVideoAudio(projectName, doc, playing, playhead, loopPlayback, setStatus);
  const editing = useVideoEdits(projectName, doc, setDoc, setStatus, pendingWorkRef);
  const { applyOps } = editing;
  const disabled = editing.busy || importing || renderPct !== null || renderJob !== null;
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  useEffect(() => { setDownload(null); }, [projectName]);

  // ─── 문서 열기 ───

  const refreshDocs = useCallback(async (): Promise<void> => {
    try {
      setDocs(await listDocs(projectName));
    } catch (err) {
      setStatus(String(err));
    }
  }, [projectName]);

  /**
   * 길이가 비어 있는 영상·소리 소재를 재서 문서에 적는다(§5.13 (R-3)).
   *
   * `duration:'auto'` 는 이 값이 있어야 풀린다. 에이전트가 길이 없이 써 둔 문서도 열 때
   * 여기서 풀린다. 재지 못했거나 그 사이 다른 곳이 먼저 고쳤으면 원래 문서를 그대로 쓴다.
   */
  const fillMeasurements = useCallback(
    async (current: VideoDoc): Promise<VideoDoc> => {
      const pending = assetsNeedingMeasurement(current);
      if (pending.length === 0) return current;
      const ops = buildMeasurementOps(current, await measureAssets(projectName, pending));
      if (ops.length === 0) return current;
      try {
        return (await patchDoc(projectName, current.id, current.version, ops)).doc;
      } catch {
        return current;
      }
    },
    [projectName],
  );

  const openDoc = useCallback(
    async (docId: string): Promise<void> => {
      const sequence = ++openSequence.current;
      editing.reset();
      pendingWorkRef.current += 1;
      try {
        const env = await readDoc(projectName, docId);
        const next = await fillMeasurements(env.doc);
        if (sequence !== openSequence.current) return;
        setDoc(next);
        setSelectedItemId(null);
        setPlayhead(0);
        setPlaying(false);
        setStatus('');
      } catch (err) {
        if (sequence === openSequence.current) setStatus(String(err));
      } finally { pendingWorkRef.current -= 1; }
    },
    [projectName, fillMeasurements, editing.reset],
  );

  useEffect(() => {
    void refreshDocs();
  }, [refreshDocs]);
  useEffect(() => {
    if (docParam && projectName) void openDoc(docParam);
    return () => { openSequence.current += 1; };
  }, [docParam, projectName, openDoc]);

  /**
   * §5.13 (R-3) — **파일을 눌러 열린 창**.
   *
   * 그 영상을 담은 문서를 프로젝트 안에 세우고(`file-<해시>` 안정 id) 바로 편집으로 들어간다.
   * 같은 파일을 다시 눌러도 같은 문서로 돌아오므로, 손본 컷·자막이 그대로 남는다.
   *
   * 이미 아이템이 있는 문서는 **건드리지 않는다** — 사람이 편집한 문서에 원본 클립을 다시
   * 얹으면 그 편집을 조용히 되돌리는 셈이 된다.
   *
   * "손대지 않은 문서"는 **아이템이 하나도 없는 문서**다. 새 문서는 빈 트랙 셋을 달고 태어나므로
   * 트랙 수로 판정하면 영상이 영영 실리지 않는다(`fileDoc.ts`). 그리고 영상을 먼저 재서 길이·크기를
   * 함께 적는다 — 길이 없는 `'auto'` 클립은 해소기가 빼 버려 화면이 빈다.
   */
  const fileParam = docParam ? '' : initial.current.file;
  const fileHandledRef = useRef('');
  useEffect(() => {
    if (fileParam === '' || projectName === '' || fileHandledRef.current === fileParam) return;
    fileHandledRef.current = fileParam;
    const sequence = ++openSequence.current;
    pendingWorkRef.current += 1;
    let alive = true;
    void (async () => {
      try {
        const name = fileParam.split('/').pop() ?? fileParam;
        const created = await createDoc(projectName, name, `file-${stableHash(fileParam)}`);
        let current = created;
        if (isUntouchedDoc(current)) {
          const measured = await measureAssets(projectName, [
            { id: FILE_DOC_ASSET_ID, kind: 'video', source: { kind: 'file', path: fileParam } },
          ]);
          const probe = measured[FILE_DOC_ASSET_ID];
          const ops = probe ? buildFileDocOps(current, { path: fileParam, label: name }, probe) : [];
          if (ops.length === 0) {
            // 못 읽었다 — 빈 화면으로 조용히 두지 않는다. 문서는 비워 둬 다시 열 때 다시 잰다.
            fileHandledRef.current = '';
            if (alive) {
              setStatus(t('panel.videoStudio.fileUnreadable', { defaultValue: '이 영상을 읽지 못했습니다: {{name}}', name }));
            }
          } else {
            current = (await patchDoc(projectName, current.id, current.version, ops)).doc;
          }
        } else {
          current = await fillMeasurements(current);
        }
        if (!alive || sequence !== openSequence.current) return;
        setDoc(current);
        setPlayhead(0);
        setPlaying(false);
        if (!isUntouchedDoc(current)) setStatus('');
        void refreshDocs();
      } catch (err) {
        if (alive && sequence === openSequence.current) setStatus(String(err));
      } finally { pendingWorkRef.current -= 1; }
    })();
    return () => {
      alive = false;
    };
  }, [fileParam, projectName, refreshDocs, fillMeasurements, t]);

  const createNewDoc = useCallback(async (): Promise<void> => {
    const sequence = ++openSequence.current;
    pendingWorkRef.current += 1;
    try {
      const created = await createDoc(projectName, t('panel.videoStudio.untitled', { defaultValue: '새 영상' }));
      await refreshDocs();
      if (sequence === openSequence.current) { setDoc(created); setPlayhead(0); setSelectedItemId(null); setPlaying(false); }
    } catch (err) {
      if (sequence === openSequence.current) setStatus(String(err));
    } finally { pendingWorkRef.current -= 1; }
  }, [projectName, refreshDocs, t]);

  // ─── 미리보기 ───

  /**
   * 그리기는 **한 번에 하나만** 돈다. 재생 중엔 매 화면마다 재생 머리가 움직이는데, 그때마다
   * 그리기를 겹쳐 띄우면 늦게 끝난 옛 프레임이 새 프레임을 덮어 화면이 앞뒤로 튄다.
   * 도는 동안 들어온 요청은 마지막 하나만 남겼다가, 앞의 것이 끝나면 그것을 그린다.
   */
  const drawLoopRef = useRef<{ busy: boolean; want: number | null }>({ busy: false, want: null });
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;

  useEffect(() => {
    if (!canvasRef.current || !doc) return;
    const loop = drawLoopRef.current;
    loop.want = playhead;
    if (loop.busy) return;
    loop.busy = true;
    void (async () => {
      try {
        while (loop.want !== null) {
          const at = loop.want;
          loop.want = null;
          const canvas = canvasRef.current;
          if (!canvas) break;
          // 도는 사이 문서가 바뀌었을 수 있다 — 늘 지금의 렌더러로 그린다.
          await rendererRef.current.drawPreview(canvas, at);
        }
      } catch {
        setStatus(t('panel.videoStudio.previewFailed', { defaultValue: '미리보기를 그리지 못했습니다.' }));
      } finally {
        loop.busy = false;
      }
    })();
  }, [doc, playhead, renderer, t]);

  /** 영상 전체 길이와 마지막 프레임 시각. 끝(`end`)은 반열린 구간이라 그 시각엔 아무것도 없다. */
  const duration = useMemo(() => (doc ? resolveTimeline(doc).duration : 0), [doc]);
  const lastFrameAt = doc ? Math.max(0, duration - 1 / doc.fps) : 0;
  useEffect(() => { setPlaying(false); setPlayhead(at => Math.min(at, lastFrameAt)); }, [doc]);

  // 재생 — 실제 시간에 맞춰 재생 머리를 움직인다. 렌더가 아니라 미리보기라
  // 프레임을 다 그리지 못해도 시간은 어긋나지 않게 벽시계를 기준으로 삼는다.
  // 끝에 닿으면 마지막 프레임에 멈춘다 — 계속 흘러가면 빈 검은 화면만 남는다.
  useEffect(() => {
    if (!playing || !doc) return;
    const startedAt = performance.now();
    const from = playhead;
    let raf = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const next = loopPlayback && duration > 0 ? (from + elapsed) % duration : from + elapsed;
      if (!loopPlayback && next >= lastFrameAt) {
        setPlayhead(lastFrameAt);
        setPlaying(false);
        return;
      }
      setPlayhead(Math.min(lastFrameAt, Math.floor(next * doc.fps) / doc.fps));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // playhead 를 의존성에 넣으면 매 프레임 타이머가 다시 걸린다 — 시작점만 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, doc, loopPlayback]);

  /** 끝에서 다시 누르면 처음부터. */
  const togglePlay = useCallback((): void => {
    if (!playing) audio.resume();
    if (!playing && playhead >= lastFrameAt) setPlayhead(0);
    setPlaying((p) => !p);
  }, [playing, playhead, lastFrameAt, audio.resume]);

  // ─── 편집 ───

  const insert = useCallback(async (ops: readonly VideoDocOp[]): Promise<boolean> => {
    const added = ops.flatMap(op => op.op === 'addItem' ? [op.item] : op.op === 'addTrack' ? [...op.track.items] : []).at(-1);
    const success = await applyOps(ops);
    if (success && added) setSelectedItemId(added.id);
    return success;
  }, [applyOps]);

  const addTitleScene = useCallback((): void => {
    if (!doc) return;
    void insert(buildAddSceneOps(doc, 'title', playhead, t('panel.videoStudio.newTitle', { defaultValue: '제목 화면' })));
  }, [doc, playhead, insert, t]);

  const toggleSelected = useCallback((): void => {
    if (!doc || !selectedItemId) return;
    const current = doc.tracks.flatMap((tr) => tr.items).find((i) => i.id === selectedItemId);
    if (!current) return;
    void applyOps([{ op: 'updateItem', itemId: selectedItemId, patch: { enabled: current.enabled === false } }]);
  }, [doc, selectedItemId, applyOps]);

  const removeSelected = useCallback((): void => {
    if (!doc || !selectedItemId) return;
    void applyOps(buildRemoveOps(doc, selectedItemId)).then(ok => { if (ok) setSelectedItemId(null); });
  }, [doc, selectedItemId, applyOps]);

  const seek = useCallback((at: number): void => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(lastFrameAt, Math.round(at * (doc?.fps ?? 30)) / (doc?.fps ?? 30))));
  }, [doc?.fps, lastFrameAt]);
  const duplicateSelected = useCallback((): void => {
    if (doc && selectedItemId) void insert(buildDuplicateOps(doc, selectedItemId));
  }, [doc, selectedItemId, insert]);
  const splitSelected = useCallback((): void => {
    if (doc && selectedItemId) void insert(buildSplitOps(doc, selectedItemId, playhead));
  }, [doc, selectedItemId, playhead, insert]);

  const importFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (!doc || disabled || files.length === 0) return;
    const scope = openSequence.current;
    setImporting(true); setPlaying(false); pendingWorkRef.current += 1;
    let current = doc;
    const cursor = { visual: playhead, audio: playhead };
    try {
      for (const file of files) {
        if (scope !== openSequence.current) break;
        let ops: Parameters<typeof patchDoc>[3];
        let lane: 'visual' | 'audio' | null = null;
        if (/\.srt$/i.test(file.name)) ops = buildCaptionOps(current, parseSrt(await file.text()), file.name);
        else {
          if (file.size > 128 * 1024 * 1024) throw new Error(t('panel.videoStudio.editor.fileTooLarge', { defaultValue: 'Media imports are limited to 128 MiB per file.' }));
          const asset = await importVideoAsset(projectName, file);
          lane = asset.kind === 'audio' ? 'audio' : 'visual';
          const measured = (await measureAssets(projectName, [asset]))[asset.id];
          if (!measured || (asset.kind !== 'image' && !(measured.duration && measured.duration > 0))) {
            throw new Error(t('panel.videoStudio.fileUnreadable', { defaultValue: '이 영상을 읽지 못했습니다: {{name}}', name: file.name }));
          }
          ops = buildAssetItemOps(current, { ...asset,
            ...(measured.duration !== null ? { duration: measured.duration } : {}),
            ...(measured.width !== null ? { width: measured.width } : {}),
            ...(measured.height !== null ? { height: measured.height } : {}),
            ...(measured.hasAudio !== undefined ? { hasAudio: measured.hasAudio } : {}),
          }, cursor[lane], file.name);
        }
        if (scope !== openSequence.current || !(await insert(ops))) break;
        // Read the acknowledged version between files so every insert has an up-to-date base.
        current = (await readDoc(projectName, doc.id)).doc;
        if (lane) {
          const inserted = new Set(ops.flatMap(op => op.op === 'addItem' ? [op.item.id] : op.op === 'addTrack' ? op.track.items.map(item => item.id) : []));
          cursor[lane] = Math.max(cursor[lane], ...resolveTimeline(current).items.filter(item => inserted.has(item.id)).map(item => item.end));
        }
      }
      void refreshDocs();
    } catch (error) { setStatus(String(error)); }
    finally { pendingWorkRef.current -= 1; setImporting(false); }
  }, [doc, disabled, projectName, playhead, insert, refreshDocs, t]);

  // ─── 컷 하나를 에이전트에게 맡기기 ───
  //
  // 새 위임 레이어를 만들지 않는다. 에이전트는 이미 loopback 으로 `/api/app/vibistudio/*` 에 닿을 수
  // 있으므로, **무엇을 어느 문서의 어느 아이템에 하라는지** 정확히 적은 명령을 기존 명령 큐로
  // 보내는 것으로 끝난다(§ 기존 인프라 재사용).

  const agents = useGraphStore((s) => s.agents);
  const addCommand = useGraphStore((s) => s.addCommand);
  const [delegateTo, setDelegateTo] = useState<string>("");

  const projectAgents = useMemo(
    () => agents.filter((a) => a.customCreated === true),
    [agents],
  );

  const delegateCut = useCallback((): void => {
    if (!doc || !selectedItemId || delegateTo === "") return;
    const item = doc.tracks.flatMap((tr) => tr.items).find((i) => i.id === selectedItemId);
    if (!item) return;

    // 에이전트가 그대로 따라 할 수 있게 문서 id·아이템 id·현재 값·규약을 함께 준다.
    const prompt = [
      `영상 문서 "${doc.id}"(프로젝트 "${projectName}")의 컷 "${item.id}" 하나만 고쳐 주세요.`,
      "",
      "규약:",
      `1) 먼저 GET /api/app/vibistudio/doc/${doc.id}?project=${encodeURIComponent(projectName)} 으로 현재 상태를 읽으세요.`,
      `2) 그 응답의 doc.version 을 baseVersion 으로 삼아 POST /api/app/vibistudio/doc/${doc.id}/patch 로 고치세요.`,
      `   body: { "project": "${projectName}", "baseVersion": <읽은 값>, "ops": [ { "op": "updateItem", "itemId": "${item.id}", "patch": { ... } } ] }`,
      "3) 409 가 오면 다른 곳에서 먼저 고친 것이니 1번부터 다시 하세요.",
      `4) 고친 뒤 GET /api/app/vibistudio/doc/${doc.id}/still?project=${encodeURIComponent(projectName)}&t=<확인할 초> 로 그림을 직접 보고 판단하세요.`,
      "",
      `현재 이 컷: kind=${item.kind}, sceneId=${item.sceneId ?? "(없음)"}, duration=${String(item.duration)}`,
      `props: ${JSON.stringify(item.props ?? {})}`,
      "",
      "다른 컷은 건드리지 마세요.",
    ].join(String.fromCharCode(10));

    addCommand(delegateTo, prompt);
    setStatus(t('panel.videoStudio.delegated', { defaultValue: '이 컷을 에이전트에게 맡겼습니다.' }));
  }, [doc, selectedItemId, delegateTo, projectName, addCommand, t]);

  // ─── 렌더 ───

  const doRender = useCallback(async (): Promise<void> => {
    if (!doc || renderBusy.current || disabled || duration <= 0) return;
    renderBusy.current = true;
    setPlaying(false);
    setRenderPct(0);
    setStatus('');
    try {
      const job = await startRender(projectName, doc.id);
      setRenderJob(job.id);
      setStatus(t('panel.videoStudio.renderQueued', { defaultValue: '렌더를 걸었습니다.', id: job.id }));
    } catch (err) {
      setRenderPct(null);
      renderBusy.current = false;
      setStatus(String(err));
    }
  }, [doc, projectName, t, disabled, duration]);

  useEffect(() => {
    if (!renderJob) return;
    let active = true;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        const job = await getJob(renderJob);
        if (!active) return;
        if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
          if (job.status === 'done' && job.result) {
            const result = await fetch(assetUrl(projectName, job.result));
            if (!result.ok) throw new Error(String(result.status));
            const blob = await result.blob();
            if (active) setDownload({ url: URL.createObjectURL(blob), name: `${doc?.title ?? job.docId}.mp4`, docId: job.docId });
          }
          if (active) {
            setStatus(job.error ?? job.note ?? t('panel.videoStudio.renderDone'));
            setRenderPct(null); setRenderJob(null); renderBusy.current = false;
          }
        } else setRenderPct(job.progress);
      } catch (error) {
        if (active) { setStatus(String(error)); setRenderPct(null); setRenderJob(null); renderBusy.current = false; }
      } finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 1200);
    return () => { active = false; clearInterval(timer); };
  }, [renderJob, projectName, doc?.title, t]);

  // ─── 일꾼 루프 — 에이전트가 건 일감을 이 창이 처리한다 ───

  useVideoJobWorker(projectName, pendingWorkRef, setRenderPct, setStatus, setDownload);

  const exportStill = async (): Promise<void> => {
    if (!doc) return;
    try {
      const url = await renderer.still(playhead);
      const link = document.createElement('a');
      link.href = url; link.download = doc.title + '.png'; link.click();
    } catch (error) { setStatus(String(error)); }
  };

  const selected = doc ? resolveTimeline(doc).items.find(item => item.id === selectedItemId) : undefined;
  const canSplit = !!selected && selected.kind !== 'scene' && playhead > selected.start && playhead < selected.end;
  return <VideoStudioView hosted={hosted} projectName={projectName} docs={docs} doc={doc}
    disabled={disabled} importing={importing} status={status} playing={playing} playhead={playhead} duration={duration}
    selectedItemId={selectedItemId} canvasRef={canvasRef} renderPct={renderPct}
    library={doc ? { doc, disabled, onAddScene: scene => { void insert(buildAddSceneOps(doc, scene, playhead, t('panel.videoStudio.editor.scene_' + scene))); },
      onAddText: () => { void insert(buildAddTextOps(doc, playhead, t('panel.videoStudio.editor.addText'))); },
      onAddShape: () => { void insert(buildAddShapeOps(doc, playhead, t('panel.videoStudio.editor.addShape'))); },
      onAddAsset: asset => { void insert(buildAssetItemOps(doc, asset, playhead, doc.tracks.flatMap(track => track.items).find(item => item.assetId === asset.id)?.label ?? asset.id)); },
      onImport: importFiles } : null}
    inspector={doc ? { doc, selectedItemId, disabled, onApplyOps: ops => { void applyOps(ops); } } : null}
    showLibrary={showLibrary} showInspector={showInspector} loop={loopPlayback}
    onToggleLibrary={() => setShowLibrary(value => !value)} onToggleInspector={() => setShowInspector(value => !value)} onToggleLoop={() => setLoopPlayback(value => !value)}
    onSelectDoc={id => { if (id) void openDoc(id); else { openSequence.current += 1; editing.reset(); setDoc(null); setPlaying(false); setSelectedItemId(null); } }}
    onCreateDoc={() => void createNewDoc()} onSelectItem={setSelectedItemId} onSeek={seek} onPlay={togglePlay}
    onRefresh={() => { if (doc) void openDoc(doc.id); void refreshDocs(); }}
    undo={{ run: () => void editing.undo(), disabled: !editing.canUndo }} redo={{ run: () => void editing.redo(), disabled: !editing.canRedo }}
    split={{ run: splitSelected, disabled: !canSplit }} duplicate={{ run: duplicateSelected, disabled: !selected }}
    remove={{ run: removeSelected, disabled: !selected }} toggle={{ run: toggleSelected, disabled: !selected }}
    onAddTitle={addTitleScene} onRender={() => void doRender()} onStill={() => void exportStill()}
    agents={projectAgents} delegateTo={delegateTo} onDelegateTo={setDelegateTo} onDelegate={delegateCut} download={download?.docId === doc?.id ? download : null}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !disabled) { event.preventDefault(); void (event.shiftKey ? editing.redo() : editing.undo()); }
      else if (mod && key === 'y' && !disabled) { event.preventDefault(); void editing.redo(); }
      else if (mod && key === 'd' && !disabled) { event.preventDefault(); duplicateSelected(); }
      else if ((key === 'delete' || key === 'backspace') && !disabled) { event.preventDefault(); removeSelected(); }
      else if (key === 's' && !mod && !disabled && canSplit) { event.preventDefault(); splitSelected(); }
      else if (key === ' ' && !disabled && duration > 0) { event.preventDefault(); togglePlay(); }
      else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); seek(playhead + (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / (doc?.fps ?? 30)); }
    }} />;
}

/** 빈 문서 하나를 만들어 주는 헬퍼 — 테스트와 초기 화면이 같은 모양을 쓰게. */
export function blankDoc(title: string): VideoDoc {
  return createEmptyDoc(`vid-${Date.now().toString(36)}`, title);
}
