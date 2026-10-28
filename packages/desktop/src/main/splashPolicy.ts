// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 판정만 든 순수 모듈. 시작 진입점이 스플래시를 먼저 띄우고 본체 창은 숨긴 채 준비가 끝나면 보인다
// (실측: 시작 뒤 약 10초간 아무것도 안 보이다 창이 뜬 뒤 첫 3초에 0.2~2.9초 멈췄다).
// electron 을 부르지 않는다(타입만) — 세 OS 가지와 공개 판정을 개발기에서 단위 시험한다. 창 만들기·메시지는 `splashWindow.ts`·`mainReveal.ts`.
// `@vibisual/shared` 도 타입만 가져온다 — 이 파일은 시작 진입점 청크에 실린다(`splashStrings.ts` 머리 주석).

import type { BrowserWindowConstructorOptions } from 'electron';
import type { AppThemeKind, BootProgress } from '@vibisual/shared';
import { consentLocale } from './consentStrings';
import { fillSplash, isSplashLocale, type SplashLocale, type SplashStrings } from './splashStrings';

/** 창 크기(DIP). 가운데 한 장 — 본체 창(1440×900)보다 한참 작아 본체가 뜨면 그 뒤에 가린다. */
export const SPLASH_WIDTH = 560;
export const SPLASH_HEIGHT = 336;

/** 스플래시가 첫 그림을 칠할 때까지 기다리는 상한(ms). 넘기면 빈 창을 보이지 않고 스플래시 없이 부팅한다. */
export const SPLASH_FIRST_PAINT_CAP_MS = 1_500;

/** 창을 보인 뒤 두 프레임을 기다리는 상한(ms). 본체의 동기 로드가 첫 창 표시를 가로막지 않게 한다. */
export const SPLASH_PRESENT_CAP_MS = 1_500;

/** 본체 창을 보인 뒤 스플래시를 걷기까지(ms) — 본체가 화면에 앉기 전에 걷으면 그 사이 빈 화면이 번쩍인다. */
export const SPLASH_HANDOFF_MS = 160;

/** 공개 판정 시계 간격(ms). 이 시계가 늦게 깬 만큼이 메인 스레드가 바빴던 시간이다(`mainStallLog` 와 같은 원리). */
export const MAIN_REVEAL_POLL_MS = 100;
/** 시계가 이만큼 늦으면 그 순간 메인 스레드가 바빴던 것으로 친다. */
export const MAIN_REVEAL_BUSY_LAG_MS = 50;
/** 본체 창을 보이기 전에 메인 스레드가 이만큼 조용해야 한다(ms). */
export const MAIN_REVEAL_QUIET_MS = 400;
/** 렌더러가 다 그렸다고 알린 뒤에도 조용해지지 않으면 이만큼 뒤에는 보인다(ms) — 조용함을 기다리다 갇히면 안 된다. */
export const MAIN_REVEAL_SETTLE_CAP_MS = 5_000;
/**
 * 본체 창을 만든 뒤 어떤 신호도 없으면 이만큼(ms) 뒤에는 보인다 — 렌더러가 말을 못 해도 창은 나와야 한다.
 * 정상 부팅은 창을 만든 뒤 2초 남짓 — 넉넉히 잡되 앱이 죽었다고 느낄 만큼 길지는 않게.
 */
export const MAIN_REVEAL_HARD_CAP_MS = 15_000;

/** userData 아래 표시 캐시 파일 — 지난 실행의 UI 언어와 창 바탕(테마). 권위가 아니라 다음 스플래시의 첫 칠용이다. */
export const SPLASH_CACHE_FILE = 'splash.json';
const SPLASH_CACHE_SCHEMA = 1;

// ─── 단계 · 진행 ────────────────────────────────────────────────────────────

export type SplashStage =
  | 'starting'
  | 'loading'
  | 'services'
  | 'projects'
  | 'sessions'
  | 'connecting'
  | 'workspace'
  | 'finishing';

/**
 * 단계마다 [들어설 때의 진행, 머무는 동안 다가갈 천장]. 천장은 다음 단계의 시작을 넘지 않는다 — 막대가
 * 뒤로 가는 일이 없게(스플래시는 천장의 85% 까지만 천천히 다가간다).
 */
export const SPLASH_STAGE_BANDS: Record<SplashStage, readonly [number, number]> = {
  starting: [0.03, 0.1],
  loading: [0.1, 0.2],
  services: [0.2, 0.26],
  projects: [0.26, 0.6],
  sessions: [0.6, 0.68],
  connecting: [0.68, 0.74],
  workspace: [0.74, 0.9],
  finishing: [0.9, 0.98],
};

