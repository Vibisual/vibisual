import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCommand } from '../../hooks/useCommand.js';
import { countTextLines } from './editorLineRange.js';
import type { EditResult } from './editorModel.js';
import {
  currentMatchIndex,
  DEFAULT_FIND_OPTIONS,
  escapeRegExp,
  findMatches,
  indexOfExactMatch,
  lineStartOffsets,
  makeReplacer,
  marksByLine,
  matchIndexFrom,
  nextMatchIndex,
  prevMatchIndex,
  replaceAllMatches,
  seedFindQuery,
  type FindMatch,
  type FindOptions,
  type FindResult,
  type LineMark,
} from './editorFind.js';
import { lineNumberAt, offsetOfLineColumn, parseGotoLine } from './editorLineOps.js';

/**
 * §5.5 #17-27 ⑲ 편집창 찾기·바꾸기·줄 이동 — VS Code 찾기 위젯을 따른다(`F3` 은 막대가 닫혀도 움직인다 · 바꾸기는 고른 것이 결과일 때만 · `Esc` 는 막대만).
 * **막대에 초점을 둔 채 본문 선택을 옮긴다**(textarea `setSelectionRange`) — `window.getSelection` 으로 칠하면 입력칸 캐럿이 0 으로 무너져 칠하기는 `<pre>` 층이 한다.
 * 찾을 말·스위치는 판의 `memoryRef` 에 남아 탭을 바꿔도 이어진다(영속 ❌).
 */

/** 판이 기억해 두는 찾기 상태(파일을 바꿔도 이어진다). */
export interface EditorFindMemory {
  query: string;
  replacement: string;
  options: FindOptions;
  replaceOpen: boolean;
}

