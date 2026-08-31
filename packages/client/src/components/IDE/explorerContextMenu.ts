import type { ContextMenuItem } from './IDEContextMenu.js';
import type { MenuText } from './editorContextMenu.js';
import { isMac, shortcutLabel } from '../../utils/platform.js';

/**
 * explorerContextMenu.ts — §5.5 #17-19 ⑦ 탐색기 우클릭 **메뉴 항목 목록**(순수 로직).
 *
 * 편집창의 `editorContextMenu.ts` 와 같은 규약이다 — 무엇이 어느 자리에 서고 무엇이 흐려지는지는
 * 화면을 띄우지 않고도 답이 나와야 하므로, 목록 만들기를 컴포넌트에서 떼어 내 여기 두고
 * `explorerContextMenu.test.ts` 로 못 박는다. 메뉴 위젯 자체는 이미 있는 `IDEContextMenu` 를 쓴다
 * (넘침 보정·바깥 press·Esc 규약이 두 벌이 되면 그중 한 벌은 반드시 뒤처진다).
 *
 * i18n 은 호출부가 넘긴 `t` 로만 만든다(모듈 레벨 하드코딩 문자열 ❌).
 */

/**
 * 삭제 단축키 표시 — mac 만 다르다.
 *
 * mac 키보드의 `Delete` 자리(⌫)는 브라우저에서 `Backspace` 로 오므로, 그쪽은 파인더와 같은
 * **⌘⌫** 로 안내한다(그냥 ⌫ 하나로 지우면 손이 미끄러졌을 때 파일이 사라진다).
 */
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

/**
 * (a) 트리 행 — 파일과 폴더가 **같은 순서**를 쓴다(열기 계열 → 만들기 → 집어가기 → 고치기).
 *
 * 자리를 공유하는 이유는 손이 기억하는 것이 위치이기 때문이다 — 파일에서 세 번째였던 항목이
 * 폴더에서 첫 번째가 되면 매번 읽어야 한다. 그 자리에 없는 것만 빠진다.
 */
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

/**
 * (b) 트리 빈 자리 — 대상이 **루트**다. 행 메뉴와 같은 순서를 쓰되, 자기 자신을 지우거나
 * 이름을 바꾸는 항목은 없다(탐색기가 서 있는 땅이다 — 서버도 `root` 로 거절한다).
 */
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

/**
 * (c) 활동바 **파일** 항목 — 대상은 그 창이 보고 있는 프로젝트 루트다.
 *
 * 여기서는 만들기·지우기를 내지 않는다: 활동바는 사이드바가 접혀 있어도 늘 떠 있는 자리라,
 * 화면에 트리가 없는 채로 파일을 만들면 **만들어진 것이 어디 갔는지 보이지 않는다**.
 * 이 자리가 답할 물음은 하나다 — "이 프로젝트 폴더를 열어 달라".
 */
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
