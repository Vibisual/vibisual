import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isWorkspaceHtmlPath } from '@vibisual/shared';
import type { WorkspaceOpenPlan } from '@vibisual/shared';
import type { StreamPathCandidate } from './streamPathLinks.js';
import type { ResolvedExternalPath, ResolvedWorkspacePath } from './useWorkspacePathKind.js';
import { revealExternalPath, useExternalPathKind, useWorkspacePathKind } from './useWorkspacePathKind.js';
import { openExternally, openWorkspaceTarget, planWorkspaceOpen } from './openWorkspaceTarget.js';
import { openFolderByPath } from './useWorkspaceExplorer.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { buildOutsidePathLinkMenuItems, buildPathLinkMenuItems, buildWebLinkMenuItems, pathLinkOpenLabel } from './pathLinkContextMenu.js';
import { requestHtmlPageView } from './htmlViewRequest.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { useIDEPaneKey } from './idePane.js';
import { reportPreviewUrlIfLoopback } from './reportPreviewUrl.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { getInternalApp } from '../../apps/registry.js';

/**
 * usePathLinkRails — §5.5 #17-27 ⑬ 경로 손잡이의 **판정·열기·우클릭 메뉴 한 벌**.
 *
 * 손잡이가 서는 자리는 둘이다 — (a) 의 인라인 코드와 (k) 의 마크다운 링크. 두 자리가 여는 곳·메뉴를
 * 각자 짜면 한쪽만 고쳐지는 날이 반드시 오고, 그러면 "같은 파일인데 적힌 모양에 따라 다르게 열리는"
 * 화면이 된다. 그래서 후보(`StreamPathCandidate`) 하나를 받아 **레일 전부**를 돌려주는 훅을 두고,
 * 두 컴포넌트는 아이콘·글자만 각자 그린다.
 *
 * **새 열기 레일 ❌** — 여기서 부르는 것은 전부 이미 있는 창구다(⑬ (d)(i)(j)).
 */

/** 우클릭이 연 자리. 화면 좌표다(메뉴는 `document.body` 로 포털된다). */
interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

/**
 * 우클릭 자리잡기 한 벌 — 경로 손잡이와 웹 링크가 같은 규칙으로 연다.
 *
 * 조상(스트림 본문)의 글자 메뉴(#17-3)가 같은 우클릭으로 **함께** 뜨지 않게 여기서 전파를 끊고,
 * 키보드(메뉴 키·Shift+F10)로 열려 좌표가 0 인 경우에는 손잡이 바로 아래에 연다.
 */
function useAnchoredMenu(): {
  at: MenuAnchor | null;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  close: () => void;
} {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const close = useCallback((): void => setAt(null), []);
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setAt(e.clientX === 0 && e.clientY === 0 ? { x: r.left, y: r.bottom } : { x: e.clientX, y: e.clientY });
  }, []);
  return { at, onContextMenu, close };
}

/**
 * 메뉴는 `document.body` 로 포털되지만 **리액트 이벤트는 리액트 트리를 따라** 조상으로 올라간다 —
 * 메뉴 안의 우클릭이 스트림 본문의 글자 메뉴를 겹쳐 띄우고, 항목 클릭이 접기 같은 조상 클릭을 건드린다.
 * 감싼 자리에서 끊는다(DOM 에는 빈 span 하나만 남는다).
 */
function renderAnchoredMenu(at: MenuAnchor | null, items: ContextMenuItem[], close: () => void): React.JSX.Element | null {
  if (at === null || items.length === 0) return null;
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <IDEContextMenu x={at.x} y={at.y} items={items} onClose={close} />
    </span>
  );
}

/** 클립보드 거부(권한 없음·비보안 오리진)는 조용히 무시한다 — 복사는 실패해도 화면이 깨지지 않는다. */
function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => { /* 무시 */ });
}

