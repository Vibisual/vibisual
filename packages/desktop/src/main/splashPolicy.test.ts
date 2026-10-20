/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 판정 모듈을 표로 고정한다.
 *
 * 사용자 보고(2026-10-16): "우리 앱이 처음 뜰 때 바로 띄우니까 떴음에도 버벅인다 — 언리얼·VS 처럼 처음 켤 때 로딩 화면이
 * 중간에 떴으면". 실측(main-stall.log 7회): 첫 창은 프로세스 시작 뒤 약 10초에야 보였고, 그 뒤 첫 3초에 0.2~2.9초 멈췄다.
 * 스플래시가 그 구간을 맡는다. 막대가 뒤로 가거나, 창이 영영 숨거나, 세 OS 중 하나에서 창 옵션이 어긋나는 일을 여기서 막는다.
 */
import { describe, expect, it } from 'vitest';
import {
  centeredSplashBounds,
  coversFirstShow,
  decideMainReveal,
  FIRST_SHOW_COVER_CAP_MS,
  FIRST_SHOW_COVER_FRAMES,
  FIRST_SHOW_COVER_MIN_MS,
  rendererFramesScript,
  SPLASH_PRESENT_CAP_MS,
  makeSplashCache,
  MAIN_REVEAL_HARD_CAP_MS,
  MAIN_REVEAL_QUIET_MS,
  MAIN_REVEAL_SETTLE_CAP_MS,
  parseSplashCache,
  resolveSplashLocale,
  serializeSplashCache,
  SPLASH_FALLBACK_BACKGROUND,
  SPLASH_HEIGHT,
  SPLASH_STAGE_BANDS,
  SPLASH_WIDTH,
  splashBootView,
  splashDoneView,
  splashIconFile,
  splashPalette,
  splashProjectsView,
  splashStageView,
  splashWindowOptions,
  type MainRevealInputs,
  type SplashStage,
} from './splashPolicy';
import { FALLBACK_APP_THEME_CHROME } from './themeChromePolicy';
import { splashStrings } from './splashStrings';

const ko = splashStrings('ko');
const ORDER: SplashStage[] = ['starting', 'loading', 'services', 'projects', 'sessions', 'connecting', 'workspace', 'finishing'];

describe('진행 구간 — 막대는 뒤로 가지 않는다', () => {
  it('단계 순서대로 시작이 오르고, 각 단계의 천장은 다음 단계의 시작을 넘지 않는다', () => {
    for (let i = 0; i < ORDER.length; i += 1) {
      const [lo, hi] = SPLASH_STAGE_BANDS[ORDER[i]!];
      expect(lo, `${ORDER[i]} 시작`).toBeGreaterThanOrEqual(0);
      expect(hi, `${ORDER[i]} 천장`).toBeLessThanOrEqual(1);
      expect(hi, `${ORDER[i]} 천장 ≥ 시작`).toBeGreaterThan(lo);
      const next = ORDER[i + 1];
      if (next) expect(hi, `${ORDER[i]} 천장이 ${next} 시작을 넘었다`).toBeLessThanOrEqual(SPLASH_STAGE_BANDS[next][0]);
    }
  });

  it('끝(100%)은 다 됐을 때만 — 마지막 단계의 천장은 1 보다 작다', () => {
    expect(SPLASH_STAGE_BANDS.finishing[1]).toBeLessThan(1);
    expect(splashDoneView(ko)).toMatchObject({ progress: 1, ceiling: 1 });
  });

  it('단계 장면은 그 단계의 문구와 구간이다', () => {
    expect(splashStageView('connecting', ko)).toEqual({
      text: ko.connecting, detail: '', progress: SPLASH_STAGE_BANDS.connecting[0], ceiling: SPLASH_STAGE_BANDS.connecting[1],
    });
  });
});

