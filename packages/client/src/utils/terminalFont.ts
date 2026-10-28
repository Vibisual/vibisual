/**
 * §4 (CMD) — 터미널 글꼴 스택 한 곳. xterm 은 글자 폭을 스스로 재므로 CSS 변수가 아니라 실제 글꼴 이름이 필요하다 — `index.css` 의 `--font-mono` 와 **함께 고칠 것**(어긋나면 터미널만 다른 글꼴로 보인다).
 * 따로 둔 이유: 터미널 화면이 둘(IDE CMD 터미널·로그인 화면 연출)이고, 한쪽에서 import 하면 xterm 애드온까지 딸려 온다.
 * 앞의 둘은 동봉(`src/assets/fonts/`, `scripts/fetch-reading-fonts.mjs`)이라 세 OS 가 같다 — `JetBrains Mono`(라틴, SIL OFL 1.1) · `Nanum Gothic Coding`(한글, 라틴 폭의 정확히 2배 — 없으면 CLI 상자·상태줄이 어긋난다). 뒤 OS 글꼴은 동봉본이 실리기 전에만 쓰인다(Consolas·Menlo 는 동봉 불가).
 * 맨 끝 Noto Sans SC·JP·Devanagari 는 §5.5 #17-22 ⑤-3 문자 폴백 — 고정폭이 아니라 앞의 둘이 못 그리는 글자에서만 닿게 **맨 끝**이다(최소 설치 리눅스엔 CJK 글꼴이 없다).
 */
export const TERMINAL_FONT_STACK =
  "'JetBrains Mono', 'Nanum Gothic Coding', ui-monospace, SFMono-Regular, Menlo, Consolas, "
  + "'Noto Sans SC', 'Noto Sans JP', 'Noto Sans Devanagari', monospace";

/** §4 (CMD) — 글꼴 확인에 쓸 최소 인터페이스(`document.fonts` 의 모양). 이만큼만 받는 것은 시험에서 갈아 끼우기 위함이다(jsdom 에는 이 API 가 없다). */
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
 * §4 (CMD) — 터미널을 세우기 전에 동봉 글꼴이 실제로 실렸는지 확인하고, 아직이면 기다린다.
 * xterm 5.5.0 은 `document.fonts` 를 보지 않고 셀 폭을 `open()`·화면비·`fontFamily`/`fontSize` 변경 때만 잰다 — `font-display: swap` 의 첫 페인트(더 좁은 OS 폴백)에서 잰 cols 가 PTY 에 실려 **줄이 창을 넘어간다**.
 * @param fontSizePx 잴 크기(px). `check`/`load` 는 크기까지 든 CSS font 축약형을 받는다.
 * @param fontSet 기본 `document.fonts`. 이 API 가 없으면 `null` 을 돌려 기다리지 않는다.
 * @returns 이미 실렸거나 확인할 방법이 없으면 `null`(기다릴 것 없음), 아니면 로드를 기다리는 Promise.
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
