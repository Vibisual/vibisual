import { useTranslation } from 'react-i18next';
import {
  KEYFRAME_EASES,
  KEYFRAME_PROPS,
  VIDEO_LOOKS,
  isVideoLookName,
  punchInKeyframes,
  sampleKeyframes,
  slowPushKeyframes,
  sortedKeyframes,
  type KeyframeEase,
  type VideoEffect,
  type VideoItem,
  type VideoKeyframe,
} from '@vibisual/video';

import { StudioNumberField, STUDIO_INPUT_CLASS } from './StudioField.js';
import { StudioIcon } from './studioIcons.js';

/**
 * §5.13 (W) 38-4·38-5 — 인스펙터의 **'움직임'**(상자 키프레임)과 **'색·효과'** 칸. 모든 편집은 문서 연산(`updateItem`)이라
 * 되돌리기·저장·충돌이 다른 칸과 같은 길이다. 계산(보간·프리셋·필터)은 순수 층(`@vibisual/video`)이 하고 여기서는 값만 고친다.
 */

// 높이는 바닥만 둔다(`min-h-7`) — 256px 인스펙터에서 긴 번역이 두 줄이 되면 단추가 늘어난다(고정 높이면 글자가 넘쳤다). 터치에서는 36px.
const BUTTON = 'flex min-h-7 flex-1 items-center justify-center gap-1 rounded-md border border-white/10 px-2 py-1 text-center text-[12px] leading-tight text-slate-200 hover:bg-white/10 disabled:opacity-40 pointer-coarse:min-h-9';

function round3(n: number): number {
  return Math.round(n * 1000) / 1000 || 0;
}

export interface VideoInspectorMotionProps {
  readonly item: VideoItem;
  /** 재생 머리(문서 시각). 아이템 안 시각으로 바꿔 쓴다. */
  readonly playhead: number;
  /** 이 아이템이 풀린 시작·길이(초). */
  readonly start: number;
  readonly duration: number;
  readonly disabled?: boolean;
  readonly onUpdate: (patch: Partial<Omit<VideoItem, 'id'>>) => void;
}

