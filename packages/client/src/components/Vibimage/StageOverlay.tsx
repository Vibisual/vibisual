import type { ImageDocument, ImageLayer } from '../Creation/imageSource.js';
import { HANDLES, boxBounds, boxCorners, boxPoint, handleCursor, handlePoint, unionBounds, type Box, type Point, type SnapGuide } from './imageGeometry.js';
import type { DrawTool } from './editorTools.js';

// Tailwind 는 소스의 글자 그대로만 찾는다 — 커서 클래스를 조립하지 않고 표로 둔다.
const CURSOR = { ew: 'cursor-ew-resize', ns: 'cursor-ns-resize', nesw: 'cursor-nesw-resize', nwse: 'cursor-nwse-resize' } as const;
const LINE = { fill: 'none', vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' } as const;

interface StageOverlayProps {
  doc: ImageDocument;
  selection: readonly string[];
  offset: { ids: ReadonlySet<string>; dx: number; dy: number } | null;
  hover: string;
  /** 문서 1px 의 화면 px — 손잡이·글자를 화면 크기로 고정한다. */
  scale: number;
  editingText: string | null;
  guides: readonly SnapGuide[];
  marquee: Box | null;
  draft: { tool: DrawTool; box: Box } | null;
  readout: { at: Point; text: string } | null;
  /** 손잡이를 그릴지(움직이는 중엔 감춘다). */
  handles: boolean;
}

const points = (layer: ImageLayer): string => boxCorners(layer).map((p) => `${p.x},${p.y}`).join(' ');

/** 화면 크기로 고정된 작은 알약(크기·각도). */
function Pill({ at, text, scale }: { at: Point; text: string; scale: number }): React.JSX.Element {
  const width = text.length * 7 + 14;
  return <g transform={`translate(${at.x} ${at.y}) scale(${1 / scale})`} pointerEvents="none">
    <rect x={-width / 2} y={0} width={width} height={20} rx={4} className="fill-blue-600" />
    <text x={0} y={14} textAnchor="middle" className="fill-white text-[12px] tabular-nums">{text}</text>
  </g>;
}

/** §5.13 (R-9) 레이어 편집기 ③ — 선택 윤곽·8 손잡이·회전 손잡이·묶음 상자·호버·붙기 안내선·끌기 상자. 모두 문서 좌표에 화면 크기로 선다. */
export function StageOverlay({ doc, selection, offset, hover, scale, editingText, guides, marquee, draft, readout, handles }: StageOverlayProps): React.JSX.Element {
  const shift = (layer: ImageLayer): ImageLayer => offset?.ids.has(layer.id) ? { ...layer, x: layer.x + offset.dx, y: layer.y + offset.dy } : layer;
  const chosen = doc.layers.filter((layer) => selection.includes(layer.id)).map(shift);
  const hovered = hover && !selection.includes(hover) ? doc.layers.find((layer) => layer.id === hover && layer.visible) : undefined;
  const single = chosen.length === 1 ? chosen[0] : undefined;
  const bounds = unionBounds(chosen.map(boxBounds));
  const s = 8 / scale; const grab = 11 / scale;
  const rotation = single?.rotation ?? 0;
  const knob = single ? boxPoint(single, { x: 0, y: -single.height / 2 - 26 / scale }) : null;
  const top = single ? handlePoint(single, 'n') : null;
  return <g>
    {hovered && <polygon points={points(shift(hovered))} {...LINE} strokeWidth={1.5} className="stroke-blue-400/70" />}
    {chosen.map((layer) => <polygon key={layer.id} points={points(layer)} {...LINE} strokeWidth={1.5}
      strokeDasharray={layer.locked ? '4 3' : undefined} className={layer.locked ? 'stroke-amber-400' : 'stroke-blue-500'} />)}
    {chosen.length > 1 && bounds && <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} {...LINE} strokeWidth={1}
      strokeDasharray="5 4" className="stroke-blue-400" />}
    {handles && single && !single.locked && single.id !== editingText && <g>
      {top && knob && <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} {...LINE} strokeWidth={1} className="stroke-blue-500" />}
      {knob && <circle data-rotate="true" cx={knob.x} cy={knob.y} r={grab} fill="transparent" className="cursor-grab" />}
      {knob && <circle cx={knob.x} cy={knob.y} r={4.5 / scale} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" className="fill-white stroke-blue-500" />}
      {HANDLES.map((handle) => {
        const p = handlePoint(single, handle);
        const cursor = CURSOR[handleCursor(handle, rotation)];
        return <g key={handle}>
          <circle data-handle={handle} cx={p.x} cy={p.y} r={grab} fill="transparent" className={cursor} />
          <rect x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} transform={rotation ? `rotate(${rotation} ${p.x} ${p.y})` : undefined}
            strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" className="fill-white stroke-blue-500" />
        </g>;
      })}
    </g>}
    {guides.map((g) => g.axis === 'x'
      ? <line key={`x${g.at}`} x1={g.at} x2={g.at} y1={g.from} y2={g.to} {...LINE} strokeWidth={1} className="stroke-fuchsia-500" />
      : <line key={`y${g.at}`} x1={g.from} x2={g.to} y1={g.at} y2={g.at} {...LINE} strokeWidth={1} className="stroke-fuchsia-500" />)}
    {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} vectorEffect="non-scaling-stroke"
      pointerEvents="none" strokeWidth={1} className="fill-blue-500/10 stroke-blue-500" />}
    {draft && (draft.tool === 'ellipse'
      ? <ellipse cx={draft.box.x + draft.box.width / 2} cy={draft.box.y + draft.box.height / 2} rx={draft.box.width / 2} ry={draft.box.height / 2}
        vectorEffect="non-scaling-stroke" pointerEvents="none" strokeWidth={1} className="fill-blue-500/10 stroke-blue-500" />
      : <rect x={draft.box.x} y={draft.box.y} width={draft.box.width} height={draft.box.height} vectorEffect="non-scaling-stroke" pointerEvents="none"
        strokeWidth={1} strokeDasharray={draft.tool === 'text' ? '4 3' : undefined} className="fill-blue-500/10 stroke-blue-500" />)}
    {readout ? <Pill at={{ x: readout.at.x + 14 / scale, y: readout.at.y + 14 / scale }} text={readout.text} scale={scale} />
      : handles && bounds && !editingText && <Pill at={{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 8 / scale }}
        text={`${Math.round(bounds.width)} × ${Math.round(bounds.height)}`} scale={scale} />}
  </g>;
}
