/**
 * §5.5 #17-22 ⑤-3 — **UI 언어의 모든 글자가 앱에 동봉한 글꼴 안에 있는가.**
 *
 * 두부(□)는 화면을 띄워야만 보이는 결함이다. 그것도 리눅스에서만 보인다 — 윈도우·맥은 OS 가
 * CJK·데바나가리 글꼴을 항상 들고 있어 우리 스택이 비어 있어도 조용히 메워 주기 때문이다.
 * 그래서 이 테스트는 **OS 글꼴을 없는 것으로 치고** 동봉본만으로 로케일 문자열을 그릴 수 있는지 센다.
 *
 * 세는 근거는 선언이 아니라 **실물 cmap** 이다 — 다만 woff2 를 여는 쪽은 여기가 아니라
 * `scripts/fetch-reading-fonts.mjs` 다(클라이언트 tsconfig 에는 Node 타입이 없어 테스트가
 * `node:fs`·`node:zlib` 를 못 쓴다 — `typographyFloor.test.ts` 와 같은 제약). 스크립트가 글꼴을
 * 내려받으며 재어 `fonts.coverage.json` 에 적고, 여기서는 그것과 로케일 문자열을 대조한다.
 *
 * 새 로케일을 넣거나 문자열에 새 문자 체계가 섞이면 여기서 먼저 실패한다.
 */

import { describe, expect, it } from 'vitest';
import { pluginLocaleResources } from '@vibisual/plugins/locales';
import { TERMINAL_FONT_STACK } from '../utils/terminalFont.js';
import coverageManifest from '../assets/fonts/fonts.coverage.json';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석에 실측과 이유가 있다).
import indexCss from 'virtual:vibisual-css-source/index';

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

/* ---------------------------------------------------------------- 커버리지 */

/** `4e00-9fff,ac00` 처럼 압축된 문자열을 코드포인트 집합으로. */
function expandRanges(text: string): Set<number> {
  const out = new Set<number>();
  if (!text) return out;
  for (const part of text.split(',')) {
    const [lo, hi] = part.split('-');
    const start = Number.parseInt(lo!, 16);
    const end = hi ? Number.parseInt(hi, 16) : start;
    for (let cp = start; cp <= end; cp += 1) out.add(cp);
  }
  return out;
}

const familyCoverage: Record<string, string> = coverageManifest.families;
const coverageCache = new Map<string, Set<number>>();

/** 그 가족이 **실제로** 그릴 수 있는 코드포인트. 동봉본이 아니면 빈 집합(= OS 에 기대지 않는다). */
function coverageOf(family: string): Set<number> {
  const cached = coverageCache.get(family);
  if (cached) return cached;
  const covered = expandRanges(familyCoverage[family] ?? '');
  coverageCache.set(family, covered);
  return covered;
}

/* -------------------------------------------------------------- 스택 읽기 */

