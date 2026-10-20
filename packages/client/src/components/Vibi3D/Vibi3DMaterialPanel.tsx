import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VIBI3D_MATERIAL_PRESETS, type Vibi3DMaterial, type Vibi3DMaterialParams, type Vibi3DMaterialPreset, type Vibi3DNode } from '@vibisual/shared';
import { ColorField } from '../Creation/ColorField.js';
import { NumberField } from '../Creation/NumberField.js';
import { generateMaterialMaps, materialPresetDefaults } from './proceduralMaterialPixels.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';

const input = 'min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-1 py-1 text-xs pointer-coarse:py-2';
const field = 'flex min-w-0 items-center justify-between gap-2 text-xs';
const parameterLimits = { scale: [0.05, 20, 1], contrast: [0, 1, 0.5], roughness: [0, 1, 0.8], normalStrength: [0, 3, 1], stripeWidth: [0.01, 2, 0.2], groutWidth: [0.001, 0.2, 0.025] } as const;
const scalarLimits = { roughness: [0, 1, 1], metalness: [0, 1, 0], opacity: [0, 1, 1], emissiveIntensity: [0, 100, 1], envMapIntensity: [0, 100, 1], alphaTest: [0, 1, 0], polygonOffsetFactor: [-100, 100, 0], polygonOffsetUnits: [-100, 100, 0] } as const;
const physicalLimits = { transmission: [0, 1, 0], ior: [1, 2.5, 1.5], thickness: [0, 100, 0], clearcoat: [0, 1, 0] } as const;

function TilePreview({ material, label, node }: { material: Vibi3DMaterial; label: string; node: Vibi3DNode }): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null);
  useInspectorPicker(canvas, at => [{ rect: { x: 0, y: 0, width: at.width, height: at.height }, label,
    text: `${node.name || node.id} · ${material.preset ?? ''}`,
    clipboard: JSON.stringify({ app: 'vibi3d', nodeId: node.id, name: node.name, material }),
  }]);
  const pixels = useMemo(() => material.preset ? generateMaterialMaps(material.preset, { seed: material.seed, wear: material.wear, params: material.params, size: 64 }).map : null,
    [material.preset, material.seed, material.wear, material.params]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context || !pixels) return;
    const image = context.createImageData(pixels.width, pixels.height); image.data.set(pixels.data); context.putImageData(image, 0, 0);
  }, [pixels]);
  return pixels ? <canvas ref={canvas} width={pixels.width} height={pixels.height} role="img" aria-label={label}
    className="aspect-square w-full rounded border border-vb-code-border" /> : null;
}

