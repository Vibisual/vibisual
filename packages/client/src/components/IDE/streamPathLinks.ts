import { toRelativeFromRoot } from './explorerModel.js';

/**
 * streamPathLinks.ts — §5.5 #17-27 ⑬ 스트림 본문 속 경로 손잡이의 **순수 판정**.
 *
 * 에이전트가 본문에 적어 준 위치(`assets/test/gpt-image/` · `packages/client/src/App.tsx:42`)를
 * 눌러서 열 수 있게 하려면, 먼저 그 조각이 **경로인지**를 가려야 한다. 여기서 하는 일은 그중
 * **1차 체** 하나다 — 명백히 경로가 아닌 것(공백이 든 명령·URL·CLI 플래그·코드 문법 조각)을 걸러 내고,
 * 남은 것을 루트 기준 상대 경로로 되돌린다.
 *
 * **최종 판정은 여기서 하지 않는다.** 글자 모양만으로 "경로처럼 생겼다"를 단정하면 본문 곳곳에
 * 누를 수 없는 가짜 손잡이가 생긴다(⑬ (b)). 진짜 손잡이가 되는지는 디스크에 그 경로가 실제로 있는지를
 * 물어 온 답(`GET /api/workspace-path`)이 정하고, 없으면 화면은 종전과 같은 평범한 인라인 코드로 둔다.
 *
 * 화면·통신을 섞지 않은 계산만 두는 이유는 #17-27 의 다른 순수 모듈(`editorModel`·`explorerModel`)과 같다 —
 * "무엇이 경로로 읽히는가" 는 앱을 띄워 눈으로 확인하기 어렵고, 단위 테스트가 훨씬 촘촘히 잡는다.
 */

/**
 * 인라인 코드 한 조각에서 뽑아낸 경로 후보.
 *
 * `scope` 로 갈라 둔 이유는 **열리는 곳이 다르기 때문**이다(⑬ (d)). 루트 안(`inside`)은 여덟 갈래로
 * 갈리지만(§5.13 (R-7) — 편집창·그림·PDF·내부 앱·실행·변환·연결 프로그램·탐색기), 루트 밖(`outside`)은
 * **시스템 탐색기 하나**뿐이다. 둘을 한 모양으로 두면 화면이 자리마다 "이게 루트 안이었나" 를 다시
 * 따져야 하고, 그 따짐이 한 군데라도 빠지는 순간 본문 글자로 임의 경로를 실행하는 길이 열린다.
 * 타입으로 갈라 두면 그 실수를 컴파일러가 막는다.
 */
export type StreamPathCandidate =
  | {
      readonly scope: 'inside';
      /** 루트 기준 상대 경로(forward slash, 앞뒤 구분자 제거). `''` = 프로젝트 루트 자신. */
      readonly relPath: string;
      /**
       * 원문에서 떼어 낸 줄 번호(`경로:42` / `경로:42:7`). 없으면 null.
       * **여는 데는 쓰지 않는다**(⑬ (g) — 줄로 스크롤하는 일은 #17-20 ⑪ 담당). 툴팁에만 쓴다.
       */
      readonly line: number | null;
    }
  | {
      readonly scope: 'outside';
      /** 루트 밖 절대 경로(forward slash 로 정규화, 뒤 구분자 제거). 탐색기에 그대로 넘긴다. */
      readonly absPath: string;
      /** `inside` 쪽과 같은 뜻 — 툴팁 전용이다. */
      readonly line: number | null;
    };

/** 경로로 보기엔 너무 긴 조각(Windows MAX_PATH). 이보다 길면 본문 문장이지 위치가 아니다. */
const MAX_PATH_LEN = 260;

/**
 * 이 문자가 하나라도 있으면 경로 후보에서 뺀다.
 *
 * 앞쪽 절반은 파일명에 쓸 수 없는 문자(`"` `<` `>` `|` `*` `?`)이고, 뒤쪽 절반은 **쓸 수는 있지만
 * 본문에서는 거의 언제나 코드·명령의 문법 문자**다(`pnpm build` 의 공백, `foo()` 의 괄호, `a=b` 의 등호).
 * 경로에 공백이 든 경우를 잃지만, 그 대가로 본문의 모든 명령 조각이 파란 밑줄을 얻는 일을 막는다.
 */
