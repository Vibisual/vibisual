import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
// §6 — 툴팁에 넣을 키는 레지스트리에서 읽는다(하드코딩하면 재매핑에 뒤처진다).
import { useBindingLabel } from '../Shortcuts/useBindingLabel.js';
import { useGraphStore, selectIDEOverlay, workspaceImageFileKey } from '../../stores/graphStore.js';
import { useImageLightboxOrigin } from './imageLightboxOrigin.js';
import { useIDEPaneValue, useIDEPaneProjectName, useIDEPaneActions, useIDEPaneKey } from './idePane.js';
import { CodeEditor, type EditorViewState, type FollowRange } from './CodeEditor.js';
import { languageFromPath } from './codeLanguages.js';
import { FOLLOW_SKIP_KEYS, findEditedLineRange, followSessionKey } from './editorFollow.js';
import { clampLineRange, countTextLines } from './editorLineRange.js';
import { isDirty, splitPathTail, tabLabels } from './editorModel.js';
import { splitRelPath } from './explorerModel.js';
import { useEditorDocs } from './useEditorDocs.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { openFileByPath, openFolderByPath } from './useWorkspaceExplorer.js';
import { isAbsoluteMediaPath, workspaceMediaUrl } from '../../utils/workspaceMedia.js';
import { workspaceSiteSrc } from '../../utils/workspaceSite.js';
import { clientPathKey } from '../../utils/platform.js';
import { confirmDialog } from '../../utils/appDialog.js';
import { isWorkspaceHtmlPath } from '@vibisual/shared';
import { IDEEditorTabs } from './IDEEditorTabs.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { buildBodyMenuItems, buildGutterMenuItems, buildTabMenuItems } from './editorContextMenu.js';
import { commentTokensFor } from './editorComments.js';
import type { EditorFindMemory } from './useEditorFind.js';
import { openWebSearch } from './webSearchUrl.js';
import type { CodeEditorBodyMenuContext } from './CodeEditor.js';
import { useDebugSessions } from '../../stores/debugSessions.js';
import { sameWorkspaceFile } from './debugPaths.js';
import { IDEImagePreview } from './IDEImagePreview.js';
import { IDEHtmlPreview } from './IDEHtmlPreview.js';
import { openExternally } from './openWorkspaceTarget.js';
import { subscribeHtmlPageView } from './htmlViewRequest.js';
import { useWorkspaceImage } from './useWorkspaceImage.js';
import { bakeMimeFor, canOverwriteWorkspaceImage } from './workspaceImageSave.js';
import { imageMetaLabel } from './editorImageMeta.js';
import { useIDEBodyLayout } from './ideBodyLayoutContext.js';
import { dragEditorWidth, type EditorResizeDrag } from './ideResponsive.js';
import { IDEStageView } from './IDEStageView.js';
// §5.5 #17-27 ⑱ — 빈 탭(그 갈래의 파일 고르기)과 보기의 [파일 열기].
import { editorPaneKindOf } from '@vibisual/shared';
import { workspaceOpenClaims } from '../../apps/registry.js';
import { editorOpenerKey } from '../../stores/editorOpener.js';
import { IDEPaneOpener } from './IDEPaneOpener.js';
import { OpenFileGlyph } from './paneKinds.js';
import { requestOpenerFocus } from './paneOpenerModel.js';

/**
 * IDEEditorPane.tsx — §5.5 #17-27 메인 영역 오른쪽의 판(덮개가 아닌 형제, ①). 탭 줄 · 손잡이 줄 · 본문(`CodeEditor`).
 * §5.5 #17-17 ㉔ — 우측 판은 이것 하나: 무대·파일·이미지·HTML·PDF 가 전부 이 판의 탭이다(맨 앞이 무대).
 * 비추는 것은 `activePath` 하나(`null` = 무대) — 따로 플래그를 두면 "무대이면서 파일" 조합이 생긴다.
 */

/**
 * 폭 손잡이의 잡히는 여유(px) — 보이는 띠는 4px, 잡는 자리만 넓힌다(분할 손잡이 ⑪ (a) 와 같은 모양).
 * 바깥 띠가 그리고 안쪽 절대배치 자식이 포인터를 받는다(부모 `:hover` 는 자식 위에서도 켜진다).
 */
const RESIZE_HIT_PAD = {
  /** 대화 쪽(바깥)으로 넓히는 여유 — 그 자리에는 겹칠 손잡이가 없어 넉넉히 준다. */
  OUT: 8,
  /** 본문 쪽 여유는 작게 — 편집창 왼쪽 끝의 줄 번호·중단점 여백을 가려 넓으면 중단점이 안 찍힌다. */
  IN: 2,
} as const;

/** §5.5 #17-27 ⑪ — 강조가 머무는 시간(ms). `index.css` 의 `edit-follow-flash` 길이와 맞춘다. */
const FOLLOW_FLASH_MS = 1800;

/** §5.5 #17-27 ⑰ — 최대화 직후 구석의 [원래대로] 를 드러내 두는 시간(ms). 돌아갈 자리를 한 번 보여 준다. */
const RESTORE_HINT_MS = 1500;

