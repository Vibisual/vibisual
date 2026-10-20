import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EDITOR_PANE_FILE_KINDS, type EditorPaneFileKind } from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { useRunSessions, type RunSession } from '../../stores/runSessions.js';
import { editorOpenerKey } from '../../stores/editorOpener.js';
import { useIDEPaneActions, useIDEPaneKey, useIDEPaneValue } from './idePane.js';
import { PANE_KIND_TEXT, PaneKindGlyph, PaneLauncherGlyph, RunOutputGlyph } from './paneKinds.js';
import { agentRunsNewestFirst, requestOpenerFocus } from './paneOpenerModel.js';

/**
 * §5.5 #17-27 ⑱ (a) — 세션 탭 줄의 **[우측 판]** 손잡이(`+`(새 세션) → 탭 정렬 다음, 정렬 바로 오른쪽).
 *
 * 누르면 우측 판이 띄울 수 있는 것이 목록으로 펼쳐진다 — 파일 갈래 넷(코드 · 웹 페이지 · 그림 · PDF)과,
 * 구분선 아래 이 버블이 띄운 **실행 출력**. 파일 갈래를 고르면 우측 판에 그 갈래의 **빈 탭**이 서고
 * (⑱ (c)), 그 탭에서 이 프로젝트의 그 갈래 파일을 골라 연다(⑱ (d) `IDEPaneOpener`).
 *
 * **무대는 여기 없다** — 무대로 가는 입구는 목표 뷰의 [뷰 보기] 하나다(#17-17 ⑪(k)·(o), ⑱ (b)).
 *
 * 팝업 문법은 바로 옆 정렬 손잡이(#17-41 `IDETabSortMenu`)와 같다 — 바깥 누름으로 닫히고, Esc 는
 * (H-20) 그대로 창의 것이다. 세션을 만드는 손잡이가 아니므로 훅 버블(#17-29)에도 선다.
 */

/** 닫혀 있을 때 실행 목록 대신 쥐는 빈 값 — 참조가 늘 같아 닫힌 동안은 다시 그리지 않는다. */
const NO_RUNS: Readonly<Record<string, RunSession>> = {};

export function IDEPaneLauncherMenu(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const agentId = useIDEPaneValue((o) => o.agentId);
  const paneKey = useIDEPaneKey();
  const { openPaneOpener } = useIDEPaneActions();

  // 실행 목록은 **펼쳐 있을 때만** 구독한다 — 닫혀 있는 동안 실행 상태가 바뀔 때마다 탭 줄 전체가
  //   다시 그려질 이유가 없다(정렬 손잡이가 카드를 구독하지 않는 것과 같은 판단).
  const sessions = useRunSessions((s) => (open ? s.sessions : NO_RUNS));
  const runs = useMemo(() => agentRunsNewestFirst(sessions, agentId), [sessions, agentId]);

  useOutsidePressDismiss({ onDismiss: () => setOpen(false), enabled: open, refs: [menuRef] });

  const launchKind = useCallback((kind: EditorPaneFileKind) => {
    setOpen(false);
    openPaneOpener(kind);
    // 사용자가 방금 연 빈 탭이다 — 그 탭의 검색 칸이 초점을 가져간다(⑱ (d)).
    requestOpenerFocus(paneKey, editorOpenerKey(kind));
  }, [openPaneOpener, paneKey]);

  const showRun = useCallback((runId: string) => {
    setOpen(false);
    useRunSessions.getState().openOutput(runId);
  }, []);

  if (!agentId) return null;

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-8 w-8 items-center justify-center transition-colors ${
          open ? 'bg-gray-800 text-gray-200' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
        }`}
        title={t('ide.paneLauncher.button')}
        aria-label={t('ide.paneLauncher.button')}
      >
        <PaneLauncherGlyph />
      </button>

      {open && (
        // 실행 출력 줄은 돌린 만큼 는다 — 창 높이를 넘기면 창(`overflow-hidden`)에 잘리므로 메뉴 안에서 스크롤한다.
        <div
          role="menu"
          className="scrollbar-thin absolute right-0 top-8 z-50 max-h-[min(70vh,calc(100dvh-6rem))] w-64 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/50"
        >
          <p className="px-2 pb-0.5 pt-1 text-xs font-semibold text-gray-500">{t('ide.paneLauncher.title')}</p>
          {EDITOR_PANE_FILE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => launchKind(kind)}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 pointer-coarse:py-2.5"
            >
              <PaneKindGlyph kind={kind} className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(PANE_KIND_TEXT[kind].label)}</span>
                <span className="block text-[12px] text-gray-500">{t(PANE_KIND_TEXT[kind].desc)}</span>
              </span>
            </button>
          ))}

          <div className="my-1 border-t border-gray-800" />

          <p className="px-2 pb-0.5 pt-0.5 text-xs font-semibold text-gray-500">{t('ide.paneLauncher.runOutput')}</p>
          {runs.length === 0 ? (
            // 흐린 줄 하나가 이유를 말한다 — 누를 것이 없는데 눌리는 줄을 세우지 않는다.
            <p className="px-2 pb-1 text-[12px] text-gray-600">{t('ide.paneLauncher.runOutputNone')}</p>
          ) : runs.map((run) => (
            <button
              key={run.runId}
              type="button"
              role="menuitem"
              onClick={() => showRun(run.runId)}
              title={run.command}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 pointer-coarse:py-2.5"
            >
              <RunOutputGlyph className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate">{run.name}</span>
              <span className={`flex flex-shrink-0 items-center gap-1 text-[12px] ${run.status === 'exited' ? 'text-gray-500' : 'text-emerald-300'}`}>
                {run.status !== 'exited' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
                {run.status === 'exited'
                  ? t('ide.debug.exitCode', { code: run.exitCode ?? '—' })
                  : t('ide.debug.running')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
