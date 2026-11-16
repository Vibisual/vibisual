import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColorPhase } from '../Creation/ColorField.js';
import { patchImageLayer, type ImageDocument, type ImageLayer, type ImageShadow } from '../Creation/imageSource.js';
import { IMAGE_LINE_HEIGHT } from '../Creation/imageText.js';
import { EditorButton, Segmented } from './editorControls.js';
import { EditorIcon } from './editorIcons.js';
import { InspectorColor, InspectorGroup, InspectorNumber, InspectorRow, SELECT } from './InspectorFields.js';
import { imageLabelKey } from './imageLabels.js';

/** 세 OS 에 흔한 글꼴 + 한글 기본 글꼴. 목록 밖 이름도 그대로 쓸 수 있다(글꼴 스택이 OS 한글 글꼴로 이어진다). */
const FONT_CHOICES = [
  'Arial, sans-serif', 'Helvetica, Arial, sans-serif', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Segoe UI, sans-serif',
  'Georgia, serif', 'Times New Roman, serif', 'Courier New, monospace', 'Impact, sans-serif', 'system-ui, sans-serif',
  'Malgun Gothic, sans-serif', 'Apple SD Gothic Neo, sans-serif', 'Noto Sans KR, sans-serif', 'Noto Serif KR, serif',
] as const;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const DEFAULT_SHADOW: ImageShadow = { color: '#000000', opacity: 0.35, x: 0, y: 8, blur: 24 };

interface InspectorStyleProps {
  doc: ImageDocument;
  layer: ImageLayer;
  onChange: (doc: ImageDocument, group?: string) => void;
  onEndEdit: () => void;
  onTools: () => void;
}