/** 스플래시에 실어 보내는 한 장면. 문구는 main 이 고른다(스플래시 쪽은 그리기만 한다). */
export interface SplashView {
  text: string;
  detail: string;
  /** 지금 진행(0~1). 막대는 이 값 아래로 내려가지 않는다. */
  progress: number;
  /** 다음 소식이 오기 전까지 천천히 다가갈 천장(0~1). */
  ceiling: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** 단계 하나의 장면. */
export function splashStageView(stage: SplashStage, strings: SplashStrings): SplashView {
  const [lo, hi] = SPLASH_STAGE_BANDS[stage];
  if (stage === 'projects') return splashProjectsView(0, 0, undefined, strings);
  return { text: strings[stage], detail: '', progress: lo, ceiling: hi };
}

/**
 * 프로젝트 복원 장면 — `done` 개를 끝냈고 지금 `label` 을 읽는다. 진행은 프로젝트 구간을 개수로 나눈 칸이고,
 * 천장은 그 칸의 끝이라 한 프로젝트가 오래 걸려도 막대가 다음 칸을 넘지 않는다.
 * 열어 둔 프로젝트가 없으면(첫 실행) 나머지 기동 장면으로 넘긴다 — "(0/0)" 을 보이지 않는다.
 */
export function splashProjectsView(
  done: number,
  total: number,
  label: string | undefined,
  strings: SplashStrings,
): SplashView {
  const [lo, hi] = SPLASH_STAGE_BANDS.projects;
  if (!Number.isFinite(total) || total <= 0) return splashStageView('sessions', strings);
  const d = Math.min(total, Math.max(0, Math.floor(done)));
  const finished = d >= total;
  const slice = (hi - lo) / total;
  return {
    text: fillSplash(strings.projects, { done: finished ? total : d + 1, total }),
    detail: finished ? '' : (label ?? '').slice(0, 80),
    progress: clamp01(lo + slice * d),
    ceiling: clamp01(finished ? hi : lo + slice * (d + 1)),
  };
}

/** 서버 코어가 넘긴 부팅 진척 → 장면. */
export function splashBootView(progress: BootProgress, strings: SplashStrings): SplashView {
  if (progress.phase === 'projects') {
    return splashProjectsView(progress.done, progress.total, progress.label, strings);
  }
  return splashStageView('sessions', strings);
}

/** 다 됐다 — 막대를 끝까지. 문구는 마지막 단계 그대로 둔다. */
export function splashDoneView(strings: SplashStrings): SplashView {
  return { text: strings.finishing, detail: '', progress: 1, ceiling: 1 };
}

// ─── 언어 · 색 ──────────────────────────────────────────────────────────────

/** 지난 실행이 남긴 UI 언어가 있으면 그것, 없으면 OS 언어(동의 창과 같은 판정 — `consentLocale`). */
export function resolveSplashLocale(cached: string | null | undefined, osLocale: string): SplashLocale {
  if (isSplashLocale(cached)) return cached;
  const fromOs = consentLocale(osLocale);
  return isSplashLocale(fromOs) ? fromOs : 'en';
}

/** 스플래시를 칠할 색. 바탕은 테마의 창 바탕(본체 창과 같은 값), 글자는 테마의 밝기 계열에서. */
export interface SplashPalette {
  kind: AppThemeKind;
  background: string;
  foreground: string;
  muted: string;
  faint: string;
  track: string;
  border: string;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** 기본 테마(Vibisual Dark)의 창 바탕 — `themeChromePolicy.FALLBACK_APP_THEME_CHROME.background` 와 같은 값. */
export const SPLASH_FALLBACK_BACKGROUND = '#030712';

export function splashPalette(background: string | null | undefined, kind: AppThemeKind | null | undefined): SplashPalette {
  const k: AppThemeKind = kind === 'light' ? 'light' : 'dark';
  // 바탕은 HTML 의 CSS 로 들어간다 — `#rrggbb` 밖의 값은 버린다(캐시 파일은 사용자가 고칠 수 있는 디스크다).
  const bg = typeof background === 'string' && HEX6.test(background)
    ? background
    : (k === 'light' ? '#f8fafc' : SPLASH_FALLBACK_BACKGROUND);
  return k === 'light'
    ? { kind: k, background: bg, foreground: '#0f172a', muted: '#475569', faint: '#64748b', track: 'rgba(15, 23, 42, 0.10)', border: 'rgba(15, 23, 42, 0.12)' }
    : { kind: k, background: bg, foreground: '#f1f5f9', muted: '#94a3b8', faint: '#64748b', track: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.16)' };
}

// ─── 표시 캐시 ──────────────────────────────────────────────────────────────

/**
 * 다음 실행의 스플래시가 첫 칠에 쓸 값 — 권위는 따로다(언어 `uiLocale` 체크포인트, 바탕 `appearance.themeId`).
 * 스플래시가 그 둘보다 먼저 떠서 지난 값을 들고 있을 뿐인 파생물이다.
 */
export interface SplashCache {
  locale: SplashLocale;
  background: string;
  kind: AppThemeKind;
}

/** 깨졌거나 모르는 모양이면 `null` — 스플래시는 OS 언어·기본 바탕으로 뜬다(오류 ❌). */
export function parseSplashCache(text: string | null | undefined): SplashCache | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r['schema'] !== SPLASH_CACHE_SCHEMA) return null;
  if (!isSplashLocale(r['locale'])) return null;
  if (typeof r['background'] !== 'string' || !HEX6.test(r['background'])) return null;
  if (r['kind'] !== 'dark' && r['kind'] !== 'light') return null;
  return { locale: r['locale'], background: r['background'], kind: r['kind'] };
}

