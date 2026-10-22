import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * §5.4 #14 — 고른 탭이 커지는 움직임의 **배선**(원문 계약). 계산은 `hooks/tabSelectionMotionGeom.test.ts` 가 본다.
 *
 * 2026-10-22 사용자 보고 — "예전에 아이폰처럼 스무스하게 만들라고 했는데 다시 기존 방식으로 돌아가 있다".
 * 실측한 원인 둘: ① 그 PC 는 OS 애니메이션 효과가 꺼져 있어(`prefers-reduced-motion: reduce`) 종전 훅이 움직임을
 * 통째로 껐고(`motion-reduce:transition-none` 도 함께), ② 움직임을 켜도 폭·높이를 메인 스레드에서 바꿔
 * 프로젝트 전환(캔버스를 통째로 다시 그린다)에 묻혔다. 아래 시험은 그 둘이 되살아나지 않게 붙든다.
 *
 * 클라 시험에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 소스 문자열을 읽는다.
 */
const sources = import.meta.glob(['./TabBar.tsx', '../../hooks/useTabSelectionMotion.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const read = (suffix: string): string => (Object.entries(sources).find(([k]) => k.endsWith(suffix))?.[1] ?? '').replace(/\r\n/g, '\n');
const tabBar = read('TabBar.tsx');
const hook = read('useTabSelectionMotion.ts');
// vitest 는 CSS 를 처리하지 않아(`?raw` 로 읽어도 빈 문자열) 파일로 직접 읽는다.
const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const count = (src: string, needle: string): number => src.split(needle).length - 1;

describe('§5.4 #14 고른 탭이 커지는 움직임 — 배선', () => {
  it('원문이 실제로 읽혔다', () => {
    expect(tabBar.length).toBeGreaterThan(1000);
    expect(hook.length).toBeGreaterThan(500);
    expect(css).toContain('.tab-selection-label');
  });

  it('탭바가 고른 탭의 키를 한 규칙으로 읽어 움직임 훅에 넘긴다', () => {
    expect(tabBar).toContain('const activeKey = useMemo(() => tabSelectionKey(activeIframeId, activeProject), [activeIframeId, activeProject]);');
    expect(tabBar).toContain('useTabSelectionMotion(scrollEl, activeKey, tabDrag.dragKey !== null);');
  });

  it('폭·높이를 메인 스레드에서 움직이던 길은 걷혔다 — 움직임 줄이기에서 통째로 꺼지는 클래스도 없다', () => {
    expect(tabBar).not.toContain('useTabWidthAnimation');
    const motion = /const TAB_SELECTION_MOTION = '([^']*)';/.exec(tabBar)?.[1] ?? '';
    expect(motion).not.toBe('');
    expect(motion).not.toMatch(/height|margin|width|all/);
    expect(motion).not.toContain('motion-reduce:transition-none');
    expect(tabBar).not.toContain('motion-reduce:transition-none');
  });

  it('두 종류(프로젝트·iframe) 모두 판이 본체의 첫 자식으로 서고, 쉬는 판·고른 판을 불투명도로 갈아 끼운다', () => {
    expect(count(tabBar, '<span data-tab-part="plate" aria-hidden className={TAB_PLATE}>')).toBe(2);
    expect(count(tabBar, "<span className={`${TAB_PLATE_IDLE} ${isActive ? 'opacity-0' : 'opacity-100'}`} />")).toBe(2);
    expect(tabBar).toContain("<span className={`${TAB_PLATE_ACTIVE} border-t-blue-400 ${isActive ? 'opacity-100' : 'opacity-0'}`} />");
    expect(tabBar).toContain("<span className={`${TAB_PLATE_ACTIVE} border-t-sky-400 ${isActive ? 'opacity-100' : 'opacity-0'}`} />");
    // 판은 좌상단 기준으로 늘고 준다(배율의 기준점이 다르면 옛 모양이 어긋난 자리에서 출발한다).
    expect(tabBar).toMatch(/const TAB_PLATE = '[^']*origin-top-left[^']*';/);
  });

  it('본체는 배경·윗선을 그리지 않는다 — 그리면 판이 늘고 주는 동안 본체 모양이 먼저 끝 모습으로 튄다', () => {
    expect(tabBar).toContain('? `${TAB_WIDTH_ACTIVE} h-full text-white/90`');
    expect(tabBar).toContain('? `${TAB_WIDTH_ACTIVE} h-full text-sky-300`');
    expect(count(tabBar, ': `${TAB_WIDTH_IDLE} mt-[5px] h-[calc(100%-5px)] text-gray-400 hover:text-gray-200`')).toBe(2);
    expect(count(tabBar, 'relative flex flex-shrink-0 items-center gap-1.5 border-r border-t-2 border-transparent px-2.5')).toBe(2);
  });

  it('판 위에 서야 하는 칸은 모두 자리를 갖는다(absolute 판은 자리 없는 칸 위에 칠해진다)', () => {
    expect(count(tabBar, 'relative flex-shrink-0 cursor-help')).toBe(4); // 핀·기본 × 두 종류
    expect(tabBar).toContain('className="relative flex flex-shrink-0 items-center gap-1 text-[12px] tabular-nums text-gray-300"');
    expect(tabBar).toContain('className={`relative flex-shrink-0 rounded px-1');
    const label = /\.tab-selection-label \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(label).toContain('position: relative;');
    expect(label).toContain('transform-origin: left center;');
  });

  it('iframe 탭의 지구본은 감싼 칸이 움직인다 — SVG 를 직접 옮기면 배율 ≠ 100% 에서 합성기가 맡지 않는다', () => {
    expect(tabBar).toMatch(/<span className="relative flex flex-shrink-0">\s*<svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"/);
  });

  it('이름 칸은 바깥(잘라 보이는 칸) · 안쪽(반대 배율) · 글자(나타나는 연출) 세 겹이다 — 두 종류 모두', () => {
    expect(count(tabBar, '<span data-tab-part="label-inner" className="inline-block origin-left">')).toBe(2);
    expect(tabBar).toContain('<span data-tab-part="label-text" className="inline-block">{item.name}</span>');
    expect(tabBar).toContain('<span data-tab-part="label-text" className="inline-block">{item.tab.label}</span>');
  });

  it('훅의 표식이 탭바와 같다 — 값이 갈리면 아무것도 움직이지 않는다', () => {
    expect(hook).toContain("const TAB_PART = { plate: 'plate', labelInner: 'label-inner', labelText: 'label-text' } as const;");
    expect(hook).toContain("const TAB_LABEL_CLASS = 'tab-selection-label';");
    expect(hook).toContain("const TAB_SURFACE_ATTR = 'data-tab-surface';");
    expect(hook).toContain("const TAB_KEY_ATTR = 'data-tab-key';");
  });

  it('바뀌기 전 모양은 스토어가 바뀌는 그 순간에 재고, 그 고른 탭으로 넘어가는 커밋에서만 쓴다', () => {
    expect(hook).toContain('return useGraphStore.subscribe((state, prev) => {');
    expect(hook).toContain('if (!container || !snap || snap.toKey !== activeKey) return;');
    // 바뀐 뒤의 레이아웃은 도는 움직임을 걷고 잰다(걷지 않으면 옛 움직임이 섞인 값을 끝 모습으로 삼는다).
    const cancelAt = hook.indexOf('for (const a of running) a.cancel();');
    const measureAt = hook.indexOf('const after = measureTabs(container);');
    expect(cancelAt).toBeGreaterThan(0);
    expect(measureAt).toBeGreaterThan(cancelAt);
  });

  it('움직임 줄이기에서는 끄지 않고 누그러뜨린다 — 튐 없는 스프링·흐림 없는 연출을 고른다', () => {
    expect(hook).toContain('springCurve(reduced ? TAB_SELECTION_FLIP.reducedSpring : TAB_SELECTION_FLIP.spring)');
    expect(hook).toContain('const reveal = reduced ? TAB_SELECTION_FLIP.reducedReveal : TAB_SELECTION_FLIP.reveal;');
    expect(hook).not.toMatch(/if \(\s*(reduced|prefersReducedMotion\(\))\s*\)\s*(return|continue)/);
  });

  it('흐림은 불투명도·위치와 다른 움직임으로 건다 — 한 움직임에 섞으면 통째로 메인 스레드로 떨어진다', () => {
    expect(hook).toContain('track(text.animate(frames.main, { duration: reveal.durationMs }));');
    expect(hook).toContain('if (frames.blur) track(text.animate(frames.blur, { duration: reveal.durationMs }));');
  });

  it('집어 들면 도는 움직임을 끝 모습으로 보낸다 — 고스트는 레이아웃 치수를 받는다', () => {
    expect(hook).toMatch(/if \(dragging\) \{\s*for \(const a of running\) a\.finish\(\);/);
  });
});
