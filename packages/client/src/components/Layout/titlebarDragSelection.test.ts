/**
 * §3.7 — 타이틀바를 끌면 창이 움직여야 한다(글자 선택 ❌). `.app-drag` 에 `user-select` 방어가 없으면 끌기가 글자 선택이 되고,
 * 남은 선택을 다시 잡으면 Chromium 이 텍스트 드래그앤드롭으로 읽어 창 이동이 막힌다. jsdom 이 없어 CSS 계약과 배선을 본다.
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

// 로고의 배경·점·글자는 일반 제목줄과 같은 OS 드래그 영역이다.
describe('드래그 영역의 정적 글자', () => {
  it('일반 제목줄의 정적 글자 상자는 포인터 대상이고 내부 장식만 제외된다', () => {
    expect(decl(ruleFor('.app-drag-label').body, 'pointer-events')).toBe('auto');
    expect(decl(ruleFor('.app-drag-label *').body, 'pointer-events')).toBe('none');
  });

  it('로고는 모든 겹이 같은 OS 캡션이고 글자 선택·이미지 끌기가 창 이동을 가로채지 않는다', () => {
    const rule = ruleFor('.app-titlebar-handle');
    expect(rule.selectors).toContain('.app-titlebar-handle *');
    expect(decl(rule.body, '-webkit-app-region')).toBe('drag');
    expect(decl(rule.body, 'app-region')).toBe('drag');
    expect(decl(rule.body, 'user-select')).toBe('none');
    expect(decl(rule.body, '-webkit-user-select')).toBe('none');
    expect(decl(rule.body, '-webkit-user-drag')).toBe('none');
    expect(decl(rule.body, 'pointer-events')).not.toBe('none');
    expect(source('Header.tsx')).toMatch(/className="app-titlebar-handle app-drag /);
  });

  it('로고의 장식은 포인터를 가로채지 않고 부모 제목줄로 보낸다', () => {
    const rules = parseRules(indexCss).filter((rule) => rule.selectors.includes('.app-titlebar-handle *'));
    expect(rules.some((rule) => decl(rule.body, 'pointer-events') === 'none')).toBe(true);
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

// OS 캡션의 더블클릭은 OS 가 처리한다. DOM 에 도착한 것은 기존 Header 처리기 한 벌만 받는다.
describe('헤더 로고 전체 더블클릭', () => {
  it('로고 전용 처리기를 두지 않고 공통 Header 처리기만 사용한다', () => {
    const header = source('Header.tsx');
    expect(header).toContain('onDoubleClick={handleTitlebarDoubleClick}');
    expect(header).not.toContain('handleLogoDoubleClick');
    expect(header).not.toContain('onDoubleClickCapture=');
  });
});

// §3.7 — `app-nodrag` 는 누르는 상자에만 — 감싸개가 헤더 높이를 덮으면 버튼 위·아래 띠로 창을 못 옮긴다.
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

// app-nodrag 덮개는 네이티브 캡션을 막는다. DOM 까지 온 누름의 보완은 전역 받기가 담당한다.
describe('헤더 로고 전체 누름', () => {
  it('로고 위에 네이티브 드래그를 막는 덮개나 별도 수동 처리기를 두지 않는다', () => {
    const header = source('Header.tsx');
    const at = header.indexOf('className="app-titlebar-handle app-drag ');
    expect(at, '헤더 로고를 못 찾음').toBeGreaterThan(-1);
    const end = header.indexOf('{/* File 메뉴 */}', at);
    expect(end).toBeGreaterThan(at);
    const logo = header.slice(at, end);
    expect(logo).not.toContain('app-nodrag');
    expect(logo).not.toContain('absolute inset-0');
    expect(logo).not.toContain('onMouseDown');
    expect(logo).not.toContain('onDoubleClick');
    expect(header).not.toContain('useTitlebarDrag');
  });

  it('탭을 끄는 동안에는 제목줄 드래그 영역이 자손까지 비켜 준다(공통 vib-pointer-drag 규칙)', () => {
    const dragging = ruleFor('body.vib-pointer-drag .app-drag');
    expect(dragging.selectors).toContain('body.vib-pointer-drag .app-drag *');
    expect(dragging.selectors).toContain('body.vib-titlebar-drag .app-drag');
    expect(dragging.selectors).toContain('body.vib-titlebar-drag .app-drag *');
    expect(decl(dragging.body, '-webkit-app-region')).toBe('no-drag');
    expect(decl(dragging.body, 'app-region')).toBe('no-drag');
  });
});
