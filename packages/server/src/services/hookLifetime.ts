import type { CodexHookState, UsageCollectorStatus } from '@vibisual/shared';
import { logger } from '../logger.js';
import {
  appStateGetCodexHooks,
  appStateGetUsageCollector,
  appStateSetCodexHooks,
  appStateSetUsageCollector,
} from './appState.js';
import { codexHomeExists, getCodexHookState, installCodexHooks, uninstallCodexHooks } from './codexHookInstaller.js';
import {
  areClaudeHooksRetired,
  reensureHooksWhereChanged,
  retireClaudeHooks,
  type HookInstallOptions,
  type HookReensureResult,
  type HookRemovalAllResult,
} from './hookInstaller.js';
import { installStatusLine, readUsageCollectorStatus, uninstallStatusLine } from './statusLineInstaller.js';

/**
 * §3.6 「수명」 · §5.7 #24-3 — **훅은 앱이 켜져 있는 동안만 둔다**(꺼진 뒤 HTTP 훅은 실패마다 `hook error` — 실측 2026-10-21: 3주 668건). 걷기·지키기를 여기서 묶는다.
 * 클로드 훅(호스트·Cowork): 끌 때 걷고 켜진 동안 바뀐 홈만 다시 맞춘다. 상태 줄·코덱스 전역 훅(§5.25 (I)): 끌 때 걷고 켤 때 AppState 켬 값대로(코덱스는 신뢰를 다시 물을 수 있다).
 */

export interface HookRetireSummary {
  /** 걷은 클로드 훅 블록 수(모든 홈 합). */
  removed: number;
  /** 다시 쓴 설정 파일 수. */
  homesWritten: number;
  /** 사용량 수집기 상태 줄을 원래 것으로 되돌렸는가. */
  statusLineRestored: boolean;
  /** 코덱스 전역 훅을 걷었는가. */
  codexRemoved: boolean;
  /** 손대지 못한 자리(깨진 JSON·쓰기 실패) — 진단용. */
  errors: string[];
}

function summarize(all: HookRemovalAllResult): HookRetireSummary {
  const out: HookRetireSummary = { removed: 0, homesWritten: 0, statusLineRestored: false, codexRemoved: false, errors: [] };
  for (const r of [all.host, ...all.cowork]) {
    out.removed += r.removed;
    if (r.written) out.homesWritten += 1;
    if (r.error) out.errors.push(`${r.settingsPath}: ${r.error.message}`);
  }
  return out;
}

