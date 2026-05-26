import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContiElement, ContiFrame } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { InlinePromptPopup } from './InlinePromptPopup.js';
import { StampSvg } from './ContiStamps.js';

/** §5.3 #28 v1.59 — 표준 16:9 스토리보드 viewBox. CONTI_DEFAULTS 와 동기화. */
const VB_W = 320;
const VB_H = 180;
/** FrameCard 폭 (16:9 비율 유지: 카드 520, wireframe 480×270) */
const CARD_W = 520;
/** §5.3 #28 v1.59 — 콘티 보드 줌 한도. 휠 한 틱 = 10% 가감. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 1.1;
/** 드래그 팬 감지 임계값 — 이 이상 움직이면 click 무시(false drag) */
const PAN_CLICK_THRESHOLD_PX = 4;

/** §5.3 #28 v1.61 — 카드 사이 화살표(아이콘+양쪽 패딩) 영역의 폭(px). 카드 그리드 stride 계산에 사용. */
const ARROW_AREA = 48;
/** 카드 한 칸이 차지하는 가로 stride (카드 + 카드 뒤 화살표 영역). 슬라이드 애니메이션 거리 = STRIDE. */
const STRIDE = CARD_W + ARROW_AREA;
/** 컨테이너 좌측 패딩(px). flex 컨테이너의 p-6 (= 24px) 과 동기화. */
const FLEX_PADDING_PX = 24;

/** 슬라이드 애니메이션: 자기 자신은 안 움직이고, 옆 카드들이 비집고 들어갈 공간을 만들어준다.
 *  from < gap (오른쪽으로 이동): (from, gap) 사이 카드들이 왼쪽으로 한 칸 슬라이드.
 *  from > gap (왼쪽으로 이동): [gap, from) 카드들이 오른쪽으로 한 칸 슬라이드. */
function computeShift(i: number, from: number | null, gap: number | null): number {
  if (from === null || gap === null) return 0;
  if (i === from) return 0;
  if (from < gap) {
    if (i > from && i < gap) return -STRIDE;
    return 0;
  }
  if (i >= gap && i < from) return STRIDE;
  return 0;
}

/** gap === from 또는 from+1 은 결과가 자기 자리이므로 의미 없는 드롭. UI 도 표시하지 않는다. */
function isValidGap(from: number, g: number): boolean {
  return g !== from && g !== from + 1;
}

/** 컨테이너 로컬 좌표 x 가 어느 gap 에 매핑되는지 판정.
 *  *Slot-based*: cursor 가 어느 카드 슬롯 위에 있는지 cardIdx 를 구하고, source 와의 좌/우 관계로 g 를 결정.
 *    cardIdx < from → g = cardIdx        (cursor 가 가리키는 슬롯에 source 가 들어간다 — 왼쪽으로 이동)
 *    cardIdx > from → g = cardIdx + 1    (cursor 가 가리키는 슬롯에 source 가 들어간다 — 오른쪽으로 이동)
 *    cardIdx === from → null              (source 자신 위 = dead zone. 인접 no-op gap 도 자연 회피)
 *  결과: 양 방향 모두 "cursor 가 가리키는 카드 자리에 source 가 그대로 들어간다" 로 좌우 대칭. */
function detectGapAtX(x: number, totalFrames: number, from: number): number | null {
  if (totalFrames === 0) return null;
  let cardIdx = Math.floor((x - FLEX_PADDING_PX) / STRIDE);
  if (cardIdx < 0) cardIdx = 0;
  if (cardIdx >= totalFrames) cardIdx = totalFrames - 1;
  if (cardIdx === from) return null;
  const g = cardIdx < from ? cardIdx : cardIdx + 1;
  // 위 매핑에서 cardIdx !== from 이면 g 는 자동으로 from·from+1 둘 다 아니라 isValidGap 은 항상 true.
  return g;
}

