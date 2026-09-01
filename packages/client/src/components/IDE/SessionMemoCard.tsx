import { memo as reactMemo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SESSION_MEMO, SESSION_MEMO_PALETTE, type SessionMemo } from '@vibisual/shared';
import { CommentBoxColorPopover } from '../Panel/CommentBoxColorPopover.js';
import { memoAlpha, memoSurface, moveMemo, resizeMemo, type MemoBounds, type MemoPatch } from './sessionMemo.js';

/**
 * SessionMemoCard.tsx — §5.5 #17-36 스티키 메모 한 장.
 *
 * 몸가짐은 창(제목줄을 끌어 옮기고, 우하단을 끌어 늘리고, 접고, 닫는다), 겉모습은 **앱과 같은
 * 어두운 유리판**이다. 처음의 밝은 파스텔 종이는 `bg-gray-950` 본문 위에서 혼자 튀었고,
 * 불투명해서 가린 대화를 볼 방법도 없었다. 지금은 색 × 불투명도(`SessionMemo.alpha`)로 그리고,
 * 뒤는 `backdrop-filter` 로 흐린다 — 글자색은 색이 아니라 **알파를 섞어 실제로 보이는 색**으로
 * 정해지므로(`memoSurface`) 어느 조합에서도 대비가 무너지지 않는다.
 *
 * ⚠ **끄는 동안에는 React 를 거치지 않는다.** 종전에는 pointermove 마다 판 전체의 낙관 상태를
 * 갱신했고(→ 층 + 모든 카드 리렌더 + 저장 디바운스 재설정), 그래서 스트리밍으로 이미 바쁜
 * 메인스레드에서 커서가 카드를 앞질렀다. 지금은 제스처 중에 이 카드의 `transform`(이동) /
 * `width·height`(크기)만 직접 쓰고, **손을 뗄 때 한 번** 값을 올린다. React 가 소유하지 않는
 * `transform` 은 우리가 지우고, `width·height` 는 커밋 렌더가 덮어쓰므로 둘이 다투지 않는다.
 *
 * 이동·리사이즈는 pointer capture 로 잡는다(window 리스너 ❌) — 손가락·펜에서도 그대로 동작하고,
 * 커서가 카드 밖으로 나가도 이벤트가 끊기지 않는다. 좌표 산수는 전부 `sessionMemo.ts`(순수 함수)가 한다.
 *
 * 색 고르기는 **앱의 색 선택기**(`CommentBoxColorPopover`)를 그대로 쓴다. 카드 안에 스와치 줄을
 * 펼치던 종전 방식은 본문을 아래로 밀어냈고 자유색·불투명도를 고를 길이 없었다. 팝오버는
 * `position: fixed` 라 카드의 `overflow-hidden` 과 드래그용 `transform` 에 갇히지 않도록
 * **body 로 포털**한다.
 */

/** 저장은 언제 — `'defer'` 는 잠잠해지면, `'now'` 는 지금. */
export type MemoSaveWhen = 'defer' | 'now';

