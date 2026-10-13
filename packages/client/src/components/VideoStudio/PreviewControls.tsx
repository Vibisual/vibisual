import { useTranslation } from 'react-i18next';

import { shortcutLabel } from '../../utils/platform.js';
import { StudioIconButton } from './StudioIconButton.js';

/**
 * §5.13 (V) 37-1 — 미리보기 조작 줄(글자 단추 대신 아이콘 — 툴팁에 단축키): 재생 `Space` · 한 프레임 `←`/`→` · 반복 `L` ·
 * 안전 영역 `G` · 맞춤/100% `F` · 가리키기 `P` · 메모 `N`. 오른쪽 끝에 [정밀 편집](트랙 타임라인을 아래에서 올린다).
 * 시간은 `tabular-nums`(`00:12.04`).
 */
export interface PreviewControlsProps {
  readonly playing: boolean;
  readonly playhead: number;
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
}

/** `00:12.04` — 분:초.백분의일초. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

export function PreviewControls(p: PreviewControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const k = (key: string): string => shortcutLabel(key);
  const empty = p.duration <= 0;
  return (
    <div className="flex shrink-0 items-center gap-1 px-1">
      <StudioIconButton icon="prev" label={t('panel.videoStudio.preview.prevFrame')} hint={`${k('Left')} · ${k('Shift+Left')}`} disabled={empty} onClick={() => p.onStep(-1)} />
      <StudioIconButton icon={p.playing ? 'pause' : 'play'} label={p.playing ? t('panel.videoStudio.pause') : t('panel.videoStudio.play')} hint={k('Space')} disabled={empty || p.disabled} onClick={p.onPlay} />
      <StudioIconButton icon="next" label={t('panel.videoStudio.preview.nextFrame')} hint={`${k('Right')} · ${k('Shift+Right')}`} disabled={empty} onClick={() => p.onStep(1)} />
      <span className="mx-2 shrink-0 text-[13px] tabular-nums text-slate-300">
        {formatClock(p.playhead)}<span className="text-slate-500"> / {formatClock(p.duration)}</span>
      </span>
      <StudioIconButton icon="loop" label={t('panel.videoStudio.editor.loop')} hint={k('L')} active={p.loop} onClick={p.onLoop} />
      <span className="mx-1 h-4 border-l border-white/10" aria-hidden="true" />
      <StudioIconButton icon="safe" label={t('panel.videoStudio.preview.safeArea')} hint={k('G')} active={p.safeArea} onClick={p.onSafeArea} />
      <StudioIconButton icon="fit" label={p.zoom === 'fit' ? t('panel.videoStudio.preview.actualSize') : t('panel.videoStudio.preview.fit')} hint={k('F')} active={p.zoom === 'actual'} onClick={p.onZoom} />
      <StudioIconButton icon="point" label={t('panel.videoStudio.preview.point')} hint={k('P')} active={p.interaction === 'point'}
        onClick={() => p.onInteraction(p.interaction === 'point' ? 'none' : 'point')} />
      <StudioIconButton icon="note" label={t('panel.videoStudio.preview.note')} hint={k('N')} active={p.interaction === 'note'}
        onClick={() => p.onInteraction(p.interaction === 'note' ? 'none' : 'note')} />
      <span className="flex-1" />
      <StudioIconButton icon="precision" label={t('panel.videoStudio.precision.toggle')} text={t('panel.videoStudio.precision.toggle')} active={p.precisionOpen} onClick={p.onPrecision} />
    </div>
  );
}
