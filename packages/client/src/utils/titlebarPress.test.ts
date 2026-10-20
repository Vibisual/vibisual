/**
 * §3.7 「제목줄 영역은 코드로 껐다 켜지 않는다」 — **페이지까지 온 제목줄 누름은 그 누름으로 창을 옮긴다.**
 *
 * 사용자 보고: "앱이 켜지면 커버든 탭이든 드래그하면 이동해야 하는데 우리 앱만 안 된다 — 계속 반복이다".
 * 종전에는 영역을 두 프레임 동안 `no-drag` 로 흔들어 다시 신고시켰는데, Chromium 126 은 제목줄 누름을 첫
 * 마우스 이동에서야 OS 이동으로 넘기므로 그 사이의 흔들기가 누름을 버리게 했다. 이제 영역은 CSS 그대로 두고,
 * 페이지까지 온 누름은 덮개와 같은 `move-self` 길로 옮긴다.
 *
 * 클라 시험에는 DOM 이 없어(jsdom 미설치) `Element` 와 창 리스너를 작은 가짜로 세운다. 배선은 원문으로 고정한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginTitlebarDrag, endTitlebarDrag, installTitlebarPressCatch, isDragRegionTarget } from './titlebarPress.js';

/** `closest('.app-drag, .app-nodrag')` 만 아는 가짜 요소 — 부모 사슬을 따라 가장 가까운 쪽을 돌려준다. */
class FakeElement {
  readonly classList: { contains: (name: string) => boolean };
  constructor(classes: string[], readonly parent: FakeElement | null = null) {
    const set = new Set(classes);
    this.classList = { contains: (name: string): boolean => set.has(name) };
  }
  closest(selector: string): FakeElement | null {
    expect(selector).toBe('.app-drag, .app-nodrag');
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.classList.contains('app-drag') || node.classList.contains('app-nodrag')) return node;
    }
    return null;
  }
}

function tree() {
  const header = new FakeElement(['app-drag']);
  const tabStrip = new FakeElement(['flex'], header);
  const tab = new FakeElement(['app-nodrag'], tabStrip);
  const tabLabel = new FakeElement([], tab);
  const logo = new FakeElement(['app-titlebar-handle', 'app-drag'], header);
  const logoDot = new FakeElement([], logo);
  const logoText = new FakeElement([], logo);
  const canvas = new FakeElement(['react-flow__pane']);
  return { header, tabStrip, tab, tabLabel, logo, logoDot, logoText, canvas };
}

type Listener = { type: string; fn: (event: unknown) => void; capture: boolean };

function rig(options: { api?: boolean } = {}) {
  vi.stubGlobal('Element', FakeElement);
  const listeners: Listener[] = [];
  const moveSelf = vi.fn((_phase: string, _point?: { x: number; y: number }): Promise<boolean> => Promise.resolve(true));
  vi.stubGlobal('window', {
    api: options.api === false ? undefined : { window: { moveSelf } },
    addEventListener: (type: string, fn: (event: unknown) => void, capture: boolean) => {
      listeners.push({ type, fn, capture });
    },
    removeEventListener: (type: string, fn: (event: unknown) => void, capture: boolean) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (at >= 0) listeners.splice(at, 1);
    },
  });
  return {
    moveSelf,
    listeners,
    dispatch: (type: string, event: object): void => {
      for (const l of listeners.filter((x) => x.type === type)) l.fn(event);
    },
  };
}

