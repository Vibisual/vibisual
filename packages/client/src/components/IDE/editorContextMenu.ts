import type { ContextMenuItem } from './IDEContextMenu.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';

/** §5.5 #17-27 ⑨ 편집창 우클릭 메뉴 목록(순수 — 무엇이 흐려지는지를 시험으로 고정). 글자는 호출부가 넘긴 `t` 로만(모듈 문자열이면 언어 전환이 안 따라온다). */

/** `useTranslation()` 의 `t` 중 우리가 쓰는 모양만. */
export type MenuText = (key: string, opts?: Record<string, unknown>) => string;

/** 본문(코드) 우클릭이 아는 상태. */
export interface BodyMenuState {
  hasSelection: boolean;
  /** 이진·상한 초과 파일 = 고칠 수 없다 */
  readOnly: boolean;
  /** 저장할 것이 남아 있는가 */
  dirty: boolean;
  /** §5.5 #17-27 ⑲ — 이 파일 형식에 줄 주석(또는 줄마다 감쌀 블록 주석)이 있는가(안 주면 있다고 본다). */
  canLineComment?: boolean;
  /** §5.5 #17-27 ⑲ — 블록 주석이 있는가(안 주면 있다고 본다). */
  canBlockComment?: boolean;
}

/** 본문 우클릭이 할 수 있는 일. */
export interface BodyMenuHandlers {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  reload: () => void;
  copyPath: () => void;
  copyLineRef: () => void;
  openExternal: () => void;
  /** §5.5 #17-3 (판올림 번호 발급 대기) — 고른 글자를 기본 브라우저에서 검색. */
  searchWeb: () => void;
  /** §5.5 #17-27 ⑲ — 단축키와 같은 조작(찾기 막대·줄 번호 상자·줄 편집). */
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
}

/** 줄 번호 칸 우클릭이 아는 상태. */
export interface GutterMenuState {
  line: number;
  hasBreakpoint: boolean;
  /** 이 파일에 찍힌 중단점이 하나라도 있는가(모두 제거 활성 조건) */
  hasAnyBreakpoint: boolean;
  /** 중단점을 다룰 수 있는 자리인가(프로젝트를 못 찾으면 false) */
  canBreakpoint: boolean;
}

export interface GutterMenuHandlers {
  toggleBreakpoint: () => void;
  clearFileBreakpoints: () => void;
  copyLine: () => void;
  copyLineRef: () => void;
}

/** 탭 우클릭이 아는 상태. */
export interface TabMenuState {
  /** 닫을 다른 탭이 있는가 */
  hasOthers: boolean;
  /** §5.5 #17-27 ⑱ — 탭이 파일인가(기본 참). 빈 탭엔 경로 복사·밖에서 열기를 세우지 않는다 — 헛도는 손잡이는 없는 것보다 나쁘다. */
  isFile?: boolean;
}

export interface TabMenuHandlers {
  close: () => void;
  closeOthers: () => void;
  closeAll: () => void;
  copyPath: () => void;
  openExternal: () => void;
}

