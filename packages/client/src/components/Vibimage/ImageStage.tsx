import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import type { ImageDocument, ImageLayer } from '../Creation/imageSource.js';
import { imageSvgLayer, resolveImageSources } from '../Creation/imageRender.js';
import { defaultTextMeasure, resetImageTextMeasure } from '../Creation/imageText.js';
import { imageStageLevels, type ImageInspectContext } from './imageInspect.js';
import { imageLabelKey } from './imageLabels.js';
import type { Box, Point } from './imageGeometry.js';
import { viewBoxOf } from './editorViewport.js';
import type { DrawTool, EditorTool } from './editorTools.js';
import { useEditorViewport, type EditorViewport } from './useEditorViewport.js';
import { useStageGestures } from './useStageGestures.js';
import { StageOverlay } from './StageOverlay.js';
import { StageTextEditor } from './StageTextEditor.js';
import type { CursorStore } from './editorCursor.js';

interface ImageStageProps {
  root: string;
  doc: ImageDocument;
  /** 아래 편집 손잡이가 없으면 보기 전용 무대(시안 비교) — 끌면 화면만 움직인다. */
  selection?: readonly string[];
  onSelect?: (ids: string[]) => void;
  onChange?: (doc: ImageDocument) => void;
  tool?: EditorTool;
  onDraw?: (tool: DrawTool, box: Box | null, at: Point) => void;
  editingText?: string | null;
  onEditText?: (id: string | null) => void;
  onTextChange?: (id: string, text: string) => void;
  /** 상태 막대와 나눠 쓰는 배율 — 없으면 무대가 제 것을 쓴다. */
  viewport?: EditorViewport;
  cursor?: CursorStore;
  /** §5.4 #15 (C) — Alt 인스펙터가 무대 안의 레이어를 집는다(어느 원본의 어느 레이어인지 복사 글에 싣는다). */
  inspect?: ImageInspectContext | null;
  /** 부모 배치가 무대 상자에 덧붙이는 클래스 — 좁은 창에서 격자 칸을 정하는 데만 쓴다. */
  className?: string;
}

const TOOL_CURSOR: Readonly<Record<EditorTool, string>> = {
  move: 'cursor-default', hand: 'cursor-grab', zoom: 'cursor-zoom-in', text: 'cursor-text', rect: 'cursor-crosshair', ellipse: 'cursor-crosshair',
};

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

/** One `<g>` per layer; its markup is cached by layer identity, so an edit re-parses only the layers it changed. */
function useLayerMarkup(doc: ImageDocument, sources: Record<string, string>, fontVersion: number, idScope: string): (layer: ImageLayer) => string {
  const cache = useRef(new WeakMap<ImageLayer, { key: string; html: string }>());
  return (layer) => {
    const key = `${fontVersion}\u0000${doc.style.fontFamily}\u0000${layer.kind === 'image' ? sources[layer.source ?? ''] ?? '' : ''}`;
    const hit = cache.current.get(layer);
    if (hit?.key === key) return hit.html;
    // The same function the SVG and PNG exports join (`imageSvgBody`) — the screen and the files break lines identically.
    const html = imageSvgLayer(doc, layer, sources, defaultTextMeasure(), idScope);
    cache.current.set(layer, { key, html });
    return html;
  };
}

