import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FACE_CONTROL,
  FaceBar,
  FaceButton,
  FaceNote,
  FaceSeek,
  FaceTime,
  MutedGlyph,
  PauseGlyph,
  PlayGlyph,
  VolumeGlyph,
  formatPlayClock,
  playFraction,
  quantizePlayTime,
} from '../../apps/canvasFaceKit.js';
import { usePlayheadValue, type PlayheadClock } from './playheadClock.js';

/**
 * §5.4 #36 (J) — 훑어보기 조작줄 두 모양. 멈춘 동안: [재생] · 바뀐 것 한 줄 · [직전 판](누르고 있는 동안) · [렌더본] · 때.
 * 재생 중: [일시정지] · 진행 막대(누르기·끌기 이동, 올리면 그 시각과 장면 그림) · 지난 시간/길이 · 음소거. 좁으면 때·시간 → 음소거 순으로 접는다.
 * 조작에 키보드 단축키 ❌((G) 불변).
 */

/** 좁으면 덜 중요한 것부터 접는 폭(px) — 결과 파일 재생(`VideoFileFace`)과 같은 문턱. */
export const GLANCE_TIME_MIN_WIDTH = 220;
export const GLANCE_MUTE_MIN_WIDTH = 184;

function Glyph({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** 직전 판 — 되돌아가는 시계(lucide `history` 결). */
function HistoryGlyph(): React.JSX.Element {
  return <Glyph><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></Glyph>;
}

/** 렌더본 — 필름 한 칸(lucide `film` 결). */
function FilmGlyph(): React.JSX.Element {
  return <Glyph><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" /></Glyph>;
}

/** 재생 단추 — 받는 중이면 숨 쉰다(누른 손이 먹혔다는 것을 단추가 말한다). */
function PlayButton(p: { readonly playing: boolean; readonly loading: boolean; readonly disabled: boolean; readonly onPress: () => void; readonly onHover?: (() => void) | undefined }): React.JSX.Element {
  const { t } = useTranslation();
  const label = p.playing ? t('common.pause', { defaultValue: '일시정지' }) : t('common.play', { defaultValue: '재생' });
  return (
    <span className="flex shrink-0" onPointerEnter={p.onHover}>
      <FaceButton label={label} onClick={p.onPress} disabled={p.disabled}>
        {p.playing ? <PauseGlyph /> : p.loading ? <span className="flex animate-pulse [&>svg]:h-3.5 [&>svg]:w-3.5"><PlayGlyph /></span> : <PlayGlyph />}
      </FaceButton>
    </span>
  );
}

/** ④ 누르고 있는 동안만 켜지는 단추(떼거나 손이 빠지면 꺼진다). 끌기·선택으로 치지 않는다(`nodrag nopan`). */
function HoldButton(p: { readonly label: string; readonly holding: boolean; readonly accent: string; readonly onHold: (on: boolean) => void }): React.JSX.Element {
  const off = (): void => p.onHold(false);
  return (
    <button
      type="button"
      title={p.label}
      aria-label={p.label}
      aria-pressed={p.holding}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        p.onHold(true);
      }}
      onPointerUp={off}
      onPointerCancel={off}
      onLostPointerCapture={off}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`${FACE_CONTROL} flex h-5 w-5 shrink-0 touch-none items-center justify-center rounded-sm transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5 ${
        p.holding ? 'bg-white/10' : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
      style={p.holding ? { color: p.accent } : undefined}
    >
      <HistoryGlyph />
    </button>
  );
}

export interface GlanceStoppedBarProps {
  readonly width: number;
  readonly glow: string;
  readonly playLoading: boolean;
  readonly playDisabled: boolean;
  readonly onPlay: () => void;
  readonly onPrefetch: () => void;
  readonly note: string;
  readonly noteTitle?: string | undefined;
  /** ④ 직전 판 단추 — 바퀴 시작 판이 없으면 없다. */
  readonly hold: { readonly holding: boolean; readonly onHold: (on: boolean) => void } | null;
  /** 마지막 렌더본이 있으면 그 재생으로(종전 결과 재생). */
  readonly onShowRender?: (() => void) | undefined;
  readonly when: string | null;
  readonly whenTitle?: string | undefined;
}

export function GlanceStoppedBar(p: GlanceStoppedBarProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <FaceBar>
      <PlayButton playing={false} loading={p.playLoading} disabled={p.playDisabled} onPress={p.onPlay} onHover={p.onPrefetch} />
      <FaceNote title={p.noteTitle}>{p.note}</FaceNote>
      {p.hold ? <HoldButton label={t('panel.apps.canvas.holdPrevious')} holding={p.hold.holding} accent={p.glow} onHold={p.hold.onHold} /> : null}
      {p.onShowRender ? (
        <FaceButton label={t('panel.apps.canvas.playExport', { defaultValue: 'Play the last render' })} onClick={p.onShowRender}>
          <FilmGlyph />
        </FaceButton>
      ) : null}
      {p.when && p.width >= GLANCE_TIME_MIN_WIDTH ? (
        <span title={p.whenTitle} className="shrink-0 whitespace-nowrap px-1 text-[12px] leading-none tabular-nums text-white/45">{p.when}</span>
      ) : null}
    </FaceBar>
  );
}

export interface GlancePlayingBarProps {
  readonly width: number;
  readonly glow: string;
  readonly playing: boolean;
  readonly onToggle: () => void;
  readonly clock: PlayheadClock;
  readonly duration: number;
  /** 장면 경계(0~1). */
  readonly marks: readonly number[];
  readonly onSeek: (t: number) => void;
  readonly onSeekEnd: () => void;
  /** 그 시각의 장면 그림(말풍선). */
  readonly frameAt: (t: number) => string | null;
  /** 말풍선 그림 칸 비율(가로/세로). */
  readonly aspect: number;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
}

/** 말풍선 그림 높이(px) — 폭은 문서 비율로(상한 96). */
const BUBBLE_IMAGE_HEIGHT = 54;
const BUBBLE_IMAGE_MAX_WIDTH = 96;

export function GlancePlayingBar(p: GlancePlayingBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const at = quantizePlayTime(usePlayheadValue(p.clock, 0));
  const bubbleWidth = Math.round(Math.min(BUBBLE_IMAGE_MAX_WIDTH, BUBBLE_IMAGE_HEIGHT * (p.aspect > 0 ? p.aspect : 16 / 9)));
  return (
    <FaceBar>
      <PlayButton playing={p.playing} loading={false} disabled={false} onPress={p.onToggle} />
      <FaceSeek
        value={playFraction(at, p.duration)}
        label={t('panel.videoStudio.seek', { defaultValue: '재생 위치' })}
        accent={p.glow}
        marks={p.marks}
        onSeek={(f) => p.onSeek(f * p.duration)}
        onSeekEnd={p.onSeekEnd}
        renderHover={(f) => {
          const time = f * p.duration;
          const image = p.frameAt(time);
          return (
            <div className="flex flex-col items-center gap-0.5 rounded-sm bg-black/80 p-0.5 shadow-lg shadow-black/60">
              {image ? (
                <img src={image} alt="" draggable={false} className="rounded-[2px] object-cover" style={{ width: bubbleWidth, height: BUBBLE_IMAGE_HEIGHT }} />
              ) : null}
              <span className="px-1 text-[12px] leading-4 tabular-nums text-white/90">{formatPlayClock(time)}</span>
            </div>
          );
        }}
      />
      {p.width >= GLANCE_TIME_MIN_WIDTH ? <FaceTime current={at} duration={p.duration} /> : null}
      {p.width >= GLANCE_MUTE_MIN_WIDTH ? (
        <FaceButton label={t('panel.vibisound.workbench.mute', { defaultValue: '음소거' })} active={p.muted} accent={p.glow} onClick={p.onToggleMute}>
          {p.muted ? <MutedGlyph /> : <VolumeGlyph />}
        </FaceButton>
      ) : null}
    </FaceBar>
  );
}
