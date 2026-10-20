import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DCameraAspect, Vibi3DSnapshot } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';
import type { ViewReader } from './Vibi3DCameraPath.js';

const input = 'w-full min-w-0 rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
const button = 'rounded border border-vb-code-border px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:py-2';
export interface Vibi3DShotActions { onStills: (ids: string[]) => void; onVideo: (ids: string[], motion: boolean) => void }
export function Vibi3DShotPanel({ snapshot, disabled, onCommand, readView, actions }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand; readView?: ViewReader; actions?: Vibi3DShotActions;
}): React.JSX.Element {
  const { t } = useTranslation(), label = (key: string): string => t(`panel.vibi3d.shots.${key}`);
  const [name, setName] = useState(''), [lens, setLens] = useState(24), [aspect, setAspect] = useState<Vibi3DCameraAspect>('9:16');
  const shots = snapshot.shots ?? [], view = snapshot.camera;
  useEffect(() => {
    if (!view) return;
    const ratio = view.aspect === '16:9' ? 16 / 9 : 1;
    setLens(view.lens ?? Math.round(35 / ratio / (2 * Math.tan((view.fov ?? 45) * Math.PI / 360)) * 100) / 100);
    setAspect(view.aspect ?? '9:16');
  }, [view?.lens, view?.fov, view?.aspect]);
  const useView = (): ReturnType<ViewReader> => readView?.() ?? view ?? null;
  const applyOptics = (): void => { const pose = useView(); if (pose) onCommand({ type: 'camera', position: pose.position, target: pose.target, lens, aspect }); };
  const add = (): void => {
    const pose = useView(); if (!pose || !name.trim()) return;
    onCommand({ type: 'camera', position: pose.position, target: pose.target, lens, aspect, shot: { id: crypto.randomUUID(), name: name.trim() } }); setName('');
  };
  return <details className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg">
    <summary className="cursor-pointer pointer-coarse:py-2">{label('title')}</summary>
    <div className="grid min-w-0 grid-cols-2 gap-2 box-compact:grid-cols-1">
      <NumberField label={label('lens')} caption={label('lens')} value={lens} min={8} max={300} disabled={disabled} inputClassName={input} onCommit={setLens} />
      <label className="min-w-0">{label('aspect')}<select className={input} value={aspect} disabled={disabled} onChange={event => setAspect(event.target.value as Vibi3DCameraAspect)}>
        {(['9:16', '16:9', '1:1'] as const).map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={disabled} onClick={applyOptics}>{label('applyView')}</button>
      <button className={button} disabled={disabled} onClick={() => { const pose = useView(); if (pose) onCommand({ type: 'camera', position: pose.position, target: pose.target, eyeHeight: 1.6 }); }}>{label('eyeHeight')}</button>
    </div>
    <label className="block min-w-0">{label('name')}<input className={input} value={name} maxLength={120} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
    <button className={button} disabled={disabled || !name.trim() || shots.some(shot => shot.name === name.trim()) || shots.length >= 64} onClick={add}>{label('add')}</button>
    <ul className="min-w-0 space-y-2">{shots.map(shot => <li key={shot.id} className="min-w-0 rounded border border-vb-code-border p-2">
      <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate" title={shot.name}>{shot.name}</span><span>{shot.aspect ?? '9:16'}</span></div>
      <div className="mt-1 flex flex-wrap gap-1">
        <button className={button} aria-pressed={snapshot.activeShotId === shot.id} disabled={disabled} onClick={() => onCommand({ type: 'camera', shot: { id: shot.id, name: shot.name } })}>{label('select')}</button>
        <button className={button} disabled={disabled} onClick={() => { const pose = useView(); if (pose) onCommand({ type: 'camera', position: pose.position, target: pose.target, lens, aspect, shot: { id: shot.id, name: shot.name } }); }}>{label('update')}</button>
        {actions && <button className={button} disabled={disabled} onClick={() => actions.onStills([shot.id])}>{label('still')}</button>}
        {actions && <button className={button} disabled={disabled} onClick={() => actions.onVideo([shot.id], false)}>{label('video')}</button>}
        <button className={button} disabled={disabled} onClick={() => onCommand({ type: 'shotRemove', id: shot.id })}>{label('remove')}</button>
      </div>
    </li>)}</ul>
    {actions && <div className="flex flex-wrap gap-2">
      <button className={button} disabled={disabled || !shots.length} onClick={() => actions.onStills(shots.map(shot => shot.id))}>{label('allStills')}</button>
      <button className={button} disabled={disabled || !shots.length} onClick={() => actions.onVideo(shots.map(shot => shot.id), false)}>{label('video')}</button>
      <button className={button} disabled={disabled || !snapshot.cameraMotion} onClick={() => actions.onVideo([], true)}>{label('motionVideo')}</button>
    </div>}
    <p className="opacity-70">{label('outputHint')}</p>
  </details>;
}
