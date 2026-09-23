import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildCliInvocation } from './claudeCliRun.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { codexEdgeHookCommand, codexEdgeOverrides, type CodexEdgeConfig, type CodexExpectedHook } from './codexEdges.js';

interface HookMetadata {
  command?: string;
  eventName: string;
  key: string;
  currentHash: string;
  enabled: boolean;
  trustStatus: string;
}

const HOOK_INSPECTION_TIMEOUT_MS = 15_000;
const HOOK_SHUTDOWN_TIMEOUT_MS = 3000;

/** Read the CLI's own hook hash. Never hash an approximation or trust other hooks. */
function listHooks(bin: string, cwd: string, overrides: string[], signal: AbortSignal): Promise<HookMetadata[]> {
  return new Promise((resolve, reject) => {
    // 첫 검사와 재검증 사이에 중지했으면 다음 검사 자식 자체를 띄우지 않는다.
    if (signal.aborted) { reject(new Error('Codex hook preparation cancelled')); return; }
    const invocation = buildCliInvocation(bin, ['app-server', ...overrides], process.platform);
    const child = spawn(invocation.file, invocation.args, { shell: invocation.shell, windowsHide: true,
      cwd, env: augmentedEnv(process.env), stdio: 'pipe', ...processGroupSpawnOptions() });
    let finished = false;
    let settled = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = createInterface({ input: child.stdout });
    const finish = (error?: Error, hooks: HookMetadata[] = [], closed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(shutdownTimer);
        reader.close();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (error) reject(error); else resolve(hooks);
      };
      // 응답/취소 판정은 이미 끝났다. 손자가 파이프를 쥐어 close가 안 와도 exit면 충분하다.
      if (closed || child.exitCode !== null || child.signalCode !== null) { settle(); return; }
      child.once('close', settle);
      child.once('exit', settle);
      // 종료 신호 자체가 오지 않아도 준비 표식이 영원히 남지 않게 같은 결과로 한 번만 마감한다.
      shutdownTimer = setTimeout(() => { killTree(child.pid); settle(); }, HOOK_SHUTDOWN_TIMEOUT_MS);
      shutdownTimer.unref?.();
      try { child.stdin.end(); } catch { /* 종료 시한이 남은 정리를 맡는다. */ }
      killTree(child.pid);
    };
    const abort = () => finish(new Error('Codex hook preparation cancelled'));
    const timer = setTimeout(() => finish(new Error('Codex hook inspection timed out')), HOOK_INSPECTION_TIMEOUT_MS);
    const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    child.on('error', (error) => finish(error));
    child.on('close', () => finish(new Error('Codex hook inspection exited before verification'), [], true));
    child.stdin.on('error', (error) => finish(error));
    child.stdout.on('error', (error) => finish(error));
    child.stderr.on('error', (error) => finish(error));
    child.stderr.on('data', () => { /* Do not expose user config or authentication diagnostics. */ });
    reader.on('line', (line) => {
      if (finished) return;
      try {
        const message = JSON.parse(line);
        if (message.id === 1) {
          if (message.error) { finish(new Error('Codex hook inspection initialization failed')); return; }
          send(2, 'hooks/list', { cwds: [cwd] });
        } else if (message.id === 2) {
          if (message.error || !Array.isArray(message.result?.data)) { finish(new Error('Codex CLI does not support hook inspection')); return; }
          finish(undefined, message.result.data.flatMap((entry: { hooks?: HookMetadata[] }) => entry.hooks ?? []));
        }
      } catch { /* Startup non-JSON lines are not protocol responses. */ }
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    send(1, 'initialize', { clientInfo: { name: 'vibisual_hook_check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  });
}

/** Trust only the app-owned hook, for this invocation. No config files are changed,
 * and no blanket hook-trust bypass is used. Refuse the turn if verification fails. */
export async function prepareCodexEdgeHook(bin: string, cwd: string, config: CodexEdgeConfig, signal: AbortSignal): Promise<string[]> {
  const overrides = codexEdgeOverrides(config);
  const expected = codexEdgeHookCommand(config);
  const find = (hooks: HookMetadata[]) => hooks.find((hook) => hook.command === expected && hook.eventName === 'preToolUse' && hook.enabled);
  const hook = find(await listHooks(bin, cwd, overrides, signal));
  if (!hook?.key || !hook.currentHash) throw new Error('Codex edge gate was not loaded; refusing unrestricted execution');
  const trust = ['-c', `hooks.state={${JSON.stringify(hook.key)}={trusted_hash=${JSON.stringify(hook.currentHash)}}}`];
  const verified = find(await listHooks(bin, cwd, [...overrides, ...trust], signal));
  if (verified?.trustStatus !== 'trusted' || verified.currentHash !== hook.currentHash) {
    throw new Error(`Codex edge gate trust could not be verified (${verified?.trustStatus}, hash stable=${verified?.currentHash === hook.currentHash}); refusing unrestricted execution`);
  }
  return trust;
}

/**
 * §5.25 (H) — trust every app-owned hook of one turn (edge gate + permission bridge) in a single
 * `hooks.state` override, then re-list to confirm each is trusted with an unchanged hash. Only the
 * hooks in `expected` are trusted; the user's own hooks keep whatever trust they already have.
 */
export async function prepareCodexHooks(
  bin: string,
  cwd: string,
  overrides: string[],
  expected: readonly CodexExpectedHook[],
  signal: AbortSignal,
): Promise<string[]> {
  if (!expected.length) return [];
  const find = (hooks: HookMetadata[]) => expected.map((want) =>
    hooks.find((hook) => hook.command === want.command && hook.eventName === want.eventName && hook.enabled));
  const loaded = find(await listHooks(bin, cwd, overrides, signal));
  const missing = expected.filter((_, index) => !loaded[index]?.key || !loaded[index]?.currentHash);
  if (missing.length) throw new Error(`Codex app hooks were not loaded (${missing.map((hook) => hook.eventName).join(', ')})`);
  const state = loaded.map((hook) => `${JSON.stringify(hook!.key)}={trusted_hash=${JSON.stringify(hook!.currentHash)}}`);
  const trust = ['-c', `hooks.state={${state.join(',')}}`];
  const verified = find(await listHooks(bin, cwd, [...overrides, ...trust], signal));
  const failed = verified.findIndex((hook, index) => hook?.trustStatus !== 'trusted' || hook.currentHash !== loaded[index]!.currentHash);
  if (failed >= 0) {
    const hook = verified[failed];
    throw new Error(`Codex app hook trust could not be verified (${expected[failed]!.eventName}: ${hook?.trustStatus}, hash stable=${hook?.currentHash === loaded[failed]!.currentHash})`);
  }
  return trust;
}
