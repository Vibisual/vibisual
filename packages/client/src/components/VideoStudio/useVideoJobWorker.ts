import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoDoc } from '@vibisual/video';
import { claimJob, completeRenderJob, completeStillJob, readDoc, reportJob, type VideoJob } from './videoApi.js';
import { useVideoRenderer } from './useVideoRenderer.js';

const JOB_POLL_MS = 1200;
export function useVideoJobWorker(project: string, pending: MutableRefObject<number>,
  onProgress: (value: number | null) => void, onStatus: (message: string) => void,
  onDownload: (value: { url: string; name: string; docId: string }) => void) {
  const { t } = useTranslation();
  const [work, setWork] = useState<{ project: string; job: VideoJob; doc: VideoDoc } | null>(null);
  const busy = useRef(false);
  const renderer = useVideoRenderer(work?.project ?? project, work?.doc ?? null);
  const currentProject = useRef(project);
  currentProject.current = project;
  const callbacks = useRef({ onProgress, onStatus, onDownload });
  callbacks.current = { onProgress, onStatus, onDownload };
  useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      let claimed: VideoJob | null = null;
      try {
        claimed = await claimJob(project);
        if (!claimed) { busy.current = false; return; }
        if (!active) { await reportJob(claimed.id, { status: 'queued' }); busy.current = false; return; }
        const { doc } = await readDoc(project, claimed.docId);
        if (!active) {
          await reportJob(claimed.id, { status: 'queued' }); busy.current = false; return;
        }
        pending.current += 1;
        setWork({ project, job: claimed, doc });
      } catch (error) {
        busy.current = false;
        if (claimed) await reportJob(claimed.id, { status: 'error', error: String(error) }).catch(() => undefined);
        if (claimed && active) callbacks.current.onStatus(String(error));
      }
    };
    const timer = setInterval(() => void poll(), JOB_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [project, pending]);

  useEffect(() => {
    if (!work) return;
    const controller = new AbortController();
    let active = true;
    const showResult = (): boolean => active && currentProject.current === work.project;
    // Terminal reports wait for progress reports so a slow `running` response cannot resurrect a finished job.
    let reports = Promise.resolve();
    void (async () => {
      try {
        if (work.job.kind === 'still') {
          const image = await renderer.still(work.job.t ?? 0);
          if (!active) throw new Error('Studio worker closed.');
          await completeStillJob(work.job.id, image);
        } else {
          if (showResult()) callbacks.current.onProgress(0);
          let reported = -1;
          const result = await renderer.render({ signal: controller.signal, onProgress: progress => {
            const value = progress.totalFrames > 0 ? progress.frame / progress.totalFrames : 0;
            if (showResult()) callbacks.current.onProgress(value);
            if (active && value - reported >= 0.05) {
              reported = value;
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
            callbacks.current.onDownload({ url: URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'video/mp4' })), name: `${work.doc.title || work.doc.id}.mp4`, docId: work.doc.id });
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
