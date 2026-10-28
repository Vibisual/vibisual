import { toRelativeFromRoot } from './explorerModel.js';
import { lineRangeOf, type EditorLineRange } from './editorLineRange.js';

/**
 * §5.5 #17-27 ⑬ 본문 속 경로 손잡이의 1차 체(순수) — 명백히 경로가 아닌 것(공백 든 명령·URL·CLI 플래그·코드 조각)을 거르고 루트 기준으로 되돌린다.
 * **최종 판정은 디스크가 한다**(`GET /api/workspace-path`) — 모양만으로 단정하면 누를 수 없는 가짜 손잡이가 생긴다(⑬ (b)).
 */

/**
 * 인라인 코드 조각에서 뽑은 경로 후보. `scope` 로 타입을 가른다(⑬ (d)) — `inside` 는 여덟 갈래(§5.13 (R-7)), `outside` 는 탐색기 하나뿐.
 * 한 모양이면 한 곳만 따짐이 빠져도 본문 글자로 임의 경로를 실행하는 길이 열린다 — 타입이면 컴파일러가 막는다.
 */
export type StreamPathCandidate =
  | {
      readonly scope: 'inside';
      /** 루트 기준 상대 경로(forward slash, 앞뒤 구분자 제거). `''` = 프로젝트 루트 자신. */
      readonly relPath: string;
      /**
       * 원문에서 떼어 낸 줄 범위(`경로:42` · `경로:42:7` · `경로:42-51` · 링크 조각 `#L42-L51`). 없으면 null.
       * 경로 판정에는 쓰지 않고((b) — 디스크는 경로만 본다), **열 때** 편집창을 그 줄로 데려간다(⑬ (g)).
       */
      readonly lines: EditorLineRange | null;
    }
  | {
      readonly scope: 'outside';
      /** 루트 밖 절대 경로(forward slash 로 정규화, 뒤 구분자 제거). 탐색기에 그대로 넘긴다. */
      readonly absPath: string;
      /** `inside` 쪽과 같은 모양 — 루트 밖은 탐색기 하나뿐이라(⑬ (d)) 여는 데는 쓰이지 않는다. */
      readonly lines: EditorLineRange | null;
    };

/** 경로로 보기엔 너무 긴 조각(Windows MAX_PATH). 이보다 길면 본문 문장이지 위치가 아니다. */
const MAX_PATH_LEN = 260;

/**
 * ⑬ (k) — **명시된** 경로(마크다운 링크의 목적지)에 쓰는 상한. 1차 체를 지나지 않는 자리라
 * 모양으로 걸러 낼 것이 없으므로 길이만 본다. `MAX_PATH_LEN` 보다 넉넉한 이유는 win32 긴 경로
 * (`\\?\` 없이도 32767 까지 열리는 트리)와 퍼센트 복호 전 길이를 함께 받기 위함이다.
 */
const MAX_LINK_PATH_LEN = 1024;

