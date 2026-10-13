import { useEffect, useRef, type ReactNode } from 'react';

import { formatMediaDuration, wavePath } from './appThumbnails.js';
import type { AppThumbnail } from './registry.js';
import { DARK_THEME_LOCK } from '../theme/themeLock.js';

/**
 * §5.4 #36 (G) — 앱 위성 화면 안쪽의 **공용 부품 한 벌**.
 *
 * 앱마다 자기 조작을 낸다(재생·돌려 보기·맞춤 — 레지스트리 `canvasFace`). 그 조작이 앉는 자리(아래 조작줄)·단추·
 * 재생 위치 막대·시간 글자·정지 미리보기는 여기 하나를 쓴다 — 앱마다 따로 그리면 같은 캔버스 위에서 단추 크기·간격이
 * 앱마다 갈린다. 코어 파일이라 앱 이름을 모른다.
 *
 * **조작 자리 표식 `FACE_CONTROL`(= `nodrag nopan`)** — React Flow 는 이 표식 위에서 노드를 끌지도 캔버스를 밀지도
 * 않는다. 노드의 선택 손짓·더블클릭 열기도 이 표식 위의 누름은 건너뛴다(`isFaceControlTarget`). 그래서 재생 위치를
 * 끄는 손이 노드를 옮기거나, 단추를 빨리 두 번 누른 것이 편집기를 여는 일이 없다.
 */
export const FACE_CONTROL = 'nodrag nopan';

/** 조작 자리 위에서 시작한 누름인가(노드의 선택·더블클릭 열기가 건너뛴다). */
export function isFaceControlTarget(target: EventTarget | null | undefined): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest('.nodrag') !== null;
}

/** 조작줄 높이(px) — 앱이 결과 자리 높이를 셀 때 쓴다. 아래 `FaceBar` 의 `h-6` 과 같은 값. */
export const FACE_BAR_HEIGHT = 24;

/** 재생 시계 — `0:00` · `1:05` · `1:02:03`. 지난 시간은 내림(아직 안 지난 초를 먼저 보이지 않는다). */
export function formatPlayClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** 0~1 로 자른 비율(길이를 모르면 0). */
export function playFraction(current: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) return 0;
  return Math.min(1, Math.max(0, current / duration));
}

/** 재생 시계를 화면에 싣는 눈금(초) — 매 프레임이 아니라 이 단위로만 상태를 바꾼다(초당 최대 30번 다시 그린다). */
export function quantizePlayTime(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 30) / 30 : 0;
}

/**
 * `active` 인 동안 매 애니메이션 프레임마다 `onFrame` 을 부른다(재생 중 시계·자동 회전). 꺼지거나 언마운트되면 멈춘다.
 * `timeupdate` 는 초당 4번뿐이라 재생 위치 막대·파형의 재생 줄이 계단처럼 튄다 — 그래서 프레임으로 읽는다.
 */
