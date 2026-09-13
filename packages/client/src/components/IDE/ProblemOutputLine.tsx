/**
 * §5.5 #17-20 ⑪ · #17-17 ⑪(j) — **출력 한 줄을 진단으로 읽는 공용 조각.**
 *
 * 공통 매처(`matchProblemLine`)가 "파일:줄:열 + 심각도"를 뽑으면 줄이 색을 얻고, 파일이 잡히고
 * 그것이 프로젝트 안이면 **눌러서 내장 편집창의 그 파일로 연다**. node·tsc·eslint·python·go·
 * rust·MSVC·gcc/clang·java·**언리얼 로그**가 전부 같은 표를 타므로 여기에 런타임 분기는 없다.
 *
 * 실행 출력 패널(#17-20)이 쓰던 것을 그대로 빼냈다 — 무대(#17-17 ⑪ 의 `log` 화면)가 같은 줄을
 * 그려야 하는데, 두 벌로 두면 한쪽만 색이 바뀌거나 한쪽만 언리얼을 못 읽는 날이 온다.
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
  /** 프로젝트 안의 파일이 잡혔을 때만 불린다. 없으면 줄은 색만 얻는다. */
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
