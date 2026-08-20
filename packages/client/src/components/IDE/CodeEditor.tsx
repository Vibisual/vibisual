import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightCode, type CodeLine } from './codeHighlight.js';
import { TOKEN_CLASS } from './codeLanguages.js';
import { applyDedent, applyIndent } from './editorModel.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';

/**
 * CodeEditor.tsx — §5.5 #17-27 v4.87 실제로 타이핑하는 편집 표면.
 *
 * 색이 입혀진 `<pre>` 위에 **투명한 `<textarea>`** 를 겹친다(§5.5 #17-27 ⑤) — 캐럿·선택·IME·
 * 되돌리기는 브라우저의 것을 그대로 쓰고, 우리는 그 아래에 같은 글자를 색만 다르게 한 벌 더 그린다.
 * 두 층은 **같은 글꼴·행간·패딩**을 써야 한 글자라도 어긋나지 않으므로, 그 값들은 아래 상수 한 곳에서
 * 나온다(양쪽에 따로 적으면 언젠가 반드시 어긋난다).
 */

/** 두 층이 공유하는 글자 배치 — 여기만 고치면 본문·줄번호가 함께 따라온다. */
const LAYER_TEXT = 'font-mono text-[13px] leading-[19px]';
const LAYER_PAD = 'px-3 py-2';
/**
 * §5.5 #17-27 ⑪ — 줄 번호로 스크롤 위치를 계산할 때 쓰는 치수. **위 두 상수와 같은 값**이어야 한다
 * (`leading-[19px]` / `py-2` = 8px). 어긋나면 스크롤이 매 줄 조금씩 밀린다.
 */
const LINE_HEIGHT_PX = 19;
const LAYER_PAD_TOP_PX = 8;
/** 줄 번호 칸 폭(자릿수와 무관하게 고정) — 스크롤 중 본문이 좌우로 흔들리지 않게. */
const GUTTER_CLASS = 'w-12 flex-shrink-0 select-none border-r border-gray-800/70 bg-gray-950 text-right';

interface CodeEditorProps {
  /** 화면에 그릴 본문(초안) */
  text: string;
  /** 강조에 쓸 언어 id (`languageFromPath` 결과) */
  language: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  /**
   * §5.5 #17-20 ⑩ v4.94 — 이 파일에 찍힌 중단점 줄 번호(1-based).
   * 없으면 gutter 는 종전 그대로 번호만 그린다(디버그를 안 쓰는 사용자에게 달라지는 것 ❌).
   */
  breakpointLines?: ReadonlySet<number>;
  /** 줄 번호를 눌렀을 때. 없으면 gutter 는 클릭 대상이 아니다. */
  onToggleBreakpoint?: (line: number) => void;
  /** 지금 디버거가 멈춰 서 있는 줄(다른 파일이면 null). */
  stoppedLine?: number | null;
  /** 줄 번호 칸의 툴팁(i18n 문자열은 부모가 넘긴다 — 이 컴포넌트는 순수 표시). */
  toggleBreakpointTitle?: string;
  /**
   * §5.5 #17-27 ⑨ v4.97 — 본문 우클릭 메뉴 항목을 만들어 주는 부모 콜백.
   * 편집 조작(잘라내기·붙여넣기·되돌리기)은 textarea 를 쥔 이 컴포넌트만 할 수 있으므로
   * **조작 묶음을 넘겨 주고**, 라벨·저장 같은 바깥 항목은 부모가 얹는다. 없으면 우클릭은 무동작.
   */
  buildBodyMenu?: (ctx: CodeEditorBodyMenuContext) => ContextMenuItem[];
  /** §5.5 #17-27 ⑨ — 줄 번호 칸 우클릭 메뉴 항목(그 줄 번호와 본문을 넘긴다). */
  buildGutterMenu?: (line: number, lineText: string) => ContextMenuItem[];
  /**
   * §5.5 #17-27 ⑪ — [추종] 이 방금 고쳐진 줄들. 있으면 그 줄이 보이도록 **부드럽게 스크롤**하고
   * 그동안 그 줄들이 잠깐 강조된다. 없으면(=평소) 이 컴포넌트는 종전과 완전히 같다.
   */
  followRange?: FollowRange | null;
  /**
   * 같은 범위가 다시 와도 한 번 더 움직여야 하므로, **신호마다 달라지는 값**을 함께 받는다
   * (편집 신고의 시각). 이 값이 바뀔 때마다 스크롤이 한 번 일어난다.
   */
  followToken?: number;
  /**
   * §5.5 #17-27 ⑪ (h) ④ — **잔상**. 강조(1.8초)가 꺼진 뒤에도 다음 편집까지 남는 "방금 바뀐 자리" 표시.
   * 번호 칸에 파란 막대, 본문에 아주 옅은 파란 배경 — 나중에 봐도 어디가 바뀌었는지 알 수 있다.
   */
  recentRange?: FollowRange | null;
}

