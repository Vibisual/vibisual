import { useTranslation } from 'react-i18next';
import { resolveVibi3DLook, type Vibi3DLook, type Vibi3DSnapshot } from '@vibisual/shared';
import { ColorField } from '../Creation/ColorField.js';
import { useColorMerge, type AuthoringCommand } from './Vibi3DAuthoring.js';

const field = 'flex min-w-0 flex-col gap-1 text-xs text-vb-code-fg';
const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-2 py-1.5 text-xs text-vb-code-fg disabled:opacity-40 pointer-coarse:py-2';

/** One scene-look control surface; the historical lighting command remains a protocol alias. */
export function Vibi3DLookPanel({ snapshot, disabled, onCommand }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand;
}): React.JSX.Element {
  const { t } = useTranslation(); const merge = useColorMerge();
  const look = resolveVibi3DLook(snapshot.look, snapshot.lighting ?? 1);
  const label = (key: string): string => t(`panel.vibi3d.look.${key}`);
  const change = (patch: Vibi3DLook, key?: string): void => onCommand({ type: 'look', ...patch }, key ? { merge: key } : undefined);
  const slider = (key: string, value: number, min: number, max: number, step: number, patch: (value: number) => Vibi3DLook): React.JSX.Element =>
    <label key={key} className={field}><span className="flex min-w-0 justify-between gap-2"><span className="truncate">{label(key)}</span><output className="shrink-0 tabular-nums">{Number(value.toFixed(3))}</output></span>
      <input aria-label={label(key)} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        className="w-full accent-vb-find disabled:opacity-40 pointer-coarse:min-h-8"
        onChange={(event) => change(patch(Number(event.target.value)), merge(`look:${key}`, 'preview'))}
        onPointerUp={() => merge(`look:${key}`, 'commit')} onKeyUp={() => merge(`look:${key}`, 'commit')} onBlur={() => merge(`look:${key}`, 'commit')} />
    </label>;
  const toggle = (key: string, checked: boolean, patch: (value: boolean) => Vibi3DLook): React.JSX.Element =>
    <label className="flex min-w-0 items-center gap-2 text-xs text-vb-code-fg pointer-coarse:min-h-8"><input type="checkbox" aria-label={label(key)} checked={checked} disabled={disabled}
      onChange={(event) => change(patch(event.target.checked))} /><span className="truncate">{label(key)}</span></label>;
  const color = (key: string, value: string, patch: (value: string) => Vibi3DLook): React.JSX.Element =>
    <label className="flex min-w-0 items-center justify-between gap-2 text-xs text-vb-code-fg"><span className="truncate">{label(key)}</span>
      <ColorField label={label(key)} value={value} disabled={disabled} onChange={(value, phase) => change(patch(value), merge(`look:${key}`, phase))} /></label>;
  return <details open className="mt-5 min-w-0 border-t border-vb-code-border pt-3 text-xs">
    <summary className="cursor-pointer font-medium text-vb-code-fg pointer-coarse:py-2">{label('title')}</summary>
    <div className="mt-3 min-w-0 space-y-3">
      <label className={field}>{label('preset')}
        <select className={input} aria-label={label('preset')} value={look.preset} disabled={disabled} onChange={(event) => change({ preset: event.target.value as Vibi3DLook['preset'] })}>
          {(['studio', 'daylight', 'sunset', 'overcast', 'night-street'] as const).map((preset) => <option key={preset} value={preset}>{label(`preset_${preset}`)}</option>)}
        </select></label>
      {slider('intensity', look.intensity, 0, 10, 0.1, (intensity) => ({ intensity }))}
      {slider('exposure', look.exposure, 0, 10, 0.05, (exposure) => ({ exposure }))}
      <label className={field}>{label('toneMapping')}
        <select className={input} aria-label={label('toneMapping')} value={look.toneMapping} disabled={disabled} onChange={(event) => change({ toneMapping: event.target.value as Vibi3DLook['toneMapping'] })}>
          {(['none', 'aces', 'agx', 'neutral'] as const).map((tone) => <option key={tone} value={tone}>{label(`tone_${tone}`)}</option>)}
        </select></label>
      <details className="min-w-0"><summary className="cursor-pointer text-vb-code-fg pointer-coarse:py-2">{label('sun')}</summary><div className="mt-2 space-y-3">
        {slider('azimuth', look.sun.azimuth, -360, 360, 1, (azimuth) => ({ sun: { azimuth } }))}
        {slider('elevation', look.sun.elevation, -90, 90, 1, (elevation) => ({ sun: { elevation } }))}
        {slider('sunIntensity', look.sun.intensity, 0, 100, 0.1, (intensity) => ({ sun: { intensity } }))}
        {color('sunColor', look.sun.color, (color) => ({ sun: { color } }))}
      </div></details>
      {toggle('shadows', look.shadows.enabled, (enabled) => ({ shadows: { enabled } }))}
      <details className="min-w-0"><summary className="cursor-pointer text-vb-code-fg pointer-coarse:py-2">{label('effects')}</summary><div className="mt-2 space-y-3">
        {toggle('ao', look.ao.enabled, (enabled) => ({ ao: { enabled } }))}
        {slider('aoIntensity', look.ao.intensity, 0, 5, 0.1, (intensity) => ({ ao: { intensity } }))}
        {slider('aoRadius', look.ao.radius, 0.01, 10, 0.01, (radius) => ({ ao: { radius } }))}
        {toggle('bloom', look.bloom.enabled, (enabled) => ({ bloom: { enabled } }))}
        {slider('bloomStrength', look.bloom.strength, 0, 5, 0.1, (strength) => ({ bloom: { strength } }))}
        {slider('bloomThreshold', look.bloom.threshold, 0, 10, 0.1, (threshold) => ({ bloom: { threshold } }))}
        {slider('bloomRadius', look.bloom.radius, 0, 1, 0.05, (radius) => ({ bloom: { radius } }))}
        {toggle('fog', look.fog.enabled, (enabled) => ({ fog: { enabled } }))}
        {slider('fogDensity', look.fog.density, 0, 0.1, 0.001, (density) => ({ fog: { density } }))}
        {color('fogColor', look.fog.color, (color) => ({ fog: { color } }))}
      </div></details>
      <label className={field}>{label('quality')}
        <select className={input} aria-label={label('quality')} value={look.quality} disabled={disabled} onChange={(event) => change({ quality: event.target.value as Vibi3DLook['quality'] })}>
          {(['auto', 'draft', 'final'] as const).map((quality) => <option key={quality} value={quality}>{label(`quality_${quality}`)}</option>)}
        </select></label>
    </div>
  </details>;
}
