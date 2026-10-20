import { validateVibi3DRecipe, type Vibi3DRecipe, type Vibi3DVec3 } from '@vibisual/shared';
import { GeometryPoints, geometryButton } from './GeometryPoints.js';

export function GeometryHoles({ recipe, disabled, onChange, label }: {
  recipe: Vibi3DRecipe; disabled: boolean; onChange: (recipe: Vibi3DRecipe) => void; label: (key: string) => string;
}): React.JSX.Element {
  const holes = recipe.holes ?? [];
  const findHole = (): Vibi3DRecipe | null => {
    const points = recipe.points ?? [], xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const left = Math.min(...xs), bottom = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - bottom;
    for (let row = 1; row <= 4; row++) for (let column = 1; column <= 4; column++) {
      const x = left + width * column / 5, y = bottom + height * row / 5, w = width / 15, h = height / 15;
      const hole: Vibi3DVec3[] = [[x - w, y - h, 0], [x + w, y - h, 0], [x + w, y + h, 0], [x - w, y + h, 0]];
      const next = { ...recipe, holes: [...holes, hole] }; if (validateVibi3DRecipe(next)) return next;
    }
    return null;
  };
  return <details className="min-w-0"><summary className="cursor-pointer truncate pointer-coarse:py-2">{label('holes')}</summary>
    <div className="mt-2 min-w-0 space-y-2">{holes.map((points, index) => <div key={index} className="min-w-0 space-y-1 border-b border-vb-code-border pb-2">
      <GeometryPoints points={points} name={`${label('hole')} ${index + 1}`} minimum={3} planar disabled={disabled} label={label}
        onChange={points => onChange({ ...recipe, holes: holes.map((value, i) => i === index ? points : value) })} />
      <button type="button" className={geometryButton} disabled={disabled}
        onClick={() => onChange({ ...recipe, holes: holes.filter((_, i) => i !== index) })}>{label('removeHole')}</button>
    </div>)}<button type="button" className={geometryButton} disabled={disabled || holes.length >= 32 || !findHole()}
      onClick={() => { const next = findHole(); if (next) onChange(next); }}>{label('addHole')}</button></div>
  </details>;
}
