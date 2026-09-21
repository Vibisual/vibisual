import type { WorkspaceOpenPlan } from '@vibisual/shared';
import type { ContextMenuItem } from './IDEContextMenu.js';
import type { MenuText } from './editorContextMenu.js';

/**
 * pathLinkContextMenu.ts — §5.5 #17-27 ⑬ (j) 본문 경로 링크 우클릭 **메뉴 항목 목록**(순수 로직).
 *
 * 왼쪽 클릭은 한 곳으로만 간다(⑬ (i) 여섯 갈래 중 하나). 그 밖의 행선지 — 그 파일이 든 폴더, HTML 을
 * 앱 안 페이지로(⑮)·기본 브라우저로, 경로 집어가기 — 는 우클릭이 받는다. 우클릭이 없으면 사용자는
 * 글자 메뉴(#17-3 복사·인용…)를 받는데, 경로 조각 위에서 그 메뉴는 할 일이 없다.
 *
 * `explorerContextMenu.ts` 와 같은 규약이다 — 무엇이 어느 자리에 서고 무엇이 흐려지는지는 화면을
 * 띄우지 않고도 답이 나와야 하므로 목록 만들기를 여기 두고 `pathLinkContextMenu.test.ts` 로 못 박는다.
 * 메뉴 위젯은 이미 있는 `IDEContextMenu` 다. i18n 은 호출부가 넘긴 `t` 로만 만든다.
 *
 * **새 열기 레일 ❌** — 모든 항목은 이미 있는 창구로 간다: 폴더 = `open-node-folder`(⑩) · 루트 밖 =
 * `reveal-path`(⑬ (d)) · 웹(내부) = 내장 편집창의 페이지(⑮) · 웹(외부) = `open-external`(⑮ (b) [바깥 브라우저]).
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
 * (a) 루트 **안** — 여는 것 → 위치 → 집어가기. 폴더는 왼쪽 클릭이 곧 탐색기라 여는 줄이 하나다.
 *
 * `open-external` 은 HTML 에만 선다. 아무 파일에나 "연결 프로그램으로 열기"를 두면 Windows 에서
 * `.js`·`.vbs` 의 연결 프로그램(스크립트 호스트)이 **그 파일을 실행한다** — 누르면 도는 것은 ⑬ (h) 의
 * 실행 판정을 거친 것뿐이어야 한다. `.html` 의 연결 프로그램은 브라우저라 ⑮ (b) 가 이미 이 길을 쓴다.
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
  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */
  reveal: () => void;
  copyPath: () => void;
}

/**
 * (b) 루트 **밖** — 탐색기와 복사뿐이다. HTML 이면 웹 두 줄을 **흐린 채** 세우고 까닭을 단다 —
 * 안 보이면 "HTML 인데 왜 웹 열기가 없지" 가 고장으로 읽힌다(창구 `workspace-site` 는 루트 안만 낸다).
 * 상대 경로는 기준이 없으니 서지 않는다.
 */
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

/**
 * (c) ⑬ (k) ④ — **웹 주소** 링크의 우클릭.
 *
 * 종전에는 `http(s)` 링크 위 우클릭이 본문 글자 메뉴(#17-3 복사·인용·검색…)를 받았는데, 주소 위에서
 * 그 항목들은 할 일이 없다 — "링크를 눌렀는데 글자 메뉴가 뜬다" 는 경로 조각에서 (j) 가 고친 것과 똑같은
 * 어긋남이다. 줄은 둘이면 족하다: 왼쪽 클릭이 가는 곳과, 그 주소를 집어가는 것.
 *
 * **새 키 ❌** — 같은 문구가 이미 선 자리(웹 버블 [브라우저에서 열기] · 로그인 창 [링크 복사])의 키를
 * 그대로 쓴다. 같은 말에 키를 하나 더 만들면 로케일 12벌이 서로 갈린다.
 */
export function buildWebLinkMenuItems(h: WebLinkMenuHandlers, t: MenuText): ContextMenuItem[] {
  return [
    { id: 'openBrowser', label: t('panel.webEntry.openExternal'), onClick: h.openBrowser },
    { id: 'copyLink', label: t('panel.login.copyUrl'), separatorBefore: true, onClick: h.copyLink },
  ];
}