/** §5.13 (R-9) 레이어 편집기 ② — 판 안만 바둑판, 밖은 여백. 확대·이동한 판 위에 레이어·선택·안내선이 한 SVG 좌표계로 선다. */
export function ImageStage(props: ImageStageProps): React.JSX.Element {
  const { root, doc, selection = [], onSelect, onChange, tool = 'move', editingText = null, inspect, className = '' } = props;
  const { t } = useTranslation();
  const narrow = useAppBoxTier() === 'narrow';
  const own = useEditorViewport(doc, narrow);
  const viewport = props.viewport ?? own;
  const { view, stage } = viewport;
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const attachViewport = viewport.attach;
  const attach = useCallback((element: HTMLDivElement | null) => { setBox(element); attachViewport(element); }, [attachViewport]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const fontVersion = useFontVersion();
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const editable = !!onChange && !!onSelect;
  // Pictures are read again only when the set of picture sources changes, not on every edit.
  const sourceKey = useMemo(() => doc.layers.filter((layer) => layer.kind === 'image').map((layer) => layer.source ?? '').join('\u0000'), [doc.layers]);
  useEffect(() => {
    let cancelled = false;
    void resolveImageSources(doc, root).then((next) => { if (!cancelled) { setSources(next.sources); setFailed(next.failed); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, sourceKey]);
  const toStage = useCallback((x: number, y: number): Point => {
    const rect = box?.getBoundingClientRect();
    if (!rect) return { x, y };
    const k = stage.width > 0 ? rect.width / stage.width || 1 : 1;
    return { x: (x - rect.left) / k, y: (y - rect.top) / k };
  }, [box, stage.width]);
  const toDoc = useCallback((x: number, y: number): Point | null => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : null;
  }, []);
  const gestures = useStageGestures({
    doc, selection, tool, viewport, editable, onSelect, onChange, onDraw: props.onDraw,
    onEditText: props.onEditText ? (id) => props.onEditText?.(id) : undefined, toDoc, toStage,
  });
  const g = gestures.view;
  const shown = g.preview ?? doc;
  const markup = useLayerMarkup(shown, sources, fontVersion, `${ids}-`);
  const live = useRef(viewport); live.current = viewport;
  useEffect(() => {
    if (!box) return undefined;
    // 판 위 휠은 페이지를 굴리지 않는다 — Ctrl/⌘(트랙패드 핀치 포함)는 커서 중심 확대, 그 밖은 이동(Shift = 가로).
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const rect = box.getBoundingClientRect();
      const k = live.current.stage.width > 0 ? rect.width / live.current.stage.width || 1 : 1;
      if (event.ctrlKey || event.metaKey) live.current.wheel(event.deltaY * unit, { x: (event.clientX - rect.left) / k, y: (event.clientY - rect.top) / k });
      else if (event.shiftKey && !event.deltaX) live.current.pan(-event.deltaY * unit / k, 0);
      else live.current.pan(-event.deltaX * unit / k, -event.deltaY * unit / k);
    };
    box.addEventListener('wheel', wheel, { passive: false });
    return () => box.removeEventListener('wheel', wheel);
  }, [box]);
  useInspectorPicker(svg, inspect ? (at) => {
    const k = stage.width > 0 ? at.width / stage.width : 1;
    return imageStageLevels(shown, inspect, { canvas: t(imageLabelKey('canvas')) }, at, { scale: view.scale * k, x: view.x * k, y: view.y * k });
  } : null, { subtree: true });
  const checker = 8 / view.scale;
  const editingLayer = editingText ? shown.layers.find((layer) => layer.id === editingText && layer.kind === 'text') : undefined;
  const cursor = g.panning ? 'cursor-grabbing' : editable ? TOOL_CURSOR[tool] : 'cursor-grab';
  return <div ref={attach} className={`relative min-h-40 min-w-0 flex-1 overflow-hidden bg-gray-950 ${cursor} ${className}`}
    onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}>
    {/* SVG 는 크기를 재기 전에도 둔다 — Alt 인스펙터가 처음 마운트 때 이 요소에 붙는다(나중에 생기면 못 붙는다). */}
    <svg ref={svg} viewBox={stage.width > 0 && stage.height > 0 ? viewBoxOf(view, stage) : `0 0 ${doc.width} ${doc.height}`} preserveAspectRatio="xMinYMin meet"
      className="absolute inset-0 h-full w-full touch-none select-none" role="img" aria-label={t('panel.apps.vibimage.viewport')}
      {...gestures.handlers}
      onPointerMove={(event) => { gestures.handlers.onPointerMove?.(event); props.cursor?.set(toDoc(event.clientX, event.clientY)); }}
      onPointerLeave={(event) => { gestures.handlers.onPointerLeave?.(event); props.cursor?.set(null); }}>
      <defs>
        <pattern id={`${ids}-checker`} patternUnits="userSpaceOnUse" width={checker * 2} height={checker * 2}>
          <rect width={checker * 2} height={checker * 2} className="fill-gray-800" />
          <rect width={checker} height={checker} className="fill-gray-700" />
          <rect x={checker} y={checker} width={checker} height={checker} className="fill-gray-700" />
        </pattern>
        <clipPath id={`${ids}-board`}><rect width={doc.width} height={doc.height} /></clipPath>
      </defs>
      <rect x={-1 / view.scale} y={-1 / view.scale} width={doc.width + 2 / view.scale} height={doc.height + 2 / view.scale} className="fill-black/40" pointerEvents="none" />
      <rect width={doc.width} height={doc.height} fill={`url(#${ids}-checker)`} pointerEvents="none" />
      {/* 판 밖으로 나간 부분은 내보내기처럼 잘린다. 혼합 모드는 판 안 레이어끼리만 섞이게 묶는다(바둑판과 섞이지 않게). */}
      <g clipPath={`url(#${ids}-board)`} className="isolate">
        <rect width={doc.width} height={doc.height} fill={shown.background} pointerEvents="none" />
        {shown.layers.map((layer) => {
          const moving = g.offset?.ids.has(layer.id);
          return <g key={layer.id} transform={moving ? `translate(${g.offset!.dx} ${g.offset!.dy})` : undefined}
            dangerouslySetInnerHTML={{ __html: layer.id === editingLayer?.id ? '' : markup(layer) }} />;
        })}
      </g>
      {editable && <StageOverlay doc={shown} selection={selection} offset={g.offset} hover={g.hover} scale={view.scale} editingText={editingText}
        guides={g.guides} marquee={g.marquee} draft={g.draft} readout={g.readout} handles={!g.offset && !g.marquee && !g.panning} />}
      {editingLayer && <StageTextEditor doc={shown} layer={editingLayer} onChange={(text) => props.onTextChange?.(editingLayer.id, text)}
        onDone={() => props.onEditText?.(null)} />}
    </svg>
    {failed.length > 0 && <p role="alert" className="pointer-events-none absolute bottom-2 left-1/2 max-w-[90%] -translate-x-1/2 rounded-md bg-gray-900/95 px-3 py-1 text-xs text-amber-200">
      {t('panel.apps.vibimage.editor.picturesMissing', { count: failed.length })}
    </p>}
  </div>;
}
