import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';
import { pickReadableTextColor } from '../../utils/commentBoxStyle.js';

interface Props {
  /** 현재 선택된 hex (#RRGGBB) */
  value: string;
  /**
   * 현재 불투명도(0~1). **주면 알파 슬라이더가 뜬다** — 안 주면 종전대로 색만 고르는 도구다.
   * (코멘트 박스는 알파 축이 없고, 스티키 메모(§5.5 #17-36)는 있다.)
   */
  alpha?: number;
  /**
   * 맨 윗줄에 놓을 호출부 전용 빠른 칸. 주면 그 화면의 팔레트가 먼저 보이고, 아래의 범용
   * 확장 팔레트는 그대로 남는다(자유색을 고를 길을 막지 않는다).
   */
  presets?: readonly { id: string; label: string; color: string }[];
  /** 슬라이더/드래그 라이브 갱신 (PATCH 없음) — 알파를 안 쓰는 호출부는 두 번째 인자를 무시하면 된다. */
  onLive: (hex: string, alpha: number) => void;
  /** 손 떼는 시점 1회 PATCH */
  onCommit: (hex: string, alpha: number) => void;
  /** 팝오버 닫기 */
  onClose: () => void;
  /** 트리거 버튼의 화면 좌표 (popover 위치 anchor) */
  anchor: { x: number; y: number };
}

/** 알파 슬라이더 트랙 뒤의 체커보드 — 투명한 만큼 이 무늬가 비쳐 "얼마나 뚫렸는지"가 보인다. */
const CHECKERBOARD =
  'repeating-conic-gradient(#94A3B8 0% 25%, #E2E8F0 0% 50%) 50% / 8px 8px';

/**
 * 색 칸의 테두리. **회색 테두리를 두르지 않는 것이 요점**이다 — 종전 `border-gray-700/50` 은
 * 16px 칸에서 색의 23% 를 먹으면서, 정작 필요한 자리(`#0F172A` 같은 어두운 칸이 `bg-gray-900`
 * 바닥에 녹는 것)에서는 회색끼리라 경계가 서지 않았다. 흰색 반투명 헤어라인은 반대로 군다:
 * 어두운 칸에서는 또렷하고 밝은 칸에서는 스스로 사라진다(밝은 칸은 이미 바닥과 갈린다).
 */
const SWATCH_EDGE = 'inset 0 0 0 1px rgba(255,255,255,0.18)';

