import { describe, it, expect } from 'vitest';

/**
 * §4 (CMD) **터미널 칸은 창을 따라 줄어드는가**의 집행.
 *
 * 실제 사고: CMD 버블의 터미널이 "IDE 안에서 크기가 맞춰지는 게 아니라 창 밖으로 넘어갔다".
 * 원인은 xterm 도 fit 도 아니라 **한 칸 위의 CSS** 였다.
 *
 *  - xterm 은 `.xterm-screen` 에 `width: <cols x 셀폭>px` 를 **인라인으로 박는다**(DOM·WebGL 렌더러
 *    모두). 그래서 터미널을 담은 칸의 **콘텐츠 최소폭 = 지금 터미널 폭** 이 된다.
 *  - 그 칸은 가로 flex 항목인데 `min-width` 가 `auto` 였다. 가로 flex 항목의 `min-width:auto` 는
 *    콘텐츠 최소폭으로 풀리므로, **창을 좁혀도 이 칸은 줄지 않는다.**
 *  - 줄지 않으니 호스트 폭도 그대로고, 호스트를 보는 `ResizeObserver` 는 **아무 변화도 못 본다** —
 *    다시 재는 일이 영영 일어나지 않는다. 창만 좁아지고 터미널은 그 자리에 남아 밖으로 밀려난다.
 *
 * 헤드리스 Chrome 실측(xterm 5.5.0 + addon-fit, 창 900→500px):
 *   `min-width:auto` : 호스트 903px 유지 · 화면 오른쪽 끝 892px(창 오른쪽 끝은 500px) ·
 *                      그 상태에서 fit 을 부르면 cols 123→**124** 로 오히려 늘어난다(래칫).
 *   `min-width:0`    : 호스트 498px 로 따라 줆 · fit 이 cols 67 로 다시 맞춘다.
 *
 * jsdom 에는 레이아웃이 없어 폭을 재서 확인할 수 없다. 대신 그 동작을 만드는 **클래스 자체**를
 * 소스에서 확인한다(`previewViewportEscape.test.ts` 와 같은 방식 — 그쪽은 `<main>` 에서 난 같은 함정이다).
 *
 * ⚠ 이 테스트는 **`packages/client` 에서** 실행해야 한다 — 레포 루트에서 돌리면 glob 이 빈 문자열을
 *   돌려주어 아래 `readSource` 가 그 사실을 알리고 멈춘다(멀쩡한 코드를 위반으로 오진하지 않게).
 */

const SOURCES = import.meta.glob<string>(
  [
    '/src/components/IDE/IDETerminalView.tsx',
    '/src/components/IDE/IDETerminalPanes.tsx',
    '/src/components/IDE/IDETerminalCardRail.tsx',
    '/src/components/IDE/IDEMainArea.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
);

function readSource(path: string): string {
  const text = SOURCES[`/src/components/IDE/${path}`];
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(
      `소스를 읽지 못했습니다: ${path}. vitest 를 packages/client 에서 실행하세요(레포 루트 ❌).`,
    );
  }
  return text;
}

/** `className="..."` 한 뭉치를 클래스 목록으로. */
function classesOf(attr: string): string[] {
  return attr.trim().split(/\s+/);
}

