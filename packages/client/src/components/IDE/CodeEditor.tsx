import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
// §6 — 저장 키를 여기서 정하지 않는다(사용자가 바꾸면 그대로 따라간다).
import { useCommand } from '../../hooks/useCommand.js';
import {
  IME_ENTER_OWNER,
  isComposingKeyEvent,
  isComposingNow,
  isImeConsumedKey,
  isInputComposing,
} from '../../utils/inputComposition.js';
import { decideEnterKey } from '../../utils/inputEnterKey.js';
import { boundedTextSelection } from '../../utils/textInputSelection.js';
import { highlightCode, type CodeLine } from './codeHighlight.js';
import { TOKEN_CLASS } from './codeLanguages.js';
import { CodeEditorFindWidget, CodeEditorGotoLine } from './CodeEditorFindWidget.js';
import { commentTokensFor } from './editorComments.js';
import { sameLineMarks, splitTokensByMarks, type LineMark } from './editorFind.js';
import { lineStartOffset } from './editorLineRange.js';
import { detectIndentUnit, diffEdit, lineNumberAt, newlineWithIndent, type CommentTokens } from './editorLineOps.js';
import { applyDedent, applyIndent, type EditResult } from './editorModel.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { useEditorFind, type EditorFindMemory } from './useEditorFind.js';
import { useEditorLineCommands } from './useEditorLineCommands.js';

/**
 * CodeEditor.tsx — §5.5 #17-27 v4.87 실제로 타이핑하는 편집 표면.
 *
 * 색이 입혀진 `<pre>` 위에 **투명한 `<textarea>`** 를 겹친다(§5.5 #17-27 ⑤) — 캐럿·선택·IME·
 * 되돌리기는 브라우저의 것을 그대로 쓰고, 우리는 그 아래에 같은 글자를 색만 다르게 한 벌 더 그린다.
 * 두 층은 **같은 글꼴·행간·패딩**을 써야 한 글자라도 어긋나지 않으므로, 그 값들은 아래 상수 한 곳에서
 * 나온다(양쪽에 따로 적으면 언젠가 반드시 어긋난다).
 *
 * §5.5 #17-27 ⑲ — 찾기·바꾸기·줄 번호로 가기·줄 편집 명령은 VS Code 와 같은 키로 산다(사용자 지시 —
 * "기존 편집 툴들처럼 … 단축키랑 동일하게"). 키는 단축키 표(`shared/keymap.ts` editor 묶음)가 정하고,
 * 상태는 `useEditorFind`·`useEditorLineCommands` 가, 계산은 순수 함수(`editorFind.ts`·`editorLineOps.ts`)가 쥔다.
 * 이 파일은 그 셋을 본문에 잇고, 찾은 자리를 `<pre>` 층에 칠한다.
 */

/**
 * 두 층이 공유하는 글자 배치 — 여기만 고치면 본문·줄번호가 함께 따라온다.
 * 탭 폭(`[tab-size:4]`)은 `EDITOR_TAB_SIZE` 와 같아야 한다(VS Code 기본값 — 브라우저 기본 8 은 탭으로
 * 들여쓴 언리얼 소스를 두 배로 벌려 그린다). 두 층이 같은 값을 쓰므로 캐럿은 어긋나지 않는다.
 */
const LAYER_TEXT = 'font-mono text-[13px] leading-[19px] [tab-size:4]';
const LAYER_PAD = 'px-3 py-2';
/**
 * §5.5 #17-27 ⑪ — 줄 번호로 스크롤 위치를 계산할 때 쓰는 치수. **위 두 상수와 같은 값**이어야 한다
 * (`leading-[19px]` / `py-2` = 8px). 어긋나면 스크롤이 매 줄 조금씩 밀린다.
 */
const LINE_HEIGHT_PX = 19;
const LAYER_PAD_TOP_PX = 8;
/** 줄 번호 칸 폭(자릿수와 무관하게 고정) — 스크롤 중 본문이 좌우로 흔들리지 않게. */
const GUTTER_CLASS = 'w-12 flex-shrink-0 select-none border-r border-gray-800/70 bg-gray-950 text-right';

