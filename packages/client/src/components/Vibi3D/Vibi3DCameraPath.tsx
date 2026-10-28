import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DCameraKey, Vibi3DSnapshot, Vibi3DVec3 } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';
import { orderedKeys } from './Vibi3DMotionEditor.js';
import { vibi3dLabelKey } from './vibi3dLabels.js';

export type ViewReader = () => { position: Vibi3DVec3; target: Vibi3DVec3 } | null;
const button = 'shrink-0 whitespace-nowrap rounded border border-white/10 bg-gray-800 px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:py-2';
const input = 'min-w-0 w-full rounded border border-white/10 bg-gray-950 px-1 py-1 text-xs pointer-coarse:py-2';
const field = 'flex min-w-0 items-center gap-1 text-xs text-gray-400';

/**
 * §5.13 (R-10) — the view camera's keyframed path (keys from the current view — position + target; times and values editable).
 * Videos and stills use it unless their camera is overridden.
 */
export function Vibi3DCameraPath({ snapshot, disabled, onCommand, onCamera, readView }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand; onCamera?: () => void; readView?: ViewReader;
}): React.JSX.Element {
  const { t } = useTranslation();
  const label = (key: string): string => t(vibi3dLabelKey(key));
  const saved = snapshot.cameraMotion;
  const savedKey = JSON.stringify(saved ?? null);
  const [name, setName] = useState(saved?.name ?? '');
  const [keys, setKeys] = useState<Vibi3DCameraKey[]>(saved?.keys ?? []);
  const [problem, setProblem] = useState('');
  useEffect(() => { setName(saved?.name ?? label('cameraPathDefaultName')); setKeys(structuredClone(saved?.keys ?? [])); setProblem(''); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (index: number, patch: Partial<Vibi3DCameraKey>): void => setKeys((previous) => previous.map((key, i) => i === index ? { ...key, ...patch } : key));
  const addFromView = (): void => {
    const view = readView?.();
    if (!view) return;
    setKeys((previous) => [...previous, { time: previous.length ? Math.max(...previous.map((item) => item.time)) + 1 : 0, ...view }]);
  };
  const save = (): void => {
    const ordered = orderedKeys(keys);
    if (!ordered) { setProblem(label('motionTimesUnique')); return; }
    if (ordered.some((key) => key.position.every((n, i) => n === key.target[i]))) { setProblem(label('cameraKeyInvalid')); return; }
    setProblem('');
    onCommand({ type: 'cameraMotion', name: name.trim() || label('cameraPathDefaultName'), keys: ordered });
  };
  const vector = (index: number, part: 'position' | 'target', key: Vibi3DCameraKey): React.JSX.Element => <div className="grid grid-cols-3 gap-1" aria-label={label(part === 'position' ? 'cameraPosition' : 'cameraTarget')}>
    {(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={`${label('motionKey')} ${index + 1} ${label(part === 'position' ? 'cameraPosition' : 'cameraTarget')} ${axis}`}
      caption={axis} className={field} inputClassName={input} disabled={disabled} min={-10000} max={10000} value={key[part][i]!}
      onCommit={(value) => change(index, { [part]: key[part].map((item, j) => j === i ? value : item) as Vibi3DVec3 })} />)}
  </div>;
  return <fieldset className="space-y-1"><legend>{label('cameraPath')}</legend>
    {onCamera && <button type="button" className={button} disabled={disabled} onClick={onCamera}>{label('camera')}</button>}
    <label className={field}><span className="w-20 shrink-0">{label('motionName')}</span>
      <input className={input} value={name} maxLength={200} disabled={disabled} aria-label={label('cameraPath')} onChange={(event) => setName(event.target.value)} /></label>
    {keys.map((key, index) => <div key={index} className="space-y-1 rounded border border-white/10 p-1">
      <div className="flex items-center gap-1">
        <NumberField label={`${label('motionKey')} ${index + 1} · ${label('seconds')}`} caption={label('seconds')} className={field} inputClassName={input}
          min={0} max={10000} value={key.time} disabled={disabled} onCommit={(time) => change(index, { time })} />
        <button type="button" className={button} disabled={disabled} aria-label={label('removeKey')} title={label('removeKey')}
          onClick={() => setKeys((previous) => previous.filter((_, i) => i !== index))}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {vector(index, 'position', key)}
      {vector(index, 'target', key)}
    </div>)}
    <div className="flex flex-wrap gap-1">
      <button type="button" className={button} disabled={disabled || !readView || keys.length >= 256} onClick={addFromView}>{label('addCameraKey')}</button>
      <button type="button" className={button} disabled={disabled || keys.length < 2} onClick={save}>{label('saveCameraPath')}</button>
    </div>
    {keys.length < 2 && <p className="text-gray-500">{label('cameraPathHint')}</p>}
    {problem && <p role="alert" className="text-amber-300">{problem}</p>}
  </fieldset>;
}