function familiesOf(declaration: string): string[] {
  return [...declaration.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function readFontStacks(): { base: string[]; byLang: Map<string, string[]> } {
  expect(indexCss.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
  const css = indexCss;
  const theme = css.match(/@theme\s*\{[\s\S]*?\n\}/)?.[0];
  expect(theme, 'index.css 에서 @theme 블록을 못 찾았습니다').toBeTruthy();
  const base = theme!.match(/--font-sans:\s*([^;]+);/)?.[1];
  expect(base, '@theme 에 --font-sans 가 없습니다').toBeTruthy();

  const byLang = new Map<string, string[]>();
  for (const block of css.matchAll(/html:lang\(([a-z-]+)\)\s*\{([\s\S]*?)\n\}/g)) {
    const sans = block[2]!.match(/--font-sans:\s*([^;]+);/)?.[1];
    if (sans) byLang.set(block[1]!, familiesOf(sans));
  }
  return { base: familiesOf(base!), byLang };
}

const stacks = readFontStacks();

/** `@theme` 의 `--font-mono` 원문 — xterm 용 TS 상수와 대조한다. */
function readThemeMono(): string {
  const theme = indexCss.match(/@theme\s*\{[\s\S]*?\n\}/)?.[0];
  return theme?.match(/--font-mono:\s*([^;]+);/)?.[1]?.trim() ?? '';
}

/** `zh-CN` 은 `:lang(zh)` 에 걸린다(접두 일치) — CSS 와 같은 규칙으로 고른다. */
function stackFor(locale: string): string[] {
  const lower = locale.toLowerCase();
  for (const [lang, families] of stacks.byLang) {
    if (lower === lang || lower.startsWith(`${lang}-`)) return families;
  }
  return stacks.base;
}

/* ------------------------------------------------------------ 로케일 문자 */

function collectCodepoints(value: unknown, out: Set<number>): void {
  if (typeof value === 'string') {
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      // 제어문자·공백은 자형이 없어 폴백 대상이 아니다.
      if (cp > 0x20 && cp !== 0x7f) out.add(cp);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCodepoints(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectCodepoints(item, out);
  }
}

/** `./locales/zh-CN.json` → `zh-CN`. */
const locales = Object.entries(localeSources)
  .map(([path, mod]) => ({ locale: path.replace(/^.*\//, '').replace(/\.json$/, ''), mod }))
  .sort((a, b) => a.locale.localeCompare(b.locale));

describe('로케일 글자는 전부 동봉 글꼴 안에 있다 (§5.5 ⑤-3)', () => {
  it('로케일 파일과 커버리지 정본이 있다', () => {
    expect(locales.length).toBeGreaterThan(0);
    expect(Object.keys(familyCoverage).length).toBeGreaterThan(0);
  });

  for (const { locale, mod } of locales) {
    it(`${locale} — OS 글꼴 없이도 두부가 안 난다`, () => {
      const wanted = new Set<number>();
      collectCodepoints((mod as { default: unknown }).default, wanted);
      // 플러그인 문자열도 같은 화면에 뜬다(§5.11 — 카드 문자열은 플러그인 폴더 안에 산다).
      collectCodepoints(pluginLocaleResources(locale), wanted);

      const covered = new Set<number>();
      for (const family of stackFor(locale)) {
        for (const cp of coverageOf(family)) covered.add(cp);
      }

      const missing = [...wanted].filter((cp) => !covered.has(cp)).sort((a, b) => a - b);
      const sample = missing.slice(0, 20).map((cp) => `${String.fromCodePoint(cp)}(U+${cp.toString(16).toUpperCase()})`);
      expect(
        missing,
        `${locale}: 동봉 글꼴에 없는 글자 ${missing.length}자 — ${sample.join(' ')}`,
      ).toEqual([]);
    });
  }

  it('음성 대조 — 폴백 셋을 빼면 위 검사가 실제로 실패한다', () => {
    // 통과하는 검사는 "글자가 다 있다"와 "검사가 아무것도 안 본다"를 구별하지 못한다.
    // 폴백 이전 상태(라틴+한글만)를 재현해 그때는 반드시 걸린다는 것을 같이 못 박는다.
    const beforeFix = ['Pretendard', 'Noto Sans KR'];
    const covered = new Set<number>();
    for (const family of beforeFix) for (const cp of coverageOf(family)) covered.add(cp);

    for (const locale of ['zh-CN', 'ja', 'hi']) {
      const entry = locales.find((l) => l.locale === locale);
      expect(entry, `${locale} 로케일 파일이 없습니다`).toBeTruthy();
      const wanted = new Set<number>();
      collectCodepoints((entry!.mod as { default: unknown }).default, wanted);
      const missing = [...wanted].filter((cp) => !covered.has(cp));
      expect(missing.length, `${locale}: 폴백 없이도 다 그려진다면 이 검사는 아무것도 안 보고 있다`).toBeGreaterThan(0);
    }
  });

  it('한자 통합 — 언어별 스택이 실제로 갈려 있고 그 언어 글꼴이 맨 앞이다', () => {
    // 이 규칙이 사라지면 Pretendard 가 가진 한자만 한국식으로 먼저 그려져 한 문장 안에서 자형이 섞인다.
    const head = new Map([['zh', 'Noto Sans SC'], ['ja', 'Noto Sans JP'], ['hi', 'Noto Sans Devanagari']]);
    for (const [lang, family] of head) {
      const stack = stacks.byLang.get(lang);
      expect(stack, `index.css 에 html:lang(${lang}) 스택이 없습니다`).toBeTruthy();
      expect(stack![0]).toBe(family);
    }
  });

  it('문자 폴백 셋은 어느 언어에서도 스택에 남아 있다 (섞인 문장 대비)', () => {
    const fallbacks = ['Noto Sans SC', 'Noto Sans JP', 'Noto Sans Devanagari'];
    for (const stack of [stacks.base, ...stacks.byLang.values()]) {
      for (const family of fallbacks) expect(stack).toContain(family);
    }
  });

  it('터미널 글꼴 상수가 --font-mono 와 어긋나지 않는다', () => {
    // xterm 은 글자 폭을 스스로 재느라 CSS 변수를 못 받아 같은 값이 두 군데 산다
    // (`utils/terminalFont.ts` 주석). 주석만으로 지켜지지 않는 약속이라 여기서 대조한다 —
    // 어긋나면 터미널만 다른 글꼴로 보이고, 그 차이는 화면을 띄워야만 드러난다.
    expect(TERMINAL_FONT_STACK).toBe(readThemeMono());
  });

  it('스택에 적힌 동봉 글꼴 이름이 커버리지 정본의 이름과 어긋나지 않는다', () => {
    // 이름이 한 글자만 틀려도 CSS 는 조용히 그 항목을 건너뛴다 — 그 침묵을 여기서 깬다.
    const osFonts = new Set(['Apple SD Gothic Neo', 'Malgun Gothic']);
    for (const stack of [stacks.base, ...stacks.byLang.values()]) {
      for (const family of stack) {
        if (osFonts.has(family)) continue;
        expect(Object.keys(familyCoverage), `--font-sans 의 '${family}' 가 동봉본에 없습니다`).toContain(family);
      }
    }
  });
});