/** (a) 본문 — 편집기의 기본 조작 + 이 편집창의 것. */
export function buildBodyMenuItems(
  state: BodyMenuState,
  h: BodyMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const needSelection = t('ide.editor.ctx.needSelection');
  const readOnlyWhy = t('ide.editor.ctx.readOnlyFile');

  return [
    {
      id: 'cut',
      label: t('ide.editor.ctx.cut'),
      hint: shortcutLabel('Ctrl+X'),
      disabled: !state.hasSelection || state.readOnly,
      disabledTitle: state.readOnly ? readOnlyWhy : needSelection,
      onClick: h.cut,
    },
    {
      id: 'copy',
      label: t('ide.editor.ctx.copy'),
      hint: shortcutLabel('Ctrl+C'),
      disabled: !state.hasSelection,
      disabledTitle: needSelection,
      onClick: h.copy,
    },
    {
      // §5.5 #17-3 (판올림 번호 발급 대기) — 스트림·입력창·터미널과 **같은 원문**이라 키도 하나다.
      id: 'searchWeb',
      label: t('ide.mainArea.ctxSearchWeb'),
      disabled: !state.hasSelection,
      disabledTitle: needSelection,
      onClick: h.searchWeb,
    },
    {
      id: 'paste',
      label: t('ide.editor.ctx.paste'),
      hint: shortcutLabel('Ctrl+V'),
      disabled: state.readOnly,
      disabledTitle: readOnlyWhy,
      onClick: h.paste,
    },
    { id: 'selectAll', label: t('ide.editor.ctx.selectAll'), hint: shortcutLabel('Ctrl+A'), onClick: h.selectAll },
    {
      id: 'undo',
      label: t('ide.editor.ctx.undo'),
      hint: shortcutLabel('Ctrl+Z'),
      separatorBefore: true,
      disabled: state.readOnly,
      disabledTitle: readOnlyWhy,
      onClick: h.undo,
    },
    {
      id: 'redo',
      label: t('ide.editor.ctx.redo'),
      hint: shortcutLabel('Ctrl+Y'),
      disabled: state.readOnly,
      disabledTitle: readOnlyWhy,
      onClick: h.redo,
    },
    // §5.5 #17-27 ⑲ — 찾기·바꾸기·줄 번호로 가기·줄 편집. 전부 우리 명령이라 키는 레지스트리에서 읽는다(`cmd`).
    { id: 'find', label: t('ide.terminal.find'), cmd: 'editor.find', separatorBefore: true, onClick: h.find },
    {
      id: 'replace',
      label: t('ide.editor.find.replace'),
      cmd: 'editor.replace',
      disabled: state.readOnly,
      disabledTitle: readOnlyWhy,
      onClick: h.replace,
    },
    { id: 'goToLine', label: t('common.shortcuts.cmd.editor.goToLine'), cmd: 'editor.goToLine', onClick: h.goToLine },
    {
      id: 'lineEdits',
      label: t('ide.editor.ctx.lineEdits'),
      // 하위 메뉴를 펼치는 항목이라 누름 자체는 할 일이 없다(IDEContextMenuPanel 이 펼친다).
      onClick: () => undefined,
      children: buildLineEditItems(state, h, t),
    },
    {
      id: 'save',
      label: t('ide.editor.ctx.save'),
      // 저장만 우리 명령이다 — 위의 잘라내기·붙여넣기·되돌리기는 브라우저가 처리하므로
      //   레지스트리에 넣지 않고 표기(`hint`)만 남긴다(§6 "핸들러가 표를 보는 것만 등록").
      cmd: 'editor.save',
      separatorBefore: true,
      disabled: !state.dirty,
      disabledTitle: t('ide.editor.ctx.nothingToSave'),
      onClick: h.save,
    },
    { id: 'reload', label: t('ide.editor.ctx.reload'), onClick: h.reload },
    { id: 'copyPath', label: t('ide.editor.ctx.copyPath'), separatorBefore: true, onClick: h.copyPath },
    { id: 'copyLineRef', label: t('ide.editor.ctx.copyLineRef'), onClick: h.copyLineRef },
    { id: 'openExternal', label: t('ide.editor.ctx.openExternal'), onClick: h.openExternal },
  ];
}