/** §5.13 (W) 38-4 — 상자의 시간 곡선: [강조 줌] · [천천히 밀기] · 재생 머리에 키프레임 · 목록(값·곡선·지우기). */
export function VideoInspectorMotion({ item, playhead, start, duration, disabled, onUpdate }: VideoInspectorMotionProps): React.JSX.Element {
  const { t } = useTranslation();
  const keyframes = sortedKeyframes(item.keyframes);
  const local = Math.max(0, Math.min(duration, playhead - start));
  const write = (next: readonly VideoKeyframe[]): void => { if (!disabled) onUpdate({ keyframes: next.map((k) => ({ ...k })) }); };
  const replace = (index: number, patch: Partial<VideoKeyframe>): void => write(keyframes.map((k, i) => (i === index ? { ...k, ...patch } : k)));
  const addAtPlayhead = (): void => {
    const at = sampleKeyframes(keyframes, local);
    const used = KEYFRAME_PROPS.filter((p) => keyframes.some((k) => typeof k[p] === 'number'));
    const props = used.length > 0 ? used : (['scale'] as const);
    const key: Record<string, number> = { t: round3(local) };
    for (const p of props) key[p] = round3(at[p]);
    write([...keyframes.filter((k) => Math.abs(k.t - local) > 1e-3), key as unknown as VideoKeyframe].sort((a, b) => a.t - b.t));
  };
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.plan.brief', { defaultValue: 'Motion' })}</h3>
      <div className="flex gap-1.5">
        <button type="button" disabled={disabled || duration <= 0} onClick={() => write(punchInKeyframes(keyframes, local, duration))} className={BUTTON}
          title={t('panel.videoStudio.motion.punchInHint', { defaultValue: 'Zoom in at the playhead for a moment, hold, then return' })}>
          <StudioIcon name="zoomIn" className="h-3.5 w-3.5" />{t('panel.videoStudio.motion.punchIn', { defaultValue: 'Punch-in zoom' })}
        </button>
        <button type="button" disabled={disabled || duration <= 0} onClick={() => write(slowPushKeyframes(keyframes, duration))} className={BUTTON}
          title={t('panel.videoStudio.motion.slowPushHint', { defaultValue: 'Slowly zoom in over the whole clip' })}>
          <StudioIcon name="push" className="h-3.5 w-3.5" />{t('panel.videoStudio.motion.slowPush', { defaultValue: 'Slow push' })}
        </button>
      </div>
      <button type="button" disabled={disabled} onClick={addAtPlayhead} className={`${BUTTON} w-full`}>
        <StudioIcon name="plus" className="h-3.5 w-3.5" />{t('panel.videoStudio.motion.addKey', { defaultValue: 'Keyframe at {{time}} s', time: local.toFixed(2) })}
      </button>
      {keyframes.length === 0 ? <p className="text-xs text-white/40">{t('panel.videoStudio.motion.empty', { defaultValue: 'No keyframes — the box stays still.' })}</p> : null}
      {keyframes.map((k, index) => (
        <div key={`${index}:${k.t}`} className="space-y-2 rounded-md border border-white/10 p-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] font-semibold text-white/70">{t('panel.videoStudio.motion.keyLabel', { defaultValue: 'Keyframe {{n}}', n: index + 1 })}</span>
            <button type="button" disabled={disabled} onClick={() => write(keyframes.filter((_, i) => i !== index))}
              aria-label={t('panel.videoStudio.motion.remove', { defaultValue: 'Remove this keyframe' })} title={t('panel.videoStudio.motion.remove', { defaultValue: 'Remove this keyframe' })}
              className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:p-2"><StudioIcon name="trash" className="h-3.5 w-3.5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StudioNumberField label={t('panel.videoStudio.motion.time', { defaultValue: 'Time (s)' })} value={k.t} min={0} max={Math.max(0, duration)} disabled={disabled}
              onCommit={(v) => replace(index, { t: round3(v) })} />
            <StudioNumberField label={t('panel.videoStudio.editor.transformFields.scale', { defaultValue: 'Scale' })} value={k.scale ?? 1} min={0.05} max={10} disabled={disabled}
              onCommit={(v) => replace(index, { scale: v })} />
            <StudioNumberField label={t('panel.videoStudio.motion.dx', { defaultValue: 'Move X (px)' })} value={k.dx ?? 0} disabled={disabled} onCommit={(v) => replace(index, { dx: v })} />
            <StudioNumberField label={t('panel.videoStudio.motion.dy', { defaultValue: 'Move Y (px)' })} value={k.dy ?? 0} disabled={disabled} onCommit={(v) => replace(index, { dy: v })} />
            <StudioNumberField label={t('panel.videoStudio.editor.transformFields.opacity', { defaultValue: 'Opacity' })} value={k.opacity ?? 1} min={0} max={1} disabled={disabled}
              onCommit={(v) => replace(index, { opacity: v })} />
            <StudioNumberField label={t('panel.videoStudio.editor.transformFields.rotation', { defaultValue: 'Rotation (°)' })} value={k.rotation ?? 0} disabled={disabled} onCommit={(v) => replace(index, { rotation: v })} />
          </div>
          <label className="block space-y-1 text-xs text-white/60">
            <span>{t('panel.videoStudio.motion.ease', { defaultValue: 'Curve' })}</span>
            <select aria-label={t('panel.videoStudio.motion.ease', { defaultValue: 'Curve' })} className={STUDIO_INPUT_CLASS} value={k.ease ?? 'inOut'} disabled={disabled}
              onChange={(event) => {
                const ease = KEYFRAME_EASES.find((e) => e === event.target.value);
                if (ease) replace(index, { ease: ease as KeyframeEase });
              }}>
              {KEYFRAME_EASES.map((ease) => <option key={ease} value={ease}>{t(`panel.videoStudio.motion.ease_${ease}`, { defaultValue: ease })}</option>)}
            </select>
          </label>
        </div>
      ))}
      {keyframes.length > 0 ? (
        <button type="button" disabled={disabled} onClick={() => write([])} className={`${BUTTON} w-full`}>
          <StudioIcon name="close" className="h-3.5 w-3.5" />{t('panel.videoStudio.motion.clear', { defaultValue: 'Remove all keyframes' })}
        </button>
      ) : null}
    </section>
  );
}

export interface VideoInspectorEffectsProps {
  readonly item: VideoItem;
  readonly disabled?: boolean;
  readonly onUpdate: (patch: Partial<Omit<VideoItem, 'id'>>) => void;
}

function effectOf(effects: readonly VideoEffect[], kind: string): VideoEffect | undefined {
  return effects.find((e) => e.kind === kind);
}

