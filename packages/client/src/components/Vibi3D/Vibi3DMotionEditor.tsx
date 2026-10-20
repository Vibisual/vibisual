import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DMotionKey, Vibi3DNode, Vibi3DVec3 } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';
import { vibi3dLabelKey } from './vibi3dLabels.js';

const button = 'shrink-0 whitespace-nowrap rounded border border-white/10 bg-gray-800 px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:py-2';
const input = 'min-w-0 w-full rounded border border-white/10 bg-gray-950 px-1 py-1 text-xs pointer-coarse:py-2';
const field = 'flex min-w-0 items-center gap-1 text-xs text-gray-400';
const CHANNELS = ['position', 'rotation', 'scale'] as const;

/** Keys sorted by time; null when two keys share a time (the motion would be ambiguous). */
export function orderedKeys<T extends { time: number }>(keys: T[]): T[] | null {
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  return sorted.every((key, index) => index === 0 || key.time > sorted[index - 1]!.time) ? sorted : null;
}

/**
 * §5.13 (R-10) — named motions of one object: several keys, each moving, turning and scaling; existing motions open
 * again for editing (renaming replaces the old clip) or removal.
 */
export function Vibi3DMotionEditor({ node, disabled, onCommand }: { node: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation();
  const label = (key: string): string => t(vibi3dLabelKey(key));
  const motions = node.motions ?? [];
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [keys, setKeys] = useState<Vibi3DMotionKey[]>([]);
  const [problem, setProblem] = useState('');
  const open = (motion: string): void => {
    const found = motions.find((item) => item.name === motion);
    setEditing(found ? found.name : '');
    setName(found ? found.name : label('motionDefaultName'));
    setKeys(found ? structuredClone(found.keys) : []);
    setProblem('');
  };
  // Another object (or a reopened source) starts from its own motions.
  useEffect(() => { open(''); }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pose = (time: number): Vibi3DMotionKey => ({ time, position: [...node.position], rotation: [...node.rotation], scale: [...node.scale] });
  const change = (index: number, patch: Partial<Vibi3DMotionKey>): void => setKeys((previous) => previous.map((key, i) => i === index ? { ...key, ...patch } : key));
  const save = (): void => {
    const ordered = orderedKeys(keys);
    const title = name.trim();
    if (!ordered) { setProblem(label('motionTimesUnique')); return; }
    if (!title) { setProblem(label('motionNameRequired')); return; }
    setProblem('');
    onCommand({ type: 'motion', id: node.id, name: title, keys: ordered, ...(editing && editing !== title ? { previousName: editing } : {}) });
    setEditing(title);
  };
  return <fieldset className="space-y-1"><legend>{label('motionTitle')}</legend>
    <select className={input} value={editing} disabled={disabled} aria-label={label('motionTitle')} onChange={(event) => open(event.target.value)}>
      <option value="">{label('motionNew')}</option>
      {motions.map((motion) => <option key={motion.name} value={motion.name}>{motion.name}</option>)}
    </select>
    <label className={field}><span className="w-20 shrink-0">{label('motionName')}</span>
      <input className={input} value={name} maxLength={200} disabled={disabled} aria-label={label('motionName')} onChange={(event) => setName(event.target.value)} /></label>
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
      {CHANNELS.map((channel) => key[channel] && <div key={channel} className="grid grid-cols-3 gap-1" aria-label={label(`channel_${channel}`)}>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={`${label('motionKey')} ${index + 1} ${label(`channel_${channel}`)} ${axis}`}
          caption={axis} className={field} inputClassName={input} disabled={disabled} min={-10000} max={10000} value={key[channel]![i]!}
          onCommit={(value) => {
            if (channel === 'scale' && value === 0) return;
            change(index, { [channel]: key[channel]!.map((item, j) => j === i ? value : item) as Vibi3DVec3 });
          }} />)}
      </div>)}
    </div>)}
    <div className="flex flex-wrap gap-1">
      <button type="button" className={button} disabled={disabled || keys.length >= 256}
        onClick={() => setKeys((previous) => [...previous, pose(previous.length ? Math.max(...previous.map((item) => item.time)) + 1 : 0)])}>{label('addKey')}</button>
      <button type="button" className={button} disabled={disabled || keys.length < 2} onClick={save}>{label('addMotion')}</button>
      {editing && <button type="button" className={button} disabled={disabled}
        onClick={() => { onCommand({ type: 'motionRemove', id: node.id, name: editing }); open(''); }}>{label('removeMotion')}</button>}
    </div>
    {keys.length < 2 && <p className="text-gray-500">{label('motionHint')}</p>}
    {problem && <p role="alert" className="text-amber-300">{problem}</p>}
  </fieldset>;
}