/**
 * §5.5 #17-27 ⑲ — 찾은 자리 칠하기. **배경·외곽선만** 쓴다 — 여백·테두리는 글자를 밀어 두 층이 어긋난다.
 * 지금 결과는 진하게, 나머지는 옅게(VS Code 와 같은 두 단계).
 */
const FIND_MARK_CLASS = {
  match: 'rounded-[2px] bg-amber-300/25',
  current: 'rounded-[2px] bg-orange-400/55 outline outline-1 outline-orange-300/80',
} as const;
/** 길이 0 결과(정규식 `^`·`$`)는 글자가 없으니 세로 막대로 그린다 — 폭 0 의 자리에 떠 있게 한다. */
const FIND_CARET_CLASS = {
  match: 'bg-amber-300/70',
  current: 'bg-orange-300',
} as const;

export interface EditorViewState {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  top: number;
  left: number;
  followToken?: number;
}

interface CodeEditorProps {
  /** Owned by the open file tab, so switching to an image does not lose its working position. */
  viewStateRef?: { current: EditorViewState | null };
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
  /**
   * §5.5 #17-27 ⑬ (g) — 이번 이동이 **사용자가 누른 것**인가(본문 링크·오류 줄). 그러면 스크롤과 함께
   * 캐럿을 첫 줄 머리에 두고 편집창에 초점을 준다. 에이전트 추종(⑪)은 초점을 뺏지 않는다(기본 false) —
   * 사용자가 명령을 치는 중에 에이전트 편집이 글자를 편집창으로 끌어가면 안 된다.
   */
  followFocus?: boolean;
  /**
   * §5.5 #17-27 ⑬ (g) — **칠해 둔 범위**(누른 링크가 가리킨 줄들). 1.8초 강조가 끝난 뒤에도 남아 "여기가 그 자리"를
   * 계속 말한다. 번호 칸·본문의 sky 띠 — 추종 잔상(파랑)과 색을 달리하고, 디버거 정지 줄(호박색)이 이긴다.
   * 언제 걷을지는 부모가 정한다(본문이 바뀌면 걷힌다).
   */
  markRange?: FollowRange | null;
  /**
   * §5.5 #17-27 ⑲ — 줄·블록 주석 기호(`commentTokensFor` — 확장자까지 본 것). 없으면 언어 표의 기호를 쓴다.
   */
  comments?: CommentTokens;
  /**
   * §5.5 #17-27 ⑲ — 판이 쥐는 찾기 기억(찾을 말·바꿀 말·스위치). 파일 탭을 바꿔 편집창이 새로 서도
   * 같은 말로 이어 찾는다(VS Code 도 편집기끼리 찾을 말을 나눠 쓴다). 없으면 이 편집창 안에서만 기억한다.
   */
  findMemoryRef?: { current: EditorFindMemory | null };
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
  /** §5.5 #17-27 ⑲ — 이 파일 형식에 줄 주석(또는 줄마다 감쌀 블록 주석)이 있는가. */
  canLineComment: boolean;
  /** §5.5 #17-27 ⑲ — 블록 주석이 있는가. */
  canBlockComment: boolean;
  actions: {
    cut: () => void;
    copy: () => void;
    paste: () => void;
    selectAll: () => void;
    undo: () => void;
    redo: () => void;
    /** §5.5 #17-27 ⑲ — 찾기·바꾸기·줄 번호로 가기와 줄 편집(단축키와 같은 조작). */
    find: () => void;
    replace: () => void;
    goToLine: () => void;
    copyLineUp: () => void;
    copyLineDown: () => void;
    moveLineUp: () => void;
    moveLineDown: () => void;
    deleteLine: () => void;
    insertLineBelow: () => void;
    insertLineAbove: () => void;
    selectLine: () => void;
    indentLines: () => void;
    outdentLines: () => void;
    toggleLineComment: () => void;
    toggleBlockComment: () => void;
  };
}

interface CodeLineRowProps {
  line: CodeLine;
  stopped: boolean;
  flash: boolean;
  recent: boolean;
  mark: boolean;
  /** §5.5 #17-27 ⑲ — 이 줄에서 찾은 자리(막대가 닫혀 있으면 없다). */
  marks?: readonly LineMark[];
}

