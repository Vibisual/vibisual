import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VIBI3D_ARCHITECTURE_KINDS, VIBI3D_PROP_KINDS, resolveVibi3DFacadeLayout, type Vibi3DArchitectureKind, type Vibi3DArchitectureRecipe, type Vibi3DArchitectureCommand, type Vibi3DSnapshot } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';
import { defaultArchitectureRecipe } from './modelArchitecture.js';
import { ArchitectureFootprintFields, ArchitectureSequenceField } from './Vibi3DArchitectureFields.js';
import { ArchitectureOptions } from './Vibi3DArchitectureOptions.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
const numeric: Record<Vibi3DArchitectureKind, Record<string, readonly [number, number, number]>> = {
  building: { floors: [1, 20, 4], groundFloorHeight: [1, 12, 4.2], upperFloorHeight: [1, 10, 3.1] },
  facade: { width: [0.25, 200, 12], floors: [1, 20, 4], bays: [1, 50, 3], windowDepth: [0, 2, 0.18], bandHeight: [0, 2, 0.18], eavesDepth: [0, 5, 0.24], acDensity: [0, 1, 0.25] },
  storefront: { width: [0.75, 200, 4], height: [1, 200, 4.2], depth: [0.05, 200, 0.35], signBandHeight: [0, 3, 0.65] },
  rooftop: { width: [0.25, 200, 12], depth: [0.05, 200, 9], railingHeight: [0, 5, 1.1] },
  street: { length: [1, 500, 18], roadWidth: [1, 50, 6], sidewalkWidth: [0.25, 20, 3], lanes: [1, 8, 2], kerbHeight: [0, 0.5, 0.15], manholes: [0, 20, 1] },
  prop: { width: [0.25, 200, 1], height: [0.05, 200, 1], depth: [0.05, 200, 0.5], radius: [0.01, 20, 0.1] },
};
const choices: Record<Vibi3DArchitectureKind, Record<string, readonly string[]>> = {
  building: { roof: ['flat', 'pitched'] }, facade: { side: ['front', 'back', 'left', 'right'] }, storefront: { style: ['glass', 'wood', 'shutter'], door: ['left', 'right', 'center', 'none'] },
  rooftop: {}, street: { sidewalks: ['left', 'right', 'both'] }, prop: { style: VIBI3D_PROP_KINDS },
};
const toggles: Partial<Record<Vibi3DArchitectureKind, string[]>> = { storefront: ['awning', 'projectingSign'], rooftop: ['waterTank', 'antenna'], street: ['laneMarkings', 'crosswalk'] };

export function Vibi3DArchitecturePanel({ snapshot, disabled, onCommand }: { snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.architecture.${key}`);
  const [kind, setKind] = useState<Vibi3DArchitectureKind>('building');
  const selected = snapshot.nodes.find(node => node.id === snapshot.selectedId), recipe = selected?.architecture;
  const locked = disabled || !!selected?.locked;
  const apply = (patch: Record<string, unknown>, merge?: string): void => {
    if (recipe && selected && !locked) onCommand({ type: recipe.kind, id: selected.id, ...patch } as Vibi3DArchitectureCommand, merge ? { merge: `architecture:${selected.id}:${merge}` } : undefined);
  };
  const facade = recipe?.kind === 'facade' ? resolveVibi3DFacadeLayout(recipe) : null;
  const values = recipe ? { ...recipe, ...(facade ? { width: facade.width, floors: facade.floorHeights.length, bays: facade.bays } : {}) } as unknown as Record<string, unknown> : {};
  return <section className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg" aria-label={label('title')}>
    <h3 className="font-medium">{label('title')}</h3>
    <div className="flex min-w-0 flex-wrap gap-1"><select className={`${input} flex-1`} aria-label={label('kind')} value={kind} disabled={disabled}
      onChange={event => setKind(event.target.value as Vibi3DArchitectureKind)}>
      {VIBI3D_ARCHITECTURE_KINDS.map(value => <option key={value} value={value}>{label(value)}</option>)}
    </select><button type="button" disabled={disabled} className="shrink-0 rounded border border-vb-code-border px-2 py-1 pointer-coarse:py-2"
      onClick={() => { const { kind: type, ...params } = defaultArchitectureRecipe(kind); onCommand({ type, ...params } as Vibi3DArchitectureCommand); }}>{label('add')}</button></div>
    {recipe && <details open className="min-w-0 space-y-2"><summary className="cursor-pointer truncate pointer-coarse:py-2">{label('edit')} · {label(recipe.kind)}</summary>
      {Object.entries(numeric[recipe.kind]).filter(([key]) => recipe.kind !== 'prop' || values[key] !== undefined).map(([key, limits]) => <NumberField key={key} label={label(key)} caption={label(key)} inputClassName={input}
        disabled={locked} min={limits[0]} max={limits[1]} value={typeof values[key] === 'number' ? values[key] as number : limits[2]}
        onCommit={value => apply({ [key]: ['floors', 'bays', 'lanes', 'manholes'].includes(key) ? Math.round(value) : value,
          ...(key === 'floors' && recipe.kind === 'facade' && recipe.floorHeights ? { floorHeights: Array.from({ length: Math.round(value) }, (_, index) => recipe.floorHeights?.[index] ?? 3.1) } : {}) })} />)}
      {Object.entries(choices[recipe.kind]).map(([key, items]) => <label key={key} className="flex min-w-0 items-center gap-2"><span>{label(key)}</span>
        <select className={input} aria-label={label(key)} disabled={locked} value={String(values[key] ?? (key === 'style' && recipe.kind === 'prop' ? 'planter' : items[0]))}
          onChange={event => apply({ [key]: event.target.value, ...(key === 'style' && event.target.value === 'wire' && recipe.kind === 'prop' && !recipe.path ? { path: [[-3, 5, 0], [3, 5, 0]] } : {}) })}>
          {items.map(item => <option key={item} value={item}>{label(item)}</option>)}
        </select></label>)}
      {(toggles[recipe.kind] ?? []).map(key => <label key={key} className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-8">
        <input type="checkbox" aria-label={label(key)} disabled={locked} checked={values[key] !== false}
          onChange={event => apply({ [key]: event.target.checked })} /><span className="truncate">{label(key)}</span></label>)}
      {recipe.kind === 'building' && <ArchitectureFootprintFields recipe={recipe} disabled={locked} onChange={footprint => apply({ footprint })} />}
      {recipe.kind === 'facade' && <>
        <ArchitectureSequenceField label={label('floorHeights')} value={facade!.floorHeights.map(value => [value])} disabled={locked} dimensions={1} min={1} max={12}
          onChange={rows => apply({ floorHeights: rows.flat(), floors: rows.length })} />
      </>}
      {recipe.kind === 'prop' && recipe.style === 'wire' && <>
        <ArchitectureSequenceField label={label('path')} value={recipe.path ?? []} disabled={locked} dimensions={3} min={-10000} max={10000} onChange={path => apply({ path })} />
        <NumberField label={label('sag')} caption={label('sag')} value={recipe.sag ?? 0.6} min={0} max={100} disabled={locked} onCommit={sag => apply({ sag })} />
      </>}
      <ArchitectureOptions recipe={recipe} disabled={locked} apply={apply} />
      <p className="opacity-70">{label('regenerateHint')}</p>
    </details>}
  </section>;
}