function numParam(effect: VideoEffect | undefined, key: string, fallback: number): number {
  const v = effect?.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** §5.13 (W) 38-5 — 룩 · 밝기 · 대비 · 채도 · 색온도 · 색상 회전 · 흐림 · 비네트(모르는 이펙트 종류는 건드리지 않고 남긴다). */
export function VideoInspectorEffects({ item, disabled, onUpdate }: VideoInspectorEffectsProps): React.JSX.Element {
  const { t } = useTranslation();
  const effects = item.effects ?? [];
  const lookRaw = effectOf(effects, 'look')?.params?.['name'];
  const look = isVideoLookName(lookRaw) ? lookRaw : '';
  const color = effectOf(effects, 'color');
  const write = (kind: string, params: Readonly<Record<string, unknown>> | null): void => {
    if (disabled) return;
    const rest = effects.filter((e) => e.kind !== kind);
    onUpdate({ effects: params ? [...rest, { id: `fx-${kind}`, kind, params }] : rest });
  };
  const setColor = (key: string, value: number, neutral: number): void => {
    const next: Record<string, unknown> = { ...(color?.params ?? {}) };
    if (Math.abs(value - neutral) < 1e-6) delete next[key];
    else next[key] = value;
    write('color', Object.keys(next).length > 0 ? next : null);
  };
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-white/80"><StudioIcon name="palette" className="h-3.5 w-3.5" />{t('panel.videoStudio.effects.title', { defaultValue: 'Color & effects' })}</h3>
      <label className="block space-y-1 text-xs text-white/60">
        <span>{t('panel.videoStudio.effects.look', { defaultValue: 'Look' })}</span>
        <select aria-label={t('panel.videoStudio.effects.look', { defaultValue: 'Look' })} className={STUDIO_INPUT_CLASS} value={look} disabled={disabled}
          onChange={(event) => { const name = event.target.value; write('look', isVideoLookName(name) ? { name } : null); }}>
          <option value="">{t('panel.videoStudio.editor.options.none', { defaultValue: 'None' })}</option>
          {Object.keys(VIDEO_LOOKS).map((name) => <option key={name} value={name}>{t(`panel.videoStudio.effects.look_${name}`, { defaultValue: name })}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <StudioNumberField label={t('panel.videoStudio.effects.brightness', { defaultValue: 'Brightness' })} value={numParam(color, 'brightness', 1)} min={0} max={4} disabled={disabled}
          onCommit={(v) => setColor('brightness', v, 1)} />
        <StudioNumberField label={t('panel.videoStudio.effects.contrast', { defaultValue: 'Contrast' })} value={numParam(color, 'contrast', 1)} min={0} max={4} disabled={disabled}
          onCommit={(v) => setColor('contrast', v, 1)} />
        <StudioNumberField label={t('panel.videoStudio.effects.saturation', { defaultValue: 'Saturation' })} value={numParam(color, 'saturation', 1)} min={0} max={4} disabled={disabled}
          onCommit={(v) => setColor('saturation', v, 1)} />
        <StudioNumberField label={t('panel.videoStudio.effects.temperature', { defaultValue: 'Color temperature' })} value={numParam(color, 'temperature', 0)} min={-1} max={1} disabled={disabled}
          onCommit={(v) => setColor('temperature', v, 0)} />
        <StudioNumberField label={t('panel.videoStudio.effects.hue', { defaultValue: 'Hue shift (°)' })} value={numParam(color, 'hue', 0)} min={-180} max={180} disabled={disabled}
          onCommit={(v) => setColor('hue', v, 0)} />
        <StudioNumberField label={t('panel.videoStudio.effects.blur', { defaultValue: 'Blur (px)' })} value={numParam(effectOf(effects, 'blur'), 'radius', 0)} min={0} max={200} disabled={disabled}
          onCommit={(v) => write('blur', v > 0 ? { radius: v } : null)} />
        <StudioNumberField label={t('panel.videoStudio.effects.vignette', { defaultValue: 'Vignette' })} value={numParam(effectOf(effects, 'vignette'), 'amount', 0)} min={0} max={1} disabled={disabled}
          onCommit={(v) => write('vignette', v > 0 ? { amount: v } : null)} />
      </div>
      {effects.length > 0 ? (
        <button type="button" disabled={disabled} onClick={() => onUpdate({ effects: effects.filter((e) => !['look', 'color', 'blur', 'vignette'].includes(e.kind)) })}
          className={`${BUTTON} w-full`}>
          <StudioIcon name="restore" className="h-3.5 w-3.5" />{t('panel.videoStudio.effects.reset', { defaultValue: 'Reset color and effects' })}
        </button>
      ) : null}
    </section>
  );
}
