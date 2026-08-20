import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CAPTURE_BUBBLE_DEFAULTS, CAPTURE_PLAYTEST, isReadOnlyHookAgent } from '@vibisual/shared';

import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import { useCapturePlaytestAttach } from '../../hooks/useCapturePlaytestAttach.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useCapturePlaytest, useCapturePlaytestStore, type PlaytestClip } from '../../stores/capturePlaytest.js';
import { registerCaptureWindow, type CaptureWindowHandle } from './captureWindowManager.js';
import { clampRange, clipFileName, formatClipDuration, formatClipTime, type ClipRange } from './playtestClip.js';

// §5.9 플레이테스트 클립 창(§7.21) — 녹화를 멈추면 뜨는 앱 내부 창.
//
// 창 거동(가운데 팝업 → 드래그 이동 → 리사이즈 → 최대화)은 캡처 창·기억 라이브러리와 **같은 훅**
// (`useFloatingWindow`)을 쓴다. z-order·Escape 도 캡처 창과 같은 매니저를 쓰므로 여러 창이 떠 있어도
// 클릭한 창이 앞으로 오고 Escape 는 맨 위 하나만 닫는다.
//
// 하는 일은 하나다 — **되돌려 보고, 구간을 좁히고, 그 구간의 프레임을 에이전트 입력창에 붙인다.**
// 자동 전송 ❌(§5.17 (B) 와 같은 규칙): 무엇이 잘못됐는지는 사용자가 문장으로 얹어 직접 보낸다.

export interface PlaytestClipWindowProps {
  captureBubbleId: string;
  /** 캡처 버블 액센트(선택 링·강조) — 캡처 정체성 유지. */
  accent: string;
  onClose: () => void;
}

