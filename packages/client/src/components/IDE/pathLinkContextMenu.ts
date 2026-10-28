import type { WorkspaceOpenPlan } from '@vibisual/shared';
import type { ContextMenuItem } from './IDEContextMenu.js';
import type { MenuText } from './editorContextMenu.js';

/**
 * §5.5 #17-27 ⑬ (j) — 본문 경로 링크 우클릭 메뉴 항목 목록(순수, `explorerContextMenu.ts` 와 같은 규약, i18n 은 넘겨받은 `t`).
 * 왼쪽 클릭이 안 가는 행선지(든 폴더 · HTML 의 앱 안/기본 브라우저 · 경로 복사)를 받는다. 새 열기 레일 ❌ — 전부 기존 창구
 * (`open-node-folder` · `reveal-path` · 내장 편집창 페이지 · `open-external`).
 */

/** 루트 **안** 경로가 아는 상태. */
export interface PathLinkMenuState {
  kind: 'file' | 'directory';
  /** `.html`·`.htm`·`.xhtml`(shared `isWorkspaceHtmlPath`) — 웹(내부)/웹(외부) 두 항목이 서는 조건. */
  isHtml: boolean;
  /**
   * 왼쪽 클릭이 여는 곳의 이름(번역된 글자) — HTML 이 아닌 **파일**에서 맨 위에 선다.
   * HTML 은 그 자리를 웹(내부)이 대신한다(왼쪽 클릭이 여는 곳이 바로 그 페이지다 — 같은 항목 두 줄 ❌).
   */
  openLabel: string;
}

export interface PathLinkMenuHandlers {
  /** 왼쪽 클릭과 같은 자리에서 연다(`openWorkspaceTarget` — 판정 그대로). */
  open: () => void;
  /** 웹(내부) — 내장 편집창을 **페이지**로 연다(⑮). 소스로 돌려 둔 탭이어도 페이지로 되돌린다. */
  openPage: () => void;
  /** 웹(외부) — OS 연결 프로그램(= `.html` 의 기본 브라우저). */
  openBrowser: () => void;
  /** 시스템 탐색기 — 파일이면 그 파일이 든 폴더, 폴더면 자기 자신. */
  reveal: () => void;
  /** 절대 경로 복사(편집창 탭·탐색기 `경로 복사`와 같은 값). */
  copyPath: () => void;
  /** 프로젝트 루트 기준 상대 경로 복사. */
  copyRelativePath: () => void;
}

/**
 * 왼쪽 클릭이 여는 곳을 **메뉴 한 줄**로 — 툴팁(⑬ (f))의 앞토막과 같은 말이되 경로는 뺀다
 * (메뉴는 이미 그 경로 위에서 열렸다). 같은 문구가 이미 있는 자리는 그 키를 그대로 쓴다.
 */
export function pathLinkOpenLabel(plan: WorkspaceOpenPlan, appName: string | undefined, t: MenuText): string {
  switch (plan.action) {
    case 'run':
      return t('ide.streamRenderer.pathLink.menu.run');
    case 'app':
      return t('ide.streamRenderer.pathLink.menu.openApp', { app: appName ?? plan.appId ?? '' });
    case 'external':
      return t('panel.mediaConvert.openExternal');
    case 'folder':
      return t('ide.explorer.ctx.revealFolder');
    case 'convert':
      return t('ide.explorer.ctx.open');
    default:
      return t('ide.explorer.drop.editor');
  }
}

/**
 * (a) 루트 안 — 여는 것 → 위치 → 집어가기. `open-external` 은 HTML 에만(연결 프로그램이 브라우저다) — 아무 파일에나 두면 Windows 에서
 * `.js`·`.vbs` 의 연결 프로그램(스크립트 호스트)이 파일을 실행한다. 실행은 ⑬ (h) 판정을 거친 것만.
 */
