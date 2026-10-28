/**
 * §5.5 #17-20 ⑪ · #17-17 ⑪(j) — 출력 한 줄을 진단으로 읽는 공용 조각(`matchProblemLine`). 프로젝트 안 파일이면 눌러 편집창으로.
 * 실행 출력 패널과 무대 `log` 화면이 함께 쓴다 — 두 벌로 두지 마라.
 */
import React, { memo, useMemo } from 'react';
import { matchProblemLine } from '@vibisual/shared';
import { toWorkspaceRelative } from './debugPaths.js';

/** 심각도 → 색. 표에 안 걸린 줄은 색을 얻지 않는다(모르는 것을 아는 척 칠하지 않는다). */
export const SEVERITY_CLASS: Record<'error' | 'warning' | 'info', string> = {
  error: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300/80',
};

export const ProblemOutputLine = memo(function ProblemOutputLine({
  line,
  root,
  onOpen,
}: {
  line: string;
  root: string | null;
  /**
   * 프로젝트 안의 파일이 잡혔을 때만 불린다. 없으면 줄은 색만 얻는다.
   * `lineNo` 는 매처가 뽑은 줄 번호(없으면 undefined) — 편집창이 그 줄로 간다(#17-27 ⑬ (g) 와 같은 한 길).
   */
  onOpen: (relPath: string, lineNo?: number) => void;
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
        onClick={() => onOpen(relPath, problem?.line)}
        className={`cursor-pointer whitespace-pre-wrap break-all underline decoration-dotted underline-offset-2 hover:bg-gray-800/60 ${tone ?? ''}`}
      >
        {line}
      </div>
    );
  }
  return <div className={`whitespace-pre-wrap break-all ${tone ?? ''}`}>{line.length > 0 ? line : ' '}</div>;
});
