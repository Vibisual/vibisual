/**
 * claudePluginRefresh.ts — §5.5 #17-33 ⑦: **손으로 하던 갱신을 앱이 대신 한다.**
 *
 * 왜 있는가. #17-33 은 플러그인을 보고·켜고·설치하는 자리를 만들었지만 **갱신하는 자리는 없었다**.
 * 마켓 클론은 누군가 `claude plugin marketplace update` 를 부르기 전까지 영영 그대로이고,
 * 실측(2026-09-09) 공식 마켓 매니페스트는 2026-08-04 에 멈춰 **36일** 낡아 있었다 — 그동안
 * Anthropic 이 낸 스킬은 앱 어디에도 나타나지 않았고, 사용자는 그 사실조차 알 수 없었다.
 * 부를 자리가 없던 것이 원인이므로, 그 자리를 여기 하나 만든다.
 *
 * 지키는 것 넷:
 *  ① **바꾸는 일은 여전히 전부 CLI 위임**(#17-33 ④). 우리는 `claudePluginService` 의 스폰만 부른다.
 *  ② **겹치지 않는다** — git 을 타는 작업이라 두 벌이 동시에 돌면 서로의 클론을 물어 뜯는다.
 *  ③ **한 번에 다 하려 들지 않는다** — 뒤처진 것이 수십 개면 나눠서 다음 주기에 이어 간다.
 *  ④ **못 했으면 시각을 안 찍는다** — 실패에 시각을 찍으면 다음 주기까지 조용히 넘어가 버린다.
 *
 * 상태는 `AppState`(머신 단위)에 산다 — 마켓 클론은 어느 프로젝트를 열든 하나뿐이라
 * 프로젝트 체크포인트에 둘 이유가 없다. broadcast·checkpoint 미관여(#17-33 ⑥ 그대로).
 */
import type { ClaudePluginRefreshResult } from '@vibisual/shared';
import {
  CLAUDE_PLUGIN_REFRESH_MAX_PER_RUN,
  CLAUDE_PLUGIN_REFRESH_STARTUP_DELAY_MS,
  CLAUDE_PLUGIN_REFRESH_TICK_MS,
  isPluginRefreshDue,
  pluginsNeedingUpdate,
} from '@vibisual/shared';

import { logger } from '../logger.js';

import { appStateGetClaudePluginRefresh, appStateSetClaudePluginRefresh } from './appState.js';
import { scanClaudePlugins, updateClaudeMarketplaces, updateClaudePlugin } from './claudePluginService.js';

/**
 * ② 겹치지 않는다. 자동 주기와 사용자가 누른 [지금 갱신] 이 같은 순간에 걸릴 수 있고, 둘 다
 * `git` 을 타므로 동시에 돌면 같은 클론을 서로 물어 뜯는다. 도는 중이면 **그 약속을 그대로 준다**
 * — 두 번째 호출자도 첫 번째의 결과를 받으므로 화면이 영영 "갱신 중" 으로 남지 않는다.
 */
let inflight: Promise<ClaudePluginRefreshResult> | null = null;

/** 자동 주기 타이머 — 중복 기동을 막고 종료 시 정리할 수 있게 들고 있는다. */
let tickTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

/** 갱신이 끝날 때 부를 곳들(스킬 목록 메모 무효화 등) — 이 모듈이 그 자리를 몰라도 되게. */
const afterRefresh = new Set<() => void>();

/**
 * 갱신 뒤에 부를 함수를 건다. `/api/available-skills` 의 플러그인 상태 메모가 이걸 쓴다 —
 * 갱신했는데 목록이 옛 상태로 남으면 "새 스킬이 왜 안 보이지" 가 된다.
 */
export function onClaudePluginRefreshed(fn: () => void): void {
  afterRefresh.add(fn);
}

function notifyRefreshed(): void {
  for (const fn of afterRefresh) {
    try { fn(); } catch { /* 알림 실패가 갱신을 되돌리지는 않는다 */ }
  }
}

export interface RefreshOptions {
  /** 주기를 무시하고 지금 한다 — 사용자가 [지금 갱신] 을 누른 경우. */
  force?: boolean;
  /** 이번에 마켓을 갱신할지. 생략하면 사용자 설정을 따른다. */
  market?: boolean;
  /** 이번에 설치본을 올릴지. 생략하면 사용자 설정을 따른다. */
  plugins?: boolean;
}

/**
 * 한 번 훑는다 — 마켓을 끌어오고, 뒤처진 설치본을 최신 판으로 올린다.
 *
 * 순서가 중요하다: **마켓을 먼저** 갱신해야 "무엇이 최신인지" 를 아는 상태에서 설치본을 견줄 수 있다.
 * 옛 마켓으로 견주면 이미 나온 새 판을 못 보고 넘어간다.
 */
export function runClaudePluginRefresh(
  projectPath: string,
  opts: RefreshOptions = {},
): Promise<ClaudePluginRefreshResult> {
  if (inflight) return inflight;
  const p = doRefresh(projectPath, opts).finally(() => { inflight = null; });
  inflight = p;
  return p;
}

/** 지금 갱신이 도는 중인가 — 화면이 단추를 잠글 때 쓴다. */
export function isClaudePluginRefreshRunning(): boolean {
  return inflight !== null;
}

