import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppShellProps } from '../../apps/registry.js';
import { WindowControls } from '../Layout/WindowControls.js';
import {
  editedMediaPath,
  mediaFileName,
  workspaceMediaUrl,
  writeWorkspaceMedia,
} from '../../utils/workspaceMedia.js';
import {
  applyFade,
  applyGain,
  clipDuration,
  clipLength,
  computePeaks,
  cropRange,
  deleteRange,
  encodeWav,
  formatClipTime,
  type AudioClip,
} from './audioEdit.js';

/**
 * §5.13 (R-4) Vibisound — **심플한 음악 편집기**(일곱 번째 shell).
 *
 * `#app=vibisound&projectId=…&file=…` 로 뜬다. 음악 파일을 눌렀을 때 "재생기"가 아니라
 * **편집기**가 열리는 이유는, 사용자가 결과물을 눌러 보는 자리에서 곧바로 다듬고 싶어 하기
 * 때문이다(사용자 지시: "음악도 음악 편집툴 하나 만들어 심플하게").
 *
 * 규율 셋:
 *   ① **원본을 덮어쓰지 않는다** — 저장은 언제나 `…-edit.wav` 같은 새 파일이다(§5.13 (R-4)).
 *   ② **새 의존성 없이** — 디코딩은 브라우저(`decodeAudioData`), 인코딩은 순수 WAV 라이터.
 *   ③ **계산은 화면 밖에** — 자르기·페이드·봉우리는 `audioEdit.ts` 의 순수 함수이고 테스트가 지킨다.
 */

/** 되돌리기 깊이. 이보다 깊이 파고들 편집이면 새 파일로 저장하는 편이 안전하다. */
const UNDO_DEPTH = 12;

