import { validateVibi3DRecipe, type Vibi3DRecipe } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import { geometryButton, geometryField, geometryInput } from './GeometryPoints.js';

export function GeometryOpenings({ recipe, disabled, onChange, label }: {
  recipe: Vibi3DRecipe; disabled: boolean; onChange: (recipe: Vibi3DRecipe) => void; label: (key: string) => string;
}): React.JSX.Element {
  const openings = recipe.openings ?? [];
  const nextOpening = (): Vibi3DRecipe | null => {
    const width = recipe.width ?? 1, height = recipe.height ?? 1, w = width / 6, h = height / 5;
    for (let row = 0; row < 5; row++) for (let column = 0; column < 6; column++) {
      const candidate = { ...recipe, openings: [...openings, { x: (column + 0.25) * w, y: (row + 0.5) * h, w, h, reveal: 0 }] };
      if (validateVibi3DRecipe(candidate)) return candidate;
    }
    return null;
  };
  return <details className="min-w-0"><summary className="cursor-pointer truncate pointer-coarse:py-2">{label('openings')}</summary>
    <p className="my-2 text-xs text-vb-code-fg">{label('openingCoordinates')}</p>
    <div className="min-w-0 space-y-2">{openings.map((opening, index) => <fieldset key={opening.id ?? index} className="min-w-0 space-y-1 border-b border-vb-code-border pb-2">
      <legend className="max-w-full truncate">{opening.id ?? `${label('opening')} ${index + 1}`}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-1 box-narrow:grid-cols-1">{(['x', 'y', 'w', 'h', 'reveal'] as const).map(key =>
        <NumberField key={key} label={`${label('opening')} ${index + 1} ${label(`opening_${key}`)}`} caption={label(`opening_${key}`)}
          className={geometryField} inputClassName={geometryInput} disabled={disabled} value={opening[key] ?? 0}
          min={key === 'w' || key === 'h' ? 0.001 : 0} max={10000}
          onCommit={value => onChange({ ...recipe, openings: openings.map((entry, i) => i === index ? { ...entry, [key]: value } : entry) })} />)}
      </div><button type="button" className={geometryButton} disabled={disabled}
        onClick={() => onChange({ ...recipe, openings: openings.filter((_, i) => i !== index) })}>{label('removeOpening')}</button>
    </fieldset>)}
      <button type="button" className={geometryButton} disabled={disabled || openings.length >= 32 || !nextOpening()}
        onClick={() => { const next = nextOpening(); if (next) { next.openings![next.openings!.length - 1]!.id = crypto.randomUUID(); onChange(next); } }}>{label('addOpening')}</button>
    </div></details>;
}