export function buildPathLinkMenuItems(
  state: PathLinkMenuState,
  h: PathLinkMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (state.kind === 'directory') {
    items.push({ id: 'reveal', label: t('ide.explorer.ctx.revealFolder'), onClick: h.reveal });
  } else {
    if (state.isHtml) {
      items.push({ id: 'openPage', label: t('ide.streamRenderer.pathLink.menu.openPage'), onClick: h.openPage });
      items.push({ id: 'openBrowser', label: t('ide.streamRenderer.pathLink.menu.openBrowser'), onClick: h.openBrowser });
    } else {
      items.push({ id: 'open', label: state.openLabel, onClick: h.open });
    }
    items.push({
      id: 'reveal',
      label: t('ide.streamRenderer.pathLink.menu.revealFile'),
      separatorBefore: true,
      onClick: h.reveal,
    });
  }

  items.push({ id: 'copyPath', label: t('ide.editor.ctx.copyPath'), separatorBefore: true, onClick: h.copyPath });
  items.push({ id: 'copyRelativePath', label: t('ide.streamRenderer.pathLink.menu.copyRelativePath'), onClick: h.copyRelativePath });

  return items;
}

/** 루트 **밖** 경로가 아는 상태. */
export interface OutsidePathLinkMenuState {
  kind: 'file' | 'directory';
  isHtml: boolean;
}

/**
 * 루트 밖 경로가 할 수 있는 일 — 타입부터 둘뿐이다(⑬ (d)). 편집창·실행·연결 프로그램으로 가는
 * 손잡이를 **받을 자리 자체가 없다** — 임의 경로가 본문 글자 하나로 실행되는 길을 만들지 않는다.
 */
export interface OutsidePathLinkMenuHandlers {
  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */
  reveal: () => void;
  copyPath: () => void;
}

/** (b) 루트 밖 — 탐색기와 복사뿐. HTML 이면 웹 두 줄을 흐린 채 까닭과 함께 세운다(없으면 고장으로 읽힌다, `workspace-site` 는 루트 안만). 상대 경로는 안 선다. */
export function buildOutsidePathLinkMenuItems(
  state: OutsidePathLinkMenuState,
  h: OutsidePathLinkMenuHandlers,
  t: MenuText,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const blocked = t('ide.streamRenderer.pathLink.menu.outsideRoot');
  const noop = (): void => {};

  if (state.kind === 'file' && state.isHtml) {
    items.push({ id: 'openPage', label: t('ide.streamRenderer.pathLink.menu.openPage'), disabled: true, disabledTitle: blocked, onClick: noop });
    items.push({ id: 'openBrowser', label: t('ide.streamRenderer.pathLink.menu.openBrowser'), disabled: true, disabledTitle: blocked, onClick: noop });
  }

  items.push({
    id: 'reveal',
    label: state.kind === 'directory' ? t('ide.explorer.ctx.revealFolder') : t('ide.streamRenderer.pathLink.menu.revealFile'),
    separatorBefore: true,
    onClick: h.reveal,
  });
  items.push({ id: 'copyPath', label: t('ide.editor.ctx.copyPath'), separatorBefore: true, onClick: h.copyPath });

  return items;
}

/** 웹 주소 링크가 할 수 있는 일 — 열기와 집어가기 둘뿐이다. */
export interface WebLinkMenuHandlers {
  /** 바깥 브라우저(`window.open` → 데스크톱 본체가 `shell.openExternal` 로 가로챈다). 왼쪽 클릭과 같다. */
  openBrowser: () => void;
  /** 주소 복사. */
  copyLink: () => void;
}

/** (c) ⑬ (k) ④ — 웹 주소 링크 우클릭: 왼쪽 클릭이 가는 곳과 주소 복사 두 줄. 새 키 ❌ — 웹 버블 [브라우저에서 열기]·로그인 창 [링크 복사] 키를 쓴다. */
export function buildWebLinkMenuItems(h: WebLinkMenuHandlers, t: MenuText): ContextMenuItem[] {
  return [
    { id: 'openBrowser', label: t('panel.webEntry.openExternal'), onClick: h.openBrowser },
    { id: 'copyLink', label: t('panel.login.copyUrl'), separatorBefore: true, onClick: h.copyLink },
  ];
}
