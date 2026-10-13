/**
 * §3.7 v2.10 — **타이틀바를 잡아 끌면 창이 움직여야 한다(글자 선택 ❌).**
 *
 * 사용자 보고: "상단 부분 잡고 드래그 하면 창이 이동해야 하는데 사진처럼 글자 선택 모드로 빠지더니
 * 그 후로 동작을 안 해". 스크린샷에서 파랗게 잡힌 것은 정확히 헤더 로고("Vibisual")와 File 메뉴
 * ("파일") 두 글자였고, 저마다 `select-none` 을 달고 있던 프로젝트 탭들은 멀쩡했다.
 *
 * 원인은 `.app-drag` 정의에 `user-select` 방어가 없었던 것 하나다. 드래그 영역의 글자가 선택
 * 가능하면 ① 창을 옮기려는 손짓이 글자 선택이 되고 ② 한 번 남은 선택 위를 다시 잡으면 Chromium 이
 * **선택 텍스트의 드래그앤드롭**으로 읽어 OS 창 이동이 그 뒤로 통째로 막힌다("그 후로 동작을 안 해").
 *
 * 이 규칙은 CSS 에 산다 — 클라이언트 테스트에는 jsdom 이 없어(`vitest.config.ts`) 실제 드래그를
 * 재현할 수 없으므로, 되돌아가면 증상이 그대로 되살아나는 **CSS 계약과 배선**을 고정한다.
 */

import { describe, expect, it } from 'vitest';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석에 실측과 이유가 있다).
import indexCss from 'virtual:vibisual-css-source/index';

const sources = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

interface CssRule {
  selectors: string[];
  body: string;
}

/**
 * 최상위 규칙 목록. 주석을 먼저 걷어내고(주석 안의 중괄호·셀렉터가 섞이면 안 된다) `A { B }` 를
 * 훑는다 — 우리가 보는 규칙들은 중첩이 없어 이 정도로 충분하다.
 */
function parseRules(css: string): CssRule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    rules.push({ selectors, body: m[2] ?? '' });
  }
  return rules;
}

/** 셀렉터 목록에 `selector` 가 **정확히** 들어 있는 첫 규칙. */
function ruleFor(selector: string): CssRule {
  const found = parseRules(indexCss).find((r) => r.selectors.includes(selector));
  if (!found) throw new Error(`index.css 에 \`${selector}\` 규칙이 없습니다`);
  return found;
}

/** 선언 값. `user-select` 를 물어도 `-webkit-user-select` 가 걸리지 않는다(접두사 앞이 `;`·시작이 아님). */
function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`, 'i').exec(body);
  return m?.[1]?.trim() ?? null;
}

describe('타이틀바 드래그 영역', () => {
  it('index.css 원문을 읽는다(빈 문자열이면 아래 검사가 전부 헛돈다)', () => {
    expect(indexCss.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
  });

  it('.app-drag 는 OS 창 이동 영역이다', () => {
    const body = ruleFor('.app-drag').body;
    expect(decl(body, '-webkit-app-region')).toBe('drag');
    expect(decl(body, 'app-region')).toBe('drag');
  });

  it('.app-drag 안의 글자는 선택되지 않는다 — 이 줄이 사라지면 창이 안 움직이는 증상으로 돌아온다', () => {
    const body = ruleFor('.app-drag').body;
    expect(decl(body, 'user-select'), '`user-select: none` 이 없습니다').toBe('none');
    expect(decl(body, '-webkit-user-select'), '`-webkit-user-select: none` 이 없습니다').toBe('none');
  });

  it('.app-drag 안의 요소는 네이티브 드래그로 끌리지 않는다(남은 한 갈래)', () => {
    expect(decl(ruleFor('.app-drag').body, '-webkit-user-drag')).toBe('none');
  });

  it('드래그 영역 안의 입력칸만은 선택·캐럿이 살아 있다', () => {
    const rule = ruleFor('.app-drag input');
    expect(rule.selectors, 'textarea 예외가 빠졌습니다').toContain('.app-drag textarea');
    expect(
      rule.selectors.some((s) => /^\.app-drag \[contenteditable/.test(s)),
      'contenteditable 예외가 빠졌습니다',
    ).toBe(true);
    expect(decl(rule.body, 'user-select')).toBe('text');
    expect(decl(rule.body, '-webkit-user-select')).toBe('text');
  });

  it('그 입력칸 예외는 죽은 규칙이 아니다 — 헤더 안에 실제로 입력칸이 있다(탭 이름 바꾸기)', () => {
    // TabBar 는 Header(`app-drag`) 안에서 렌더되므로 이 input 이 위 예외의 실제 대상이다.
    expect(source('TabBar.tsx')).toMatch(/<input/);
    expect(source('Header.tsx')).toMatch(/<TabBar\s*\/>/);
  });

  it('헤더 루트가 여전히 드래그 영역이다', () => {
    // 클래스가 빠지면 CSS 방어가 아무 데도 안 걸린다 — 배선까지 같이 고정한다.
    expect(source('Header.tsx')).toMatch(/className=\{`app-drag /);
  });
});

