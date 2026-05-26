import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** 현재 선택된 hex (#RRGGBB) */
  value: string;
  /** 슬라이더/드래그 라이브 갱신 (PATCH 없음) */
  onLive: (hex: string) => void;
  /** 손 떼는 시점 1회 PATCH */
  onCommit: (hex: string) => void;
  /** 팝오버 닫기 */
  onClose: () => void;
  /** 트리거 버튼의 화면 좌표 (popover 위치 anchor) */
  anchor: { x: number; y: number };
}

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
 * 어두운 톤 패널에 맞춘 자체 색 선택 팝오버 (네이티브 OS 다이얼로그 완전 대체).
 * - 2D 채도/명도 패드 (자유 색 선택)
 * - Hue 슬라이더 (무지개 바)
 * - 확장 팔레트 + 그레이스케일 (빠른 선택)
 * - HEX 직접 입력
 * - 외부 클릭 / Esc 닫기
 */
export function CommentBoxColorPopover({ value, onLive, onCommit, onClose, anchor }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const popRef = useRef<HTMLDivElement>(null);

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

  // 외부 클릭 / Esc 닫기
  useEffect(() => {
    const onPointer = (e: PointerEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const tid = setTimeout(() => {
      window.addEventListener('pointerdown', onPointer);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(tid);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
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
    if (commit) onCommit(hex);
    else onLive(hex);
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
    if (commit) onCommit(hex);
    else onLive(hex);
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

  // ─── 팔레트/그레이스케일 클릭 ───
  const handlePaletteClick = useCallback((hex: string) => {
    onCommit(hex);
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
      onLive(normalized);
      const [rr, gg, bb] = hexToRgb(normalized);
      const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
      setH(hh); setS(ss); setV(vv);
    }
  }, [onLive]);
  const handleHexCommit = useCallback(() => {
    const normalized = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) onCommit(normalized);
    else setHexInput(value);
  }, [hexInput, value, onCommit]);

  // 위치 — 우측 우선, 화면 밖이면 좌측 플립
  const POP_W = 240;
  const POP_H = 360;
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = anchor.x + POP_W + 8 < screenW ? anchor.x + 8 : Math.max(8, anchor.x - POP_W - 8);
  const top = Math.max(8, Math.min(anchor.y, screenH - POP_H - 8));

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
      className="fixed z-50 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl"
      style={{ left, top, width: POP_W }}
      role="dialog"
      aria-label={t('panel.commentBox.colorPicker', 'Color picker')}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{t('panel.commentBox.colorPicker', 'Color')}</span>
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
        className="relative h-[140px] w-full cursor-crosshair touch-none rounded border border-gray-700 overflow-hidden"
        style={{ background: padBg }}
        onPointerDown={onPadPointerDown}
        onPointerMove={onPadPointerMove}
        onPointerUp={onPadPointerUp}
      >
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{
            left: `${cursorX}%`,
            top: `${cursorY}%`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
          }}
        />
      </div>

      {/* Hue 슬라이더 */}
      <div
        ref={hueRef}
        className="relative mt-2 h-3 w-full cursor-ew-resize touch-none rounded-full border border-gray-700 overflow-hidden"
        style={{
          background:
            'linear-gradient(to right, #FF0000 0%, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000 100%)',
        }}
        onPointerDown={onHuePointerDown}
        onPointerMove={onHuePointerMove}
        onPointerUp={onHuePointerUp}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-gray-900 bg-white"
          style={{ left: `${huePos}%` }}
        />
      </div>

      {/* 빠른 팔레트 */}
      <div className="mt-3 grid grid-cols-8 gap-1">
        {EXTENDED_PALETTE.map((row) =>
          row.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handlePaletteClick(c)}
              className={`h-4 w-4 rounded border transition-all ${
                value.toLowerCase() === c.toLowerCase()
                  ? 'border-white ring-1 ring-white/40'
                  : 'border-gray-700/50 hover:scale-110 hover:border-gray-400'
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
              title={c}
            />
          )),
        )}
      </div>
      <div className="mt-1 grid grid-cols-8 gap-1">
        {GRAYSCALE_ROW.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handlePaletteClick(c)}
            className={`h-4 w-4 rounded border transition-all ${
              value.toLowerCase() === c.toLowerCase()
                ? 'border-white ring-1 ring-white/40'
                : 'border-gray-700/50 hover:scale-110 hover:border-gray-400'
            }`}
            style={{ backgroundColor: c }}
            aria-label={c}
            title={c}
          />
        ))}
      </div>

      {/* HEX 입력 + 미리보기 */}
      <div className="mt-3 flex items-center gap-2">
        <div
          className="h-6 w-6 flex-shrink-0 rounded border border-gray-700"
          style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hexInput) ? hexInput : value }}
          aria-hidden
        />
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