export function serializeSplashCache(cache: SplashCache): string {
  return `${JSON.stringify({ schema: SPLASH_CACHE_SCHEMA, locale: cache.locale, background: cache.background, kind: cache.kind }, null, 2)}\n`;
}

/** 지금 값으로 캐시 한 벌을 만든다. 언어가 지원 밖이면 `en`, 바탕이 형식 밖이면 기본 바탕. */
export function makeSplashCache(locale: string | null | undefined, background: string, kind: AppThemeKind): SplashCache {
  return {
    locale: isSplashLocale(locale) ? locale : 'en',
    background: HEX6.test(background) ? background : SPLASH_FALLBACK_BACKGROUND,
    kind: kind === 'light' ? 'light' : 'dark',
  };
}

// ─── 창 ─────────────────────────────────────────────────────────────────────

export interface SplashRect { x: number; y: number; width: number; height: number }

/** 작업 영역 한가운데. 작업 영역이 창보다 작으면(아주 작은 화면) 왼쪽 위에 붙인다. */
export function centeredSplashBounds(workArea: SplashRect, width = SPLASH_WIDTH, height = SPLASH_HEIGHT): SplashRect {
  const x = workArea.x + Math.max(0, Math.round((workArea.width - width) / 2));
  const y = workArea.y + Math.max(0, Math.round((workArea.height - height) / 2));
  return { x, y, width, height };
}

/** 창 아이콘 — 본체 창과 같다(Windows 는 .ico 라야 작업 표시줄에서 흐리지 않다, 나머지는 PNG). */
export function splashIconFile(platform: NodeJS.Platform): 'icon.ico' | 'icon.png' {
  return platform === 'win32' ? 'icon.ico' : 'icon.png';
}

/**
 * 스플래시 창 옵션 — 플랫폼을 인자로 받는다(세 OS 가지를 시험으로 고정).
 * - 셋 다: 테두리 없음 · 크기 고정 · 끌 수 없음 · 작업 표시줄/Dock 에는 보인다(켜지는 중이라는 유일한 흔적).
 * - Linux: 창 종류 `splash`(X11 창 관리자가 가운데에 장식 없이 둔다, Linux 전용 값). Wayland 는 컴포지터가 자리를 정한다.
 * - 자리: 작업 영역을 알면 직접 가운데(일부 X11 은 `center` 를 무시), 모르면 `center`.
 * - 렌더러: 샌드박스 + 자기 세션(`vibisual-splash` — 앱 저장소·권한과 분리) + 진척 포트만 받는 preload.
 */
export function splashWindowOptions(input: {
  platform: NodeJS.Platform;
  background: string;
  iconPath: string;
  preloadPath: string;
  workArea?: SplashRect | null;
}): BrowserWindowConstructorOptions {
  const bounds = input.workArea ? centeredSplashBounds(input.workArea) : null;
  return {
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    ...(bounds ? { x: bounds.x, y: bounds.y } : { center: true }),
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: 'Vibisual',
    backgroundColor: HEX6.test(input.background) ? input.background : SPLASH_FALLBACK_BACKGROUND,
    icon: input.iconPath,
    ...(input.platform === 'linux' ? { type: 'splash' } : {}),
    webPreferences: {
      preload: input.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      spellcheck: false,
      partition: 'vibisual-splash',
      // 본체가 메인 스레드를 붙잡는 동안에도 막대·궤도가 돌아야 한다(가려졌다고 멈추면 멎은 앱처럼 보인다).
      backgroundThrottling: false,
    },
  };
}

// ─── 첫 표시 가림(Windows) ───────────────────────────────────────────────────

