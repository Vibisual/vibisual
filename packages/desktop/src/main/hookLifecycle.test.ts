/**
 * SCENARIO §3.6 「수명」 · §5.7 #24-3 — 끌 때 언제·몇 번 걷나(데스크톱 쪽 판정).
 *
 * 못 박는 것:
 *  1) OS 종료·로그오프 신호 — Windows 는 창의 `session-end`(그때 before-quit 가 오지 않는다), mac·linux 는
 *     `powerMonitor` `shutdown`. 개발기 한 대에서 세 OS 판정을 다 돈다.
 *  2) 이 프로세스가 깔았을 때만 · 한 번만 걷는다 — 잠금을 못 잡고 끝나는 두 번째 실행이 떠 있는 앱의 훅을
 *     걷지 않게, 정상 종료와 OS 종료가 겹쳐도 두 번 돌지 않게. 실패는 종료를 막지 않는다.
 *  3) 제거기 인자 — `installer.nsh` 가 부르는 글자와 같다.
 *  4) 코덱스 전역 훅 — 끌 때 이 앱의 핸들러 경로로 걷고, 켤 때 켬 값대로 다시 깐다(사용자 지시 2026-10-22).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOOK_CLEANUP_ARG, createHookRetirement, isHookCleanupRun, osEndSignals, type HookRetireReason } from './hookLifecycle';

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));

describe('OS 종료·로그오프 신호', () => {
  it('Windows 는 창의 session-end, mac·linux 는 powerMonitor shutdown', () => {
    expect(osEndSignals('win32')).toEqual({ windowSessionEnd: true, powerMonitorShutdown: false });
    expect(osEndSignals('darwin')).toEqual({ windowSessionEnd: false, powerMonitorShutdown: true });
    expect(osEndSignals('linux')).toEqual({ windowSessionEnd: false, powerMonitorShutdown: true });
  });
});

describe('끌 때 걷기의 문지기', () => {
  it('깔지 않은 실행은 걷지 않는다(두 번째 실행·설치를 건너뛴 실행)', () => {
    const calls: HookRetireReason[] = [];
    const gate = createHookRetirement((reason) => { calls.push(reason); });
    expect(gate.retire('quit')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('깔았으면 한 번만 걷는다 — 정상 종료와 OS 종료가 겹쳐도', () => {
    const calls: HookRetireReason[] = [];
    const gate = createHookRetirement((reason) => { calls.push(reason); });
    gate.markInstalled();
    expect(gate.retire('os-session-end')).toBe(true);
    expect(gate.retire('quit')).toBe(false);
    expect(gate.retire('os-shutdown')).toBe(false);
    expect(calls).toEqual(['os-session-end']);
  });

  it('걷다가 실패해도 던지지 않는다 — 종료 경로를 막으면 안 된다', () => {
    const errors: unknown[] = [];
    const gate = createHookRetirement(() => { throw new Error('disk full'); }, (e) => { errors.push(e); });
    gate.markInstalled();
    expect(() => gate.retire('quit')).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('본체 배선 — 깐 뒤에만 표시, 끌 때는 리스너보다 먼저, OS 종료 신호', () => {
  const index = readFileSync(join(MAIN_DIR, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('깐 뒤에만 깔았다고 적는다 — 설치를 건너뛰는 갈래는 그 앞에서 끝난다', () => {
    const install = index.indexOf('const all = ensureHooksInstalledEverywhere(hookPort, handlerPath, hookToken);');
    const remember = index.indexOf('installedHooks = { port: hookPort, handlerPath };');
    const mark = index.indexOf('hookRetirement.markInstalled();');
    expect(install).toBeGreaterThan(-1);
    expect(remember).toBeGreaterThan(install);
    expect(mark).toBeGreaterThan(remember);
    expect(index.indexOf("console.log('[main] hook installer skipped — VIBISUAL_HOME set (isolated instance)');")).toBeLessThan(install);
  });

  it('끌 때 코덱스 전역 훅까지 걷는다 — 걷기에 이 앱의 핸들러 경로를 넘긴다', () => {
    expect(index).toContain('retireVibisualHooks(installedHooks?.port ?? null, installedHooks?.handlerPath ?? null)');
  });

  it('정상 종료는 창·훅 리스너를 닫기 전에 걷는다 — 그사이 도착한 호출이 닫힌 문을 두드리지 않게', () => {
    const at = index.indexOf('function finishApprovedQuit(): void {');
    const body = index.slice(at, index.indexOf('\n}\n', at));
    const retire = body.indexOf("hookRetirement.retire('quit');");
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(body.indexOf('closeAllVerificationTargets()'));
    expect(retire).toBeLessThan(body.indexOf('hookListener!.close('));
  });

  it('OS 종료 — Windows 는 본체 창 session-end, mac·linux 는 powerMonitor shutdown', () => {
    expect(index).toContain("mainWindow.on('session-end', () => { hookRetirement.retire('os-session-end'); });");
    expect(index).toContain("powerMonitor.on('shutdown', () => { hookRetirement.retire('os-shutdown'); });");
  });

  it('상태 줄은 켬 값으로 맞춘다 — 끌 때 걷으므로 "깔려 있을 때만 갱신"으로는 켬이 이어지지 않는다', () => {
    expect(index).toContain('syncUsageCollectorAtBoot(hookPort, handlerPath, hookToken)');
    expect(index).not.toContain('refreshStatusLineIfInstalled(');
  });

  it('코덱스 전역 훅도 켬 값으로 다시 깐다 — 깐 갈래 안에서만(설치를 건너뛴 실행은 손대지 않는다)', () => {
    const sync = index.indexOf('syncCodexHooksAtBoot(hookPort, handlerPath, hookToken)');
    expect(sync).toBeGreaterThan(index.indexOf('hookRetirement.markInstalled();'));
  });
});

describe('제거기의 정리 모드', () => {
  it('인자가 있을 때만 정리 모드다', () => {
    expect(isHookCleanupRun(['Vibisual.exe', HOOK_CLEANUP_ARG])).toBe(true);
    expect(isHookCleanupRun(['Vibisual.exe'])).toBe(false);
    expect(isHookCleanupRun(['Vibisual.exe', '--updated'])).toBe(false);
  });

  it('제거기 스크립트가 같은 글자로 부른다', () => {
    const nsh = readFileSync(join(MAIN_DIR, '..', '..', 'build', 'installer.nsh'), 'utf8');
    expect(nsh).toContain(`" ${HOOK_CLEANUP_ARG}\``);
  });
});
