import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { scanComposition } from '../composition/lint.js';
import { parseCompositionMeta, parsePropsDecl } from '../composition/meta.js';
import { VIDEO_PARTS, findPart } from './library.js';

/**
 * §5.13 (V) 37-11 (B) — 우리가 쓴 부품이 지킬 것: 외부 라이브러리 0 · 값 선언 · 스타일 변수 · 판형 반응형 · 시각의 순수 함수 · lint 경고 0 ·
 * 썸네일 시각(길이의 60%)에 숨은 요소가 없다. 스크립트는 가짜 DOM 위에서 실제로 돌려 본다(문자열이라 문법 오류가 빌드에 안 걸린다).
 */

/** 렌더 엔진(앱 실행본)의 Chromium 메이저 — 그보다 새 기능을 쓰면 lint 가 알린다. */
const ENGINE = 126;
/** 서랍 썸네일을 굽는 시각(길이 대비) — `partsRoutes.ts` 의 값과 같다. */
const THUMB_AT = 0.6;
/** 깜빡이는 것(코드 타이핑의 커서)은 썸네일 시각에 꺼져 있어도 숨은 요소가 아니다. */
const BLINKS: ReadonlySet<string> = new Set(['cur']);
const SIZES = [
  { name: '16:9', width: 1920, height: 1080 },
  { name: '9:16', width: 1080, height: 1920 },
  { name: '1:1', width: 1080, height: 1080 },
] as const;

// ── 가짜 DOM — 부품이 쓰는 만큼만.

class FakeStyle {
  [key: string]: unknown;
  setProperty(name: string, value: string): void { this[name] = value; }
}

