import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildCliInvocation } from './claudeCliRun.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { codexEdgeHookCommand, codexEdgeOverrides, type CodexEdgeConfig } from './codexEdges.js';

interface HookMetadata {
  command?: string;
  eventName: string;
  key: string;
  currentHash: string;
  enabled: boolean;
  trustStatus: string;
}

/** Read the CLI's own hook hash. Never hash an approximation or trust other hooks. */
function listHooks(bin: string, cwd: string, overrides: string[], signal: AbortSignal): Promise<HookMetadata[]> {
  return new Promise((resolve, reject) => {
    const invocation = buildCliInvocation(bin, ['app-server', ...overrides], process.platform);
    const child = spawn(invocation.file, invocation.args, { shell: invocation.shell, windowsHide: true,
      cwd, env: augmentedEnv(process.env), stdio: 'pipe', ...processGroupSpawnOptions() });
    let finished = false;
    const finish = (error?: Error, hooks: HookMetadata[] = [], closed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const settle = () => { if (error) reject(error); else resolve(hooks); };
      if (closed) { settle(); return; }
      child.once('close', settle);
      child.stdin.end();
      killTree(child.pid);
    };
    const abort = () => finish(new Error('Codex hook preparation cancelled'));
    const timer = setTimeout(() => finish(new Error('Codex hook inspection timed out')), 15000);
    const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    child.on('error', (error) => finish(error));
    child.on('close', () => finish(new Error('Codex hook inspection exited before verification'), [], true));
    child.stdin.on('error', (error) => finish(error));
    child.stderr.on('data', () => { /* Do not expose user config or authentication diagnostics. */ });
    createInterface({ input: child.stdout }).on('line', (line) => {
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
