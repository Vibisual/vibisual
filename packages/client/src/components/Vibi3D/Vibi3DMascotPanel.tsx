import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateVibi3DMascotRecipe, type Vibi3DMascotRecipe, type Vibi3DNode, type Vibi3DSnapshot } from '@vibisual/shared';
import { ColorField } from '../Creation/ColorField.js';
import { NumberField } from '../Creation/NumberField.js';
import { Vibi3DImageSourceField } from './Vibi3DImageSourceField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
const defaults = { body: '#e9b34b', accent: '#507f91', face: '#252c36' };
function MascotControls({ selected, disabled, onCommand }: { selected?: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.mascots.${key}`);
  const [draft, setDraft] = useState<Vibi3DMascotRecipe>(() => selected?.mascot ?? { style: 'round', height: 1.6 });
  const locked = disabled || !!selected?.mascot && !!selected.locked, recipe = validateVibi3DMascotRecipe(draft);
  return <section className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg" aria-label={label('title')}>
    <h3 className="font-medium">{label('title')}</h3>
    <label className="flex min-w-0 items-center gap-2"><span>{label('style')}</span><select value={draft.style} className={input} aria-label={label('style')} disabled={locked}
      onChange={event => setDraft(current => {
        const style = event.target.value as Vibi3DMascotRecipe['style'], next = { ...current, style };
        if (style === 'round') delete next.source; return next;
      })}>{(['round', 'standee'] as const).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    <NumberField label={label('height')} caption={label('height')} value={draft.height ?? 1.6} inputClassName={input} min={0.1} max={20} disabled={locked}
      onCommit={height => setDraft(current => ({ ...current, height }))} />
    {(draft.style === 'standee' ? ['accent'] as const : ['body', 'accent', 'face'] as const).map(key => <label key={key} className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate">{label(key)}</span><ColorField label={label(key)} value={draft.colors?.[key] ?? defaults[key]} disabled={locked}
        onChange={value => setDraft(current => ({ ...current, colors: { ...current.colors, [key]: value } }))} /></label>)}
    {draft.style === 'standee' && <Vibi3DImageSourceField value={draft.source} disabled={locked} onChange={source => setDraft(current => ({ ...current, source }))} />}
    <p className="opacity-70">{label('hint')}</p>
    <button type="button" disabled={locked || !recipe} className="rounded border border-vb-code-border px-2 py-1 disabled:opacity-40 pointer-coarse:min-h-10"
      onClick={() => { if (recipe) onCommand({ type: 'mascot', ...(selected?.mascot ? { id: selected.id } : {}), ...recipe }); }}>
      {label(selected?.mascot ? 'update' : 'add')}</button>
  </section>;
}
export function Vibi3DMascotPanel({ snapshot, disabled, onCommand }: { snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand }): React.JSX.Element {
  const selected = snapshot.nodes.find(node => node.id === snapshot.selectedId);
  return <MascotControls key={`${selected?.id ?? ''}:${JSON.stringify(selected?.mascot)}`} selected={selected} disabled={disabled} onCommand={onCommand} />;
}
