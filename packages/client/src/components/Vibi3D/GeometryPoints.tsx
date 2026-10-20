import type { Vibi3DVec3 } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';

export const geometryInput = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs text-vb-code-fg disabled:opacity-40 pointer-coarse:py-2';
export const geometryField = 'flex min-w-0 flex-col gap-1 text-xs text-vb-code-fg';
export const geometryButton = 'min-w-0 rounded border border-vb-code-border bg-vb-sunken px-2 py-1 text-xs text-vb-code-fg disabled:opacity-40 pointer-coarse:py-2';

/** Array positions here are geometric coordinates, never persistent scene-object references. */
export function GeometryPoints({ points, name, disabled, minimum, planar, radius, onChange, label }: {
  points: Vibi3DVec3[]; name: string; disabled: boolean; minimum: number; planar?: boolean; radius?: boolean;
  onChange: (points: Vibi3DVec3[]) => void; label: (key: string) => string;
}): React.JSX.Element {
  return <details className="min-w-0"><summary className="cursor-pointer truncate pointer-coarse:py-2">{name}</summary>
    <div className="mt-2 min-w-0 space-y-2">{points.map((point, index) => <div key={index} className="flex min-w-0 flex-col gap-1 border-b border-vb-code-border pb-2">
      <div className="grid min-w-0 grid-cols-3 gap-1 box-compact:grid-cols-1">{point.map((value, axis) => (planar && axis === 2) ? null :
        <NumberField key={axis} label={`${name} ${index + 1} ${['X', 'Y', 'Z'][axis]}`} caption={['X', 'Y', 'Z'][axis]}
          className={geometryField} inputClassName={geometryInput} disabled={disabled} min={radius && axis === 0 ? 0 : -10000} max={10000} value={value}
          onCommit={next => onChange(points.map((p, i) => i === index ? p.map((n, j) => j === axis ? next : n) as Vibi3DVec3 : [...p]))} />)}
      </div><button type="button" className={geometryButton} disabled={disabled || points.length <= minimum}
        onClick={() => onChange(points.filter((_, i) => i !== index))}>{label('removePoint')}</button>
    </div>)}
      <button type="button" className={geometryButton} disabled={disabled || points.length >= 128}
        onClick={() => {
          const last = points[points.length - 1] ?? [0, 0, 0], first = points[0] ?? [0, 0, 0];
          const next: Vibi3DVec3 = planar ? [(last[0] + first[0]) / 2, (last[1] + first[1]) / 2, 0] : [last[0] + 0.25, last[1], last[2]];
          onChange([...points, next]);
        }}>{label('addPoint')}</button>
    </div></details>;
}