/** §5.5 #17-27 ⑪ — 강조·스크롤 대상 줄 범위(1-based, 양끝 포함). */
export interface FollowRange {
  start: number;
  end: number;
}

/** 본문 우클릭 시점의 상태 + 그 자리에서만 할 수 있는 편집 조작. */
export interface CodeEditorBodyMenuContext {
  /** 우클릭 지점의 줄(1-based) */
  line: number;
  lineText: string;
  hasSelection: boolean;
  selectedText: string;
  readOnly: boolean;
  actions: {
    cut: () => void;
    copy: () => void;
    paste: () => void;
    selectAll: () => void;
    undo: () => void;
    redo: () => void;
  };
}

/** 한 줄 — 토큰이 그대로면 다시 그리지 않는다(긴 파일에서 타이핑 한 번에 전 줄이 다시 그려지는 것 방지). */
const CodeLineRow = memo(
  function CodeLineRow({ line, stopped, flash, recent }: { line: CodeLine; stopped: boolean; flash: boolean; recent: boolean }): React.JSX.Element {
    // 방금 고쳐진 줄(#17-27 ⑪)은 배경이 차올랐다 사라진다 — 디버거 정지 줄(호박색)과 색을 달리해 겹쳐도 구분된다.
    //   강조가 꺼진 뒤에는 아주 옅은 파란 배경(잔상)만 남아 "여기가 바뀐 자리" 를 계속 알려 준다.
    const cls = [
      stopped ? 'bg-amber-500/15' : recent && !flash ? 'bg-blue-500/[0.07]' : '',
      flash ? 'animate-edit-follow-flash' : '',
    ].filter(Boolean).join(' ') || undefined;
    if (line.length === 0) return <div className={cls}>{' '}</div>;
    return (
      <div className={cls}>
        {line.map((token, i) => (
          <span key={i} className={TOKEN_CLASS[token.kind]}>{token.text}</span>
        ))}
      </div>
    );
  },
  (a, b) => {
    // stopped 를 빠뜨리면 멈춘 줄이 옮겨가도 강조가 따라오지 않는다.
    if (a.stopped !== b.stopped) return false;
    if (a.flash !== b.flash) return false;
    if (a.recent !== b.recent) return false;
    if (a.line.length !== b.line.length) return false;
    return a.line.every((t, i) => t.text === b.line[i]!.text && t.kind === b.line[i]!.kind);
  },
);

