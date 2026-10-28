import type { ContextMenuItem } from './IDEContextMenu.js';
import type { MenuText } from './editorContextMenu.js';
import { isMac, shortcutLabel } from '../../utils/platform.js';

/** §5.5 #17-19 ⑦ 탐색기 우클릭 메뉴 목록(순수, `editorContextMenu.ts` 와 같은 규약). 위젯은 기존 `IDEContextMenu` — 두 벌이면 한 벌은 뒤처진다. 글자는 `t` 로만. */

/** mac 은 ⌘⌫ 로 안내한다(`Delete` 자리가 `Backspace` 로 온다 — ⌫ 하나면 손이 미끄러져 파일이 사라진다). */
export function explorerDeleteHint(): string {
  return isMac() ? shortcutLabel('Ctrl+Backspace') : 'Delete';
}

/** 파일·폴더 행이 아는 상태. */
export interface ExplorerEntryMenuState {
  isDirectory: boolean;
}

/** 행 우클릭이 할 수 있는 일. 폴더에는 없는 항목(열기)도 호출부가 넘기지만 목록에 서지 않는다. */
export interface ExplorerEntryMenuHandlers {
  /** 왼쪽 클릭과 같은 자리에서 연다(파일만 — 편집창·내부 앱·실행 판정 그대로). */
  open: () => void;
  /** 앱 밖 편집기로(파일만 — 종전 ↗ 손잡이와 같은 길). */
  openExternal: () => void;
  /** 시스템 탐색기에서 보기 — 파일이면 그 파일이 든 폴더, 폴더면 자기 자신. */
  revealFolder: () => void;
  /** 이 폴더 안에 새로 만들기(폴더만). */
  newFile: () => void;
  newFolder: () => void;
  copyPath: () => void;
  rename: () => void;
  remove: () => void;
}

/** (a) 트리 행 — 파일·폴더가 같은 순서(손은 위치를 기억한다). 그 자리에 없는 것만 빠진다. */
export function buildExplorerEntryMenuItems(
  state: ExplorerEntryMenuState,
  h: ExplorerEntryMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (state.isDirectory) {
    items.push({ id: 'newFile', label: t('ide.explorer.ctx.newFile'), onClick: h.newFile });
    items.push({ id: 'newFolder', label: t('ide.explorer.ctx.newFolder'), onClick: h.newFolder });
  } else {
    items.push({ id: 'open', label: t('ide.explorer.ctx.open'), onClick: h.open });
    items.push({ id: 'openExternal', label: t('ide.explorer.ctx.openExternal'), onClick: h.openExternal });
  }

  items.push({
    id: 'revealFolder',
    label: t('ide.explorer.ctx.revealFolder'),
    separatorBefore: true,
    onClick: h.revealFolder,
  });
  items.push({ id: 'copyPath', label: t('ide.explorer.copyPath'), onClick: h.copyPath });

  items.push({
    id: 'rename',
    label: t('ide.explorer.ctx.rename'),
    hint: 'F2',
    separatorBefore: true,
    onClick: h.rename,
  });
  items.push({
    id: 'delete',
    label: t('ide.explorer.ctx.delete'),
    hint: explorerDeleteHint(),
    onClick: h.remove,
  });

  return items;
}

/** 트리 빈 자리(= 루트) 우클릭이 할 수 있는 일. */
export interface ExplorerRootMenuHandlers {
  newFile: () => void;
  newFolder: () => void;
  revealFolder: () => void;
  copyPath: () => void;
  refresh: () => void;
}

/** (b) 빈 자리 — 대상은 루트. 같은 순서, 단 자신을 지우거나 이름 바꾸는 항목은 없다(서버도 `root` 로 거절한다). */
export function buildExplorerRootMenuItems(h: ExplorerRootMenuHandlers, t: MenuText): ContextMenuItem[] {
  return [
    { id: 'newFile', label: t('ide.explorer.ctx.newFile'), onClick: h.newFile },
    { id: 'newFolder', label: t('ide.explorer.ctx.newFolder'), onClick: h.newFolder },
    { id: 'revealFolder', label: t('ide.explorer.ctx.revealFolder'), separatorBefore: true, onClick: h.revealFolder },
    { id: 'copyPath', label: t('ide.explorer.copyPath'), onClick: h.copyPath },
    { id: 'refresh', label: t('ide.explorer.refresh'), separatorBefore: true, onClick: h.refresh },
  ];
}

/** 활동바 **파일** 항목 우클릭이 아는 상태. */
export interface ExplorerActivityMenuState {
  /** 열려 있는 프로젝트가 있는가 — 없으면 열 폴더도, 복사할 경로도 없다. */
  hasProject: boolean;
}

export interface ExplorerActivityMenuHandlers {
  revealFolder: () => void;
  copyPath: () => void;
}

/** (c) 활동바 파일 항목 — 만들기·지우기 ❌(트리가 접혀 있으면 만든 것이 어디 갔는지 안 보인다). */
export function buildExplorerActivityMenuItems(
  state: ExplorerActivityMenuState,
  h: ExplorerActivityMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const noProject = t('ide.explorer.noProject');
  return [
    {
      id: 'revealFolder',
      label: t('ide.explorer.ctx.revealFolder'),
      disabled: !state.hasProject,
      disabledTitle: noProject,
      onClick: h.revealFolder,
    },
    {
      id: 'copyPath',
      label: t('ide.explorer.copyPath'),
      disabled: !state.hasProject,
      disabledTitle: noProject,
      onClick: h.copyPath,
    },
  ];
}