export const IDEEditorPane = memo(function IDEEditorPane({ runOutput }: {
  /** 실행 출력도 웹 미리보기와 같은 폭·손잡이·반응형 배치를 쓴다. */
  runOutput?: React.JSX.Element;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const files = useIDEPaneValue((o) => o.editorFiles);
  const activePath = useIDEPaneValue((o) => o.activeEditorPath);
  /**
   * 자리가 없으면(`editorDrawer` — 폰·좁힌 창, ①) 대화 위 오버레이. `width` 는 저장값(기본 520px)이 아니라 이 창에서 쓸 폭이다
   * — 저장값을 그대로 그리면 대화가 0px 로 밀린다(저장값은 그대로 둔다).
   */
  const { editorDrawer: narrow, editorWidth: width, editorMaxWidth, navDrawer } = useIDEBodyLayout();
  const setWidth = useGraphStore((s) => s.setIdeEditorWidth);
  const {
    setActiveEditorFile: setActive,
    closeEditorFile: closeFile,
    setEditorFileDirty: setDirty,
    setEditorTabsPinned,
    setStageOpen,
    openPaneOpener,
  } = useIDEPaneActions();
  const paneKey = useIDEPaneKey();
  /** §5.5 #17-17 ㉔ — 무대를 비추는가 = 무대 탭이 섰고 활성 파일이 없는가(새 플래그 ❌ — "무대이면서 파일" 조합이 생긴다). */
  const stageOpen = useIDEPaneValue((o) => o.stageOpen);
  const stageActive = stageOpen && activePath === null;
  /** §5.5 #17-27 ⑯ — 탭 줄이 세션을 따라 바뀌지 않게 붙들어 두었는가. */
  const tabsPinned = useIDEPaneValue((o) => o.editorPinned);
  const toggleTabsPinned = useCallback((): void => {
    setEditorTabsPinned(!tabsPinned);
  }, [setEditorTabsPinned, tabsPinned]);

  // ─── §5.5 #17-27 ⑰ — 최대화: 탭·경로·주소 줄을 걷고 본문만 ──────────────
  /** 폭은 두고 머리 줄만 걷는다. 영속 ❌(⑦). `restoreHint` = 켠 직후 [원래대로] 를 잠깐 드러내는 표식(`RESTORE_HINT_MS`). */
  const [maximized, setMaximized] = useState(false);
  const [restoreHint, setRestoreHint] = useState(false);
  const handleMaximize = useCallback((): void => {
    setMaximized(true);
    setRestoreHint(true);
  }, []);
  const handleRestore = useCallback((): void => {
    setMaximized(false);
    setRestoreHint(false);
  }, []);
  useEffect(() => {
    if (!restoreHint) return;
    const timer = window.setTimeout(() => setRestoreHint(false), RESTORE_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [restoreHint]);
  /** 판이 내려가면 최대화도 푼다(다음에 탭 줄 없이 뜨면 탭이 사라진 줄 안다). 아래 조기 반환 조건을 뒤집은 식이다. */
  const paneShown = stageActive || (files.length > 0 && !!activePath);
  useEffect(() => {
    if (!paneShown) handleRestore();
  }, [paneShown, handleRestore]);
  const clearBreakpointsInFile = useGraphStore((s) => s.clearBreakpointsInFile);

  const editorPaneKey = useIDEPaneValue((o) => o.paneKey);
  const { docs, ensureLoaded, reload, setDraft, save, drop } = useEditorDocs(rootPath, editorPaneKey);
  const closePending = useRef(false);
  const editorScope = useMemo(() => ({ rootPath, paneKey }), [rootPath, paneKey]);
  const closeStateRef = useRef({ scope: editorScope, docs, files });
  closeStateRef.current = { scope: editorScope, docs, files };
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const editorViews = useMemo(() => new Map<string, { current: EditorViewState | null }>(), [rootPath]);
  const editorViewStateRef = useMemo(() => {
    if (!activePath) return undefined;
    let saved = editorViews.get(activePath);
    if (!saved) { saved = { current: null }; editorViews.set(activePath, saved); }
    return saved;
  }, [activePath, editorViews]);
  useEffect(() => {
    const openPaths = new Set(files.map((file) => file.relPath));
    for (const file of editorViews.keys()) if (!openPaths.has(file)) editorViews.delete(file);
  }, [editorViews, files]);

  const active = useMemo(() => files.find((f) => f.relPath === activePath) ?? null, [files, activePath]);
  /**
   * §5.5 #17-27 ⑱ — 빈 탭이면 그 갈래: 디스크를 읽지 않고 손잡이·추종·알림 줄 없이 `IDEPaneOpener` 를 그린다.
   * 판정은 늘 `opener` 칸이다(키를 읽지 않는다 — `stores/editorOpener.ts`).
   */
  const openerKind = active?.opener ?? null;
  const doc = activePath && !openerKind ? docs[activePath] : undefined;
  const labels = useMemo(() => tabLabels(files), [files]);
  const language = useMemo(() => (active && !openerKind ? languageFromPath(active.relPath) : 'plain'), [active, openerKind]);
  /** §5.5 #17-27 ⑲ — 이 파일의 주석 기호(확장자까지 본다 — lua 는 `--`, 언리얼 `.ini` 는 `;`). */
  const comments = useMemo(() => commentTokensFor(active?.relPath ?? null, language), [active, language]);
  /** §5.5 #17-27 ⑲ — 판의 찾기 기억. 편집창은 파일마다 새로 서므로(`key={activePath}`) 여기 둬야 탭을 바꿔도 이어 찾는다(휘발). */
  const findMemoryRef = useRef<EditorFindMemory | null>(null);
  /** §5.5 #17-27 ⑱ (e) — 지금 파일 탭의 갈래([파일 열기] 가 같은 갈래의 빈 탭을 세운다). 판정은 목록·서버와 같은 `editorPaneKindOf`. */
  const activeFileKind = useMemo(
    () => (active && !openerKind ? editorPaneKindOf(active.relPath, workspaceOpenClaims()) : null),
    [active, openerKind],
  );
  const handleOpenAnother = useCallback((): void => {
    if (!active || !activeFileKind) return;
    openPaneOpener(activeFileKind, active.relPath);
    // 사용자가 방금 연 빈 탭이다 — 그 탭의 검색 칸이 초점을 가져간다(⑱ (d)).
    requestOpenerFocus(paneKey, editorOpenerKey(activeFileKind));
  }, [active, activeFileKind, openPaneOpener, paneKey]);

  // ─── §5.5 #17-27 ⑭ — 이미지는 글자가 아니라 그림으로 연다 ──────────────
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const lightboxOrigin = useImageLightboxOrigin();
  const imageFileKey = rootPath && activePath ? workspaceImageFileKey(rootPath, activePath) : null;
  const imageSavedAt = useGraphStore((s) => (imageFileKey ? s.workspaceImageSavedAt[imageFileKey] : undefined));
  /** 서버가 이미 판정해 보낸 값 — 클라이언트가 확장자를 다시 따지지 않는다. */
  const isImage = doc?.status === 'ready' && doc.image;
  /** §5.13 (R) — PDF 는 텍스트도 그림도 아니라 세 번째 그리기다(내장 Chromium 뷰어). */
  const isPdf = !openerKind && activePath !== null && activePath.toLowerCase().endsWith('.pdf');

  // ─── §5.5 #17-27 ⑮ — HTML 은 글자가 아니라 페이지로 연다 ────────────────
  /** 기본은 그려진 페이지, [소스] 로 ⑤ 편집창(병행). 어느 쪽인지는 탭마다 기억한다(한 벌이면 탭을 옮길 때 페이지로 돌아간다). 영속 ❌(⑦). */
  // ⑥ — 절대경로 탭(캔버스 파일 버블로 연 이 창의 루트 밖 파일)은 페이지로 그리지 않고 소스로 연다 — 페이지 창구(`workspaceSiteSrc`)는
  //   이 창의 루트 기준 상대 경로만 풀기 때문이다.
  const isHtml = activePath !== null && doc?.status === 'ready' && !doc.binary && isWorkspaceHtmlPath(activePath)
    && !isAbsoluteMediaPath(activePath);
  const [htmlSourceTabs, setHtmlSourceTabs] = useState<ReadonlySet<string>>(new Set<string>());
  const showHtmlSource = activePath !== null && htmlSourceTabs.has(activePath);
  const toggleHtmlSource = useCallback((): void => {
    if (activePath === null) return;
    setHtmlSourceTabs((prev) => {
      const next = new Set(prev);
      if (next.has(activePath)) next.delete(activePath);
      else next.add(activePath);
      return next;
    });
  }, [activePath]);
  // ⑬ (j) — 본문 경로 링크의 [웹(내부) 열기]. 소스로 돌려 둔 탭이어도 **페이지**를 보여 달라는 요청이다.
  useEffect(() => subscribeHtmlPageView((relPath) => {
    setHtmlSourceTabs((prev) => {
      if (!prev.has(relPath)) return prev;
      const next = new Set(prev);
      next.delete(relPath);
      return next;
    });
  }), []);

  /** 닫힌 탭의 보기 모드는 들고 있지 않는다 — 열려 있는 탭만 남긴다. */
  useEffect(() => {
    setHtmlSourceTabs((prev) => {
      if (prev.size === 0) return prev;
      const open = new Set(files.map((f) => f.relPath));
      const next = new Set([...prev].filter((k) => open.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  /** ⑮ (b) [바깥 브라우저] — .html 의 OS 연결 프로그램이 곧 기본 브라우저다(새 레일 ❌). */
  const handleOpenInBrowser = useCallback((): void => {
    if (active) void openExternally(active.absPath);
  }, [active]);
  // 메인 iframe 전환은 캔버스/IDE를 내린다. 다른 창·접힌 세션의 초안도 먼저 저장해야 한다.
  const hasUnsavedEditors = useGraphStore((s) => Object.values(s.ideOverlays).some((pane) => (
    pane.editorFiles.some((file) => file.dirty)
    || Object.values(pane.editorTabsBySession).some((scope) => scope.files.some((file) => file.dirty))
  )));
  const iframeNeedsSave = hasUnsavedEditors || Object.values(docs).some((item) => (
    item.saving || (item.status === 'ready' && isDirty(item.diskText, item.draft))
  ));
  // 별창은 메인 탭바가 없으므로 그곳에서는 메인 전용 동작을 노출하지 않는다.
  const shellParams = new URLSearchParams(window.location.hash.slice(1));
  const canOpenIframeTab = shellParams.get('detached') !== '1' && shellParams.get('overlay') !== '1';
  const handleOpenInIframe = useCallback((): void => {
    if (!isHtml || !rootPath || !active || iframeNeedsSave || !canOpenIframeTab) return;
    const store = useGraphStore.getState();
    const id = `workspace-site:${clientPathKey(active.absPath)}`;
    const url = workspaceSiteSrc(rootPath, active.relPath, doc?.mtimeMs ?? 0);
    store.openIframeTab({ id, url, label: active.name, serverKind: 'frontend', projectPath: rootPath });
    // 이미 열어 둔 탭도 이번에 저장된 파일 주소로 맞춘다.
    store.followIframeTab(id, url);
  }, [isHtml, rootPath, active, doc?.mtimeMs, iframeNeedsSave, canOpenIframeTab]);
  const pdfUrl = useMemo(
    () => (isPdf && rootPath !== null && activePath !== null ? workspaceMediaUrl(rootPath, activePath) : null),
    [isPdf, rootPath, activePath],
  );
  /** 맞춤(패널에 맞춰 축소) ↔ 원본 크기(1:1). 탭을 옮기면 기본(맞춤)으로 돌아온다. */
  const [imageFit, setImageFit] = useState(true);
  const [imageNatural, setImageNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setImageFit(true);
    setImageNatural(null);
  }, [activePath]);
  const imageBlob = useWorkspaceImage(
    isImage && rootPath ? rootPath : null,
    isImage ? activePath : null,
    doc?.mtimeMs ?? 0,
  );

  /** §5.5 #17-25 ④-1 — 라이트박스가 덮어쓴 파일의 새 `mtimeMs` 로 미리보기를 다시 그린다(같은 시각은 한 번만). */
  const imageReloadedAtRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!activePath || !imageFileKey || !imageSavedAt || imageReloadedAtRef.current[imageFileKey] === imageSavedAt) return;
    imageReloadedAtRef.current[imageFileKey] = imageSavedAt;
    reload(activePath);
  }, [activePath, imageFileKey, imageSavedAt, reload]);

  /** 그림을 누르거나 [편집]을 누르면 — #17-25 의 주석 팝업을 그대로 연다(새 편집기 ❌). */
  const handleOpenImageEditor = useCallback((): void => {
    if (!imageBlob.url || !rootPath || !activePath) return;
    openImageLightbox(imageBlob.url, lightboxOrigin(), undefined, {
      root: rootPath,
      path: activePath,
      mtimeMs: imageBlob.mtimeMs ?? doc?.mtimeMs ?? 0,
      revision: imageBlob.revision,
      bakeable: canOverwriteWorkspaceImage(activePath),
      mime: bakeMimeFor(activePath),
    });
  }, [imageBlob.url, imageBlob.mtimeMs, imageBlob.revision, rootPath, activePath, doc?.mtimeMs, openImageLightbox, lightboxOrigin]);

  // §5.5 #17-20 ⑩ — 줄 번호 칸이 곧 중단점 gutter.
  const projectName = useIDEPaneProjectName();
  const breakpoints = useGraphStore((s) => (projectName ? s.debugBreakpoints[projectName] : undefined));
  const toggleBreakpoint = useGraphStore((s) => s.toggleBreakpoint);
  const debugSessions = useDebugSessions((s) => s.sessions);
  const selectedFrame = useDebugSessions((s) => s.selectedFrame);

  /** 지금 열린 파일에 찍힌 줄들(다른 파일 것은 보지 않는다). */
  const breakpointLines = useMemo(() => {
    const set = new Set<number>();
    if (!activePath || !breakpoints) return set;
    for (const bp of breakpoints) if (bp.file === activePath && bp.enabled) set.add(bp.line);
    return set;
  }, [breakpoints, activePath]);

  /** 멈춰 선 줄 — 이 파일일 때만. 세션이 여럿이면 먼저 멈춘 것, 프레임은 콜스택에서 고른 것(없으면 맨 위). */
  const stoppedLine = useMemo(() => {
    if (!activePath || !rootPath) return null;
    for (const session of Object.values(debugSessions)) {
      if (session.status !== 'paused' || !session.frames || session.frames.length === 0) continue;
      const wanted = selectedFrame[session.sessionId];
      const frame = session.frames.find((f) => f.id === wanted) ?? session.frames[0];
      if (!frame?.file) continue;
      if (sameWorkspaceFile(frame.file, rootPath, activePath)) return frame.line;
    }
    return null;
  }, [debugSessions, selectedFrame, activePath, rootPath]);

  const handleToggleBreakpoint = useCallback(
    (line: number) => {
      if (!projectName || !activePath) return;
      toggleBreakpoint(projectName, activePath, line);
    },
    [projectName, activePath, toggleBreakpoint],
  );

  // 탭이 활성화되면 그때 읽는다(열어만 두고 안 본 탭은 디스크를 건드리지 않는다).
  //   ⑱ — 빈 탭은 파일이 아니다. 그 키로 디스크를 읽으러 가면 판에 "읽기 오류" 만 남는다.
  useEffect(() => {
    if (activePath && !openerKind) ensureLoaded(activePath);
  }, [activePath, openerKind, ensureLoaded]);

  // 저장할 것이 있는지를 탭 줄이 알아야 한다(점 표시 + 밀어내기 예외) → store 로 신고.
  useEffect(() => {
    if (!activePath || !doc) return;
    setDirty(activePath, doc.status === 'ready' && doc.draft !== doc.diskText);
  }, [activePath, doc, setDirty]);

  // ─── §5.5 #17-27 ⑪ [추종] — 편집 신호를 받아 다시 읽고 · 그 줄로 스크롤하고 · 잠깐 강조한다 ───
  const agentId = useIDEPaneValue((o) => o.agentId);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const sessionKey = followSessionKey(agentId ?? '', activeSessionId);
  const followOn = useGraphStore((s) => s.ideEditorFollow[sessionKey] === true);
  const setFollowOn = useGraphStore((s) => s.setIdeEditorFollow);
  const followSignal = useGraphStore((s) => s.ideEditorFollowSignal);
  const clearFollowSignal = useGraphStore((s) => s.clearIdeEditorFollowSignal);
  const setFollowLast = useGraphStore((s) => s.setIdeEditorFollowLast);
  const followMark = useGraphStore((s) => s.ideEditorFollowLast);
  /** 강조 중인 줄 범위(잠깐 뒤 사라진다). `focus` 는 ⑬ (g) 눌러 온 이동에만 선다 — 추종은 초점을 뺏지 않는다. */
  const [follow, setFollow] = useState<{ relPath: string; range: FollowRange; token: number; focus?: boolean } | null>(null);
  /** (h) ④ 잔상 — 강조가 꺼진 뒤에도 **다음 편집까지** 남는 "여기가 방금 바뀐 자리" 표시. */
  const [recent, setRecent] = useState<{ relPath: string; range: FollowRange } | null>(null);
  /** 이미 접수한 신호의 시각 — 같은 신호를 두 번 처리하지 않는다. */
  const followSeenRef = useRef(0);
  /**
   * 접수했지만 다시 읽기가 안 끝난 신호. `awaitReload` = 문서가 `loading` 으로 바뀌는 것을 먼저 보고 가라 —
   * 없으면 다시 읽기 전 옛 본문에서 줄을 찾아 엉뚱한 곳으로 스크롤한다.
   */
  const followPendingRef = useRef<
    { relPath: string; absPath: string; newString: string; token: number; awaitReload: boolean; reloaded: boolean } | null
  >(null);

  useEffect(() => {
    if (!followSignal || followSignal.at === followSeenRef.current) return;
    // (g) — 다른 세션이 낸 신호는 따르지 않는다. 세션을 옮긴 뒤 남은 신호이므로 그 자리에서 버린다.
    if (followSignal.sessionKey !== sessionKey) {
      clearFollowSignal();
      return;
    }
    // 탭 전환이 아직 반영되지 않았으면 다음 렌더에서 다시 본다(여는 쪽이 이미 활성 탭을 바꿔 놨다).
    if (followSignal.relPath !== activePath) return;
    followSeenRef.current = followSignal.at;

    const target = docs[followSignal.relPath];
    // #17-27 ⑪ (d) — 고치던 초안이 있으면 자동 다시 읽기를 건너뛴다(사용자가 친 글자를 절대 덮지 않는다).
    if (target && target.status === 'ready' && isDirty(target.diskText, target.draft)) {
      // (h) — 건너뛴 사실을 자국에 남긴다. 아무 말 없이 넘어가면 "왜 안 따라가지" 가 되고,
      //   그 답(초안을 지키려고)은 화면에 없으면 알 길이 없다.
      setFollowLast({
        sessionKey,
        relPath: followSignal.relPath,
        absPath: followSignal.absPath,
        name: splitRelPath(followSignal.relPath).name,
        startLine: null,
        endLine: null,
        reloaded: false,
        at: followSignal.at,
        skip: 'dirty',
      });
      clearFollowSignal();
      return;
    }
    // 이미 읽어 둔 탭만 다시 읽는다 — 방금 연 탭은 최초 읽기가 곧 최신 본문이다.
    const willReload = !!rootPath && !!target && target.status === 'ready';
    if (willReload) reload(followSignal.relPath);
    followPendingRef.current = {
      relPath: followSignal.relPath,
      absPath: followSignal.absPath,
      newString: followSignal.newString,
      token: followSignal.at,
      awaitReload: willReload,
      reloaded: willReload,
    };
  }, [followSignal, sessionKey, activePath, docs, reload, rootPath, clearFollowSignal, setFollowLast]);

  useEffect(() => {
    const pending = followPendingRef.current;
    if (!pending || pending.relPath !== activePath) return;
    const target = docs[pending.relPath];
    if (!target) return;
    if (pending.awaitReload) {
      // 다시 읽기가 시작된 것을 확인하고 물러선다 — 본문이 도착하면 이 효과가 한 번 더 돈다.
      if (target.status === 'loading') followPendingRef.current = { ...pending, awaitReload: false };
      return;
    }
    if (target.status === 'loading') return;
    followPendingRef.current = null;
    clearFollowSignal();
    if (target.status !== 'ready') return;
    // 새 글자를 본문에서 못 찾으면 열기만 하고 움직이지 않는다(엉뚱한 줄로 끌고 가지 않는다).
    const range = findEditedLineRange(target.diskText, pending.newString);
    if (range) {
      setFollow({ relPath: pending.relPath, range, token: pending.token });
      setRecent({ relPath: pending.relPath, range });
    }
    // (h) — 줄을 못 찾았어도 "무엇을 따라갔는지" 는 남긴다(파일만 열렸다는 사실도 정보다).
    setFollowLast({
      sessionKey,
      relPath: pending.relPath,
      absPath: pending.absPath,
      name: splitRelPath(pending.relPath).name,
      startLine: range?.start ?? null,
      endLine: range?.end ?? null,
      reloaded: pending.reloaded,
      at: pending.token,
      // 줄을 못 찾았으면 **열기만 했다**는 뜻 — 띠가 그렇게 말해야 사용자가 스크롤을 기다리지 않는다.
      skip: range ? null : 'no-line',
    });
  }, [docs, activePath, sessionKey, clearFollowSignal, setFollowLast]);

  // 강조는 한 번 보여 주고 걷는다 — 남겨 두면 다음에 그 파일을 열 때까지 파란 띠가 붙어 있다.
  //   (잔상 `recent` 는 남는다 — 그건 "방금 바뀐 자리" 를 알려 주는 옅은 표시라 시야를 가리지 않는다.)
  useEffect(() => {
    if (!follow) return;
    const timer = window.setTimeout(() => setFollow(null), FOLLOW_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [follow]);

  // ─── §5.5 #17-27 ⑬ (g) — 줄을 들고 온 열기: 그 줄로 · 캐럿 · 강조 · 칠하기 ───────────────
  /**
   * 본문 링크·오류 줄(#17-20 ⑪)의 줄 범위 요청 — 이 창의 것만 받는다(옆 창이 가로채면 엉뚱한 창이 스크롤).
   * 추종과 같은 길이되 캐럿·초점(`focus`)·칠하기(`mark`)까지 하고 추종의 자국·잔상은 남기지 않는다.
   */
  const ownPaneKey = useIDEPaneValue((o) => o.paneKey);
  const reveal = useGraphStore((s) => (s.ideEditorReveal?.paneKey === ownPaneKey ? s.ideEditorReveal : null));
  const clearReveal = useGraphStore((s) => s.clearIdeEditorReveal);
  /** 칠해 둔 범위 — 그 탭의 본문이 **칠할 때 그대로**인 동안만 산다(`draft` 로 대조한다). */
  const [mark, setMark] = useState<{ relPath: string; range: FollowRange; draft: string } | null>(null);

  useEffect(() => {
    if (!reveal) return;
    // 그 사이 다른 탭으로 옮겼으면 낡은 요청이다 — 나중에 그 탭으로 돌아왔을 때 끌려가지 않게 버린다.
    if (reveal.relPath !== activePath) {
      clearReveal(reveal.at);
      return;
    }
    const target = docs[reveal.relPath];
    // 아직 읽는 중이면 기다린다 — 본문이 오면 이 효과가 다시 돈다(탭이 서면 `ensureLoaded` 가 읽기를 시작한다).
    if (!target || target.status === 'loading') return;
    clearReveal(reveal.at);
    // 줄이 없는 것(그림·이진)과 못 읽은 것은 열기만 한다.
    if (target.status !== 'ready' || target.binary || target.image) return;
    // 파일 끝을 넘는 끝 줄은 자르고, 첫 줄부터 넘으면 움직이지 않는다(⑪ (c) — 엉뚱한 줄로 끌고 가지 않는다).
    const range = clampLineRange(reveal, countTextLines(target.draft));
    if (!range) return;
    // ⑮ 페이지에는 줄이 없다 — HTML 은 [소스] 로 돌려 그 줄을 보여 준다(탭마다의 보기 상태).
    if (isWorkspaceHtmlPath(reveal.relPath)) {
      setHtmlSourceTabs((prev) => (prev.has(reveal.relPath) ? prev : new Set(prev).add(reveal.relPath)));
    }
    setFollow({ relPath: reveal.relPath, range, token: reveal.at, focus: true });
    setMark({ relPath: reveal.relPath, range, draft: target.draft });
  }, [reveal, activePath, docs, clearReveal]);

  // 칠은 본문이 그대로인 동안만 — 고치거나 다시 읽어 내용이 달라지면 그 줄 번호가 그 자리를 가리킨다고
  //   장담할 수 없다. 탭을 닫아 문서가 내려가도 걷힌다.
  useEffect(() => {
    if (!mark) return;
    const d = docs[mark.relPath];
    if (!d || d.status !== 'ready' || d.draft !== mark.draft) setMark(null);
  }, [mark, docs]);

  const followRange = follow && follow.relPath === activePath ? follow.range : null;
  const followFocus = !!follow?.focus && follow.relPath === activePath;
  const markRange = mark && mark.relPath === activePath ? mark.range : null;
  const recentRange = recent && recent.relPath === activePath ? recent.range : null;
  /** 추종 띠에 적을 자국 — 이 세션의 것만(옆 세션이 따라간 것을 여기 적으면 세션 격리가 무너져 보인다). */
  const bannerMark = followMark && followMark.sessionKey === sessionKey ? followMark : null;
  /** (h) — 끝까지 못 간 사유. 있으면 띠가 파란색이 아니라 호박색으로, 한 일 대신 **왜 안 했는지**를 말한다. */
  const bannerSkip = bannerMark?.skip ?? null;

  // ⑥ 루트 밖 파일(캔버스에서 연 프로젝트 밖 파일)은 보기만 한다 — 쓰기는 루트 안만이다.
  const readOnly = !doc || doc.status !== 'ready' || doc.truncated || doc.binary || doc.outside;
  const dirty = !!doc && doc.status === 'ready' && doc.draft !== doc.diskText;

  const handleChange = useCallback((next: string): void => {
    if (activePath) setDraft(activePath, next);
  }, [activePath, setDraft]);

  const handleSave = useCallback((force = false): void => {
    if (activePath) save(activePath, { force });
  }, [activePath, save]);

  // 저장 버튼 툴팁의 키 — §6 레지스트리의 지금 값이다(재매핑하면 툴팁도 따라 바뀐다).
  //   해제하면 괄호가 빈 채로 남으므로 키 없는 라벨로 갈아탄다.
  const saveKeyLabel = useBindingLabel('editor.save');
  const saveTitle = saveKeyLabel
    ? t('ide.editor.save', { shortcut: saveKeyLabel })
    : t('ide.editor.ctx.save');

  /** §5.5 #17-27 ⑫ — 읽기 전용 잠금을 풀고 저장(Perforce 등). 충돌 대조는 그대로 — 잠김을 이유로 남의 편집을 덮지 않는다. */
  const handleUnlockSave = useCallback((): void => {
    if (activePath) save(activePath, { clearReadOnly: true });
  }, [activePath, save]);

  /** 탭 닫기 공통 — 저장할 탭이 있으면 한 번만 묻는다(③). 여러 탭 닫기 메뉴도 이 문을 지난다. */
  const closeTabs = useCallback(async (relPaths: string[]): Promise<boolean> => {
    if (closePending.current) return false;
    if (relPaths.length === 0) return true;
    closePending.current = true;
    try {
      const unsaved = relPaths.filter((p) => {
        const d = docs[p];
        return !!d && d.status === 'ready' && d.draft !== d.diskText;
      });
      if (unsaved.length > 0) {
        const message = unsaved.length === 1
          ? t('ide.editor.closeDirtyConfirm')
          : t('ide.editor.closeDirtyConfirmMany', { count: unsaved.length });
        if (!await confirmDialog(message, {
          title: t('panel.options.discardTitle'),
          confirmLabel: t('panel.options.discardLeave'),
          cancelLabel: t('panel.options.discardKeep'),
          tone: 'danger',
        })) return false;
      }
      const current = closeStateRef.current;
      if (!mountedRef.current || current.scope !== editorScope) return false;
      // 팝업을 기다리는 사이 바뀐 초안은 이전 닫기 확인으로 버리지 않는다.
      if (relPaths.some((p) => {
        const latest = current.docs[p];
        return latest?.status === 'ready' && latest.draft !== latest.diskText
          && (!unsaved.includes(p) || latest.draft !== docs[p]?.draft);
      })) return false;
      for (const p of relPaths) {
        const original = files.find((file) => file.relPath === p);
        if (!current.files.some((file) => file.relPath === p && file.absPath === original?.absPath)) continue;
        drop(p);
        closeFile(p);
      }
      return true;
    } finally {
      closePending.current = false;
    }
  }, [docs, files, editorScope, drop, closeFile, t]);

  const handleCloseTab = useCallback((relPath: string): void => {
    void closeTabs([relPath]);
  }, [closeTabs]);

  /** [판 닫기] — 무대까지 전부 내린다(㉔ — 파일만 닫으면 무대만 남아 헛버튼이 된다). */
  const handleCloseAll = useCallback(async (): Promise<void> => {
    if (!await closeTabs(files.map((f) => f.relPath))) return;
    if (!mountedRef.current || closeStateRef.current.scope !== editorScope) return;
    if (stageOpen) setStageOpen(false);
  }, [closeTabs, files, editorScope, stageOpen, setStageOpen]);

  const handleOpenExternal = useCallback((): void => {
    if (active) openFileByPath(active.absPath, active.relPath);
  }, [active]);

  /** 손잡이 줄 경로 — 상대 경로가 아닌 실제 전체 경로(이 줄이 곧 폴더를 여는 손잡이). */
  const fullPath = active?.absPath ?? activePath ?? '';
  const pathParts = useMemo(() => splitPathTail(fullPath), [fullPath]);

  /** §5.5 #17-27 ⑩ — 경로를 누르면 그 파일이 든 폴더가 시스템 탐색기에서 열린다(기존 열기 경로 재사용). */
  const handleOpenFolder = useCallback((): void => {
    if (active) openFolderByPath(active.absPath, active.relPath);
  }, [active]);

  // §5.5 #17-27 ⑨ — 우클릭 메뉴 3종.
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const copyText = useCallback((text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => { /* 클립보드 거부는 조용히 무시 */ });
  }, []);

  /** (a) 본문 — 편집 조작은 `CodeEditor` 가 넘겨 준 것을 그대로 쓰고, 저장·경로 같은 것만 여기서 얹는다. */
  const buildBodyMenu = useCallback((ctx: CodeEditorBodyMenuContext): ContextMenuItem[] => (
    buildBodyMenuItems(
      {
        hasSelection: ctx.hasSelection,
        readOnly,
        dirty,
        canLineComment: ctx.canLineComment,
        canBlockComment: ctx.canBlockComment,
      },
      {
        ...ctx.actions,
        save: () => handleSave(),
        reload: () => { if (activePath) reload(activePath); },
        copyPath: () => { if (active) copyText(active.absPath); },
        copyLineRef: () => { if (activePath) copyText(`${activePath}:${ctx.line}`); },
        openExternal: handleOpenExternal,
        // §5.5 #17-3 (판올림 번호 발급 대기) — 편집창에서 고른 글자도 같은 함수로 검색한다.
        searchWeb: () => { openWebSearch(ctx.selectedText); },
      },
      t,
    )
  ), [readOnly, dirty, handleSave, reload, activePath, active, copyText, handleOpenExternal, t]);

  /** (b) 줄 번호 칸 — 왼쪽 클릭이 하던 중단점 토글에 이름을 붙이고, 줄을 집어 가는 두 가지를 더한다. */
  const buildGutterMenu = useCallback((line: number, lineText: string): ContextMenuItem[] => (
    buildGutterMenuItems(
      {
        line,
        hasBreakpoint: breakpointLines.has(line),
        hasAnyBreakpoint: breakpointLines.size > 0,
        canBreakpoint: !!projectName && !!activePath,
      },
      {
        toggleBreakpoint: () => handleToggleBreakpoint(line),
        clearFileBreakpoints: () => {
          if (projectName && activePath) clearBreakpointsInFile(projectName, activePath);
        },
        copyLine: () => copyText(lineText),
        copyLineRef: () => { if (activePath) copyText(`${activePath}:${line}`); },
      },
      t,
    )
  ), [breakpointLines, projectName, activePath, handleToggleBreakpoint, clearBreakpointsInFile, copyText, t]);

  /** (c) 탭 — 누른 그 탭이 대상이다(활성 탭이 아닐 수도 있다). */
  const handleTabContextMenu = useCallback((e: React.MouseEvent, relPath: string): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = files.find((f) => f.relPath === relPath);
    if (!target) return;
    setTabMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildTabMenuItems(
        // ⑱ — 빈 탭에는 경로가 없다(경로 복사·밖에서 열기 줄을 세우지 않는다).
        { hasOthers: files.length > 1, isFile: target.opener === undefined },
        {
          close: () => handleCloseTab(relPath),
          closeOthers: () => closeTabs(files.filter((f) => f.relPath !== relPath).map((f) => f.relPath)),
          closeAll: handleCloseAll,
          copyPath: () => copyText(target.absPath),
          openExternal: () => openFileByPath(target.absPath, target.relPath),
        },
        t,
      ),
    });
  }, [files, handleCloseTab, closeTabs, handleCloseAll, copyText, t]);

  // ─── 좌측 손잡이 드래그 — 왼쪽으로 끌면 넓어진다(패널이 오른쪽에 붙어 있으므로) ──────────
  /**
   * 폭 끌기: ⓐ 캡처는 손잡이에(`setPointerCapture`) — `window` mousemove 면 커서가 미리보기 iframe 위로 가는 순간 드래그가 멎는다.
   * ⓑ 끄는 동안 스토어를 안 건드리고 손을 뗄 때 한 번 저장한다(`setIdeEditorWidth` 는 `localStorage` 동기 쓰기).
   * ⓒ 끄는 동안 폭은 DOM 에 직접(rAF 당 한 번) 쓰고, 리렌더 때 `style` 은 같은 값을 든 ref 를 읽는다.
   */
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<EditorResizeDrag | null>(null);
  /** 끄는 동안의 폭 — 렌더도 이 값을 읽어, 도중에 리렌더가 나도 옛 폭으로 되돌아가지 않는다. */
  const liveWidthRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  /** 끄는 중인가 — 커서·글자선택 잠금과 본문 손짓 차단에만 쓴다(폭은 위 ref 가 나른다). */
  const [resizing, setResizing] = useState(false);

  const applyLiveWidth = useCallback((): void => {
    rafRef.current = null;
    const el = shellRef.current;
    const w = liveWidthRef.current;
    if (el && w !== null) el.style.width = `${String(w)}px`;
  }, []);

  const handleResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    // 오른쪽·가운데 버튼으로는 크기를 조절하지 않는다(우클릭이 드래그로 둔갑하던 자리).
    if (e.button !== 0) return;
    e.preventDefault();
    // 캡처는 **손잡이 엘리먼트 자신**에 건다 — `e.target` 은 캡처 중에 바뀔 수 있다.
    e.currentTarget.setPointerCapture(e.pointerId);
    // 상한은 **이 창에서 대화 하한을 지키는 폭**이다. 없으면 손잡이는 계속 끌리는데 화면은
    //   안 넓어지는(판정이 다시 잘라내는) 상태가 되어 "고장난 손잡이"로 읽힌다.
    //   시작할 때 한 번 붙잡아 둔다 — 끄는 동안 창 폭·사이드바는 바뀌지 않는다.
    dragRef.current = { startX: e.clientX, startWidth: width, max: editorMaxWidth };
    liveWidthRef.current = width;
    setResizing(true);
  }, [width, editorMaxWidth]);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = dragEditorWidth(drag, e.clientX);
    if (next === liveWidthRef.current) return;
    liveWidthRef.current = next;
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(applyLiveWidth);
  }, [applyLiveWidth]);

  const handleResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragRef.current === null) return;
    dragRef.current = null;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const final = liveWidthRef.current;
    liveWidthRef.current = null;
    setResizing(false);
    // 저장(= localStorage 쓰기)은 여기 한 번뿐. 이 줄이 끝나면 React 가 같은 폭으로 다시 그리므로
    //   드래그 중 DOM 에 직접 쓴 값과 어긋나지 않는다.
    if (final !== null) setWidth(final);
  }, [setWidth]);

  /** 끄는 동안 글자 선택·커서 바뀜을 막는다(분할 손잡이 ⑪ (b) 와 같은 처리). */
  useEffect(() => {
    if (!resizing) return;
    const { body } = document;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = 'col-resize';
    body.style.userSelect = 'none';
    return () => {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  /** 창이 사라지는데 rAF 가 남아 있으면 언마운트된 노드에 쓴다. */
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // 파일·무대가 없어도 실행 출력이 열리면 오른쪽 자리를 만든다.
  if (!paneShown && !runOutput) return null;

  // 덮개로 뜰 때도 **활동바까지 먹지는 않는다** — 활동바가 아직 자리에 서 있는 폭(창만 좁힌
  //   데스크톱)에서 `inset-0` 으로 덮으면 사이드바를 되부를 유일한 손잡이가 가려진다. 활동바가
  //   함께 서랍인 폰에서는 종전대로 화면 전체를 덮는다.
  const shellBase = narrow
    ? `absolute inset-y-0 right-0 z-20 flex flex-col border-l border-gray-700 bg-gray-950 ${navDrawer ? 'left-0' : 'left-12'}`
    : 'relative flex flex-shrink-0 flex-col border-l border-gray-700 bg-gray-950';
  // 끄는 동안에는 **이 패널 안의 iframe 만** 손짓을 받지 않는다(미리보기 HTML·PDF). 포인터 캡처가
  //   이미 막지만 iframe 은 별도 문서라, 캡처가 걷히는 어떤 찰나에도 커서를 뺏기지 않게 한 겹 더 둔다.
  //   본문 전체가 아니라 iframe 만 끊으므로 편집·선택 같은 나머지 동작에는 영향이 없다.
  const shellClass = resizing ? `${shellBase} [&_iframe]:pointer-events-none` : shellBase;

  return (
    <div
      ref={shellRef}
      // §5.5 #17-19 ⑧ — 끌어온 파일의 "오른쪽 자리" 판정이 이 패널의 실제 변을 쓴다(보이는 경계와
      //   판정 경계가 어긋나면 사용자는 늘 틀린 쪽에 놓는다). 표식은 읽기 전용이라 동작에 영향 ❌.
      data-ide-editor-pane=""
      className={shellClass}
      // 끄는 동안에는 rAF 가 DOM 에 직접 쓴 폭이 진실이다 — 그 사이 다른 이유로 리렌더가 나도
      //   같은 값을 다시 써서 화면이 옛 폭으로 튀지 않게 한다.
      style={narrow ? undefined : { width: liveWidthRef.current ?? width }}
    >
      {!narrow && (
        <div
          className={`absolute inset-y-0 left-0 z-10 w-1 transition-colors ${
            resizing ? 'bg-blue-400/70' : 'hover:bg-blue-400/60'
          }`}
        >
          {/* 보이는 띠는 바깥 4px, **잡히는 띠**는 이 절대배치 자식이다 — 대화 쪽으로 8px 더
              나가고 본문 쪽으로는 2px 만 나간다(줄 번호·중단점 자리를 가리지 않게). */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('ide.editor.resize')}
            title={t('ide.editor.resize')}
            onPointerDown={handleResizeDown}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            onPointerCancel={handleResizeUp}
            // 캡처를 잃으면(브라우저가 걷어가는 경우) 조용히 멎는 대신 정상 종료로 접는다 —
            //   안 그러면 `body` 의 커서 잠금이 화면에 남는다.
            onLostPointerCapture={handleResizeUp}
            className="absolute inset-y-0 cursor-col-resize touch-none"
            style={{ left: -RESIZE_HIT_PAD.OUT, right: -RESIZE_HIT_PAD.IN }}
          />
        </div>
      )}

      {runOutput}
      {/* 출력에서 돌아올 때 초안·웹 페이지가 유지되도록 기존 내용은 마운트한 채 숨긴다. */}
      <div className={runOutput ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      {/* ⑰ 최대화 중에는 탭 줄이 걷힌다. 조건부로 빼도 뒤따르는 본문(편집기·iframe)은 같은 자리의
          같은 노드라 다시 그려지지 않는다 — 보던 페이지·커서·되돌리기 기록이 그대로다. */}
      {!maximized && (
      <IDEEditorTabs
        files={files}
        labels={labels}
        activePath={activePath ?? ''}
        onSelect={setActive}
        onClose={handleCloseTab}
        onCloseAll={handleCloseAll}
        onTabContextMenu={handleTabContextMenu}
        pinned={tabsPinned}
        onTogglePinned={toggleTabsPinned}
        // ㉔ — 무대 탭. 고르는 것은 "활성 파일을 비우는 것"이고, 닫는 것은 무대 자체를 내리는 것이다
        //   (닫으면 스토어가 남은 파일 중 첫 것으로 되돌린다 — 판이 빈 채로 서 있지 않게).
        stageTab={stageOpen ? {
          active: stageActive,
          label: t('ide.stage.title'),
          onSelect: () => setActive(null),
          onClose: () => setStageOpen(false),
        } : undefined}
        onMaximize={handleMaximize}
      />
      )}

      {/* §5.5 #17-27 ⑪ (h) ③ — 추종 띠: 켜진 동안 방금 한 일(자동 다시 읽기까지)을 말한다. ㉔ 무대 탭에는 안 선다(문구가 파일 얘기다). */}
      {!maximized && !stageActive && !openerKind && followOn && (
        <div className={`flex items-center gap-1.5 border-b px-2 py-1 text-[12px] ${
          bannerSkip
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200/90'
            : 'border-blue-500/30 bg-blue-500/10 text-blue-200/90'
        }`}
        >
          {bannerSkip ? (
            <svg
              className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
            </span>
          )}
          <span className="flex-shrink-0 font-medium">{t('ide.follow.labelOn')}</span>
          <span className={`min-w-0 flex-1 truncate ${bannerSkip ? 'text-amber-200/80' : 'text-blue-200/70'}`}>
            {/* 못 따라간 경우가 먼저다 — 사용자가 알아야 할 것은 "무엇을 했다" 가 아니라 "왜 안 했다" 이다. */}
            {bannerSkip
              ? t(FOLLOW_SKIP_KEYS[bannerSkip], { name: bannerMark?.name ?? '' })
              : (bannerMark
                ? (bannerMark.startLine !== null
                  ? t(bannerMark.reloaded ? 'ide.follow.bannerChangedReloaded' : 'ide.follow.bannerChanged', {
                    name: bannerMark.name,
                    from: bannerMark.startLine,
                    to: bannerMark.endLine ?? bannerMark.startLine,
                  })
                  : t('ide.follow.bannerOpened', { name: bannerMark.name }))
                : t('ide.follow.bannerIdle'))}
          </span>
          <button
            type="button"
            onClick={() => setFollowOn(sessionKey, false)}
            className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[12px] transition-colors ${
              bannerSkip
                ? 'border-amber-400/40 hover:bg-amber-500/20'
                : 'border-blue-400/40 hover:bg-blue-500/20'
            }`}
          >
            {t('ide.follow.stop')}
          </button>
        </div>
      )}

      {/* 손잡이 줄 — 전체 경로(누르면 폴더) + 저장·다시 읽기·밖에서 열기. ⑰ 최대화 중엔 걷힌다.
         ㉔ 무대·⑱ 빈 탭에는 안 선다 — 그쪽이 같은 높이·톤의 자기 머리 줄을 세운다(탭을 옮겨도 줄이 안 튄다). */}
      {!maximized && !stageActive && !openerKind && (
      <div className="flex items-center gap-1 border-b border-gray-800 bg-gray-900/60 px-1.5 py-1">
        <button
          type="button"
          onClick={handleOpenFolder}
          title={t('ide.editor.openFolder', { path: fullPath })}
          aria-label={t('ide.editor.openFolder', { path: fullPath })}
          className="flex min-w-0 flex-1 items-center overflow-hidden text-left text-[12px] text-gray-500 transition-colors hover:text-blue-300 hover:underline"
        >
          <span className="truncate">{pathParts.head}</span>
          <span className="flex-shrink-0">{pathParts.tail}</span>
        </button>
        {doc?.status === 'ready' && (
          <span className="flex-shrink-0 text-[12px] uppercase tracking-wide text-gray-600">
            {/* ⑭ 이미지에는 언어도 줄바꿈도 뜻이 없다 — 그 자리에 픽셀 크기와 파일 크기를 적는다. */}
            {isImage
              ? imageMetaLabel(imageNatural, doc.size)
              : `${language === 'plain' ? t('ide.editor.plainLanguage') : language} · ${doc.eol.toUpperCase()}`}
          </span>
        )}
        {/* ⑱ (e) [파일 열기] — 우측에 뜬 보기는 기본으로 파일을 연다. 같은 갈래의 빈 탭이 지금 탭 바로
            오른쪽에 서서 고르기가 열린다(보던 파일은 닫히지 않는다). 판에 오는 갈래일 때만 선다. */}
        {activeFileKind && (
          <button
            type="button"
            onClick={handleOpenAnother}
            title={t('ide.editor.openFileHint')}
            aria-label={t('ide.editor.openFile')}
            className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-sky-300"
          >
            <OpenFileGlyph />
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={!dirty || doc?.saving}
          title={saveTitle}
          aria-label={saveTitle}
          className={`rounded p-0.5 transition-colors hover:bg-gray-800 disabled:opacity-30 ${dirty ? 'text-emerald-400' : 'text-gray-500'}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => activePath && reload(activePath)}
          title={t('ide.editor.reload')}
          aria-label={t('ide.editor.reload')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleOpenExternal}
          title={t('ide.explorer.openFile')}
          aria-label={t('ide.explorer.openFile')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-blue-300"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
        {/* ⑮ HTML 일 때만 서는 손잡이 — 그려진 페이지 ↔ 태그 원문. 기본은 페이지다. */}
        {isHtml && canOpenIframeTab && (
          <button
            type="button"
            onClick={handleOpenInIframe}
            disabled={!rootPath || iframeNeedsSave}
            title={t(iframeNeedsSave ? 'ide.editor.html.openIframeSaveFirst' : 'ide.editor.html.openIframeHint')}
            aria-label={t('ide.editor.html.openIframe')}
            className="flex flex-shrink-0 items-center gap-1 rounded border border-sky-400/40 px-1.5 py-0.5 text-[12px] text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 9v12" />
            </svg>
            {t('ide.editor.html.openIframe')}
          </button>
        )}
        {isHtml && (
          <button
            type="button"
            onClick={toggleHtmlSource}
            title={t(showHtmlSource ? 'ide.editor.html.viewPageHint' : 'ide.editor.html.viewSourceHint')}
            className="flex flex-shrink-0 items-center gap-1 rounded border border-sky-400/40 px-1.5 py-0.5 text-[12px] text-sky-300 transition-colors hover:bg-sky-500/20"
          >
            {showHtmlSource ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            )}
            {t(showHtmlSource ? 'ide.editor.html.viewPage' : 'ide.editor.html.viewSource')}
          </button>
        )}
        {/* ⑭ 이미지일 때만 서는 두 손잡이 — 보는 배율과, #17-25 주석 팝업으로 가는 문. */}
        {isImage && (
          <button
            type="button"
            onClick={() => setImageFit((v) => !v)}
            title={t(imageFit ? 'ide.editor.imageActualSize' : 'ide.editor.imageFit')}
            aria-label={t(imageFit ? 'ide.editor.imageActualSize' : 'ide.editor.imageFit')}
            className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            {imageFit ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}
        {isImage && (
          <button
            type="button"
            onClick={handleOpenImageEditor}
            disabled={!imageBlob.url}
            title={t('ide.editor.imageEditHint')}
            className="flex flex-shrink-0 items-center gap-1 rounded border border-blue-400/40 px-1.5 py-0.5 text-[12px] text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            {t('ide.editor.imageEdit')}
          </button>
        )}
      </div>
      )}

      {/* 알림 줄 — 충돌 / 읽기 전용 / 저장 실패는 본문 위에 그대로 적는다(조용히 삼키지 않는다).
          무대 탭에서는 `doc` 이 없으므로 이 줄들은 저절로 서지 않는다(조건을 따로 달 필요가 없다). */}
      {doc?.conflict && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200">
          <span className="min-w-0 flex-1">{t('ide.editor.conflict')}</span>
          <button
            type="button"
            onClick={() => activePath && reload(activePath)}
            className="flex-shrink-0 rounded border border-amber-400/40 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-amber-500/20"
          >
            {t('ide.editor.conflictReload')}
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            className="flex-shrink-0 rounded border border-amber-400/40 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-amber-500/20"
          >
            {t('ide.editor.conflictOverwrite')}
          </button>
        </div>
      )}
      {doc?.saveError && (
        <div className="flex items-center gap-2 border-b border-red-500/40 bg-red-500/10 px-2 py-1 text-[12px] text-red-200">
          <span className="min-w-0 flex-1">{t(`ide.editor.saveError.${doc.saveError}`)}</span>
          {/* ⑫ 잠긴 파일 — 실패를 알리는 그 자리에서 바로 풀 수 있게 한다(다른 창으로 나가지 않는다). */}
          {doc.saveError === 'readonly' && (
            <button
              type="button"
              onClick={handleUnlockSave}
              disabled={doc.saving}
              title={t('ide.editor.readOnlyUnlockHint')}
              className="flex flex-shrink-0 items-center gap-1 rounded border border-red-400/40 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-red-500/20 disabled:opacity-40"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
              {t('ide.editor.readOnlyUnlock')}
            </button>
          )}
        </div>
      )}
      {/* ⑥ 바깥 띠 — 캔버스에서 연 프로젝트 밖 파일은 보기만 한다. 풀 손잡이가 없다(⑫ 잠금과 다르다 — 쓰기는 루트 안만이다). */}
      {doc?.status === 'ready' && doc.outside && !doc.binary && (
        <div className="flex items-center gap-2 border-b border-gray-700 bg-gray-800/60 px-2 py-1 text-[12px] text-gray-400">
          <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="min-w-0 flex-1">{t('ide.editor.outsideReadOnly')}</span>
        </div>
      )}
      {/* ⑫ 잠금 띠 — 열자마자 "이 파일은 디스크가 잠갔다"를 말한다(타이핑은 막지 않는다). */}
      {doc?.status === 'ready' && doc.readOnly && !doc.outside && !doc.binary && !doc.truncated && !doc.saveError && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200">
          <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="min-w-0 flex-1">{t('ide.editor.readOnlyLocked')}</span>
          <button
            type="button"
            onClick={handleUnlockSave}
            disabled={doc.saving}
            title={t('ide.editor.readOnlyUnlockHint')}
            className="flex-shrink-0 rounded border border-amber-400/40 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-amber-500/20 disabled:opacity-40"
          >
            {t('ide.editor.readOnlyUnlock')}
          </button>
        </div>
      )}
      {doc?.status === 'ready' && !doc.image && !isPdf && !(isHtml && !showHtmlSource) && (doc.truncated || doc.binary) && (
        <div className="border-b border-gray-700 bg-gray-800/60 px-2 py-1 text-[12px] text-gray-400">
          {doc.binary ? t('ide.editor.binary') : t('ide.editor.truncated')}
        </div>
      )}

      {/* 본문 */}
      {stageActive ? (
        /* ㉔ — 무대 탭의 몸통. 파일 본문과 **같은 자리**를 쓴다(형제로 서면 판이 둘로 갈린다). */
        <IDEStageView cornerReserved={maximized} />
      ) : openerKind && activePath ? (
        /* ⑱ (d) — 빈 탭의 몸통 = 그 갈래의 파일 고르기. 고르면 이 탭이 같은 자리에서 그 파일 탭이 된다.
           키를 갈래마다 다르게 주어, 갈래를 옮기면 검색어·커서가 새로 선다. */
        <IDEPaneOpener key={activePath} kind={openerKind} openerKey={activePath} />
      ) : !doc || doc.status === 'loading' ? (
        <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.loading')}</p>
      ) : doc.status === 'error' ? (
        <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.editor.readError')}</p>
      ) : isPdf ? (
        /** §5.13 (R) — PDF 는 Chromium 내장 뷰어로(렌더 코드 ❌). 창 설정 `plugins` 가 켜져 있어야 열람·검색·인쇄가 붙는다. */
        <iframe
          key={activePath}
          src={pdfUrl ?? ''}
          title={activePath ?? 'pdf'}
          className="min-h-0 flex-1 border-0 bg-gray-900"
        />
      ) : isImage ? (
        <IDEImagePreview
          url={imageBlob.url}
          status={imageBlob.status}
          fit={imageFit}
          onNatural={setImageNatural}
          onOpen={handleOpenImageEditor}
        />
      ) : isHtml && !showHtmlSource && rootPath !== null && activePath !== null ? (
        /** §5.5 #17-27 ⑮ — HTML 은 그려진 페이지로(렌더는 Chromium — §5.13 (R) 과 같은 판단). 원문은 [소스] → ⑤ 편집창. */
        <IDEHtmlPreview
          key={activePath}
          root={rootPath}
          relPath={activePath}
          mtimeMs={doc.mtimeMs ?? 0}
          onOpenExternal={handleOpenInBrowser}
          barHidden={maximized}
        />
      ) : (
        <CodeEditor
          key={activePath}
          viewStateRef={editorViewStateRef}
          text={doc.draft}
          language={language}
          readOnly={readOnly}
          onChange={handleChange}
          onSave={() => handleSave()}
          breakpointLines={breakpointLines}
          onToggleBreakpoint={projectName ? handleToggleBreakpoint : undefined}
          stoppedLine={stoppedLine}
          toggleBreakpointTitle={t('ide.debug.toggleBreakpoint')}
          buildBodyMenu={buildBodyMenu}
          buildGutterMenu={buildGutterMenu}
          followRange={followRange}
          followToken={follow?.token ?? 0}
          recentRange={recentRange}
          followFocus={followFocus}
          markRange={markRange}
          comments={comments}
          findMemoryRef={findMemoryRef}
        />
      )}

      {/* §5.5 #17-27 ⑨ — 탭 우클릭 메뉴(본문·줄 번호 메뉴는 `CodeEditor` 가 자기 자리에서 띄운다). */}
      {tabMenu && (
        <IDEContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenu.items} onClose={() => setTabMenu(null)} />
      )}

      </div>
      {/* ⑰ [원래대로] — 구석에 숨었다가 마우스가 오면 뜬다. 구석은 본문 위 작은 층이 잡는다(iframe 위 움직임은 판이 못 받는다).
         층은 본문을 감추는 겹 밖에 둔다 — 안이면 실행 출력이 뜰 때 함께 `hidden` 이 되어 최대화를 못 푼다. */}
      {maximized && !runOutput && (
        <div className="group/restore absolute right-0 top-0 z-30 flex h-9 w-14 items-start justify-end p-1">
          <button
            type="button"
            onClick={handleRestore}
            title={t('ide.editor.restorePane')}
            aria-label={t('ide.editor.restorePane')}
            // 터치에는 구석을 훑는 hover 가 없다 — 가라앉으면 최대화를 푸는 길이 사라지므로 늘 떠 있고 손가락 크기로 선다.
            className={`flex items-center justify-center rounded-md border border-gray-700 bg-gray-900/90 p-1 text-gray-300 shadow-lg shadow-black/40 backdrop-blur-sm transition-all duration-200 ease-out hover:bg-gray-800 hover:text-white focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/restore:translate-y-0 group-hover/restore:opacity-100 pointer-coarse:translate-y-0 pointer-coarse:p-2 pointer-coarse:opacity-100 ${
              restoreHint ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
            }`}
          >
            {/* 네 모서리가 안으로 접힌 그림(lucide `minimize`) — [최대화] 그림의 짝. */}
            <svg
              className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
});
