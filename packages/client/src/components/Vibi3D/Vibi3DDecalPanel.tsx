import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateVibi3DDecalRecipe, type Vibi3DDecalRecipe, type Vibi3DNode, type Vibi3DSnapshot, type Vibi3DVec3 } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import { Vibi3DImageSourceField } from './Vibi3DImageSourceField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
function defaultPosition(node?: Vibi3DNode): Vibi3DVec3 {
  const recipe = node?.recipe;
  if (recipe?.kind === 'wall') return [0, (recipe.height ?? 3) / 2, (recipe.thickness ?? 0.2) / 2];
  return [0, 0, recipe?.radius ?? (recipe?.depth ? recipe.depth / 2 : 0)];
}
function DecalControls({ selected, disabled, onCommand }: { selected?: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.decals.${key}`);
  const [draft, setDraft] = useState<Partial<Vibi3DDecalRecipe>>(() => selected?.decal ?? {
    target: selected?.id, position: defaultPosition(selected), normal: [0, 0, 1], size: [0.6, 0.8, 0.2], projection: 'flat', rotation: 0,
  });
  const locked = disabled || !!selected?.locked;
  const allowed = !!selected?.decal || (!!selected?.type.includes('Mesh') && !selected.instance);
  const recipe = validateVibi3DDecalRecipe(draft);
  const vector = (key: 'position' | 'normal'): React.JSX.Element => <fieldset className="min-w-0 space-y-1"><legend>{label(key)}</legend>
    <div className="grid min-w-0 grid-cols-3 gap-1">{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={`${label(key)} ${axis}`} caption={axis}
      inputClassName={input} value={draft[key]?.[index] ?? 0} min={-10000} max={10000} disabled={locked || !allowed}
      onCommit={value => { const next: Vibi3DVec3 = [...(draft[key] ?? [0, 0, 0])]; next[index] = value; setDraft(current => ({ ...current, [key]: next })); }} />)}</div>
  </fieldset>;
  return <section className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg" aria-label={label('title')}>
    <h3 className="font-medium">{label('title')}</h3>
    {!allowed && <p className="opacity-70">{label('selectTarget')}</p>}
    <p className="min-w-0 truncate opacity-70" title={draft.target}>{label('target')}: {draft.target ?? '—'}</p>
    <label className="flex min-w-0 items-center gap-2"><span>{label('projection')}</span><select className={input} value={draft.projection ?? 'auto'} disabled={locked || !allowed}
      aria-label={label('projection')} onChange={event => setDraft(current => ({ ...current, projection: event.target.value as Vibi3DDecalRecipe['projection'] }))}>
      {(['flat', 'surface', 'auto'] as const).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    {vector('position')}{vector('normal')}
    <div className="grid min-w-0 grid-cols-3 gap-1 box-narrow:grid-cols-1">{(['width', 'height', 'depth'] as const).map((key, index) => <NumberField key={key}
      label={label(key)} caption={label(key)} inputClassName={input} disabled={locked || !allowed} min={0.001} max={10000} value={draft.size?.[index] ?? 0.2}
      onCommit={value => { const next: [number, number, number?] = [...(draft.size ?? [0.6, 0.8, 0.2])]; next[index] = value; setDraft(current => ({ ...current, size: next })); }} />)}</div>
    <NumberField label={label('rotation')} caption={label('rotation')} inputClassName={input} disabled={locked || !allowed} value={draft.rotation ?? 0} min={-360} max={360}
      onCommit={rotation => setDraft(current => ({ ...current, rotation }))} />
    <Vibi3DImageSourceField value={draft.source} disabled={locked || !allowed} onChange={source => setDraft(current => ({ ...current, source }))} />
    <p className="opacity-70">{label('coordinatesHint')}</p>
    <button type="button" disabled={locked || !allowed || !recipe} className="rounded border border-vb-code-border px-2 py-1 disabled:opacity-40 pointer-coarse:min-h-10"
      onClick={() => { if (recipe) onCommand({ type: 'decal', ...(selected?.decal ? { id: selected.id } : {}), ...recipe }); }}>
      {label(selected?.decal ? 'update' : 'add')}</button>
  </section>;
}
export function Vibi3DDecalPanel({ snapshot, disabled, onCommand }: { snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const selected = snapshot.nodes.find(node => node.id === snapshot.selectedId);
  return <DecalControls key={`${selected?.id ?? ''}:${JSON.stringify(selected?.decal)}`} selected={selected} disabled={disabled} onCommand={onCommand} />;
}
