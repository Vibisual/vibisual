/**
 * §5.16 — 리뷰를 **반려**했을 때, 그 사유를 그대로 같은 에이전트의 다음 프롬프트로 만드는 조립(순수 모듈).
 *
 * 반려는 "다시 해"가 아니라 "이래서 안 된다, 이걸 고쳐라"다 — 사유가 명령의 본문이고, 어떤 변경분을
 * 보고 반려했는지(브랜치·파일 목록)가 맥락으로 함께 실린다. 사람이 파일 이름을 손으로 옮겨 적지 않는다.
 *
 * 조립을 컴포넌트가 아니라 여기 두는 이유는 `mergeConflictPrompt.ts`·`diffCommentPrompt.ts` 와 같다
 * (화면 없이 시험한다). `header` 는 번역된 지시문을 그대로 받는다 — 모듈이 언어를 정하지 않는다.
 */
import { REVIEW_REJECT_FILES_MAX } from '@vibisual/shared';

export interface ReviewRejectPromptInput {
  /** 반려 사유 — 사람이 쓴 문장. 이것이 명령의 본문이다. */
  reason: string;
  /** 워크트리 브랜치 이름(모르면 생략). */
  branch?: string | undefined;
  /** 합쳐질 부모 브랜치 이름(모르면 생략). */
  baseBranch?: string | undefined;
  /** 반려한 변경분의 파일 경로 목록. */
  files?: readonly string[] | undefined;
}

/**
 * 반려 사유 → 명령 텍스트.
 *
 * 사유가 비면 **빈 문자열**을 돌려주고, 호출부는 그때 아무 것도 보내지 않는다(사유 없는 반려는
 * 에이전트가 고칠 근거가 없다 — 서버도 같은 이유로 사유 없는 반려를 받지 않는다).
 */
export function buildReviewRejectPrompt(input: ReviewRejectPromptInput, header: string): string {
  const reason = input.reason.trim();
  if (reason === '') return '';

  const lines: string[] = [header, '', reason];

  const branchLine = input.branch !== undefined && input.branch !== ''
    ? (input.baseBranch !== undefined && input.baseBranch !== ''
        ? `review: ${input.branch} -> ${input.baseBranch}`
        : `review: ${input.branch}`)
    : null;
  if (branchLine !== null) lines.push('', branchLine);

  const files = (input.files ?? []).map((f) => f.trim()).filter((f) => f !== '');
  if (files.length > 0) {
    const shown = files.slice(0, REVIEW_REJECT_FILES_MAX);
    const hidden = files.length - shown.length;
    if (branchLine === null) lines.push('');
    lines.push('files:');
    for (const f of shown) lines.push(`- ${f}`);
    if (hidden > 0) lines.push(`- … +${hidden}`);
  }

  return lines.join('\n');
}