/** 한 줄 — 토큰이 그대로면 다시 그리지 않는다(긴 파일에서 타이핑 한 번에 전 줄이 다시 그려지는 것 방지). */
const CodeLineRow = memo(
  function CodeLineRow({ line, stopped, flash, recent, mark, marks }: CodeLineRowProps): React.JSX.Element {
    // 방금 고쳐진 줄(#17-27 ⑪)은 배경이 차올랐다 사라진다 — 디버거 정지 줄(호박색)과 색을 달리해 겹쳐도 구분된다.
    //   강조가 꺼진 뒤에는 아주 옅은 파란 배경(잔상)만 남아 "여기가 바뀐 자리" 를 계속 알려 준다.
    //   ⑬ (g) 누른 링크가 가리킨 줄은 sky 띠로 칠해 둔다(잔상보다 진하다 — 사용자가 찾아온 자리다).
    const cls = [
      stopped ? 'bg-amber-500/15' : mark ? 'bg-sky-400/[0.12]' : recent && !flash ? 'bg-blue-500/[0.07]' : '',
      flash ? 'animate-edit-follow-flash' : '',
    ].filter(Boolean).join(' ') || undefined;
    if (marks && marks.length > 0) {
      // ⑲ 찾은 자리는 색 토큰을 그 경계에서 다시 잘라 칠한다(글자는 하나도 더하거나 빼지 않는다).
      //   지금 결과의 첫 조각에만 표식을 단다 — 가로로 화면 밖이면 그 조각으로 데려온다(`useEditorFind`).
      const pieces = splitTokensByMarks(line, marks);
      let tagged = false;
      const hasText = pieces.some((p) => 'text' in p && p.text.length > 0);
      return (
        <div className={cls}>
          {pieces.map((p, i) => {
            if ('caret' in p) {
              const tag = p.caret === 'current' && !tagged;
              if (tag) tagged = true;
              return (
                <span key={i} className="relative" data-find-current={tag ? '' : undefined}>
                  <span className={`absolute inset-y-0 left-0 w-0.5 ${FIND_CARET_CLASS[p.caret]}`} aria-hidden />
                </span>
              );
            }
            const tag = p.mark === 'current' && !tagged;
            if (tag) tagged = true;
            return (
              <span
                key={i}
                data-find-current={tag ? '' : undefined}
                className={p.mark === 'none' ? TOKEN_CLASS[p.kind] : `${TOKEN_CLASS[p.kind]} ${FIND_MARK_CLASS[p.mark]}`}
              >
                {p.text}
              </span>
            );
          })}
          {/* 글자가 없는 줄(길이 0 결과만 있는 빈 줄)도 한 줄 높이를 지킨다 — 아래 줄들이 올라붙지 않게. */}
          {!hasText && ' '}
        </div>
      );
    }
    if (line.length === 0) return <div className={cls}>{' '}</div>;
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
    if (a.mark !== b.mark) return false;
    if (!sameLineMarks(a.marks, b.marks)) return false;
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
  followFocus = false,
  markRange = null,
  viewStateRef,
  comments: commentsProp,
  findMemoryRef,
}: CodeEditorProps): React.JSX.Element {
  /** 편집창 껍데기 — 단축키가 **이 편집창 안에서** 났는지 가른다(분할 편집기). */
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 프로그램이 바꾼 본문의 커서 위치 — 값이 반영된 **뒤에** 넣어야 커서가 끝으로 튀지 않는다. */
  const pendingSelection = useRef<{ start: number; end: number; value: string } | null>(null);
  const [caretLine, setCaretLine] = useState(1);
  const lastFollowToken = useRef(viewStateRef?.current?.followToken);

  useLayoutEffect(() => {
    const field = textareaRef.current;
    const scroll = scrollRef.current;
    const gutter = gutterRef.current;
    if (!viewStateRef || !field || !scroll) return;
    const saved = viewStateRef.current;
    if (saved) {
      const selection = boundedTextSelection(field.value, saved.start, saved.end);
      field.setSelectionRange(selection.start, selection.end, saved.direction);
      setCaretLine(field.value.slice(0, selection.start).split('\n').length);
      scroll.scrollTop = saved.top;
      scroll.scrollLeft = saved.left;
      if (gutter) gutter.scrollTop = scroll.scrollTop;
    }
    // Capture the actual nodes before React clears refs during unmount.
    return () => {
      viewStateRef.current = {
        start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection,
        top: scroll.scrollTop, left: scroll.scrollLeft, followToken: lastFollowToken.current,
      };
    };
  }, [viewStateRef]);

  const lines = useMemo(() => highlightCode(text, language), [text, language]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    const sel = pendingSelection.current;
    if (!el || !sel) return;
    pendingSelection.current = null;
    if (el.value !== sel.value || isInputComposing(el)) return;
    const range = boundedTextSelection(el.value, sel.start, sel.end);
    el.setSelectionRange(range.start, range.end);
  }, [text]);

  /** 줄 번호는 본문과 같은 스크롤을 따라야 한다 — 세로만 옮긴다(가로는 본문만 움직인다). */
  const handleScroll = useCallback((): void => {
    const gutter = gutterRef.current;
    const scroller = scrollRef.current;
    if (!gutter || !scroller) return;
    gutter.scrollTop = scroller.scrollTop;
  }, []);

  /**
   * §5.5 #17-27 ⑬ (g) — 사용자가 눌러 온 줄의 머리에 캐럿을 둔다.
   *
   * 초점은 스크롤을 일으키지 않게 준다(`preventScroll` — 자리는 아래 스크롤이 정한다). 터치 화면에서는
   * 초점을 주지 않는다 — 화면 자판이 솟아 방금 데려온 그 줄을 가린다. 캐럿 자리만 옮겨 두면 손가락으로
   * 누르는 순간 거기서 시작한다.
   */
  const placeCaretAtLine = useCallback((line: number): void => {
    const el = textareaRef.current;
    if (!el || isInputComposing(el)) return;
    const offset = lineStartOffset(el.value, line);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (!coarse) el.focus({ preventScroll: true });
    el.setSelectionRange(offset, offset);
    setCaretLine(line);
  }, []);

  /**
   * §5.5 #17-27 ⑪ — 방금 고쳐진 줄로 부드럽게 스크롤한다.
   *
   * 모든 줄을 그대로 그리는 편집창이라(가상 리스트 ❌) 위치는 **줄 번호 × 행간**으로 바로 나온다.
   * 목적지를 화면 위쪽 1/3 에 두는 이유는, 고쳐진 줄 **아래로 이어지는 코드**가 함께 보여야
   * 무엇이 바뀐 것인지 읽히기 때문이다. `prefers-reduced-motion` 이면 미끄러지지 않고 즉시 옮긴다.
   * ⑬ (g) 본문 링크·오류 줄도 같은 길로 온다 — 그때는(`followFocus`) 캐럿까지 그 줄에 둔다.
   */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !followRange || followRange.start < 1) return;
    if (lastFollowToken.current === followToken) return;
    lastFollowToken.current = followToken;
    // 캐럿이 먼저다 — 혹시 선택을 옮기며 브라우저가 스크롤을 건드려도 바로 아래 스크롤이 자리를 정한다.
    if (followFocus) placeCaretAtLine(followRange.start);
    const top = LAYER_PAD_TOP_PX + (followRange.start - 1) * LINE_HEIGHT_PX;
    const target = Math.max(0, top - Math.max(48, Math.round(scroller.clientHeight / 3)));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scroller.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    // 줄 번호 칸은 부드러운 스크롤이 만드는 scroll 이벤트를 타고 따라온다(handleScroll).
  }, [followToken, followRange, followFocus, placeCaretAtLine]);

  const updateCaretLine = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    setCaretLine(el.value.slice(0, el.selectionStart).split('\n').length);
  }, []);

  /**
   * §5.5 #17-27 ⑲ — 그 줄(1-based)이 보이게 세로로 스크롤한다. 이미 보이면 그대로 둔다.
   * `center` 는 찾기·줄 번호 이동(⑪ 추종과 같은 위쪽 1/3 자리), `nearest` 는 편집 명령(화면을 덜 흔든다).
   */
  const revealLine = useCallback((line: number, mode: 'center' | 'nearest'): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = LAYER_PAD_TOP_PX + (line - 1) * LINE_HEIGHT_PX;
    const bottom = top + LINE_HEIGHT_PX;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    if (mode === 'nearest') {
      scroller.scrollTop = top < viewTop
        ? Math.max(0, top - LAYER_PAD_TOP_PX)
        : bottom - scroller.clientHeight + LAYER_PAD_TOP_PX;
      return;
    }
    scroller.scrollTop = Math.max(0, top - Math.max(48, Math.round(scroller.clientHeight / 3)));
  }, []);

  /**
   * §5.5 #17-27 ⑲ — 계산한 편집을 **되돌리기가 이어지게** 넣는다. 바뀐 한 군데만 골라 `insertText` 한 번으로
   * 넣어야 `Ctrl+Z` 가 명령 한 번(줄 옮기기·모두 바꾸기)을 한 걸음으로 되돌린다 — 값을 통째로 갈아 끼우면
   * 그 걸음을 잃는다(⑨ (d) 와 같은 이유). 그 길이 막힌 환경에서만 값을 직접 넘긴다.
   */
  const commitEdit = useCallback((el: HTMLTextAreaElement, next: EditResult): void => {
    if (next.text !== el.value) {
      const { from, to, insert } = diffEdit(el.value, next.text);
      el.setSelectionRange(from, to);
      const doc = el.ownerDocument;
      const applied = insert ? doc.execCommand('insertText', false, insert) : doc.execCommand('delete');
      if (!applied || el.value !== next.text) {
        pendingSelection.current = { start: next.selectionStart, end: next.selectionEnd, value: next.text };
        onChange(next.text);
        return;
      }
    }
    el.setSelectionRange(next.selectionStart, next.selectionEnd);
    const line = lineNumberAt(next.text, next.selectionStart);
    setCaretLine(line);
    revealLine(line, 'nearest');
  }, [onChange, revealLine]);

  // ─── §5.5 #17-27 ⑲ 찾기·바꾸기·줄 번호로 가기·줄 편집 ─────────────────────
  // ⚠ 위 `pendingSelection` 효과보다 **뒤에** 부른다 — 바꾸기 뒤 "다음 결과 고르기"가 그 효과의 커서 복원에
  //   덮이지 않게(효과는 선언 순서대로 돈다).
  const comments = useMemo(() => commentsProp ?? commentTokensFor(null, language), [commentsProp, language]);
  const lineOps = useEditorLineCommands({ textareaRef, readOnly, comments, commit: commitEdit });
  const find = useEditorFind({
    textareaRef,
    rootRef,
    scrollRef,
    text,
    readOnly,
    memoryRef: findMemoryRef,
    commit: commitEdit,
    revealLine: (line) => revealLine(line, 'center'),
    setCaretLine,
  });
  /** 우클릭 메뉴는 누른 뒤에 실행되므로 그때의 찾기 상태를 읽는다(메뉴를 연 순간의 것이 아니라). */
  const findRef = useRef(find);
  findRef.current = find;

  // ─── §5.5 #17-27 ⑨ v4.97 우클릭 ────────────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /** 우클릭한 순간의 선택 범위 — 메뉴 버튼을 누르면 초점이 옮겨가므로 되돌려 놓고 조작한다. */
  const menuSelection = useRef<{ start: number; end: number; value: string; field: HTMLTextAreaElement | null }>({ start: 0, end: 0, value: '', field: null });

  const focusWithSelection = useCallback((): HTMLTextAreaElement | null => {
    const el = textareaRef.current;
    const sel = menuSelection.current;
    if (!el || !el.isConnected || sel.field !== el || el.value !== sel.value || isInputComposing(el)) return null;
    el.focus();
    if (!el.isConnected || textareaRef.current !== el || el.value !== sel.value || isInputComposing(el)) return null;
    const range = boundedTextSelection(el.value, sel.start, sel.end);
    el.setSelectionRange(range.start, range.end);
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
    const { start, end } = boundedTextSelection(el.value, menuSelection.current.start, menuSelection.current.end);
    const caret = start + insert.length;
    const value = `${el.value.slice(0, start)}${insert}${el.value.slice(end)}`;
    pendingSelection.current = { start: caret, end: caret, value };
    onChange(value);
  }, [focusWithSelection, onChange, readOnly]);

  const menuActions = useMemo(() => {
    /** 우클릭한 순간의 선택을 되돌려 놓은 뒤에 한다(메뉴를 누르는 사이 선택이 바뀌었으면 하지 않는다). */
    const atMenuSelection = (run: () => unknown) => (): void => {
      if (focusWithSelection()) run();
    };
    return {
      copy: (): void => {
        const el = textareaRef.current;
        if (!el) return;
        const sel = el.value.slice(menuSelection.current.start, menuSelection.current.end);
        if (sel) void navigator.clipboard?.writeText(sel).catch(() => { /* 클립보드 거부는 조용히 */ });
      },
      cut: (): void => {
        const el = focusWithSelection();
        if (!el || readOnly) return;
        const sel = el.value.slice(menuSelection.current.start, menuSelection.current.end);
        if (!sel) return;
        void navigator.clipboard?.writeText(sel).catch(() => { /* 클립보드 거부는 조용히 */ });
        replaceSelection('');
      },
      paste: (): void => {
        if (!navigator.clipboard?.readText) return;
        const el = focusWithSelection();
        if (!el || readOnly) return;
        const sel = menuSelection.current;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        void navigator.clipboard.readText()
          .then((clip) => {
            if (!clip || textareaRef.current !== el || !el.isConnected || menuSelection.current !== sel
              || el.value !== sel.value || el.ownerDocument.activeElement !== el || isInputComposing(el)
              || el.selectionStart !== start || el.selectionEnd !== end) return;
            replaceSelection(clip);
          })
          .catch(() => { /* 클립보드 거부는 조용히 */ });
      },
      selectAll: (): void => {
        const el = focusWithSelection();
        if (!el) return;
        el.select();
      },
      undo: (): void => { if (!readOnly && focusWithSelection()) document.execCommand('undo'); },
      redo: (): void => { if (!readOnly && focusWithSelection()) document.execCommand('redo'); },
      find: atMenuSelection(() => findRef.current.openFind(false)),
      replace: atMenuSelection(() => findRef.current.openFind(true)),
      goToLine: atMenuSelection(() => findRef.current.openGoto()),
      copyLineUp: atMenuSelection(lineOps.copyLineUp),
      copyLineDown: atMenuSelection(lineOps.copyLineDown),
      moveLineUp: atMenuSelection(lineOps.moveLineUp),
      moveLineDown: atMenuSelection(lineOps.moveLineDown),
      deleteLine: atMenuSelection(lineOps.deleteLine),
      insertLineBelow: atMenuSelection(lineOps.insertLineBelow),
      insertLineAbove: atMenuSelection(lineOps.insertLineAbove),
      selectLine: atMenuSelection(lineOps.selectLine),
      indentLines: atMenuSelection(lineOps.indentLines),
      outdentLines: atMenuSelection(lineOps.outdentLines),
      toggleLineComment: atMenuSelection(lineOps.toggleLineComment),
      toggleBlockComment: atMenuSelection(lineOps.toggleBlockComment),
    };
  }, [focusWithSelection, replaceSelection, readOnly, lineOps]);

  const handleBodyContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>): void => {
    if (!buildBodyMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    menuSelection.current = { start: el.selectionStart, end: el.selectionEnd, value: el.value, field: el };
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
        canLineComment: !!(comments.line || comments.block),
        canBlockComment: !!comments.block,
        actions: menuActions,
      }),
    });
  }, [buildBodyMenu, menuActions, readOnly, comments]);

  const handleGutterContextMenu = useCallback((e: React.MouseEvent, lineNo: number): void => {
    if (!buildGutterMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const lineText = textareaRef.current?.value.split('\n')[lineNo - 1] ?? '';
    setMenu({ x: e.clientX, y: e.clientY, items: buildGutterMenu(lineNo, lineText) });
  }, [buildGutterMenu]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    const native = e.nativeEvent;

    // §5.5 #17-27 ⑲ Enter — 줄바꿈과 함께 지금 줄의 들여쓰기를 잇는다(여는 괄호 뒤면 한 단계 더).
    //   판정은 보내는 칸들과 한 벌이다(`decideEnterKey`). 한글 조합을 끝낸 직후의 진짜 Enter 는 여기까지 온다
    //   (`IME_ENTER_OWNER`) — 그래야 한글 주석 뒤 첫 Enter 도 들여쓰기를 잇는다. 다만 이 칸에서는 줄바꿈이
    //   **바라는 결과**라, 입력기가 먹은 키(`imeCommit` — 일본어·중국어 변환 확정)는 보내는 칸처럼 막지 않고
    //   입력기·브라우저에게 그대로 둔다(종전 textarea 와 같다). Shift+Enter(`newline`)도 같은 줄바꿈이다.
    if (e.key === 'Enter') {
      const outcome = decideEnterKey({
        key: e.key, shiftKey: e.shiftKey, chordKey: false, imeConsumed: isImeConsumedKey(native), slashMatchCount: 0,
      });
      if (outcome.kind === 'imeCommit' || readOnly || isComposingNow(el)) return;
      e.preventDefault();
      commitEdit(el, newlineWithIndent(el.value, el.selectionStart, el.selectionEnd, detectIndentUnit(el.value)));
      return;
    }

    if (isComposingKeyEvent(native)) return;

    // ⑲ 찾기 막대가 열려 있으면 Esc 는 막대만 닫는다 — 막대는 방금 연 일회성 막대라 IDE 창의 Esc(창 닫기)까지
    //   가지 않게 여기서 멈춘다(붙이기 메뉴와 같은 갈래). 막대가 없으면 종전대로 창의 것이다.
    if (e.key === 'Escape' && find.findOpen) {
      e.preventDefault();
      e.stopPropagation();
      find.closeFind();
      return;
    }

    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      // ⑲ 들여쓰기 한 단계는 그 파일이 쓰는 단위다(탭·스페이스 넷 …) — 탭 파일에 스페이스를 섞지 않는다.
      const unit = detectIndentUnit(el.value);
      commitEdit(el, e.shiftKey
        ? applyDedent(el.value, el.selectionStart, el.selectionEnd, unit)
        : applyIndent(el.value, el.selectionStart, el.selectionEnd, unit));
    }
  };

  /**
   * 저장 — 키는 §6 레지스트리가 정한다(`editor.save`).
   *
   * **내 textarea 안에서 난 키만** 받는다. 분할 편집기처럼 편집창이 둘 이상 떠 있을 때
   * 등록만 해 두면 나중에 마운트된 쪽이 가져가 **엉뚱한 파일이 저장된다**.
   */
  useCommand('editor.save', (e) => {
    if (e.target !== textareaRef.current) return false;
    onSave();
  });

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
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
            const isMarked = !!markRange && lineNo >= markRange.start && lineNo <= markRange.end;
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
                  // ⑬ (g) — 칠한 줄은 번호 칸도 같은 sky 로 물들어 본문과 한 줄 띠로 이어진다(정지 줄이 이긴다).
                  isStopped
                    ? 'bg-amber-500/20 text-amber-200'
                    : isMarked
                      ? 'bg-sky-400/15 text-sky-200'
                      : lineNo === caretLine ? 'text-gray-300' : 'text-gray-600',
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
              const isMarked = !!markRange && lineNo >= markRange.start && lineNo <= markRange.end;
              return (
                <CodeLineRow
                  key={isFollowed ? `${i}:${followToken}` : i}
                  line={line}
                  stopped={stoppedLine === lineNo}
                  flash={isFollowed}
                  recent={isRecent}
                  mark={isMarked}
                  marks={find.marks?.get(i)}
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
            // 전역 입력칸 메뉴(`GlobalTextFieldContextMenu`)에게 "여긴 내가 맡는다"고 알린다 —
            // 전역이 가로채면 이 메뉴의 되돌리기·저장·다시 읽기가 통째로 죽는다.
            data-text-menu="own"
            // ⑲ Enter 는 이 칸이 맡는다(들여쓰기 잇기) — 한글 조합을 끝낸 첫 Enter 가 전역 조합 가드에 막히지 않게.
            {...IME_ENTER_OWNER}
            className={`${LAYER_TEXT} ${LAYER_PAD} absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre border-0 bg-transparent text-transparent caret-gray-100 outline-none selection:bg-blue-500/30`}
          />
        </div>
      </div>

      {/* §5.5 #17-27 ⑲ — 찾기 막대(오른쪽 위)·줄 번호 상자(가운데 위). 본문을 밀지 않고 그 위에 뜬다. */}
      {find.widget && <CodeEditorFindWidget model={find.widget} />}
      {find.goto && <CodeEditorGotoLine model={find.goto} />}

      {menu && (
        <IDEContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
});
