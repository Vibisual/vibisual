import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveVibi3DFacadeLayout, type Vibi3DArchitectureRecipe, type Vibi3DFacadeModule } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import { ColorField } from '../Creation/ColorField.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
export function ArchitectureOptions({ recipe, disabled, apply }: { recipe: Vibi3DArchitectureRecipe; disabled: boolean; apply: (patch: Record<string, unknown>, merge?: string) => void }): React.JSX.Element | null {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.architecture.${key}`);
  const [drag] = useState(() => new Map<string, string>());
  const color = (scope: string, value: string, commit: (color: string, merge: string) => void): React.JSX.Element => <label className="flex min-w-0 items-center justify-between gap-2">
    <span className="truncate">{label(scope)}</span><ColorField label={label(scope)} value={value} disabled={disabled} onChange={(next, phase) => {
      let key = drag.get(scope); if (!key) { key = `${scope}:${Date.now()}:${Math.random()}`; drag.set(scope, key); }
      commit(next, key); if (phase === 'commit') drag.delete(scope);
    }} /></label>;
  if (recipe.kind === 'storefront' && recipe.awning !== false) {
    const awning = typeof recipe.awning === 'object' ? recipe.awning : {}, colors = awning.colors ?? ['#b83636', '#f4eee2'];
    return <details className="min-w-0 space-y-1"><summary>{label('awningOptions')}</summary>
      {Object.entries({ depth: [0.1, 5, 1.3], drop: [0, 2, 0.3], height: [0.5, 10, Math.min(3, (recipe.height ?? 4.2) - (recipe.signBandHeight ?? 0.65))] }).map(([key, limits]) =>
        <NumberField key={key} label={label(`awning_${key}`)} caption={label(`awning_${key}`)} inputClassName={input} disabled={disabled} min={limits[0]} max={limits[1]}
          value={awning[key as 'depth' | 'drop' | 'height'] ?? limits[2]!} onCommit={value => apply({ awning: { ...awning, [key]: value } })} />)}
      {colors.map((value, index) => <div key={index}>{color(index ? 'secondaryColor' : 'color', value, (next, merge) => {
        const nextColors = [...colors]; nextColors[index] = next; apply({ awning: { ...awning, colors: nextColors } }, merge);
      })}</div>)}
    </details>;
  }
  if (recipe.kind === 'rooftop' && recipe.waterTank !== false) {
    const tank = typeof recipe.waterTank === 'object' ? recipe.waterTank : {};
    return <details className="min-w-0 space-y-1"><summary>{label('tankOptions')}</summary>
      {(['radius', 'height'] as const).map(key => <NumberField key={key} label={label(`tank_${key}`)} caption={label(`tank_${key}`)} inputClassName={input} disabled={disabled}
        value={tank[key] ?? (key === 'radius' ? 0.8 : 1.8)} min={0.1} max={20} onCommit={value => apply({ waterTank: { ...tank, [key]: value } })} />)}
    </details>;
  }
  if (recipe.kind === 'street') {
    const colors = recipe.blockColors ?? ['#d9d9d0', '#8b8e8d'];
    return <details className="min-w-0 space-y-1"><summary>{label('blockColors')}</summary>{colors.map((value, index) => <div key={index}>{color(index ? 'secondaryColor' : 'color', value, (next, merge) => {
      const nextColors = [...colors]; nextColors[index] = next; apply({ blockColors: nextColors }, merge);
    })}</div>)}</details>;
  }
  if (recipe.kind === 'facade') {
    const layout = resolveVibi3DFacadeLayout(recipe);
    return <details className="min-w-0 space-y-1"><summary>{label('floorModules')}</summary>
      {layout.floorHeights.map((_height, floor) => <div key={floor} className="flex min-w-0 flex-wrap gap-1">
        <span>{label('floor')} {floor + 1}</span>{Array.from({ length: layout.bays }, (_, bay) => <select key={bay} className={`${input} flex-1`} aria-label={`${label('floor')} ${floor + 1} ${label('bay')} ${bay + 1}`}
          disabled={disabled} value={recipe.floorModules?.[floor]?.[bay] ?? (floor === 0 ? 'open' : 'window')} onChange={event => {
            const floorModules: Vibi3DFacadeModule[][] = Array.from({ length: layout.floorHeights.length }, (_, row) => Array.from({ length: layout.bays }, (_, column) => recipe.floorModules?.[row]?.[column] ?? (row === 0 ? 'open' : 'window')));
            floorModules[floor]![bay] = event.target.value as Vibi3DFacadeModule; apply({ floorModules });
          }}><option value="open">{label('reservedShops')}</option>{(['window', 'solid', 'balcony'] as const).map(module => <option key={module} value={module}>{label(module)}</option>)}</select>)}</div>)}
    </details>;
  }
  return null;
}