describe('프로젝트 복원 장면 — "몇 번째를 읽는 중"', () => {
  it('지금 읽는 프로젝트를 1부터 센다(0개 끝냈으면 1/3)', () => {
    const v = splashProjectsView(0, 3, 'vibisual', ko);
    expect(v.text).toBe('프로젝트를 복원하는 중 (1/3)…');
    expect(v.detail).toBe('vibisual');
    expect(v.progress).toBeCloseTo(SPLASH_STAGE_BANDS.projects[0]);
  });

  it('한 칸은 프로젝트 구간을 개수로 나눈 것이고, 천장은 그 칸의 끝이다(한 프로젝트가 오래 걸려도 다음 칸을 넘지 않는다)', () => {
    const [lo, hi] = SPLASH_STAGE_BANDS.projects;
    const v = splashProjectsView(1, 4, 'b', ko);
    expect(v.progress).toBeCloseTo(lo + (hi - lo) / 4);
    expect(v.ceiling).toBeCloseTo(lo + (hi - lo) / 2);
    expect(splashProjectsView(2, 4, 'c', ko).progress).toBeCloseTo(v.ceiling);
  });

  it('다 끝나면 total/total · 이름 없음 · 구간 끝', () => {
    const v = splashProjectsView(4, 4, undefined, ko);
    expect(v.text).toBe('프로젝트를 복원하는 중 (4/4)…');
    expect(v.detail).toBe('');
    expect(v.progress).toBeCloseTo(SPLASH_STAGE_BANDS.projects[1]);
  });

  it('열어 둔 프로젝트가 없으면(첫 실행) "(0/0)" 대신 다음 장면', () => {
    expect(splashProjectsView(0, 0, undefined, ko)).toEqual(splashStageView('sessions', ko));
  });

  it('긴 이름은 잘라서 싣는다', () => {
    expect(splashProjectsView(0, 1, 'x'.repeat(300), ko).detail.length).toBeLessThanOrEqual(80);
  });

  it('서버 진척 → 장면', () => {
    expect(splashBootView({ phase: 'projects', done: 0, total: 2, label: 'a' }, ko).text).toBe('프로젝트를 복원하는 중 (1/2)…');
    expect(splashBootView({ phase: 'services' }, ko)).toEqual(splashStageView('sessions', ko));
  });
});

describe('언어 — 지난 실행의 UI 언어, 없으면 OS 언어', () => {
  it('캐시에 지원 언어가 있으면 그것', () => {
    expect(resolveSplashLocale('ko', 'en-US')).toBe('ko');
  });

  it('캐시가 없거나 모르는 값이면 OS 언어를 동의 창과 같은 규칙으로 고른다', () => {
    expect(resolveSplashLocale(null, 'ko-KR')).toBe('ko');
    expect(resolveSplashLocale('xx', 'ja')).toBe('ja');
    expect(resolveSplashLocale(undefined, 'zh-TW')).toBe('zh-CN');
    expect(resolveSplashLocale(undefined, 'pt-PT')).toBe('pt-BR');
    expect(resolveSplashLocale(undefined, 'es-MX')).toBe('es-419');
    expect(resolveSplashLocale(undefined, 'es-ES')).toBe('es');
    expect(resolveSplashLocale(undefined, 'fr-CA')).toBe('fr');
    expect(resolveSplashLocale(undefined, 'sw-KE')).toBe('en');
  });
});

describe('색 — 테마의 창 바탕을 따른다', () => {
  it('기본 바탕은 본체 창의 기본 테마 바탕과 같다', () => {
    expect(SPLASH_FALLBACK_BACKGROUND).toBe(FALLBACK_APP_THEME_CHROME.background);
  });

  it('밝은 테마는 어두운 글자, 어두운 테마는 밝은 글자', () => {
    expect(splashPalette('#ffffff', 'light').foreground).toBe('#0f172a');
    expect(splashPalette('#030712', 'dark').foreground).toBe('#f1f5f9');
  });

  it('바탕이 #rrggbb 가 아니면 버린다 — CSS 로 들어가는 값이다', () => {
    expect(splashPalette('#000;}body{background:url(x)', 'dark').background).toBe(SPLASH_FALLBACK_BACKGROUND);
    expect(splashPalette('red', 'light').background).toBe('#f8fafc');
    expect(splashPalette(undefined, undefined).kind).toBe('dark');
  });
});

describe('표시 캐시 — 깨지면 기본값, 오류 ❌', () => {
  it('왕복한다', () => {
    const cache = makeSplashCache('ja', '#111827', 'dark');
    expect(parseSplashCache(serializeSplashCache(cache))).toEqual(cache);
  });

  it('모르는 모양은 받지 않는다', () => {
    expect(parseSplashCache(null)).toBeNull();
    expect(parseSplashCache('')).toBeNull();
    expect(parseSplashCache('not json')).toBeNull();
    expect(parseSplashCache('[]')).toBeNull();
    expect(parseSplashCache(JSON.stringify({ schema: 2, locale: 'ko', background: '#000000', kind: 'dark' }))).toBeNull();
    expect(parseSplashCache(JSON.stringify({ schema: 1, locale: 'xx', background: '#000000', kind: 'dark' }))).toBeNull();
    expect(parseSplashCache(JSON.stringify({ schema: 1, locale: 'ko', background: 'url(x)', kind: 'dark' }))).toBeNull();
    expect(parseSplashCache(JSON.stringify({ schema: 1, locale: 'ko', background: '#000000', kind: 'dim' }))).toBeNull();
    expect(parseSplashCache(`{"schema":1,"pad":"${'x'.repeat(5000)}"}`)).toBeNull();
  });

  it('지금 값이 지원 밖이면 안전한 값으로 적는다', () => {
    expect(makeSplashCache('xx', 'oklch(0.2 0 0)', 'light')).toEqual({ locale: 'en', background: SPLASH_FALLBACK_BACKGROUND, kind: 'light' });
  });
});

