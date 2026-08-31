import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneProjectName, useIDEPaneActions } from './idePane.js';
import { CodeEditor, type FollowRange } from './CodeEditor.js';
import { languageFromPath } from './codeLanguages.js';
import { FOLLOW_SKIP_KEYS, findEditedLineRange, followSessionKey } from './editorFollow.js';
import { isDirty, splitPathTail, tabLabels } from './editorModel.js';
import { splitRelPath } from './explorerModel.js';
import { useEditorDocs } from './useEditorDocs.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { openFileByPath, openFolderByPath } from './useWorkspaceExplorer.js';
import { workspaceMediaUrl } from '../../utils/workspaceMedia.js';
import { isWorkspaceHtmlPath } from '@vibisual/shared';
import { IDEEditorTabs } from './IDEEditorTabs.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { buildBodyMenuItems, buildGutterMenuItems, buildTabMenuItems } from './editorContextMenu.js';
import { openWebSearch } from './webSearchUrl.js';
import type { CodeEditorBodyMenuContext } from './CodeEditor.js';
import { useDebugSessions } from '../../stores/debugSessions.js';
import { sameWorkspaceFile } from './debugPaths.js';
import { IDEImagePreview } from './IDEImagePreview.js';
import { IDEHtmlPreview } from './IDEHtmlPreview.js';
import { openExternally } from './openWorkspaceTarget.js';
import { useWorkspaceImage } from './useWorkspaceImage.js';
import { bakeMimeFor, canOverwriteWorkspaceImage } from './workspaceImageSave.js';
import { imageMetaLabel } from './editorImageMeta.js';
import { useIDEBodyLayout } from './ideBodyLayoutContext.js';
import { dragEditorWidth, type EditorResizeDrag } from './ideResponsive.js';

/**
 * IDEEditorPane.tsx — §5.5 #17-27 v4.87 메인 영역 **오른쪽에 붙는 편집창**.
 *
 * 덮개가 아니라 형제다(§5.5 #17-27 ①) — 사용자는 에이전트가 말하는 것을 보면서 그 파일을 읽는다.
 * 이 컴포넌트가 하는 일은 셋: 탭 줄(열어 둔 파일) · 손잡이 줄(저장·다시 읽기·밖에서 열기·닫기) ·
 * 본문(`CodeEditor`). 읽기·저장은 `useEditorDocs` 가, 색 구분은 `codeHighlight` 가 맡는다.
 */

/**
 * 폭 조절 손잡이의 **잡히는 여유**(px). 보이는 띠는 4px 그대로 두고 양옆으로만 넓힌다.
 *
 * 4px 짜리 표적을 정확히 겨누게 하는 것은 눈에 안 보이는 마찰이고(피츠의 법칙) 사용자는
 * "손잡이가 잘 안 잡힌다"로만 느낀다 — 분할 손잡이(§5.5 #17-27 ⑪ (a))가 같은 이유로 이미
 * 이 모양이고, 여기만 종전 4px 로 남아 있었다. 바깥 띠가 배경·강조를 그리고, 안쪽의 넓은
 * 절대배치 자식이 포인터를 받는다(부모의 `:hover` 는 자식 위에서도 켜지므로 강조도 함께 넓어진다).
 */
const RESIZE_HIT_PAD = {
  /** 대화 쪽(바깥)으로 넓히는 여유 — 그 자리에는 겹칠 손잡이가 없어 넉넉히 준다. */
  OUT: 8,
  /**
   * 본문 쪽(안쪽) 여유는 **작게**. 이 띠는 편집창 왼쪽 끝을 가리는데, 그 자리에는 탭의 왼쪽 끝과
   * 코드 편집기의 여백(줄 번호·중단점을 찍는 곳)이 있다 — 넓게 잡으면 중단점이 안 찍힌다.
   */
  IN: 2,
} as const;

/** §5.5 #17-27 ⑪ — 강조가 머무는 시간(ms). `index.css` 의 `edit-follow-flash` 길이와 맞춘다. */
const FOLLOW_FLASH_MS = 1800;

