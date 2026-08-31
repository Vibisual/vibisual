import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  CAPTURE_PLAYTEST,
  VERIFICATION_DEMO_EXPECTED_MAX,
  VERIFICATION_DEMO_FRAMES_MAX,
  VERIFICATION_DEMO_LABEL_MAX,
  VERIFICATION_DEMO_STEPS_MAX,
  VERIFICATION_DEMO_STEP_TEXT_MAX,
} from '@vibisual/shared';
import type { VerificationDemoStep } from '@vibisual/shared';

import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import { useVerifyDemoSave } from '../../hooks/useVerifyDemoSave.js';
import { useCapturePlaytestStore } from '../../stores/capturePlaytest.js';
import { useVerifyDemoStore, verifyRecorderKey } from '../../stores/verifyDemo.js';
import { registerCaptureWindow, type CaptureWindowHandle } from '../BubbleMap/captureWindowManager.js';
import { clampRange, formatClipDuration, formatClipTime, type ClipRange } from '../BubbleMap/playtestClip.js';
import { defaultDemoLabel, formatDemoTime, insertDemoStep, removeDemoStep } from './verifyDemo.js';

// §5.5 #17-35 ⑨-5 — 시연 창.
//
// **왜 창인가**: 검증 뷰는 `w-52` 사이드바다. 영상을 되돌려 보며 구간을 좁히고 단계를 적는 일은
// 거기서 할 수 없다. 그래서 §5.9 `PlaytestClipWindow`(§7.21)와 **같은 문법**의 앱 내부 창으로 띄운다 —
// 창 거동(가운데 팝업 → 드래그 → 리사이즈 → 최대화)도 z-order·Escape 도 같은 훅·같은 매니저를 쓴다.
//
// **캡처 버블은 만들지 않는다**(⑨-1) — 이 창이 보는 클립은 검증 뷰가 `verify:<subAgentId>` 키로
// 녹화해 `capturePlaytest` 에 넣어 둔 것이고, 캔버스에는 아무것도 서지 않는다.
//
// 두 가지 모드로 산다:
//   · `save`  — 방금 녹화한 시연을 **검증 절차로 저장**한다(구간 + 단계 + 기대 결과 + 프레임).
//   · `view`  — ⑩ 검증이 도는 동안 찍힌 화면을 **되돌려 보기만** 한다(저장 손잡이 없음).

export interface VerifyDemoWindowProps {
  agentId: string;
  subAgentId: string;
  clipId: string;
  mode: 'save' | 'view';
  onClose: () => void;
}

