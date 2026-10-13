import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import * as os from 'node:os';
import type { CodexModelEntry } from '@vibisual/shared';
import { augmentedEnv } from './binLocator.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { observeChildStreamErrors } from './childStreamErrors.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { modelRecord, parseCodexModelListPage } from './codexModelCatalog.js';
import { CODEX_MODEL_DISCOVERY as config } from './codexModelRpcConfig.js';

/** Public app-server model/list, not an inference or entitlement probe.
 * https://learn.chatgpt.com/docs/app-server#models
 */
export function queryCodexModelList(
  bin: string,
  home: string,
  options: { platform?: NodeJS.Platform; timeoutMs?: number; shutdownMs?: number } = {},
): Promise<CodexModelEntry[]> {
  const platform = options.platform ?? process.platform;
  const invocation = buildCliInvocation(bin, ['app-server'], platform);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      shell: invocation.shell, windowsHide: true, stdio: 'pipe',
      // Catalog is global: don't inherit the server project's .codex configuration.
      cwd: os.homedir(),
      env: augmentedEnv({ ...process.env, CODEX_HOME: home }), ...processGroupSpawnOptions(platform),
    });
    let finished = false;
    let settled = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, models: CodexModelEntry[] = []): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(shutdownTimer);
        child.off('exit', settle); child.off('close', settle);
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        if (error) reject(error); else resolve(models);
      };
      if (child.exitCode !== null || child.signalCode !== null) { settle(); return; }
      child.once('exit', settle); child.once('close', settle);
      shutdownTimer = setTimeout(() => {
        killTree(child.pid, platform);
        try { child.kill(); } catch { /* The child may already have exited. */ }
        settle();
      }, options.shutdownMs ?? config.shutdownMs);
      shutdownTimer.unref?.();
      // Kill while the parent still owns its descendants; don't wait on inherited pipes.
      killTree(child.pid, platform);
      try { child.stdin.end(); } catch { /* The bounded shutdown still owns cleanup. */ }
    };
    const timer = setTimeout(() => finish(new Error('Codex model catalog timed out')), options.timeoutMs ?? config.timeoutMs);
    const send = (message: object): void => {
      if (finished) return;
      try { child.stdin.write(JSON.stringify(message) + '\n'); }
      catch { finish(new Error('Codex model catalog input failed')); }
    };
    let requestId = 1;
    let pages = 0;
    const cursors = new Set<string>();
    const models = new Map<string, CodexModelEntry>();
    const nextPage = (cursor?: string): void => {
      requestId++;
      send({ id: requestId, method: 'model/list', params: {
        limit: config.pageSize, includeHidden: false, ...(cursor ? { cursor } : {}),
      } });
    };
    const handleLine = (line: string): void => {
      if (finished) return;
      let message: Record<string, unknown> | undefined;
      try { message = modelRecord(JSON.parse(line)); } catch { return; }
      if (!message || message.id !== requestId) return;
      if (message.error) { finish(new Error('Codex model catalog request failed')); return; }
      if (requestId === 1) {
        send({ method: 'initialized' });
        nextPage();
        return;
      }
      try {
        const page = parseCodexModelListPage(message.result);
        for (const model of page.models) models.set(model.slug, model);
        pages++;
        if (!page.nextCursor) { finish(undefined, [...models.values()]); return; }
        if (cursors.has(page.nextCursor) || pages >= config.maxPages) {
          finish(new Error('Codex model catalog pagination did not finish')); return;
        }
        cursors.add(page.nextCursor);
        nextPage(page.nextCursor);
      } catch (error) { finish(error instanceof Error ? error : new Error('Codex model catalog response invalid')); }
    };
    const decoder = new StringDecoder('utf8');
    let outputBytes = 0;
    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (finished) return;
      outputBytes += chunk.length;
      if (outputBytes > config.maxOutputBytes) { finish(new Error('Codex model catalog output too large')); return; }
      pending += decoder.write(chunk);
      let newline = pending.indexOf('\n');
      while (newline >= 0 && !finished) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        handleLine(line); newline = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', () => { /* Never publish arbitrary config or authentication diagnostics. */ });
    observeChildStreamErrors(child, () => finish(new Error('Codex model catalog stream failed')));
    child.on('error', () => finish(new Error('Codex model catalog process failed')));
    child.on('exit', () => finish(new Error('Codex model catalog exited before completion')));
    child.on('close', () => finish(new Error('Codex model catalog closed before completion')));
    send({ id: 1, method: 'initialize', params: { clientInfo: config.clientInfo } });
  });
}
