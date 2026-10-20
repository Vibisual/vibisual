import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { Vibi3DSnapshot, Vibi3DStats } from '@vibisual/shared';
import { ColorField } from '../Creation/ColorField.js';
import { NumberField } from '../Creation/NumberField.js';
import { ScrollFade } from '../ScrollFade.js';
import { Vibi3DAuthoring, useColorMerge, type AuthoringCommand } from './Vibi3DAuthoring.js';
import type { ViewReader } from './Vibi3DCameraPath.js';
import { Vibi3DLookPanel } from './Vibi3DLookPanel.js';
import { Vibi3DObjectList } from './Vibi3DObjectList.js';
import { Vibi3DStatsPanel } from './Vibi3DStatsPanel.js';
import { Vibi3DShotPanel, type Vibi3DShotActions } from './Vibi3DShotPanel.js';

export function Vibi3DInspector({ snapshot, disabled, onCommand, onTexture, onCamera, readView, textureConnections, stats, shotActions }: {
  snapshot: Vibi3DSnapshot; disabled: boolean; onCommand: AuthoringCommand;
  onTexture?: (file: File) => void; onCamera?: () => void; readView?: ViewReader; textureConnections?: ReactNode;
  stats?: Vibi3DStats;
  shotActions?: Vibi3DShotActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const merge = useColorMerge();
  const selected = snapshot.nodes.find((node) => node.id === snapshot.selectedId);
  // 넓은 창은 무대 오른쪽 칸. 창 폭이 좁으면(box-compact) 무대 아래 전폭으로 내려가 본문 높이의 45% 안에서 스크롤하고, 높이가
  //   모자라면 무대 하한보다 먼저 줄어든다(shrink).
  return <aside className="flex min-h-0 min-w-0 max-w-[24rem] basis-1/3 shrink-0 flex-col border-l border-vb-code-border bg-vb-sunken text-xs box-compact:max-h-[45%] box-compact:w-full box-compact:max-w-none box-compact:basis-auto box-compact:shrink box-compact:border-l-0 box-compact:border-t"><ScrollFade fill className="p-3">
    <Vibi3DObjectList nodes={snapshot.nodes} selectedId={snapshot.selectedId} disabled={disabled} onSelect={id => onCommand({ type: 'select', id })} />
    {selected ? <div key={selected.id} className="space-y-3">
      <p className="break-words font-medium text-vb-code-fg">{selected.name || selected.type}</p>
      {(['position', 'rotation', 'scale'] as const).map((property) => {
        const label = t(`panel.vibi3d.${property}`, { defaultValue: property === 'position' ? 'Position' : property === 'rotation' ? 'Rotation (°)' : 'Scale' });
        return <fieldset key={property}>
          <legend className="mb-1 text-vb-code-fg/70">{label}</legend>
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={`${label} ${axis}`} caption={axis}
              value={selected[property][index] ?? 0} disabled={disabled} min={property === 'scale' ? -1e6 : -1e9} max={property === 'scale' ? 1e6 : 1e9}
              onCommit={(value) => {
                // A zero scale collapses the object and cannot be undone by scaling; the field keeps the old value.
                if (property === 'scale' && value === 0) return;
                const vector = [...selected[property]] as [number, number, number]; vector[index] = value;
                onCommand({ type: 'update', id: selected.id, [property]: vector });
              }} />)}
          </div>
        </fieldset>;
      })}
      {selected.color !== undefined && <label className="flex items-center justify-between gap-2 text-vb-code-fg/70">
        {t('panel.vibi3d.color', { defaultValue: 'Color' })}
        <ColorField label={t('panel.vibi3d.color', { defaultValue: 'Color' })} value={selected.color} disabled={disabled}
          onChange={(value, phase) => onCommand({ type: 'update', id: selected.id, color: value }, { merge: merge(`color:${selected.id}`, phase) })} />
      </label>}
      {(selected.type.includes('Mesh') || selected.instance) && <fieldset className="space-y-1 text-xs text-vb-code-fg/70"><legend>{t('panel.vibi3d.look.nodeShadows')}</legend>
        {(['cast', 'receive'] as const).map((key) => <label key={key} className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-8">
          <input type="checkbox" aria-label={t(`panel.vibi3d.look.${key}`)} checked={selected.shadows?.[key] ?? true} disabled={disabled || selected.locked}
            onChange={(event) => onCommand({ type: 'update', id: selected.id, shadows: { [key]: event.target.checked } })} />
          <span className="truncate">{t(`panel.vibi3d.look.${key}`)}</span></label>)}
      </fieldset>}
    </div> : <p className="text-vb-code-fg/60">{t('panel.vibi3d.selectHint', { defaultValue: 'Click an object in the view to edit it.' })}</p>}
    <Vibi3DLookPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} />
    <Vibi3DShotPanel snapshot={snapshot} disabled={disabled} onCommand={onCommand} readView={readView} actions={shotActions} />
    <Vibi3DAuthoring snapshot={snapshot} disabled={disabled} onCommand={onCommand} onTexture={onTexture} onCamera={onCamera} readView={readView} textureConnections={textureConnections} />
    {stats && <Vibi3DStatsPanel stats={stats} />}
  </ScrollFade></aside>;
}