/** 하나라도 있으면 경로 후보에서 뺀다 — 파일명에 못 쓰는 문자와, 본문에선 거의 늘 명령·코드 문법인 문자(공백·괄호·등호…). 공백 든 경로는 잃는다. */
const NON_PATH_CHARS = /[\s"'`<>|*?()[\]{}=;,!$&^~+]/;

/** 절대 경로 전용 느슨한 체 — 보통 공백은 허용한다(`Unreal Projects` 같은 폴더가 흔하다). 드라이브 머리·앞 슬래시로 시작할 때만 쓰고, 남는 오탐은 디스크가 거른다. */
const NON_PATH_CHARS_ABS = /[\t\n\r\v\f"'`<>|*?()[\]{}=;,!$&^~+]/;

/** 원문(역슬래시 그대로) 기준으로 "절대 경로처럼 시작하는가". 공백 허용 여부를 이걸로 가른다. */
const ABS_HEAD = /^(?:[A-Za-z]:[\\/]|\/)/;

/**
 * `경로:42` · `경로:42:7`(열은 버린다) · `경로:42-51`(범위) — 뒤에 붙은 줄 표기.
 * 범위의 대시는 en dash(`–`)도 받는다 — 에이전트가 문장 속 범위를 그렇게 적는 일이 있다.
 */
const LINE_SUFFIX = /^(.*?):(\d+)(?:[-–](\d+)|:\d+)?$/;

/** `C:/repo` · `D:\repo` — Windows 절대 경로의 드라이브 머리. */
const WIN_DRIVE = /^[A-Za-z]:\//;

/** 확장자 — 글자로 시작하는 것만 센다(`0.1.8` 같은 판올림 번호를 파일로 오인하지 않게). */
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/** 인라인 코드 조각 하나를 경로 후보로(아니면 null). `rootPath` 가 없으면 아무것도 손잡이가 되지 않는다(상대 경로의 트리를 정할 수 없다). */
export function parseStreamPathCandidate(raw: string, rootPath: string | null): StreamPathCandidate | null {
  if (!rootPath) return null;

  const text = raw.trim();
  if (!text || text.length > MAX_PATH_LEN) return null;
  if ((ABS_HEAD.test(text) ? NON_PATH_CHARS_ABS : NON_PATH_CHARS).test(text)) return null;
  // CLI 플래그(`--effort`) · npm 스코프(`@vibisual/shared`) · 앵커(`#17-27`) — 셋 다 경로가 아니다.
  if (text.startsWith('-') || text.startsWith('@') || text.startsWith('#')) return null;
  if (text.includes('://')) return null;

  return toStreamPathCandidate(text, rootPath);
}

/** ⑬ (k) ② — 이미 경로로 확정된 글자(링크 목적지)를 후보로. `NON_PATH_CHARS` 체를 지나지 않는다(공백·괄호 든 실제 이름을 잃는다). 최종 판정은 디스크. */
export function toStreamPathCandidate(raw: string, rootPath: string | null): StreamPathCandidate | null {
  if (!rootPath) return null;

  const text = raw.trim();
  // 명시된 경로라도 상한은 둔다 — 긴 쪽 여유는 주되(win32 긴 경로), 본문 문장이 통째로 들어오는 것은 막는다.
  if (!text || text.length > MAX_LINK_PATH_LEN) return null;

  // (g) 줄 표기를 먼저 떼어 낸다 — 경로 판정은 경로만 보고, 줄은 들고 가서 열 때 쓴다.
  const { body, lines } = splitLineSuffix(text);

  const norm = body.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!norm) return null;

  const isWinAbs = WIN_DRIVE.test(norm);
  const isPosixAbs = norm.startsWith('/');
  // 드라이브 머리 말고 콜론이 남아 있으면 경로가 아니다(`http:8080` · `Note: something`).
  if (isWinAbs ? norm.slice(2).includes(':') : norm.includes(':')) return null;

  // 경로로 읽히려면 구분자가 있거나, 확장자로 끝나는 이름이어야 한다.
  if (!norm.includes('/') && !FILE_EXT.test(norm)) return null;

  if (isWinAbs || isPosixAbs) {
    // `toRelativeFromRoot` 는 루트 밖이면 절대 경로를 **그대로** 돌려주므로 그것이 곧 안/밖 판정이다.
    const rel = toRelativeFromRoot(norm, rootPath);
    // ⑬ (d) — 루트 밖은 갈 곳이 탐색기 하나라 절대 경로 그대로 들고 간다.
    if (rel === norm && rel !== '') return { scope: 'outside', absPath: norm, lines };
    return { scope: 'inside', relPath: rel, lines };
  }

  const relPath = norm.replace(/^\.\//, '');
  // 상위로 거슬러 오르는 표기는 여기서 끊는다 — 기준이 되는 루트가 어디인지에 따라 가리키는 곳이
  // 달라지므로, "루트 밖"으로 넘겨도 어느 절대 경로인지 확정할 수 없다.
  if (relPath === '..' || relPath.startsWith('../')) return null;
  if (relPath === '.') return null;

  return { scope: 'inside', relPath, lines };
}

/**
 * 끝의 줄 표기를 뗀다(`a.ts:42-51`). 앞 토막이 한 글자면 드라이브(`C:`)라 두고, 줄로 못 쓰는 값(`a.ts:0`)은 떼기만 한다.
 * 링크 글자(`streamLinkHref.ts`)도 이 함수를 쓴다 — 두 벌이면 한쪽만 범위 표기를 안다.
 */
export function splitLineSuffix(text: string): { body: string; lines: EditorLineRange | null } {
  const m = LINE_SUFFIX.exec(text);
  if (!m || m[1] === undefined || m[1].length <= 1) return { body: text, lines: null };
  return { body: m[1], lines: lineRangeOf(Number(m[2]), m[3] === undefined ? null : Number(m[3])) };
}
