import { defaultUrlTransform } from 'react-markdown';
import { toStreamPathCandidate, type StreamPathCandidate } from './streamPathLinks.js';

/**
 * streamLinkHref.ts — §5.5 #17-27 ⑬ (k) 스트림 본문 **마크다운 링크**의 목적지 판정(순수).
 *
 * ⑬ (a) 가 손잡이로 고른 것은 백틱 인라인 코드 하나였다. 그런데 에이전트가 결과물의 위치를 적는
 * 두 번째 방식이 `[검수표](Docs/Temp/점검/체크.html)` 처럼 **이름을 붙인 링크**이고, 그쪽은 ⑬ 을
 * 통과하지 않아 `window.open` 한 갈래로 떨어졌다 — 로컬 파일에서 그 길은 `file:` 이 되어
 * `ALLOWED_EXTERNAL_SCHEMES`(shared `externalOpen.ts`)에 막히므로 **파일이 열리는 일이 없다.**
 *
 * 여기서 하는 일은 둘이다.
 *  1. `streamUrlTransform` — react-markdown 의 기본 세척이 `file:`·`C:\…` 를 **빈 문자열로 지워**
 *     앵커조차 서지 않던 것을, 그 둘만 통과시켜 되살린다.
 *  2. `parseLinkHrefCandidate` — 링크의 목적지를 ⑬ (c)(d) 와 **같은 후보 타입**으로 되돌린다.
 *
 * 화면·통신이 섞이지 않은 계산만 두는 이유는 `streamPathLinks.ts` 와 같다 — "이 주소가 무엇으로
 * 읽히는가" 는 앱을 띄워 눈으로 확인하기 어렵고, 단위 테스트가 훨씬 촘촘히 잡는다.
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
 * ⑬ (k) ① — 스트림 본문에 쓰는 주소 세척.
 *
 * `defaultUrlTransform` 은 안전한 스킴(http·https·irc·mailto·xmpp)이 아니면 **빈 문자열**을 돌려준다.
 * 그래서 `file:///C:/…` 도 `C:\…` 도 `href` 가 사라져 `MarkdownLink` 가 링크로 그리지도 못했다.
 * 그 둘만 통과시키고 나머지는 기본 세척 그대로 둔다 — `javascript:`·`data:` 는 여전히 지워진다.
 *
 * 이것이 구멍이 아닌 까닭은 **여는 주체가 `href` 가 아니기 때문**이다. 누름은 `MarkdownLink` 가
 * 가로채 ⑬ 의 레일로 보내고, 가운데 클릭·주소 이동은 데스크톱 본체의 `will-navigate` ·
 * `setWindowOpenHandler` 가 **종전과 똑같이** `ALLOWED_EXTERNAL_SCHEMES` 로 되돌린다(새 통로 ❌).
 */
export function streamUrlTransform(url: string): string {
  if (WIN_DRIVE_HREF.test(url) || FILE_SCHEME.test(url)) return url;
  return defaultUrlTransform(url);
}

/** 바깥 브라우저가 맡는 주소인가 — ⑬ (k) ④ 웹 링크 메뉴와 §7.11 loopback 프리뷰 신고의 조건. */
export function isWebLinkHref(href: string): boolean {
  return WEB_SCHEME.test(href.trim());
}

/**
 * ⑬ (k) ② — 링크의 목적지를 경로 후보로 읽는다. 경로가 아니면(웹 주소·메일·문서 안 앵커) null.
 *
 * **1차 체(`parseStreamPathCandidate`)를 지나지 않는다.** 그 체는 평범한 본문 글자에 가짜 손잡이가
 * 생기는 것을 막는 장치인데(⑬ (b)), 링크는 에이전트가 "여기를 누르라"고 명시한 자리라 막을 것이 없다 —
 * 오히려 그대로 쓰면 공백·괄호가 든 실제 파일 이름을 잃는다. 최종 판정은 여전히 디스크가 한다.
 */
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
  const cut = text.search(/[#?]/);
  if (cut === 0) return null;
  if (cut > 0) text = text.slice(0, cut);

  return toStreamPathCandidate(decodePercent(text), rootPath);
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
