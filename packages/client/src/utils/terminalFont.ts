/**
 * §4 (CMD) — 터미널 글꼴 스택 **한 곳**.
 *
 * xterm 은 글자 폭을 스스로 재서 열을 잡기 때문에 CSS 변수(`var(--font-mono)`)를 그대로 넘길 수
 * 없다 — 실제 글꼴 이름이 필요하다. 그래서 같은 값이 `index.css` 의 `--font-mono` 와 이 상수
 * 두 군데에 존재하며, **둘이 어긋나면 터미널만 다른 글꼴로 보인다.** 한쪽을 고치면 다른 쪽도
 * 반드시 같이 고칠 것(그 사실을 잊지 않도록 양쪽 주석이 서로를 가리킨다).
 *
 * 이 파일이 따로 있는 이유는 터미널을 그리는 화면이 **둘**이기 때문이다(IDE 의 CMD 터미널,
 * 로그인 화면의 터미널 연출). 한쪽에 상수를 두고 다른 쪽이 그것을 import 하면 xterm 애드온까지
 * 딸려 들어오므로, 값만 든 이 작은 모듈을 양쪽이 함께 본다.
 *
 * 앞의 두 글꼴은 앱에 **동봉**한 파일이다(`src/assets/fonts/`, `scripts/fetch-reading-fonts.mjs`
 * 가 받아 온다). OS 설치에 기대지 않으므로 win/mac/linux 에서 같은 화면이 나온다:
 *
 * - `JetBrains Mono` — 라틴. SIL OFL 1.1 이라 동봉·재배포가 허용된다.
 * - `Nanum Gothic Coding` — 한글. **라틴 폭의 정확히 2배**로 설계된 고정폭이라 한국어가 섞인
 *   줄에서도 열이 밀리지 않는다. 이게 없으면 한글은 맑은 고딕 같은 **가변폭**으로 폴백되어,
 *   CLI 가 그리는 상자와 상태줄이 그 줄부터 어긋난다.
 *
 * 뒤쪽 OS 글꼴은 동봉본이 아직 안 실렸을 때(첫 페인트 직전)만 잠깐 쓰이는 자리다. Consolas·Menlo
 * 는 각각 Microsoft·Apple 소유라 동봉할 수 없어 이름으로만 부른다.
 */
export const TERMINAL_FONT_STACK =
  "'JetBrains Mono', 'Nanum Gothic Coding', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * §4 (CMD) — 터미널 글꼴 확인에 쓸 최소 인터페이스. `document.fonts` 가 이 모양이다.
 * 통째로 받지 않고 이만큼만 받는 이유는 **테스트에서 갈아 끼우기 위함**이다(jsdom 에는 이 API 가
 * 없어, 실제 전역에 매이면 이 경로는 영영 검증되지 않는다).
 */
export interface TerminalFontSet {
  check(font: string, text?: string): boolean;
  load(font: string, text?: string): Promise<unknown>;
}

/**
 * 한글 조각 확인용 글자. `Nanum Gothic Coding` 은 라틴/한글 조각이 `unicode-range` 로 갈려 있어
 * 글자를 주지 않으면 **라틴 조각만** 보고 "실렸다"고 답한다(한글은 아직 폴백인데 통과한다).
 */
const HANGUL_PROBE = '한';

/**
 * 글꼴을 기다리는 최대 시간(ms). 이 API 가 있어도 파일을 못 받는 환경이 있으므로 상한을 둔다 —
 * 글꼴 때문에 터미널이 영영 안 뜨는 것보다 폴백 글꼴로라도 뜨는 편이 낫다.
 */
const FONT_WAIT_MAX_MS = 1500;

/**
 * §4 (CMD) — 터미널을 세우기 전에 **동봉 글꼴이 실제로 실렸는지** 확인하고, 아직이면 기다린다.
 *
 * xterm 은 열릴 때 글자를 하나 그려 셀 폭을 재고 그 값으로 열 수(cols)를 잡는데, 5.5.0 은
 * `document.fonts` 를 **아예 보지 않는다**(번들에 그 문자열이 한 번도 없다). 셀 폭을 다시 재는
 * 곳은 `open()` 1회, 화면비 변경, 그리고 `fontFamily`/`fontSize` 옵션이 바뀔 때뿐이라 —
 * 글꼴이 뒤늦게 실려도 **처음 잰 폭을 끝까지 쓴다**.
 *
 * 위 글꼴들은 `font-display: swap` 이라 첫 페인트가 OS 폴백(Consolas/Menlo)으로 나간다. 폴백은
 * 동봉 글꼴보다 좁아 cols 가 실제보다 크게 잡히고, 그 값이 그대로 셸(PTY)에 실려 간다 →
 * 셸은 넓은 줄을 보내는데 화면은 그만큼 넓지 않아 **줄이 창을 넘어간다**. 그래서 글꼴이 실린
 * 뒤에 재는 것이 이 함수의 목적이다.
 *
 * @param fontSizePx 잴 크기(px). `check`/`load` 는 크기까지 포함한 CSS font 축약형을 받는다.
 * @param fontSet 기본값은 `document.fonts`. 이 API 가 없는 환경이면 `null` 을 돌려 기다리지 않는다.
 * @returns 이미 실려 있거나 확인할 방법이 없으면 `null`(기다릴 것 없음), 아니면 로드를 기다리는 Promise.
 */
export function ensureTerminalFonts(
  fontSizePx: number,
  fontSet: TerminalFontSet | undefined = typeof document !== 'undefined'
    ? (document as unknown as { fonts?: TerminalFontSet }).fonts
    : undefined,
): Promise<void> | null {
  if (!fontSet) return null;
  const latin = `${fontSizePx}px 'JetBrains Mono'`;
  const hangul = `${fontSizePx}px 'Nanum Gothic Coding'`;
  try {
    if (fontSet.check(latin) && fontSet.check(hangul, HANGUL_PROBE)) return null;
  } catch {
    return null; // 형식을 거부하는 구현 — 기다려 봐야 답이 없다.
  }
  return Promise.race([
    Promise.all([
      // 한쪽이 없거나 실패해도 나머지는 기다린다 — 실패는 폴백 글꼴로 뜨는 것이지 오류가 아니다.
      Promise.resolve(fontSet.load(latin)).catch(() => undefined),
      Promise.resolve(fontSet.load(hangul, HANGUL_PROBE)).catch(() => undefined),
    ]).then(() => undefined),
    new Promise<void>((resolve) => { setTimeout(resolve, FONT_WAIT_MAX_MS); }),
  ]);
}
