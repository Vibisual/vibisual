/**
 * §5.5 #17-17 ㉒ — **무대 실황 칸.** 그 단계가 *지금 만들고 있는 것*을 무대 안에서 보여 준다.
 *
 * ⑪(j) 는 "그 아래로 `surface` 가 정한 화면이 열린다"고 정했고 ⑭(a) 는 그 칸을 회수했다 —
 * 대부분의 단계에서 **빈 안내 한 줄**로 `36%` 를 차지하고 앉아 있었기 때문이다. ㉒ 는 그 칸을
 * 되살리되 걷어낸 이유를 정면으로 피한다: **비출 것이 실제로 있을 때만 선다.** 없으면 이 컴포넌트는
 * `null` 이고 한 픽셀도 차지하지 않는다(빈 안내 ❌).
 *
 * 산출물 넷(`image`·`model3d`·`video`·`audio`)은 **밖에 프로그램을 띄우지 않는다** — 뒤 셋은 이미
 * 있는 내부 앱(§5.13 `vibi3d`·`vibistudio`·`vibisound`)을 `AppShellHost fill` 로 이 자리에 펴고,
 * `image` 는 편집창이 쓰는 그림 칸(`useWorkspaceImage` + `IDEImagePreview`)을 그대로 부른다.
 * **새 뷰어·새 전송 계층·새 창이 하나도 없다.**
 *
 * 무엇을 비출지 고르는 판정은 전부 `stageSurface.ts` 의 순수 함수다 — 여기 있는 것은 그리기뿐이다.
 */
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { matchProblemLine, workspaceFileExt, type SessionGoalStep, type VisualKindSurface } from '@vibisual/shared';

// 앱 셸 호스트는 배럴에 없다(코어 부팅이 앱 코드를 끌어오지 않게 한 §5.13 (O) 의 배치) — 직접 부른다.
import { AppShellHost } from '../../apps/AppShellHost.js';
import { appShellParams, getInternalApp, workspaceOpenClaims } from '../../apps/index.js';
import { selectPaneProjectPath, useGraphStore } from '../../stores/graphStore.js';
import { toWorkspaceRelative } from './debugPaths.js';
import { IDEImagePreview } from './IDEImagePreview.js';
import { useIDEPaneKey } from './idePane.js';
import { ProblemOutputLine } from './ProblemOutputLine.js';
import { PathGlyph } from './StageGlyph.js';
import {
  STAGE_SURFACE_CHROME,
  bashInWindow,
  editsInWindow,
  effectiveSurface,
  isArtifactSurface,
  stageArtifact,
  stepWindow,
  surfaceAppId,
  webInWindow,
} from './stageSurface.js';
import { useWorkspaceImage } from './useWorkspaceImage.js';

/** 한 골격이 목록으로 보여 주는 줄 수. 실황은 훑는 창이라 길면 그 자체가 로그가 된다. */
const LIST_MAX = 8;
/** 진단이 하나도 없는 명령이 남기는 꼬리 줄 수(⑪(j) — 빈 화면 ❌). */
const LOG_TAIL_LINES = 2;
/** `log` 골격이 한 화면에 세우는 진단 줄의 상한. */
const LOG_LINE_MAX = 40;

/** ㉒(d) — `docs` 골격이 문서로 세는 확장자. 여기 없는 것은 `source` 가 받는다. */
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.pdf']);

/** 화면에 쓸 짧은 경로 — 앞을 접고 파일 이름 쪽을 남긴다(정체는 꼬리에 있다). */
function shortPath(path: string, keep = 42): string {
  const flat = path.split('\\').join('/');
  if (flat.length <= keep) return flat;
  return `…${flat.slice(flat.length - keep + 1)}`;
}

function baseName(path: string): string {
  const flat = path.split('\\').join('/');
  return flat.slice(flat.lastIndexOf('/') + 1) || flat;
}

/** 줄 수. 빈 문자열은 0줄이다(`''.split('\n')` 이 1을 돌려주는 것을 그대로 쓰면 한 줄이 늘어난 것으로 보인다). */
function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

