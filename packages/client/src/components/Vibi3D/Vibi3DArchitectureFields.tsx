import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DArchitectureRecipe, Vibi3DFootprint } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';

/** Coordinates are editable rows in metres; an incomplete row stays a draft until explicitly applied. */
export function ArchitectureSequenceField({ label, value, disabled, dimensions, min, max, onChange }: {
  label: string; value: number[][]; disabled: boolean; dimensions: number; min: number; max: number; onChange: (value: number[][]) => void;
}): React.JSX.Element {
  const { t } = useTranslation(); const formatted = value.map(row => row.join(', ')).join('\n');
  const [text, setText] = useState(formatted); useEffect(() => setText(formatted), [formatted]);
  const rows = text.trim().split('\n').map(line => line.split(/[,\s]+/).filter(Boolean).map(Number));
  const valid = rows.length > 0 && rows.length <= 128 && rows.every(row => row.length === dimensions && row.every(n => Number.isFinite(n) && n >= min && n <= max));
  return <label className="block min-w-0 space-y-1"><span>{label}</span><textarea className={input} aria-label={label} rows={3} disabled={disabled} value={text} onChange={event => setText(event.target.value)} />
    <button type="button" disabled={disabled || !valid || text === formatted} className="rounded border border-vb-code-border px-2 py-1 text-xs disabled:opacity-40 pointer-coarse:py-2"
      onClick={() => onChange(rows)}>{t('panel.vibi3d.architecture.applyRows')}</button>
  </label>;
}

export function ArchitectureFootprintFields({ recipe, disabled, onChange }: {
  recipe: Extract<Vibi3DArchitectureRecipe, { kind: 'building' }>; disabled: boolean; onChange: (value: Vibi3DFootprint) => void;
}): React.JSX.Element {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.architecture.${key}`);
  const footprint = recipe.footprint ?? { kind: 'rect', width: 12, depth: 9 };
  return <fieldset className="min-w-0 space-y-1"><legend>{label('footprint')}</legend>
    <select className={input} aria-label={label('footprint')} value={footprint.kind} disabled={disabled} onChange={event => {
      const kind = event.target.value as Vibi3DFootprint['kind']; const width = footprint.kind === 'polygon' ? 12 : footprint.width, depth = footprint.kind === 'polygon' ? 9 : footprint.depth;
      onChange(kind === 'polygon' ? { kind, points: [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]] }
        : kind === 'l' ? { kind, width, depth, wingWidth: width * 0.5, wingDepth: depth * 0.5 } : { kind, width, depth });
    }}>{(['rect', 'l', 'polygon'] as const).map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select>
    {footprint.kind === 'polygon' ? <ArchitectureSequenceField label={label('footprintPoints')} value={footprint.points} disabled={disabled} dimensions={2} min={-200} max={200}
      onChange={points => onChange({ kind: 'polygon', points: points as [number, number][] })} />
      : (['width', 'depth', ...(footprint.kind === 'l' ? ['wingWidth', 'wingDepth'] : [])] as const).map(key => <NumberField key={key} label={label(key)} caption={label(key)} inputClassName={input}
        disabled={disabled} min={0.25} max={200} value={Number((footprint as unknown as Record<string, number>)[key])} onCommit={value => onChange({ ...footprint, [key]: value })} />)}
  </fieldset>;
}
