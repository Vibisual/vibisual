import { useEffect, useRef } from 'react';
import { runEnterKey } from '../../hooks/useEnterSubmit.js';
import { IME_ENTER_OWNER } from '../../utils/inputComposition.js';
import { imageLayerTransform, wrapImageText } from '../Creation/imageRender.js';
import { imageLayerFont, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { IMAGE_LINE_HEIGHT, defaultTextMeasure } from '../Creation/imageText.js';

interface StageTextEditorProps {
  doc: ImageDocument;
  layer: ImageLayer;
  onChange: (text: string) => void;
  onDone: () => void;
}

/**
 * §5.13 (R-9) 레이어 편집기 ③ — 글자 레이어를 그 자리에서 고친다. 같은 글꼴 문자열·줄 간격·자간·회전으로 SVG 그림 위에 겹쳐,
 * 끝내면(Esc·Ctrl/⌘+Enter·바깥 누르기) 그 레이어가 다시 SVG 로 그려진다. 글꼴 치수는 레이어마다 달라 style 로만 줄 수 있다.
 */
export function StageTextEditor({ doc, layer, onChange, onDone }: StageTextEditorProps): React.JSX.Element {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = area.current; if (el) { el.focus(); el.select(); } }, [layer.id]);
  const size = layer.fontSize ?? 64;
  const lineHeight = layer.lineHeight ?? IMAGE_LINE_HEIGHT;
  const lines = Math.max(1, wrapImageText(layer, defaultTextMeasure(), doc.style.fontFamily).length + 1);
  const height = Math.max(layer.height, lines * size * lineHeight);
  const transform = imageLayerTransform(layer);
  return <foreignObject x={layer.x} y={layer.y} width={layer.width} height={height} transform={transform || undefined}>
    <textarea ref={area} value={layer.text ?? ''} spellCheck={false} aria-label={layer.name} {...IME_ENTER_OWNER}
      className="block h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 caret-blue-500 outline-none ring-1 ring-blue-500/60"
      style={{
        font: imageLayerFont(layer, doc.style.fontFamily), lineHeight, color: layer.fill, opacity: layer.opacity,
        letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined, textAlign: layer.align ?? 'left',
        // SVG 의 첫 기준선은 y + 글자 크기 — 줄 간격이 1 보다 작으면 줄 상자가 그보다 위로 올라가 그만큼 내린다.
        paddingTop: Math.max(0, size - size * lineHeight) / 2,
      }}
      onChange={(event) => onChange(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        // 맨 Enter 는 줄바꿈, Ctrl/⌘+Enter 는 끝내기 — 한글 조합 중 Enter 판정은 공용 집행(§6)에 맡긴다.
        if (event.key === 'Escape') { event.preventDefault(); onDone(); return; }
        runEnterKey(event, () => onDone(), 'chord');
      }}
      onBlur={onDone} />
  </foreignObject>;
}
