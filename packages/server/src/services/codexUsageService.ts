import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderUsage, ProviderUsageWindow } from '@vibisual/shared';
import { getCodexBin } from './codexCli.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';
import { codexAuthService } from './codexAuthService.js';
import { augmentedEnv } from './binLocator.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function milliseconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value * 1000 <= 8.64e15
    ? value * 1000 : undefined;
}

/** CreditsSnapshot fields from the installed Codex app-server protocol. */
function parseCredits(value: unknown): ProviderUsage['credits'] {
  const credits = record(value);
  if (typeof credits?.hasCredits !== 'boolean' || typeof credits.unlimited !== 'boolean') return undefined;
  const balance = text(credits.balance);
  return { hasCredits: credits.hasCredits, unlimited: credits.unlimited, ...(balance ? { balance } : {}) };
}

/** Read-only RateLimitResetCreditsSummary; IDs are never used to redeem a pass here. */
function parseResetCredits(value: unknown): ProviderUsage['resetCredits'] {
  const summary = record(value);
  if (typeof summary?.availableCount !== 'number' || !Number.isSafeInteger(summary.availableCount) || summary.availableCount < 0) return undefined;
  const credits = Array.isArray(summary.credits) ? summary.credits.flatMap(value => {
    const credit = record(value);
    const id = text(credit?.id);
    if (!credit || !id) return [];
    const grantedAt = milliseconds(credit.grantedAt);
    const expiresAt = credit.expiresAt === null ? null : milliseconds(credit.expiresAt);
    const title = text(credit.title);
    const description = text(credit.description);
    const resetType = credit.resetType === 'codexRateLimits' ? 'codexRateLimits' as const : 'unknown' as const;
    const status: 'available' | 'redeeming' | 'redeemed' | 'unknown' =
      credit.status === 'available' || credit.status === 'redeeming' || credit.status === 'redeemed' ? credit.status : 'unknown';
    return [{ id, resetType, status,
      ...(grantedAt !== undefined ? { grantedAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(title ? { title } : {}), ...(description ? { description } : {}),
    }];
  }) : undefined;
  return { availableCount: summary.availableCount, ...(credits ? { credits } : {}) };
}

function hasMeasurements(usage: ProviderUsage): boolean {
  return usage.windows.length > 0 || usage.credits !== undefined || usage.resetCredits !== undefined;
}

/** Parse only documented usage fields; never forward credentials or arbitrary RPC output. */
export function parseCodexUsage(value: unknown, now = Date.now()): ProviderUsage {
  const response = record(value);
  const legacy = record(response?.rateLimits);
  const byLimitId = record(response?.rateLimitsByLimitId);
  const buckets = byLimitId && Object.keys(byLimitId).length ? byLimitId : legacy ? { codex: legacy } : {};
  const windows: ProviderUsageWindow[] = [];
  for (const [id, value] of Object.entries(buckets)) {
    const bucket = record(value);
    for (const key of ['primary', 'secondary']) {
      const window = record(bucket?.[key]);
      if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue;
      const resetsAt = milliseconds(window.resetsAt);
      windows.push({ id: `${id}:${key}`, label: text(bucket?.limitName) || id,
        usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
        ...(typeof window.windowDurationMins === 'number' && Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0 ? { windowDurationMins: window.windowDurationMins } : {}),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      });
    }
  }
  const planType = [legacy?.planType, record(buckets.codex)?.planType,
    ...Object.values(buckets).map(bucket => record(bucket)?.planType)]
    .find(plan => typeof plan === 'string' && plan.trim() && plan !== 'unknown');
  const plan = typeof planType === 'string'
    ? planType.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    : undefined;
  // The legacy snapshot mirrors a bucket, so never add its balance to the multi-bucket view.
  const credits = [record(buckets.codex)?.credits, legacy?.credits, ...Object.values(buckets).map(bucket => record(bucket)?.credits)]
    .map(parseCredits).find(credits => credits !== undefined);
  const resetCredits = parseResetCredits(response?.rateLimitResetCredits);
  const usage: ProviderUsage = { windows, fetchedAt: now,
    ...(plan ? { plan } : {}), ...(credits ? { credits } : {}), ...(resetCredits ? { resetCredits } : {}),
  };
  return hasMeasurements(usage) ? usage : { ...usage, error: 'unavailable' };
}

let inflight: Promise<ProviderUsage> | null = null;
let cached: ProviderUsage | null = null;
let cachedAt = 0;
let authScope = 'unknown';
let generation = 0;

function synchronizeAccount(): void {
  const auth = codexAuthService.get();
  // A failed status probe is unknown, not evidence of logout or a different account.
  const scope = auth?.error ? authScope : !auth ? 'unknown' : !auth.loggedIn ? 'logged-out'
    : JSON.stringify([auth.authMethod, auth.account || auth.checkedAt]);
  // Without an account identifier, a new auth check is the only available boundary signal.
  if (scope === authScope) return;
  authScope = scope;
  generation += 1;
  cached = null;
  cachedAt = 0;
  inflight = null;
}

export function readCodexUsage(): Promise<ProviderUsage> {
  synchronizeAccount();
  if (inflight) return inflight;
  if (cached && Date.now() - cachedAt < 15_000) return Promise.resolve(cached);
  const requestGeneration = generation;
  inflight = probe().then(result => {
    synchronizeAccount();
    // Old callers must not receive the previous account's balance either.
    if (requestGeneration !== generation) return { windows: [], fetchedAt: Date.now(), error: 'unavailable' };
    cached = result.error && !hasMeasurements(result) && cached && hasMeasurements(cached)
      ? { ...cached, error: result.error } : result;
    cachedAt = Date.now();
    return cached;
  }).finally(() => { if (requestGeneration === generation) inflight = null; });
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