/** 드롭 시 시각적으로 카드가 들어갈 자리의 left(px). 슬라이드 결과로 비는 슬롯과 일치한다. */
function placeholderLeftPx(g: number, from: number): number {
  if (from < g) return FLEX_PADDING_PX + (g - 1) * STRIDE;
  return FLEX_PADDING_PX + g * STRIDE;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** v1.62 — element 좌표/크기 NaN 방어. 서버 sanitize 가 정상이면 no-op. */
function safeNum(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** v1.62 — render 직전 element 의 모든 수치 필드 normalize. NaN/string/undefined 다 안전값. */
function normalizeEl(el: ContiElement): ContiElement {
  const out: ContiElement = { ...el, x: safeNum(el.x, 0), y: safeNum(el.y, 0) };
  if (el.w !== undefined) out.w = safeNum(el.w, 0);
  if (el.h !== undefined) out.h = safeNum(el.h, 0);
  if (el.strokeWidth !== undefined) out.strokeWidth = safeNum(el.strokeWidth, 2);
  if (el.fontSize !== undefined) out.fontSize = safeNum(el.fontSize, 14);
  return out;
}

/** v1.62 — element 의 시각적 bounding box. 모든 type 을 최소 MIN×MIN 의 hit area 로 보장.
 *  text/line 처럼 자체 클릭 영역이 좁은 type 도 이 bbox 만큼은 어디 누르든 click 잡힌다. */
function elementBBox(rawEl: ContiElement): { x: number; y: number; w: number; h: number } {
  const el = normalizeEl(rawEl);
  const MIN = 18;
  if (el.type === 'rect') {
    const w = el.w ?? 80;
    const h = el.h ?? 50;
    return { x: el.x, y: el.y, w: Math.max(MIN, w), h: Math.max(MIN, h) };
  }
  if (el.type === 'circle') {
    const r = el.w ?? 24;
    return { x: el.x - r, y: el.y - r, w: Math.max(MIN, 2 * r), h: Math.max(MIN, 2 * r) };
  }
  if (el.type === 'text') {
    const fontSize = el.fontSize ?? 14;
    const label = el.label ?? '(text)';
    const w = label.length * fontSize * 0.62 + 6;
    const h = fontSize * 1.5;
    return { x: el.x - 3, y: el.y - fontSize, w: Math.max(MIN, w), h: Math.max(MIN, h) };
  }
  if (el.type === 'line') {
    const x2 = el.x + (el.w ?? 40);
    const y2 = el.y + (el.h ?? 0);
    const xMin = Math.min(el.x, x2);
    const yMin = Math.min(el.y, y2);
    const wRaw = Math.abs(x2 - el.x);
    const hRaw = Math.abs(y2 - el.y);
    return { x: xMin - 4, y: yMin - 4, w: Math.max(MIN, wRaw + 8), h: Math.max(MIN, hRaw + 8) };
  }
  // stamp
  const w = el.w ?? 48;
  const h = el.h ?? 32;
  return { x: el.x, y: el.y, w: Math.max(MIN, w), h: Math.max(MIN, h) };
}

function ElementSvg({
  el: rawEl,
  selected,
  onClick,
}: {
  el: ContiElement;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  // v1.62 — 옛 체크포인트 잔존/HMR 캐시가 NaN 을 흘려도 SVG 가 깨지지 않도록 진입점에서 한 번 더 normalize.
  const el = normalizeEl(rawEl);
  // v1.59 — 기본 strokeWidth 1.5 → 2 로 상향 (CONTI_DEFAULTS.defaultStrokeWidth)
  const stroke = selected ? '#2563eb' : (el.stroke ?? '#374151');
  const strokeWidth = selected ? Math.max(3, (el.strokeWidth ?? 2) + 1) : (el.strokeWidth ?? 2);
  const fill = el.fill ?? 'none';
  const dash = el.dash;

  // 시각 컨텐츠 (click 핸들러는 outer <g> 가 일괄 처리하므로 inner shape 에는 안 붙인다).
  let visual: React.JSX.Element;
  if (el.type === 'stamp' && el.stampName) {
    visual = (
      <StampSvg
        stampName={el.stampName}
        x={el.x}
        y={el.y}
        {...(el.w !== undefined ? { w: el.w } : {})}
        {...(el.h !== undefined ? { h: el.h } : {})}
        {...(el.label ? { label: el.label } : {})}
        {...(el.stampVariant ? { variant: el.stampVariant } : {})}
        selected={selected}
        onClick={() => { /* 그룹 onClick 이 잡음 */ }}
      />
    );
  } else if (el.type === 'rect') {
    const w = el.w ?? 80;
    const h = el.h ?? 50;
    const rx = Math.min(8, Math.max(3, Math.floor(Math.min(w, h) / 10)));
    visual = (
      <g stroke={stroke} strokeWidth={strokeWidth} {...(dash ? { strokeDasharray: dash } : {})}>
        <rect x={el.x} y={el.y} width={w} height={h} fill={fill} rx={rx} />
        {el.label && (
          <text
            x={el.x + w / 2}
            y={el.y + h / 2 + 5}
            textAnchor="middle"
            fontSize={el.fontSize ?? 14}
            fill={selected ? '#2563eb' : (el.stroke ?? '#374151')}
            stroke="none"
          >
            {el.label}
          </text>
        )}
      </g>
    );
  } else if (el.type === 'circle') {
    visual = (
      <g stroke={stroke} strokeWidth={strokeWidth} {...(dash ? { strokeDasharray: dash } : {})}>
        <circle cx={el.x} cy={el.y} r={el.w ?? 24} fill={fill} />
        {el.label && (
          <text x={el.x} y={el.y + 5} textAnchor="middle" fontSize={el.fontSize ?? 14} fill={selected ? '#2563eb' : (el.stroke ?? '#374151')} stroke="none">
            {el.label}
          </text>
        )}
      </g>
    );
  } else if (el.type === 'text') {
    visual = (
      <text x={el.x} y={el.y} fontSize={el.fontSize ?? 14} fill={selected ? '#2563eb' : (el.fill ?? '#374151')} stroke="none">
        {el.label ?? '(text)'}
      </text>
    );
  } else {
    const x2 = el.x + (el.w ?? 40);
    const y2 = el.y + (el.h ?? 0);
    visual = (
      <line
        x1={el.x}
        y1={el.y}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        {...(dash ? { strokeDasharray: dash } : {})}
      />
    );
  }

  // v1.62 — bbox 기반 hit + 항상 보이는 가이드 박스.
  //   fill="transparent" 면 클릭이 잡히지만 시각적으로는 비어있는 것처럼. fill="none" 이었으면 클릭 안 잡힘.
  //   selected = 진한 파란 실선, idle = 연한 회색 점선. 사용자가 "여기 누를 수 있구나" 한눈에 알 수 있도록.
  const bb = elementBBox(el);
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }} data-element-id={el.id}>
      {visual}
      <rect
        x={bb.x - 2}
        y={bb.y - 2}
        width={bb.w + 4}
        height={bb.h + 4}
        fill="transparent"
        stroke={selected ? '#2563eb' : '#9ca3af'}
        strokeWidth={selected ? 1.5 : 0.6}
        {...(selected ? {} : { strokeDasharray: '2 2' })}
        opacity={selected ? 0.95 : 0.4}
        rx={3}
        ry={3}
      />
    </g>
  );
}

