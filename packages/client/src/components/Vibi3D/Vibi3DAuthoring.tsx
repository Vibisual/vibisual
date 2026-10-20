import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VIBI3D_LIGHTS, VIBI3D_SHAPES, type Vibi3DCommand, type Vibi3DLightKind, type Vibi3DNode, type Vibi3DRecipe, type Vibi3DSnapshot,
  type Vibi3DVec3,
} from '@vibisual/shared';
import { ColorField } from '../Creation/ColorField.js';
import { NumberField } from '../Creation/NumberField.js';
import { Vibi3DCameraPath, type ViewReader } from './Vibi3DCameraPath.js';
import { Vibi3DMotionEditor } from './Vibi3DMotionEditor.js';
import { vibi3dLabelKey } from './vibi3dLabels.js';
import { Vibi3DMaterialPanel } from './Vibi3DMaterialPanel.js';
import { GeometryEditor } from './GeometryEditor.js';
import { Vibi3DArchitecturePanel } from './Vibi3DArchitecturePanel.js';
import { Vibi3DKitPanel } from './Vibi3DKitPanel.js';
import { Vibi3DObjectList } from './Vibi3DObjectList.js';
import { Vibi3DSignPanel } from './Vibi3DSignPanel.js';
import { Vibi3DDecalPanel } from './Vibi3DDecalPanel.js';
import { Vibi3DMascotPanel } from './Vibi3DMascotPanel.js';
import { defaultRecipe } from './modelRecipeDefaults.js';
export { defaultRecipe } from './modelRecipeDefaults.js';

export type AuthoringCommand = (command: Vibi3DCommand, options?: { merge?: string }) => void;
// 손가락(pointer: coarse)이면 단추·입력을 32px 이상으로 — 마우스 화면의 촘촘함은 그대로 둔다.
const button = 'shrink-0 whitespace-nowrap rounded border border-white/10 bg-gray-800 px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:py-2';
const input = 'min-w-0 w-full rounded border border-white/10 bg-gray-950 px-1 py-1 text-xs pointer-coarse:py-2';
const field = 'flex min-w-0 items-center gap-1 text-xs text-gray-400';
/** A colour drag is one undo step: previews share a key that the final colour closes. */
export function useColorMerge(): (scope: string, phase: 'preview' | 'commit') => string {
  const [token] = useState(() => ({ open: new Map<string, string>() }));
  return (scope, phase) => {
    let key = token.open.get(scope);
    if (!key) { key = `${scope}:${Date.now()}:${Math.random()}`; token.open.set(scope, key); }
    if (phase === 'commit') token.open.delete(scope);
    return key;
  };
}

function LightFields({ node, disabled, onCommand, label, merge }: {
  node: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand; label: (key: string) => string;
  merge: (scope: string, phase: 'preview' | 'commit') => string;
}): React.JSX.Element {
  const light = node.light!;
  const locked = disabled || !!node.locked;
  return <fieldset className="space-y-1"><legend>{label('light')}</legend>
    <label className={field}><span className="w-20 shrink-0">{label('lightKind')}</span>
      <select className={input} value={light.kind} disabled={locked} aria-label={label('lightKind')}
        onChange={(event) => onCommand({ type: 'light', id: node.id, kind: event.target.value as Vibi3DLightKind })}>
        {VIBI3D_LIGHTS.map((kind) => <option key={kind} value={kind}>{label(`light_${kind}`)}</option>)}
      </select></label>
    <NumberField label={label('intensity')} caption={label('intensity')} className={field} inputClassName={input} disabled={locked}
      min={0} max={100} value={light.intensity} onCommit={(value) => onCommand({ type: 'light', id: node.id, intensity: value })} />
    <label className={`${field} justify-between`}>{label('lightColor')}
      <ColorField label={label('lightColor')} value={light.color} disabled={locked}
        onChange={(value, phase) => onCommand({ type: 'light', id: node.id, color: value }, { merge: merge(`light:${node.id}`, phase) })} /></label>
  </fieldset>;
}