// 로고 상자는 OS 드래그 영역으로 남고, 내부 장식만 포인터 대상에서 제외한다.
describe('드래그 영역의 정적 글자', () => {
  it('로고 상자가 포인터 대상이고 내부 점과 글자만 제외된다', () => {
    expect(decl(ruleFor('.app-drag-label').body, 'pointer-events')).toBe('auto');
    expect(decl(ruleFor('.app-drag-label *').body, 'pointer-events')).toBe('none');
    expect(source('Header.tsx')).toMatch(/className="app-drag-label app-drag /);
  });

  it('죽은 규칙이 아니다 — 사용자가 집어 보여 준 헤더 로고에 실제로 걸려 있다', () => {
    expect(source('Header.tsx'), '헤더 로고에 app-drag-label 이 없습니다').toMatch(/className="app-drag-label /);
  });

  it('`.app-drag` 자손 전체에 일괄로 걸지 않는다 — 탭 줄의 가로 스크롤이 함께 죽는다', () => {
    // 드래그 영역 안에는 `app-nodrag` 를 달지 않고도 손짓이 필요한 것이 있다(탭 스크롤 컨테이너).
    const rules = parseRules(indexCss);
    for (const selector of ['.app-drag *', '.app-drag > *', '.app-drag > * *']) {
      expect(
        rules.some((r) => r.selectors.includes(selector)),
        `\`${selector}\` 규칙이 생겼습니다 — 이 자리에 일괄 규칙을 두면 안 됩니다`,
      ).toBe(false);
    }
  });
});

// §3.7 · §5.5 #17-6 (H-19) — 로고 덮개는 `app-nodrag` 라 OS 가 그 자리의 더블클릭을 모른다.
//   덮개가 직접 제목줄과 같은 최대화/복원을 불러야 한다(받는 쪽 배선은 desktop `titlebarDrag.test.ts`).
describe('헤더 로고 덮개 더블클릭', () => {
  it('덮개가 자기 창 최대화/복원 채널을 부른다 — 사용자 보고: 로고 자리만 더블클릭해도 전체화면이 안 됐다', () => {
    const header = source('Header.tsx');
    const at = header.indexOf('className="app-nodrag absolute inset-0 z-10"');
    expect(at, '헤더 로고 덮개를 못 찾음').toBeGreaterThan(-1);
    const cover = header.slice(at, header.indexOf('/>', at));
    expect(cover).toContain('onDoubleClick={() => { void window.api?.window?.toggleMaximizeSelf(); }}');
  });
});

// §3.7 — `app-nodrag` 는 누르는 상자에만 건다. File 메뉴 감싸개가 헤더 높이 전체를 `app-nodrag` 로 덮으면
//   버튼 위·아래 띠가 창 이동에서 빠진다(사용자 지시 — 다른 앱들처럼 그 둘레에 여유를 둬서 창을 옮기자).
describe('File 메뉴 둘레', () => {
  it('감싸개는 헤더 드래그 영역에 남고, 클릭 자리는 FileMenu 루트 하나다', () => {
    const header = source('Header.tsx');
    const at = header.indexOf('{/* File 메뉴 */}');
    expect(at, 'File 메뉴 자리를 못 찾음').toBeGreaterThan(-1);
    const tagAt = header.indexOf('<div', at);
    const tag = header.slice(tagAt, header.indexOf('>', tagAt) + 1);
    expect(tag, '감싸개에 app-nodrag 가 다시 걸렸습니다 — 버튼 위·아래로 창을 못 끕니다').not.toContain('app-nodrag');
    expect(tag, '감싸개의 양옆 여유가 빠졌습니다').toContain('px-1');
    expect(header.indexOf('<FileMenu />', tagAt), 'FileMenu 가 감싸개 밖으로 나갔습니다').toBeGreaterThan(tagAt);
    expect(source('FileMenu.tsx')).toContain('<div ref={menuRef} className="app-nodrag relative">');
  });
});

// 덮개는 드래그 영역 신고에 기대지 않는 손잡이다 — 신고가 어긋난 순간(§3.7)에도 로고를 눌러 창을 옮긴다.
//   2026-10-08 에 "헤더 나머지와 같은 OS 캡션으로" 맞춘다며 덮개와 누름 연결을 걷었다가, 로고로 창이
//   안 움직여 되살렸다(사용자 보고 — "이거 누르면 화면 움직이는 기능 있었는데 날라간거야").
describe('헤더 로고 덮개 누름', () => {
  it('덮개가 로고 상자 안에 있고, 누르면 useTitlebarDrag 로 창을 옮긴다', () => {
    const header = source('Header.tsx');
    const at = header.indexOf('className="app-drag-label app-drag ');
    expect(at, '헤더 로고를 못 찾음').toBeGreaterThan(-1);
    const end = header.indexOf('{/* File 메뉴 */}', at);
    expect(end).toBeGreaterThan(at);
    const logo = header.slice(at, end);
    expect(logo, '로고 덮개가 없습니다 — 걷으면 신고가 어긋난 순간 로고로 창이 안 움직입니다')
      .toContain('className="app-nodrag absolute inset-0 z-10"');
    expect(logo).toContain('onMouseDown={handleLogoMouseDown}');
    expect(header).toContain('const handleLogoMouseDown = useTitlebarDrag();');
  });

  it('덮개는 인라인으로 손짓을 되찾는다 — `.app-drag-label *` 가 덮개까지 pointer-events:none 으로 만든다', () => {
    expect(decl(ruleFor('.app-drag-label *').body, 'pointer-events')).toBe('none');
    const header = source('Header.tsx');
    const at = header.indexOf('className="app-nodrag absolute inset-0 z-10"');
    expect(at, '헤더 로고 덮개를 못 찾음').toBeGreaterThan(-1);
    expect(header.slice(at, header.indexOf('/>', at))).toContain("style={{ pointerEvents: 'auto' }}");
  });

  it('탭을 끄는 동안에는 제목줄 드래그 영역이 자손까지 비켜 준다(공통 vib-pointer-drag 규칙)', () => {
    const dragging = ruleFor('body.vib-pointer-drag .app-drag');
    expect(dragging.selectors).toContain('body.vib-pointer-drag .app-drag *');
    expect(decl(dragging.body, '-webkit-app-region')).toBe('no-drag');
    expect(decl(dragging.body, 'app-region')).toBe('no-drag');
  });
});
