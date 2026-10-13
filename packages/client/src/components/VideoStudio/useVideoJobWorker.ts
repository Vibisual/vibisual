import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { JOB_HEARTBEAT_MS, STRIP_MAX_EDGE, chapterFrameDoc, withoutCaptions, type VideoDoc } from '@vibisual/video';
import { claimJob, completeRenderJob, completeStillJob, readDoc, reportJob, type VideoJob, type VideoJobLane } from './videoApi.js';
import { useVideoRenderer } from './useVideoRenderer.js';
import { readHistoryDoc } from './studioApi.js';
import { composeStripGrid, stripColumns } from './stripGrid.js';

const JOB_POLL_MS = 1200;

/**
 * §5.13 (T-4) — 일감 줄을 도는 일꾼.
 *
 * 이제 이 훅을 도는 곳은 **숨은 일꾼 창**(`VideoWorkerShell`)이다 — 스튜디오 창은 일감을 걸고 지켜보기만 한다(실행 자리는
 * 하나 — 두 곳이 같은 줄을 집으면 어느 쪽이 그렸느냐에 따라 스틸 경로가 갈린다). 일꾼 창은 줄마다 이 훅을 하나씩 돈다
 * (`lane` — 스틸·프레임 띠 줄과 렌더 줄. 4분짜리 렌더가 도는 동안에도 에이전트의 스틸이 온다).
 *
 * `project` 를 주면 그 프로젝트 일감만, 비우면(일꾼 창) 모든 프로젝트 일감을 집는다 — 문서는 일감의 프로젝트로 읽는다.
 */
export interface JobWorkerOptions {
  /** 이 줄만 집는다. 없으면 아무 일감이나(종전 동작). */
  readonly lane?: VideoJobLane;
  /** 일감을 처리하기 전에 문서를 손본다(빠진 실측값 채우기 등). 실패하면 원래 문서로 간다. */
  readonly prepare?: (project: string, doc: VideoDoc) => Promise<VideoDoc>;
}