export function Vibi3DAuthoring({ snapshot, disabled, onCommand, onTexture, onCamera, readView, textureConnections }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand;
  onTexture?: (file: File) => void; onCamera?: () => void; readView?: ViewReader; textureConnections?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Vibi3DRecipe['kind']>('box');
  const [lightKind, setLightKind] = useState<Vibi3DLightKind>('point');
  const [members, setMembers] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [offset, setOffset] = useState<Vibi3DVec3>([1.2, 0, 0]);
  const merge = useColorMerge();
  const selected = snapshot.nodes.find((node) => node.id === snapshot.selectedId);
  const label = (key: string): string => t(vibi3dLabelKey(key));
  const locked = disabled || !!selected?.locked;
  return <div className="mt-4 space-y-3 border-t border-white/10 pt-3 text-xs">
    <div className="flex items-center gap-1">
      <select className={`${input} flex-1`} value={kind} disabled={disabled} aria-label={label('shape')}
        onChange={(event) => setKind(event.target.value as Vibi3DRecipe['kind'])}>
        {VIBI3D_SHAPES.map((shape) => <option key={shape} value={shape}>{label(shape)}</option>)}
      </select>
      <button type="button" className={button} disabled={disabled}
        onClick={() => onCommand({ type: 'create', name: label(kind), recipe: defaultRecipe(kind) })}>{label('addShape')}</button>
    </div>
    <div className="flex items-center gap-1">
      <select className={`${input} flex-1`} value={lightKind} disabled={disabled} aria-label={label('lightKind')}
        onChange={(event) => setLightKind(event.target.value as Vibi3DLightKind)}>
        {VIBI3D_LIGHTS.map((item) => <option key={item} value={item}>{label(`light_${item}`)}</option>)}
      </select>
      <button type="button" className={button} disabled={disabled}
        onClick={() => onCommand({ type: 'light', kind: lightKind, name: label(`light_${lightKind}`) })}>{label('addLight')}</button>
    </div>
    {selected && <>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={button} disabled={disabled || !selected.parentId} onClick={() => onCommand({ type: 'delete', id: selected.id })}>{label('delete')}</button>
        <button type="button" className={button} disabled={disabled}
          onClick={() => onCommand({ type: 'protect', id: selected.id, locked: !selected.locked })}>{selected.locked ? label('unlock') : label('lock')}</button>
      </div>
      {selected.recipe && <GeometryEditor key={selected.id} node={selected} disabled={disabled} onCommand={onCommand} />}
      {selected.light && <LightFields node={selected} disabled={disabled} onCommand={onCommand} label={label} merge={merge} />}
      {selected.parentId && <fieldset className="space-y-1"><legend>{label('duplicate')}</legend>
        <NumberField label={label('count')} caption={label('count')} className={field} inputClassName={input} min={1} max={100}
          value={count} onCommit={(value) => setCount(Math.max(1, Math.round(value)))} />
        <div className="grid grid-cols-3 gap-1">{(['X', 'Y', 'Z'] as const).map((axis, index) =>
          <NumberField key={axis} label={`${label('spacing')} ${axis}`} caption={axis} className={field} inputClassName={input}
            min={-10000} max={10000} value={offset[index]!}
            onCommit={(value) => setOffset((previous) => previous.map((item, i) => i === index ? value : item) as Vibi3DVec3)} />)}</div>
        <button type="button" className={button} disabled={disabled}
          onClick={() => onCommand({ type: 'duplicate', id: selected.id, count, offset })}>{label('duplicate')}</button>
      </fieldset>}
      <Vibi3DMotionEditor node={selected} disabled={locked} onCommand={onCommand} />
    </>}
    <Vibi3DMaterialPanel node={selected} disabled={disabled} onCommand={onCommand} onTexture={onTexture} textureConnections={textureConnections} merge={merge} />
    <fieldset className="space-y-1"><legend>{label('group')}</legend>
      <Vibi3DObjectList nodes={snapshot.nodes.filter(node => node.parentId !== null)} selectedId={null} selectedIds={members} label={label('group')} disabled={disabled}
        onSelect={id => setMembers(previous => id === null ? [] : previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} />
      <button type="button" className={button} disabled={disabled || !members.length}
        onClick={() => { onCommand({ type: 'group', ids: members, name: label('groupName') }); setMembers([]); }}>{label('group')}</button>
    </fieldset>
    <Vibi3DCameraPath snapshot={snapshot} disabled={disabled} onCommand={onCommand} onCamera={onCamera} readView={readView} />
    <Vibi3DArchitecturePanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
    <Vibi3DKitPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
    <Vibi3DSignPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
    <Vibi3DDecalPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
    <Vibi3DMascotPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
  </div>;
}