// ─── HSV ↔ RGB ↔ HEX 유틸 ───

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; b = 0; }
  else if (hh < 2) { r = x; g = c; b = 0; }
  else if (hh < 3) { r = 0; g = c; b = x; }
  else if (hh < 4) { r = 0; g = x; b = c; }
  else if (hh < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/**
 * 색 한 칸.
 *
 * **칸에서 색이 차지하는 넓이가 이 도구의 성능이다.** 종전 칸은 격자 한 칸(23.5px)
 * 안에 16×16 으로 고정돼 있었고 거기에 1px 테두리까지 둘러, 실제로 보이는 색은
 * 14×14(196px²) — 칸(552px²)의 **35%** 뿐이고 나머지는 여백과 회색 테두리였다.
 * 이제 칸을 꽉 채우고(`aspect-square w-full`) 테두리를 안쪽 헤어라인으로 바꾼다.
 *
 * **고른 표시가 색을 덮지 않는다.** 종전 `border-white` 2px + ring 은 16px 칸에서
 * 색의 44% 를 지웠고, 하필 가장 밝은 칸(`#F8FAFC`)에서는 흰 테두리가 흰 색 위에 얹혀
 * **골랐는지조차 보이지 않았다.** 표식의 색은 그 칸의 밝기가 정한다
 * (`pickReadableTextColor` — 코멘트 박스·스티키 메모가 이미 쓰는 그 함수. 판정 기준을
 * 새로 만들면 같은 색을 두 곳이 다르게 읽는다).
 *
 * **호버는 색을 한 픽셀도 가리지 않는다** — 칸을 키우고 그림자로 띄운다. 종전
 * `scale-110` 은 16px 칸에서 1.6px 이라 눈에 잡히지 않았다. 그림자는 `filter` 계열이라
 * 인라인 `boxShadow`(헤어라인·선택 링)와 겹치지 않는다 — ring 유틸은 같은 `box-shadow`
 * 속성을 쓰므로 인라인에 덮여 그려지지 않는다.
 */
function Swatch({ color, label, selected, onPick }: {
  color: string;
  label: string;
  selected: boolean;
  onPick: (hex: string) => void;
}): React.JSX.Element {
  const ink = pickReadableTextColor(color);
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      className={`relative aspect-square w-full rounded transition-transform hover:z-10 hover:scale-[1.18] hover:drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)] ${
        selected ? 'z-10 scale-105' : ''
      }`}
      style={{
        backgroundColor: color,
        boxShadow: selected ? `inset 0 0 0 2px ${ink}, ${SWATCH_EDGE}` : SWATCH_EDGE,
      }}
      aria-label={label}
      aria-pressed={selected}
      title={label}
    >
      {selected && (
        <svg
          className="absolute inset-0 m-auto h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke={ink}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

/**
 * 어두운 톤 패널에 맞춘 자체 색 선택 팝오버 (네이티브 OS 다이얼로그 완전 대체).
 * - 2D 채도/명도 패드 (자유 색 선택)
 * - Hue 슬라이더 (무지개 바)
 * - 확장 팔레트 + 그레이스케일 (빠른 선택)
 * - HEX 직접 입력
 * - 외부 클릭 / Esc 닫기
 *
 * **색을 고르는 도구에서 가장 커야 하는 것은 색이다** (사용자 지시 — "색 선택툴의 색이
 * 좀더 잘보이게"). 그래서 이 파일의 치수는 전부 "색이 몇 픽셀을 차지하는가"로 정해진다:
 * 칸은 격자를 꽉 채우고, 테두리·선택 표시·손잡이는 색을 덮지 않는 쪽으로 그린다
 * (자세한 근거는 `Swatch`·`SWATCH_EDGE` 주석). §9 의 "'안 보인다'를 색부터 손대서 풀지
 * 말라 — 크기 문제다"가 글자에 대해 세운 규율을 색 칸에 그대로 적용한 것이다.
 */
export function CommentBoxColorPopover({ value, alpha, presets, onLive, onCommit, onClose, anchor }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const popRef = useRef<HTMLDivElement>(null);
  const hasAlpha = typeof alpha === 'number';
  // 알파를 안 쓰는 호출부에는 항상 1 을 돌려준다(콜백 시그니처는 하나로 유지).
  const alphaRef = useRef(typeof alpha === 'number' ? alpha : 1);
  alphaRef.current = typeof alpha === 'number' ? alpha : 1;

  // HSV 내부 상태 — value prop(hex) 와 양방향 동기화
  const initialHsv = useMemo<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#FFFFFF');
    return rgbToHsv(r, g, b);
  }, []); // mount 시점만
  const [h, setH] = useState(initialHsv[0]);
  const [s, setS] = useState(initialHsv[1]);
  const [v, setV] = useState(initialHsv[2]);
  const [hexInput, setHexInput] = useState(value);

  // 외부에서 value 가 바뀌면 HSV 동기화 (팔레트 클릭 등)
  useEffect(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    const [rr, gg, bb] = hexToRgb(value);
    const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
    setH(hh);
    setS(ss);
    setV(vv);
    setHexInput(value);
  }, [value]);

  // 외부 press 로 닫기(공통 규약) — 색상 패드·슬라이더를 잡고 창 밖까지 끌어도 닫히지 않는다.
  // 그레이스: 팝오버를 연 그 클릭의 잔여 이벤트가 곧바로 닫아 버리지 않게 잠깐 무시한다.
  useOutsidePressDismiss({
    onDismiss: onClose,
    refs: [popRef],
    events: ['pointerdown'],
    capture: false,
    graceMs: POPUP_DISMISS.openGraceMs,
  });

  // Esc 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ─── Sat/Val 2D 패드 드래그 ───
  const padRef = useRef<HTMLDivElement>(null);
  const padDraggingRef = useRef(false);
  const updateFromPad = useCallback((clientX: number, clientY: number, commit: boolean) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ns = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const nv = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    setS(ns);
    setV(nv);
    const hex = hsvToHex(h, ns, nv);
    setHexInput(hex);
    if (commit) onCommit(hex, alphaRef.current);
    else onLive(hex, alphaRef.current);
  }, [h, onLive, onCommit]);

  const onPadPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    padDraggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromPad(e.clientX, e.clientY, false);
  }, [updateFromPad]);
  const onPadPointerMove = useCallback((e: React.PointerEvent) => {
    if (!padDraggingRef.current) return;
    updateFromPad(e.clientX, e.clientY, false);
  }, [updateFromPad]);
  const onPadPointerUp = useCallback((e: React.PointerEvent) => {
    if (!padDraggingRef.current) return;
    padDraggingRef.current = false;
    updateFromPad(e.clientX, e.clientY, true);
  }, [updateFromPad]);

  // ─── Hue 슬라이더 드래그 ───
  const hueRef = useRef<HTMLDivElement>(null);
  const hueDraggingRef = useRef(false);
  const updateFromHue = useCallback((clientX: number, commit: boolean) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nh = Math.max(0, Math.min(360, ((clientX - r.left) / r.width) * 360));
    setH(nh);
    const hex = hsvToHex(nh, s, v);
    setHexInput(hex);
    if (commit) onCommit(hex, alphaRef.current);
    else onLive(hex, alphaRef.current);
  }, [s, v, onLive, onCommit]);

  const onHuePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    hueDraggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromHue(e.clientX, false);
  }, [updateFromHue]);
  const onHuePointerMove = useCallback((e: React.PointerEvent) => {
    if (!hueDraggingRef.current) return;
    updateFromHue(e.clientX, false);
  }, [updateFromHue]);
  const onHuePointerUp = useCallback((e: React.PointerEvent) => {
    if (!hueDraggingRef.current) return;
    hueDraggingRef.current = false;
    updateFromHue(e.clientX, true);
  }, [updateFromHue]);

  // ─── 알파 슬라이더 드래그 ───
  const alphaTrackRef = useRef<HTMLDivElement>(null);
  const alphaDraggingRef = useRef(false);
  const updateFromAlpha = useCallback((clientX: number, commit: boolean) => {
    const el = alphaTrackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 0 은 잡을 수 없는 유령이 되므로 하한을 둔다(호출부가 자기 하한으로 다시 접는다).
    const na = Math.max(0.05, Math.min(1, Math.round(((clientX - r.left) / r.width) * 100) / 100));
    alphaRef.current = na;
    const hex = hsvToHex(h, s, v);
    if (commit) onCommit(hex, na);
    else onLive(hex, na);
  }, [h, s, v, onLive, onCommit]);

  const onAlphaPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    alphaDraggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromAlpha(e.clientX, false);
  }, [updateFromAlpha]);
  const onAlphaPointerMove = useCallback((e: React.PointerEvent) => {
    if (!alphaDraggingRef.current) return;
    updateFromAlpha(e.clientX, false);
  }, [updateFromAlpha]);
  const onAlphaPointerUp = useCallback((e: React.PointerEvent) => {
    if (!alphaDraggingRef.current) return;
    alphaDraggingRef.current = false;
    updateFromAlpha(e.clientX, true);
  }, [updateFromAlpha]);

  // ─── 팔레트/그레이스케일 클릭 ───
  const handlePaletteClick = useCallback((hex: string) => {
    onCommit(hex, alphaRef.current);
    setHexInput(hex);
    const [rr, gg, bb] = hexToRgb(hex);
    const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
    setH(hh); setS(ss); setV(vv);
  }, [onCommit]);

  // ─── HEX 입력 ───
  const handleHexChange = useCallback((raw: string) => {
    setHexInput(raw);
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      onLive(normalized, alphaRef.current);
      const [rr, gg, bb] = hexToRgb(normalized);
      const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
      setH(hh); setS(ss); setV(vv);
    }
  }, [onLive]);
  const handleHexCommit = useCallback(() => {
    const normalized = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) onCommit(normalized, alphaRef.current);
    else setHexInput(value);
  }, [hexInput, value, onCommit]);

  // 위치 — 우측 우선, 화면 밖이면 좌측 플립.
  // 폭 240 → 264: 격자 한 칸이 23.5 → 26.5px 이 되어 칸을 꽉 채우는 것과 합쳐 색 면적이
  // 196 → 702px²(약 3.6배)가 된다. 24px 넓어질 뿐이라 앵커 옆에 붙는 성격은 그대로다.
  const POP_W = 264;
  const POP_H = 431 + (hasAlpha ? 22 : 0) + (presets ? 52 : 0);
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = anchor.x + POP_W + 8 < screenW ? anchor.x + 8 : Math.max(8, anchor.x - POP_W - 8);
  const top = Math.max(8, Math.min(anchor.y, screenH - POP_H - 8));
  // 칸이 커지며 키가 자랐다 — 낮은 창에서 아래가 잘리지 않게 화면 안으로 묶고 넘치면 스크롤한다
  // (종전에는 `top` 하한 8 에 걸린 뒤 남는 만큼 그냥 화면 밖으로 나갔다 — HEX 입력칸이 대상이다).
  const maxHeight = Math.max(200, screenH - 16);

  // 패드 배경: hue 색을 기반으로 한 saturation/value 그라디언트
  const hueOnly = hsvToHex(h, 1, 1);
  const padBg = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #FFF, ${hueOnly})`;

  // 패드 안 커서 위치
  const cursorX = s * 100;
  const cursorY = (1 - v) * 100;
  const huePos = (h / 360) * 100;

  return (
    <div
      ref={popRef}
      className="fixed z-50 overflow-y-auto overscroll-contain rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl"
      style={{ left, top, width: POP_W, maxHeight }}
      role="dialog"
      aria-label={t('panel.commentBox.colorPicker', 'Color picker')}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-wider text-gray-500">{t('panel.commentBox.colorPicker', 'Color')}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
          aria-label={t('panel.detailPanel.close', 'Close')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Sat/Val 2D 패드 */}
      <div
        ref={padRef}
        className="relative h-[156px] w-full cursor-crosshair touch-none rounded border border-gray-700 overflow-hidden"
        style={{ background: padBg }}
        onPointerDown={onPadPointerDown}
        onPointerMove={onPadPointerMove}
        onPointerUp={onPadPointerUp}
      >
        {/* 커서 안을 지금 고른 색으로 채운다 — 손가락·커서에 가려지는 그 자리의 색을 되돌려 준다. */}
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{
            left: `${cursorX}%`,
            top: `${cursorY}%`,
            backgroundColor: hsvToHex(h, s, v),
            boxShadow: '0 0 0 1px rgba(0,0,0,0.7)',
          }}
        />
      </div>

      {/* Hue 슬라이더 */}
      <div
        ref={hueRef}
        className="relative mt-2 h-3.5 w-full cursor-ew-resize touch-none rounded-full border border-gray-700"
        style={{
          background:
            'linear-gradient(to right, #FF0000 0%, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000 100%)',
        }}
        onPointerDown={onHuePointerDown}
        onPointerMove={onHuePointerMove}
        onPointerUp={onHuePointerUp}
      >
        {/* 손잡이는 막대가 아니라 **창**이다 — 가운데가 뚫려 있어 지금 잡은 색을 그대로 보여 준다.
            종전 `w-1` 흰 막대는 1px 테두리를 빼면 심지가 2px 이라 어디를 잡았는지 잘 안 보였고,
            무엇보다 그 자리의 색을 가렸다. 트랙 밖으로 나가야 하므로 `overflow-hidden` 은 뗀다. */}
        <div
          className="pointer-events-none absolute top-1/2 h-[18px] w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-white"
          style={{ left: `${huePos}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }}
        />
      </div>

      {/* 알파 슬라이더 — 체커보드 위에 "투명 → 현재 색" 그라디언트를 얹어 지금 얼마나 뚫렸는지 보인다. */}
      {hasAlpha && (
        <div className="mt-2 flex items-center gap-2">
          <div
            ref={alphaTrackRef}
            className="relative h-3.5 flex-1 cursor-ew-resize touch-none rounded-full border border-gray-700"
            style={{ background: CHECKERBOARD }}
            onPointerDown={onAlphaPointerDown}
            onPointerMove={onAlphaPointerMove}
            onPointerUp={onAlphaPointerUp}
            onPointerCancel={onAlphaPointerUp}
            role="slider"
            aria-label={t('panel.commentBox.opacity', 'Opacity')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(alphaRef.current * 100)}
            tabIndex={0}
          >
            {/* 트랙의 `overflow-hidden` 을 뗐으므로(손잡이가 위아래로 삐져나온다) 이 겹은
                스스로 둥글어야 한다 — 안 그러면 네 모서리가 체커보드 위로 각지게 튀어나온다. */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ background: `linear-gradient(to right, transparent, ${hsvToHex(h, s, v)})` }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-[18px] w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-white"
              style={{ left: `${alphaRef.current * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }}
            />
          </div>
          <span className="w-8 flex-shrink-0 text-right font-mono text-[12px] tabular-nums text-gray-400">
            {Math.round(alphaRef.current * 100)}
          </span>
        </div>
      )}

      {/* 호출부 전용 빠른 칸(있을 때만) — 그 화면이 쓰는 색부터 눈에 들어오게 맨 위.
          종전에는 동그라미라 범용 팔레트와 구분됐는데, 칸을 꽉 채우려면 네모여야 하므로
          (원은 같은 칸에서 색 면적을 21% 잃는다) 그 구분은 아래 경계선이 대신한다. */}
      {presets && (
        <div className="mt-3 grid grid-cols-8 gap-1 border-b border-gray-800 pb-3">
          {presets.map((p) => (
            <Swatch
              key={p.id}
              color={p.color}
              label={p.label}
              selected={value.toLowerCase() === p.color.toLowerCase()}
              onPick={handlePaletteClick}
            />
          ))}
        </div>
      )}

      {/* 빠른 팔레트 */}
      <div className="mt-3 grid grid-cols-8 gap-1">
        {EXTENDED_PALETTE.map((row) =>
          row.map((c) => (
            <Swatch
              key={c}
              color={c}
              label={c}
              selected={value.toLowerCase() === c.toLowerCase()}
              onPick={handlePaletteClick}
            />
          )),
        )}
      </div>
      <div className="mt-1 grid grid-cols-8 gap-1">
        {GRAYSCALE_ROW.map((c) => (
          <Swatch
            key={c}
            color={c}
            label={c}
            selected={value.toLowerCase() === c.toLowerCase()}
            onPick={handlePaletteClick}
          />
        ))}
      </div>

      {/* HEX 입력 + 미리보기 */}
      <div className="mt-3 flex items-center gap-2">
        {/* 미리보기는 **실제로 나올 모습**이어야 한다 — 종전에는 알파를 무시하고 원색을 칠해,
            30% 로 낮춰 놓고도 여기만 진하게 보였다(고른 색과 나올 색이 달랐다). 체커보드 위에
            같은 알파로 얹어 얼마나 뚫렸는지까지 그대로 보인다. 알파를 안 쓰는 호출부는 1 이라
            종전과 완전히 같은 그림이다. */}
        <div
          className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded border border-gray-700"
          style={{ background: CHECKERBOARD }}
          aria-hidden
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hexInput) ? hexInput : value,
              opacity: alphaRef.current,
            }}
          />
        </div>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          onBlur={handleHexCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleHexCommit();
              onClose();
            }
          }}
          className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-200 outline-none focus:border-blue-500"
          placeholder="#RRGGBB"
          spellCheck={false}
          maxLength={7}
        />
      </div>
    </div>
  );
}

const EXTENDED_PALETTE: string[][] = [
  ['#FCA5A5', '#FDBA74', '#FCD34D', '#86EFAC', '#67E8F9', '#93C5FD', '#C4B5FD', '#F9A8D4'],
  ['#F87171', '#FB923C', '#FACC15', '#4ADE80', '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6'],
  ['#EF4444', '#F97316', '#EAB308', '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'],
  ['#B91C1C', '#C2410C', '#A16207', '#047857', '#0E7490', '#1D4ED8', '#6D28D9', '#BE185D'],
];

const GRAYSCALE_ROW: string[] = [
  '#F8FAFC', '#CBD5E1', '#94A3B8', '#64748B', '#475569', '#334155', '#1E293B', '#0F172A',
];