export const VerifyDemoWindow = memo(function VerifyDemoWindow({
  agentId,
  subAgentId,
  clipId,
  mode,
  onClose,
}: VerifyDemoWindowProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const recorderKey = verifyRecorderKey(subAgentId);
  const clips = useCapturePlaytestStore((s) => s.clips[recorderKey]);
  const setClipDuration = useCapturePlaytestStore((s) => s.setClipDuration);
  const removeClip = useCapturePlaytestStore((s) => s.removeClip);
  const closeWindow = useVerifyDemoStore((s) => s.closeWindow);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 멀티 윈도우 매니저(z-order + Escape 최상단) — 캡처 창·클립 창과 같은 줄에 선다.
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => onCloseRef.current());
  const handle = handleRef.current;
  const [z, setZ] = useState<number>(handle.initialZ);
  const bringToFront = useCallback(() => { setZ(handle.bringToFront()); }, [handle]);
  useEffect(() => () => { handle.release(); }, [handle]);

  const fw = useFloatingWindow({
    cascade: handle.cascadeOffset,
    maxDefaultSize: { w: 760, h: 680 },
    onInteractStart: bringToFront,
  });

  const clip = useMemo(() => clips?.find((c) => c.id === clipId) ?? null, [clips, clipId]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<ClipRange>({ startMs: 0, endMs: 0 });
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameCount, setFrameCount] = useState<number>(CAPTURE_PLAYTEST.DEFAULT_FRAME_COUNT);

  const [label, setLabel] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState<VerificationDemoStep[]>([]);
  const [stepDraft, setStepDraft] = useState('');

  const saver = useVerifyDemoSave();

  const clipDuration = clip?.durationMs ?? 0;
  const clipAt = clip?.at ?? 0;
  const sourceName = clip?.sourceName ?? '';

  // 클립이 바뀌면 구간·재생 위치·적던 것을 그 클립 기준으로 되돌린다.
  useEffect(() => {
    setRange({ startMs: 0, endMs: clipDuration });
    setPlayheadMs(0);
    setPlaying(false);
    setSteps([]);
    setStepDraft('');
    setExpected('');
    setLabel(defaultDemoLabel(sourceName, clipAt, i18n.language));
    saver.clearError();
    // 클립 교체 시 1회 — saver 는 매 렌더 새로 오므로 의존성에 넣지 않는다(클립 창과 같은 규약).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, clipDuration, clipAt, sourceName]);

  /**
   * MediaRecorder webm 은 `duration` 이 Infinity 로 오는 일이 잦다(알려진 Chromium 거동).
   * 한 번 아주 먼 지점으로 보내면 브라우저가 길이를 확정한다 — 그래야 스크럽이 어긋나지 않는다.
   */
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setClipDuration(recorderKey, clipId, video.duration * 1000);
      return;
    }
    const onTimeUpdate = (): void => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setClipDuration(recorderKey, clipId, video.duration * 1000);
      }
      video.currentTime = 0;
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.currentTime = 1e101;
  }, [clipId, recorderKey, setClipDuration]);

  // 재생은 고른 구간 안에서만 돈다 — 구간 밖을 보여 주면 무엇을 저장하는지 알 수 없다.
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nowMs = video.currentTime * 1000;
    setPlayheadMs(nowMs);
    if (nowMs >= range.endMs - 20) {
      video.currentTime = range.startMs / 1000;
      if (playing) void video.play().catch(() => { /* 제스처 없이 막히면 정지 상태로 둔다 */ });
    }
  }, [playing, range.endMs, range.startMs]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    if (video.currentTime * 1000 < range.startMs || video.currentTime * 1000 >= range.endMs) {
      video.currentTime = range.startMs / 1000;
    }
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [playing, range.endMs, range.startMs]);

  const seekTo = useCallback((ms: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, ms) / 1000;
    setPlayheadMs(ms);
  }, []);

  // ── 구간 손잡이 (클립 창과 같은 기하) ────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'start' | 'end' | null>(null);

  const msFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el || clipDuration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
    return Math.min(Math.max(ratio, 0), 1) * clipDuration;
  }, [clipDuration]);

  const beginDrag = useCallback((which: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = which;
  }, []);

  useEffect(() => {
    if (clipDuration <= 0) return;
    const onMove = (e: MouseEvent): void => {
      const which = dragRef.current;
      if (!which) return;
      const ms = msFromClientX(e.clientX);
      setRange((prev) => clampRange(which === 'start' ? { ...prev, startMs: ms } : { ...prev, endMs: ms }, clipDuration));
      if (which === 'start') seekTo(ms);
    };
    const onUp = (): void => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clipDuration, msFromClientX, seekTo]);

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) return;
    seekTo(msFromClientX(e.clientX));
  }, [msFromClientX, seekTo]);

  // ── 단계 ────────────────────────────────────────────────────────────────────
  //
  // 단계는 **지금 보고 있는 지점**에 박힌다. 되돌려 보다가 "여기서 이걸 눌렀다"를 적는 것이 이 창의
  // 핵심 동작이라, 시각을 따로 입력하게 만들지 않는다(순서 정렬은 `insertDemoStep` 이 맡는다).
  const addStep = useCallback(() => {
    const text = stepDraft.trim();
    if (!text) return;
    setSteps((prev) => insertDemoStep(prev, { atMs: Math.max(0, playheadMs - range.startMs), text }));
    setStepDraft('');
  }, [playheadMs, range.startMs, stepDraft]);

  const stepsFull = steps.length >= VERIFICATION_DEMO_STEPS_MAX;

  // ── 저장 ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!clip || saver.busy) return;
    void saver.save({
      agentId,
      subAgentId,
      clip,
      range,
      frameCount,
      label: label.trim() || defaultDemoLabel(clip.sourceName, clip.at, i18n.language),
      steps,
      ...(expected.trim() ? { expected: expected.trim() } : {}),
    }).then((attached) => {
      if (attached === null) return;
      // 저장이 끝나면 그 클립은 할 일을 다했다 — 창을 닫고 Blob 을 반납한다(메모리 회수).
      removeClip(recorderKey, clip.id);
      closeWindow();
    });
  }, [agentId, clip, closeWindow, expected, frameCount, i18n.language, label, range, recorderKey, removeClip, saver, steps, subAgentId]);

  const handleDiscard = useCallback(() => {
    if (clip) removeClip(recorderKey, clip.id);
    closeWindow();
  }, [clip, closeWindow, recorderKey, removeClip]);

  if (!clip) return null;

  const startPct = clipDuration > 0 ? (range.startMs / clipDuration) * 100 : 0;
  const endPct = clipDuration > 0 ? (range.endMs / clipDuration) * 100 : 100;
  const playPct = clipDuration > 0 ? (playheadMs / clipDuration) * 100 : 0;
  const saving = mode === 'save';

  return createPortal(
    <div
      ref={fw.windowRef}
      className="fixed flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-gray-900/95 shadow-2xl backdrop-blur-sm"
      style={{ ...fw.style, zIndex: z }}
      onMouseDown={bringToFront}
    >
      {/* 타이틀바 — 드래그 이동 + 더블클릭 최대화(§5.9 창 문법 그대로) */}
      <div
        className="flex flex-shrink-0 cursor-move select-none items-center gap-2 border-b border-white/[0.06] px-3 py-2"
        {...fw.titleBarProps}
      >
        <svg className="h-4 w-4 flex-shrink-0 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span className="truncate text-[13px] font-semibold text-white">
          {t(saving ? 'ide.verify.demo.windowTitle' : 'ide.verify.demo.evidenceTitle')}
        </span>
        <span className="truncate text-[12px] text-gray-500">{clip.sourceName}</span>
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={fw.toggleMinimized}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
            aria-label={t('common.minimize', { defaultValue: 'Minimize' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button
            type="button"
            onClick={fw.toggleMaximized}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
            aria-label={t('common.maximize', { defaultValue: 'Maximize' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {!fw.minimized && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {/* 영상 */}
          <div className="flex items-center justify-center overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              src={clip.url}
              className="max-h-[38vh] w-full object-contain"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setPlaying(false)}
              muted
              playsInline
            />
          </div>

          {/* 구간 트랙 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-gray-200 transition-colors hover:bg-white/[0.14] hover:text-white"
              aria-label={t(playing ? 'common.pause' : 'common.play', { defaultValue: playing ? 'Pause' : 'Play' })}
            >
              {playing ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5v14" /><path d="M15 5v14" /></svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l14 8-14 8V4z" /></svg>
              )}
            </button>
            <div
              ref={trackRef}
              onClick={handleTrackClick}
              className="relative h-6 flex-1 cursor-pointer rounded bg-white/[0.06]"
            >
              <div className="absolute inset-y-0 rounded bg-sky-500/25" style={{ left: `${startPct}%`, right: `${100 - endPct}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${playPct}%` }} />
              {saving && (
                <>
                  <div
                    onMouseDown={beginDrag('start')}
                    className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded bg-sky-400"
                    style={{ left: `${startPct}%` }}
                  />
                  <div
                    onMouseDown={beginDrag('end')}
                    className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded bg-sky-400"
                    style={{ left: `${endPct}%` }}
                  />
                </>
              )}
            </div>
            <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500">
              {formatClipTime(playheadMs)} / {formatClipDuration(range.endMs - range.startMs)}
            </span>
          </div>

          {clip.autoStopped && (
            <p className="text-[12px] leading-relaxed text-amber-400">{t('ide.verify.demo.autoStopped')}</p>
          )}

          {saving && (
            <>
              {/* 단계 — 이 창의 핵심. 지금 보고 있는 지점에 박힌다. */}
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-gray-400">{t('ide.verify.demo.stepsLabel')}</span>
                {steps.length === 0 ? (
                  <p className="text-[12px] leading-relaxed text-gray-600">{t('ide.verify.demo.stepsEmpty')}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {steps.map((st, i) => (
                      <li key={`${st.atMs}-${i}`} className="flex items-start gap-1.5 text-[12px] leading-relaxed">
                        <button
                          type="button"
                          onClick={() => seekTo(range.startMs + st.atMs)}
                          className="flex-shrink-0 tabular-nums text-sky-400 transition-colors hover:text-sky-300"
                        >
                          {formatDemoTime(st.atMs)}
                        </button>
                        <span className="min-w-0 flex-1 break-words text-gray-300">{st.text}</span>
                        <button
                          type="button"
                          onClick={() => setSteps((prev) => removeDemoStep(prev, i))}
                          className="flex-shrink-0 text-gray-600 transition-colors hover:text-rose-400"
                          aria-label={t('common.delete', { defaultValue: 'Delete' })}
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-1">
                  <input
                    value={stepDraft}
                    onChange={(e) => setStepDraft(e.target.value.slice(0, VERIFICATION_DEMO_STEP_TEXT_MAX))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }}
                    disabled={stepsFull}
                    placeholder={t('ide.verify.demo.stepPlaceholder')}
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-sky-500 focus:outline-none disabled:text-gray-600"
                  />
                  <button
                    type="button"
                    onClick={addStep}
                    disabled={stepsFull || !stepDraft.trim()}
                    className="flex-shrink-0 rounded bg-white/[0.08] px-2 py-1 text-[12px] text-gray-200 transition-colors hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:text-gray-600"
                  >
                    {t('ide.verify.demo.addStep', { at: formatDemoTime(Math.max(0, playheadMs - range.startMs)) })}
                  </button>
                </div>
                {stepsFull && <p className="text-[12px] text-amber-400">{t('ide.verify.demo.stepsFull', { max: VERIFICATION_DEMO_STEPS_MAX })}</p>}
              </div>

              {/* 기대 결과 · 이름 · 프레임 장수 */}
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-gray-400">{t('ide.verify.demo.expectedLabel')}</span>
                <input
                  value={expected}
                  onChange={(e) => setExpected(e.target.value.slice(0, VERIFICATION_DEMO_EXPECTED_MAX))}
                  placeholder={t('ide.verify.demo.expectedPlaceholder')}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-sky-500 focus:outline-none"
                />
              </label>

              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[12px] font-medium text-gray-400">{t('ide.verify.demo.nameLabel')}</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value.slice(0, VERIFICATION_DEMO_LABEL_MAX))}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-gray-400">{t('ide.verify.demo.frameCount')}</span>
                  <select
                    value={frameCount}
                    onChange={(e) => setFrameCount(Number(e.target.value))}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 focus:border-sky-500 focus:outline-none"
                  >
                    {[0, ...CAPTURE_PLAYTEST.FRAME_COUNT_OPTIONS]
                      .filter((n) => n <= VERIFICATION_DEMO_FRAMES_MAX)
                      .map((n) => (
                        <option key={n} value={n}>{n === 0 ? t('ide.verify.demo.noFrames') : n}</option>
                      ))}
                  </select>
                </label>
              </div>

              {saver.progress && (
                <p className="text-[12px] text-gray-500">
                  {t('ide.verify.demo.extracting', { done: saver.progress.done, total: saver.progress.total })}
                </p>
              )}
              {saver.error && (
                <p className="break-words text-[12px] leading-relaxed text-rose-400">
                  {t(`ide.verify.demo.error.${saver.error}`, { defaultValue: saver.error })}
                </p>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saver.busy}
                  className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                >
                  {t('ide.verify.demo.save')}
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={saver.busy}
                  className="rounded border border-gray-600 px-2 py-1.5 text-[12px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:text-gray-600"
                >
                  {t('ide.verify.demo.discard')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 우하단 리사이즈 핸들 */}
      {!fw.minimized && !fw.maximized && (
        <div {...fw.resizeProps} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" />
      )}
    </div>,
    document.body,
  );
});
