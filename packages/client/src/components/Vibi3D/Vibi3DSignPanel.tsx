import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VIBI3D_SIGN_KINDS, VIBI3D_SIGN_FONTS, type Vibi3DSignRecipe, type Vibi3DSnapshot } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import { ColorField } from '../Creation/ColorField.js';
import { Vibi3DImageSourceField } from './Vibi3DImageSourceField.js';
import { defaultSignRecipe } from './modelSign.js';
import { SIGN_FONT_LICENSES, SIGN_PARSER_LICENSE } from './signFonts.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:min-h-8';
export function Vibi3DSignPanel({ snapshot, disabled, onCommand }: { snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation(), label = (key: string): string => t(`panel.vibi3d.sign.${key}`);
  const selected = snapshot.nodes.find(node => node.id === snapshot.selectedId), stored = selected?.sign;
  const [recipe, setRecipe] = useState<Vibi3DSignRecipe>(() => stored ?? defaultSignRecipe());
  useEffect(() => { setRecipe(stored ?? defaultSignRecipe()); }, [selected?.id, stored]);
  const locked = disabled || !!selected?.locked && !!stored;
  const patch = (change: Partial<Vibi3DSignRecipe>): void => setRecipe(previous => ({ ...previous, ...change }));
  const color = (key: 'color' | 'background'): string => typeof recipe[key] === 'string' ? recipe[key] as string : '#ffffff';
  return <details className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg"><summary className="cursor-pointer font-medium pointer-coarse:min-h-8">{label('title')}</summary>
    <label className="flex min-w-0 items-center gap-2">{label('kind')}<select className={input} aria-label={label('kind')} disabled={locked} value={recipe.kind}
      onChange={event => patch({ kind: event.target.value as Vibi3DSignRecipe['kind'] })}>{VIBI3D_SIGN_KINDS.map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
    <label className="block min-w-0 space-y-1">{label('text')}<textarea className={input} rows={2} maxLength={256} value={recipe.text ?? ''} disabled={locked} aria-label={label('text')} onChange={event => patch({ text: event.target.value })} /></label>
    <div className="flex min-w-0 gap-1 box-compact:flex-col"><select className={input} aria-label={label('font')} disabled={locked} value={recipe.font ?? 'sans'} onChange={event => patch({ font: event.target.value as Vibi3DSignRecipe['font'] })}>
      {VIBI3D_SIGN_FONTS.map(font => <option key={font} value={font}>{label(font)}</option>)}</select>
      <select className={input} aria-label={label('weight')} disabled={locked} value={recipe.weight ?? 400} onChange={event => patch({ weight: Number(event.target.value) })}>
        {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
    <label className="flex min-w-0 items-center gap-2">{label('layout')}<select className={input} aria-label={label('layout')} disabled={locked} value={recipe.layout ?? 'horizontal'} onChange={event => patch({ layout: event.target.value as Vibi3DSignRecipe['layout'] })}>
      {(['horizontal', 'vertical'] as const).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    <div className="grid grid-cols-3 gap-1 box-compact:grid-cols-1">{(['width', 'height', 'depth'] as const).map((key, index) => <NumberField key={key} label={label(key)} caption={label(key)} value={recipe.size?.[index] ?? (index === 2 ? 0.08 : 1)} min={index === 2 ? 0.001 : 0.01} max={index === 2 ? 10 : 100} disabled={locked} inputClassName={input}
      onCommit={value => patch({ size: [recipe.size?.[0] ?? 3, recipe.size?.[1] ?? 0.8, recipe.size?.[2] ?? 0.08].map((entry, axis) => axis === index ? value : entry) as [number, number, number] })} />)}</div>
    <label className="flex min-w-0 items-center justify-between gap-2">{label('color')}<ColorField label={label('color')} value={color('color')} disabled={locked} onChange={value => patch({ color: value })} /></label>
    <label className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-8"><input type="checkbox" disabled={locked} checked={recipe.background !== false} onChange={event => patch({ background: event.target.checked ? '#f5f1e8' : false })} />{label('background')}</label>
    {recipe.background !== false && <ColorField label={label('background')} value={color('background')} disabled={locked} onChange={value => patch({ background: value })} />}
    <NumberField label={label('outlineWidth')} caption={label('outlineWidth')} value={recipe.outline?.width ?? 0} min={0} max={0.2} disabled={locked} inputClassName={input} onCommit={width => patch({ outline: { color: recipe.outline?.color ?? '#ffffff', width } })} />
    {!!recipe.outline?.width && <ColorField label={label('outlineColor')} value={recipe.outline.color} disabled={locked} onChange={value => patch({ outline: { width: recipe.outline!.width, color: value } })} />}
    <label className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-8"><input type="checkbox" disabled={locked} checked={recipe.lit ?? false} onChange={event => patch({ lit: event.target.checked })} />{label('lit')}</label>
    <Vibi3DImageSourceField value={recipe.source} disabled={locked} onChange={source => patch({ source })} />
    <button type="button" className="rounded border border-vb-code-border px-2 py-1 disabled:opacity-40 pointer-coarse:min-h-8" disabled={locked || !recipe.source && !recipe.text?.trim()}
      onClick={() => onCommand({ type: 'sign', ...(stored && selected ? { id: selected.id } : {}), ...recipe })}>{label(stored ? 'update' : 'add')}</button>
    <p className="opacity-70">{label('fictionalHint')}</p>
    <details className="min-w-0"><summary className="cursor-pointer pointer-coarse:min-h-8">{label('fontsLicense')}</summary>
      <div className="flex min-w-0 flex-wrap gap-2">{SIGN_FONT_LICENSES.map(value => <a key={value.role} className="underline" href={value.url} target="_blank" rel="noreferrer">{label(value.role)} · OFL</a>)}</div>
      <a className="underline" href={SIGN_PARSER_LICENSE} target="_blank" rel="noreferrer">opentype.js — MIT</a>
    </details>
  </details>;
}
