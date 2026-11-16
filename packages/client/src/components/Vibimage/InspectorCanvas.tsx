import { useTranslation } from 'react-i18next';
import type { ColorPhase } from '../Creation/ColorField.js';
import { IMAGE_LIMITS, applyImageStyle, type ImageDocument } from '../Creation/imageSource.js';
import { EditorButton } from './editorControls.js';
import { InspectorColor, InspectorGroup, InspectorNumber, InspectorRow, SELECT } from './InspectorFields.js';
import { imageLabelKey } from './imageLabels.js';

/** 판형 프리셋(가로×세로 px) — 숫자만 보여 줘 번역이 필요 없다. 목록 밖 크기는 W·H 칸으로. */
const CANVAS_PRESETS: readonly (readonly [number, number])[] = [
  [1920, 1080], [1280, 720], [3840, 2160], [1080, 1080], [1080, 1350], [1080, 1920], [1200, 630], [1500, 500], [1024, 1024], [512, 512], [2480, 3508],
];

interface InspectorCanvasProps {
  doc: ImageDocument;
  onChange: (doc: ImageDocument, group?: string) => void;
  onEndEdit: () => void;
}

/** §5.13 (R-9) 레이어 편집기 ⑤ — 아무것도 안 골랐을 때: 문서 크기·판형·배경·재사용 스타일. */
export function InspectorCanvas({ doc, onChange, onEndEdit }: InspectorCanvasProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const size = (width: number, height: number): void => onChange({ ...doc, width: Math.round(width), height: Math.round(height) });
  const color = (field: string, apply: (value: string) => ImageDocument) => (value: string, phase: ColorPhase): void => {
    onChange(apply(value), field);
    if (phase === 'commit') onEndEdit();
  };
  const preset = CANVAS_PRESETS.findIndex(([w, h]) => w === doc.width && h === doc.height);
  const transparent = doc.background === 'transparent';
  return <>
    <InspectorGroup title={key('canvasSize')}>
      <select className={SELECT} aria-label={key('canvasPreset')} value={preset} onChange={(e) => { const p = CANVAS_PRESETS[Number(e.target.value)]; if (p) size(p[0], p[1]); }}>
        <option value={-1}>{key('canvasPreset')}</option>
        {CANVAS_PRESETS.map(([w, h], i) => <option key={`${w}x${h}`} value={i}>{`${w} × ${h}`}</option>)}
      </select>
      <div className="flex items-center gap-1.5">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          <InspectorNumber label={key('width')} caption="W" value={doc.width} min={IMAGE_LIMITS.minSize} max={IMAGE_LIMITS.maxSize} digits={0}
            onCommit={(v) => size(v, doc.height)} />
          <InspectorNumber label={key('height')} caption="H" value={doc.height} min={IMAGE_LIMITS.minSize} max={IMAGE_LIMITS.maxSize} digits={0}
            onCommit={(v) => size(doc.width, v)} />
        </div>
        <EditorButton icon="rotate" label={key('swapOrientation')} disabled={doc.width === doc.height} onClick={() => size(doc.height, doc.width)} />
      </div>
    </InspectorGroup>
    <InspectorGroup title={key('background')} actions={
      <button type="button" role="switch" aria-checked={transparent} aria-label={key('transparent')} title={key('transparent')}
        onClick={() => onChange({ ...doc, background: transparent ? '#ffffff' : 'transparent' })}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
        <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${transparent ? 'bg-blue-600' : 'bg-gray-700'}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${transparent ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        {key('transparent')}
      </button>}>
      {!transparent && <InspectorColor label={key('background')} value={doc.background} onChange={color('background', (background) => ({ ...doc, background }))} />}
    </InspectorGroup>
    <InspectorGroup title={key('projectStyle')}>
      <InspectorRow label={key('font')}>
        <input aria-label={key('font')} value={doc.style.fontFamily} onBlur={onEndEdit}
          className="h-7 w-full min-w-0 rounded-md border border-gray-800 bg-gray-950 px-2 text-xs text-gray-100 outline-none focus:border-blue-500 pointer-coarse:h-9"
          onChange={(e) => onChange({ ...doc, style: { ...doc.style, fontFamily: e.target.value } }, 'style:font')} />
      </InspectorRow>
      <InspectorRow label={key('color')}>
        <InspectorColor label={key('color')} value={doc.style.foreground} onChange={color('style:foreground', (foreground) => ({ ...doc, style: { ...doc.style, foreground } }))} />
      </InspectorRow>
      <InspectorRow label={key('accent')}>
        <InspectorColor label={key('accent')} value={doc.style.accent} onChange={color('style:accent', (accent) => ({ ...doc, style: { ...doc.style, accent } }))} />
      </InspectorRow>
      <InspectorRow label={key('margin')}>
        <InspectorNumber label={key('margin')} caption="M" value={doc.style.margin} min={0} digits={0}
          onCommit={(margin) => onChange({ ...doc, style: { ...doc.style, margin } })} />
      </InspectorRow>
      <button type="button" onClick={() => onChange(applyImageStyle(doc, doc.style))}
        className="h-8 rounded-md border border-gray-800 bg-gray-950 text-xs text-gray-200 hover:bg-gray-800 pointer-coarse:h-10">{key('applyStyleToLayers')}</button>
    </InspectorGroup>
  </>;
}