export interface PathLinkRails {
  /** 루트 **안** 판정 — 디스크에 있을 때만 non-null. */
  readonly linked: ResolvedWorkspacePath | null;
  /** 루트 **밖** 판정 — 디스크에 있을 때만 non-null. 갈 수 있는 곳은 탐색기 하나다(⑬ (d)). */
  readonly linkedOutside: ResolvedExternalPath | null;
  /** 왼쪽 클릭이 여는 곳(§5.13 (R-1) 이 정한 갈래 중 하나). 루트 밖이면 null. */
  readonly plan: WorkspaceOpenPlan | null;
  /** 루트 안이면 루트 기준 상대 경로, 아니면 null. */
  readonly insideRel: string | null;
  /** 루트 안 왼쪽 클릭. */
  readonly onOpen: (e: React.MouseEvent) => void;
  /** 루트 밖 왼쪽 클릭 — 시스템 탐색기 하나뿐이다. */
  readonly onReveal: (e: React.MouseEvent) => void;
  /** 손잡이 위 우클릭 — ⑬ (j) 경로 전용 메뉴를 연다(본문 글자 메뉴 ❌). */
  readonly onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  /** 열려 있는 메뉴(포털). 닫혀 있으면 null — 그대로 손잡이 옆에 렌더한다. */
  readonly menu: React.JSX.Element | null;
}

export function usePathLinkRails(candidate: StreamPathCandidate | null, rootPath: string | null): PathLinkRails {
  const { t } = useTranslation();
  // §5.5 #17-1 — 본문에서 누른 경로는 **이 창의** 편집창·실행으로 가야 한다(옆 창 ❌).
  const paneKey = useIDEPaneKey();

  // ⑬ (d) — 루트 안/밖은 **묻는 창구도 열리는 곳도** 다르다. 후보의 `scope` 가 그 갈림이고,
  //   훅은 둘 다 무조건 부르되(리액트 규칙) 해당 없는 쪽에 null 을 넘겨 아무것도 묻지 않게 한다.
  const insideRel = candidate?.scope === 'inside' ? candidate.relPath : null;
  const outsideAbs = candidate?.scope === 'outside' ? candidate.absPath : null;
  const resolved = useWorkspacePathKind(rootPath, insideRel);
  const external = useExternalPathKind(outsideAbs);

  const linked = resolved !== null && resolved.kind !== 'missing' ? resolved : null;
  const linkedOutside = external !== null && external.kind !== 'missing' ? external : null;

  /**
   * ⑬ (i) — 어디로 갈지는 **한 곳**(§5.13 (R-1))이 정한다. 화면은 그 답을 받아 아이콘·툴팁만 고르므로,
   * 앱이 늘어 새 확장자를 받아도 부르는 쪽 컴포넌트는 그대로다.
   */
  const plan = useMemo(
    () =>
      linked && insideRel !== null
        ? planWorkspaceOpen({
            relPath: insideRel,
            kind: linked.kind === 'directory' ? 'directory' : 'file',
            ...(linked.executable ? { executable: true } : {}),
          })
        : null,
    [linked, insideRel],
  );

  const onOpen = useCallback((e: React.MouseEvent): void => {
    if (!linked || insideRel === null || rootPath === null) return;
    e.preventDefault();
    e.stopPropagation();
    void openWorkspaceTarget(
      {
        relPath: insideRel,
        absPath: linked.absPath,
        kind: linked.kind === 'directory' ? 'directory' : 'file',
        ...(linked.executable ? { executable: true } : {}),
      },
      rootPath,
      t('ide.streamRenderer.pathLink.runFailed'),
      paneKey,
    );
  }, [linked, insideRel, rootPath, t, paneKey]);

  /**
   * ⑬ (d) — 루트 **밖** 경로를 누르면 벌어지는 일은 하나뿐이다: 시스템 탐색기가 그 자리를 보여 준다.
   * 편집창·실행·연결 프로그램으로는 가지 않으므로 `planWorkspaceOpen` 을 거치지 않는다 — 갈래가 없는
   * 곳에서 갈림을 묻지 않는 것이 (d) 개정의 조건이었다. **링크로 적혀도(⑬ (k) ③) 이 선은 그대로다.**
   */
  const onReveal = useCallback((e: React.MouseEvent): void => {
    if (!linkedOutside) return;
    e.preventDefault();
    e.stopPropagation();
    revealExternalPath(linkedOutside.absPath);
  }, [linkedOutside]);

  /**
   * ⑬ (j) — 우클릭은 **경로 메뉴**다(글자 메뉴 #17-3 ❌). 왼쪽 클릭이 가는 한 곳 말고 그 파일로 갈 수 있는
   * 나머지 자리 — 든 폴더 · 앱 안 페이지 · 기본 브라우저 · 경로 집어가기 — 를 여기서 고른다.
   * 손잡이가 아닌 조각(평범한 인라인 코드·디스크에 없는 링크)에는 걸지 않는다 — 거기서는 종전 메뉴가 맞다.
   */
  const { at, onContextMenu, close } = useAnchoredMenu();

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (at === null) return [];

    if (linkedOutside) {
      const absPath = linkedOutside.absPath;
      return buildOutsidePathLinkMenuItems(
        { kind: linkedOutside.kind === 'directory' ? 'directory' : 'file', isHtml: isWorkspaceHtmlPath(absPath) },
        { reveal: () => revealExternalPath(absPath), copyPath: () => copyText(absPath) },
        t,
      );
    }

    if (!linked || !plan || insideRel === null || rootPath === null) return [];
    const absPath = linked.absPath;
    const relPath = insideRel;
    const root = rootPath;
    const app = plan.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;
    return buildPathLinkMenuItems(
      {
        kind: linked.kind === 'directory' ? 'directory' : 'file',
        isHtml: isWorkspaceHtmlPath(relPath),
        openLabel: pathLinkOpenLabel(plan, app?.name, t),
      },
      {
        open: () => {
          void openWorkspaceTarget(
            { relPath, absPath, kind: linked.kind === 'directory' ? 'directory' : 'file', ...(linked.executable ? { executable: true } : {}) },
            root,
            t('ide.streamRenderer.pathLink.runFailed'),
            paneKey,
          );
        },
        openPage: () => {
          // 왼쪽 클릭이 여는 그 편집창이다(⑮ — 기본이 페이지). 이미 소스로 돌려 둔 탭이면 페이지로 되돌린다.
          const file = editorFileFromAbsPath(absPath, root);
          useGraphStore.getState().openIDEEditorFile(file, paneKey);
          requestHtmlPageView(file.relPath);
        },
        openBrowser: () => { void openExternally(absPath); },
        // 파일을 주면 서버(`openFolder`)가 그 파일이 든 폴더를 연다 — 탐색기와 같은 창구(⑩).
        reveal: () => openFolderByPath(absPath, relPath),
        copyPath: () => copyText(absPath),
        copyRelativePath: () => copyText(relPath),
      },
      t,
    );
  }, [at, linkedOutside, linked, plan, insideRel, rootPath, paneKey, t]);

  return {
    linked,
    linkedOutside,
    plan,
    insideRel,
    onOpen,
    onReveal,
    onContextMenu,
    menu: renderAnchoredMenu(at, menuItems, close),
  };
}