export function useFrameLoop(active: boolean, onFrame: (dtSec: number) => void): void {
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      frameRef.current(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/**
 * 화면 안쪽 전체 — 결과 자리(위) + 조작줄(아래).
 * §4 앱 테마 — 미디어 무대·조작줄은 어두운 바탕(`bg-black/55` 등)을 전제로 칠해져 있어 **어두운 판을 고정**한다.
 * 노드의 머리줄·테두리(이 바깥)는 테마를 따른다.
 */
export function FaceFrame({ children }: { children: ReactNode }): React.JSX.Element {
  return <div {...DARK_THEME_LOCK} className="absolute inset-0 flex flex-col">{children}</div>;
}

/** 결과 자리. 남는 높이를 다 쓴다. */
export function FaceStage({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <div className={`relative min-h-0 flex-1 overflow-hidden ${className}`}>{children}</div>;
}

/** 아래 조작줄. 전체가 조작 자리라 여기서 끌어도 노드가 움직이지 않는다(노드는 머리줄·테두리로 끈다). */
export function FaceBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={`${FACE_CONTROL} flex h-6 shrink-0 cursor-default items-center gap-0.5 border-t border-white/10 bg-black/55 px-1`}>
      {children}
    </div>
  );
}

/** 조작줄 단추 — 네모(2px 모서리)·20px. `active` 면 앱 색으로 켠 표시. */
export function FaceButton({
  label,
  onClick,
  active,
  disabled,
  accent,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  accent?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(active === undefined ? {} : { 'aria-pressed': active })}
      disabled={disabled === true}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`${FACE_CONTROL} flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 [&>svg]:h-3.5 [&>svg]:w-3.5 ${
        active === true ? 'bg-white/10' : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
      style={active === true && accent ? { color: accent } : undefined}
    >
      {children}
    </button>
  );
}

/**
 * 재생 위치 막대 — 누르고 끌면 그 자리로 간다. 포인터를 붙잡으므로(`setPointerCapture`) 막대 밖으로 손이 나가도 이어진다.
 * 좌표는 화면 사각형으로 재므로 캔버스 확대·축소와 무관하게 맞는다(React Flow 는 transform 으로 키운다).
 */
export function FaceSeek({
  value,
  disabled,
  label,
  accent,
  onSeek,
}: {
  /** 0~1. */
  value: number;
  disabled?: boolean | undefined;
  label: string;
  accent: string;
  onSeek: (fraction: number) => void;
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const pct = `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%`;
  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-disabled={disabled === true}
      title={label}
      className={`${FACE_CONTROL} relative mx-1 flex h-5 min-w-0 flex-1 items-center ${disabled === true ? 'opacity-40' : 'cursor-pointer'}`}
      onPointerDown={(e) => {
        if (disabled === true || e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        onSeek(fractionAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        onSeek(fractionAt(e.clientX));
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="relative h-[3px] w-full bg-white/15">
        <div className="absolute inset-y-0 left-0" style={{ width: pct, background: accent }} />
        {/* 손잡이 — 네모 막대 하나(둥근 공 ❌). */}
        <div className="absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-white" style={{ left: pct }} />
      </div>
    </div>
  );
}

/** 지난 시간 / 길이. 길이를 모르면 지난 시간만. */
export function FaceTime({ current, duration }: { current: number; duration: number }): React.JSX.Element {
  const total = Number.isFinite(duration) && duration > 0 ? formatPlayClock(duration) : '';
  return (
    <span className="shrink-0 whitespace-nowrap px-1 text-[12px] leading-none tabular-nums text-white/70">
      {formatPlayClock(current)}
      {total ? <span className="text-white/40"> / {total}</span> : null}
    </span>
  );
}

/** 조작줄 안내 한 줄(못 여는 이유·손짓 안내). 자리가 모자라면 잘리고 전문은 툴팁. */
export function FaceNote({ children, title }: { children: ReactNode; title?: string | undefined }): React.JSX.Element {
  return (
    <span title={title} className="min-w-0 flex-1 truncate px-1 text-[12px] leading-none text-white/55">
      {children}
    </span>
  );
}

/**
 * 정지 미리보기 — 코어가 구운 그림·파형, 굽는 중이면 숨 쉬는 아이콘, 못 구웠으면 아이콘.
 * `fit` 을 주면 그림의 담는 법을 그것으로 바꾼다(맞춤 ↔ 채우기 단추). 길이가 있으면 오른쪽 위 모서리 숫자.
 */
export function FaceStill({
  thumb,
  loading,
  glow,
  icon,
  width,
  height,
  fit,
  showDuration = true,
}: {
  thumb: AppThumbnail | null;
  loading: boolean;
  glow: string;
  icon: ReactNode;
  /** 자리 크기(px) — 파형 좌표계. */
  width: number;
  height: number;
  fit?: 'cover' | 'contain' | undefined;
  showDuration?: boolean | undefined;
}): React.JSX.Element {
  const duration = showDuration && thumb?.durationSec !== undefined ? formatMediaDuration(thumb.durationSec) : '';
  if (thumb?.kind === 'picture') {
    const mode = fit ?? thumb.fit ?? 'cover';
    return (
      <>
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className={`pointer-events-none absolute inset-0 h-full w-full select-none ${mode === 'contain' ? 'object-contain p-1.5' : 'object-cover'}`}
        />
        {duration ? <FaceCornerBadge text={duration} /> : null}
      </>
    );
  }
  if (thumb?.kind === 'wave') {
    return (
      <>
        <FaceWave peaks={thumb.peaks} width={width} height={height} glow={glow} played={null} />
        {duration ? <FaceCornerBadge text={duration} /> : null}
      </>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        className={`flex [&>svg]:h-6 [&>svg]:w-6 ${loading ? 'animate-pulse opacity-60' : 'opacity-75'}`}
        style={{ color: glow }}
      >
        {icon}
      </span>
    </div>
  );
}

/** 결과 자리 오른쪽 위 모서리의 작은 숫자(길이 등). */
export function FaceCornerBadge({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="pointer-events-none absolute right-1 top-1 bg-black/65 px-1 text-[12px] leading-4 tabular-nums text-white/90">
      {text}
    </span>
  );
}

/** 파형 막대와 상자 가장자리 사이. */
const WAVE_PAD = 6;

/**
 * 파형 — `played`(0~1)를 주면 들은 구간을 앱 색으로 밝게, 남은 구간을 흐리게 그리고 그 경계에 재생 줄을 긋는다.
 * path 두 개라 막대가 몇 개든 DOM 노드는 셋이다.
 */
export function FaceWave({
  peaks,
  width,
  height,
  glow,
  played,
}: {
  peaks: readonly number[];
  width: number;
  height: number;
  glow: string;
  played: number | null;
}): React.JSX.Element {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const n = peaks.length;
  if (played === null) {
    const wave = wavePath(peaks, w, h, WAVE_PAD);
    return (
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`M${WAVE_PAD},${h / 2}H${w - WAVE_PAD}`} stroke={glow} strokeOpacity={0.22} strokeWidth={1} />
        <path d={wave.d} stroke={glow} strokeOpacity={0.85} strokeWidth={wave.strokeWidth} strokeLinecap="butt" fill="none" />
      </svg>
    );
  }
  const cut = Math.round(Math.min(1, Math.max(0, played)) * n);
  const heard = wavePath(peaks, w, h, WAVE_PAD, { from: 0, to: cut });
  const rest = wavePath(peaks, w, h, WAVE_PAD, { from: cut, to: n });
  const x = WAVE_PAD + (w - WAVE_PAD * 2) * Math.min(1, Math.max(0, played));
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M${WAVE_PAD},${h / 2}H${w - WAVE_PAD}`} stroke={glow} strokeOpacity={0.18} strokeWidth={1} />
      <path d={rest.d} stroke="#FFFFFF" strokeOpacity={0.28} strokeWidth={rest.strokeWidth} strokeLinecap="butt" fill="none" />
      <path d={heard.d} stroke={glow} strokeOpacity={0.95} strokeWidth={heard.strokeWidth} strokeLinecap="butt" fill="none" />
      <path d={`M${x.toFixed(1)},2V${h - 2}`} stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={1} />
    </svg>
  );
}