describe('§4 (CMD) 터미널 칸은 창을 따라 줄어든다 — 넘침 방지', () => {
  it('xterm 호스트를 감싼 칸이 `min-w-0` 을 들고 있다 (없으면 터미널 폭이 이 칸의 하한이 된다)', () => {
    const view = readSource('IDETerminalView.tsx');
    // 포커스 테두리를 다는 그 칸이 호스트의 직계 부모다(= fit 이 재는 폭을 정하는 칸).
    const wrap = /<div\s+className="([^"]+)"\s+onFocus=\{\(\) => setFocused\(true\)\}/.exec(view);
    expect(wrap, 'IDETerminalView 의 터미널 감싸개 <div> 를 찾지 못했습니다').not.toBeNull();
    const cls = classesOf(wrap![1]!);
    expect(cls).toContain('min-w-0');
    expect(cls).toContain('min-h-0');
    expect(cls).toContain('flex-1');
  });

  it('그 칸을 담은 가로 줄(pane 크롬 줄)도 `min-w-0` 이다', () => {
    const view = readSource('IDETerminalView.tsx');
    const row = /<div className=\{`(relative flex[^`]*flex-1[^`]*)\$\{showPaneChrome/.exec(view);
    expect(row, 'IDETerminalView 의 본문 가로 줄을 찾지 못했습니다').not.toBeNull();
    expect(classesOf(row![1]!)).toContain('min-w-0');
  });

  it('호스트는 `overflow-hidden` 이다 — 다시 맞추기까지의 찰나에도 밖으로 새지 않는다', () => {
    const view = readSource('IDETerminalView.tsx');
    const host = /<div ref=\{hostRef\}[^>]*className="([^"]+)"/.exec(view);
    expect(host, 'IDETerminalView 의 xterm 호스트 <div> 를 찾지 못했습니다').not.toBeNull();
    const cls = classesOf(host![1]!);
    // 리사이즈 → fit 사이에는 디바운스(TERMINAL_RESIZE_DEBOUNCE_MS)가 있어 잠깐 화면이 칸보다 넓다.
    // 그 잉여를 여기서 자르므로 IDE 창 밖으로는 한 픽셀도 나가지 않는다.
    expect(cls).toContain('overflow-hidden');
    expect(cls).toContain('h-full');
    expect(cls).toContain('w-full');
  });

  it('호스트 크기 변화를 보는 감시자가 그대로 있다 — 줄어든 뒤 다시 맞추는 쪽 절반', () => {
    const view = readSource('IDETerminalView.tsx');
    // 칸이 줄 수 있어도(min-w-0) 그 변화를 받아 fit + PTY resize 를 다시 하지 않으면 화면은 그대로다.
    expect(view).toContain('new ResizeObserver(() => { scheduleSizeSync(); })');
    expect(view).toContain('ro.observe(host)');
  });

  it('pane 트리의 모든 flex-1 칸이 `min-w-0` 이다 (한 칸만 빠져도 그 칸에서 넘친다)', () => {
    const panes = readSource('IDETerminalPanes.tsx');
    const offenders = (panes.match(/className="[^"]*\bflex-1\b[^"]*"/g) ?? [])
      .filter((attr) => !attr.includes('min-w-0'));
    expect(offenders, `min-w-0 이 빠진 칸: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('CMD 분기의 본문 칸도 `min-w-0` 이다 (IDEMainArea → IDETerminalPanes)', () => {
    const main = readSource('IDEMainArea.tsx');
    // `<IDETerminalPanes` 바로 앞에 선 <div> 가 그 칸이다(사이에 주석 한 줄이 낀다).
    const head = main.slice(0, main.indexOf('<IDETerminalPanes'));
    const opens = head.match(/<div className="[^"]+">/g) ?? [];
    const cell = /<div className="([^"]+)">/.exec(opens[opens.length - 1] ?? '');
    expect(cell, 'IDEMainArea 의 CMD 분기 컨테이너를 찾지 못했습니다').not.toBeNull();
    expect(classesOf(cell![1]!)).toContain('min-w-0');
  });

  it('카드 레일은 고정폭·비수축이다 — 줄어드는 쪽은 언제나 터미널이어야 한다', () => {
    const rail = readSource('IDETerminalCardRail.tsx');
    const panel = /<div className="(flex w-\[\d+px\][^"]*)">/.exec(rail);
    expect(panel, 'IDETerminalCardRail 의 패널 <div> 를 찾지 못했습니다').not.toBeNull();
    const cls = classesOf(panel![1]!);
    // 레일이 서면 그 폭만큼 터미널이 줄어야 한다. 레일이 양보하면 카드가 찌그러지고,
    // 터미널도 양보하지 않으면 둘 중 하나가 창 밖으로 나간다.
    expect(cls).toContain('flex-shrink-0');
  });
});