const NON_PATH_CHARS = /[\s"'`<>|*?()[\]{}=;,!$&^~+]/;

/**
 * 절대 경로에만 쓰는 느슨한 체 — 위와 같되 **보통 공백 하나만** 허용한다(탭·줄바꿈은 여전히 제외).
 *
 * `C:\games\Unreal Projects\…` 처럼 **공백이 든 폴더는 흔한데**, 위 체를 그대로 적용하면
 * 그런 경로는 영영 손잡이가 되지 못한다. 그렇다고 공백을 전면 허용하면 본문의 명령 조각(`pnpm build`)이
 * 전부 후보가 된다 — 그래서 **드라이브 머리나 앞 슬래시로 시작하는 조각에만** 이 체를 쓴다.
 * `C:\` 로 시작하는 명령은 사실상 없고, 그러고도 남는 오탐(`/usr/bin/env node`)은 **디스크가 걸러 낸다**
 * ((b) — 없는 경로는 종전과 같은 평문이다).
 */
const NON_PATH_CHARS_ABS = /[\t\n\r\v\f"'`<>|*?()[\]{}=;,!$&^~+]/;

/** 원문(역슬래시 그대로) 기준으로 "절대 경로처럼 시작하는가". 공백 허용 여부를 이걸로 가른다. */
const ABS_HEAD = /^(?:[A-Za-z]:[\\/]|\/)/;

/** `경로:42` · `경로:42:7` — 뒤에 붙은 줄(열) 번호. */
const LINE_SUFFIX = /^(.*?):(\d+)(?::\d+)?$/;

/** `C:/repo` · `D:\repo` — Windows 절대 경로의 드라이브 머리. */
const WIN_DRIVE = /^[A-Za-z]:\//;

/** 확장자 — **글자로 시작하는** 것만 센다(`v4.87` · `0.1.8` 같은 판올림 번호를 파일로 오인하지 않게). */
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/**
 * 인라인 코드 조각 하나를 경로 후보로 읽는다. 경로로 볼 수 없으면 null.
 *
 * `rootPath` 가 없으면(프로젝트를 아직 모르면) 아무것도 손잡이가 되지 않는다 — 같은 상대 경로가
 * 어느 트리의 것인지 정할 수 없기 때문이며, 이는 탐색기·편집창이 같은 뿌리를 봐야 한다는 규율과 같다.
 */
export function parseStreamPathCandidate(raw: string, rootPath: string | null): StreamPathCandidate | null {
  if (!rootPath) return null;

  const text = raw.trim();
  if (!text || text.length > MAX_PATH_LEN) return null;
  if ((ABS_HEAD.test(text) ? NON_PATH_CHARS_ABS : NON_PATH_CHARS).test(text)) return null;
  // CLI 플래그(`--effort`) · npm 스코프(`@vibisual/shared`) · 앵커(`#17-27`) — 셋 다 경로가 아니다.
  if (text.startsWith('-') || text.startsWith('@') || text.startsWith('#')) return null;
  if (text.includes('://')) return null;

  // (g) 줄 번호를 먼저 떼어 낸다. 앞 토막이 한 글자면 그것은 줄 번호가 아니라 드라이브(`C:`)다.
  let body = text;
  let line: number | null = null;
  const withLine = LINE_SUFFIX.exec(text);
  if (withLine && withLine[1] !== undefined && withLine[1].length > 1) {
    body = withLine[1];
    line = Number(withLine[2]);
  }

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
    // ⑬ (d) — 루트 밖도 후보가 된다(종전에는 여기서 null 이었다). 다만 갈 수 있는 곳은 탐색기 하나뿐이라
    // 상대 경로가 아니라 **절대 경로 그대로** 들고 간다 — 기준이 없는 값을 상대처럼 쓰면 엉뚱한 곳이 열린다.
    if (rel === norm && rel !== '') return { scope: 'outside', absPath: norm, line };
    return { scope: 'inside', relPath: rel, line };
  }

  const relPath = norm.replace(/^\.\//, '');
  // 상위로 거슬러 오르는 표기는 여기서 끊는다 — 기준이 되는 루트가 어디인지에 따라 가리키는 곳이
  // 달라지므로, "루트 밖"으로 넘겨도 어느 절대 경로인지 확정할 수 없다.
  if (relPath === '..' || relPath.startsWith('../')) return null;
  if (relPath === '.') return null;

  return { scope: 'inside', relPath, line };
}