function mousedown(target: unknown, over: Partial<{ button: number; screenX: number; screenY: number; defaultPrevented: boolean }> = {}) {
  return {
    target,
    button: over.button ?? 0,
    screenX: over.screenX ?? 300,
    screenY: over.screenY ?? 14,
    defaultPrevented: over.defaultPrevented ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

const uninstallers: Array<() => void> = [];
afterEach(() => {
  // 열어 둔 손짓은 시험마다 닫는다 — 한 창에 손짓은 하나라 다음 시험의 첫 누름이 그것을 끝내게 된다.
  endTitlebarDrag();
  for (const off of uninstallers.splice(0)) off();
  vi.unstubAllGlobals();
});

function install(): void {
  uninstallers.push(installTitlebarPressCatch());
}

describe('드래그 영역 판정 — CSS 의 두 이름 그대로', () => {
  it('헤더 빈 자리와 탭 줄 빈 자리는 드래그 영역이다', () => {
    rig();
    const t = tree();
    expect(isDragRegionTarget(t.header as unknown as EventTarget)).toBe(true);
    expect(isDragRegionTarget(t.tabStrip as unknown as EventTarget)).toBe(true);
  });

  it('탭처럼 app-nodrag 로 되돌린 자리와 그 안은 아니다', () => {
    rig();
    const t = tree();
    expect(isDragRegionTarget(t.tab as unknown as EventTarget)).toBe(false);
    expect(isDragRegionTarget(t.tabLabel as unknown as EventTarget)).toBe(false);
  });

  it('로고 배경과 내부 장식은 모두 같은 제목줄 영역이다', () => {
    rig();
    const t = tree();
    for (const target of [t.logo, t.logoDot, t.logoText]) {
      expect(isDragRegionTarget(target as unknown as EventTarget)).toBe(true);
    }
  });

  it('드래그 영역 밖과 요소가 아닌 것은 아니다', () => {
    rig();
    expect(isDragRegionTarget(tree().canvas as unknown as EventTarget)).toBe(false);
    expect(isDragRegionTarget(null)).toBe(false);
    expect(isDragRegionTarget({} as EventTarget)).toBe(false);
  });

  it('DOM 이 없는 곳에서도 던지지 않는다', () => {
    vi.stubGlobal('Element', undefined);
    expect(isDragRegionTarget({} as EventTarget)).toBe(false);
  });
});

describe('페이지까지 온 제목줄 누름 — 전역 받기 하나로 옮긴다', () => {
  it('헤더 빈 자리 누름이 그 자리의 화면 좌표로 move-self 를 시작하고, 다른 처리기로 흘리지 않는다', () => {
    const r = rig();
    install();
    const down = mousedown(tree().header, { screenX: 512, screenY: 18 });
    r.dispatch('mousedown', down);
    expect(r.moveSelf.mock.calls[0]).toEqual(['start', { x: 512, y: 18 }]);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopPropagation).toHaveBeenCalledOnce();
    r.dispatch('mousemove', { buttons: 1, screenX: 540, screenY: 30 });
    r.dispatch('mouseup', { button: 0, buttons: 0, screenX: 560, screenY: 44 });
    expect(r.moveSelf.mock.calls.map(([phase]) => phase)).toEqual(['start', 'move', 'end']);
    expect(r.moveSelf.mock.calls[2]).toEqual(['end', { x: 560, y: 44 }]);
  });

  it('탭 줄 빈 자리도 같은 규칙이다', () => {
    const r = rig();
    install();
    r.dispatch('mousedown', mousedown(tree().tabStrip));
    expect(r.moveSelf).toHaveBeenCalledOnce();
  });

  it.each([
    ['로고 배경', (t: ReturnType<typeof tree>) => t.logo],
    ['로고 점', (t: ReturnType<typeof tree>) => t.logoDot],
    ['로고 글자', (t: ReturnType<typeof tree>) => t.logoText],
  ])('%s의 DOM 누름도 전역 받기가 한 번만 옮긴다', (_name, pick) => {
    const r = rig();
    install();
    const down = mousedown(pick(tree()));
    r.dispatch('mousedown', down);
    expect(r.moveSelf.mock.calls).toEqual([['start', { x: 300, y: 14 }]]);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopPropagation).toHaveBeenCalledOnce();
    r.dispatch('mouseup', { button: 0, buttons: 0, screenX: 400, screenY: 100 });
    expect(r.moveSelf.mock.calls).toEqual([
      ['start', { x: 300, y: 14 }], ['end', { x: 400, y: 100 }],
    ]);
  });

  it.each([
    ['탭(app-nodrag)', (t: ReturnType<typeof tree>) => t.tab],
    ['탭 글자', (t: ReturnType<typeof tree>) => t.tabLabel],
    ['캔버스', (t: ReturnType<typeof tree>) => t.canvas],
  ])('%s 누름은 건드리지 않는다', (_name, pick) => {
    const r = rig();
    install();
    const down = mousedown(pick(tree()));
    r.dispatch('mousedown', down);
    expect(r.moveSelf).not.toHaveBeenCalled();
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(down.stopPropagation).not.toHaveBeenCalled();
  });

  it('오른쪽 버튼·이미 처리된 누름은 건드리지 않는다', () => {
    const r = rig();
    install();
    r.dispatch('mousedown', mousedown(tree().header, { button: 2 }));
    r.dispatch('mousedown', mousedown(tree().header, { defaultPrevented: true }));
    expect(r.moveSelf).not.toHaveBeenCalled();
  });

  it('이동 창구가 없는 창(웹·모바일 접속)에서는 누름을 그대로 둔다 — 그쪽은 손짓이 오는 것이 정상이다', () => {
    const r = rig({ api: false });
    install();
    const down = mousedown(tree().header);
    r.dispatch('mousedown', down);
    expect(r.moveSelf).not.toHaveBeenCalled();
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it('capture 로 한 번만 건다 — 두 번 설치해도 한 누름이 손짓 둘을 열지 않는다', () => {
    const r = rig();
    install();
    install();
    expect(r.listeners.filter((l) => l.type === 'mousedown')).toHaveLength(1);
    expect(r.listeners.find((l) => l.type === 'mousedown')?.capture).toBe(true);
  });

  it('누름 하나가 손짓 하나 — 새 누름은 앞 손짓을 끝내고 연다', () => {
    const r = rig();
    expect(beginTitlebarDrag({ button: 0, screenX: 1, screenY: 1 })).toBe(true);
    expect(beginTitlebarDrag({ button: 0, screenX: 2, screenY: 2 })).toBe(true);
    expect(r.moveSelf.mock.calls.map(([phase]) => phase)).toEqual(['start', 'end', 'start']);
    r.dispatch('mouseup', { button: 0, buttons: 0 });
  });
});

// ── 배선 원문 ────────────────────────────────────────────────────────────────
//
// 주석은 걷고 본다 — 이유를 적은 주석은 걷어 낸 것의 이름을 부른다.
const srcFiles = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const htmlFiles = import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('제목줄 영역은 코드로 껐다 켜지 않는다', () => {
  it('원문을 실제로 읽는다(비면 아래 검사가 헛돈다)', () => {
    expect(Object.keys(srcFiles).length).toBeGreaterThan(50);
    expect(Object.keys(htmlFiles)).toHaveLength(1);
  });

  it('어떤 소스도 드래그 영역 값을 코드로 바꾸지 않는다 — 그 흔들기가 누름을 버리게 했다', () => {
    const violations: string[] = [];
    for (const [path, text] of Object.entries(srcFiles)) {
      const body = code(text);
      if (/setProperty\(\s*['"](?:-webkit-)?app-region/.test(body)) violations.push(`${path}: app-region 을 코드로 바꾼다`);
      if (/onDragRegionsRefresh|drag-regions-refresh|DragRegionKeepalive|refreshDragRegions/.test(body)) {
        violations.push(`${path}: 드래그 영역 재신고 배선이 돌아왔다`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('부팅 지점이 받기를 한 번 건다', () => {
    const boot = srcFiles['../main.tsx'];
    expect(boot, 'main.tsx 를 못 읽었다').toBeDefined();
    expect(code(boot!)).toMatch(/installTitlebarPressCatch\(\);/);
  });

  it('첫 화면에도 제목줄이 있다 — React 가 헤더를 그리기 전의 #root 안 36px 드래그 띠', () => {
    const html = Object.values(htmlFiles)[0] ?? '';
    expect(html).toMatch(/<div id="root"><div class="app-drag h-9" aria-hidden="true"><\/div><\/div>/);
  });

  it('헤더의 더블클릭은 드래그 영역에 도착한 것만 최대화/복원한다(탭·버튼은 거른다)', () => {
    const header = code(srcFiles['../components/Layout/Header.tsx'] ?? '');
    expect(header).toContain('onDoubleClick={handleTitlebarDoubleClick}');
    const at = header.indexOf('const handleTitlebarDoubleClick');
    expect(at, '헤더 더블클릭 처리기를 못 찾음').toBeGreaterThan(-1);
    const body = header.slice(at, header.indexOf('}, []);', at));
    expect(body).toContain('if (!isDragRegionTarget(event.target)) return;');
    expect(body).toContain('toggleMaximizeSelf()');
  });
});
