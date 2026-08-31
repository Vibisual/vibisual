import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_MEMO, SESSION_MEMO_PALETTE, type SessionMemo } from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { moveMemo, pickReadableTextColor, resizeMemo, type MemoBounds, type MemoPatch } from './sessionMemo.js';

/**
 * SessionMemoCard.tsx — §5.5 #17-36 스티키 메모 한 장.
 *
 * 윈도우 메모장의 몸가짐(제목줄을 끌어 옮기고, 우하단을 끌어 늘리고, 접고, 닫는다)에 포스트잇의
 * 종이색을 입힌 것이다. **판(스트림 본문) 좌표계**에 절대배치되며 대화와 함께 스크롤되지 않는다.
 *
 * 이동·리사이즈는 pointer capture 로 잡는다(window 리스너 ❌) — 손가락·펜에서도 그대로 동작하고,
 * 커서가 카드 밖으로 나가도 이벤트가 끊기지 않는다. 좌표 산수는 전부 `sessionMemo.ts`(순수 함수)가 한다.
 *
 * 색 고르기는 **카드 안 스와치 줄**이다. `CommentBoxColorPopover`(HSV 피커, 화면 좌표 앵커)는
 * 자유색을 고르는 도구라 메모지에는 과하고, 판 좌표계와 맞물리지도 않는다.
 */

interface SessionMemoCardProps {
  memo: SessionMemo;
  /** 메모가 놓인 판의 크기 — 이동·리사이즈 한계. */
  bounds: MemoBounds;
  /** 배열 순서에서 온 겹침 순서. */
  zIndex: number;
  /** 방금 만든 메모 — 마운트 직후 본문에 커서를 둔다. */
  autoFocus: boolean;
  /** 끄는 동안의 실시간 갱신(저장은 호출부가 지연 처리). */
  onChange: (patch: MemoPatch) => void;
  /** 손을 뗐다·입력이 끝났다 — 지금 저장하라. */
  onCommit: () => void;
  /** 이 장을 맨 앞으로. */
  onRaise: () => void;
  onDelete: () => void;
}

/** 제목줄에 보일 한 줄 — 본문 첫 줄(없으면 라벨). 접었을 때 무슨 메모인지 알아보는 유일한 단서다. */
function titleOf(text: string, fallback: string): string {
  const first = text.split('\n', 1)[0]?.trim() ?? '';
  return first.length > 0 ? first : fallback;
}

export function SessionMemoCard({
  memo, bounds, zIndex, autoFocus, onChange, onCommit, onRaise, onDelete,
}: SessionMemoCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteBtnRef = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** 끌고 있는 동안의 시작값 — null 이면 안 끌고 있다. */
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const sizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  useOutsidePressDismiss({
    onDismiss: () => setPaletteOpen(false),
    enabled: paletteOpen,
    refs: [paletteRef, paletteBtnRef],
  });

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    onRaise();
    dragRef.current = { px: e.clientX, py: e.clientY, x: memo.x, y: memo.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [memo.x, memo.y, onRaise]);

  const onDragMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = moveMemo(memo, { x: d.x, y: d.y }, e.clientX - d.px, e.clientY - d.py, bounds);
    onChange({ x: next.x, y: next.y });
  }, [memo, bounds, onChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit();
  }, [onCommit]);

  const startResize = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onRaise();
    sizeRef.current = { px: e.clientX, py: e.clientY, w: memo.w, h: memo.h };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [memo.w, memo.h, onRaise]);

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = sizeRef.current;
    if (!s) return;
    const next = resizeMemo(memo, { w: s.w, h: s.h }, e.clientX - s.px, e.clientY - s.py, bounds);
    onChange({ w: next.w, h: next.h });
  }, [memo, bounds, onChange]);

  const endResize = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!sizeRef.current) return;
    sizeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit();
  }, [onCommit]);

  const fg = pickReadableTextColor(memo.color);
  const collapsed = memo.collapsed === true;

  return (
    // 위치·크기·종이색은 사용자가 정하는 **데이터**라 style 로 간다(Tailwind 클래스로는 표현 불가).
    <div
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-sm border border-black/25 shadow-lg"
      style={{
        left: memo.x,
        top: memo.y,
        width: memo.w,
        height: collapsed ? SESSION_MEMO.HEADER_H : memo.h,
        backgroundColor: memo.color,
        color: fg,
        zIndex,
      }}
      onPointerDown={onRaise}
      data-session-memo={memo.id}
    >
      <div
        className="flex flex-shrink-0 cursor-move select-none items-center gap-1 border-b border-black/10 pl-1.5 pr-0.5"
        style={{ height: SESSION_MEMO.HEADER_H }}
        onPointerDown={startDrag}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { onChange({ collapsed: !collapsed }); onCommit(); }}
      >
        <svg className="h-3.5 w-3.5 flex-shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold opacity-80">
          {titleOf(memo.text, t('ide.memo.title'))}
        </span>
        <button
          ref={paletteBtnRef}
          type="button"
          title={t('ide.memo.color')}
          aria-label={t('ide.memo.color')}
          onClick={() => setPaletteOpen((v) => !v)}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-black/10"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-9z" />
          </svg>
        </button>
        <button
          type="button"
          title={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          aria-label={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          onClick={() => { onChange({ collapsed: !collapsed }); onCommit(); }}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-black/10"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed ? <path d="m6 9 6 6 6-6" /> : <path d="m18 15-6-6-6 6" />}
          </svg>
        </button>
        <button
          type="button"
          title={t('ide.memo.delete')}
          aria-label={t('ide.memo.delete')}
          onClick={onDelete}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-black/15"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          {paletteOpen && (
            <div ref={paletteRef} className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-black/10 px-1.5 py-1">
              {SESSION_MEMO_PALETTE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => { onChange({ color: c.color }); onCommit(); setPaletteOpen(false); }}
                  className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                    c.color === memo.color ? 'border-black/60 ring-1 ring-black/40' : 'border-black/20'
                  }`}
                  style={{ backgroundColor: c.color }}
                />
              ))}
            </div>
          )}
          <textarea
            ref={textRef}
            value={memo.text}
            aria-label={t('ide.memo.title')}
            maxLength={SESSION_MEMO.TEXT_MAX}
            spellCheck={false}
            placeholder={t('ide.memo.placeholder')}
            onChange={(e) => onChange({ text: e.target.value })}
            onBlur={onCommit}
            className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-snug outline-none placeholder:opacity-40"
          />
          <div
            // 마우스 전용 손잡이 — 키보드로는 닿을 수 없으므로 보조기술에는 감춘다.
            aria-hidden="true"
            title={t('ide.memo.resize')}
            onPointerDown={startResize}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          >
            <svg className="h-4 w-4 opacity-40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M14 6 6 14" />
              <path d="M14 11l-3 3" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
