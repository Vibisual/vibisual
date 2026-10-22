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
 * SCENARIO §3.6 「수명」 · §5.7 #24-3 — **훅은 앱이 켜져 있는 동안만 둔다.**
 *
 * 앱이 꺼지면 우리 훅은 할 일이 없다(받을 서버가 없다). 그런데 부팅 때 깔기만 하고 걷지 않아, 앱을 끄거나 지운
 * 뒤에도 이 PC 의 모든 Claude Code 세션에 우리 훅이 남았고, HTTP 훅은 실패할 때마다 `hook error` 알림을 남겼다
 * (실측 2026-10-21 — 3주 668건). 깔기(§3.6 트리거)는 그대로 두고, 이 모듈이 **걷기·지키기**를 한 곳에서 묶는다.
 *
 * 세 가지를 묶는다:
 *   - **클로드 훅**(호스트 + Cowork 홈) — 끌 때 걷고, 켜져 있는 동안 바뀐 홈만 다시 맞춘다.
 *   - **사용량 수집기 상태 줄** — 끌 때 원래 상태 줄로 되돌리고 켤 때 다시 감싼다. 켬 여부는 AppState 가 기억한다.
 *   - **코덱스 전역 훅**(§5.25 (I)) — 끌 때 걷고 켤 때 켬 값대로 다시 깐다. 켬 여부는 AppState 가 기억한다.
 *     코덱스는 훅 정의의 해시에 신뢰를 기록해 다시 깔면 신뢰를 다시 물을 수 있다 — 사용자가 받아들였다(2026-10-22).
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

/**
 * 이 앱(`handlerPath`)의 코덱스 전역 훅이 깔려 있으면 걷는다. 남의 훅·다른 설치본의 항목은 남긴다(서명 판정 —
 * `codexHookInstaller.isOurCodexHookCommand`). 켬 여부(AppState)는 건드리지 않는다 — 다음에 켤 때 다시 깐다.
 */
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

/**
 * **앱을 끌 때**(정상 종료 · OS 종료·로그오프) 부른다. 같은 프로세스가 다시 깔지 못하게 막은 뒤 모든 홈에서
 * **이 앱의 포트**를 가리키는 우리 블록을 걷고, 사용량 수집기 상태 줄을 원래 것으로 되돌리고, 이 앱의 코덱스 전역
 * 훅을 걷는다(`handlerPath` 를 모르면 코덱스는 건드리지 않는다). 동기다 — OS 종료 신호 안에서도 끝까지 돌아야 한다.
 */
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

/**
 * **켤 때** — 사용량 수집기를 켬 값대로 맞춘다(§4 v3.60 opt-in 원칙은 그대로 — 켠 사람만 감싼다).
 *
 * 켬 값이 없으면(이 판이 처음 켜졌다) 지금 settings.json 에 깔려 있는지로 옮겨 적는다 — 종전 판은 파일에 깔려
 * 있는 것이 곧 켬이었으므로 종전 사용자의 켬이 그대로 이어진다. 켬이 아닌데 우리 상태 줄이 남아 있으면 걷는다.
 */
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
 * **켤 때** — 코덱스 전역 훅을 켬 값대로 맞춘다(§5.25 (I) — 기본 꺼짐 · 켠 사람만 깐다).
 *
 * 켬 값이 없으면(이 판이 처음 켜졌다) 지금 hooks.json 에 깔려 있는지로 옮겨 적는다 — 종전 판은 끌 때 걷지 않아
 * 깔려 있는 것이 곧 켬이었다. 켬이면 이번 실행의 포트·토큰으로 다시 깐다. **코덱스 홈이 없으면 깔지 않는다** — 지운
 * 코덱스의 홈을 우리가 되살리지 않는다(켬 값은 그대로 두어 코덱스가 돌아오면 다음 부팅이 깐다). 켬이 아닌데 우리
 * 훅이 남아 있으면 걷는다. hooks.json 을 못 읽으면 아무것도 바꾸지 않는다(켬 값도 옮겨 적지 않는다).
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

/**
 * 옵션의 코덱스 훅 켜기·끄기(§5.25 (I)). 훅을 깔거나 걷고 **켬 값을 함께 적는다** — 끌 때 걷으므로 파일만으로는
 * 다음 부팅이 켜져 있었는지 알 수 없다. 켜기는 실제로 깔렸을 때만 켬으로 적는다. 앱을 끄는 중(걷은 뒤)에는 깔지 않는다.
 */
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

/**
 * **켜져 있는 동안 지킨다** — 세션 스캔 스윕(10초)이 부른다. 우리가 맞춘 뒤 설정 파일이 바뀐 홈만 다시 맞춘다
 * (그대로면 stat 한 번). 호스트가 바뀌었고 사용량 수집기가 켬이면 상태 줄도 다시 감싼다 — Claude Code 의
 * `/statusline` 같은 것이 우리 상태 줄을 덮어써도 사용자가 고른 켬이 이어진다(덮은 상태 줄은 원본으로 보관된다).
 * 코덱스 전역 훅은 여기서 지키지 않는다 — 켬의 주인은 옵션이고, 코덱스 쪽에서 지운 것은 다음에 켤 때 다시 깔린다.
 * 걷은 뒤(종료 중)에는 아무것도 하지 않는다.
 */
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
