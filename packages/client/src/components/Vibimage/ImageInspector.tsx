import { useTranslation } from 'react-i18next';
import { ScrollFade } from '../ScrollFade.js';
import { NumberField } from '../Creation/NumberField.js';
import { ColorField, type ColorPhase } from '../Creation/ColorField.js';
import { applyImageStyle, patchImageLayer, reorderImageLayer, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { imageLabelKey } from './imageLabels.js';

/** Where a picture layer comes from (shown to the user; a 3D render is not "an imported photo"). */
export type ImageLayerOrigin = 'import' | 'model-render' | 'linked-image';

interface ImageInspectorProps {
  doc: ImageDocument;
  selected: string;
  /** One edit; edits sharing `key` (typing in one field, one colour drag) are one undo step. */
  onChange: (doc: ImageDocument, key?: string) => void;
  /** Ends the current grouped edit (focus left the field, the drag ended). */
  onEndEdit: () => void;
  origin: (layerId: string) => ImageLayerOrigin;
  /** 부모 배치가 덧붙이는 클래스 — 좁은 창에서 속성 칸을 무대 아래로 옮길 때 쓴다(넓은 창은 오른쪽 칸 그대로). */
  className?: string;
}
// 손가락(pointer: coarse)이면 입력·단추를 32px 이상으로 — 마우스 화면의 촘촘함은 그대로 둔다.
const INPUT = 'min-w-0 rounded border border-white/15 bg-gray-900 px-2 py-1 text-xs text-gray-100 pointer-coarse:py-2';
const FIELD = 'flex min-w-0 flex-col gap-1 text-xs text-gray-300';
const ORIGIN_KEY: Readonly<Record<ImageLayerOrigin, string>> = { import: 'importedImage', 'model-render': 'modelRender', 'linked-image': 'linkedImage' };

export function ImageInspector({ doc, selected, onChange, onEndEdit, origin, className = '' }: ImageInspectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = (label: string): string => t(imageLabelKey(label));
  const layer = doc.layers.find((item) => item.id === selected);
  const patch = (changes: Partial<ImageLayer>, group?: string): void => { if (layer) onChange(patchImageLayer(doc, layer.id, changes), group); };
  const color = (field: string, apply: (value: string) => ImageDocument) => (value: string, phase: ColorPhase): void => {
    onChange(apply(value), field);
    if (phase === 'commit') onEndEdit();
  };
  const number = (field: 'x' | 'y' | 'width' | 'height' | 'opacity', min?: number, max?: number) => layer && <NumberField key={field}
    label={key(field)} value={layer[field]} min={min} max={max} className={FIELD} inputClassName={INPUT}
    onCommit={(value) => patch({ [field]: value })} />;
  return <aside className={`flex w-56 shrink-0 flex-col border-l border-white/10 bg-gray-950 p-3 text-xs ${className}`}>
    <ScrollFade fill>
      <div className="flex flex-col gap-3">
        <strong>{key(layer ? 'properties' : 'canvas')}</strong>
        {layer ? <>
          <label className={FIELD}>{key('name')}
            <input className={INPUT} value={layer.name} disabled={layer.locked} onBlur={onEndEdit}
              onChange={(e) => patch({ name: e.target.value }, `name:${layer.id}`)} />
          </label>
          <span className="text-gray-400">{key(layer.kind === 'image' ? ORIGIN_KEY[origin(layer.id)] : layer.kind)}</span>
          <label className="flex items-center gap-2"><input type="checkbox" checked={layer.locked} onChange={(e) => patch({ locked: e.target.checked })} />{key('lock')}</label>
          <fieldset disabled={layer.locked} className="flex flex-col gap-3 disabled:opacity-50">
            <div className="grid grid-cols-2 gap-2">
              {number('x')}{number('y')}{number('width', 1)}{number('height', 1)}{number('opacity', 0, 1)}
            </div>
            {layer.kind !== 'image' && <label className="flex items-center justify-between">{key('color')}
              <ColorField label={key('color')} value={layer.fill} disabled={layer.locked}
                onChange={color(`fill:${layer.id}`, (fill) => patchImageLayer(doc, layer.id, { fill }))} />
            </label>}
            {layer.kind === 'image' && <label className={FIELD}>{key('fit')}
              <select className={INPUT} value={layer.fit ?? 'contain'} onChange={(e) => patch({ fit: e.target.value as ImageLayer['fit'] })}>
                <option value="contain">{key('fitContain')}</option><option value="cover">{key('fitCover')}</option>
              </select>
            </label>}
            {layer.kind === 'text' && <>
              <label className={FIELD}>{key('text')}
                <textarea className={`${INPUT} scrollbar-thin`} rows={3} value={layer.text} onBlur={onEndEdit}
                  onChange={(e) => patch({ text: e.target.value }, `text:${layer.id}`)} />
              </label>
              <label className={FIELD}>{key('font')}
                <input className={INPUT} value={layer.fontFamily} onBlur={onEndEdit} onChange={(e) => patch({ fontFamily: e.target.value }, `font:${layer.id}`)} />
              </label>
              <NumberField label={key('fontSize')} value={layer.fontSize ?? 64} min={1} max={8192} className={FIELD} inputClassName={INPUT}
                onCommit={(value) => patch({ fontSize: value })} />
              <select aria-label={key('alignment')} className={INPUT} value={layer.align} onChange={(e) => patch({ align: e.target.value as ImageLayer['align'] })}>
                {(['left', 'center', 'right'] as const).map((v) => <option key={v} value={v}>{key(v)}</option>)}
              </select>
            </>}
            {layer.kind === 'shape' && <select className={INPUT} aria-label={key('shape')} value={layer.shape} onChange={(e) => patch({ shape: e.target.value as ImageLayer['shape'] })}>
              <option value="rect">{key('rectangle')}</option><option value="ellipse">{key('ellipse')}</option>
            </select>}
            <label className={FIELD}>{key('anchor')}<select className={INPUT} value={layer.anchor} onChange={(e) => patch({ anchor: e.target.value as ImageLayer['anchor'] })}>
              {(['start', 'center', 'end'] as const).map((v) => <option value={v} key={v}>{key(v)}</option>)}
            </select></label>
            <button type="button" className={INPUT} onClick={() => patch({ x: (doc.width - layer.width) / 2 })}>{key('centerHorizontal')}</button>
            <button type="button" className={INPUT} onClick={() => patch({ y: (doc.height - layer.height) / 2 })}>{key('centerVertical')}</button>
            <button type="button" className={INPUT} onClick={() => onChange(reorderImageLayer(doc, layer.id, 1))}>{key('forward')}</button>
            <button type="button" className={INPUT} onClick={() => onChange(reorderImageLayer(doc, layer.id, -1))}>{key('backward')}</button>
            <label className="flex items-center gap-2"><input type="checkbox" checked={layer.visible} onChange={(e) => patch({ visible: e.target.checked })} />{key('visible')}</label>
          </fieldset>
        </> : <>
          {(['width', 'height'] as const).map((field) => <NumberField key={field} label={key(field)} value={doc[field]} min={16} max={8192}
            className={FIELD} inputClassName={INPUT} onCommit={(value) => onChange({ ...doc, [field]: Math.round(value) })} />)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={doc.background === 'transparent'}
            onChange={(e) => onChange({ ...doc, background: e.target.checked ? 'transparent' : '#ffffff' })} />{key('transparent')}</label>
          {doc.background !== 'transparent' && <ColorField label={key('background')} value={doc.background}
            onChange={color('background', (background) => ({ ...doc, background }))} />}
          <strong>{key('projectStyle')}</strong>
          <label className={FIELD}>{key('font')}
            <input className={INPUT} value={doc.style.fontFamily} onBlur={onEndEdit}
              onChange={(e) => onChange({ ...doc, style: { ...doc.style, fontFamily: e.target.value } }, 'style:font')} />
          </label>
          <label className="flex justify-between">{key('color')}
            <ColorField label={key('color')} value={doc.style.foreground} onChange={color('style:foreground', (foreground) => ({ ...doc, style: { ...doc.style, foreground } }))} />
          </label>
          <label className="flex justify-between">{key('accent')}
            <ColorField label={key('accent')} value={doc.style.accent} onChange={color('style:accent', (accent) => ({ ...doc, style: { ...doc.style, accent } }))} />
          </label>
          <NumberField label={key('margin')} value={doc.style.margin} min={0} className={FIELD} inputClassName={INPUT}
            onCommit={(margin) => onChange({ ...doc, style: { ...doc.style, margin } })} />
          <button type="button" className={INPUT} onClick={() => onChange(applyImageStyle(doc, doc.style))}>{key('applyStyleToLayers')}</button>
        </>}
      </div>
    </ScrollFade>
  </aside>;
}