export function useVideoJobWorker(project: string | undefined, pending: MutableRefObject<number>,
  onProgress: (value: number | null) => void, onStatus: (message: string) => void,
  onDownload: (value: { url: string; name: string; docId: string }) => void,
  options: JobWorkerOptions = {}) {
  const { t } = useTranslation();
  const [work, setWork] = useState<{ project: string; job: VideoJob; doc: VideoDoc } | null>(null);
  const busy = useRef(false);
  // §5.13 (V) 37-3 — 판 기록의 한 판을 찍는 일감이면 그 판의 코드로 내주는 주소를 쓴다.
  // §5.13 (W) 38-7 — 장면 정지 화면 일감이면 오프스크린 렌더 화면도 그 컴포지션 하나짜리 문서를 세운다.
  const renderer = useVideoRenderer(work?.project ?? project ?? '', work?.doc ?? null, { revId: work?.job.revId, frameChapter: work?.job.frameOf });
  const currentProject = useRef(project);
  currentProject.current = project;
  const callbacks = useRef({ onProgress, onStatus, onDownload });
  callbacks.current = { onProgress, onStatus, onDownload };
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // §5.13 (W) 38-7 — 폴링 콜백이 고르는 문구(일감 거절 사유 — 서버로 올라가 화면에 그대로 찍힌다). 언어가 바뀌어도 최신 t.
  const translate = useRef(t);
  translate.current = t;
  const lane = options.lane;
  useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      let claimed: VideoJob | null = null;
      try {
        claimed = lane === undefined ? await claimJob(project) : await claimJob(project, lane);
        if (!claimed) { busy.current = false; return; }
        if (!active) { await reportJob(claimed.id, { status: 'queued' }); busy.current = false; return; }
        const jobProject = project ?? claimed.projectPath;
        // §5.13 (V) 37-3 — 판 일감은 그 판의 문서로 그린다(지금 문서를 손보는 준비 단계도 건너뛴다 — 옛 판을 고치지 않는다).
        let doc = claimed.revId
          ? await readHistoryDoc(jobProject, claimed.docId, claimed.revId)
          : (await readDoc(jobProject, claimed.docId)).doc;
        if (!active) {
          await reportJob(claimed.id, { status: 'queued' }); busy.current = false; return;
        }
        const prepare = optionsRef.current.prepare;
        if (prepare && !claimed.revId) doc = await prepare(jobProject, doc).catch(() => doc);
        // §5.13 (V) 37-15 — 자막 따로 내기: 자막 트랙을 숨긴 사본으로 그린다(문서는 그대로).
        if (claimed.kind === 'render' && claimed.hideCaptions === true) doc = withoutCaptions(doc);
        // §5.13 (W) 38-7 — 장면 정지 화면: 그 장면의 컴포지션 하나짜리 문서로 그린다(렌더 화면도 같은 함수).
        if (claimed.frameOf) {
          const frameDoc = chapterFrameDoc(doc, claimed.frameOf);
          if (!frameDoc) throw new Error(translate.current('panel.videoStudio.errNoFrame', { id: claimed.frameOf }));
          doc = frameDoc;
        }
        pending.current += 1;
        setWork({ project: jobProject, job: claimed, doc });
      } catch (error) {
        busy.current = false;
        if (claimed) await reportJob(claimed.id, { status: 'error', error: String(error) }).catch(() => undefined);
        if (claimed && active) callbacks.current.onStatus(String(error));
      }
    };
    const timer = setInterval(() => void poll(), JOB_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [project, pending, lane]);

  useEffect(() => {
    if (!work) return;
    const controller = new AbortController();
    let active = true;
    const showResult = (): boolean => active && currentProject.current === work.project;
    // Terminal reports wait for progress reports so a slow `running` response cannot resurrect a finished job.
    let reports = Promise.resolve();
    let lastReportAt = 0;
    void (async () => {
      try {
        if (work.job.kind === 'still') {
          const maxEdge = work.job.maxEdge;
          const image = await renderer.still(work.job.t ?? 0, maxEdge !== undefined && maxEdge > 0 ? maxEdge : undefined);
          if (!active) throw new Error('Studio worker closed.');
          await completeStillJob(work.job.id, image);
        } else if (work.job.kind === 'cues') {
          // §5.13 (T-8) — 표지 모으기(렌더 줄). 흘리는 동안 숨소리를 보낸다(긴 컴포지션에서 임대가 끊기지 않게).
          const beat = setInterval(() => {
            if (!active) return;
            reports = reports.then(() => reportJob(work.job.id, { status: 'running', progress: 0.5 })).catch(() => undefined);
          }, JOB_HEARTBEAT_MS);
          let scanned: Awaited<ReturnType<typeof renderer.collectCues>>;
          try {
            scanned = await renderer.collectCues(work.job.assetId ?? '');
          } finally {
            clearInterval(beat);
          }
          await reports;
          if (!active) throw new Error('Studio worker closed.');
          await reportJob(work.job.id, { status: 'done', progress: 1, data: JSON.stringify(scanned) });
        } else if (work.job.kind === 'review') {
          // §5.13 (V) 37-9 — 프레임 검수 표본(평평함·글자 상자·바탕 밝기). 판정은 서버의 순수 함수가 한다.
          const probes = await renderer.probeFrames(work.job.times ?? []);
          if (!active) throw new Error('Studio worker closed.');
          await reportJob(work.job.id, { status: 'done', progress: 1, data: JSON.stringify(probes) });
        } else if (work.job.kind === 'strip') {
          // §5.13 (T-9) — 시각을 앞에서부터 차례로 한 무대에서 찍고 격자 한 장으로 붙인다. 칸마다 진행을 알린다(임대의 숨소리).
          const times = work.job.times ?? [];
          const edge = work.job.maxEdge !== undefined && work.job.maxEdge > 0 ? work.job.maxEdge : STRIP_MAX_EDGE;
          const cellEdge = Math.ceil(edge / Math.max(1, stripColumns(times.length)));
          const images = await renderer.stills(times, cellEdge, (done) => {
            if (!active) return;
            reports = reports.then(() => reportJob(work.job.id, { status: 'running', progress: done / Math.max(1, times.length) })).catch(() => undefined);
          });
          if (!active) throw new Error('Studio worker closed.');
          const grid = await composeStripGrid(images, times, edge);
          await reports;
          if (!active) throw new Error('Studio worker closed.');
          await completeStillJob(work.job.id, grid);
        } else {
          if (showResult()) callbacks.current.onProgress(0);
          let reported = -1;
          const result = await renderer.render({ signal: controller.signal, ...(work.job.transparent === true ? { transparent: true } : {}), onProgress: progress => {
            const value = progress.totalFrames > 0 ? progress.frame / progress.totalFrames : 0;
            if (showResult()) callbacks.current.onProgress(value);
            // 5% 마다, 또는 그 사이가 길어지면 시간으로도 알린다 — 긴 렌더에서 임대(T-4)가 끊기지 않게.
            const now = Date.now();
            if (active && (value - reported >= 0.05 || now - lastReportAt >= JOB_HEARTBEAT_MS)) {
              reported = value;
              lastReportAt = now;
              reports = reports.then(() => reportJob(work.job.id, { status: 'running', progress: value })).catch(() => undefined);
            }
          } });
          if (!active) throw new Error('Studio worker closed.');
          const warnings = [...result.warnings];
          if (!result.hasAudio) warnings.push(t('panel.videoStudio.noAudio'));
          if (result.selection?.downgraded) warnings.push(t('panel.videoStudio.downgraded', { id: result.selection.chosen }));
          const note = warnings.join(' · ');
          await reports;
          if (!active) throw new Error('Studio worker closed.');
          await completeRenderJob(work.job.id, result.bytes, note);
          if (showResult()) {
            // §5.13 (W) 38-3 — 투명 배경이면 WebM.
            const ext = result.container === 'webm' ? 'webm' : 'mp4';
            callbacks.current.onDownload({ url: URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: `video/${ext}` })), name: `${work.doc.title || work.doc.id}.${ext}`, docId: work.doc.id });
            callbacks.current.onStatus(note);
          }
        }
      } catch (error) {
        await reports;
        await reportJob(work.job.id, { status: 'error', error: String(error) }).catch(() => undefined);
        if (showResult()) callbacks.current.onStatus(String(error));
      } finally {
        pending.current -= 1; busy.current = false;
        if (showResult()) callbacks.current.onProgress(null);
        if (active) setWork(null);
      }
    })();
    return () => { active = false; controller.abort(); };
    // A work item pins its document and renderer for its entire lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);
}