interface SessionMemoCardProps {
  memo: SessionMemo;
  /** 메모가 놓인 판의 크기 — 이동·리사이즈 한계. */
  bounds: MemoBounds;
  /** 배열 순서에서 온 겹침 순서. */
  zIndex: number;
  /** 방금 만든 메모 — 마운트 직후 본문에 커서를 둔다. */
  autoFocus: boolean;
  /**
   * 값 갱신. **id 를 함께 넘긴다** — 카드마다 새 클로저를 만들면 `memo()` 가 무력해져
   * 한 장을 건드릴 때마다 모든 카드가 다시 그려진다.
   */
  onPatch: (id: string, patch: MemoPatch, when: MemoSaveWhen) => void;
  /** 이 장을 맨 앞으로. */
  onRaise: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 방금 닫힌 팝오버를 같은 클릭이 다시 여는 것을 막는 창(ms). */
const PICKER_REOPEN_GUARD_MS = 200;

/** 불투명도를 눈으로 보여 주는 체커보드 — 색 칩 뒤에 깔린다. */
const CHECKERBOARD = 'repeating-conic-gradient(rgba(148,163,184,0.55) 0% 25%, rgba(226,232,240,0.55) 0% 50%) 50% / 6px 6px';

/** 제목줄에 보일 한 줄 — 본문 첫 줄(없으면 라벨). 접었을 때 무슨 메모인지 알아보는 유일한 단서다. */
function titleOf(text: string, fallback: string): string {
  const first = text.split('\n', 1)[0]?.trim() ?? '';
  return first.length > 0 ? first : fallback;
}

function SessionMemoCardImpl({
  memo, bounds, zIndex, autoFocus, onPatch, onRaise, onDelete,
}: SessionMemoCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

  // 핸들러가 매 렌더 새로 만들어지지 않도록 최신 값을 ref 로 넘긴다(제스처 중 낡은 값 참조 ❌).
  const memoRef = useRef(memo);
  memoRef.current = memo;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  /** 끌고 있는 제스처 — null 이면 안 끌고 있다. */
  const gestureRef = useRef<{
    kind: 'move' | 'resize';
    px: number;
    py: number;
    start: { x: number; y: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  const alpha = memoAlpha(memo);
  const surface = memoSurface(memo.color, alpha);
  const collapsed = memo.collapsed === true;

  // ─── 제스처: 손을 떼기 전까지 DOM 만 만진다 ───

  const beginGesture = useCallback((e: React.PointerEvent<HTMLElement>, kind: 'move' | 'resize') => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    const m = memoRef.current;
    onRaise(m.id);
    gestureRef.current = { kind, px: e.clientX, py: e.clientY, start: { x: m.x, y: m.y, w: m.w, h: m.h } };
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = rootRef.current;
    // 합성기에 "이 축이 곧 움직인다"를 미리 알린다 — 첫 프레임의 승격 비용을 없앤다.
    if (el) el.style.willChange = kind === 'move' ? 'transform' : 'width, height';
  }, [onRaise]);

  const moveGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    const el = rootRef.current;
    if (!g || !el) return;
    const m = memoRef.current;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (g.kind === 'move') {
      const next = moveMemo(m, g.start, dx, dy, boundsRef.current);
      // React 가 그린 좌표는 그대로 두고 그 위에서만 민다 — 커밋 때 이 한 줄만 지우면 원위치다.
      el.style.transform = `translate3d(${next.x - m.x}px, ${next.y - m.y}px, 0)`;
    } else {
      const next = resizeMemo(m, g.start, dx, dy, boundsRef.current);
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
    }
  }, []);

