import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { compositionRuntimeScript, type CompositionRuntimeInit } from './runtime.js';
import { scanComposition } from './lint.js';

/**
 * §5.13 (Y) 40-8 ②③ — 런타임 심: 애니메이션이 있을 때만 `getAnimations()` 를 부르고, 시각을 스스로 받는 컴포지션은 rAF·타이머를
 * 써도 `random` 이다. 심을 창 없이 vm 문맥에서 돌린다(iframe 이 가진 것만 흉내 낸다).
 */

type Msg = Record<string, unknown>;

function boot(opts: { styles?: string[]; links?: number; observer?: boolean } = {}, init: Partial<CompositionRuntimeInit> = {}) {
  const messages: Msg[] = [];
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const getAnimations = vi.fn(() => [] as unknown[]);
  let observerCallback: ((records: unknown[]) => void) | null = null;
  const pendingRecords: unknown[] = [];
  const parent = { postMessage: (m: unknown) => messages.push(JSON.parse(JSON.stringify(m)) as Msg) };
  const styles = (opts.styles ?? []).map((text) => ({ textContent: text }));
  const sandbox: Record<string, unknown> = {
    parent,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setTimeout, clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    Element: { prototype: { animate: function animate() { return {}; } } },
    document: {
      readyState: 'complete', images: [], documentElement: {},
      addEventListener: () => undefined,
      getAnimations,
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel.startsWith('link') ? Array.from({ length: opts.links ?? 0 }) : sel === 'style' ? styles : []),
    },
  };
  if (opts.observer !== false) {
    sandbox['MutationObserver'] = class {
      constructor(cb: (records: unknown[]) => void) { observerCallback = cb; }
      observe(): void { /* records are injected by the test */ }
      takeRecords(): unknown[] { return pendingRecords.splice(0); }
    };
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(compositionRuntimeScript({ props: {}, seed: 1, itemId: 'c', fps: 30, duration: 4, width: 100, height: 100, ...init }), ctx);
  const waitFor = async (pred: (m: Msg) => boolean): Promise<Msg> => {
    for (let i = 0; i < 200; i += 1) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error('no message');
  };
  return {
    getAnimations,
    messages,
    run: <T,>(code: string): T => vm.runInContext(code, ctx) as T,
    addRecord: (record: unknown) => { pendingRecords.push(record); void observerCallback; },
    seek: (t: number, seq: number) => {
      for (const fn of listeners.get('message') ?? []) fn({ source: parent, data: { __vibi: 'seek', t, seq } });
      return waitFor((m) => m.__vibi === 'ready' && m.seq === seq);
    },
    waitFor,
  };
}

describe('§5.13 (Y) 40-8 ② getAnimations 는 애니메이션이 있을 때만', () => {
  it('스타일에 애니메이션·전환·키프레임이 없고 animate() 도 안 부르면 한 번도 부르지 않는다', async () => {
    const b = boot({ styles: ['body { background: #000 } .t { transform: translateX(10px) }'] });
    b.run('window.__vibi.seek = function (t) {};');
    for (let i = 1; i <= 5; i += 1) await b.seek(i / 10, i);
    expect(b.getAnimations).not.toHaveBeenCalled();
  });

  it('@keyframes 가 있으면 시각마다 맞춘다(종전과 같다)', async () => {
    const b = boot({ styles: ['@keyframes spin { to { transform: rotate(1turn) } }'] });
    await b.seek(0.5, 1);
    await b.seek(1, 2);
    expect(b.getAnimations).toHaveBeenCalledTimes(2);
  });

  it('element.animate() 를 부르면 그때부터 맞춘다', async () => {
    const b = boot();
    await b.seek(0.1, 1);
    expect(b.getAnimations).not.toHaveBeenCalled();
    b.run('Element.prototype.animate.call({}, [], 1000);');
    await b.seek(0.2, 2);
    expect(b.getAnimations).toHaveBeenCalledTimes(1);
  });

  it('style 속성에 animation 을 실은 변화가 오면 그때부터 맞춘다', async () => {
    const b = boot();
    await b.seek(0.1, 1);
    b.addRecord({ type: 'attributes', target: { getAttribute: () => 'animation: pulse 1s infinite' } });
    await b.seek(0.2, 2);
    expect(b.getAnimations).toHaveBeenCalledTimes(1);
  });

  it('외부 스타일시트(불투명 출처라 못 읽는다)가 있으면 있다고 본다', async () => {
    const b = boot({ links: 1 });
    await b.seek(0.1, 1);
    expect(b.getAnimations).toHaveBeenCalledTimes(1);
  });

  it('DOM 변화를 지켜볼 수 없는 문맥이면 종전대로 늘 맞춘다', async () => {
    const b = boot({ observer: false });
    await b.seek(0.1, 1);
    expect(b.getAnimations).toHaveBeenCalledTimes(1);
  });
});

