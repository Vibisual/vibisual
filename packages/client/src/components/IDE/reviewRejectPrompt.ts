/** §5.16 — 리뷰 반려 사유를 같은 에이전트의 다음 프롬프트로(사유 + 보고 반려한 브랜치·파일 목록). 순수 조립, `header` 는 번역된 지시문을 받는다. */
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

/** 반려 사유 → 명령 텍스트. 사유가 비면 빈 문자열이고 호출부는 보내지 않는다(서버도 사유 없는 반려를 받지 않는다). */
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
