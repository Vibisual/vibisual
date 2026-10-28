import { defaultUrlTransform } from 'react-markdown';
import { splitLineSuffix, toStreamPathCandidate, type StreamPathCandidate } from './streamPathLinks.js';
import { lineRangeOf, type EditorLineRange } from './editorLineRange.js';

/**
 * §5.5 #17-27 ⑬ (k) 스트림 본문 마크다운 링크의 목적지 판정(순수). `window.open` 으로 가면 로컬 파일은 `file:` 이라 `ALLOWED_EXTERNAL_SCHEMES` 에 막힌다.
 * `streamUrlTransform` 세척 통과 · `parseLinkHrefCandidate` 후보 타입화(줄 조각은 줄 범위로) · `withLinkLabelLines` 링크 글자의 줄 빌리기.
 */

/** `C:\…` · `C:/…` — 드라이브 머리로 시작하는 Windows 절대 경로(스킴이 아니다). */
const WIN_DRIVE_HREF = /^[A-Za-z]:[\\/]/;

/** `file:` — 로컬 파일 주소(대소문자 무시). */
const FILE_SCHEME = /^file:/i;

/** `http://` · `https://` — 바깥 브라우저가 맡는 주소. */
const WEB_SCHEME = /^https?:\/\//i;

/** 주소 머리의 스킴(`mailto:` · `vscode:` · `C:` …). 한 글자면 스킴이 아니라 드라이브다. */
const SCHEME_HEAD = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** `/C:/…` — react-markdown 이 "상대 주소"로 판단해 그대로 흘려보낸 Windows 경로의 앞 슬래시. */
const SLASH_DRIVE = /^\/([A-Za-z]:[\\/])/;

/**
 * ⑬ (g) ① — 줄 조각. `#L806` · `#L806-L807` · `#L806-807` · `#L806C5-L807C2`(GitHub 와 같은 모양 —
 * 에이전트가 IDE 규약대로 줄을 가리킬 때 쓰는 그 꼴이다). 열(`C5` · `,5`)은 버린다 — 편집창은 줄 머리에 선다.
 */
const LINE_FRAGMENT = /^L(\d+)(?:[C,]\d+)?(?:-L?(\d+)(?:[C,]\d+)?)?$/i;

/**
 * ⑬ (k) ① — `defaultUrlTransform` 이 지우는 `file:`·`C:\…` 둘만 통과시킨다(`javascript:`·`data:` 는 그대로 지운다).
 * 구멍이 아니다 — 누름은 `MarkdownLink` 가 ⑬ 레일로 보내고, 가운데 클릭·이동은 본체의 `will-navigate`·`setWindowOpenHandler` 가 막는다(새 통로 ❌).
 */
export function streamUrlTransform(url: string): string {
  if (WIN_DRIVE_HREF.test(url) || FILE_SCHEME.test(url)) return url;
  return defaultUrlTransform(url);
}

/** 바깥 브라우저가 맡는 주소인가 — ⑬ (k) ④ 웹 링크 메뉴와 §7.11 loopback 프리뷰 신고의 조건. */
export function isWebLinkHref(href: string): boolean {
  return WEB_SCHEME.test(href.trim());
}