/** ㉒(d) — 늘고 준 줄을 **막대**로. 숫자만 적으면 큰 변경과 한 줄 고침이 같아 보인다. */
const DiffBar = memo(function DiffBar({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  const total = Math.max(added + removed, 1);
  return (
    <span className="flex flex-shrink-0 items-center gap-1" title={`+${added} / -${removed}`}>
      <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-gray-800">
        <span className="h-full bg-emerald-400" style={{ width: `${(added / total) * 100}%` }} />
        <span className="h-full bg-rose-400" style={{ width: `${(removed / total) * 100}%` }} />
      </span>
      <span className="tabular-nums text-[12px] text-emerald-300">{`+${added}`}</span>
      <span className="tabular-nums text-[12px] text-rose-300">{`-${removed}`}</span>
    </span>
  );
});

interface StageLiveSurfaceProps {
  steps: readonly SessionGoalStep[];
  /** 무대가 지금 비추는 단계. 추종이 켜져 있으면 이 값이 도는 단계를 따라간다(㉒(e) — 새 스위치 ❌). */
  shownStepId: string | null;
  /** 종류 카드가 고른 골격. `none` 이면 그 구간에 고친 파일이 있을 때만 `source` 로 읽는다(㉒(d)). */
  surface: VisualKindSurface;
}

export const StageLiveSurface = memo(function StageLiveSurface({
  steps,
  shownStepId,
  surface: kindSurface,
}: StageLiveSurfaceProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const paneKey = useIDEPaneKey();
  const rootPath = useGraphStore((s) => selectPaneProjectPath(s, paneKey));
  const fileEdits = useGraphStore((s) => s.fileEdits);
  const bashHistory = useGraphStore((s) => s.bashHistory);
  const domainEntries = useGraphStore((s) => s.domainEntries);
  const openEditorFile = useGraphStore((s) => s.openIDEEditorFile);
  const open = useGraphStore((s) => s.ideStageLive);
  const setOpen = useGraphStore((s) => s.setIdeStageLive);

  const win = useMemo(() => stepWindow(steps, shownStepId), [steps, shownStepId]);

  // ─── 원천 — 전부 **이미 있는** 장부를 구간으로 자른 것이다(새 수집 ❌ · ⑪(j)) ───
  const edits = useMemo(() => editsInWindow(fileEdits, win, LIST_MAX), [fileEdits, win]);
  // ㉒(d) — 종류를 안 고른 단계도 파일은 고친다. 고친 것이 있으면 `source` 로 읽는다(없으면 `none`).
  const surface = effectiveSurface(kindSurface, edits.length > 0);
  const chrome = STAGE_SURFACE_CHROME[surface] ?? STAGE_SURFACE_CHROME.none;
  const shells = useMemo(
    () => (surface === 'log' || surface === 'terminal' ? bashInWindow(bashHistory, win, LIST_MAX) : []),
    [surface, bashHistory, win],
  );
  const webs = useMemo(
    () => (surface === 'web' ? webInWindow(domainEntries, win, LIST_MAX) : []),
    [surface, domainEntries, win],
  );

  /** ㉒(c) — 산출물 골격이 열 파일 하나. 못 찾으면 `null` → 칸이 서지 않는다(빈 뷰어 ❌). */
  const artifact = useMemo(() => {
    if (!isArtifactSurface(surface)) return null;
    const abs = stageArtifact(surface, edits, workspaceOpenClaims());
    if (!abs || !rootPath) return null;
    const rel = toWorkspaceRelative(abs, rootPath);
    // 루트 밖의 산출물은 앱에 넘길 상대 경로가 없다 — 조용히 접는다(§5.13 (R-2) 는 상대 경로를 받는다).
    if (!rel) return null;
    const at = edits.find((e) => e.filePath === abs)?.timestamp ?? 0;
    return { abs, rel, at };
  }, [surface, edits, rootPath]);

  // 이미지는 편집창과 **같은 창구**로 받는다 — 그림 태그에 API 주소를 직접 거는 길은 패키징된 앱에서
  //   조용히 실패한다(렌더러의 `fetch` 만 IPC 로 우회되고 태그가 스스로 내는 요청은 그 패치를 안 탄다).
  //   훅은 조건 없이 부르고 값으로 끈다 — 그 판정은 훅 안에 있다.
  const imageBlob = useWorkspaceImage(
    surface === 'image' && artifact ? rootPath : null,
    surface === 'image' && artifact ? artifact.rel : null,
    artifact?.at ?? 0,
  );
  // 무대는 원본 치수를 적지 않는다(편집창이 그 일을 한다) — 받아서 버리는 상태를 두면 그림 한 장마다
  //   쓸데없이 한 번 더 그려진다. 조각이 요구하는 칸이라 빈 함수로 채운다.
  const onImageNatural = useCallback(() => {}, []);

  const openFile = useCallback(
    (absPath: string) => {
      if (!rootPath) return;
      const rel = toWorkspaceRelative(absPath, rootPath);
      if (!rel) return;
      openEditorFile({ relPath: rel, absPath: `${rootPath}/${rel}`, name: baseName(rel) }, paneKey);
    },
    [rootPath, openEditorFile, paneKey],
  );
  const openRelFile = useCallback(
    (relPath: string) => {
      if (!rootPath) return;
      openEditorFile({ relPath, absPath: `${rootPath}/${relPath}`, name: baseName(relPath) }, paneKey);
    },
    [rootPath, openEditorFile, paneKey],
  );

  const docEdits = useMemo(() => edits.filter((e) => DOC_EXTS.has(workspaceFileExt(e.filePath))), [edits]);

  /** ㉒(a) — 산출물 골격이 펴는 내부 앱. 앱 이름을 여기 적지 않는다(표가 §5.13 쪽에 있다). */
  const app = useMemo(() => {
    const appId = surfaceAppId(surface);
    return appId ? getInternalApp(appId) : undefined;
  }, [surface]);
  const appParams = useMemo(
    () => (app && artifact && rootPath ? appShellParams(app, { projectId: rootPath, file: artifact.rel }) : null),
    [app, artifact, rootPath],
  );

  // ─── 비출 것이 있는가 — 없으면 칸 자체가 서지 않는다(⑭(a) 가 걷어낸 그 증상의 재발 방지) ───
  const hasContent = (() => {
    if (surface === 'none' || !win) return false;
    if (isArtifactSurface(surface)) return artifact !== null && (surface === 'image' || appParams !== null);
    if (surface === 'log' || surface === 'terminal') return shells.length > 0;
    if (surface === 'web') return webs.length > 0;
    if (surface === 'docs') return docEdits.length > 0;
    return edits.length > 0;
  })();
  if (!hasContent) return null;

  const title = t(`ide.stage.surfaceName.${surface}`);

  return (
    <div
      data-ide-stage-live=""
      className="flex flex-shrink-0 flex-col border-t border-gray-800 bg-gray-950"
      style={open ? { height: 'clamp(120px, 46%, 340px)' } : undefined}
    >
      {/* 머리 — 무엇을 보고 있는가(골격 색) + 접기. 골격 색은 카드 색과 다른 축이다(⑪(n)). */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={t(open ? 'ide.stage.live.collapse' : 'ide.stage.live.expand')}
        className="flex flex-shrink-0 items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-gray-900/70"
        style={{ borderTop: `2px solid ${chrome.accent}55` }}
      >
        <PathGlyph d={chrome.glyph} color={chrome.accent} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-[12px] font-semibold" style={{ color: chrome.accent }}>
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500">
          {artifact ? shortPath(artifact.rel) : t('ide.stage.live.count', { count: countOf(surface, { edits, docEdits, shells, webs }) })}
        </span>
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform ${open ? '' : 'rotate-180'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* ─── 산출물 — 그 앱의 화면 자체가 칸을 채운다(밖에 창 ❌) ─── */}
          {surface === 'image' && artifact && (
            <IDEImagePreview
              url={imageBlob.url}
              status={imageBlob.status}
              fit
              onNatural={onImageNatural}
              onOpen={() => openFile(artifact.abs)}
            />
          )}
          {surface !== 'image' && app && appParams && (
            <div className="min-h-0 flex-1">
              <AppShellHost hash={{ appId: app.id, mode: 'main', params: appParams }} fill />
            </div>
          )}

          {/* ─── 소스 — 고친 파일 + 늘고 준 줄. 누르면 편집창의 그 파일로 간다(#17-27 기존 문) ─── */}
          {(surface === 'source' || surface === 'diff') && (
            <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 py-1">
              {edits.map((edit) => {
                const added = lineCount(edit.newString);
                const removed = lineCount(edit.oldString);
                return (
                  <li key={edit.id}>
                    <button
                      type="button"
                      onClick={() => openFile(edit.filePath)}
                      title={edit.filePath}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-800/70"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{baseName(edit.filePath)}</span>
                      {surface === 'diff' ? (
                        <DiffBar added={added} removed={removed} />
                      ) : (
                        <span
                          className="flex-shrink-0 rounded px-1 text-[12px] leading-tight"
                          style={{ color: chrome.accent, backgroundColor: `${chrome.accent}1A` }}
                        >
                          {workspaceFileExt(edit.filePath).replace('.', '') || '—'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ─── 문서 — 문서 글리프 + 짧은 경로 ─── */}
          {surface === 'docs' && (
            <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 py-1">
              {docEdits.map((edit) => (
                <li key={edit.id}>
                  <button
                    type="button"
                    onClick={() => openFile(edit.filePath)}
                    title={edit.filePath}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-800/70"
                  >
                    <PathGlyph d={chrome.glyph} color={chrome.accent} className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{shortPath(edit.filePath)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ─── 출력 — 진단 줄은 색을 얻고 파일이 잡히면 눌러서 편집창으로(같은 조각 `ProblemOutputLine`) ─── */}
          {surface === 'log' && (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[12px] leading-snug">
              {shells.slice(0, LIST_MAX).map((entry) => {
                const lines = (entry.output ?? '').split('\n');
                const problems = lines.filter((l) => matchProblemLine(l) !== null);
                // 진단이 하나도 없는 명령은 꼬리 두 줄만 남긴다 — 빈 화면을 만들지 않는다(⑪(j)).
                const shown = (problems.length > 0 ? problems : lines.filter((l) => l.trim().length > 0).slice(-LOG_TAIL_LINES)).slice(0, LOG_LINE_MAX);
                if (shown.length === 0) return null;
                return (
                  <div key={entry.id} className="mb-1">
                    <div className="truncate text-gray-600" title={entry.command}>{entry.command}</div>
                    {shown.map((line, i) => (
                      // 줄 순서가 곧 정체성이라 index 키가 맞다(뒤로만 늘어난다 — #17-20 과 같은 판단).
                      <ProblemOutputLine key={i} line={line} root={rootPath} onOpen={openRelFile} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── 터미널 — 주인공은 **명령**이고 출력은 꼬리 한 줄이다(`log` 와 같은 장부, 다른 그림) ─── */}
          {surface === 'terminal' && (
            <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[12px] leading-snug">
              {shells.map((entry) => {
                const tail = (entry.output ?? '').split('\n').filter((l) => l.trim().length > 0).slice(-1)[0] ?? '';
                return (
                  <li key={entry.id} className="mb-1">
                    <div className="flex items-start gap-1.5">
                      <span className="flex-shrink-0" style={{ color: chrome.accent }}>$</span>
                      <span className="min-w-0 break-all text-gray-200">{entry.command}</span>
                    </div>
                    {tail !== '' && <div className="truncate pl-3 text-gray-500" title={tail}>{tail}</div>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ─── 웹 — 호스트와 경로를 **갈라** 쓴다(붙여 놓으면 같은 사이트를 여러 번 본 목록이 다 같은 글줄이다) ─── */}
          {surface === 'web' && (
            <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {webs.map((entry) => {
                const url = entry.url ?? '';
                let host = '';
                let path = '';
                if (url !== '') {
                  const m = /^[a-z]+:\/\/([^/?#]+)([^\s]*)$/i.exec(url);
                  host = m?.[1] ?? url;
                  path = m?.[2] ?? '';
                }
                return (
                  <li key={entry.id} className="flex items-baseline gap-1.5 px-1 py-0.5 text-[12px]">
                    {entry.kind === 'search' ? (
                      <>
                        <span className="flex-shrink-0" style={{ color: chrome.accent }}>{t('ide.stage.live.search')}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-200">{entry.query ?? '—'}</span>
                      </>
                    ) : (
                      <>
                        <span className="flex-shrink-0 font-semibold" style={{ color: chrome.accent }}>{host}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-400" title={url}>{path}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

/** 접힌 머리에 적는 건수 — 골격마다 세는 단위가 다르다(⑪(n) "세는 단위"). */
function countOf(
  surface: VisualKindSurface,
  src: {
    edits: readonly unknown[];
    docEdits: readonly unknown[];
    shells: readonly unknown[];
    webs: readonly unknown[];
  },
): number {
  if (surface === 'log' || surface === 'terminal') return src.shells.length;
  if (surface === 'web') return src.webs.length;
  if (surface === 'docs') return src.docEdits.length;
  return src.edits.length;
}
