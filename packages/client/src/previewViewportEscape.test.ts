import { describe, it, expect } from 'vitest';
import { PREVIEW_DEVICE_PRESETS, resolveCompareWidths } from '@vibisual/shared';

/**
 * §5.17 · §7.16 **프리뷰 폭 프리셋에서 되돌아올 수 있는가**의 집행.
 *
 * 실제 사고: 탭 프리뷰에서 `비교`(또는 `데스크톱`)를 고르면 **조작 줄이 화면 밖으로 밀려나** 다시
 * `자동` 으로 돌아올 방법이 사라졌다. 원인은 iframe 도 프리셋도 아니라 **한 칸 위의 CSS** 였다.
 *
 *  - `App.tsx` 의 `<main>` 은 가로 flex 의 항목인데 `min-width` 가 `auto` 였다. 가로 flex 항목의
 *    `min-width:auto` 는 **콘텐츠 최소폭**으로 풀린다 — 비교 줄의 최소폭은 390+820+1280 = 2490px 다.
 *  - 그래서 `<main>` 이 2490px 로 부풀고, 그 부모의 `overflow-hidden` 이 넘친 부분을 **스크롤바 없이**
 *    잘라 냈다. URL 줄도 함께 2490px 가 되어, 그 오른쪽 끝에 있던 폭 프리셋 줄이 창 밖에 놓였다.
 *  - 창 밖이라 누를 수도, 스크롤해 데려올 수도 없다. 프리셋은 `localStorage` 에 남으므로 껐다 켜도
 *    그대로다 — 그래서 "한 번 바꾸면 돌아갈 방법이 없다" 가 된다.
 *
 * 고친 방향은 하나다: **넘치는 폭은 프리뷰 본체의 가로 스크롤이 받는다**(§7.16 이 처음부터 정한 동작).
 * 조작 줄은 어떤 폭에서도 잘리지 않고, 모자라면 아랫줄로 접힌다.
 *
 * jsdom 에는 레이아웃이 없어 폭을 재서 확인할 수 없다. 대신 그 동작을 만드는 **클래스 자체**를
 * 소스에서 확인한다(`typographyFloor.test.ts` 와 같은 방식). `node:fs` 는 클라이언트 tsconfig 에
 * Node 타입이 없어 쓸 수 없으므로 Vite 의 `import.meta.glob(?raw)` 로 읽는다.
 *
 * ⚠ 이 테스트는 **`packages/client` 에서** 실행해야 한다 — 레포 루트에서 돌리면 glob 이 빈 문자열을
 *   돌려주어 아래 `readSource` 가 그 사실을 알리고 멈춘다(멀쩡한 코드를 위반으로 오진하지 않게).
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
    const scrollers = frames.match(/className="flex min-h-0 flex-1 [^"]*overflow-auto[^"]*"/g) ?? [];
    expect(scrollers).toHaveLength(2);
  });
});