/** The existing source-link controls are slotted here: one material surface for both manual and agent edits. */
export function Vibi3DMaterialPanel({ node, disabled, onCommand, onTexture, textureConnections, merge }: {
  node?: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand; onTexture?: (file: File) => void; textureConnections?: ReactNode;
  merge: (scope: string, phase: 'preview' | 'commit') => string;
}): React.JSX.Element {
  const { t } = useTranslation(); const label = (key: string): string => t(`panel.vibi3d.materials.${key}`);
  const material = node?.material; const locked = disabled || !!node?.locked;
  const defaults = material?.preset ? materialPresetDefaults(material.preset) : undefined;
  const apply = (value: Vibi3DMaterial, phase?: 'preview' | 'commit', scope = ''): void => {
    if (!node || !material || locked) return;
    onCommand({ type: 'material', id: node.id, material: value }, phase ? { merge: merge(`material:${node.id}:${scope}`, phase) } : undefined);
  };
  const number = (key: string, value: number, min: number, max: number, commit: (value: number) => void): React.JSX.Element =>
    <NumberField key={key} label={label(key)} caption={label(key)} className={field} inputClassName={input} disabled={locked}
      min={min} max={max} value={value} onCommit={commit} />;
  return <section className="min-w-0 space-y-2 border-t border-vb-code-border pt-3 text-xs text-vb-code-fg" aria-label={label('title')}>
    <h3 className="font-medium">{label('title')}</h3>
    {material ? <>
      <label className={field}><span className="shrink-0">{label('preset')}</span>
        <select className={input} aria-label={label('preset')} value={material.preset ?? ''} disabled={locked}
          onChange={(event) => apply({ preset: event.target.value as Vibi3DMaterialPreset })}>
          <option value="" disabled>{label('custom')}</option>
          {VIBI3D_MATERIAL_PRESETS.map((preset) => <option key={preset} value={preset}>{label(`preset_${preset}`)}</option>)}
        </select></label>
      {material.preset && <details className="min-w-0 space-y-2" open>
        <summary className="cursor-pointer truncate pointer-coarse:py-2">{label('pattern')}</summary>
        <TilePreview material={material} label={label('preview')} node={node!} />
        {material.preset === 'glass' && <label className={`${field} pointer-coarse:min-h-8`}>
          <span className="min-w-0 truncate">{label('fakeInterior')}</span><input type="checkbox" aria-label={label('fakeInterior')} disabled={locked}
            checked={material.params?.fakeInterior ?? false} onChange={event => apply({ params: { fakeInterior: event.target.checked } })} />
        </label>}
        {number('wear', material.wear ?? 0, 0, 1, (wear) => apply({ wear }))}
        {number('seed', material.seed ?? 0, 0, 0xffffffff, (seed) => apply({ seed: Math.round(seed) }))}
        {(['color', 'secondaryColor', 'accentColor'] as const).map((key) => <label key={key} className={field}>
          <span className="min-w-0 truncate">{label(`pattern_${key}`)}</span><ColorField label={label(`pattern_${key}`)} value={material.params?.[key] ?? defaults![key]} disabled={locked}
            onChange={(value, phase) => apply({ params: { [key]: value } }, phase, key)} /></label>)}
        {Object.entries(parameterLimits).map(([key, limits]) => number(`pattern_${key}`, material.params?.[key as keyof Vibi3DMaterialParams] as number ?? (defaults && key in defaults ? defaults[key as 'roughness'] : limits[2]), limits[0], limits[1],
          (value) => apply({ params: { [key]: value } })))}
      </details>}
      <details className="min-w-0 space-y-2" open><summary className="cursor-pointer truncate pointer-coarse:py-2">{label('mapping')}</summary>
        {(['tileWidth', 'tileHeight'] as const).map((key, axis) => number(key, material.tileSize?.[axis] ?? defaults?.tileSize[axis] ?? 1, 0.001, 10000, (value) => {
          const tileSize: [number, number] = [...(material.tileSize ?? defaults?.tileSize ?? [1, 1])]; tileSize[axis] = value; apply({ tileSize });
        }))}
        {number('rotation', material.rotation ?? 0, -360, 360, (rotation) => apply({ rotation }))}
        {(['offsetX', 'offsetY'] as const).map((key, axis) => number(key, material.offset?.[axis] ?? 0, -10000, 10000, (value) => {
          const offset: [number, number] = [...(material.offset ?? [0, 0])]; offset[axis] = value; apply({ offset });
        }))}
      </details>
      <details className="min-w-0 space-y-2"><summary className="cursor-pointer truncate pointer-coarse:py-2">{label('surface')}</summary>
        {Object.entries(scalarLimits).map(([key, limits]) => number(key, material[key as keyof typeof scalarLimits] ?? limits[2], limits[0], limits[1], (value) => apply({ [key]: value })))}
        <label className={field}><span>{label('emissive')}</span><ColorField label={label('emissive')} value={material.emissive ?? '#000000'} disabled={locked}
          onChange={(emissive, phase) => apply({ emissive }, phase, 'emissive')} /></label>
        {Object.entries(physicalLimits).map(([key, limits]) => number(key, material.physical?.[key as keyof typeof physicalLimits] ?? limits[2], limits[0], limits[1], (value) => apply({ physical: { [key]: value } })))}
        {(['transparent', 'polygonOffset'] as const).map((key) => <label key={key} className={`${field} pointer-coarse:min-h-8`}>
          <span className="min-w-0 truncate">{label(key)}</span><input type="checkbox" aria-label={label(key)} disabled={locked} checked={material[key] ?? false}
            onChange={(event) => apply({ [key]: event.target.checked })} /></label>)}
        <label className={field}><span>{label('side')}</span><select className={input} aria-label={label('side')} value={material.side ?? 'front'} disabled={locked}
          onChange={(event) => apply({ side: event.target.value as Vibi3DMaterial['side'] })}>
          {(['front', 'back', 'double'] as const).map((side) => <option key={side} value={side}>{label(`side_${side}`)}</option>)}
        </select></label>
      </details>
      {onTexture && <label className="block min-w-0">{label('texture')}<input className="mt-1 w-full min-w-0 text-xs" type="file" accept="image/*" disabled={locked}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onTexture(file); event.target.value = ''; }} /></label>}
    </> : <p>{label('select')}</p>}
    {textureConnections}
  </section>;
}
