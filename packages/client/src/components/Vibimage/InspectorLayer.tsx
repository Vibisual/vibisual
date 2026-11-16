import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_BLEND_MODES, patchImageLayer, type ImageBlendMode, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { EditorButton } from './editorControls.js';
import { EditorIcon } from './editorIcons.js';
import { InspectorGroup, InspectorNumber, InspectorRow, InspectorSlider, SELECT } from './InspectorFields.js';
import { imageLabelKey } from './imageLabels.js';
import { LAYER_ICON } from './ImageLayersPanel.js';

interface InspectorLayerProps {
  doc: ImageDocument;
  layer: ImageLayer;
  /** 종류·출처 표시 키(가져온 사진 · 3D 렌더 · 연결 원본 · 글자 · 도형). */
  originKey: string;
  onChange: (doc: ImageDocument, group?: string) => void;
  onEndEdit: () => void;
}

/** `color-dodge` → `blendColorDodge` — 혼합 모드 이름 번역 키. */
export const blendKey = (mode: ImageBlendMode): string => `blend${mode.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())}`;

/** §5.13 (R-9) 레이어 편집기 ⑤ — 레이어 머리(이름·잠금) · 변형 · 레이어(불투명도·혼합). 나머지 묶음은 `InspectorStyle`. */
export function InspectorLayer({ doc, layer, originKey, onChange, onEndEdit }: InspectorLayerProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const [linked, setLinked] = useState<{ id: string; on: boolean } | null>(null);
  const keepRatio = linked?.id === layer.id ? linked.on : layer.kind === 'image';
  const set = (patch: Partial<ImageLayer>, group?: string): void => onChange(patchImageLayer(doc, layer.id, patch), group);
  const preview = (field: string) => (patch: Partial<ImageLayer>): void => set(patch, `scrub:${field}:${layer.id}`);
  const ratio = layer.width / layer.height;
  const size = (field: 'width' | 'height', value: number): Partial<ImageLayer> => !keepRatio ? { [field]: value }
    : field === 'width' ? { width: value, height: Math.max(1, value / ratio) } : { height: value, width: Math.max(1, value * ratio) };
  const locked = layer.locked;
  return <>
    <InspectorGroup>
      <div className="flex items-center gap-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-800 bg-gray-950 text-gray-300">
          <EditorIcon name={LAYER_ICON(layer)} className="h-4 w-4" />
        </span>
        <input aria-label={key('name')} value={layer.name} disabled={locked} onBlur={onEndEdit}
          className="h-7 min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-950 px-2 text-xs font-medium text-gray-100 outline-none focus:border-blue-500 disabled:text-gray-400"
          onChange={(e) => set({ name: e.target.value }, `name:${layer.id}`)} />
        <EditorButton icon={locked ? 'lock' : 'unlock'} label={key('lock')} active={locked} onClick={() => set({ locked: !locked })} />
      </div>
      <p className="text-xs text-gray-500">{key(originKey)}</p>
      {locked && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">{key('lockedHint')}</p>}
    </InspectorGroup>
    <InspectorGroup title={key('transform')}>
      <div className="grid grid-cols-2 gap-1.5">
        {(['x', 'y'] as const).map((field) => <InspectorNumber key={field} label={key(field)} caption={field.toUpperCase()} value={layer[field]} disabled={locked}
          onCommit={(v) => set({ [field]: v })} onPreview={(v) => preview(field)({ [field]: v })} onEnd={onEndEdit} />)}
        {(['width', 'height'] as const).map((field) => <InspectorNumber key={field} label={key(field)} caption={field === 'width' ? 'W' : 'H'} value={layer[field]}
          min={1} disabled={locked} onCommit={(v) => set(size(field, v))} onPreview={(v) => preview('size')(size(field, v))} onEnd={onEndEdit} />)}
      </div>
      <div className="flex items-center gap-0.5">
        <div className="mr-1 min-w-0 flex-1">
          <InspectorNumber label={key('rotation')} caption={<EditorIcon name="rotate" className="h-3 w-3" />} unit="°" value={layer.rotation ?? 0}
            min={-360} max={360} digits={1} disabled={locked} onCommit={(v) => set({ rotation: v })} onPreview={(v) => preview('rotation')({ rotation: v })} onEnd={onEndEdit} />
        </div>
        <EditorButton icon={keepRatio ? 'link' : 'unlink'} label={key('keepRatio')} active={keepRatio} disabled={locked}
          onClick={() => setLinked({ id: layer.id, on: !keepRatio })} />
        <EditorButton icon="flipH" label={key('flipHorizontal')} active={!!layer.flipX} disabled={locked} onClick={() => set({ flipX: !layer.flipX })} />
        <EditorButton icon="flipV" label={key('flipVertical')} active={!!layer.flipY} disabled={locked} onClick={() => set({ flipY: !layer.flipY })} />
      </div>
    </InspectorGroup>
    <InspectorGroup title={key('layer')}>
      <div className="flex items-center gap-2">
        <InspectorSlider label={key('opacity')} value={layer.opacity} disabled={locked} onPreview={(v) => set({ opacity: v }, `opacity:${layer.id}`)} onEnd={onEndEdit} />
        <div className="w-20 shrink-0">
          <InspectorNumber label={key('opacity')} caption={<EditorIcon name="opacity" className="h-3 w-3" />} unit="%" value={Math.round(layer.opacity * 100)}
            min={0} max={100} digits={0} disabled={locked} onCommit={(v) => set({ opacity: v / 100 })} />
        </div>
      </div>
      <InspectorRow label={key('blend')}>
        <select className={SELECT} aria-label={key('blend')} value={layer.blend ?? 'normal'} disabled={locked}
          onChange={(e) => set({ blend: e.target.value === 'normal' ? undefined : e.target.value as ImageBlendMode })}>
          {IMAGE_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{key(blendKey(mode))}</option>)}
        </select>
      </InspectorRow>
    </InspectorGroup>
  </>;
}
