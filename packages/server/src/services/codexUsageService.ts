import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderUsage, ProviderUsageWindow } from '@vibisual/shared';
import { getCodexBin } from './codexCli.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';
import { codexAuthService } from './codexAuthService.js';
import { augmentedEnv } from './binLocator.js';

/** Parse only rate-limit fields; never forward credentials or arbitrary RPC output. */
export function parseCodexUsage(value: unknown, now = Date.now()): ProviderUsage {
  const response = value as { rateLimitsByLimitId?: Record<string, any>; rateLimits?: any } | null;
  const buckets = response?.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length
    ? response.rateLimitsByLimitId : response?.rateLimits ? { codex: response.rateLimits } : {};
  const windows: ProviderUsageWindow[] = [];
  for (const [id, bucket] of Object.entries(buckets)) {
    for (const key of ['primary', 'secondary']) {
      const window = bucket?.[key];
      if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue;
      windows.push({ id: `${id}:${key}`, label: bucket.limitName || id,
        usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
        ...(typeof window.windowDurationMins === 'number' ? { windowDurationMins: window.windowDurationMins } : {}),
        ...(typeof window.resetsAt === 'number' ? { resetsAt: window.resetsAt * 1000 } : {}),
      });
    }
  }
  return { windows, fetchedAt: now, ...(windows.length ? {} : { error: 'unavailable' }) };
}

let inflight: Promise<ProviderUsage> | null = null;
let cached: ProviderUsage | null = null;
let authRevision: number | undefined;
export function readCodexUsage(): Promise<ProviderUsage> {
  if (inflight) return inflight;
  const revision = codexAuthService.get()?.checkedAt;
  if (revision !== authRevision) { cached = null; authRevision = revision; }
  if (cached && Date.now() - cached.fetchedAt < 15_000) return Promise.resolve(cached);
  inflight = probe().then(result => { cached = result; return result; }).finally(() => { inflight = null; });
  return inflight;
}
function probe(): Promise<ProviderUsage> {
  const bin = getCodexBin();
  if (!bin) return Promise.resolve({ windows: [], fetchedAt: Date.now(), error: 'cli-unavailable' });
  const invocation = buildCliInvocation(bin, ['app-server'], process.platform);
  return new Promise(resolve => {
    const child = spawn(invocation.file, invocation.args, { shell: invocation.shell, windowsHide: true, env: augmentedEnv(), stdio: ['pipe', 'pipe', 'ignore'], ...processGroupSpawnOptions() });
    let finished = false;
    const lines = createInterface({ input: child.stdout });
    const finish = (result: ProviderUsage): void => {
      if (finished) return;
      finished = true; clearTimeout(timer); lines.close(); killTree(child.pid); child.stdin.end(); resolve(result);
    };
    const fail = (): void => finish({ windows: [], fetchedAt: Date.now(), error: 'unavailable' });
    const timer = setTimeout(fail, 20_000);
    const send = (message: object): void => { child.stdin.write(JSON.stringify(message) + '\n'); };
    child.on('error', fail); child.on('close', fail); child.stdin.on('error', fail);
    lines.on('line', line => {
      let message: any;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        if (message.error) { fail(); return; }
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read', params: {} });
      } else if (message.id === 2) {
        if (message.error) fail(); else finish(parseCodexUsage(message.result));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vibisual', version: '0.1.0' } } });
  });
}