describe('§5.13 (Y) 40-8 ③ 시각을 스스로 받으면 random', () => {
  it('rAF 를 써도 __vibi.seek 가 있으면 random 이고, 되감기는 가상 시계를 그 시각으로 옮긴다', async () => {
    const b = boot();
    b.run('var frames = 0; function loop() { frames += 1; requestAnimationFrame(loop); } requestAnimationFrame(loop);'
      + ' var seen = []; window.__vibi.seek = function (t) { seen.push(performance.now()); };');
    expect((await b.seek(1, 1)).mode).toBe('random');
    expect((await b.seek(0.25, 2)).mode).toBe('random');
    // 앞으로 1초는 60Hz 틱을 흘려 가고(부동소수 누적), 되감기는 그 시각으로 바로 옮긴다.
    expect((JSON.parse(b.run<string>('JSON.stringify(seen)')) as number[]).map((v) => Math.round(v))).toEqual([1000, 250]);
  });

  it('타임라인 객체가 있어도 random', async () => {
    const b = boot();
    b.run('setInterval(function () {}, 16); window.__vibi.timelines.push({ pause: function () {}, seek: function () {} });');
    expect((await b.seek(1, 1)).mode).toBe('random');
  });

  it('rAF 만 쓰고 시각을 받지 않으면 종전대로 forward', async () => {
    const b = boot();
    b.run('function loop() { requestAnimationFrame(loop); } requestAnimationFrame(loop);');
    expect((await b.seek(1, 1)).mode).toBe('forward');
  });
});

describe('§5.13 (Y) 40-8 ③④ 정적 검사 — 같은 판정 · 성능 경고(막지 않는다)', () => {
  const scan = (html: string, styles: string[] = []) => scanComposition({ html, scripts: [], styles });

  it('rAF + __vibi.seek 는 random 이고, 그 사실을 알린다', () => {
    const r = scan('<script>requestAnimationFrame(function(){}); window.__vibi.seek = function (t) {};</script>');
    expect(r.mode).toBe('random');
    expect(r.lint.map((l) => l.code)).toContain('frame-callbacks-seekable');
  });

  it('rAF 만 쓰면 forward', () => {
    expect(scan('<script>requestAnimationFrame(function(){});</script>').mode).toBe('forward');
  });

  it.each([
    ['perf-background-position', '<script>el.style.backgroundPosition = t + "px 0";</script>', []],
    ['perf-animated-filter', '<script>el.style.filter = "blur(" + t + "px)";</script>', []],
    ['perf-blur-shadow', '<div></div>', ['.glow { box-shadow: 0 0 80px 40px #0ff8 }']],
    ['perf-put-image-data', '<script>ctx.putImageData(img, 0, 0);</script>', []],
    ['perf-background-position', '<div></div>', ['@keyframes drift { from { background-position: 0 0 } to { background-position: 100% 0 } }']],
  ])('%s', (code, html, styles) => {
    const r = scan(html as string, styles as string[]);
    const hit = r.lint.find((l) => l.code === code);
    expect(hit?.level).toBe('warn');
  });

  it('transform·opacity 만으로 움직이면 성능 경고가 없다', () => {
    const r = scan('<script>window.__vibi.seek = function (t) { el.style.transform = "translateX(" + t + "px)"; el.style.opacity = 1; };</script>', ['.box { box-shadow: 0 2px 6px #0003 }']);
    expect(r.lint.filter((l) => l.code.startsWith('perf-'))).toEqual([]);
  });
});
