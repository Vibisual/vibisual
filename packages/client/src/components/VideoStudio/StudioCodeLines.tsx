import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { useCoarsePointer } from '../../hooks/useIsMobile.js';
import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { highlightCode, type CodeLine } from '../IDE/codeHighlight.js';
import { TOKEN_CLASS, languageFromPath } from '../IDE/codeLanguages.js';

/**
 * §5.13 (V) 37-20 — 코드 칸의 줄들(읽기 전용 — 입력 칸이 아니다: `textarea`·`contenteditable` ❌). 보이는 줄만 그린다(줄 높이 고정 · 가로 스크롤).
 * 문법 색은 IDE 편집창의 `highlightCode` 를 그대로 쓴다(새 의존성 ❌).
 */

/** 줄 높이(px) — 보이는 줄 계산과 줄 상자가 같은 값을 쓴다(rem 배율에 기대지 않게 값으로 준다). 터치는 손가락 크기. */
export const CODE_ROW_PX = 20;
export const CODE_ROW_TOUCH_PX = 28;
/** 화면 밖으로 미리 그려 두는 줄 수(굴릴 때 빈 띠가 보이지 않게). */
const OVERSCAN_ROWS = 12;
/** 상자 높이를 아직 못 쟀을 때 그리는 줄 수. */
const UNMEASURED_ROWS = 60;
/** 한 줄에서 그리는 글자 상한 — 압축된 한 줄짜리 파일이 줄 하나에 수십만 글자를 넣지 않게. */
export const CODE_LINE_MAX_CHARS = 2000;

export interface CodeLinesFocus {
  readonly line: number;
  readonly endLine: number;
  /** 바뀌면 그 줄이 보이게 굴린다(같은 줄을 다시 골라도). */
  readonly seq: number;
}

export interface StudioCodeLinesProps {
  readonly text: string;
  readonly path: string;
  readonly focus: CodeLinesFocus | null;
  /** 줄을 고를 수 있는가(줄 연결이 있는 파일). */
  readonly selectable: boolean;
  readonly onSelectLine: (line: number) => void;
  readonly label: string;
}

/** 보이는 줄 범위(0부터, `last` 는 들어가지 않는다). */
export function visibleRows(scrollTop: number, height: number, rowPx: number, total: number): { first: number; last: number } {
  if (height <= 0) return { first: 0, last: Math.min(total, UNMEASURED_ROWS) };
  const first = Math.max(0, Math.floor(scrollTop / rowPx) - OVERSCAN_ROWS);
  const last = Math.min(total, Math.ceil((scrollTop + height) / rowPx) + OVERSCAN_ROWS);
  return { first: Math.min(first, Math.max(0, total - 1)), last: Math.max(last, Math.min(total, first + 1)) };
}

/** 그 줄이 보이게 하려면 어디로 굴려야 하나. 이미 보이면 null. */
export function scrollTopFor(line: number, scrollTop: number, height: number, rowPx: number): number | null {
  const y = (line - 1) * rowPx;
  if (height <= 0 || (y >= scrollTop && y + rowPx <= scrollTop + height)) return null;
  return Math.max(0, y - Math.floor(height / 3));
}