/** (a′) "줄 편집" 하위 메뉴(§5.5 #17-27 ⑲). 라벨은 단축키 목록과 같은 키(번역 두 벌 ❌). 읽기 전용·주석 기호 없음이면 흐리고 이유를 단다. */
function buildLineEditItems(state: BodyMenuState, h: BodyMenuHandlers, t: MenuText): ContextMenuItem[] {
  const readOnlyWhy = t('ide.editor.ctx.readOnlyFile');
  const noComment = t('ide.editor.ctx.noCommentSyntax');
  const edit = (id: string, labelKey: string, cmd: ContextMenuItem['cmd'], onClick: () => void, separatorBefore = false): ContextMenuItem => ({
    id,
    label: t(labelKey),
    cmd,
    separatorBefore,
    disabled: state.readOnly,
    disabledTitle: readOnlyWhy,
    onClick,
  });
  const comment = (id: string, labelKey: string, cmd: ContextMenuItem['cmd'], can: boolean, onClick: () => void, separatorBefore = false): ContextMenuItem => ({
    id,
    label: t(labelKey),
    cmd,
    separatorBefore,
    disabled: state.readOnly || !can,
    disabledTitle: state.readOnly ? readOnlyWhy : noComment,
    onClick,
  });
  return [
    edit('copyLineUp', 'common.shortcuts.cmd.editor.copyLineUp', 'editor.copyLineUp', h.copyLineUp),
    edit('copyLineDown', 'common.shortcuts.cmd.editor.copyLineDown', 'editor.copyLineDown', h.copyLineDown),
    edit('moveLineUp', 'common.shortcuts.cmd.editor.moveLineUp', 'editor.moveLineUp', h.moveLineUp),
    edit('moveLineDown', 'common.shortcuts.cmd.editor.moveLineDown', 'editor.moveLineDown', h.moveLineDown),
    edit('deleteLine', 'common.shortcuts.cmd.editor.deleteLine', 'editor.deleteLine', h.deleteLine),
    edit('insertLineBelow', 'common.shortcuts.cmd.editor.insertLineBelow', 'editor.insertLineBelow', h.insertLineBelow, true),
    edit('insertLineAbove', 'common.shortcuts.cmd.editor.insertLineAbove', 'editor.insertLineAbove', h.insertLineAbove),
    edit('indentLines', 'common.shortcuts.cmd.editor.indentLines', 'editor.indentLines', h.indentLines, true),
    edit('outdentLines', 'common.shortcuts.cmd.editor.outdentLines', 'editor.outdentLines', h.outdentLines),
    comment('toggleLineComment', 'common.shortcuts.cmd.editor.toggleLineComment', 'editor.toggleLineComment',
      state.canLineComment ?? true, h.toggleLineComment, true),
    comment('toggleBlockComment', 'common.shortcuts.cmd.editor.toggleBlockComment', 'editor.toggleBlockComment',
      state.canBlockComment ?? true, h.toggleBlockComment),
    // 줄 고르기는 고치는 일이 아니라 읽기 전용 파일에서도 된다.
    {
      id: 'selectLine',
      label: t('common.shortcuts.cmd.editor.selectLine'),
      cmd: 'editor.selectLine',
      separatorBefore: true,
      onClick: h.selectLine,
    },
  ];
}

/** (b) 줄 번호 칸 — 왼쪽 클릭이 하던 일(중단점)을 이름 붙여 보여 주고, 줄을 집어 가는 두 가지를 더한다. */
export function buildGutterMenuItems(
  state: GutterMenuState,
  h: GutterMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const noDebug = t('ide.editor.ctx.noBreakpointTarget');

  return [
    {
      id: 'toggleBreakpoint',
      label: state.hasBreakpoint
        ? t('ide.editor.ctx.removeBreakpoint')
        : t('ide.editor.ctx.addBreakpoint', { line: state.line }),
      disabled: !state.canBreakpoint,
      disabledTitle: noDebug,
      onClick: h.toggleBreakpoint,
    },
    {
      id: 'clearFileBreakpoints',
      label: t('ide.editor.ctx.clearFileBreakpoints'),
      disabled: !state.canBreakpoint || !state.hasAnyBreakpoint,
      disabledTitle: state.canBreakpoint ? t('ide.editor.ctx.noBreakpoints') : noDebug,
      onClick: h.clearFileBreakpoints,
    },
    { id: 'copyLine', label: t('ide.editor.ctx.copyLine'), separatorBefore: true, onClick: h.copyLine },
    { id: 'copyLineRef', label: t('ide.editor.ctx.copyLineRef'), onClick: h.copyLineRef },
  ];
}

/** (c) 탭 — 닫기 계열 + 이 파일을 다른 데로 가져가는 두 가지. */
export function buildTabMenuItems(
  state: TabMenuState,
  h: TabMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  return [
    { id: 'close', label: t('ide.editor.ctx.closeTab'), onClick: h.close },
    {
      id: 'closeOthers',
      label: t('ide.editor.ctx.closeOthers'),
      disabled: !state.hasOthers,
      disabledTitle: t('ide.editor.ctx.noOtherTabs'),
      onClick: h.closeOthers,
    },
    { id: 'closeAll', label: t('ide.editor.ctx.closeAll'), onClick: h.closeAll },
    ...(state.isFile === false ? [] : [
      { id: 'copyPath', label: t('ide.editor.ctx.copyPath'), separatorBefore: true, onClick: h.copyPath },
      { id: 'openExternal', label: t('ide.editor.ctx.openExternal'), onClick: h.openExternal },
    ]),
  ];
}
