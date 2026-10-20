import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VIBI3D_BUILTIN_KITS, type Vibi3DBuiltinModule, type Vibi3DSnapshot, type Vibi3DVec3 } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:min-h-8';
const button = 'rounded border border-vb-code-border px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:min-h-8';
const freshId = (): string => crypto.randomUUID();

export function Vibi3DKitPanel({ snapshot, disabled, onCommand }: { snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation(), label = (key: string): string => t(`panel.vibi3d.kit.${key}`);
  const [builtin, setBuiltin] = useState<Vibi3DBuiltinModule>(VIBI3D_BUILTIN_KITS[0]);
  const [moduleId, setModuleId] = useState(''), [name, setName] = useState('');
  const [counts, setCounts] = useState<Vibi3DVec3>([3, 1, 1]), [step, setStep] = useState<Vibi3DVec3>([2, 0, 0]);
  const [snap, setSnap] = useState(0.25 as false | number);
  const modules = snapshot.kitModules ?? [], module = modules.find(value => value.id === moduleId) ?? modules[0];
  const selected = snapshot.nodes.find(node => node.id === snapshot.selectedId);
  const canDefine = !!selected?.parentId && !selected.instance;
  const edit = disabled || !!selected?.locked;
  const define = (fromBuiltin: boolean): void => {
    const id = freshId(); setModuleId(id);
    onCommand({ type: 'kitModule', id, ...(name.trim() ? { name: name.trim() } : {}), ...(fromBuiltin ? { builtin } : { sourceId: selected!.id }) });
  };
  const updateVector = (previous: Vibi3DVec3, axis: number, value: number): Vibi3DVec3 => previous.map((entry, index) => index === axis ? value : entry) as Vibi3DVec3;
  const invalidGrid = counts.reduce((total, value) => total * value, 1) > 10000 || counts.some((value, index) => value > 1 && step[index] === 0);
  return <section className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg" aria-label={label('title')}>
    <h3 className="font-medium">{label('title')}</h3>
    <label className="flex min-w-0 items-center gap-2"><span>{label('name')}</span><input className={input} value={name} maxLength={200} disabled={disabled} aria-label={label('name')} onChange={event => setName(event.target.value)} /></label>
    <select className={input} value={builtin} disabled={disabled} aria-label={label('builtin')} onChange={event => setBuiltin(event.target.value as Vibi3DBuiltinModule)}>
      {VIBI3D_BUILTIN_KITS.map(value => <option key={value} value={value}>{label(`builtin_${value.replaceAll('/', '_')}`)}</option>)}
    </select>
    <div className="flex min-w-0 flex-wrap gap-1"><button className={button} disabled={disabled} type="button" onClick={() => define(true)}>{label('addBuiltin')}</button>
      <button className={button} disabled={disabled || !canDefine} type="button" onClick={() => define(false)}>{label('defineSelection')}</button></div>
    {modules.length ? <>
      <select className={input} aria-label={label('module')} disabled={disabled} value={module?.id ?? ''} onChange={event => setModuleId(event.target.value)}>
        {modules.map(value => <option key={value.id} value={value.id}>{value.name} · {label('revision')} {value.revision} · {value.instances ?? 0}</option>)}
      </select>
      <div className="flex min-w-0 flex-wrap gap-1">
        <button className={button} disabled={disabled || !module} type="button" onClick={() => module && onCommand({ type: 'place', id: freshId(), moduleId: module.id, expectedModuleRevision: module.revision, snap })}>{label('place')}</button>
        <button className={button} disabled={edit || !module || !selected?.instance} type="button" onClick={() => module && selected?.instance && onCommand({ type: 'place', id: selected.id, moduleId: module.id, expectedModuleRevision: module.revision, snap })}>{label('replace')}</button>
        <button className={button} disabled={disabled || !module || !canDefine} type="button" onClick={() => module && selected && onCommand({ type: 'kitModule', id: module.id, sourceId: selected.id, expectedModuleRevision: module.revision, ...(name.trim() ? { name: name.trim() } : {}) })}>{label('updateModule')}</button>
      </div>
      <label className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-8"><input type="checkbox" disabled={disabled} checked={snap !== false} aria-label={label('snap')} onChange={event => setSnap(event.target.checked ? 0.25 : false)} />{label('snap')}</label>
      {snap !== false && <NumberField label={label('gridSize')} caption={label('gridSize')} value={snap} min={0.001} max={100} disabled={disabled} inputClassName={input} onCommit={setSnap} />}
      <details className="min-w-0 space-y-2"><summary className="cursor-pointer pointer-coarse:min-h-8">{label('array')}</summary>
        <span>{label('counts')}</span><div className="grid grid-cols-3 gap-1 box-compact:grid-cols-1">{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={`${label('counts')} ${axis}`} caption={axis} value={counts[index]!} min={1} max={10000} disabled={disabled} inputClassName={input} onCommit={value => setCounts(previous => updateVector(previous, index, Math.round(value)))} />)}</div>
        <span>{label('step')}</span><div className="grid grid-cols-3 gap-1 box-compact:grid-cols-1">{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={`${label('step')} ${axis}`} caption={axis} value={step[index]!} min={-10000} max={10000} disabled={disabled} inputClassName={input} onCommit={value => setStep(previous => updateVector(previous, index, value))} />)}</div>
        <button className={button} type="button" disabled={disabled || !module || invalidGrid} onClick={() => module && onCommand({ type: 'array', id: freshId(), moduleId: module.id, expectedModuleRevision: module.revision, counts, step, snap })}>{label('addArray')}</button>
        {invalidGrid && <p role="status" className="text-vb-status-warning">{label('gridInvalid')}</p>}
      </details>
      <p className="opacity-70">{label('updateHint')}</p>
    </> : <p className="opacity-70">{label('empty')}</p>}
  </section>;
}
