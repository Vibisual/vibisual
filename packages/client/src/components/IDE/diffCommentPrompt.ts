/**
 * §5.5 #17-30 — diff 줄에 단 리뷰 코멘트를 **명령 하나**로 조립하는 순수 모듈.
 *
 * 배경: 스트림의 Edit/Write diff 는 읽기 전용이라, 고칠 곳을 본 사용자가 파일 이름과 줄 내용을
 * 눈으로 옮겨 적어 입력창에 다시 썼다. 코멘트를 그 자리에 달게 하되, **한 건씩 보내지는 않는다**
 * — 코멘트 N개가 턴 N개가 되면 #17-18 덧말 합치기가 풀려던 문제가 그대로 돌아온다.
 *
 * 조립 규칙을 컴포넌트가 아니라 여기 한 곳에 두는 이유는 `sessionLoopPrompt.ts` / `turnPrompt.ts`
 * 선례와 같다 — 화면 없이 시험할 수 있어야 형식이 조용히 어긋나지 않는다.
 */

/** 코멘트 한 건 — 화면 좌표가 아니라 **코드 좌표**로 남긴다(파일·줄·그 줄 원문). */
export interface DiffComment {
  id: string;
  /** diff 헤더의 파일 경로 **그대로**(정규화·절대경로 변환 ❌ — 화면과 명령이 같은 문자열이어야 한다). */
  filePath: string;
  /** 왼쪽(이전 코드) 줄인지 오른쪽(고친 코드) 줄인지. */
  side: 'before' | 'after';
  /** 그 줄 번호. diff 빈 칸(대응 줄 없음)이면 null. */
  lineNo: number | null;
  /** 그 줄 원문. */
  lineText: string;
  /** 사용자가 적은 코멘트. */
  comment: string;
  createdAt: number;
}

/** 인용 줄이 프롬프트를 삼키지 않게 하는 상한 — 넘으면 뒤를 자르고 말줄임. */
export const DIFF_COMMENT_LINE_MAX = 200;

/** 코멘트 id — 같은 ms 에 두 건이 생겨도 겹치지 않게 난수 꼬리를 붙인다. */
export function makeDiffCommentId(): string {
  return `dc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 한 줄 인용 — 개행을 없애고(한 줄이어야 인용 모양이 산다) 길면 자른다. */
function quoteLine(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ').trimEnd();
  return flat.length > DIFF_COMMENT_LINE_MAX ? `${flat.slice(0, DIFF_COMMENT_LINE_MAX)}…` : flat;
}

/** `path:12` — 줄 번호를 모르면 경로만. */
function locationOf(c: DiffComment): string {
  return c.lineNo === null ? c.filePath : `${c.filePath}:${c.lineNo}`;
}

/**
 * 코멘트 목록 → 명령 텍스트.
 *
 * `header` 는 화면에서 번역된 문장을 그대로 받는다(모듈이 언어를 정하지 않는다 — i18n 규칙).
 * 코멘트가 없으면 빈 문자열을 돌려주고, 호출부는 그때 아무 것도 보내지 않는다.
 */
export function buildDiffCommentPrompt(comments: readonly DiffComment[], header: string): string {
  if (comments.length === 0) return '';
  const body = comments
    .map((c, i) => {
      const quoted = quoteLine(c.lineText);
      const lines = [`${i + 1}. ${locationOf(c)}`];
      if (quoted !== '') lines.push(`   > ${quoted}`);
      lines.push(`   ${c.comment.trim()}`);
      return lines.join('\n');
    })
    .join('\n\n');
  return `${header}\n\n${body}`;
}