function FrameCard({
  frame,
  index,
  selected,
  onSelect,
  onElementClick,
  selectedElementId,
  onHandleMouseDown,
  isDragging,
  onPatchText,
}: {
  frame: ContiFrame;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onElementClick: (elementId: string, screenPos: { x: number; y: number }) => void;
  selectedElementId: string | null;
  onHandleMouseDown: (e: React.MouseEvent, index: number, cardEl: HTMLElement | null) => void;
  isDragging: boolean;
  onPatchText: (patch: { title?: string; action?: string }) => void;
}): React.JSX.Element {
  /** v1.61 — 커스텀 드래그에서 cursor offset 계산용 카드 root ref. */
  const cardRootRef = useRef<HTMLDivElement>(null);
  // §5.3 #28 v1.61 — title / action 더블클릭 → 인라인 편집. blur/Enter 커밋, Esc 취소.
  const [editing, setEditing] = useState<'title' | 'action' | null>(null);
  const [draft, setDraft] = useState('');

  const beginEdit = (field: 'title' | 'action', current: string) => (e: React.MouseEvent): void => {
    e.stopPropagation();
    setDraft(current);
    setEditing(field);
  };
  const commitEdit = (): void => {
    if (!editing) return;
    const field = editing;
    const next = draft;
    const current = field === 'title' ? frame.title : frame.action;
    if (next !== current) onPatchText({ [field]: next });
    setEditing(null);
  };
  const cancelEdit = (): void => setEditing(null);
  const stopClick = (e: React.MouseEvent | React.KeyboardEvent): void => e.stopPropagation();

  return (
    <div
      ref={cardRootRef}
      onClick={onSelect}
      // v1.61 — 표준 카드 폭 520px. 톤: bg_card #1A1D26 + border subtle. 선택 강조는 action 컬러(보라).
      // dragOver/drop 은 컨테이너 단일 핸들러에서 cursor x 로 gap 판정 → 여기는 더 이상 핸들링하지 않음.
      style={{ width: CARD_W }}
      className={`flex h-full flex-shrink-0 cursor-pointer flex-col gap-3 rounded-xl border p-5 transition-[opacity,transform,box-shadow,border-color] duration-200 ${
        selected ? 'border-[#A78BFA] bg-[#1A1D26] shadow-lg shadow-[#A78BFA]/20' : 'border-white/[0.06] bg-[#1A1D26] hover:border-white/10'
      } ${isDragging ? 'pointer-events-none scale-95 opacity-25' : ''}`}
    >
      <div
        // v1.61 — HTML5 drag 폐기, 커스텀 드래그(mousedown→window mousemove/up)로 전환.
        //   Chromium 이 transform 된 조상 내부 요소를 setDragImage 로 캡쳐 못 하는 케이스 우회 + ghost 를 React 가 직접 그린다.
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          onHandleMouseDown(e, index, cardRootRef.current);
        }}
        onClick={(e) => e.stopPropagation()}
        className="-mx-1 flex cursor-grab items-center justify-between gap-2 rounded-md bg-gray-900/50 px-3 py-2 transition-colors hover:bg-gray-900/80 active:cursor-grabbing"
        title="Drag to reorder"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-300">FRAME {index + 1}</span>
        <svg className="h-5 w-5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
        </svg>
      </div>
      {editing === 'title' ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={stopClick}
          onMouseDown={stopClick}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            stopClick(e);
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          className="rounded border border-[#A78BFA] bg-[#0F1117] px-2 py-1 text-base font-semibold leading-tight text-gray-100 outline-none focus:ring-1 focus:ring-[#A78BFA]"
        />
      ) : (
        <div
          onDoubleClick={beginEdit('title', frame.title)}
          className="cursor-text text-base font-semibold leading-tight text-gray-100"
          title="Double-click to edit"
        >
          {frame.title}
        </div>
      )}
      {/* v1.61 — 와이어프레임 16:9 표준. 배경 = bg_demo `#242833` (Conti Design System 3-레이어). */}
      <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-[#242833] p-0 shadow-inner">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* v1.61 — 기본 배경 면 (LLM 이 첫 element 로 까는 걸 깜빡해도 톤 유지). */}
          <rect x={0} y={0} width={VB_W} height={VB_H} fill="#242833" stroke="none" />
          {frame.elements.map((el) => (
            <ElementSvg
              key={el.id}
              el={el}
              selected={selectedElementId === el.id}
              onClick={(e) => {
                e.stopPropagation();
                const target = e.currentTarget as SVGElement;
                const svgEl = target.ownerSVGElement ?? target;
                const rect = svgEl.getBoundingClientRect();
                onElementClick(el.id, { x: rect.right, y: rect.top });
              }}
            />
          ))}
        </svg>
      </div>
      {editing === 'action' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={stopClick}
          onMouseDown={stopClick}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            stopClick(e);
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          rows={3}
          className="resize-y rounded border border-[#A78BFA] bg-[#0F1117] px-2 py-1 text-xs leading-snug text-gray-300 outline-none focus:ring-1 focus:ring-[#A78BFA]"
        />
      ) : (
        <div
          onDoubleClick={beginEdit('action', frame.action)}
          className="cursor-text text-xs leading-snug text-gray-300"
          title="Double-click to edit"
        >
          {frame.action}
        </div>
      )}
      {frame.badges && frame.badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {frame.badges.map((b, i) => {
            const cls =
              b.kind === 'add'
                ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
                : b.kind === 'mod'
                  ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
                  : 'bg-blue-900/40 text-blue-300 border-blue-700/50';
            return (
              <span key={i} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>
                {b.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** §7.13 v1.47 — 콘티 보드 (더블 클릭 시 전체 화면 오버레이) */
export function ContiBoardPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const open = useGraphStore((s) => s.contiBoardOpen);
  const close = useGraphStore((s) => s.closeContiBoard);
  const contis = useGraphStore((s) => s.contis);
  const addFrame = useGraphStore((s) => s.addContiFrame);
  const deleteFrame = useGraphStore((s) => s.deleteContiFrame);
  const patchFrame = useGraphStore((s) => s.patchContiFrame);

  const [selectedFrameIdx, setSelectedFrameIdx] = useState(0);
  const [selectedElement, setSelectedElement] = useState<{
    frameId: string;
    elementId: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  // §5.3 #28 v1.59 — 줌(transform scale) + 팬(transform translate) 상태
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  /** 드래그 팬 추적 — useRef 로 useState 리렌더 회피 */
  const panDragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number; moved: boolean }>({
    active: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false,
  });
  /** click handler 가 직전 드래그 팬을 무시하기 위한 플래그. mouseup 시 셋 → 첫 click 에서 클리어. */
  const suppressNextClickRef = useRef(false);

  // §5.3 #28 v1.61 — 프레임 reorder.
  //   dragFromIdx: 드래그 중인 source frame 의 원래 index.
  //   dragOverGap: 현재 cursor 가 가리키는 "삽입 gap" (0 ≤ g ≤ N). g 의 의미: 원래 배열에서 frame[g-1] 와 frame[g] 사이.
  //   카드별 dragOver/drop 대신 컨테이너 단일 핸들러에서 cursor x 좌표로 gap 판정 → 카드 transform 슬라이드와 충돌 없음.
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  const flexContainerRef = useRef<HTMLDivElement>(null);

  const conti = open ? contis[open.contiId] : null;

  // 커스텀 드래그의 window listener 안에서 최신 값을 보려고 ref 미러링 (stale closure 회피).
  const zoomRef = useRef(1);
  const contiRef = useRef<typeof conti>(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { contiRef.current = conti; }, [conti]);

  // 콘티 변경 시 선택 + 줌/팬 초기화
  useEffect(() => {
    setSelectedFrameIdx(0);
    setSelectedElement(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [open?.contiId]);

  // v1.62 — 팝업 열려 있을 때 외부 mousedown → 자동 닫기.
  //   stopPropagation 으로 막힌 popup 자체 클릭, 그리고 현재 선택된 element 위 클릭은 예외.
  useEffect(() => {
    if (!selectedElement) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest('[data-popup="conti-prompt"]')) return;
      if (target.closest(`[data-element-id="${selectedElement.elementId}"]`)) return;
      setSelectedElement(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [selectedElement]);

  // §5.3 #28 v1.59 — 휠 줌. 컨테이너 위에서 wheel → 줌 in/out (page scroll 막음).
  // mouse 위치를 anchor 로 잡아 자연스러운 줌. passive:false 로 preventDefault 가능하게.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !open) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setZoom((prevZoom) => {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
        if (next === prevZoom) return prevZoom;
        // 마우스 위치 기준 anchor zoom — pan 보정
        setPan((prevPan) => {
          const ratio = next / prevZoom;
          return {
            x: cx - (cx - prevPan.x) * ratio,
            y: cy - (cy - prevPan.y) * ratio,
          };
        });
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [open]);

  // §5.3 #28 v1.59 — 좌클릭 드래그 팬. boardRef 위 mousedown → window mousemove/up.
  // 드래그앤드롭(frame 핸들)·element click 과 충돌하지 않도록 stopPropagation 사용.
  const onBoardMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // FrameCard 의 drag 핸들 / element click 은 e.stopPropagation 으로 여기 도달 ❌.
    panDragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
  }, [pan.x, pan.y]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = panDragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > PAN_CLICK_THRESHOLD_PX || Math.abs(dy) > PAN_CLICK_THRESHOLD_PX)) {
        d.moved = true;
        // v1.62 — 실제 pan-drag 가 시작되면 inline prompt 팝업 닫기 (드래그 중 거슬리지 않게).
        setSelectedElement(null);
      }
      setPan({ x: d.origX + dx, y: d.origY + dy });
    };
    const onUp = (): void => {
      const d = panDragRef.current;
      if (!d.active) return;
      if (d.moved) suppressNextClickRef.current = true;
      d.active = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 줌/팬 리셋 키보드 단축키
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (selectedElement) setSelectedElement(null);
        else close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selectedElement, close]);

  // 콘티 셀렉터 옵션 (해당 에이전트의 모든 콘티)
  const agentContis = useMemo(() => {
    if (!open) return [];
    return Object.values(contis)
      .filter((c) => c.agentId === open.agentId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [contis, open]);

  const handleAddFrame = useCallback(() => {
    if (!conti) return;
    void addFrame(conti.id);
  }, [addFrame, conti]);

  const handleDeleteFrame = useCallback(() => {
    if (!conti) return;
    if (selectedFrameIdx < 0 || selectedFrameIdx >= conti.frames.length) return;
    void deleteFrame(conti.id, selectedFrameIdx);
    setSelectedFrameIdx((idx) => Math.max(0, idx - 1));
  }, [conti, selectedFrameIdx, deleteFrame]);

  // §5.3 #28 v1.61 — 커스텀 드래그 상태.
  //   HTML5 native drag 는 transform 된 보드 안에서 setDragImage 가 깨지는 케이스가 있어 폐기.
  //   대신 mousedown → window mousemove/up → React 가 직접 floating preview 를 그린다.
  const dragStateRef = useRef<{
    active: boolean;
    fromIdx: number;
    startX: number;
    startY: number;
    /** 카드 좌상단에서 cursor 까지의 screen px offset. preview 의 left/top 보정에 쓴다. */
    offsetX: number;
    offsetY: number;
    /** dragstart 임계값(5px) 통과 여부. 통과 후에야 dragFromIdx 를 set 한다. */
    passed: boolean;
  }>({ active: false, fromIdx: -1, startX: 0, startY: 0, offsetX: 0, offsetY: 0, passed: false });
  const dragOverGapRef = useRef<number | null>(null);
  /** 현재 cursor screen 좌표. dragFromIdx 가 set 된 동안 preview 위치를 갱신. */
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const updateDragOverGap = useCallback((g: number | null) => {
    dragOverGapRef.current = g;
    setDragOverGap(g);
  }, []);

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, idx: number, cardEl: HTMLElement | null) => {
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    dragStateRef.current = {
      active: true,
      fromIdx: idx,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      passed: false,
    };
    // 보드 pan-drag 가 동시에 켜지는 일이 없도록 명시 리셋.
    panDragRef.current.active = false;
    panDragRef.current.moved = false;
  }, []);

  // 커스텀 드래그: window mousemove → preview 위치/dragOverGap 갱신, mouseup → 드롭 처리.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragStateRef.current;
      if (!d.active) return;
      if (!d.passed) {
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        d.passed = true;
        setDragFromIdx(d.fromIdx);
        // v1.62 — frame 드래그 실제 시작 시 inline prompt 팝업도 닫기.
        setSelectedElement(null);
      }
      setCursorPos({ x: e.clientX, y: e.clientY });
      const el = flexContainerRef.current;
      const c = contiRef.current;
      if (el && c) {
        const rect = el.getBoundingClientRect();
        // boundingClientRect 은 zoom 적용된 screen px. localX 는 untransformed 컨테이너 좌표.
        const localX = (e.clientX - rect.left) / zoomRef.current;
        const g = detectGapAtX(localX, c.frames.length, d.fromIdx);
        if (g !== dragOverGapRef.current) updateDragOverGap(g);
      }
    };
    const onUp = (): void => {
      const d = dragStateRef.current;
      if (!d.active) return;
      const wasPassed = d.passed;
      const fromIdx = d.fromIdx;
      d.active = false;
      d.passed = false;
      if (wasPassed) {
        const g = dragOverGapRef.current;
        const c = contiRef.current;
        if (c && g !== null && isValidGap(fromIdx, g)) {
          const toIndex = fromIdx < g ? g - 1 : g;
          void useGraphStore.getState().reorderContiFrame(c.id, fromIdx, toIndex);
          setSelectedFrameIdx((cur) => (cur === fromIdx ? toIndex : cur));
        }
        // mouseup 직후 click 이 카드 onSelect 로 튀지 않도록 흡수.
        suppressNextClickRef.current = true;
      }
      setDragFromIdx(null);
      updateDragOverGap(null);
      setCursorPos(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [updateDragOverGap]);

  const handleEditFrameText = useCallback(() => {
    if (!conti) return;
    const f = conti.frames[selectedFrameIdx];
    if (!f) return;
    const nextTitle = window.prompt(
      t('panel.contiBoard.editTitlePrompt', { defaultValue: 'Frame title:' }),
      f.title,
    );
    if (nextTitle === null) return;
    const nextAction = window.prompt(
      t('panel.contiBoard.editActionPrompt', { defaultValue: 'Frame action:' }),
      f.action,
    );
    if (nextAction === null) return;
    void patchFrame(conti.id, selectedFrameIdx, { title: nextTitle, action: nextAction });
  }, [conti, selectedFrameIdx, patchFrame, t]);

  if (!open || !conti) return null;

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-black/80 backdrop-blur-sm">
      {/* 헤더 */}
      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-6 py-3">
        <span className="text-sm font-bold text-gray-100">
          {t('panel.contiBoard.latest', { defaultValue: 'Latest Conti' })}
        </span>
        <span className="font-mono text-xs text-gray-400">· {formatDateTime(conti.createdAt)}</span>
        {agentContis.length > 1 && (
          <select
            value={conti.id}
            onChange={(e) => useGraphStore.getState().openContiBoard(open.agentId, e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
          >
            {agentContis.map((c, i) => (
              <option key={c.id} value={c.id}>
                #{String(agentContis.length - i).padStart(3, '0')} · {formatDateTime(c.createdAt)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={close}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          aria-label={t('panel.contiBoard.close', { defaultValue: 'Close' })}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 본문 — 줌(휠) + 좌클릭 드래그 팬 + frame 드래그앤드롭 reorder.
          boardRef = 뷰포트, 내부 inner = transform 적용 컨테이너. */}
      <div
        ref={boardRef}
        onMouseDown={onBoardMouseDown}
        className="relative flex-1 overflow-hidden bg-grid-fade select-none"
        style={{ cursor: panDragRef.current.active ? 'grabbing' : 'grab' }}
      >
        <div
          ref={flexContainerRef}
          className="relative flex items-stretch p-6"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: 'max-content',
            gap: 0,
            // §5.3 #28 v1.59 — will-change: transform 금지. GPU 합성 레이어로 가면 SVG/텍스트가 깨진다.
          }}
        >
          {conti.frames.map((f, i) => {
            const shift = computeShift(i, dragFromIdx, dragOverGap);
            const isDraggingSource = dragFromIdx === i;
            return (
              <Fragment key={f.id}>
                <div
                  // §5.3 #28 v1.61 — 카드 + 뒤따르는 화살표를 한 wrapper 로 묶어 transform 슬라이드.
                  // STRIDE = CARD_W + ARROW_AREA. 옆 카드가 비집고 들어갈 자리를 만들어준다.
                  // transition 은 "드래그 중에만". 드롭 직후엔 array 재정렬과 transform 0 리셋이 동시에 일어나는데
                  // transition 이 살아 있으면 새 flex 슬롯에서 -STRIDE→0 보간이 일어나서
                  // "옆에서 미끄러져 들어오는" 잔존 애니메이션이 생긴다 → 드래그 끝나면 snap.
                  style={{
                    transform: `translateX(${shift}px)`,
                    transition: dragFromIdx !== null ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                  }}
                  className="flex flex-shrink-0 items-center"
                >
                  <FrameCard
                    frame={f}
                    index={i}
                    selected={i === selectedFrameIdx}
                    onSelect={() => {
                      if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false;
                        return;
                      }
                      setSelectedFrameIdx(i);
                      setSelectedElement(null);
                    }}
                    onElementClick={(elementId, pos) => {
                      if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false;
                        return;
                      }
                      setSelectedElement({ frameId: f.id, elementId, screenX: pos.x, screenY: pos.y });
                    }}
                    selectedElementId={selectedElement?.frameId === f.id ? selectedElement.elementId : null}
                    onHandleMouseDown={handleHandleMouseDown}
                    isDragging={isDraggingSource}
                    onPatchText={(patch) => { void patchFrame(conti.id, i, patch); }}
                  />
                  {i < conti.frames.length - 1 && (
                    <div
                      // 화살표 영역 = ARROW_AREA(48px). px-3(12)+svg 24+px-3(12). 드래그 중엔 fade out.
                      style={{
                        opacity: dragFromIdx !== null ? 0 : 1,
                        transition: 'opacity 180ms ease',
                      }}
                      className="flex flex-shrink-0 items-center px-3"
                    >
                      <svg viewBox="0 0 24 24" className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
          {/* §5.3 #28 v1.61 — 드롭 placeholder. 슬라이드로 비워진 슬롯에 절대 위치로 자리잡고,
              gap 이 바뀔 때 left 값이 transition 돼서 마치 자리를 옮겨가는 듯이 부드럽게 미끄러진다. */}
          {dragFromIdx !== null && dragOverGap !== null && isValidGap(dragFromIdx, dragOverGap) && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: `${placeholderLeftPx(dragOverGap, dragFromIdx)}px`,
                top: `${FLEX_PADDING_PX}px`,
                bottom: `${FLEX_PADDING_PX}px`,
                width: `${CARD_W}px`,
                transition: 'left 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                pointerEvents: 'none',
              }}
              className="flex items-center justify-center rounded-xl border-2 border-dashed border-[#A78BFA]/80 bg-[#A78BFA]/15"
            >
              <div className="flex flex-col items-center gap-2 text-[#A78BFA]">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
                <span className="text-[11px] font-semibold uppercase tracking-wider">Drop here</span>
              </div>
            </div>
          )}
        </div>
        {/* 줌 HUD — 우측 상단 */}
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded border border-gray-700 bg-gray-900/80 px-2 py-1 font-mono text-[10px] text-gray-400 backdrop-blur-sm">
          <span>{Math.round(zoom * 100)}%</span>
          <span className="text-gray-600">·</span>
          <span>{t('panel.contiBoard.zoomReset', { defaultValue: 'Ctrl+0 reset' })}</span>
        </div>
      </div>

      {/* 하단 컨트롤바 — add/remove/edit */}
      <div className="flex items-center justify-center gap-3 border-t border-gray-800 bg-gray-900 px-6 py-3">
        <button
          type="button"
          onClick={handleAddFrame}
          className="flex items-center gap-1.5 rounded border border-emerald-700/60 bg-emerald-900/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{t('panel.contiBoard.addFrame', { defaultValue: 'Frame 추가' })}</span>
        </button>
        <button
          type="button"
          onClick={handleDeleteFrame}
          disabled={!conti.frames[selectedFrameIdx]}
          className="flex items-center gap-1.5 rounded border border-red-700/60 bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{t('panel.contiBoard.deleteFrame', { defaultValue: '삭제' })}</span>
        </button>
        <button
          type="button"
          onClick={handleEditFrameText}
          disabled={!conti.frames[selectedFrameIdx]}
          className="flex items-center gap-1.5 rounded border border-amber-700/60 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          <span>{t('panel.contiBoard.editFrame', { defaultValue: '텍스트 수정' })}</span>
        </button>
      </div>

      {/* 인라인 프롬프트 팝업 */}
      {selectedElement && (
        <InlinePromptPopup
          contiId={conti.id}
          frameId={selectedElement.frameId}
          elementId={selectedElement.elementId}
          screenX={selectedElement.screenX}
          screenY={selectedElement.screenY}
          onClose={() => setSelectedElement(null)}
        />
      )}

      {/* §5.3 #28 v1.61 — 커스텀 드래그 floating preview.
          오버레이 최상위에 fixed 로 그려 보드의 transform 영향 없이 마우스를 따라온다.
          카드 자체를 transform: scale(zoom) 으로 그려 화면에 보이는 그대로의 크기로 매달림. */}
      {dragFromIdx !== null && cursorPos && conti.frames[dragFromIdx] && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: `${cursorPos.x - dragStateRef.current.offsetX}px`,
            top: `${cursorPos.y - dragStateRef.current.offsetY}px`,
            pointerEvents: 'none',
            zIndex: 70,
            opacity: 0.9,
            transformOrigin: '0 0',
            transform: `scale(${zoom}) rotate(-1.5deg)`,
            filter: 'drop-shadow(0 12px 24px rgba(167,139,250,0.35))',
          }}
        >
          <FrameCard
            frame={conti.frames[dragFromIdx]}
            index={dragFromIdx}
            selected
            onSelect={() => {}}
            onElementClick={() => {}}
            selectedElementId={null}
            onHandleMouseDown={() => {}}
            isDragging={false}
            onPatchText={() => {}}
          />
        </div>
      )}
    </div>
  );
}