// ─── 글리프 — Lucide 결의 stroke SVG(이모지 ❌). 색은 currentColor, 크기는 부모(`[&>svg]:h-3.5`)가 정한다. ───

function Glyph({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function PlayGlyph(): React.JSX.Element {
  return <Glyph><path d="M6 4v16l14-8z" /></Glyph>;
}

export function PauseGlyph(): React.JSX.Element {
  return <Glyph><path d="M8 5v14M16 5v14" /></Glyph>;
}

export function VolumeGlyph(): React.JSX.Element {
  return <Glyph><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></Glyph>;
}

export function MutedGlyph(): React.JSX.Element {
  return <Glyph><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></Glyph>;
}

/** 자동 회전 — 원을 도는 두 화살. */
export function SpinGlyph(): React.JSX.Element {
  return <Glyph><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /></Glyph>;
}

/** 처음 구도로 — 되돌리는 화살. */
export function ResetViewGlyph(): React.JSX.Element {
  return <Glyph><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Glyph>;
}

/** 맞춤(통째로 보기) — 안으로 모이는 모서리. */
export function FitGlyph(): React.JSX.Element {
  return <Glyph><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></Glyph>;
}

/** 채우기(꽉 채워 보기) — 밖으로 벌어진 모서리. */
export function FillGlyph(): React.JSX.Element {
  return <Glyph><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></Glyph>;
}

export function CopyGlyph(): React.JSX.Element {
  return <Glyph><rect x="8" y="8" width="13" height="13" rx="1.5" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></Glyph>;
}

export function CheckGlyph(): React.JSX.Element {
  return <Glyph><path d="M20 6 9 17l-5-5" /></Glyph>;
}