/** 찾기 막대가 그리는 데 필요한 것 전부(열려 있을 때만). */
export interface EditorFindWidgetModel {
  query: string;
  replacement: string;
  options: FindOptions;
  replaceOpen: boolean;
  readOnly: boolean;
  total: number;
  /** 지금 결과 번호(0-based). 결과가 없으면 -1. */
  current: number;
  capped: boolean;
  invalid: boolean;
  findInputRef: { current: HTMLInputElement | null };
  replaceInputRef: { current: HTMLInputElement | null };
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onToggleOption: (key: keyof FindOptions) => void;
  onToggleReplace: () => void;
  onNext: () => void;
  onPrev: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

/** 줄 번호로 가기 상자(열려 있을 때만). */
export interface EditorGotoModel {
  value: string;
  /** 열 때의 캐럿 줄·열(1-based) — 상자 아래 안내에 쓴다. */
  line: number;
  column: number;
  lineCount: number;
  inputRef: { current: HTMLInputElement | null };
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Esc — 열기 전 자리(스크롤·커서)로 되돌리고 닫는다. */
  onCancel: () => void;
  /** 다른 곳을 눌러 초점이 나갔다 — 그 누름이 정한 커서를 지우지 않게 되돌리지 않고 닫기만 한다. */
  onDismiss: () => void;
}

export interface EditorFindApi {
  findOpen: boolean;
  /** 열려 있으면 막대 모델, 아니면 `null`. */
  widget: EditorFindWidgetModel | null;
  goto: EditorGotoModel | null;
  /** 줄 번호(0-based) → 그 줄에서 칠할 자리. 막대가 닫혀 있거나 결과가 없으면 `null`. */
  marks: ReadonlyMap<number, readonly LineMark[]> | null;
  openFind: (replace: boolean) => void;
  openGoto: () => void;
  closeFind: () => void;
}

interface EditorFindDeps {
  textareaRef: { current: HTMLTextAreaElement | null };
  /** 편집창 껍데기 — 키가 이 안에서 났을 때만 이 편집창의 명령이다(분할 편집기). */
  rootRef: { current: HTMLElement | null };
  /** 본문을 스크롤하는 칸 — 지금 결과를 가로로 보이게 하고, 줄 이동 취소 때 자리를 되돌린다. */
  scrollRef: { current: HTMLElement | null };
  text: string;
  readOnly: boolean;
  memoryRef?: { current: EditorFindMemory | null };
  /** 결과를 되돌리기가 이어지게 넣는다(`CodeEditor` 의 commitEdit). */
  commit: (el: HTMLTextAreaElement, next: EditResult) => void;
  /** 그 줄(1-based)이 보이게 세로로 스크롤한다. */
  revealLine: (line: number) => void;
  /** 캐럿 줄 번호(번호 칸 밝기)를 맞춘다. */
  setCaretLine: (line: number) => void;
}

const NO_RESULT: FindResult = { matches: [], capped: false, invalid: false };

/** 지금 결과가 가로로 화면 밖이면 이만큼 안쪽에 들여 세운다(px). */
const REVEAL_MARGIN_PX = 24;

export function useEditorFind(deps: EditorFindDeps): EditorFindApi {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { text, readOnly } = deps;

  const memory = deps.memoryRef?.current ?? null;
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(memory?.replaceOpen ?? false);
  const [query, setQuery] = useState(memory?.query ?? '');
  const [replacement, setReplacement] = useState(memory?.replacement ?? '');
  const [options, setOptions] = useState<FindOptions>(memory?.options ?? DEFAULT_FIND_OPTIONS);
  const [current, setCurrent] = useState(-1);
  const [goto, setGoto] = useState<{ value: string; line: number; column: number; lineCount: number } | null>(null);
  // 초점 요청은 렌더 뒤에 처리한다(막대가 아직 안 그려졌으면 입력칸이 없다) — 같은 상태로 다시 요청해도
  //   다시 그려지게 숫자를 올린다.
  const [focusTick, setFocusTick] = useState(0);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const gotoInputRef = useRef<HTMLInputElement | null>(null);
  /** 찾을 말이 바뀌면 여기서부터 첫 결과로 간다(막대를 연 자리 · 마지막으로 간 결과). */
  const anchorRef = useRef(0);
  /** 바꾼 직후 — 본문이 다시 들어오면 이 자리부터 다음 결과로 간다. */
  const pendingFromRef = useRef<number | null>(null);
  /** 닫힌 막대에서 F3 — 막대가 서고 결과가 나오면 이 방향으로 한 칸. */
  const pendingStepRef = useRef<1 | -1 | null>(null);
  /** 지난번 결과를 낸 찾을 말 + 스위치(바뀌었는지 가른다). */
  const lastKeyRef = useRef('');
  const focusRequestRef = useRef<'find' | 'replace' | 'goto' | null>(null);
  /** 이 번호의 결과가 칠해지면 가로로도 보이게 한다. */
  const pendingHorizontalRef = useRef<number | null>(null);
  const gotoRestoreRef = useRef<{ top: number; left: number; start: number; end: number } | null>(null);

  // 판의 기억 — 파일 탭을 바꿔 편집창이 새로 서도 같은 찾을 말로 이어진다.
  useEffect(() => {
    const ref = depsRef.current.memoryRef;
    if (ref) ref.current = { query, replacement, options, replaceOpen };
  }, [query, replacement, options, replaceOpen]);

  const result = useMemo(
    () => (findOpen ? findMatches(text, query, options) : NO_RESULT),
    [findOpen, text, query, options],
  );
  const lineStarts = useMemo(() => (findOpen ? lineStartOffsets(text) : null), [findOpen, text]);
  const marks = useMemo(
    () => (findOpen && lineStarts && result.matches.length > 0
      ? marksByLine(lineStarts, text.length, result.matches, current)
      : null),
    [findOpen, lineStarts, text.length, result, current],
  );

  /** 결과 하나를 본문에서 고르고 그 줄을 보이게 한다. 가로는 칠한 조각이 그려진 뒤에 맞춘다. */
  const select = useCallback((m: FindMatch, index: number): void => {
    const { textareaRef, setCaretLine, revealLine } = depsRef.current;
    const el = textareaRef.current;
    if (!el) return;
    el.setSelectionRange(m.start, m.end);
    anchorRef.current = m.start;
    const line = lineNumberAt(el.value, m.start);
    setCaretLine(line);
    revealLine(line);
    pendingHorizontalRef.current = index;
  }, []);

  // 결과가 다시 나올 때마다(찾을 말·스위치·본문이 바뀜) 지금 결과를 정한다.
  useLayoutEffect(() => {
    if (!findOpen) return;
    const key = `${query}\u0000${options.matchCase ? 1 : 0}${options.wholeWord ? 1 : 0}${options.regex ? 1 : 0}`;
    const queryChanged = key !== lastKeyRef.current;
    lastKeyRef.current = key;
    const from = pendingFromRef.current;
    pendingFromRef.current = null;
    const step = pendingStepRef.current;
    pendingStepRef.current = null;
    const list = result.matches;
    if (list.length === 0) {
      setCurrent(-1);
      return;
    }
    const el = depsRef.current.textareaRef.current;
    const selStart = el ? el.selectionStart : anchorRef.current;
    const selEnd = el ? el.selectionEnd : anchorRef.current;
    let index: number;
    if (step !== null) index = step > 0 ? nextMatchIndex(list, selStart, selEnd) : prevMatchIndex(list, selStart, selEnd);
    else if (from !== null) index = matchIndexFrom(list, from);
    else if (queryChanged) index = matchIndexFrom(list, anchorRef.current);
    else {
      // 본문만 바뀌었다(사용자가 편집창에서 고쳤다) — 커서를 옮기지 않고 지금 결과만 다시 맞춘다.
      setCurrent(currentMatchIndex(list, selStart, selEnd));
      return;
    }
    setCurrent(index);
    select(list[index]!, index);
  }, [findOpen, result, query, options, select]);

  // 지금 결과가 그 번호로 칠해진 뒤 — 줄이 길어 화면 밖이면 가로로 데려온다.
  useLayoutEffect(() => {
    const want = pendingHorizontalRef.current;
    if (want === null || want !== current) return;
    pendingHorizontalRef.current = null;
    const scroller = depsRef.current.scrollRef.current;
    const mark = scroller?.querySelector<HTMLElement>('[data-find-current]');
    if (!scroller || !mark) return;
    const left = mark.offsetLeft;
    const right = left + mark.offsetWidth;
    if (left < scroller.scrollLeft + REVEAL_MARGIN_PX || right > scroller.scrollLeft + scroller.clientWidth - REVEAL_MARGIN_PX) {
      scroller.scrollLeft = Math.max(0, left - Math.round(scroller.clientWidth / 3));
    }
  });

  // 초점 요청 — 입력칸이 그려진 뒤에 준다.
  useLayoutEffect(() => {
    const want = focusRequestRef.current;
    if (!want) return;
    const input = want === 'find' ? findInputRef.current : want === 'replace' ? replaceInputRef.current : gotoInputRef.current;
    if (!input) return;
    focusRequestRef.current = null;
    input.focus({ preventScroll: true });
    input.select();
  }, [focusTick, findOpen, replaceOpen, goto]);

  const requestFocus = useCallback((target: 'find' | 'replace' | 'goto'): void => {
    focusRequestRef.current = target;
    setFocusTick((n) => n + 1);
  }, []);

  /** 막대를 연다(이미 열려 있으면 찾을 말을 다시 채우고 입력칸으로 간다). */
  const openFind = (wantReplace: boolean): void => {
    const el = depsRef.current.textareaRef.current;
    const inputFocused = findOpen && !!el && el.ownerDocument.activeElement === findInputRef.current;
    let seeded = false;
    if (el && !inputFocused) {
      const seed = seedFindQuery(el.value, el.selectionStart, el.selectionEnd);
      if (seed !== null) {
        setQuery(options.regex ? escapeRegExp(seed) : seed);
        seeded = true;
      }
      anchorRef.current = el.selectionStart;
    }
    const withReplace = wantReplace && !readOnly;
    if (withReplace) setReplaceOpen(true);
    setFindOpen(true);
    // VS Code 와 같다 — 바꾸기로 열 때, 찾을 말이 이미 서 있으면 바꿀 말 칸으로 간다.
    requestFocus(withReplace && (inputFocused || seeded || query.length > 0) ? 'replace' : 'find');
  };

  const closeFind = (): void => {
    setFindOpen(false);
    pendingHorizontalRef.current = null;
    depsRef.current.textareaRef.current?.focus({ preventScroll: true });
  };

  const step = (dir: 1 | -1): void => {
    const el = depsRef.current.textareaRef.current;
    if (!el) return;
    if (!findOpen) {
      // 닫혀 있으면 초점은 본문에 둔 채 막대를 다시 세우고 한 칸 간다(VS Code 와 같다).
      if (!query) {
        const seed = seedFindQuery(el.value, el.selectionStart, el.selectionEnd);
        if (seed === null) {
          openFind(false);
          return;
        }
        setQuery(options.regex ? escapeRegExp(seed) : seed);
      }
      pendingStepRef.current = dir;
      setFindOpen(true);
      return;
    }
    const list = result.matches;
    if (list.length === 0) return;
    const index = dir > 0
      ? nextMatchIndex(list, el.selectionStart, el.selectionEnd)
      : prevMatchIndex(list, el.selectionStart, el.selectionEnd);
    setCurrent(index);
    select(list[index]!, index);
  };

  const toggleOption = (key: keyof FindOptions): void => {
    setOptions((o) => ({ ...o, [key]: !o[key] }));
  };

  /**
   * 바꾸기는 본문에 넣어야 하므로 잠깐 본문에 초점을 주고(insertText 는 초점 있는 칸에만 들어간다),
   * 끝나면 막대 입력칸으로 돌려준다 — 바꿀 말을 고치며 연달아 누를 수 있게.
   */
  const commitKeepingFocus = (el: HTMLTextAreaElement, next: EditResult): void => {
    const back = el.ownerDocument.activeElement as HTMLElement | null;
    el.focus({ preventScroll: true });
    depsRef.current.commit(el, next);
    if (back && back !== el && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  };

  const replaceOne = (): void => {
    const el = depsRef.current.textareaRef.current;
    if (!el || readOnly || !query) return;
    const list = result.matches;
    if (list.length === 0) return;
    const exact = indexOfExactMatch(list, el.selectionStart, el.selectionEnd);
    // 고른 것이 결과가 아니면 바꾸지 않고 다음 결과로만 간다 — 사용자가 보지 않은 자리를 바꾸지 않는다.
    if (exact < 0) {
      step(1);
      return;
    }
    const m = list[exact]!;
    const rep = makeReplacer(el.value, query, replacement, options)(m);
    if (rep === null) {
      step(1);
      return;
    }
    const caret = m.start + rep.length;
    pendingFromRef.current = caret;
    commitKeepingFocus(el, { text: el.value.slice(0, m.start) + rep + el.value.slice(m.end), selectionStart: caret, selectionEnd: caret });
  };

  const replaceAll = (): void => {
    const el = depsRef.current.textareaRef.current;
    if (!el || readOnly || !query) return;
    // 칠하기 상한과 무관하게 **전부** 다시 센다 — 보이는 것만 바꾸면 "모두"가 아니다.
    const all = findMatches(el.value, query, options, Number.POSITIVE_INFINITY);
    if (all.invalid || all.matches.length === 0) return;
    const out = replaceAllMatches(el.value, all.matches, makeReplacer(el.value, query, replacement, options), el.selectionStart);
    if (out.count === 0) return;
    commitKeepingFocus(el, { text: out.text, selectionStart: out.keep, selectionEnd: out.keep });
  };

  // ─── 줄 번호로 가기 ──────────────────────────────────────────────────────────
  const openGoto = (): void => {
    const el = depsRef.current.textareaRef.current;
    if (!el) return;
    const scroller = depsRef.current.scrollRef.current;
    gotoRestoreRef.current = {
      top: scroller?.scrollTop ?? 0,
      left: scroller?.scrollLeft ?? 0,
      start: el.selectionStart,
      end: el.selectionEnd,
    };
    const line = lineNumberAt(el.value, el.selectionStart);
    const column = el.selectionStart - (el.value.lastIndexOf('\n', el.selectionStart - 1) + 1) + 1;
    setGoto({ value: '', line, column, lineCount: countTextLines(el.value) });
    requestFocus('goto');
  };

  const changeGoto = (value: string): void => {
    setGoto((g) => (g ? { ...g, value } : g));
    const el = depsRef.current.textareaRef.current;
    if (!el) return;
    // 치는 동안 그 줄을 미리 보여 준다 — 커서는 Enter 에서 옮긴다(VS Code 와 같다).
    const target = parseGotoLine(value, countTextLines(el.value));
    if (target) depsRef.current.revealLine(target.line);
  };

  const submitGoto = (): void => {
    const el = depsRef.current.textareaRef.current;
    const value = goto?.value ?? '';
    setGoto(null);
    gotoRestoreRef.current = null;
    if (!el) return;
    el.focus({ preventScroll: true });
    const target = parseGotoLine(value, countTextLines(el.value));
    if (!target) return;
    const offset = offsetOfLineColumn(el.value, target.line, target.column);
    el.setSelectionRange(offset, offset);
    depsRef.current.setCaretLine(target.line);
    depsRef.current.revealLine(target.line);
  };

  const cancelGoto = (): void => {
    const el = depsRef.current.textareaRef.current;
    const scroller = depsRef.current.scrollRef.current;
    const restore = gotoRestoreRef.current;
    setGoto(null);
    gotoRestoreRef.current = null;
    if (scroller && restore) {
      scroller.scrollTop = restore.top;
      scroller.scrollLeft = restore.left;
    }
    if (!el) return;
    el.focus({ preventScroll: true });
    if (restore) el.setSelectionRange(restore.start, restore.end);
  };

  // ─── 단축키 — 키는 표(`shared/keymap.ts`)와 사용자 키맵이 정한다 ────────────
  /** 이 편집창(본문·막대·상자) 안에서 난 키인가 — 분할 편집기에서 옆 편집창의 막대가 열리면 안 된다. */
  const isMine = (e: KeyboardEvent): boolean => {
    const root = depsRef.current.rootRef.current;
    const target = e.target;
    return !!root && typeof Node !== 'undefined' && target instanceof Node && root.contains(target);
  };

  useCommand('editor.find', (e) => {
    if (!isMine(e)) return false;
    openFind(false);
  });
  useCommand('editor.replace', (e) => {
    if (!isMine(e)) return false;
    openFind(true);
  });
  useCommand('editor.findNext', (e) => {
    if (!isMine(e)) return false;
    step(1);
  });
  useCommand('editor.findPrev', (e) => {
    if (!isMine(e)) return false;
    step(-1);
  });
  useCommand('editor.goToLine', (e) => {
    if (!isMine(e)) return false;
    openGoto();
  });
  // 막대 안의 키는 막대가 열린 동안만 산다 — 닫혀 있으면 Alt+C 같은 키를 가로채지 않는다.
  useCommand('editor.toggleMatchCase', (e) => {
    if (!isMine(e)) return false;
    toggleOption('matchCase');
  }, { enabled: findOpen });
  useCommand('editor.toggleWholeWord', (e) => {
    if (!isMine(e)) return false;
    toggleOption('wholeWord');
  }, { enabled: findOpen });
  useCommand('editor.toggleRegex', (e) => {
    if (!isMine(e)) return false;
    toggleOption('regex');
  }, { enabled: findOpen });
  useCommand('editor.replaceOne', (e) => {
    if (!isMine(e) || readOnly) return false;
    replaceOne();
  }, { enabled: findOpen && replaceOpen });
  useCommand('editor.replaceAll', (e) => {
    if (!isMine(e) || readOnly) return false;
    replaceAll();
  }, { enabled: findOpen && replaceOpen });

  const widget: EditorFindWidgetModel | null = findOpen
    ? {
      query,
      replacement,
      options,
      replaceOpen: replaceOpen && !readOnly,
      readOnly,
      total: result.matches.length,
      current: result.matches.length > 0 ? current : -1,
      capped: result.capped,
      invalid: result.invalid,
      findInputRef,
      replaceInputRef,
      // 치는 동안은 막대를 연 자리(또는 마지막으로 간 결과)에서부터 다시 찾는다(`anchorRef`).
      onQuery: setQuery,
      onReplacement: setReplacement,
      onToggleOption: toggleOption,
      onToggleReplace: () => {
        if (readOnly) return;
        const next = !replaceOpen;
        setReplaceOpen(next);
        if (next) requestFocus('replace');
      },
      onNext: () => step(1),
      onPrev: () => step(-1),
      onReplaceOne: replaceOne,
      onReplaceAll: replaceAll,
      onClose: closeFind,
    }
    : null;

  const gotoModel: EditorGotoModel | null = goto
    ? {
      value: goto.value,
      line: goto.line,
      column: goto.column,
      lineCount: goto.lineCount,
      inputRef: gotoInputRef,
      onChange: changeGoto,
      onSubmit: submitGoto,
      onCancel: cancelGoto,
      onDismiss: () => {
        gotoRestoreRef.current = null;
        setGoto(null);
      },
    }
    : null;

  return { findOpen, widget, goto: gotoModel, marks, openFind, openGoto, closeFind };
}
