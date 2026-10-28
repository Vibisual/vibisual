import { describe, it, expect } from 'vitest';
import { PREVIEW_DEVICE_PRESETS, resolveCompareWidths } from '@vibisual/shared';
// 스크롤바 규칙은 CSS 에, 그 표식은 TSX 에 산다 — 짝이 맞는지 보려면 둘 다 읽어야 한다. CSS 원문은
// 설정 파일이 넘겨 준다(`?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열 — `vitest.config.ts` 참고).
import indexCss from 'virtual:vibisual-css-source/index';

/**
 * §5.17 · §7.16 — 프리뷰 폭 프리셋(`비교` 등)을 골라도 조작 줄이 창 밖으로 밀리지 않는가. 가로 flex 항목(`App.tsx` `<main>`)이
 * `min-width:auto` 면 콘텐츠 최소폭(비교 줄 2490px)으로 부풀어 부모 `overflow-hidden` 이 잘라 낸다 — 넘치는 폭은 프리뷰 본체의 가로 스크롤이 받는다.
 * jsdom 에 레이아웃이 없어 클래스를 소스(`import.meta.glob(?raw)`)에서 본다.
 * ⚠ `packages/client` 에서 실행할 것 — 루트에서는 glob 이 비어 `readSource` 가 멈춘다.
 */