/**
 * 처음 보일 때의 흰 프레임을 가리는 OS. Windows 에서 숨겨 만든 창을 처음 보이면 첫 프레임들이 흰색이다 — `backgroundColor`·첫 칠 대기로도
 * 안 된다(Electron 28 부터 · electron#45774). 측정(2026-10-16, Electron 31.7.7 · PrintWindow + DWM): 실제 스플래시는 표시 뒤 40~60ms(75Hz 3~4프레임).
 * 그래서 첫 표시만 DWM 가림 뒤에서 보이고 몇 프레임 뒤 걷는다(`windowCloak.ts`). macOS·Linux 는 보고도 수단(DWM)도 없다.
 */
export function coversFirstShow(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

/**
 * 가린 채 보인 뒤 걷기 전에 렌더러가 지나야 하는 프레임 수 — 렌더러 프레임을 세므로 느리면 그만큼 늦게 걷는다.
 * 실측: 6프레임이면 흰 구간 뒤 1~3프레임 여유였다(최소 시간 없이도 흰색이 나온 적 없음) — 두 프레임 더 둔다.
 */
export const FIRST_SHOW_COVER_FRAMES = 8;
/** 그리고 최소 이만큼(ms) — 주사율이 아주 높아 프레임이 빨리 지나가도 합성이 따라올 시간을 둔다. */
export const FIRST_SHOW_COVER_MIN_MS = 80;
/** 프레임 소식이 끝내 안 와도(렌더러가 바쁘거나 죽었을 때) 이만큼 뒤에는 걷는다(ms) — 흰 프레임보다 안 나오는 창이 나쁘다. */
export const FIRST_SHOW_COVER_CAP_MS = 1_000;

/**
 * 렌더러가 애니메이션 프레임을 `frames` 번 지나면 풀리는 식 — `executeJavaScript` 로 보낸다(페이지의 CSP 와 무관하다).
 * 고정 지연이 아니라 실제 프레임을 센다 — 렌더러가 바쁘면 그만큼 늦게 풀린다.
 */
export function rendererFramesScript(frames: number): string {
  const n = Number.isFinite(frames) ? Math.max(1, Math.floor(frames)) : 1;
  return `new Promise(resolve => { let n = 0; const step = () => (++n >= ${n} ? resolve(true) : requestAnimationFrame(step)); requestAnimationFrame(step); })`;
}

// ─── 본체 창 공개 판정 ───────────────────────────────────────────────────────

export interface MainRevealInputs {
  /** 지금(epoch ms). */
  now: number;
  /** 본체 창을 만든 때(epoch ms). */
  createdAt: number;
  /** 렌더러가 "첫 화면을 다 그렸다"고 알린 때 — 아직이면 `null`. */
  rendererReadyAt: number | null;
  /** 부팅 한 번짜리 확인 중 아직 시작하지 않은 수(`pendingStartupJobCount`). */
  pendingJobs: number;
  /** 메인 스레드가 마지막으로 바빴던 뒤로 지난 시간(ms). */
  quietMs: number;
  /** 렌더러가 죽었거나 못 읽었다 — 기다릴 이유가 없다(그 창의 복구 안내가 보여야 한다). */
  forced: boolean;
}

export type MainRevealReason = 'ready' | 'forced' | 'settle-cap' | 'hard-cap';
export type MainRevealDecision = { reveal: false } | { reveal: true; reason: MainRevealReason };

/**
 * 본체 창을 지금 보일까 — 순서가 규칙이다. ① 강제(렌더러 사망·로드 실패·무응답) → 곧바로 ② 만든 지 `MAIN_REVEAL_HARD_CAP_MS` → 보인다
 * ③ 렌더러가 아직 말이 없으면 기다린다 ④ 말한 지 `MAIN_REVEAL_SETTLE_CAP_MS` → 조용하지 않아도 보인다
 * ⑤ 부팅 확인이 남았거나 `MAIN_REVEAL_QUIET_MS` 동안 조용하지 않았으면 기다린다 ⑥ 그 밖엔 보인다.
 */
export function decideMainReveal(i: MainRevealInputs): MainRevealDecision {
  if (i.forced) return { reveal: true, reason: 'forced' };
  if (i.now - i.createdAt >= MAIN_REVEAL_HARD_CAP_MS) return { reveal: true, reason: 'hard-cap' };
  if (i.rendererReadyAt === null) return { reveal: false };
  if (i.now - i.rendererReadyAt >= MAIN_REVEAL_SETTLE_CAP_MS) return { reveal: true, reason: 'settle-cap' };
  if (i.pendingJobs > 0) return { reveal: false };
  if (i.quietMs < MAIN_REVEAL_QUIET_MS) return { reveal: false };
  return { reveal: true, reason: 'ready' };
}
