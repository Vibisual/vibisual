/**
 * §7.6 (판올림 번호 발급 대기) — 워크트리를 본선으로 합치다 **충돌**했을 때, 그 충돌을 그
 * 워크트리에서 일하던 에이전트에게 그대로 넘기기 위한 명령 조립(순수 모듈).
 *
 * 서버는 충돌 시 부모를 `merge --abort` 로 원복해 두므로, 이 명령을 받은 에이전트가 할 일은
 * "합쳐질 수 있게 자기 브랜치를 고치는 것"이다 — 사람이 파일 목록을 손으로 옮겨 적지 않는다.
 *
 * 조립을 컴포넌트가 아니라 여기 두는 이유는 `diffCommentPrompt.ts` 와 같다(화면 없이 시험).
 */

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

/**
 * 충돌 정보 → 명령 텍스트.
 *
 * `header` 는 번역된 지시문을 그대로 받는다(모듈이 언어를 정하지 않는다 — i18n 규칙).
 * 충돌 파일이 하나도 없으면 빈 문자열을 돌려주고, 호출부는 그때 아무 것도 보내지 않는다.
 */
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