const tsxSources = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function readSource(path: string): string {
  const text = tsxSources[`./${path}`];
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

describe('프리뷰 폭 프리셋 — 되돌아올 문이 항상 화면 안에 있는가 (§5.17)', () => {
  it('되돌아갈 칸(`자동`)이 프리셋 줄 맨 앞에 있다', () => {
    // 맨 앞이면 줄이 어느 쪽에서 잘려도 마지막까지 남는 칸이 `자동` 이다.
    expect(PREVIEW_DEVICE_PRESETS[0]?.id).toBe('auto');
    expect(PREVIEW_DEVICE_PRESETS[0]?.width).toBeNull();
  });

  it('비교 줄은 1080p 화면보다 넓다 — 그래서 부풀리면 안 되고 스크롤해야 한다', () => {
    const total = resolveCompareWidths().reduce((sum, w) => sum + w.width, 0);
    // 이 값이 흔한 화면 폭을 넘기 때문에, 이 폭을 조상에게 떠넘기는 순간 조작 줄이 창 밖으로 나간다.
    expect(total).toBeGreaterThan(1920);
  });

  it('App.tsx 의 <main> 이 `min-w-0` 을 들고 있다 (없으면 프리뷰가 이 칸을 부풀린다)', () => {
    const app = readSource('App.tsx');
    const match = /<main\s+className="([^"]+)"/.exec(app);
    expect(match, 'App.tsx 의 <main className="…"> 을 찾지 못했습니다').not.toBeNull();
    expect(classesOf(match![1]!)).toContain('min-w-0');
  });

  it('IframeView 의 URL 줄은 잘리는 대신 접힌다 (`flex-wrap`), 먼저 양보하는 쪽은 입력창이다', () => {
    const view = readSource('components/Layout/IframeView.tsx');

    const bar = /<div className="(flex[^"]*border-b[^"]*bg-gray-900\/60[^"]*)">/.exec(view);
    expect(bar, 'IframeView 의 URL 줄 컨테이너를 찾지 못했습니다').not.toBeNull();
    expect(classesOf(bar![1]!)).toContain('flex-wrap');

    // `min-w-0` 이 없으면 input 이 자기 기본 폭을 고집해 옆의 조작 줄을 밖으로 밀어낸다.
    const form = /<form[^>]*className="([^"]+)"/.exec(view);
    expect(form, 'IframeView 의 URL 입력 form 을 찾지 못했습니다').not.toBeNull();
    expect(classesOf(form![1]!)).toContain('min-w-0');
    expect(classesOf(form![1]!)).toContain('flex-1');

    // 조작 줄 자체가 이 화면에 실제로 있어야 한다(있어야 되돌아올 수 있다).
    expect(view).toContain('<PreviewControls');
  });

  it('PreviewControls 는 줄지도 잘리지도 않는다 (`shrink-0` + `flex-wrap`)', () => {
    const controls = readSource('components/Preview/PreviewControls.tsx');
    const root = /export function PreviewControls[\s\S]*?<div className="([^"]+)">/.exec(controls);
    expect(root, 'PreviewControls 의 루트 <div> 를 찾지 못했습니다').not.toBeNull();
    const cls = classesOf(root![1]!);
    expect(cls).toContain('shrink-0');
    expect(cls).toContain('flex-wrap');
  });

  it('캔버스 프리뷰 헤더도 같은 규칙 — [닫기] 가 눌려 사라지지 않는다', () => {
    const node = readSource('components/BubbleMap/PlayPreviewNode.tsx');

    // 새로고침·브라우저로 열기·닫기 세 버튼의 공통 클래스.
    const iconBtn = /const iconBtn = '([^']+)'/.exec(node);
    expect(iconBtn, 'PlayPreviewNode 의 iconBtn 클래스를 찾지 못했습니다').not.toBeNull();
    expect(classesOf(iconBtn![1]!)).toContain('shrink-0');

    const header = /className="(drag-handle[^"]*)"/.exec(node);
    expect(header, 'PlayPreviewNode 의 헤더(drag-handle)를 찾지 못했습니다').not.toBeNull();
    const cls = classesOf(header![1]!);
    expect(cls).toContain('flex-wrap');
    // 고정 높이면 접힌 둘째 줄이 그대로 잘린다 — 접을 거면 높이는 하한만 준다.
    expect(cls).not.toContain('h-7');
    expect(cls).toContain('min-h-7');
  });

  it('넘치는 폭은 프리뷰 본체가 가로 스크롤로 받는다 (한 폭 · 비교 둘 다)', () => {
    const frames = readSource('components/Preview/PreviewFrames.tsx');
    // 실제 폭 그대로 그리는 iframe 을 담는 두 컨테이너(한 폭 / 비교) 모두가 스크롤 컨테이너여야 한다.
    // 하나라도 `overflow-auto` 를 잃으면 그 폭이 조상에게 번져 조작 줄이 다시 창 밖으로 나간다.
    const scrollers = frames.match(/className="[^"]*flex min-h-0 flex-1 [^"]*overflow-auto[^"]*"/g) ?? [];
    expect(scrollers).toHaveLength(2);
  });

  it('그 스크롤바는 앱 공용 톤이고, 대기 상태에서는 숨어 있다', () => {
    const frames = readSource('components/Preview/PreviewFrames.tsx');

    // `scrollbar-thin` 을 빼면 index.css 의 **전역 기본값**(항상 보이는 슬레이트 썸)이 되살아난다.
    // 비교 줄은 폭이 늘 넘치므로, 그 순간 아무것도 안 했는데 처음부터 스크롤바가 그어져 있게 된다.
    const scrollers = [...frames.matchAll(/className="([^"]*flex min-h-0 flex-1 [^"]*overflow-auto[^"]*)"/g)];
    expect(scrollers).toHaveLength(2);
    for (const m of scrollers) expect(classesOf(m[1]!)).toContain('scrollbar-thin');

    // hover 만으로는 휠·터치·키보드로 굴리기만 한 사용자에게 스크롤바가 오지 않는다 — 두 컨테이너
    // 모두 `useScrollReveal` 의 `data-scrolling` 을 달고 있어야 굴리는 동안에도 뜬다.
    expect(frames).toContain('useScrollReveal');
    expect(frames.match(/\{\.\.\.scrollReveal\}/g) ?? []).toHaveLength(2);
  });

  /**
   * §7.16 — 마우스만 대도 떠야 한다. 다른 오리진 iframe 위에선 `:hover` 가 서지 않아 안에서 온 신고를 `data-hovering` 으로 세운다
   * — 표식과 CSS 규칙이 다른 파일이라 한쪽만 지워져도 조용히 죽는다.
   */
  it('마우스를 대기만 해도 뜬다 — 안에서 온 신고가 `:hover` 를 대신한다', () => {
    const frames = readSource('components/Preview/PreviewFrames.tsx');

    // 두 컨테이너(한 폭 · 비교) 모두가 표식을 달아야 한다 — 하나만 달면 그 폭에서만 산다.
    expect(frames.match(/data-hovering=\{hoverReveal\}/g) ?? []).toHaveLength(2);
    // 값의 출처는 훅이 들고 있는 신고다(컴포넌트가 자기 `onMouseEnter` 로 지어내면 iframe 위에서 안 온다).
    expect(frames).toContain('picker.hovered');

    // 표식만 달고 규칙이 없으면 아무 일도 일어나지 않는다 — 색은 굴릴 때와 같은 값이어야 한다.
    expect(indexCss).toContain(".scrollbar-thin[data-hovering='true']");
    expect(indexCss).toContain("[data-hovering='true']::-webkit-scrollbar-thumb");
  });
});
