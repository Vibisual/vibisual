import { useTranslation } from 'react-i18next';

import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { shortcutLabel } from '../../utils/platform.js';
import { StudioIconButton } from './StudioIconButton.js';
import { usePlayheadValue, type PlayheadClock } from './playheadClock.js';

/** §5.13 (V) 37-1 — 미리보기 조작 줄(아이콘 + 툴팁 단축키, 시간은 `tabular-nums`). 좁으면 접히고, `box-narrow` 에선 총길이를 걷고 [정밀 편집]은 아이콘만. */
export interface PreviewControlsProps {
  readonly playing: boolean;
  readonly preparing?: boolean;
  readonly playhead: number;
  /** §5.13 (X) 39-6 — 프레임마다 가는 재생 머리(시간 글자만 구독한다). 없으면 `playhead` 그대로. */
  readonly clock?: PlayheadClock;
  readonly duration: number;
  readonly loop: boolean;
  readonly safeArea: boolean;
  readonly zoom: 'fit' | 'actual';
  readonly interaction: 'none' | 'point' | 'note';
  readonly precisionOpen: boolean;
  readonly disabled: boolean;
  readonly onPlay: () => void;
  readonly onStep: (frames: number) => void;
  readonly onLoop: () => void;
  readonly onSafeArea: () => void;
  readonly onZoom: () => void;
  readonly onInteraction: (mode: 'none' | 'point' | 'note') => void;
  readonly onPrecision: () => void;
  /** §5.13 (AA) 42-3 — 미리보기 음소거(`M`)·크기(0~1). 재생 박자는 바뀌지 않는다(크기만 0 으로). */
  readonly muted?: boolean;
  readonly volume?: number;
  readonly onMute?: () => void;
  readonly onVolume?: (volume: number) => void;
}

/** `00:12.04` — 분:초.백분의일초. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

/** 시간 글자 — 시계를 **이 글자만** 구독한다(재생 중 조작 줄 전체를 다시 그리지 않는다). */
function ClockText({ clock, playhead, duration }: { readonly clock: PlayheadClock | undefined; readonly playhead: number; readonly duration: number }): React.JSX.Element {
  const at = usePlayheadValue(clock, playhead);
  return <>{formatClock(at)}<span className="text-slate-500 box-narrow:hidden"> / {formatClock(duration)}</span></>;
}

export function PreviewControls(p: PreviewControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const k = (key: string): string => shortcutLabel(key);
  const empty = p.duration <= 0;
  // 등급이 바뀔 때만 다시 그린다(폭을 재서 들고 있지 않는다) — 단추 안 글자는 이 부품 밖이라 CSS 변형으로 못 걷는다.
  const narrow = useAppBoxTier() === 'narrow';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 px-1">
      <StudioIconButton icon="prev" label={t('panel.videoStudio.preview.prevFrame')} hint={`${k('Left')} · ${k('Shift+Left')}`} disabled={empty} onClick={() => p.onStep(-1)} />
      <StudioIconButton icon={p.playing || p.preparing ? 'pause' : 'play'} label={p.playing || p.preparing ? t('panel.videoStudio.pause') : t('panel.videoStudio.play')} hint={k('Space')} disabled={empty || p.disabled} onPress={p.onPlay} onClick={p.onPlay} />
      {p.preparing ? <span role="status" className="shrink-0 text-[12px] text-slate-400">{t('panel.videoStudio.preview.preparing')}</span> : null}
      <StudioIconButton icon="next" label={t('panel.videoStudio.preview.nextFrame')} hint={`${k('Right')} · ${k('Shift+Right')}`} disabled={empty} onClick={() => p.onStep(1)} />
      <span className="mx-2 shrink-0 text-[13px] tabular-nums text-slate-300 box-narrow:mx-1">
        <ClockText clock={p.clock} playhead={p.playhead} duration={p.duration} />
      </span>
      <StudioIconButton icon="loop" label={t('panel.videoStudio.editor.loop')} hint={k('L')} active={p.loop} onClick={p.onLoop} />
      {p.onMute ? (
        <>
          <StudioIconButton icon={p.muted || (p.volume ?? 1) === 0 ? 'volumeOff' : 'volume'} hint={k('M')}
            label={p.muted ? t('panel.videoStudio.preview.unmute') : t('panel.videoStudio.preview.mute')} active={p.muted === true} onClick={p.onMute} />
          <input type="range" min={0} max={1} step={0.05} value={p.muted ? 0 : p.volume ?? 1} aria-label={t('panel.videoStudio.preview.volume')}
            title={`${t('panel.videoStudio.preview.volume')} ${Math.round((p.muted ? 0 : p.volume ?? 1) * 100)}%`}
            onChange={(e) => p.onVolume?.(Number(e.target.value))}
            className="w-16 shrink-0 accent-[var(--vs-accent)] pointer-coarse:h-8 pointer-coarse:w-20" />
        </>
      ) : null}
      <span className="mx-1 h-4 border-l border-white/10 box-narrow:hidden" aria-hidden="true" />
      <StudioIconButton icon="safe" label={t('panel.videoStudio.preview.safeArea')} hint={k('G')} active={p.safeArea} onClick={p.onSafeArea} />
      <StudioIconButton icon="fit" label={p.zoom === 'fit' ? t('panel.videoStudio.preview.actualSize') : t('panel.videoStudio.preview.fit')} hint={k('F')} active={p.zoom === 'actual'} onClick={p.onZoom} />
      <StudioIconButton icon="point" label={t('panel.videoStudio.preview.point')} hint={k('P')} active={p.interaction === 'point'}
        onClick={() => p.onInteraction(p.interaction === 'point' ? 'none' : 'point')} />
      <StudioIconButton icon="note" label={t('panel.videoStudio.preview.note')} hint={k('N')} active={p.interaction === 'note'}
        onClick={() => p.onInteraction(p.interaction === 'note' ? 'none' : 'note')} />
      {/* 오른쪽 끝 — 줄이 접혀 아랫줄로 내려가도 오른쪽에 선다(빈칸 늘이기 대신 왼쪽 여백 auto). */}
      <span className="ml-auto flex shrink-0">
        <StudioIconButton icon="precision" label={t('panel.videoStudio.precision.toggle')} text={narrow ? undefined : t('panel.videoStudio.precision.toggle')} active={p.precisionOpen} onClick={p.onPrecision} />
      </span>
    </div>
  );
}