/** 파형 캔버스 높이(px). 창을 키워도 파형이 화면을 다 먹지 않게 고정한다. */
const WAVE_HEIGHT = 220;

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function ToolButton({
  onClick,
  disabled,
  tone = 'plain',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'accent' | 'danger';
  children: React.ReactNode;
}): React.JSX.Element {
  const toneClass =
    tone === 'accent'
      ? 'bg-teal-500/20 text-teal-200 hover:bg-teal-500/30'
      : tone === 'danger'
        ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
        : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export function VibisoundShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const root = params['projectId'] ?? '';
  const filePath = params['file'] ?? '';
  const fileName = useMemo(() => (filePath ? mediaFileName(filePath) : ''), [filePath]);

  const [clip, setClip] = useState<AudioClip | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [width, setWidth] = useState(960);

  const undoRef = useRef<AudioClip[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef(0);
  const startedRef = useRef({ at: 0, offset: 0 });

  const duration = clip ? clipDuration(clip) : 0;

  // ─── 읽기 ───

  useEffect(() => {
    if (root === '' || filePath === '') {
      setLoad({ status: 'error', message: t('panel.vibisound.noFile', { defaultValue: '음악 파일을 눌러 열면 여기서 다듬습니다.' }) });
      return;
    }
    let alive = true;
    setLoad({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch(workspaceMediaUrl(root, filePath));
        if (!res.ok) throw new Error(String(res.status));
        const bytes = await res.arrayBuffer();
        // 디코딩 전용 컨텍스트를 따로 쓰지 않는다 — 재생과 같은 표본율이어야 한 번 더 리샘플되지 않는다.
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const decoded = await ctx.decodeAudioData(bytes);
        if (!alive) return;
        const channels: Float32Array[] = [];
        for (let i = 0; i < decoded.numberOfChannels; i += 1) channels.push(decoded.getChannelData(i).slice());
        setClip({ channels, sampleRate: decoded.sampleRate });
        setLoad({ status: 'ready' });
      } catch (err) {
        if (!alive) return;
        setLoad({
          status: 'error',
          message: t('panel.vibisound.decodeFailed', {
            defaultValue: '이 형식은 브라우저가 읽지 못합니다. 연결 프로그램으로 열어 주세요.',
          }),
        });
        setStatus(String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, filePath, t]);

  // 창 폭에 맞춰 파형을 다시 접는다.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(240, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const peaks = useMemo(() => (clip ? computePeaks(clip, width) : new Float32Array(0)), [clip, width]);

  // ─── 그리기 ───

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(WAVE_HEIGHT * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, WAVE_HEIGHT);

    // 바탕 + 중앙선
    g.fillStyle = '#0B1416';
    g.fillRect(0, 0, width, WAVE_HEIGHT);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.moveTo(0, WAVE_HEIGHT / 2);
    g.lineTo(width, WAVE_HEIGHT / 2);
    g.stroke();

    // 선택 구간 — 파형 아래 깔아 파형을 가리지 않게.
    if (selection && duration > 0) {
      const x1 = (Math.min(selection.start, selection.end) / duration) * width;
      const x2 = (Math.max(selection.start, selection.end) / duration) * width;
      g.fillStyle = 'rgba(45,212,191,0.16)';
      g.fillRect(x1, 0, Math.max(1, x2 - x1), WAVE_HEIGHT);
    }

    // 파형
    g.strokeStyle = '#5EEAD4';
    g.beginPath();
    for (let x = 0; x < width; x += 1) {
      const min = peaks[x * 2] ?? 0;
      const max = peaks[x * 2 + 1] ?? 0;
      const yTop = WAVE_HEIGHT / 2 - max * (WAVE_HEIGHT / 2 - 6);
      const yBottom = WAVE_HEIGHT / 2 - min * (WAVE_HEIGHT / 2 - 6);
      g.moveTo(x + 0.5, yTop);
      g.lineTo(x + 0.5, Math.max(yBottom, yTop + 0.5));
    }
    g.stroke();

    // 재생 머리
    if (duration > 0) {
      const x = (playhead / duration) * width;
      g.strokeStyle = '#FDE68A';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, WAVE_HEIGHT);
      g.stroke();
    }
  }, [peaks, width, selection, playhead, duration]);

  // ─── 재생 ───

  const stopPlayback = useCallback((): void => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* 이미 끝났으면 그대로 */
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }, []);

  const play = useCallback(
    (fromSec: number, toSec?: number): void => {
      const ctx = ctxRef.current;
      if (!ctx || !clip || clipLength(clip) === 0) return;
      stopPlayback();
      void ctx.resume();

      const buffer = ctx.createBuffer(clip.channels.length, clipLength(clip), clip.sampleRate);
      // `Float32Array.from` 으로 한 벌 복사한다 — 재생용 버퍼는 편집 중인 배열과 수명을 나눠야
      // 하고(재생 중에 편집이 들어와도 소리가 깨지지 않는다), 복사는 재생 시작 때 한 번뿐이다.
      clip.channels.forEach((ch, i) => buffer.copyToChannel(Float32Array.from(ch), i));

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const start = Math.max(0, Math.min(fromSec, duration));
      const span = toSec === undefined ? undefined : Math.max(0, toSec - start);
      src.start(0, start, span);
      sourceRef.current = src;
      startedRef.current = { at: ctx.currentTime, offset: start };
      setPlaying(true);

      src.onended = () => {
        sourceRef.current = null;
        cancelAnimationFrame(rafRef.current);
        setPlaying(false);
        if (loop && selection) play(selection.start, selection.end);
      };

      const tick = (): void => {
        const now = ctx.currentTime - startedRef.current.at + startedRef.current.offset;
        setPlayhead(Math.min(now, duration));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [clip, duration, loop, selection, stopPlayback],
  );

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // ─── 선택 ───

  const secondsAt = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas || duration === 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  const dragRef = useRef<number | null>(null);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!clip) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const at = secondsAt(e.clientX);
      dragRef.current = at;
      setSelection(null);
      setPlayhead(at);
    },
    [clip, secondsAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const anchor = dragRef.current;
      if (anchor === null) return;
      const at = secondsAt(e.clientX);
      // 손이 미세하게 흔들린 것을 선택으로 읽지 않는다(클릭으로 재생 머리만 옮기는 조작이 살아 있어야 한다).
      if (Math.abs(at - anchor) < 0.01) return;
      setSelection({ start: Math.min(anchor, at), end: Math.max(anchor, at) });
    },
    [secondsAt],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 놓였으면 그대로 */
    }
  }, []);

  // ─── 편집 ───

  const pushUndo = useCallback((prev: AudioClip): void => {
    const stack = undoRef.current;
    stack.push(prev);
    if (stack.length > UNDO_DEPTH) stack.shift();
    setUndoDepth(stack.length);
  }, []);

  const edit = useCallback(
    (fn: (c: AudioClip, sel: { start: number; end: number }) => AudioClip, needsSelection = true): void => {
      if (!clip) return;
      const sel = selection ?? { start: 0, end: duration };
      if (needsSelection && !selection) {
        setStatus(t('panel.vibisound.needSelection', { defaultValue: '먼저 파형에서 구간을 끌어 선택해 주세요.' }));
        return;
      }
      stopPlayback();
      const next = fn(clip, sel);
      if (next === clip) return;
      pushUndo(clip);
      setClip(next);
      setSelection(null);
      setPlayhead(0);
      setStatus('');
    },
    [clip, selection, duration, stopPlayback, pushUndo, t],
  );

  const undo = useCallback((): void => {
    const prev = undoRef.current.pop();
    setUndoDepth(undoRef.current.length);
    if (!prev) return;
    stopPlayback();
    setClip(prev);
    setSelection(null);
    setPlayhead(0);
  }, [stopPlayback]);

  // ─── 내보내기 ───

  const [saving, setSaving] = useState(false);
  const exportWav = useCallback((): void => {
    if (!clip || root === '' || filePath === '') return;
    setSaving(true);
    void (async () => {
      const bytes = encodeWav(clip);
      // 이름이 겹치면 번호를 올려 다시 시도한다 — 원본도, 앞서 저장한 것도 덮지 않는다.
      for (let n = 1; n <= 50; n += 1) {
        const target = editedMediaPath(filePath, '.wav', n);
        const result = await writeWorkspaceMedia(root, target, bytes);
        if (result.ok) {
          setStatus(t('panel.vibisound.saved', { defaultValue: '저장했습니다 — {{path}}', path: result.path }));
          setSaving(false);
          return;
        }
        if (result.error === 'failed') break;
      }
      setStatus(t('panel.vibisound.saveFailed', { defaultValue: '저장하지 못했습니다.' }));
      setSaving(false);
    })();
  }, [clip, root, filePath, t]);

  const openExternal = useCallback((): void => {
    void fetch('/api/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absolutePath: `${root}/${filePath}` }),
    }).catch(() => undefined);
  }, [root, filePath]);

  const hasSelection = selection !== null && Math.abs(selection.end - selection.start) > 0.001;

  return (
    // §5.13 (S-7) — 높이는 **호스트가 준다**(OS 창은 AppShellHost, 앱 안 창은 창 본문).
    //   여기서 h-screen 을 쓰면 앱 안 창에서 화면 높이만큼 자라 창을 뚫는다.
    <div className="flex h-full flex-col bg-gray-950 text-gray-100">
      {/* 타이틀바 — 앱 창은 프레임이 없어 이 줄이 곧 창의 손잡이다. */}
      <header className="app-drag flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <span className="text-sm font-semibold">{t('panel.vibisound.title', { defaultValue: 'Vibisound' })}</span>
        <span className="truncate text-xs text-white/45">{fileName}</span>
        <div className="app-nodrag ml-auto flex items-center">
          <WindowControls />
        </div>
      </header>

      {/* 조작 줄 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <ToolButton
          onClick={() => (playing ? stopPlayback() : play(hasSelection && selection ? selection.start : playhead, hasSelection && selection ? selection.end : undefined))}
          disabled={!clip}
          tone="accent"
        >
          {playing ? t('panel.vibisound.stop', { defaultValue: '정지' }) : t('panel.vibisound.play', { defaultValue: '재생' })}
        </ToolButton>
        <ToolButton onClick={() => { stopPlayback(); setPlayhead(0); }} disabled={!clip}>
          {t('panel.vibisound.toStart', { defaultValue: '처음으로' })}
        </ToolButton>
        <label className="ml-1 flex cursor-pointer items-center gap-1 text-[12px] text-gray-400">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="h-3 w-3 accent-teal-400" />
          {t('panel.vibisound.loop', { defaultValue: '구간 반복' })}
        </label>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <ToolButton onClick={() => edit((c, s) => cropRange(c, s.start, s.end))} disabled={!hasSelection}>
          {t('panel.vibisound.cropSelection', { defaultValue: '선택만 남기기' })}
        </ToolButton>
        <ToolButton onClick={() => edit((c, s) => deleteRange(c, s.start, s.end))} disabled={!hasSelection} tone="danger">
          {t('panel.vibisound.deleteSelection', { defaultValue: '선택 지우기' })}
        </ToolButton>
        <ToolButton onClick={() => edit((c, s) => applyGain(c, s.start, s.end, 0))} disabled={!hasSelection}>
          {t('panel.vibisound.silence', { defaultValue: '선택 음소거' })}
        </ToolButton>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <ToolButton onClick={() => edit((c, s) => applyFade(c, s.start, s.end, 'in'))} disabled={!hasSelection}>
          {t('panel.vibisound.fadeIn', { defaultValue: '페이드 인' })}
        </ToolButton>
        <ToolButton onClick={() => edit((c, s) => applyFade(c, s.start, s.end, 'out'))} disabled={!hasSelection}>
          {t('panel.vibisound.fadeOut', { defaultValue: '페이드 아웃' })}
        </ToolButton>
        <ToolButton onClick={() => edit((c, s) => applyGain(c, s.start, s.end, 1.25))} disabled={!hasSelection}>
          {t('panel.vibisound.louder', { defaultValue: '크게 +25%' })}
        </ToolButton>
        <ToolButton onClick={() => edit((c, s) => applyGain(c, s.start, s.end, 0.8))} disabled={!hasSelection}>
          {t('panel.vibisound.quieter', { defaultValue: '작게 −20%' })}
        </ToolButton>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <ToolButton onClick={undo} disabled={undoDepth === 0}>
          {t('panel.vibisound.undo', { defaultValue: '되돌리기' })}
        </ToolButton>
        <ToolButton onClick={exportWav} disabled={!clip || saving} tone="accent">
          {saving
            ? t('panel.vibisound.saving', { defaultValue: '저장 중…' })
            : t('panel.vibisound.exportWav', { defaultValue: 'WAV 로 내보내기' })}
        </ToolButton>
      </div>

      {/* 파형 */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden px-3 py-3">
        {load.status === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[12px] text-amber-300/90">{load.message}</p>
            <ToolButton onClick={openExternal}>
              {t('panel.vibisound.openExternal', { defaultValue: '연결 프로그램으로 열기' })}
            </ToolButton>
          </div>
        ) : load.status !== 'ready' ? (
          <div className="flex h-full items-center justify-center text-[12px] text-gray-500">
            {t('panel.vibisound.loading', { defaultValue: '소리를 읽는 중…' })}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ width: '100%', height: WAVE_HEIGHT }}
            className="cursor-crosshair rounded border border-white/10"
          />
        )}
      </div>

      {/* 상태 줄 — 시간·선택 구간·마지막 알림 */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 px-3 py-2 text-[12px] text-gray-400">
        <span className="tabular-nums">
          {formatClipTime(playhead)} / {formatClipTime(duration)}
        </span>
        {hasSelection && selection ? (
          <span className="tabular-nums text-teal-300">
            {t('panel.vibisound.selectionInfo', {
              defaultValue: '선택 {{from}} → {{to}} ({{len}})',
              from: formatClipTime(selection.start),
              to: formatClipTime(selection.end),
              len: formatClipTime(selection.end - selection.start),
            })}
          </span>
        ) : (
          <span className="text-gray-600">
            {t('panel.vibisound.selectHint', { defaultValue: '파형을 끌어 구간을 고르면 편집 버튼이 켜집니다' })}
          </span>
        )}
        <span className="ml-auto truncate">{status}</span>
      </footer>
    </div>
  );
}
