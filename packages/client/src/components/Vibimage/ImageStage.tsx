import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { patchImageLayer, type ImageDocument } from '../Creation/imageSource.js';
import { imageSvgBody, resolveImageSources } from '../Creation/imageRender.js';
import { defaultTextMeasure, resetImageTextMeasure } from '../Creation/imageText.js';
import { imageStageLevels, type ImageInspectContext } from './imageInspect.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageStageProps {
  root: string;
  doc: ImageDocument;
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: (doc: ImageDocument) => void;
  /** §5.4 #15 (C) — Alt 인스펙터가 무대 안의 레이어를 집는다(어느 원본의 어느 레이어인지 복사 글에 싣는다). */
  inspect?: ImageInspectContext | null;
  /** 부모 배치가 무대 상자에 덧붙이는 클래스 — 좁은 창에서 격자 칸을 정하는 데만 쓴다(무대 자체 모양은 그대로). */
  className?: string;
}

/** Re-measure text when a font finishes loading (widths of the fallback face are not the real ones). */
function useFontVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return undefined;
    const bump = (): void => { resetImageTextMeasure(); setVersion((v) => v + 1); };
    fonts.addEventListener('loadingdone', bump);
    return () => fonts.removeEventListener('loadingdone', bump);
  }, []);
  return version;
}

export function ImageStage({ root, doc, selected, onSelect, onChange, inspect, className = '' }: ImageStageProps): React.JSX.Element {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; resize: boolean; original: ImageDocument } | null>(null);
  const [preview, setPreview] = useState<ImageDocument | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const fontVersion = useFontVersion();
  useEffect(() => { drag.current = null; setPreview(null); }, [doc]);
  // Pictures are read again only when the set of picture sources changes, not on every edit.
  const sourceKey = useMemo(() => doc.layers.filter((layer) => layer.kind === 'image').map((layer) => layer.source ?? '').join('\u0000'), [doc.layers]);
  useEffect(() => {
    let cancelled = false;
    void resolveImageSources(doc, root).then((next) => { if (!cancelled) { setSources(next.sources); setFailed(next.failed); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, sourceKey]);
  const shown = preview ?? doc;
  // 레이어는 SVG 속 HTML 로 그린 요소라 브라우저는 그 도형을 집는다 — 판 안쪽까지 받는다(subtree).
  useInspectorPicker(svg, inspect ? (at) => imageStageLevels(shown, inspect, { canvas: t(imageLabelKey('canvas')) }, at) : null, { subtree: true });
  // The same function and measurer the SVG and PNG exports use — the lines break identically.
  const body = useMemo(() => imageSvgBody(shown, sources, defaultTextMeasure()), [shown, sources, fontVersion]);
  const layer = shown.layers.find((item) => item.id === selected);
  const point = (event: React.PointerEvent): DOMPoint | null => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  };
  const end = (cancelled: boolean): void => {
    if (drag.current?.original === doc && preview && !cancelled) onChange?.(preview);
    drag.current = null; setPreview(null);
  };
  return <div className={`relative flex min-h-40 min-w-0 flex-1 items-center justify-center overflow-hidden bg-alpha-checker p-5 box-narrow:p-3 ${className}`}>
    <svg ref={svg} viewBox={`0 0 ${shown.width} ${shown.height}`} className="h-full w-full touch-none select-none"
      role="img" aria-label={t('panel.apps.vibimage.viewport')}
      onPointerDown={(event) => {
        if (!onSelect || event.button !== 0) return;
        const target = event.target as Element;
        const id = target.closest('[data-layer-id]')?.getAttribute('data-layer-id') ?? '';
        onSelect(id);
        const item = doc.layers.find((entry) => entry.id === id);
        const at = point(event);
        if (!item || item.locked || !at || !onChange) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id, x: at.x, y: at.y, resize: target.hasAttribute('data-resize'), original: doc };
      }}
      onPointerMove={(event) => {
        const state = drag.current; const at = point(event); if (!state || !at) return;
        const item = state.original.layers.find((entry) => entry.id === state.id)!;
        const dx = at.x - state.x; const dy = at.y - state.y;
        setPreview(patchImageLayer(state.original, state.id, state.resize
          ? { width: Math.max(1, item.width + dx), height: Math.max(1, item.height + dy) }
          : { x: item.x + dx, y: item.y + dy }));
      }} onPointerUp={() => end(false)} onPointerCancel={() => end(true)}>
      <g dangerouslySetInnerHTML={{ __html: body }} />
      {layer && <g data-layer-id={layer.id} className="text-sky-400">
        <rect x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill="none" stroke="currentColor" strokeWidth="2"
          vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {!layer.locked && onChange && <rect data-resize="true" x={layer.x + layer.width - 10} y={layer.y + layer.height - 10} width="20" height="20"
          fill="currentColor" className="cursor-se-resize" />}
      </g>}
    </svg>
    {failed.length > 0 && <p role="alert" className="absolute bottom-2 rounded bg-gray-950 px-3 py-1 text-xs text-amber-200">
      {t('panel.apps.vibimage.editor.picturesMissing', { count: failed.length })}
    </p>}
  </div>;
}