async function doRefresh(projectPath: string, opts: RefreshOptions): Promise<ClaudePluginRefreshResult> {
  const state = appStateGetClaudePluginRefresh();
  const settings = state.settings;
  const now = Date.now();

  const wantMarket = opts.market ?? settings.market;
  const wantPlugins = opts.plugins ?? settings.plugins;
  const marketDue = opts.force === true || isPluginRefreshDue(now, state.lastMarketAt, settings);
  const pluginsDue = opts.force === true || isPluginRefreshDue(now, state.lastPluginAt, settings);

  const result: ClaudePluginRefreshResult = {
    market: { attempted: false, ok: false },
    plugins: { attempted: false, updated: [], failed: [] },
    at: now,
  };

  // ── ① 마켓 클론을 원본에서 다시 끌어온다(이름 없이 = 전부).
  if (wantMarket && marketDue) {
    result.market.attempted = true;
    const res = await updateClaudeMarketplaces(projectPath);
    result.market.ok = res.ok;
    if (res.ok) {
      // ④ 성공했을 때만 시각을 찍는다 — 실패에 찍으면 다음 주기까지 조용히 넘어간다.
      appStateSetClaudePluginRefresh({ lastMarketAt: Date.now(), lastError: null });
      logger.info('[plugin-refresh] marketplaces updated');
    } else {
      result.market.reason = res.reason;
      appStateSetClaudePluginRefresh({ lastError: res.reason });
      logger.warn(`[plugin-refresh] marketplace update failed: ${res.reason}`);
    }
  }

  // ── ② 뒤처진 설치본을 최신 판으로.
  if (wantPlugins && pluginsDue) {
    result.plugins.attempted = true;
    const inv = await scanClaudePlugins(projectPath);
    if (inv.unavailable) {
      // 목록을 못 물었으면 올릴 것을 고를 수도 없다. 시각을 안 찍어 다음 주기에 다시 온다.
      appStateSetClaudePluginRefresh({ lastError: inv.unavailable });
      logger.warn(`[plugin-refresh] skipped plugin updates: ${inv.unavailable}`);
      result.at = Date.now();
      notifyRefreshed();
      return result;
    }

    // ③ 한 번에 다 하려 들지 않는다 — 남은 것은 다음 주기에 이어 간다.
    const outdated = pluginsNeedingUpdate(inv.installed, inv.market);
    const batch = outdated.slice(0, CLAUDE_PLUGIN_REFRESH_MAX_PER_RUN);
    if (outdated.length > batch.length) {
      logger.info(`[plugin-refresh] ${outdated.length} outdated, updating ${batch.length} this round`);
    }

    for (const entry of batch) {
      // 순차로 돈다 — git clone 을 병렬로 여럿 태우면 사용자 회선이 먼저 막힌다.
      // eslint-disable-next-line no-await-in-loop
      const res = await updateClaudePlugin(projectPath, entry.id, entry.scope);
      if (res.ok) {
        result.plugins.updated.push(entry.id);
        logger.info(`[plugin-refresh] updated ${entry.id} → ${entry.latestVersion ?? '?'}`);
      } else {
        result.plugins.failed.push({ id: entry.id, reason: res.reason });
        logger.warn(`[plugin-refresh] update ${entry.id} failed: ${res.reason}`);
      }
    }

    // 훑기 자체는 끝났으므로 시각을 찍는다 — 올릴 것이 없었어도 "봤다" 는 사실이 주기의 기준이다.
    // 다만 **한 개라도 남았으면 찍지 않는다**: 남은 것을 다음 주기가 아니라 다음 tick 에 이어 가야
    // `MAX_PER_RUN` 으로 나눈 것이 하루씩 밀리지 않는다.
    const finished = outdated.length === batch.length;
    appStateSetClaudePluginRefresh({
      ...(finished ? { lastPluginAt: Date.now() } : {}),
      lastUpdatedIds: result.plugins.updated,
      ...(result.plugins.failed.length === 0 ? { lastError: null } : { lastError: result.plugins.failed[0]?.reason }),
    });
  }

  result.at = Date.now();
  notifyRefreshed();
  return result;
}

/**
 * 자동 갱신을 켠다 — 기동 후 한 번, 그 뒤로는 정해진 간격마다 "지금 할 때가 됐나" 만 본다.
 *
 * `resolveProjectPath` 를 인자로 받는 이유: CLI 는 `cwd` 로 범위를 해석하므로 **어느 프로젝트에서
 * 띄우는지**가 필요한데, 그것을 아는 것은 그래프 쪽이고 이 모듈은 그 사정을 몰라도 된다.
 * 열린 프로젝트가 하나도 없으면(`null`) 이번 차례는 조용히 건너뛴다 — 마켓 갱신은 급한 일이 아니다.
 */
export function startClaudePluginAutoRefresh(resolveProjectPath: () => string | null): void {
  if (tickTimer || startupTimer) return; // 중복 기동 방지(테스트·핫리로드)

  const tick = (): void => {
    const state = appStateGetClaudePluginRefresh();
    const settings = state.settings;
    if (!settings.market && !settings.plugins) return; // 둘 다 껐으면 아무것도 안 한다.

    const now = Date.now();
    const due = (settings.market && isPluginRefreshDue(now, state.lastMarketAt, settings))
      || (settings.plugins && isPluginRefreshDue(now, state.lastPluginAt, settings));
    if (!due) return;

    const projectPath = resolveProjectPath();
    if (!projectPath) return;

    void runClaudePluginRefresh(projectPath).catch((err: unknown) => {
      logger.warn(`[plugin-refresh] tick failed: ${String(err)}`);
    });
  };

  // 부팅 직후는 프로젝트 복원으로 가장 바쁜 구간이라, git 을 타는 스폰을 그 위에 얹지 않는다.
  startupTimer = setTimeout(() => {
    startupTimer = null;
    tick();
  }, CLAUDE_PLUGIN_REFRESH_STARTUP_DELAY_MS);
  startupTimer.unref?.();

  tickTimer = setInterval(tick, CLAUDE_PLUGIN_REFRESH_TICK_MS);
  tickTimer.unref?.();
}

/** 타이머 정리 (테스트·종료용). */
export function stopClaudePluginAutoRefresh(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
}
