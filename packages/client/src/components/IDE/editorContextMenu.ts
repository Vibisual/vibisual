import type { ContextMenuItem } from './IDEContextMenu.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';

/**
 * editorContextMenu.ts — §5.5 #17-27 ⑨ v4.97 편집창 우클릭 **메뉴 항목 목록**(순수 로직).
 *
 * 무엇이 보이고 무엇이 흐려지는지는 화면을 띄우지 않고도 답이 나와야 한다 — 고른 글자가 없으면
 * 복사가 흐려지고, 읽기 전용 파일이면 붙여넣기가 흐려지고, 저장할 것이 없으면 저장이 흐려진다.
 * 그래서 목록 만들기를 컴포넌트에서 떼어 내 여기에 두고 `editorContextMenu.test.ts` 로 못 박는다.
 *
 * i18n 은 호출부가 넘긴 `t` 로만 만든다(모듈 레벨 하드코딩 문자열 ❌ — 언어 전환이 안 따라온다).
 */

/** `useTranslation()` 의 `t` 중 우리가 쓰는 모양만. */
export type MenuText = (key: string, opts?: Record<string, unknown>) => string;

/** 본문(코드) 우클릭이 아는 상태. */
export interface BodyMenuState {
  hasSelection: boolean;
  /** 이진·상한 초과 파일 = 고칠 수 없다 */
  readOnly: boolean;
  /** 저장할 것이 남아 있는가 */
  dirty: boolean;
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
    {
      id: 'save',
      label: t('ide.editor.ctx.save'),
      hint: shortcutLabel('Ctrl+S'),
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
    { id: 'copyPath', label: t('ide.editor.ctx.copyPath'), separatorBefore: true, onClick: h.copyPath },
    { id: 'openExternal', label: t('ide.editor.ctx.openExternal'), onClick: h.openExternal },
  ];
}