/** ⑬ (k) ② — 링크 목적지를 경로 후보로(웹 주소·메일·앵커면 null). 1차 체를 지나지 않는다 — 명시된 목적지라 막을 것이 없고, 체를 쓰면 공백·괄호 든 이름을 잃는다. */
export function parseLinkHrefCandidate(href: string, rootPath: string | null): StreamPathCandidate | null {
  const raw = href.trim();
  // 문서 안 앵커(`#설치`)는 이 글 안의 자리이지 디스크의 위치가 아니다.
  if (!raw || raw.startsWith('#')) return null;

  let text = raw;
  const scheme = SCHEME_HEAD.exec(text);
  if (scheme) {
    const name = scheme[1] ?? '';
    if (name.length === 1) {
      // `C:/…` — 스킴이 아니라 드라이브 머리다. 그대로 둔다.
    } else if (name.toLowerCase() === 'file') {
      text = stripFileScheme(text);
    } else {
      // http·https·mailto·vscode·vibproxy… — 경로로 읽지 않는다.
      return null;
    }
  }

  text = text.replace(SLASH_DRIVE, '$1');

  // 조각(`#top`)·질의(`?v=2`)는 파일 이름의 일부가 아니다. **퍼센트 복호보다 먼저** 떼어 내
  // 이름 안에 인코딩돼 있던 `%23`·`%3F` 가 구분자로 오인되지 않게 한다.
  // ⑬ (g) ① — 단, 떼어 낸 조각이 줄(`#L806-L807`)이면 버리지 않고 들고 간다.
  const cut = text.search(/[#?]/);
  if (cut === 0) return null;
  let fragmentLines: EditorLineRange | null = null;
  if (cut > 0) {
    fragmentLines = lineFragmentOf(text.slice(cut));
    text = text.slice(0, cut);
  }

  const candidate = toStreamPathCandidate(decodePercent(text), rootPath);
  // 경로 끝(`:806`)에 이미 줄이 적혀 있으면 그쪽이 먼저다 — 둘을 함께 적는 일은 드물고, 섞으면 어느 쪽인지 모른다.
  return candidate && candidate.lines === null && fragmentLines ? { ...candidate, lines: fragmentLines } : candidate;
}

/** 주소 꼬리(`#…` · `?…#…`)에서 줄 조각을 읽는다. 질의는 건너뛰고 `#` 뒤만 본다. */
function lineFragmentOf(tail: string): EditorLineRange | null {
  const hash = tail.indexOf('#');
  if (hash === -1) return null;
  const m = LINE_FRAGMENT.exec(tail.slice(hash + 1));
  if (!m) return null;
  return lineRangeOf(Number(m[1]), m[2] === undefined ? null : Number(m[2]));
}

/** ⑬ (g) ③ — 목적지에 줄이 없으면 링크 글자(`[X.h:806-807](…/X.h)`)에서 빌리되 이름이 목적지 파일 이름과 **같을 때만**(다르면 엉뚱한 줄). 목적지 줄이 이긴다. */
export function withLinkLabelLines(candidate: StreamPathCandidate | null, label: string | null): StreamPathCandidate | null {
  if (!candidate || candidate.lines !== null || !label) return candidate;
  const { body, lines } = splitLineSuffix(label.trim());
  if (!lines) return candidate;
  const target = candidate.scope === 'inside' ? candidate.relPath : candidate.absPath;
  const labelName = baseNameOf(body);
  if (labelName === '' || labelName !== baseNameOf(target)) return candidate;
  return { ...candidate, lines };
}

/** 경로의 마지막 조각(구분자 둘 다). 비교는 대소문자 그대로 — 세 OS 에서 같은 답이고 어긋나면 줄을 안 빌릴 뿐이다(`pathKey` 자리가 아니다). */
function baseNameOf(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * `file:` 을 벗겨 경로만 남긴다 — 세 표기를 모두 받는다.
 * `file:///C:/…`(호스트 없음) · `file://서버/공유`(UNC 호스트) · `file:/C:/…`(축약형).
 */
function stripFileScheme(url: string): string {
  const rest = url.slice('file:'.length);
  if (rest.startsWith('///')) return rest.slice(2);
  return rest;
}

/**
 * 링크의 목적지는 흔히 퍼센트 인코딩돼 있다(한글 폴더·공백). 복호하지 않으면 디스크에 없는 이름이 된다.
 * 깨진 인코딩(`%ZZ`)은 던지므로 그때는 원문을 그대로 둔다 — 손잡이가 안 될 뿐, 링크는 살아 있다.
 */
function decodePercent(p: string): string {
  if (!p.includes('%')) return p;
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}