class FakeEl {
  id = '';
  className = '';
  src = '';
  width = 0;
  height = 0;
  style = new FakeStyle();
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  /** canvas 가 받은 그리기 호출(시각마다 비우고 다시 쌓는다). */
  readonly draws: string[] = [];
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text; }
  set textContent(value: string) { this.text = String(value); this.children = []; }
  appendChild(child: FakeEl): FakeEl { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attrs[name] = String(value); }
  removeAttribute(name: string): void { delete this.attrs[name]; if (name === 'src') this.src = ''; }
  getContext(): unknown {
    const draws = this.draws;
    const state: Record<string, unknown> = {};
    return new Proxy({}, {
      get: (_t, key) => (key in state ? state[String(key)] : (...args: unknown[]) => { draws.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`); }),
      set: (_t, key, value) => { state[String(key)] = value; draws.push(`${String(key)}=${String(value)}`); return true; },
    });
  }
  snapshot(): unknown {
    return {
      id: this.id, tag: this.tag, className: this.className, text: this.text, src: this.src,
      style: Object.fromEntries(Object.entries(this.style)), attrs: this.attrs, draws: [...this.draws],
      children: this.children.map((c) => c.snapshot()),
    };
  }
  /** 이 요소와 그 아래의 모든 요소. */
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}

interface Mounted {
  readonly vibi: { props: Record<string, unknown>; width: number; height: number; duration: number; seek?: (t: number) => void; onProps?: (props: unknown) => void; style?: unknown };
  readonly byId: ReadonlyMap<string, FakeEl>;
  seek(t: number): unknown;
}

/** 부품 HTML 의 스크립트를 가짜 문서에서 돌린다. `box` 는 런타임이 준 상자 크기(판형 파생). */
function mount(html: string, box: { width: number; height: number }, duration: number, props: Record<string, unknown> = {}): Mounted {
  const body = html.slice(html.indexOf('<body>'), html.lastIndexOf('<script>'));
  const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const byId = new Map<string, FakeEl>();
  for (const m of body.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) {
    const el = new FakeEl(m[1]!);
    el.id = m[2]!;
    byId.set(el.id, el);
  }
  const root = new FakeEl('html');
  const vibi: Mounted['vibi'] = { props, width: box.width, height: box.height, duration };
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: root,
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => new FakeEl(tag),
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    __vibi: vibi,
  };
  sandbox['window'] = sandbox;
  vm.runInNewContext(script, sandbox, { timeout: 2000 });
  return {
    vibi,
    byId,
    seek(t: number): unknown {
      for (const el of byId.values()) el.draws.length = 0;
      vibi.seek!(t);
      return JSON.parse(JSON.stringify([...byId.values()].map((el) => el.snapshot())));
    },
  };
}

describe('§5.13 37-11 부품 서랍 — 목록', () => {
  it('열다섯 부품, id 는 겹치지 않고 서랍 칸은 다섯', () => {
    expect(VIDEO_PARTS.map((p) => p.id)).toEqual([
      'title-card', 'lower-third', 'kinetic-type', 'quote', 'counter', 'bar-chart', 'line-chart', 'donut-chart', 'code-typing',
      'device-frame', 'before-after', 'steps', 'logo-reveal', 'end-card', 'word-captions',
    ]);
    expect(new Set(VIDEO_PARTS.map((p) => p.id)).size).toBe(VIDEO_PARTS.length);
    // 서랍은 처음 나온 갈래 순으로 칸을 세운다.
    expect([...new Set(VIDEO_PARTS.map((p) => p.category))]).toEqual(['text', 'data', 'layout', 'brand', 'captions']);
    expect(findPart('device-frame')?.category).toBe('layout');
    expect(findPart('nope')).toBeUndefined();
  });
});

describe.each(VIDEO_PARTS.map((p) => [p.id, p] as const))('§5.13 37-11 부품 %s', (_id, part) => {
  const html = part.html({ width: 1280, height: 720 });

  it('lint 에 걸리지 않고(경고·오류 0) 아무 시점으로 맞출 수 있다', () => {
    const scan = scanComposition({ html, scripts: [], styles: [] }, { chromium: ENGINE });
    expect(scan.lint.filter((l) => l.level !== 'info').map((l) => `${l.level}:${l.code}`)).toEqual([]);
    expect(scan.mode).toBe('random');
  });

  it('값 선언·길이·반응형을 선언하고, 값마다 기본값과 이름표가 있다', () => {
    const meta = parseCompositionMeta(html);
    expect(meta.duration).toBe(part.defaultDuration);
    expect(html).toContain('<meta name="vibi:responsive" content="true">');
    const decl = parsePropsDecl(html);
    expect(decl.found).toBe(true);
    expect(decl.errors).toEqual([]);
    expect(decl.decl.length).toBeGreaterThan(0);
    const raw = JSON.parse(/<script type="application\/json" id="vibi-props">([\s\S]*?)<\/script>/.exec(html)![1]!) as Record<string, Record<string, unknown>>;
    for (const [name, d] of Object.entries(raw)) {
      expect(d['default'], name).not.toBeUndefined();
      expect(typeof d['label'], name).toBe('string');
    }
  });

  it('외부 라이브러리·바깥 주소가 없고, 색·글꼴은 스타일 변수에서 온다', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script[^>]*\bsrc=|<link\b|@import\b/);
    expect(html).toContain('var(--vibi-font,');
    expect(html).toContain('var(--vibi-fg,');
    expect(html).toMatch(/--vibi-accent/);
    // 실행되는 스크립트에 템플릿 글자가 새지 않았다 · 벽시계·난수를 쓰지 않는다(같은 시각 = 같은 화면).
    expect(html).not.toMatch(/`|\$\{/);
    expect(html).not.toMatch(/Date\.now|new Date|performance\.now|Math\.random|requestAnimationFrame|setTimeout|setInterval/);
  });

  it.each(SIZES)('$name: 시각의 순수 함수다 — 앞뒤로 오가도 같은 시각은 같은 화면', (size) => {
    const m = mount(part.html(size), size, part.defaultDuration);
    const d = part.defaultDuration;
    expect(typeof m.vibi.seek).toBe('function');
    const times = [0, d * 0.25, d * THUMB_AT, d - 0.05, d];
    const first = times.map((t) => m.seek(t));
    const again = [...times].reverse().map((t) => m.seek(t)).reverse();
    expect(again).toEqual(first);
    // 무언가는 움직인다(시작과 썸네일 시각이 같은 그림이면 부품이 아니다).
    expect(first[2]).not.toEqual(first[0]);
  });

  it.each(SIZES)('$name: 썸네일 시각(길이의 60%)에 숨은 요소가 없다', (size) => {
    const m = mount(part.html(size), size, part.defaultDuration);
    m.seek(part.defaultDuration * THUMB_AT);
    const hidden = [...m.byId.values()].flatMap((el) => el.all())
      .filter((el) => !BLINKS.has(el.className) && el.style['display'] !== 'none' && typeof el.style['opacity'] === 'string' && Number(el.style['opacity']) < 0.3)
      .map((el) => `${el.id || el.className}=${String(el.style['opacity'])}`);
    expect(hidden).toEqual([]);
  });

  it('상자 크기가 선언 크기와 달라도(판형 파생) 그 상자에 맞춰 돈다 · 값이 비거나 바뀌어도 서지 않는다', () => {
    const m = mount(html, { width: 1080, height: 1920 }, part.defaultDuration);
    expect(() => m.seek(part.defaultDuration * THUMB_AT)).not.toThrow();
    const raw = JSON.parse(/<script type="application\/json" id="vibi-props">([\s\S]*?)<\/script>/.exec(html)![1]!) as Record<string, { type: string; options?: string[] }>;
    const blank: Record<string, unknown> = {};
    const other: Record<string, unknown> = {};
    for (const [name, d] of Object.entries(raw)) {
      if (d.type === 'text' || d.type === 'image' || d.type === 'color') blank[name] = '';
      if (d.type === 'choice') other[name] = d.options!.at(-1);
      if (d.type === 'text') other[name] = 'A, B\nC';
      if (d.type === 'image') other[name] = 'shot.png';
    }
    for (const props of [blank, other]) {
      m.vibi.props = props;
      expect(() => { m.vibi.onProps?.(props); m.seek(0); m.seek(part.defaultDuration * THUMB_AT); m.seek(part.defaultDuration); }).not.toThrow();
    }
  });
});

describe('§5.13 37-11 (A) 더한 부품의 움직임', () => {
  const at = (id: string, t: number, props: Record<string, unknown> = {}, size = SIZES[0] as { width: number; height: number }): Mounted => {
    const part = findPart(id)!;
    const m = mount(part.html(size), size, part.defaultDuration, props);
    m.seek(t);
    return m;
  };

  it('제목 카드: 줄마다 가림 뒤에서 올라와 서고, 비운 윗글·받침글은 자리를 차지하지 않는다', () => {
    const m = at('title-card', 3);
    const title = m.byId.get('title')!;
    expect(title.children).toHaveLength(2);
    for (const mask of title.children) expect(mask.children[0]!.style['transform']).toBe('translateY(0%)');
    expect(m.byId.get('eyebrow')!.style['display']).toBe('');
    const blank = at('title-card', 3, { eyebrow: '', subtitle: '' });
    expect(blank.byId.get('eyebrow')!.style['display']).toBe('none');
    expect(blank.byId.get('sub')!.style['display']).toBe('none');
    // 세로 판형은 오른쪽 화면 UI 자리(14%)를 비운다.
    expect(at('title-card', 3, {}, SIZES[1]).byId.get('card')!.style['paddingRight']).toBe(`${1080 * 0.14}px`);
  });

  it('인용: 말한 사람·직함을 다 비우면 그 줄이 사라진다', () => {
    expect(at('quote', 3.6).byId.get('by')!.style['display']).toBe('');
    expect(at('quote', 3.6, { author: '', role: '' }).byId.get('by')!.style['display']).toBe('none');
    expect(at('quote', 3.6).byId.get('text')!.children.map((c) => c.textContent)).toEqual(['We shipped in a week', 'what used to take a quarter.']);
  });

  it('화면 목업 틀: 브라우저·폰 틀이 판형 안에 들어가고, 그림이 없으면 자리 표시를 보인다', () => {
    for (const size of SIZES) {
      for (const device of ['browser', 'phone']) {
        const frame = at('device-frame', 3.6, { device }, size).byId.get('frame')!;
        expect(frame.className).toBe(`frame ${device}`);
        expect(Number(String(frame.style['width']).replace('px', ''))).toBeLessThanOrEqual(size.width * 0.84 + 1e-6);
        expect(Number(String(frame.style['height']).replace('px', ''))).toBeLessThanOrEqual(size.height * 0.8 + 1e-6);
      }
    }
    const empty = at('device-frame', 3.6);
    expect(empty.byId.get('shot')!.style['display']).toBe('none');
    expect(empty.byId.get('ph')!.style['display']).toBe('');
    const shot = at('device-frame', 3.6, { screen: 'screen.png' });
    expect(shot.byId.get('shot')!.src).toBe('screen.png');
    expect(shot.byId.get('ph')!.style['display']).toBe('none');
  });

  it('전후 비교: 가름선이 오른쪽 끝에서 쉬는 자리로 와 두 화면을 함께 보이고, 끝에는 뒤 화면만 남긴다(hold 면 머문다)', () => {
    expect(at('before-after', 0).byId.get('after')!.style['clipPath']).toBe('inset(0 0 0 100%)');
    expect(at('before-after', 3.6).byId.get('after')!.style['clipPath']).toBe('inset(0 0 0 50%)');
    expect(at('before-after', 3.6, { split: 30 }).byId.get('after')!.style['clipPath']).toBe('inset(0 0 0 30%)');
    expect(at('before-after', 6).byId.get('after')!.style['clipPath']).toBe('inset(0 0 0 0%)');
    expect(at('before-after', 6, { finish: 'hold' }).byId.get('after')!.style['clipPath']).toBe('inset(0 0 0 50%)');
    // 가름선은 자리 이동(transform)으로만 움직인다.
    const m = at('before-after', 3.6);
    const cardWidth = Number(String(m.byId.get('card')!.style['width']).replace('px', ''));
    expect(m.byId.get('div')!.style['transform']).toBe(`translateX(${cardWidth / 2}px)`);
  });

  it('단계 진행: 단계가 차례로 켜지고 잇는 선이 따라 찬다 · 세로 판형은 세로로 선다', () => {
    const lit = (t: number): number[] => at('steps', t).byId.get('steps')!.children.map((step) => Number(step.children.find((c) => c.className === 'dot')!.children[0]!.style['opacity']));
    expect(lit(0.4)).toEqual([0, 0, 0, 0]);
    expect(lit(1.2)).toEqual([1, 0, 0, 0]);
    expect(lit(2.2)).toEqual([1, 1, 0, 0]);
    expect(lit(3.6)).toEqual([1, 1, 1, 1]);
    const host = at('steps', 3.6, { steps: 'One, Two, Three' }, SIZES[1]).byId.get('steps')!;
    expect(host.className).toBe('steps v');
    expect(host.children).toHaveLength(3);
    // 마지막 단계 뒤에는 잇는 선이 없다.
    expect(host.children.map((step) => step.children.filter((c) => c.className === 'seg').length)).toEqual([1, 1, 0]);
    expect(host.children[0]!.children[0]!.children[0]!.style['transform']).toBe('scaleY(1)');
  });

  it('엔드 카드: 다 들어온 뒤에는 끝까지 멈춰 선다(읽을 시간) · 로고가 없으면 그 자리를 접는다', () => {
    const part = findPart('end-card')!;
    const m = mount(part.html(SIZES[0]), SIZES[0], part.defaultDuration);
    expect(m.seek(2)).toEqual(m.seek(part.defaultDuration));
    expect(m.byId.get('logo')!.style['display']).toBe('none');
    const withLogo = at('end-card', 3, { logo: 'logo.svg', cta: '' });
    expect(withLogo.byId.get('logo')!.src).toBe('logo.svg');
    expect(withLogo.byId.get('cta')!.style['display']).toBe('none');
  });
});