  const endGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    const el = rootRef.current;
    if (!g) return;
    gestureRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const m = memoRef.current;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (el) el.style.willChange = '';
    if (g.kind === 'move') {
      // transform 은 React 가 모르는 값이라 우리가 지운다(안 지우면 커밋된 좌표에 델타가 또 얹힌다).
      if (el) el.style.transform = '';
      const next = moveMemo(m, g.start, dx, dy, boundsRef.current);
      onPatch(m.id, { x: next.x, y: next.y }, 'now');
    } else {
      // width·height 는 React 가 소유한다 — 아래 커밋 렌더가 같은 값으로 덮어쓴다.
      const next = resizeMemo(m, g.start, dx, dy, boundsRef.current);
      onPatch(m.id, { w: next.w, h: next.h }, 'now');
    }
  }, [onPatch]);

  const onHeaderDown = useCallback((e: React.PointerEvent<HTMLElement>) => beginGesture(e, 'move'), [beginGesture]);
  const onHandleDown = useCallback((e: React.PointerEvent<HTMLElement>) => beginGesture(e, 'resize'), [beginGesture]);

  // ─── 버튼 ───

  const toggleCollapsed = useCallback(() => {
    const m = memoRef.current;
    onPatch(m.id, { collapsed: m.collapsed !== true }, 'now');
  }, [onPatch]);

  /**
   * 색 칩은 토글이어야 하는데, 팝오버가 **먼저** 바깥 누름(pointerdown)으로 닫히고 그 다음
   * 클릭이 도착한다 — 그 클릭이 보는 상태는 이미 "닫힘"이라 그대로 두면 영영 안 닫힌다.
   * 그래서 방금 닫혔는지를 시각으로 본다(팝오버에 트리거 ref 를 넘기는 길이 없다).
   */
  const closedAtRef = useRef(0);
  const closePicker = useCallback(() => {
    closedAtRef.current = Date.now();
    setPickerAnchor(null);
  }, []);
  const openPicker = useCallback(() => {
    if (Date.now() - closedAtRef.current < PICKER_REOPEN_GUARD_MS) return;
    const r = colorBtnRef.current?.getBoundingClientRect();
    setPickerAnchor(r ? { x: r.right, y: r.top } : { x: 0, y: 0 });
  }, []);

  return (
    // 위치·크기·색은 사용자가 정하는 **데이터**라 style 로 간다(Tailwind 클래스로는 표현 불가).
    //   `--memo-line` 은 밝은 판/어두운 판에 따라 뒤집히는 선 색 — hover 배경이 이 값을 쓴다.
    //   포커스 표시가 ring 이 아니라 outline 인 것도 같은 이유다 — ring 은 box-shadow 라 아래
    //   인라인 `boxShadow`(유리 하이라이트 + 그림자)에 통째로 덮여 한 픽셀도 안 보인다.
    <div
      ref={rootRef}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg focus-within:[outline:1px_solid_#38BDF8AA] focus-within:[outline-offset:-1px]"
      style={{
        left: memo.x,
        top: memo.y,
        width: memo.w,
        height: collapsed ? SESSION_MEMO.HEADER_H : memo.h,
        background: surface.background,
        color: surface.text,
        border: `1px solid ${surface.border}`,
        boxShadow: `inset 0 1px 0 ${surface.glassEdge}, 0 10px 28px -10px rgba(0,0,0,0.65), 0 2px 8px -4px rgba(0,0,0,0.5)`,
        ...(surface.blur ? { backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)' } : {}),
        ['--memo-line' as string]: surface.hairline,
        zIndex,
      }}
      onPointerDown={() => onRaise(memo.id)}
      data-session-memo={memo.id}
    >
      <div
        className="flex flex-shrink-0 cursor-grab touch-none select-none items-center gap-1 pl-2 pr-1 active:cursor-grabbing"
        style={{
          height: SESSION_MEMO.HEADER_H,
          background: surface.headerTint,
          ...(collapsed ? {} : { borderBottom: `1px solid ${surface.hairline}` }),
        }}
        onPointerDown={onHeaderDown}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onDoubleClick={toggleCollapsed}
      >
        <svg className="h-3.5 w-3.5 flex-shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium opacity-90">
          {titleOf(memo.text, t('ide.memo.title'))}
        </span>
        {/* 색 칩 — 지금 색과 지금 불투명도를 그대로 보여 준다(체커보드가 비치는 만큼이 뚫린 정도). */}
        <button
          ref={colorBtnRef}
          type="button"
          title={t('ide.memo.color')}
          aria-label={t('ide.memo.color')}
          aria-haspopup="dialog"
          aria-expanded={pickerAnchor !== null}
          onClick={openPicker}
          className="relative mr-0.5 h-4 w-4 flex-shrink-0 overflow-hidden rounded-full transition-transform hover:scale-110"
          style={{ background: CHECKERBOARD, boxShadow: `inset 0 0 0 1px ${surface.hairline}` }}
        >
          <span className="absolute inset-0" style={{ backgroundColor: memo.color, opacity: alpha }} />
        </button>
        <button
          type="button"
          title={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          aria-label={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          onClick={toggleCollapsed}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--memo-line)]"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed ? <path d="m6 9 6 6 6-6" /> : <path d="m18 15-6-6-6 6" />}
          </svg>
        </button>
        <button
          type="button"
          title={t('ide.memo.delete')}
          aria-label={t('ide.memo.delete')}
          onClick={() => onDelete(memo.id)}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-rose-500/30"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          <textarea
            ref={textRef}
            value={memo.text}
            aria-label={t('ide.memo.title')}
            maxLength={SESSION_MEMO.TEXT_MAX}
            spellCheck={false}
            placeholder={t('ide.memo.placeholder')}
            onChange={(e) => onPatch(memo.id, { text: e.target.value }, 'defer')}
            onBlur={() => onPatch(memo.id, {}, 'now')}
            className="min-h-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:opacity-40"
          />
          <div
            // 마우스 전용 손잡이 — 키보드로는 닿을 수 없으므로 보조기술에는 감춘다.
            aria-hidden="true"
            title={t('ide.memo.resize')}
            onPointerDown={onHandleDown}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          >
            <svg className="h-4 w-4 opacity-40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M14 6 6 14" />
              <path d="M14 11l-3 3" />
            </svg>
          </div>
        </>
      )}

      {/* 색 선택기 — 카드의 overflow-hidden·transform 에 갇히지 않게 body 로 포털한다. */}
      {pickerAnchor && createPortal(
        <CommentBoxColorPopover
          value={memo.color}
          alpha={alpha}
          presets={SESSION_MEMO_PALETTE}
          anchor={pickerAnchor}
          onLive={(hex, a) => onPatch(memo.id, { color: hex, alpha: a }, 'defer')}
          onCommit={(hex, a) => onPatch(memo.id, { color: hex, alpha: a }, 'now')}
          onClose={closePicker}
        />,
        document.body,
      )}
    </div>
  );
}

/**
 * 한 장이 바뀌었다고 나머지가 다시 그려지면 안 된다 — 층은 판 전체를 낙관 갱신하므로, 이 `memo()`
 * 가 없으면 글자 하나에 24장이 통째로 리렌더된다. 위 핸들러들이 id 를 인자로 받는 이유가 이것이다
 * (카드마다 새 클로저를 주면 `memo()` 가 항상 헛된다).
 */
export const SessionMemoCard = reactMemo(SessionMemoCardImpl);