describe('창 — 세 OS', () => {
  const base = { background: '#030712', iconPath: '/icon', preloadPath: '/preload/splash.cjs' };

  it('작업 영역 한가운데 — 작은 화면이면 왼쪽 위에 붙인다', () => {
    expect(centeredSplashBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: (1920 - SPLASH_WIDTH) / 2, y: (1040 - SPLASH_HEIGHT) / 2, width: SPLASH_WIDTH, height: SPLASH_HEIGHT,
    });
    expect(centeredSplashBounds({ x: 1920, y: 0, width: 1280, height: 680 }).x).toBe(1920 + (1280 - SPLASH_WIDTH) / 2);
    expect(centeredSplashBounds({ x: 0, y: 0, width: 400, height: 300 })).toMatchObject({ x: 0, y: 0 });
  });

  it('셋 다 — 테두리 없음 · 크기 고정 · 작업 표시줄/Dock 에 보임 · 샌드박스 + 자기 세션 + 포트 preload', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const o = splashWindowOptions({ ...base, platform });
      expect(o, platform).toMatchObject({
        width: SPLASH_WIDTH, height: SPLASH_HEIGHT, show: false, frame: false, resizable: false, movable: false,
        skipTaskbar: false, backgroundColor: '#030712', icon: '/icon',
      });
      expect(o.webPreferences, platform).toMatchObject({
        preload: '/preload/splash.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false,
        partition: 'vibisual-splash', backgroundThrottling: false,
      });
    }
  });

  it('Linux 만 창 종류를 splash 로 알린다(X11 창 관리자가 가운데·장식 없이 둔다)', () => {
    expect(splashWindowOptions({ ...base, platform: 'linux' }).type).toBe('splash');
    expect(splashWindowOptions({ ...base, platform: 'win32' }).type).toBeUndefined();
    expect(splashWindowOptions({ ...base, platform: 'darwin' }).type).toBeUndefined();
  });

  it('작업 영역을 알면 직접 놓고, 모르면 center 에 맡긴다', () => {
    const placed = splashWindowOptions({ ...base, platform: 'linux', workArea: { x: 0, y: 0, width: 1000, height: 800 } });
    expect(placed).toMatchObject({ x: 220, y: 232 });
    expect(placed.center).toBeUndefined();
    expect(splashWindowOptions({ ...base, platform: 'win32' }).center).toBe(true);
  });

  it('바탕이 형식 밖이면 기본 바탕', () => {
    expect(splashWindowOptions({ ...base, platform: 'win32', background: 'nope' }).backgroundColor).toBe(SPLASH_FALLBACK_BACKGROUND);
  });

  it('아이콘 — Windows 는 .ico(작업 표시줄에서 흐리지 않게), 나머지는 PNG', () => {
    expect(splashIconFile('win32')).toBe('icon.ico');
    expect(splashIconFile('darwin')).toBe('icon.png');
    expect(splashIconFile('linux')).toBe('icon.png');
  });
});