export const IDEEditorPane = memo(function IDEEditorPane(): React.JSX.Element | null {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const files = useIDEPaneValue((o) => o.editorFiles);
  const activePath = useIDEPaneValue((o) => o.activeEditorPath);
  /**
   * 나란히 설 자리가 없으면(`editorDrawer`) 대화 위를 덮는 오버레이로 뜬다 — 폰뿐 아니라
   * **창을 좁힌 데스크톱**도 여기로 온다(§5.5 #17-27 ① 의 `max-md` 판정을 창 폭 판정으로 넓혔다).
   *
   * `width` 는 사용자가 저장해 둔 폭이 아니라 **이 창에서 실제로 쓸 폭**이다 — 저장값(기본 520px)을
   * 그대로 그리면 창보다 넓은 패널이 대화를 0px 로 밀어낸다(사용자 스크린샷의 그 상태). 저장값
   * 자체는 손대지 않으므로 창을 다시 넓히면 끌어 둔 폭이 그대로 돌아온다.
   */
  const { editorDrawer: narrow, editorWidth: width, editorMaxWidth, navDrawer } = useIDEBodyLayout();
  const setWidth = useGraphStore((s) => s.setIdeEditorWidth);
  const {
    setActiveEditorFile: setActive,
    closeEditorFile: closeFile,
    setEditorFileDirty: setDirty,
    setEditorTabsPinned,
  } = useIDEPaneActions();
  /** §5.5 #17-27 ⑯ — 탭 줄이 세션을 따라 바뀌지 않게 붙들어 두었는가. */
  const tabsPinned = useIDEPaneValue((o) => o.editorPinned);
  const toggleTabsPinned = useCallback((): void => {
    setEditorTabsPinned(!tabsPinned);
  }, [setEditorTabsPinned, tabsPinned]);
  const clearBreakpointsInFile = useGraphStore((s) => s.clearBreakpointsInFile);

  const { docs, ensureLoaded, reload, setDraft, save, drop } = useEditorDocs(rootPath);

  const active = useMemo(() => files.find((f) => f.relPath === activePath) ?? null, [files, activePath]);
  const doc = activePath ? docs[activePath] : undefined;
  const labels = useMemo(() => tabLabels(files), [files]);
  const language = useMemo(() => (active ? languageFromPath(active.relPath) : 'plain'), [active]);

  // ─── §5.5 #17-27 ⑭ — 이미지는 글자가 아니라 그림으로 연다 ──────────────
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const imageSavedAt = useGraphStore((s) => (activePath ? s.workspaceImageSavedAt[activePath] : undefined));
  /** 서버가 이미 판정해 보낸 값 — 클라이언트가 확장자를 다시 따지지 않는다. */
  const isImage = doc?.status === 'ready' && doc.image;
  /** §5.13 (R) — PDF 는 텍스트도 그림도 아니라 세 번째 그리기다(내장 Chromium 뷰어). */
  const isPdf = activePath !== null && activePath.toLowerCase().endsWith('.pdf');

  // ─── §5.5 #17-27 ⑮ — HTML 은 글자가 아니라 페이지로 연다 ────────────────
  /**
   * 기본은 **그려진 페이지**이고, [소스] 를 누르면 ⑤ 의 편집창이 그대로 돌아온다(대체 ❌ 병행).
   *
   * 어느 쪽을 보고 있었는지는 **탭마다** 기억한다 — 한 벌로 두면 소스를 보다 다른 탭에 다녀온
   * 순간 페이지로 되돌아가, 고치던 자리를 매번 다시 찾게 된다. 영속화 ❌(⑦ 그대로 — 그 창의 화면 상태).
   */
  const isHtml = activePath !== null && doc?.status === 'ready' && !doc.binary && isWorkspaceHtmlPath(activePath);
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

  /**
   * §5.5 #17-25 ④-1 — 라이트박스가 이 파일을 덮어썼다. 새 `mtimeMs` 를 받아야 미리보기가
   * 방금 그린 표시를 보여 준다(같은 시각을 두 번 처리하지 않도록 마지막 값을 기억한다).
   */
  const imageReloadedAtRef = useRef(0);
  useEffect(() => {
    if (!activePath || !imageSavedAt || imageReloadedAtRef.current === imageSavedAt) return;
    imageReloadedAtRef.current = imageSavedAt;
    reload(activePath);
  }, [activePath, imageSavedAt, reload]);

  /** 그림을 누르거나 [편집]을 누르면 — #17-25 의 주석 팝업을 그대로 연다(새 편집기 ❌). */
  const handleOpenImageEditor = useCallback((): void => {
    if (!imageBlob.url || !rootPath || !activePath) return;
    openImageLightbox(imageBlob.url, undefined, {
      root: rootPath,
      path: activePath,
      mtimeMs: doc?.mtimeMs ?? 0,
      bakeable: canOverwriteWorkspaceImage(activePath),
      mime: bakeMimeFor(activePath),
    });
  }, [imageBlob.url, rootPath, activePath, doc?.mtimeMs, openImageLightbox]);

  // ─── §5.5 #17-20 ⑩ v4.94 — 줄 번호 칸이 곧 중단점 gutter ─────────────────
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

  /**
   * 지금 멈춰 서 있는 줄 — **이 파일일 때만**. 여러 세션이 떠 있으면 먼저 멈춘 것을 따르고,
   * 프레임은 사용자가 콜스택에서 고른 것을 존중한다(안 골랐으면 맨 위 프레임).
   */
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
  useEffect(() => {
    if (activePath) ensureLoaded(activePath);
  }, [activePath, ensureLoaded]);

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
  /** 지금 강조 중인 줄 범위(그 파일에 한정) — 잠깐 뒤 스스로 사라진다. */
  const [follow, setFollow] = useState<{ relPath: string; range: FollowRange; token: number } | null>(null);
  /** (h) ④ 잔상 — 강조가 꺼진 뒤에도 **다음 편집까지** 남는 "여기가 방금 바뀐 자리" 표시. */
  const [recent, setRecent] = useState<{ relPath: string; range: FollowRange } | null>(null);
  /** 이미 접수한 신호의 시각 — 같은 신호를 두 번 처리하지 않는다. */
  const followSeenRef = useRef(0);
  /**
   * 접수했지만 아직 **다시 읽기가 끝나지 않은** 신호.
   * `awaitReload` 는 "reload 를 불렀으니 문서가 `loading` 으로 바뀌는 것을 먼저 보고 가라" 는 뜻이다 —
   * 이 한 걸음이 없으면 아래 효과가 **다시 읽기 전의 옛 본문**에서 줄을 찾아 엉뚱한 곳으로 스크롤한다.
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

  const followRange = follow && follow.relPath === activePath ? follow.range : null;
  const recentRange = recent && recent.relPath === activePath ? recent.range : null;
  /** 추종 띠에 적을 자국 — 이 세션의 것만(옆 세션이 따라간 것을 여기 적으면 세션 격리가 무너져 보인다). */
  const bannerMark = followMark && followMark.sessionKey === sessionKey ? followMark : null;
  /** (h) — 끝까지 못 간 사유. 있으면 띠가 파란색이 아니라 호박색으로, 한 일 대신 **왜 안 했는지**를 말한다. */
  const bannerSkip = bannerMark?.skip ?? null;

  const readOnly = !doc || doc.status !== 'ready' || doc.truncated || doc.binary;
  const dirty = !!doc && doc.status === 'ready' && doc.draft !== doc.diskText;

  const handleChange = useCallback((next: string): void => {
    if (activePath) setDraft(activePath, next);
  }, [activePath, setDraft]);

  const handleSave = useCallback((force = false): void => {
    if (activePath) save(activePath, { force });
  }, [activePath, save]);

  /**
   * §5.5 #17-27 ⑫ — 디스크의 읽기 전용 잠금을 풀고 저장한다(Perforce 체크아웃 전 파일 등).
   * 충돌 대조는 그대로 지난다 — 잠겼다는 이유로 남의 편집을 덮지 않는다.
   */
  const handleUnlockSave = useCallback((): void => {
    if (activePath) save(activePath, { clearReadOnly: true });
  }, [activePath, save]);

  /**
   * 탭 닫기 공통 — 저장할 것이 남은 탭이 있으면 **한 번만** 되묻는다(③ 규칙).
   * 여러 탭을 한꺼번에 닫는 우클릭 항목도 같은 문을 지나므로, 확인 없이 사라지는 편집분은 없다.
   */
  const closeTabs = useCallback((relPaths: string[]): void => {
    if (relPaths.length === 0) return;
    const unsaved = relPaths.filter((p) => {
      const d = docs[p];
      return !!d && d.status === 'ready' && d.draft !== d.diskText;
    });
    if (unsaved.length > 0) {
      const message = unsaved.length === 1
        ? t('ide.editor.closeDirtyConfirm')
        : t('ide.editor.closeDirtyConfirmMany', { count: unsaved.length });
      if (!window.confirm(message)) return;
    }
    for (const p of relPaths) {
      drop(p);
      closeFile(p);
    }
  }, [docs, drop, closeFile, t]);

  const handleCloseTab = useCallback((relPath: string): void => {
    closeTabs([relPath]);
  }, [closeTabs]);

  const handleCloseAll = useCallback((): void => {
    closeTabs(files.map((f) => f.relPath));
  }, [closeTabs, files]);

  const handleOpenExternal = useCallback((): void => {
    if (active) openFileByPath(active.absPath, active.relPath);
  }, [active]);

  /**
   * 손잡이 줄의 경로 — 상대 경로가 아니라 **파일이 실제로 있는 전체 경로**를 적는다.
   * 툴팁에만 있던 것을 꺼낸 이유는 그 다음 줄과 한 쌍이다: 이 줄이 곧 폴더를 여는 손잡이다.
   */
  const fullPath = active?.absPath ?? activePath ?? '';
  const pathParts = useMemo(() => splitPathTail(fullPath), [fullPath]);

  /** §5.5 #17-27 ⑩ — 경로를 누르면 그 파일이 든 폴더가 시스템 탐색기에서 열린다(기존 열기 경로 재사용). */
  const handleOpenFolder = useCallback((): void => {
    if (active) openFolderByPath(active.absPath, active.relPath);
  }, [active]);

  // ─── §5.5 #17-27 ⑨ v4.97 우클릭 메뉴 3종 ───────────────────────────────────
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const copyText = useCallback((text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => { /* 클립보드 거부는 조용히 무시 */ });
  }, []);

  /** (a) 본문 — 편집 조작은 `CodeEditor` 가 넘겨 준 것을 그대로 쓰고, 저장·경로 같은 것만 여기서 얹는다. */
  const buildBodyMenu = useCallback((ctx: CodeEditorBodyMenuContext): ContextMenuItem[] => (
    buildBodyMenuItems(
      { hasSelection: ctx.hasSelection, readOnly, dirty },
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
        { hasOthers: files.length > 1 },
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
   * 종전 구현은 세 가지 이유로 손을 따라오지 못했다(사용자 보고 — "잘 조절이 안돼 뭔가 버벅여").
   *
   * ⓐ **iframe 이 손짓을 삼켰다.** 편집창 안에는 미리보기 iframe 이 산다(HTML ⑮ · PDF §5.13 (R)).
   *    `window` 의 `mousemove` 로 듣고 있으면 커서가 그 위로 들어가는 순간 이벤트가 **iframe 문서**로
   *    가 버려 드래그가 그 자리에서 멎는다. 좁히는 방향은 패널 가장자리가 손보다 늘 반 박자 뒤라
   *    커서가 곧바로 패널 **안쪽**(=iframe 위)에 들어가므로, 이 경로에서는 거의 매번 걸린다.
   *    → 캡처를 **손잡이 자신**에 건다(`setPointerCapture`). 그러면 커서가 무엇 위에 있든 이 요소가
   *      받는다(CMD 패널 경계선이 xterm 을 상대로 이미 쓰는 그 방법).
   * ⓑ **매 이동마다 디스크에 썼다.** `setIdeEditorWidth` 는 값이 바뀔 때마다 `localStorage` 에
   *    **동기로** 쓴다. 마우스 이동은 초당 수백 번 오므로 그 동기 쓰기가 프레임을 통째로 먹었다.
   *    → 끄는 동안에는 스토어를 건드리지 않고, 손을 뗄 때 **한 번만** 저장한다.
   * ⓒ **매 이동마다 창을 다시 그렸다.** 폭이 스토어 값이라 이동마다 편집창(색 구분이 붙은
   *    `CodeEditor`)과 창 레이아웃 판정이 전부 다시 돌았다.
   *    → 끄는 동안 폭은 **DOM 에 직접** 쓴다(프레임당 한 번, `requestAnimationFrame` 로 묶어서).
   *      리렌더가 나도 화면이 튀지 않게, 그때의 `style` 은 같은 값을 들고 있는 ref 를 읽는다.
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

  /**
   * 끄는 동안 손끝을 붙잡아 둔다 — 지나간 자리의 글자가 선택되고 커서가 본문 것으로 바뀌면
   * "지금 크기를 조절하는 중"이라는 감각이 끊긴다(분할 손잡이 ⑪ (b) 와 같은 처리).
   */
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

  if (files.length === 0 || !activePath) return null;

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

      <IDEEditorTabs
        files={files}
        labels={labels}
        activePath={activePath}
        onSelect={setActive}
        onClose={handleCloseTab}
        onCloseAll={handleCloseAll}
        onTabContextMenu={handleTabContextMenu}
        pinned={tabsPinned}
        onTogglePinned={toggleTabsPinned}
      />

      {/* §5.5 #17-27 ⑪ (h) ③ — 추종 띠. 켜져 있는 동안만 서고, 방금 무엇을 했는지(자동으로 다시 읽었다는
          사실까지) 이 한 줄이 말한다 — 사용자가 "내가 안 건드렸는데 내용이 바뀌었다" 고 놀라지 않도록. */}
      {followOn && (
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

      {/* 손잡이 줄 — 전체 경로(누르면 그 폴더가 열린다) + 저장·다시 읽기·밖에서 열기 */}
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
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={!dirty || doc?.saving}
          title={t('ide.editor.save', { shortcut: shortcutLabel('Ctrl+S') })}
          aria-label={t('ide.editor.save', { shortcut: shortcutLabel('Ctrl+S') })}
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

      {/* 알림 줄 — 충돌 / 읽기 전용 / 저장 실패는 본문 위에 그대로 적는다(조용히 삼키지 않는다). */}
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
      {/* ⑫ 잠금 띠 — 열자마자 "이 파일은 디스크가 잠갔다"를 말한다(타이핑은 막지 않는다). */}
      {doc?.status === 'ready' && doc.readOnly && !doc.binary && !doc.truncated && !doc.saveError && (
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
      {!doc || doc.status === 'loading' ? (
        <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.loading')}</p>
      ) : doc.status === 'error' ? (
        <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.editor.readError')}</p>
      ) : isPdf ? (
        /**
         * §5.13 (R) — PDF 는 **Chromium 이 이미 싣고 다니는 뷰어**로 그린다.
         *
         * 우리가 PDF 를 렌더하는 코드를 쓰지 않는다((C) 표의 판단과 같다 — 남이 끝낸 문제).
         * 창 설정에서 `plugins` 를 켜 두면 이 iframe 하나로 열람·검색·인쇄가 전부 붙는다.
         */
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
        /**
         * §5.5 #17-27 ⑮ — HTML 은 **그려진 페이지**로 연다. 렌더링은 Chromium 이 하고
         * (PDF 를 내장 뷰어에 맡긴 §5.13 (R) 과 같은 판단), 우리는 그 위에 브라우저 줄만 얹는다.
         * 태그 원문이 필요하면 손잡이 줄의 [소스] 로 ⑤ 의 편집창이 그대로 돌아온다.
         */
        <IDEHtmlPreview
          key={activePath}
          root={rootPath}
          relPath={activePath}
          mtimeMs={doc.mtimeMs ?? 0}
          onOpenExternal={handleOpenInBrowser}
        />
      ) : (
        <CodeEditor
          key={activePath}
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
        />
      )}

      {/* §5.5 #17-27 ⑨ — 탭 우클릭 메뉴(본문·줄 번호 메뉴는 `CodeEditor` 가 자기 자리에서 띄운다). */}
      {tabMenu && (
        <IDEContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenu.items} onClose={() => setTabMenu(null)} />
      )}
    </div>
  );
});