export const CodeEditor = memo(function CodeEditor({
  text,
  language,
  readOnly,
  onChange,
  onSave,
  breakpointLines,
  onToggleBreakpoint,
  stoppedLine = null,
  toggleBreakpointTitle,
  buildBodyMenu,
  buildGutterMenu,
  followRange = null,
  followToken = 0,
  recentRange = null,
}: CodeEditorProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 프로그램이 바꾼 본문의 커서 위치 — 값이 반영된 **뒤에** 넣어야 커서가 끝으로 튀지 않는다. */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [caretLine, setCaretLine] = useState(1);

  const lines = useMemo(() => highlightCode(text, language), [text, language]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    el.setSelectionRange(sel.start, sel.end);
    pendingSelection.current = null;
  }, [text]);

  /** 줄 번호는 본문과 같은 스크롤을 따라야 한다 — 세로만 옮긴다(가로는 본문만 움직인다). */
  const handleScroll = useCallback((): void => {
    const gutter = gutterRef.current;
    const scroller = scrollRef.current;
    if (!gutter || !scroller) return;
    gutter.scrollTop = scroller.scrollTop;
  }, []);

  /**
   * §5.5 #17-27 ⑪ — 방금 고쳐진 줄로 부드럽게 스크롤한다.
   *
   * 모든 줄을 그대로 그리는 편집창이라(가상 리스트 ❌) 위치는 **줄 번호 × 행간**으로 바로 나온다.
   * 목적지를 화면 위쪽 1/3 에 두는 이유는, 고쳐진 줄 **아래로 이어지는 코드**가 함께 보여야
   * 무엇이 바뀐 것인지 읽히기 때문이다. `prefers-reduced-motion` 이면 미끄러지지 않고 즉시 옮긴다.
   */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !followRange || followRange.start < 1) return;
    const top = LAYER_PAD_TOP_PX + (followRange.start - 1) * LINE_HEIGHT_PX;
    const target = Math.max(0, top - Math.max(48, Math.round(scroller.clientHeight / 3)));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scroller.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    // 줄 번호 칸은 부드러운 스크롤이 만드는 scroll 이벤트를 타고 따라온다(handleScroll).
  }, [followToken, followRange]);

  const updateCaretLine = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    setCaretLine(el.value.slice(0, el.selectionStart).split('\n').length);
  }, []);

  // ─── §5.5 #17-27 ⑨ v4.97 우클릭 ────────────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /** 우클릭한 순간의 선택 범위 — 메뉴 버튼을 누르면 초점이 옮겨가므로 되돌려 놓고 조작한다. */
  const menuSelection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const focusWithSelection = useCallback((): HTMLTextAreaElement | null => {
    const el = textareaRef.current;
    if (!el) return null;
    el.focus();
    el.setSelectionRange(menuSelection.current.start, menuSelection.current.end);
    return el;
  }, []);

  /**
   * 선택 범위를 주어진 글자로 갈아 끼운다.
   * `insertText` 로 넣어야 브라우저의 되돌리기 기록이 끊기지 않는다 — 값을 통째로 갈아 끼우면
   * 그 한 걸음을 Ctrl+Z 가 잃는다. 지원하지 않는 환경에서만 직접 계산으로 물러선다.
   */
  const replaceSelection = useCallback((insert: string): void => {
    const el = focusWithSelection();
    if (!el || readOnly) return;
    if (document.execCommand('insertText', false, insert)) return;
    const { start, end } = menuSelection.current;
    const caret = start + insert.length;
    pendingSelection.current = { start: caret, end: caret };
    onChange(`${el.value.slice(0, start)}${insert}${el.value.slice(end)}`);
  }, [focusWithSelection, onChange, readOnly]);

  const menuActions = useMemo(() => ({
    copy: (): void => {
      const el = textareaRef.current;
      if (!el) return;
      const sel = el.value.slice(menuSelection.current.start, menuSelection.current.end);
      if (sel) void navigator.clipboard?.writeText(sel).catch(() => { /* 클립보드 거부는 조용히 */ });
    },
    cut: (): void => {
      const el = textareaRef.current;
      if (!el) return;
      const sel = el.value.slice(menuSelection.current.start, menuSelection.current.end);
      if (!sel) return;
      void navigator.clipboard?.writeText(sel).catch(() => { /* 클립보드 거부는 조용히 */ });
      replaceSelection('');
    },
    paste: (): void => {
      if (!navigator.clipboard?.readText) return;
      void navigator.clipboard.readText()
        .then((clip) => { if (clip) replaceSelection(clip); })
        .catch(() => { /* 클립보드 거부는 조용히 */ });
    },
    selectAll: (): void => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.select();
    },
    undo: (): void => { focusWithSelection(); document.execCommand('undo'); },
    redo: (): void => { focusWithSelection(); document.execCommand('redo'); },
  }), [focusWithSelection, replaceSelection]);

  const handleBodyContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>): void => {
    if (!buildBodyMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    menuSelection.current = { start: el.selectionStart, end: el.selectionEnd };
    const before = el.value.slice(0, el.selectionStart);
    const line = before.split('\n').length;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildBodyMenu({
        line,
        lineText: el.value.split('\n')[line - 1] ?? '',
        hasSelection: el.selectionEnd > el.selectionStart,
        selectedText: el.value.slice(el.selectionStart, el.selectionEnd),
        readOnly,
        actions: menuActions,
      }),
    });
  }, [buildBodyMenu, menuActions, readOnly]);

  const handleGutterContextMenu = useCallback((e: React.MouseEvent, lineNo: number): void => {
    if (!buildGutterMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const lineText = textareaRef.current?.value.split('\n')[lineNo - 1] ?? '';
    setMenu({ x: e.clientX, y: e.clientY, items: buildGutterMenu(lineNo, lineText) });
  }, [buildGutterMenu]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
      return;
    }

    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      const out = e.shiftKey
        ? applyDedent(el.value, el.selectionStart, el.selectionEnd)
        : applyIndent(el.value, el.selectionStart, el.selectionEnd);
      pendingSelection.current = { start: out.selectionStart, end: out.selectionEnd };
      onChange(out.text);
    }
  }, [onChange, onSave, readOnly]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
      {/*
        줄 번호 = 중단점 gutter (§5.5 #17-20 ⑩ v4.94).
        새 레이아웃을 얹은 것이 아니라 **이미 줄 단위로 그리던 요소**에 클릭 하나를 준 것이다 —
        그래서 두 층(본문·번호)의 행간 계약은 그대로다.
      */}
      <div ref={gutterRef} className={`${GUTTER_CLASS} overflow-hidden`}>
        <div className={`${LAYER_TEXT} ${LAYER_PAD} pl-0 pr-2`}>
          {lines.map((_, i) => {
            const lineNo = i + 1;
            const hasBreakpoint = breakpointLines?.has(lineNo) ?? false;
            const isStopped = stoppedLine === lineNo;
            const isFollowed = !!followRange && lineNo >= followRange.start && lineNo <= followRange.end;
            const isRecent = !!recentRange && lineNo >= recentRange.start && lineNo <= recentRange.end;
            return (
              <div
                // 강조가 다시 시작되려면 요소가 새로 붙어야 한다(같은 줄이 연달아 고쳐지는 경우).
                key={isFollowed ? `${i}:${followToken}` : i}
                onClick={onToggleBreakpoint ? () => onToggleBreakpoint(lineNo) : undefined}
                onContextMenu={(e) => handleGutterContextMenu(e, lineNo)}
                title={onToggleBreakpoint ? toggleBreakpointTitle : undefined}
                className={[
                  'relative flex items-center justify-end gap-1 pr-1',
                  onToggleBreakpoint ? 'cursor-pointer hover:bg-gray-800/60' : '',
                  isStopped ? 'bg-amber-500/20 text-amber-200' : lineNo === caretLine ? 'text-gray-300' : 'text-gray-600',
                  // §5.5 #17-27 ⑪ — 번호 칸도 함께 물들어야 강조가 한 줄 띠로 이어져 보인다.
                  isFollowed ? 'animate-edit-follow-flash' : '',
                ].join(' ')}
              >
                {hasBreakpoint && (
                  <span className="absolute left-1 h-2 w-2 rounded-full bg-rose-500" aria-hidden />
                )}
                {/* §5.5 #17-27 ⑪ (h) ④ — 잔상 막대. 강조가 꺼진 뒤에도 다음 편집까지 이 줄에 남는다. */}
                {isRecent && (
                  <span className="absolute right-0 top-0 h-full w-[2px] bg-blue-400/70" aria-hidden />
                )}
                {isStopped && !hasBreakpoint && (
                  <span className="absolute left-1 text-[12px] leading-none text-amber-300" aria-hidden>
                    &#9656;
                  </span>
                )}
                {lineNo}
              </div>
            );
          })}
        </div>
      </div>

      {/* 본문 — 스크롤은 이 컨테이너가 단독으로 소유하고, 두 층은 그 안에서 같은 크기로 겹친다. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin relative min-w-0 flex-1 overflow-auto"
      >
        <div className="relative min-h-full w-max min-w-full">
          <pre aria-hidden className={`${LAYER_TEXT} ${LAYER_PAD} m-0 whitespace-pre`}>
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const isFollowed = !!followRange && lineNo >= followRange.start && lineNo <= followRange.end;
              const isRecent = !!recentRange && lineNo >= recentRange.start && lineNo <= recentRange.end;
              return (
                <CodeLineRow
                  key={isFollowed ? `${i}:${followToken}` : i}
                  line={line}
                  stopped={stoppedLine === lineNo}
                  flash={isFollowed}
                  recent={isRecent}
                />
              );
            })}
          </pre>
          <textarea
            ref={textareaRef}
            value={text}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => { onChange(e.target.value); updateCaretLine(); }}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCaretLine}
            onClick={updateCaretLine}
            onContextMenu={handleBodyContextMenu}
            className={`${LAYER_TEXT} ${LAYER_PAD} absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre border-0 bg-transparent text-transparent caret-gray-100 outline-none selection:bg-blue-500/30`}
          />
        </div>
      </div>

      {menu && (
        <IDEContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
});
