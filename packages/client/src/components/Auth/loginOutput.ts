/**
 * §4 v4.82 — `claude auth login` PTY 출력 훑기 (순수 함수).
 *
 * 로그인 팝업은 터미널 화면 대신 **버튼과 입력칸**을 보여주려고 이 스캐너를 쓴다. 다만 성공 판정은
 * 여기 결과가 아니라 `claude auth status` 재조회가 1차 근거다 — CLI 문구가 바뀌어도 로그인 흐름
 * 자체는 안 깨지게(여기서 못 알아보면 팝업이 터미널을 펼쳐 사용자가 직접 응답한다).
 *
 * 순수 함수로 떼어 둔 이유는 문구 규칙을 화면 없이 단위 테스트로 고정하기 위함
 * (`floatingWindowGeom` 이 좌표 계산을 그렇게 다뤘던 것과 같은 결).
 */

export interface LoginScan {
  /** 브라우저에서 열 OAuth 승인 URL. */
  url?: string;
  /** "코드를 붙여넣어라" 프롬프트가 떴는가. */
  wantsCode?: boolean;
  /** 성공 문구가 보였는가 (보조 신호 — 확정은 status 재조회). */
  succeeded?: boolean;
  /** 실패/취소 문구가 보였는가. */
  failed?: boolean;
}

// 제어문자는 소스에 그대로 박지 않는다(에디터·도구마다 다르게 보이고 조용히 유실된다).
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BACKSLASH = String.fromCharCode(92);

/** CSI 종결 바이트(@ ~ ~). */
function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/**
 * OSC 본문 처리 — `8;params;URL` (하이퍼링크)이면 URL 만 본문에 남기고,
 * 그 밖의 OSC(창 제목 설정 등)는 통째로 버린다.
 */
function oscPayload(body: string): string {
  if (!body.startsWith('8;')) return '';
  const second = body.indexOf(';', 2);
  return second >= 0 ? body.slice(second + 1) : '';
}

/**
 * ANSI 시퀀스 제거 — TUI 가 색·커서 이동을 섞어 찍어도 문구·URL 이 끊기지 않게.
 * 정규식 대신 스캐너인 이유: OSC 종결(BEL / ESC-백슬래시)까지 다루려면 이스케이프가 깊어져
 * 소스가 오히려 깨지기 쉬워진다.
 */
export function stripAnsi(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch !== ESC) {
      out += ch;
      i += 1;
      continue;
    }
    const next = raw.charAt(i + 1);
    if (next === '[') {
      i += 2;
      while (i < raw.length && !isCsiFinal(raw.charCodeAt(i))) i += 1;
      i += 1; // 종결 바이트 소비
      continue;
    }
    if (next === ']') {
      const bodyStart = i + 2;
      let j = bodyStart;
      while (
        j < raw.length &&
        raw.charAt(j) !== BEL &&
        !(raw.charAt(j) === ESC && raw.charAt(j + 1) === BACKSLASH)
      ) j += 1;
      out += oscPayload(raw.slice(bodyStart, j));
      i = raw.charAt(j) === BEL ? j + 1 : j + 2;
      continue;
    }
    if (next === '(' || next === ')') {
      i += 3; // 문자셋 지정 — ESC ( B 처럼 3바이트
      continue;
    }
    i += 2; // 그 밖의 2바이트 시퀀스
  }
  return out;
}

/** 줄바꿈으로 잘린 URL 잇기 — 쿼리스트링 도중에 끊긴 줄만 이어 붙인다. */
function joinWrapped(text: string): string {
  return text.replace(/\r/g, '\n').replace(/([?&=/][^\s]*)\n(?=[^\s])/g, '$1');
}

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;
/** OAuth 승인 URL 로 볼 만한 호스트/경로 — 잡다한 안내 링크(docs 등)를 고르지 않게. */
const URL_PREFERRED = /(oauth|authorize|login|claude\.ai|console\.anthropic\.com)/i;
const CODE_RE = /(paste[^\n]*code|enter[^\n]*code|authorization code|code\s*(?:here)?\s*[:>])/i;
const SUCCESS_RE = /(login successful|logged in|signed in|authentication successful|you are now logged)/i;
const FAILED_RE = /(login failed|authentication failed|sign[- ]?in failed|invalid code|cancell?ed|timed out)/i;

/** 끝의 구두점은 URL 이 아니라 문장 부호일 때가 많다. */
function trimTrailing(url: string): string {
  return url.replace(/[.,;:'"]+$/, '');
}

export function scanLoginOutput(raw: string): LoginScan {
  const text = joinWrapped(stripAnsi(raw));
  const scan: LoginScan = {};

  const urls = text.match(URL_RE)?.map(trimTrailing).filter((u) => u.length > 12) ?? [];
  if (urls.length > 0) {
    // 마지막에 나온 것을 우선 — 재시도로 새 URL 이 찍히면 그쪽이 유효하다.
    const preferred = [...urls].reverse().find((u) => URL_PREFERRED.test(u));
    scan.url = preferred ?? urls[urls.length - 1];
  }
  if (CODE_RE.test(text)) scan.wantsCode = true;
  if (SUCCESS_RE.test(text)) scan.succeeded = true;
  if (FAILED_RE.test(text)) scan.failed = true;
  // 성공 문구가 실패 흔적보다 뒤에 나왔으면(재시도 성공) 실패 표시는 지운다.
  if (scan.succeeded && scan.failed) {
    if (text.search(SUCCESS_RE) > text.search(FAILED_RE)) delete scan.failed;
  }
  return scan;
}