/** 우리 상태 줄이 깔려 있으면 원래 것으로 되돌린다. 켬 여부(AppState)는 건드리지 않는다 — 다음에 켤 때 다시 감싼다. */
function restoreStatusLine(out: HookRetireSummary): void {
  try {
    const before = readUsageCollectorStatus();
    if (before.error) {
      out.errors.push(`statusLine: ${before.error}`);
      return;
    }
    if (!before.installed) return;
    const after = uninstallStatusLine();
    if (after.error) out.errors.push(`statusLine: ${after.error}`);
    out.statusLineRestored = !after.installed;
  } catch (err) {
    out.errors.push(`statusLine: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 이 앱(`handlerPath`)의 코덱스 전역 훅만 걷는다(서명 — `isOurCodexHookCommand`). 켬 값은 안 건드린다(다음에 켤 때 다시 깐다). */
function removeCodexHooks(handlerPath: string | null, out: HookRetireSummary): void {
  if (!handlerPath) return;
  try {
    const before = getCodexHookState(handlerPath);
    if (before.error) {
      out.errors.push(`codex hooks: ${before.error}`);
      return;
    }
    if (!before.installed) return;
    const after = uninstallCodexHooks(handlerPath);
    if (after.error) out.errors.push(`codex hooks: ${after.error}`);
    out.codexRemoved = !after.installed;
  } catch (err) {
    out.errors.push(`codex hooks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** **앱을 끌 때**(정상·OS 종료·로그오프): 재설치를 막고 이 앱 포트의 블록·상태 줄·코덱스 훅을 걷는다(`handlerPath` 없으면 코덱스는 그대로). 동기다 — OS 종료 신호 안에서도 끝나야 한다. */
export function retireVibisualHooks(port: number | null, handlerPath: string | null): HookRetireSummary {
  const out = summarize(retireClaudeHooks(port));
  restoreStatusLine(out);
  removeCodexHooks(handlerPath, out);
  return out;
}

/**
 * **Windows 제거기**가 파일을 지우기 전에 부른다(`--vibisual-remove-hooks`). 끌 때와 같은 걷기다 — 앱을 끌 때 이미
 * 걷었다면 걷을 것이 없어 파일을 쓰지 않는다. 저장된 포트가 없으면(`port` null) 우리 클로드 블록 전부를 걷는다.
 */
export function removeVibisualHooksForUninstall(port: number | null, handlerPath: string): HookRetireSummary {
  return retireVibisualHooks(port, handlerPath);
}

/** **켤 때** — 상태 줄을 켬 값대로(§4 opt-in). 값이 없으면 settings.json 에 깔렸는지로 옮겨 적고, 켬이 아닌데 남았으면 걷는다. */
export function syncUsageCollectorAtBoot(port: number, handlerPath: string, token: string): UsageCollectorStatus {
  const status = readUsageCollectorStatus();
  if (status.error) return status;
  let enabled = appStateGetUsageCollector();
  if (enabled === undefined) {
    enabled = status.installed;
    appStateSetUsageCollector(enabled);
  }
  if (enabled) return installStatusLine(port, handlerPath, token);
  return status.installed ? uninstallStatusLine() : status;
}

/**
 * 사용량 팝업의 켜기·끄기. 상태 줄을 깔거나 걷고, **켬 값을 함께 적는다** — 끌 때 걷으므로 파일만으로는
 * 다음 부팅이 켜져 있었는지 알 수 없다. 켜기는 실제로 깔렸을 때만 켬으로 적는다. 앱을 끄는 중(걷은 뒤)에는 깔지 않는다.
 */
export function setUsageCollectorEnabled(
  enable: boolean,
  target: { port: number; handlerPath: string; token: string } | null,
): UsageCollectorStatus {
  if (!enable) {
    appStateSetUsageCollector(false);
    return uninstallStatusLine();
  }
  if (!target) return { ...readUsageCollectorStatus(), error: 'Hook listener is not ready yet — statusLine cannot be installed' };
  if (areClaudeHooksRetired()) return { ...readUsageCollectorStatus(), error: 'Vibisual is quitting — statusLine is not installed' };
  const status = installStatusLine(target.port, target.handlerPath, target.token);
  if (!status.error && status.installed) appStateSetUsageCollector(true);
  return status;
}

/**
 * **켤 때** — 코덱스 전역 훅을 켬 값대로(§5.25 (I), 기본 꺼짐). 값이 없으면 hooks.json 으로 옮겨 적고, 켬이면 이번 포트·토큰으로 다시 깐다.
 * **코덱스 홈이 없으면 깔지 않는다**(켬 값은 둔다). hooks.json 을 못 읽으면 아무것도 안 바꾼다.
 */
export function syncCodexHooksAtBoot(port: number, handlerPath: string, token: string): CodexHookState {
  const state = getCodexHookState(handlerPath);
  if (state.error) return state;
  let enabled = appStateGetCodexHooks();
  if (enabled === undefined) {
    enabled = state.installed;
    appStateSetCodexHooks(enabled);
  }
  if (enabled) {
    if (!codexHomeExists()) {
      logger.info('[codexHooks] codex home is missing — hooks not restored this launch (kept on; restored once Codex is back)');
      return state;
    }
    return installCodexHooks(handlerPath, port, token);
  }
  return state.installed ? uninstallCodexHooks(handlerPath) : state;
}

/** 옵션의 코덱스 훅 켜기·끄기(§5.25 (I)) — `setUsageCollectorEnabled` 와 같은 규칙(켬 값 함께 적기 · 실제로 깔렸을 때만 켬 · 끄는 중엔 안 깐다). */
export function setCodexHooksEnabled(
  enable: boolean,
  target: { port: number; handlerPath: string; token: string },
): CodexHookState {
  if (!enable) {
    appStateSetCodexHooks(false);
    return uninstallCodexHooks(target.handlerPath);
  }
  if (areClaudeHooksRetired()) return { ...getCodexHookState(target.handlerPath), error: 'Vibisual is quitting — Codex hooks are not installed' };
  const state = installCodexHooks(target.handlerPath, target.port, target.token);
  if (!state.error && state.installed) appStateSetCodexHooks(true);
  return state;
}

/** **켜진 동안 지킨다**(10초 스윕) — 바뀐 홈만 다시 맞추고, 호스트가 바뀌고 상태 줄이 켬이면 다시 감싼다(`/statusline` 이 덮은 것은 원본으로 보관). 코덱스는 여기서 안 지킨다(주인은 옵션). 걷은 뒤엔 아무것도 안 한다. */
export function keepVibisualHooksInPlace(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions = {},
): HookReensureResult {
  const result = reensureHooksWhereChanged(port, handlerPath, token, options);
  if (areClaudeHooksRetired() || !result.hostChecked) return result;
  if (appStateGetUsageCollector() === true) {
    const status = installStatusLine(port, handlerPath, token);
    if (status.error) logger.warn(`[hooks] usage collector keep-alive failed: ${status.error}`);
  }
  return result;
}
