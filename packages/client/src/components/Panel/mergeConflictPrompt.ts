/** §7.6 — 합치기 충돌을 그 워크트리 에이전트에게 넘길 명령 조립(순수 모듈). 서버가 `merge --abort` 로 원복해 두므로 할 일은 자기 브랜치 고치기. */

/** 명령에 실을 충돌 파일 수 상한 — 넘으면 잘라 내고 "+N" 으로 말한다. */
export const MERGE_CONFLICT_FILES_MAX = 40;

export interface MergeConflictPrompt {
  /** 워크트리 브랜치 이름. */
  branch: string;
  /** 부모(본선) 브랜치 이름 — 모르면 생략. */
  baseBranch?: string | undefined;
  /** `git diff --name-only --diff-filter=U` 결과. */
  conflicts: readonly string[];
}

/** 충돌 → 명령 텍스트. `header` 는 번역된 지시문(모듈이 언어를 안 정한다). 파일이 없으면 빈 문자열 — 호출부는 안 보낸다. */
export function buildMergeConflictPrompt(input: MergeConflictPrompt, header: string): string {
  const files = input.conflicts.map((f) => f.trim()).filter((f) => f !== '');
  if (files.length === 0) return '';
  const shown = files.slice(0, MERGE_CONFLICT_FILES_MAX);
  const hidden = files.length - shown.length;
  const lines = [
    header,
    '',
    input.baseBranch !== undefined && input.baseBranch !== ''
      ? `merge: ${input.branch} -> ${input.baseBranch}`
      : `merge: ${input.branch}`,
    'conflicts:',
    ...shown.map((f) => `- ${f}`),
  ];
  if (hidden > 0) lines.push(`- … +${hidden}`);
  return lines.join('\n');
}