export interface WebLinkRails {
  /** 왼쪽 클릭·메뉴 [브라우저에서 열기] 가 같이 쓰는 한 갈래. */
  readonly open: () => void;
  /** ⑬ (k) ④ — 주소 위 우클릭은 링크 메뉴다(본문 글자 메뉴 ❌). */
  readonly onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  readonly menu: React.JSX.Element | null;
}

/**
 * ⑬ (k) ④ — **웹 주소** 링크의 레일. 여는 동작은 종전 그대로다(바깥 브라우저 + §7.11 프리뷰 신고).
 *
 * 여는 갈래를 훅 안에 두는 이유는 (k) ③ 과 같다 — 왼쪽 클릭과 메뉴의 [브라우저에서 열기] 가 **같은 한 줄**을
 * 부르게 해야 한쪽만 고쳐지는 날이 오지 않는다.
 */
export function useWebLinkRails(href: string, ownerAgentId: string | undefined): WebLinkRails {
  const { t } = useTranslation();
  const { at, onContextMenu, close } = useAnchoredMenu();

  const open = useCallback((): void => {
    // §7.11 — 그 주소가 **내 기계의 서버**면 브라우저와 함께 캔버스 프리뷰 버블도 세운다. 누른 행위
    //   자체가 "이건 내가 보려는 서버다"라는 가장 확실한 신고라, 감지 폴백이 놓친 서버를 회수한다.
    reportPreviewUrlIfLoopback(href, ownerAgentId);
    try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* 창 열기 거부 */ }
  }, [href, ownerAgentId]);

  const items = useMemo(
    (): ContextMenuItem[] => (at === null ? [] : buildWebLinkMenuItems({ openBrowser: open, copyLink: () => copyText(href) }, t)),
    [at, open, href, t],
  );

  return { open, onContextMenu, menu: renderAnchoredMenu(at, items, close) };
}