export const PlaytestClipWindow = memo(function PlaytestClipWindow({
  captureBubbleId,
  accent,
  onClose,
}: PlaytestClipWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const { clips, openClipId } = useCapturePlaytest(captureBubbleId);
  const openClip = useCapturePlaytestStore((s) => s.openClip);
  const removeClip = useCapturePlaytestStore((s) => s.removeClip);
  const setClipDuration = useCapturePlaytestStore((s) => s.setClipDuration);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 멀티 윈도우 매니저(z-order + Escape 최상단) — 캡처 창과 같은 줄에 선다.
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => onCloseRef.current());
  const handle = handleRef.current;
  const [z, setZ] = useState<number>(handle.initialZ);
  const bringToFront = useCallback(() => { setZ(handle.bringToFront()); }, [handle]);
  useEffect(() => () => { handle.release(); }, [handle]);

  const fw = useFloatingWindow({
    cascade: handle.cascadeOffset,
    maxDefaultSize: { w: 720, h: 640 },
    onInteractStart: bringToFront,
  });

  const clip = useMemo(
    () => clips.find((c) => c.id === openClipId) ?? clips[0] ?? null,
    [clips, openClipId],
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<ClipRange>({ startMs: 0, endMs: 0 });
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameCount, setFrameCount] = useState<number>(CAPTURE_PLAYTEST.DEFAULT_FRAME_COUNT);
  const [agentId, setAgentId] = useState<string | null>(null);

  const attach = useCapturePlaytestAttach();

  // 명령을 받을 수 있는 에이전트만(훅 버블 ❌ — §5.5 #17-29 관측 대상에 명령을 넣지 않는다).
  const agents = useGraphStore((s) => s.agents);
  const targets = useMemo(
    () => agents.filter((a) => a.bubbleType === 'agent' && !isReadOnlyHookAgent(a)),
    [agents],
  );
  useEffect(() => {
    if (agentId !== null && targets.some((a) => a.id === agentId)) return;
    setAgentId(targets[0]?.id ?? null);
  }, [agentId, targets]);

  // 클립이 바뀌면 구간·재생 위치를 그 클립 전체로 되돌린다.
  const clipId = clip?.id;
  const clipDuration = clip?.durationMs ?? 0;
  useEffect(() => {
    setRange({ startMs: 0, endMs: clipDuration });
    setPlayheadMs(0);
    setPlaying(false);
    attach.clearError();
    // 클립 교체 시 1회 — attach 는 매 렌더 새로 오므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, clipDuration]);

  /**
   * MediaRecorder webm 은 `duration` 이 Infinity 로 오는 일이 잦다(알려진 Chromium 거동).
   * 한 번 아주 먼 지점으로 보내면 브라우저가 길이를 확정한다 — 그래야 스크럽이 어긋나지 않는다.
   */
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !clipId) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setClipDuration(captureBubbleId, clipId, video.duration * 1000);
      return;
    }
    const onTimeUpdate = (): void => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setClipDuration(captureBubbleId, clipId, video.duration * 1000);
      }
      video.currentTime = 0;
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.currentTime = 1e101;
  }, [captureBubbleId, clipId, setClipDuration]);

  // 재생은 고른 구간 안에서만 돈다 — 구간 밖을 보여 주면 무엇을 붙이는지 알 수 없다.
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nowMs = video.currentTime * 1000;
    setPlayheadMs(nowMs);
    if (nowMs >= range.endMs - 20) {
      video.currentTime = range.startMs / 1000;
      if (playing) void video.play().catch(() => { /* 사용자 제스처 없이 막히면 정지 상태로 둔다 */ });
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

  // ── 구간 손잡이 ─────────────────────────────────────────────────────────────
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
      setRange((prev) => {
        const next = which === 'start' ? { ...prev, startMs: ms } : { ...prev, endMs: ms };
        return clampRange(next, clipDuration);
      });
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

  // ── 조작 ────────────────────────────────────────────────────────────────────
  const saveClip = useCallback((target: PlaytestClip) => {
    const a = document.createElement('a');
    a.href = target.url;
    a.download = clipFileName(target.sourceName, target.at);
    a.click();
  }, []);

  const doAttach = useCallback(() => {
    if (!clip || agentId === null) return;
    void attach.attach(clip, range, frameCount, agentId);
  }, [agentId, attach, clip, frameCount, range]);

  const pct = useCallback((ms: number): number => (clipDuration <= 0 ? 0 : (ms / clipDuration) * 100), [clipDuration]);

  if (!clip) return null;

  const attachedAgentLabel = attach.result
    ? agents.find((a) => a.id === attach.result?.agentId)?.label ?? attach.result.agentId
    : '';

  return createPortal(
    <div
      ref={fw.windowRef}
      data-playtest-window=""
      className="fixed flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-black/70"
      style={{
        ...fw.style,
        zIndex: z,
        background: '#0B0E14',
        border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
      }}
      onMouseDownCapture={bringToFront}
      onMouseDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Title bar — 캡처 창과 같은 그래파이트 유리면. 드래그 이동 + 더블클릭 최대화. */}
      <div
        {...fw.titleBarProps}
        className="flex h-10 flex-shrink-0 cursor-grab select-none items-center gap-2 px-3 text-slate-200 active:cursor-grabbing"
        style={{
          background: CAPTURE_BUBBLE_DEFAULTS.CHROME_BG,
          borderBottom: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
          backdropFilter: 'blur(10px)',
        }}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: CAPTURE_PLAYTEST.RECORD_COLOR }}
        >
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
          <rect x="2" y="6" width="14" height="12" rx="2" />
        </svg>
        <span className="truncate text-[13px] font-semibold text-slate-100">
          {t('bubbleMap.capture.playtest.windowTitle', { defaultValue: '플레이테스트 클립' })}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500" title={clip.sourceName}>
          {clip.sourceName}
        </span>
        <button
          type="button"
          onClick={fw.toggleMaximized}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
          title={fw.maximized
            ? t('bubbleMap.capture.restore', { defaultValue: '원래 크기로' })
            : t('bubbleMap.capture.maximize', { defaultValue: '최대화' })}
          aria-label={fw.maximized
            ? t('bubbleMap.capture.restore', { defaultValue: '원래 크기로' })
            : t('bubbleMap.capture.maximize', { defaultValue: '최대화' })}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {fw.maximized ? (
              <><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></>
            ) : (
              <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>
            )}
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/80 hover:text-white"
          title={t('bubbleMap.capture.windowClose', { defaultValue: '닫기 (Esc)' })}
          aria-label={t('bubbleMap.capture.windowClose', { defaultValue: '닫기 (Esc)' })}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* 클립 목록 — 버블당 최근 N개. 고른 클립이 아래 전부를 지배한다. */}
        {clips.length > 1 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
            {clips.map((c) => {
              const active = c.id === clip.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openClip(captureBubbleId, c.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition-colors"
                  style={{
                    background: active ? `${accent}1f` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? `${accent}66` : CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
                    color: active ? '#E2E8F0' : '#94A3B8',
                  }}
                >
                  <span className="font-semibold tabular-nums">{formatClipDuration(c.durationMs)}</span>
                  <span className="text-slate-500">{new Date(c.at).toLocaleTimeString()}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 되돌려 보기 */}
        <div className="relative flex min-h-[180px] items-center justify-center overflow-hidden rounded-lg" style={{ background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG }}>
          <video
            ref={videoRef}
            src={clip.url}
            muted
            playsInline
            className="max-h-[46vh] w-full object-contain"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setPlaying(false)}
          />
          {clip.autoStopped && (
            <span
              className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[12px] font-semibold"
              style={{ background: 'rgba(251,191,36,0.16)', color: '#FBBF24' }}
            >
              {t('bubbleMap.capture.playtest.autoStopped', {
                defaultValue: '길이 상한에서 멈춤',
              })}
            </span>
          )}
        </div>

        {/* 구간 손잡이 — 시작·끝 둘. 최소 길이 아래로는 좁혀지지 않는다. */}
        <div className="flex shrink-0 flex-col gap-1.5">
          <div className="flex items-center justify-between text-[12px] tabular-nums text-slate-400">
            <span>{formatClipTime(range.startMs)}</span>
            <span className="text-slate-500">
              {t('bubbleMap.capture.playtest.rangeLength', {
                defaultValue: '구간 {{len}}',
                len: formatClipTime(Math.max(0, range.endMs - range.startMs)),
              })}
            </span>
            <span>{formatClipTime(range.endMs)}</span>
          </div>
          <div
            ref={trackRef}
            className="relative h-7 cursor-pointer select-none rounded-md"
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
            onClick={handleTrackClick}
          >
            {/* 고른 구간 */}
            <span
              className="pointer-events-none absolute inset-y-0 rounded-[3px]"
              style={{ left: `${pct(range.startMs)}%`, width: `${Math.max(0, pct(range.endMs) - pct(range.startMs))}%`, background: `${accent}2e` }}
            />
            {/* 재생 위치 */}
            <span
              className="pointer-events-none absolute inset-y-1 w-px"
              style={{ left: `${pct(playheadMs)}%`, background: '#E2E8F0' }}
            />
            {(['start', 'end'] as const).map((which) => (
              <span
                key={which}
                role="slider"
                aria-label={which === 'start'
                  ? t('bubbleMap.capture.playtest.rangeStart', { defaultValue: '구간 시작' })
                  : t('bubbleMap.capture.playtest.rangeEnd', { defaultValue: '구간 끝' })}
                aria-valuemin={0}
                aria-valuemax={Math.round(clipDuration)}
                aria-valuenow={Math.round(which === 'start' ? range.startMs : range.endMs)}
                tabIndex={0}
                className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm"
                style={{ left: `${pct(which === 'start' ? range.startMs : range.endMs)}%`, background: accent }}
                onMouseDown={beginDrag(which)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                {playing
                  ? <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>
                  : <path d="M8 5v14l11-7z" />}
              </svg>
              {playing
                ? t('bubbleMap.capture.pause', { defaultValue: '일시정지' })
                : t('bubbleMap.capture.playtest.playRange', { defaultValue: '구간 재생' })}
            </button>
            <button
              type="button"
              onClick={() => setRange({ startMs: 0, endMs: clipDuration })}
              className="h-7 rounded-md px-2.5 text-[12px] font-semibold text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
            >
              {t('bubbleMap.capture.playtest.rangeReset', { defaultValue: '구간 전체' })}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => saveClip(clip)}
              className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
              title={t('bubbleMap.capture.playtest.save', { defaultValue: '클립 저장 (.webm)' })}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
              </svg>
              {t('bubbleMap.capture.playtest.save', { defaultValue: '클립 저장 (.webm)' })}
            </button>
            <button
              type="button"
              onClick={() => removeClip(captureBubbleId, clip.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
              title={t('bubbleMap.capture.playtest.deleteClip', { defaultValue: '이 클립 버리기' })}
              aria-label={t('bubbleMap.capture.playtest.deleteClip', { defaultValue: '이 클립 버리기' })}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* 첨부 — 프레임 장수 · 받는 에이전트 · 붙이기 */}
        <div className="flex shrink-0 flex-col gap-2 rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[12px] text-slate-400">
              {t('bubbleMap.capture.playtest.frames', { defaultValue: '프레임' })}
            </span>
            <div className="flex flex-1 gap-1 rounded-md p-0.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {CAPTURE_PLAYTEST.FRAME_COUNT_OPTIONS.map((n) => {
                const active = frameCount === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFrameCount(n)}
                    className="flex-1 rounded px-2 py-1 text-[12px] font-semibold tabular-nums transition-colors"
                    style={{
                      background: active ? `${accent}26` : 'transparent',
                      color: active ? '#E2E8F0' : '#94A3B8',
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[12px] text-slate-400">
              {t('bubbleMap.capture.playtest.target', { defaultValue: '보낼 곳' })}
            </span>
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value === '' ? null : e.target.value)}
              disabled={targets.length === 0}
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] text-slate-200 outline-none disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
            >
              {targets.length === 0 && (
                <option value="">{t('bubbleMap.capture.playtest.noTarget', { defaultValue: '보낼 에이전트가 없습니다' })}</option>
              )}
              {targets.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={doAttach}
            disabled={attach.busy || agentId === null}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: `${accent}26`, color: '#E2E8F0', border: `1px solid ${accent}66` }}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {attach.busy && attach.progress
              ? t('bubbleMap.capture.playtest.attaching', {
                defaultValue: '프레임 뽑는 중 {{done}}/{{total}}',
                done: attach.progress.done,
                total: attach.progress.total,
              })
              : t('bubbleMap.capture.playtest.attach', {
                defaultValue: '구간 프레임 {{count}}장 첨부',
                count: frameCount,
              })}
          </button>

          {/* 결과·사유는 그 자리에 남는다 — 조용한 무동작 ❌. */}
          {attach.result && !attach.busy && (
            <p className="text-[12px] text-emerald-300">
              {t('bubbleMap.capture.playtest.attached', {
                defaultValue: '{{count}}장을 {{agent}} 입력창에 붙였습니다 — 무엇이 잘못됐는지 적어 보내세요.',
                count: attach.result.attached,
                agent: attachedAgentLabel,
              })}
            </p>
          )}
          {attach.error && (
            <p className="text-[12px] text-rose-300">
              {t('bubbleMap.capture.playtest.attachFailed', {
                defaultValue: '첨부 실패: {{reason}}',
                reason: attach.error,
              })}
            </p>
          )}
        </div>
      </div>

      {/* 우하단 리사이즈 핸들 — 최대화 중엔 숨김. */}
      {!fw.maximized && (
        <div
          {...fw.resizeProps}
          className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-slate-600 transition-colors hover:text-slate-300"
          aria-hidden="true"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15 15 21" /><path d="M21 9 9 21" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
});

/**
 * 열려 있는 클립 창 전부. **캔버스(BubbleMap) 자리에서 렌더한다** — 캡처 노드 안에서 그리면
 * 버블이 뷰포트 밖으로 나가 컬링되는 순간(§4 v3.71) 보고 있던 창이 함께 사라진다.
 */
export function PlaytestClipWindows(): React.JSX.Element | null {
  const openClipId = useCapturePlaytestStore((s) => s.openClipId);
  const openClip = useCapturePlaytestStore((s) => s.openClip);
  const ids = Object.entries(openClipId).filter(([, clipId]) => clipId !== undefined).map(([id]) => id);
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id) => (
        <PlaytestClipWindow
          key={id}
          captureBubbleId={id}
          accent={CAPTURE_BUBBLE_DEFAULTS.ACCENT_COLOR}
          onClose={() => openClip(id, null)}
        />
      ))}
    </>
  );
}