const CodeRow = memo(function CodeRow({ n, tokens, state, style, selectable, onSelect }: {
  readonly n: number;
  readonly tokens: CodeLine;
  readonly state: 'line' | 'band' | 'none';
  readonly style: CSSProperties;
  readonly selectable: boolean;
  readonly onSelect: (line: number) => void;
}): React.JSX.Element {
  let used = 0;
  const shown: React.JSX.Element[] = [];
  for (let i = 0; i < tokens.length && used < CODE_LINE_MAX_CHARS; i += 1) {
    const token = tokens[i]!;
    const text = token.text.length > CODE_LINE_MAX_CHARS - used ? `${token.text.slice(0, CODE_LINE_MAX_CHARS - used)}…` : token.text;
    used += token.text.length;
    shown.push(<span key={i} className={TOKEN_CLASS[token.kind]}>{text}</span>);
  }
  const tone = state === 'line' ? 'bg-white/[0.12]' : state === 'band' ? 'bg-white/[0.05]' : selectable ? 'hover:bg-white/[0.04]' : '';
  return (
    <div role="option" aria-selected={state === 'line'} data-line={n} style={style}
      onClick={selectable ? () => onSelect(n) : undefined}
      className={`flex items-center whitespace-pre pr-4 leading-none ${selectable ? 'cursor-pointer' : ''} ${tone}`}>
      <span className={`sticky left-0 mr-3 flex h-full w-12 shrink-0 select-none items-center justify-end border-l-2 pr-2 tabular-nums ${state === 'line' ? 'border-slate-100 bg-vb-raised text-slate-100' : 'border-transparent bg-vb-sunken text-slate-500'}`}>{n}</span>
      {shown}
    </div>
  );
});

export const StudioCodeLines = memo(function StudioCodeLines(p: StudioCodeLinesProps): React.JSX.Element {
  const coarse = useCoarsePointer();
  const rowPx = coarse ? CODE_ROW_TOUCH_PX : CODE_ROW_PX;
  const lines = useMemo(() => highlightCode(p.text, languageFromPath(p.path)), [p.text, p.path]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const reveal = useScrollReveal();
  const measure = (): void => {
    const el = boxRef.current;
    if (!el) return;
    setView((prev) => (prev.top === el.scrollTop && prev.height === el.clientHeight ? prev : { top: el.scrollTop, height: el.clientHeight }));
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 고른 줄이 바뀌면(집었을 때·화살표로 옮겼을 때) 그 줄이 보이게 굴린다 — 이미 보이면 그대로 둔다.
  const focusSeq = p.focus?.seq ?? 0;
  const focusLine = p.focus?.line ?? 0;
  useEffect(() => {
    const el = boxRef.current;
    if (!el || focusLine <= 0) return;
    const next = scrollTopFor(focusLine, el.scrollTop, el.clientHeight, rowPx);
    if (next !== null) { el.scrollTop = next; measure(); }
  }, [focusSeq, focusLine, rowPx, p.text]);

  const { first, last } = visibleRows(view.top, view.height, rowPx, lines.length);
  const rowStyle = useMemo<CSSProperties>(() => ({ height: rowPx }), [rowPx]);
  const { onSelectLine, selectable } = p;
  return (
    <div ref={boxRef} role="listbox" aria-label={p.label} aria-readonly="true" tabIndex={0}
      className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-vb-sunken font-mono text-[12px] text-slate-200 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--vs-accent)]"
      data-scrolling={reveal['data-scrolling']}
      onScroll={() => { reveal.onScroll(); measure(); }}
      onKeyDown={(e) => {
        // 이 칸 안에서만 — ↑/↓ 로 고른 줄을 옮긴다(스튜디오 단축키는 ←/→ 만 쓴다). 조합 입력·보조 키와는 겹치지 않게.
        if (!selectable || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        const from = focusLine > 0 ? focusLine : Math.floor(view.top / rowPx) + 1;
        onSelectLine(Math.max(1, Math.min(lines.length, from + (e.key === 'ArrowUp' ? -1 : 1))));
      }}>
      <div className="relative min-w-max" style={{ height: lines.length * rowPx }}>
        <div className="absolute left-0 min-w-full" style={{ top: first * rowPx }}>
          {lines.slice(first, last).map((tokens, i) => {
            const n = first + i + 1;
            const state = p.focus ? (n === p.focus.line ? 'line' : n > p.focus.line && n <= p.focus.endLine ? 'band' : 'none') : 'none';
            return <CodeRow key={n} n={n} tokens={tokens} state={state} style={rowStyle} selectable={selectable} onSelect={onSelectLine} />;
          })}
        </div>
      </div>
    </div>
  );
});
