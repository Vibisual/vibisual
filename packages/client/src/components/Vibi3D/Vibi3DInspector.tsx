import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DCommand, Vibi3DSnapshot } from '@vibisual/shared';

function NumberField({ label, value, disabled, onCommit }: {
  label: string; value: number; disabled: boolean; onCommit: (value: number) => void;
}): React.JSX.Element {
  const format = (n: number): string => String(Number(n.toFixed(4)));
  const [draft, setDraft] = useState(format(value));
  useEffect(() => setDraft(format(value)), [value]);
  return <label className="flex min-w-0 items-center gap-1 text-[11px] text-gray-400">
    {label.slice(-1)}
    <input aria-label={label} type="number" step="any" value={draft} disabled={disabled}
      className="w-full min-w-0 rounded border border-white/10 bg-gray-950 px-1 py-1 text-gray-100 disabled:opacity-40"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={() => {
        const next = Number(draft);
        if (draft.trim() && Number.isFinite(next) && next !== value) onCommit(next);
        // A rejected edit keeps the old prop, so reset even when no new snapshot arrives.
        setDraft(format(value));
      }} />
  </label>;
}

export function Vibi3DInspector({ snapshot, disabled, onCommand }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: (command: Vibi3DCommand) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const selected = snapshot.nodes.find((node) => node.id === snapshot.selectedId);
  return <aside className="w-56 shrink-0 overflow-y-auto border-l border-white/10 bg-gray-900/70 p-3 text-xs">
    <label className="mb-3 block text-gray-400">
      {t('panel.vibi3d.objects', { defaultValue: 'Objects' })}
      <select aria-label={t('panel.vibi3d.objects', { defaultValue: 'Objects' })}
        className="mt-1 w-full rounded border border-white/10 bg-gray-950 p-1.5 text-gray-100"
        value={snapshot.selectedId ?? ''} disabled={disabled}
        onChange={(event) => onCommand({ type: 'select', id: event.target.value || null })}>
        <option value="">{t('panel.vibi3d.selectObject', { defaultValue: 'Select an object' })}</option>
        {snapshot.nodes.map((node) => <option key={node.id} value={node.id}>{node.name || node.type}</option>)}
      </select>
    </label>
    {selected ? <div key={selected.id} className="space-y-3">
      <p className="break-words font-medium text-gray-100">{selected.name || selected.type}</p>
      {(['position', 'rotation', 'scale'] as const).map((property) => {
        const label = t(`panel.vibi3d.${property}`, { defaultValue: property === 'position' ? 'Position' : property === 'rotation' ? 'Rotation (°)' : 'Scale' });
        return <fieldset key={property}>
          <legend className="mb-1 text-gray-400">{label}</legend>
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis}
              label={`${label} ${axis}`} value={selected[property][index] ?? 0} disabled={disabled}
              onCommit={(value) => {
                const vector = [...selected[property]] as [number, number, number]; vector[index] = value;
                onCommand({ type: 'update', id: selected.id, [property]: vector });
              }} />)}
          </div>
        </fieldset>;
      })}
      {selected.color !== undefined && <label className="flex items-center justify-between gap-2 text-gray-400">
        {t('panel.vibi3d.color', { defaultValue: 'Color' })}
        <input aria-label={t('panel.vibi3d.color', { defaultValue: 'Color' })} type="color"
          value={selected.color} disabled={disabled} className="h-7 w-14 rounded bg-transparent"
          onChange={(event) => onCommand({ type: 'update', id: selected.id, color: event.target.value })} />
      </label>}
    </div> : <p className="text-gray-500">{t('panel.vibi3d.selectHint', { defaultValue: 'Click an object in the view to edit it.' })}</p>}
    <label className="mt-5 block text-gray-400">
      {t('panel.vibi3d.lighting', { defaultValue: 'Lighting' })} · {(snapshot.lighting ?? 1).toFixed(1)}
      <input aria-label={t('panel.vibi3d.lighting', { defaultValue: 'Lighting' })} className="mt-2 w-full"
        type="range" min="0" max="3" step="0.1" disabled={disabled} value={snapshot.lighting ?? 1}
        onChange={(event) => onCommand({ type: 'lighting', intensity: Number(event.target.value) })} />
    </label>
  </aside>;
}
