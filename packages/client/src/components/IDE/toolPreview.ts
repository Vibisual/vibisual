/**
 * toolPreview.ts — §5.5 #17-13 도구 input → **사람이 읽는 한 줄 요약**(순수 로직).
 *
 * 배경(사용자 스크린샷): 접힌 도구 상자 미리보기에 `{"command":"cd c:/Users/…/vibisual && python - <<'PY'…`
 * 같은 **원본 JSON** 이 그대로 떠 화면을 채웠다. 원인은 두 가지다 — (1) JSON 파싱이 실패하면(스트림 절단·
 * heredoc 등) 입력 문자열을 통째로 미리보기로 쓰던 폴백, (2) 사용자에게 아무 의미 없는 `cd <절대경로> &&`
 * 앞머리. 여기서 둘 다 걷어낸다.
 *
 * Sub 탭(StreamRenderer)과 메인 탭(IDEMainArea)이 **같은 함수**를 쓴다(종전 두 곳 중복 구현 제거).
 */

/** 미리보기로 뽑을 input 필드 — 앞에 있는 것부터 우선. */
const PREVIEW_FIELDS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'] as const;

/** 기본 최대 길이(넘으면 말줄임). */
export const TOOL_PREVIEW_MAX = 80;

/** JSON 문자열 리터럴 이스케이프 해제(따옴표로 감싸 파싱 — 실패하면 원문 그대로). */
function unescapeJsonString(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(`"${raw}"`);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

/**
 * JSON 파싱이 실패한 입력에서도 주요 필드를 뽑아내는 정규식 폴백.
 * 닫는 따옴표가 있는 정상 형태를 먼저 보고, 없으면(스트림이 중간에 잘림) **열린 채로 끝까지** 읽는다 —
 * 실제로 화면에 원본 JSON 이 뜨던 경우가 바로 이 "닫히지 않은" 입력이었다.
 */
function extractByRegex(input: string): string | null {
  for (const field of PREVIEW_FIELDS) {
    const closed = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const m = closed.exec(input);
    if (m && m[1]) return unescapeJsonString(m[1]);
  }
  for (const field of PREVIEW_FIELDS) {
    const open = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)$`);
    const m = open.exec(input);
    if (m && m[1]) return unescapeJsonString(m[1]);
  }
  return null;
}

/** 사람이 읽기 좋은 한 줄로 — `cd <경로> &&` 앞머리 제거 + 줄바꿈/연속 공백 접기 + 말줄임. */
export function tidyPreviewLine(raw: string, maxLen: number = TOOL_PREVIEW_MAX): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  // `cd /abs/path &&` / `cd "C:\path" &&` 반복 제거 — 사용자에게 의미 없는 경로 잡음.
  let prev = '';
  while (prev !== text) {
    prev = text;
    text = text.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/i, '');
  }
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/**
 * 도구 input(JSON 문자열 또는 임의 텍스트) → 한 줄 미리보기.
 * 뽑을 필드가 없으면 입력 자체를 정리해 보여준다(원본 JSON 노출은 피할 수 없을 때만).
 */
export function toolPreview(input: string | undefined, maxLen: number = TOOL_PREVIEW_MAX): string {
  if (!input) return '';
  let picked: string | null = null;
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed === 'object' && parsed !== null) {
      const rec = parsed as Record<string, unknown>;
      for (const field of PREVIEW_FIELDS) {
        const v = rec[field];
        if (typeof v === 'string' && v.trim() !== '') { picked = v; break; }
      }
    } else if (typeof parsed === 'string') {
      picked = parsed;
    }
  } catch {
    picked = extractByRegex(input);
  }
  return tidyPreviewLine(picked ?? input, maxLen);
}