describe('본체 창 공개 판정', () => {
  const t0 = 1_000_000;
  const at = (over: Partial<MainRevealInputs>): MainRevealInputs => ({
    now: t0 + 3_000, createdAt: t0, rendererReadyAt: t0 + 2_000, pendingJobs: 0, quietMs: MAIN_REVEAL_QUIET_MS, forced: false, ...over,
  });

  it('렌더러가 다 그렸고 · 부팅 확인이 다 돌고 · 조용하면 보인다', () => {
    expect(decideMainReveal(at({}))).toEqual({ reveal: true, reason: 'ready' });
  });

  it('렌더러가 말하기 전에는 기다린다', () => {
    expect(decideMainReveal(at({ rendererReadyAt: null }))).toEqual({ reveal: false });
  });

  it('부팅 확인이 남았으면 기다린다 — 창이 보인 뒤에 CLI 기동 멈춤이 오지 않게', () => {
    expect(decideMainReveal(at({ pendingJobs: 2 }))).toEqual({ reveal: false });
  });

  it('메인 스레드가 아직 바쁘면 기다린다', () => {
    expect(decideMainReveal(at({ quietMs: MAIN_REVEAL_QUIET_MS - 1 }))).toEqual({ reveal: false });
  });

  it('렌더러가 말한 지 오래면 조용하지 않아도 · 확인이 남아도 보인다', () => {
    expect(decideMainReveal(at({ now: t0 + 2_000 + MAIN_REVEAL_SETTLE_CAP_MS, pendingJobs: 3, quietMs: 0 })))
      .toEqual({ reveal: true, reason: 'settle-cap' });
  });

  it('렌더러가 끝내 말이 없어도 상한 뒤에는 보인다 — 창이 영영 숨으면 안 된다', () => {
    expect(decideMainReveal(at({ now: t0 + MAIN_REVEAL_HARD_CAP_MS - 1, rendererReadyAt: null }))).toEqual({ reveal: false });
    expect(decideMainReveal(at({ now: t0 + MAIN_REVEAL_HARD_CAP_MS, rendererReadyAt: null })))
      .toEqual({ reveal: true, reason: 'hard-cap' });
  });

  it('렌더러가 죽었거나 못 읽었으면 곧바로 — 그 창의 복구 안내가 보여야 한다', () => {
    expect(decideMainReveal(at({ forced: true, rendererReadyAt: null, pendingJobs: 5, quietMs: 0 })))
      .toEqual({ reveal: true, reason: 'forced' });
  });

  it('상한들의 크기 — 조용함 < 정착 상한 < 전체 상한', () => {
    expect(MAIN_REVEAL_QUIET_MS).toBeLessThan(MAIN_REVEAL_SETTLE_CAP_MS);
    expect(MAIN_REVEAL_SETTLE_CAP_MS).toBeLessThan(MAIN_REVEAL_HARD_CAP_MS);
  });
});

// 사용자 보고(2026-10-16): "처음에 왜 계속 흰색 화면이 로딩 화면 띄울 때 뜨냐 — 지금은 파박 바뀌긴 하는데, 렉이면 편법을 쓰던가".
// 화면 밖 측정 창(앱과 같은 Electron 31.7.7)이 재현했다 — 숨겨 만든 창을 처음 보이면 첫 장들이 #ffffff(실제 스플래시 코드는
// 표시 뒤 40~60ms · 75Hz 에서 3~4프레임). 가린 채 보이고 렌더러 프레임을 세어 걷으면 흰 표본은 전부 가린 동안에만 찍혔다.
describe('첫 표시 가림 — 처음 보일 때의 흰 프레임', () => {
  it('Windows 만 가린다(DWM). macOS·Linux 는 보고도 수단도 없다 — 종전대로 보인다', () => {
    expect(coversFirstShow('win32')).toBe(true);
    expect(coversFirstShow('darwin')).toBe(false);
    expect(coversFirstShow('linux')).toBe(false);
  });

  it('걷는 조건은 측정한 흰 구간보다 넉넉하고, 스플래시의 표시 상한 안에 든다', () => {
    // 측정한 흰 구간 3~4프레임 + 걷는 쪽 여유(6프레임에서 1~3프레임이었다 — 그보다 둘 더).
    expect(FIRST_SHOW_COVER_FRAMES).toBeGreaterThanOrEqual(8);
    expect(FIRST_SHOW_COVER_MIN_MS).toBeGreaterThanOrEqual(4 * 16);
    // 가린 동안(최소 시간) + 걷은 뒤 두 프레임까지가 스플래시 표시 상한 안에 넉넉히 들어야 정상 부팅이 상한에 걸리지 않는다.
    expect(FIRST_SHOW_COVER_MIN_MS * 4).toBeLessThan(SPLASH_PRESENT_CAP_MS);
    expect(FIRST_SHOW_COVER_MIN_MS).toBeLessThan(FIRST_SHOW_COVER_CAP_MS);
  });

  function runScript(source: string): { frames: Array<() => void>; done: () => boolean } {
    const frames: Array<() => void> = [];
    let finished = false;
    const raf = (callback: () => void): number => frames.push(callback);
    const promise = new Function('requestAnimationFrame', `return ${source}`)(raf) as Promise<unknown>;
    void promise.then(() => { finished = true; });
    return { frames, done: () => finished };
  }

  it.each([1, 2, 8])('렌더러 프레임 %i 번을 실제로 지나야 풀린다(고정 지연이 아니다)', async (n) => {
    const run = runScript(rendererFramesScript(n));
    for (let i = 0; i < n; i += 1) {
      expect(run.frames).toHaveLength(1);
      await Promise.resolve();
      expect(run.done()).toBe(false);
      run.frames.shift()!();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(run.done()).toBe(true);
    expect(run.frames).toHaveLength(0);
  });

  it('이상한 수는 한 프레임으로', async () => {
    for (const bad of [0, -3, Number.NaN, 0.4]) {
      const run = runScript(rendererFramesScript(bad));
      run.frames.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      expect(run.done()).toBe(true);
    }
  });
});