/** §5.13 (R-9) 레이어 편집기 ⑤ — 모양(채우기·테두리·둥글기) · 글자 · 그림 · 그림자 · 파생 기준. 잠긴 레이어는 전부 꺼진다. */
export function InspectorStyle({ doc, layer, onChange, onEndEdit, onTools }: InspectorStyleProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const fonts = useId();
  const locked = layer.locked;
  const set = (patch: Partial<ImageLayer>, group?: string): void => onChange(patchImageLayer(doc, layer.id, patch), group);
  const scrub = (field: string) => ({ onPreview: (v: number) => set({ [field]: v }, `scrub:${field}:${layer.id}`), onEnd: onEndEdit });
  const color = (field: string, patch: (value: string) => Partial<ImageLayer>) => (value: string, phase: ColorPhase): void => {
    set(patch(value), `${field}:${layer.id}`);
    if (phase === 'commit') onEndEdit();
  };
  const shadow = layer.shadow;
  const setShadow = (patch: Partial<ImageShadow>, group?: string): void => set({ shadow: { ...(shadow ?? DEFAULT_SHADOW), ...patch } }, group);
  const strokeWidth = layer.strokeWidth ?? 0;
  return <>
    {layer.kind !== 'image' && <InspectorGroup title={key('appearance')}>
      {layer.kind === 'shape' && <Segmented label={key('shape')} value={layer.shape} disabled={locked} onChange={(shape) => set({ shape })}
        options={[{ value: 'rect', label: key('rectangle'), icon: 'rect' }, { value: 'ellipse', label: key('ellipse'), icon: 'ellipse' }]} />}
      <InspectorRow label={key('fill')}>
        <InspectorColor label={key('fill')} value={layer.fill} disabled={locked} onChange={color('fill', (fill) => ({ fill }))} />
      </InspectorRow>
      <InspectorRow label={key('stroke')}>
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-1.5">
          <InspectorColor label={key('stroke')} value={layer.stroke ?? '#000000'} disabled={locked}
            onChange={color('stroke', (stroke) => ({ stroke, ...(strokeWidth > 0 ? {} : { strokeWidth: layer.kind === 'text' ? 2 : 4 }) }))} />
          <InspectorNumber label={key('strokeWidth')} caption="W" value={strokeWidth} min={0} max={1000} digits={1} disabled={locked}
            onCommit={(v) => set({ strokeWidth: v, ...(v > 0 && !layer.stroke ? { stroke: '#000000' } : {}) })} {...scrub('strokeWidth')} />
        </div>
      </InspectorRow>
      {layer.kind === 'shape' && layer.shape !== 'ellipse' && <InspectorRow label={key('radius')}>
        <InspectorNumber label={key('radius')} caption={<EditorIcon name="radius" className="h-3 w-3" />} value={layer.radius ?? 0} min={0} max={8192} digits={1}
          disabled={locked} onCommit={(v) => set({ radius: v })} {...scrub('radius')} />
      </InspectorRow>}
    </InspectorGroup>}
    {layer.kind === 'text' && <InspectorGroup title={key('typography')}>
      <textarea aria-label={key('text')} className="scrollbar-thin min-h-16 w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50"
        rows={3} value={layer.text} disabled={locked} onBlur={onEndEdit} onChange={(e) => set({ text: e.target.value }, `text:${layer.id}`)} />
      <input list={fonts} aria-label={key('font')} title={key('font')} value={layer.fontFamily} disabled={locked} onBlur={onEndEdit}
        className="h-7 w-full min-w-0 rounded-md border border-gray-800 bg-gray-950 px-2 text-xs text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50 pointer-coarse:h-9"
        onChange={(e) => set({ fontFamily: e.target.value }, `font:${layer.id}`)} />
      <datalist id={fonts}>{FONT_CHOICES.map((font) => <option key={font} value={font} />)}</datalist>
      <div className="grid grid-cols-2 gap-1.5">
        <InspectorNumber label={key('fontSize')} caption={<EditorIcon name="text" className="h-3 w-3" />} unit="px" value={layer.fontSize ?? 64} min={1} max={8192}
          disabled={locked} onCommit={(v) => set({ fontSize: v })} {...scrub('fontSize')} />
        <select className={SELECT} aria-label={key('fontWeight')} title={key('fontWeight')} value={layer.fontWeight ?? 400} disabled={locked}
          onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
          {WEIGHTS.map((w) => <option key={w} value={w}>{`${w} · ${key(`weight${w}`)}`}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Segmented label={key('alignment')} value={layer.align} disabled={locked} onChange={(align) => set({ align })} options={[
            { value: 'left', label: key('left'), icon: 'textLeft' }, { value: 'center', label: key('center'), icon: 'textCenter' },
            { value: 'right', label: key('right'), icon: 'textRight' }]} />
        </div>
        <EditorButton icon="italic" label={key('italic')} active={!!layer.italic} disabled={locked} onClick={() => set({ italic: !layer.italic })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <InspectorNumber label={key('lineHeight')} caption={<EditorIcon name="lineHeight" className="h-3 w-3" />} value={layer.lineHeight ?? IMAGE_LINE_HEIGHT}
          min={0.5} max={5} step={0.05} disabled={locked} onCommit={(v) => set({ lineHeight: v })} {...scrub('lineHeight')} />
        <InspectorNumber label={key('letterSpacing')} caption={<EditorIcon name="letterSpacing" className="h-3 w-3" />} unit="px" value={layer.letterSpacing ?? 0}
          min={-1000} max={1000} step={0.5} digits={1} disabled={locked} onCommit={(v) => set({ letterSpacing: v || undefined })} {...scrub('letterSpacing')} />
      </div>
    </InspectorGroup>}
    {layer.kind === 'image' && <InspectorGroup title={key('picture')}>
      <InspectorRow label={key('fit')}>
        <Segmented label={key('fit')} value={layer.fit ?? 'contain'} disabled={locked} onChange={(fit) => set({ fit })}
          options={[{ value: 'contain', label: key('fitContain'), icon: 'fitContain' }, { value: 'cover', label: key('fitCover'), icon: 'fitCover' }]} />
      </InspectorRow>
      <button type="button" disabled={locked} onClick={onTools}
        className="flex h-8 items-center justify-center gap-2 rounded-md border border-gray-800 bg-gray-950 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50 pointer-coarse:h-10">
        <EditorIcon name="wand" className="h-3.5 w-3.5" />{key('photoTools')}
      </button>
    </InspectorGroup>}
    <InspectorGroup title={key('shadow')} actions={
      <button type="button" role="switch" aria-checked={!!shadow} aria-label={key('shadow')} disabled={locked}
        onClick={() => set({ shadow: shadow ? undefined : { ...DEFAULT_SHADOW } })}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${shadow ? 'bg-blue-600' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${shadow ? 'left-3.5' : 'left-0.5'}`} />
      </button>}>
      {shadow && <>
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-1.5">
          <InspectorColor label={key('shadowColor')} value={shadow.color} disabled={locked}
            onChange={(value, phase) => { setShadow({ color: value }, `shadow:${layer.id}`); if (phase === 'commit') onEndEdit(); }} />
          <InspectorNumber label={key('opacity')} caption={<EditorIcon name="opacity" className="h-3 w-3" />} unit="%" value={Math.round(shadow.opacity * 100)}
            min={0} max={100} digits={0} disabled={locked} onCommit={(v) => setShadow({ opacity: v / 100 })} />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y'] as const).map((field) => <InspectorNumber key={field} label={key(field === 'x' ? 'shadowX' : 'shadowY')} caption={field.toUpperCase()}
            value={shadow[field]} min={-8192} max={8192} disabled={locked} onCommit={(v) => setShadow({ [field]: v })}
            onPreview={(v) => setShadow({ [field]: v }, `scrub:shadow:${layer.id}`)} onEnd={onEndEdit} />)}
          <InspectorNumber label={key('blur')} caption={<EditorIcon name="blur" className="h-3 w-3" />} value={shadow.blur} min={0} max={1000} disabled={locked}
            onCommit={(v) => setShadow({ blur: v })} onPreview={(v) => setShadow({ blur: v }, `scrub:shadow:${layer.id}`)} onEnd={onEndEdit} />
        </div>
      </>}
    </InspectorGroup>
    <InspectorGroup title={key('anchor')}>
      <Segmented label={key('anchor')} value={layer.anchor} disabled={locked} onChange={(anchor) => set({ anchor })}
        options={[{ value: 'start', label: key('start') }, { value: 'center', label: key('center') }, { value: 'end', label: key('end') }]} />
    </InspectorGroup>
  </>;
}
