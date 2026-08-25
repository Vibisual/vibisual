import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RUN_OUTPUT_BUFFER_LINES, matchProblemLine } from '@vibisual/shared';

import { useGraphStore, selectIDEPane } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';
import { toWorkspaceRelative } from './debugPaths.js';

import { getRunTail, stopRun, useRunSessions } from '../../stores/runSessions.js';

/**
 * §5.5 #17-20 ④ v4.74 — 실행 출력 패널(세션 영역을 덮는다 — 북마크·세션 요약 패널과 같은 자리).
 *
 * 왜 xterm 이 아니라 텍스트인가: 살아 있는 PTY 는 재부착으로 scrollback 을 replay 받을 수 있지만
 * **이미 끝난 실행**은 PTY 가 사라져 다시 붙을 대상이 없다. 그때 `create` 를 부르면 명령이 한 번
 * 더 실행된다 — 실패 로그를 보려다 실패한 서버를 또 띄우는 셈이다. 그래서 살아 있든 끝났든
 * 같은 창구(우리 링버퍼)로 그린다. 색은 잃지만 동작은 하나이고 예측 가능하다.
 */
/** 심각도 → 색. 표에 안 걸린 줄은 색을 얻지 않는다(모르는 것을 아는 척 칠하지 않는다). */
const SEVERITY_CLASS: Record<'error' | 'warning' | 'info', string> = {
  error: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300/80',
};

/**
 * §5.5 #17-20 ⑪ v4.94 — 출력 한 줄.
 *
 * 공통 매처(`matchProblemLine`)가 "파일:줄:열 + 심각도" 를 뽑으면 색을 얻고, 파일이 잡히고
 * 그것이 프로젝트 안이면 **눌러서 내장 편집창의 그 줄로 연다**. node·tsc·python·go·rust·
 * MSVC·언리얼이 전부 같은 표를 타므로 이 컴포넌트에는 런타임 분기가 없다.
 */
const OutputLine = memo(function OutputLine({
  line,
  root,
  onOpen,
}: {
  line: string;
  root: string | null;
  onOpen: (relPath: string) => void;
}): React.JSX.Element {
  const problem = useMemo(() => matchProblemLine(line), [line]);
  const relPath = useMemo(
    () => (problem?.file && root ? toWorkspaceRelative(problem.file, root) : null),
    [problem, root],
  );
  const tone = problem ? SEVERITY_CLASS[problem.severity] : undefined;

  if (relPath) {
    return (
      <div
        onClick={() => onOpen(relPath)}
        className={`cursor-pointer whitespace-pre-wrap break-all underline decoration-dotted underline-offset-2 hover:bg-gray-800/60 ${tone ?? ''}`}
      >
        {line}
      </div>
    );
  }
  return <div className={`whitespace-pre-wrap break-all ${tone ?? ''}`}>{line.length > 0 ? line : ' '}</div>;
});

export const IDERunOutputPanel = memo(function IDERunOutputPanel({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const runId = useRunSessions((s) => s.outputRunId);
  const session = useRunSessions((s) => (s.outputRunId ? s.sessions[s.outputRunId] : undefined));
  const outputVersion = useRunSessions((s) => s.outputVersion);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  // ⑪ — 오류 줄을 눌렀을 때 열 파일의 기준(프로젝트 루트). 없으면 줄은 색만 얻고 클릭은 없다.
  const paneKey = useIDEPaneKey();
  const rootPath = useGraphStore((s) => {
    const name = selectIDEPane(s, paneKey).projectId ?? s.activeProject;
    if (!name) return null;
    return s.projects[name]?.path ?? s.stubProjects[name]?.project.path ?? null;
  });
  const openEditorFile = useGraphStore((s) => s.openIDEEditorFile);

  const handleOpenProblemFile = useCallback(
    (relPath: string) => {
      if (!rootPath) return;
      openEditorFile({
        relPath,
        absPath: `${rootPath}/${relPath}`,
        name: relPath.split('/').pop() ?? relPath,
      }, paneKey);
    },
    [rootPath, openEditorFile, paneKey],
  );

  const lines = useMemo(
    () => (runId ? getRunTail(runId, RUN_OUTPUT_BUFFER_LINES) : []),
    // outputVersion 이 오르면 링버퍼를 다시 읽는다(버퍼 자체는 스토어 밖에 있다).
    [runId, outputVersion],
  );

  // 바닥 추종 — 사용자가 위로 올리면 끄고, 다시 바닥에 닿으면 켠다.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  }, []);

  useLayoutEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(lines.join('\n')).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* 클립보드 거부 — 조용히 무시 */ },
    );
  }, [lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!runId || !session) return null;

  const running = session.status !== 'exited';
  const failed = !running && (session.exitCode ?? 0) !== 0;

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* 머리 — 무엇이 돌고 있는지 + 조작 */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-gray-200">{session.name}</span>
          <span className="block truncate font-mono text-[12px] text-gray-500" title={session.command}>
            {session.command}
          </span>
        </span>
        {running ? (
          <span className="flex items-center gap-1 text-[12px] text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            {t('ide.debug.running')}
          </span>
        ) : (
          <span className={`text-[12px] ${failed ? 'text-rose-400' : 'text-gray-500'}`}>
            {t('ide.debug.exitCode', { code: session.exitCode ?? 0 })}
          </span>
        )}
        {running && (
          <button
            type="button"
            onClick={() => void stopRun(runId)}
            className="rounded bg-gray-800 px-2 py-1 text-[12px] text-rose-300 transition-colors hover:bg-gray-700"
          >
            {t('ide.debug.stop')}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="rounded bg-gray-800 px-2 py-1 text-[12px] text-gray-300 transition-colors hover:bg-gray-700"
        >
          {copied ? t('ide.debug.copied') : t('ide.debug.copy')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.debug.close')}
          aria-label={t('ide.debug.close')}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 본문 — 줄 단위 텍스트(고정폭). */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-300"
      >
        {lines.length === 0 ? (
          <p className="text-gray-600">{t('ide.debug.noOutput')}</p>
        ) : (
          lines.map((line, i) => (
            // 줄 순서가 곧 정체성이라 index 키가 맞다(중간 삽입·정렬이 없고 뒤로만 늘어난다).
            <OutputLine key={i} line={line} root={rootPath} onOpen={handleOpenProblemFile} />
          ))
        )}
      </div>
    </div>
  );
});
