import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RUN_OUTPUT_BUFFER_LINES } from '@vibisual/shared';

import { useGraphStore, selectPaneProjectPath } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';
import { ProblemOutputLine } from './ProblemOutputLine.js';
import { lineRangeOf } from './editorLineRange.js';

import { getRunTail, stopRun, useRunSessions } from '../../stores/runSessions.js';

/** §5.5 #17-20 ④ — 실행 출력 패널. xterm 이 아니라 우리 링버퍼 텍스트로 그린다 — 끝난 실행은 재부착할 PTY 가 없고, `create` 를 부르면 명령이 다시 실행된다. */
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
  const rootPath = useGraphStore((s) => selectPaneProjectPath(s, paneKey));
  const openEditorFile = useGraphStore((s) => s.openIDEEditorFile);

  const handleOpenProblemFile = useCallback(
    (relPath: string, lineNo?: number) => {
      if (!rootPath) return;
      // ⑪ — 매처가 뽑은 줄로 연다(#17-27 ⑬ (g) 의 본문 링크와 같은 한 길).
      openEditorFile({
        relPath,
        absPath: `${rootPath}/${relPath}`,
        name: relPath.split('/').pop() ?? relPath,
      }, paneKey, lineNo === undefined ? null : lineRangeOf(lineNo));
      onClose();
    },
    [rootPath, openEditorFile, paneKey, onClose],
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

  if (!runId || !session) return null;

  const running = session.status !== 'exited';
  const failed = !running && (session.exitCode ?? 0) !== 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gray-950">
      {/* 머리 — 무엇이 돌고 있는지 + 조작 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 px-3 py-2">
        <span className="min-w-0 flex-1 basis-40">
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
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300 pointer-coarse:p-2.5"
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
            <ProblemOutputLine key={i} line={line} root={rootPath} onOpen={handleOpenProblemFile} />
          ))
        )}
      </div>
    </div>
  );
});
