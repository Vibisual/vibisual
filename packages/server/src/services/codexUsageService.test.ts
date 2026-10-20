import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexAuthStatus } from '@vibisual/shared';
import { parseCodexUsage, readCodexUsage } from './codexUsageService.js';

const { spawn, auth } = vi.hoisted(() => ({ spawn: vi.fn(), auth: { current: { loggedIn: true, checkedAt: 1 } as CodexAuthStatus } }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('./codexCli.js', () => ({ getCodexBin: () => 'codex' }));
vi.mock('./claudeCliRun.js', () => ({ buildCliInvocation: () => ({ file: 'codex', args: ['app-server'], shell: false }) }));
vi.mock('./codexAuthService.js', () => ({ codexAuthService: { get: () => auth.current } }));
vi.mock('./binLocator.js', () => ({ augmentedEnv: () => ({}) }));
vi.mock('./processTree.js', () => ({ killTree: vi.fn(), processGroupSpawnOptions: () => ({}) }));

afterEach(() => { vi.useRealTimers(); });
let authRevision = 1;
beforeEach(() => {
  spawn.mockReset();
  auth.current = { loggedIn: true, checkedAt: ++authRevision };
});

function deferredProbes(): Array<(message: object) => void> {
  const pending: Array<(message: object) => void> = [];
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough; pid: number };
    child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.pid = 123;
    child.stdin.on('data', bytes => {
      const request = JSON.parse(bytes.toString());
      if (request.id === 1) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
      if (request.id === 2) pending.push(message => child.stdout.write(JSON.stringify({ id: 2, ...message }) + '\n'));
    });
    return child;
  });
  return pending;
}
describe('Codex account limits', () => {
  it('exposes the subscription plan from current and legacy rate limits', () => {
    expect(parseCodexUsage({ rateLimits: { planType: 'pro' } }).plan).toBe('Pro');
    expect(parseCodexUsage({ rateLimitsByLimitId: { codex: { planType: 'plus' } } }).plan).toBe('Plus');
    expect(parseCodexUsage({ rateLimits: { planType: 'unknown' } }).plan).toBeUndefined();
    expect(parseCodexUsage({ rateLimits: { planType: 42 } }).plan).toBeUndefined();
    expect(parseCodexUsage(null).plan).toBeUndefined();
  });
  it('prefers multiple buckets, preserves zero and converts seconds to milliseconds', () => {
    const result = parseCodexUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 0, resetsAt: 123, windowDurationMins: 300 }, secondary: { usedPercent: 47, windowDurationMins: 10080 } },
      review: { primary: { usedPercent: 22 } },
    } }, 10);
    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]).toEqual({ id: 'codex:primary', label: 'codex', usedPercent: 0, resetsAt: 123000, windowDurationMins: 300 });
    expect(result.fetchedAt).toBe(10);
  });
  it('supports legacy responses without manufacturing missing limits', () => {
    expect(parseCodexUsage({ rateLimits: { primary: { usedPercent: 20 }, secondary: null } }).windows).toHaveLength(1);
    for (const data of [null, {}, { rateLimits: { primary: { usedPercent: null } } }]) {
      expect(parseCodexUsage(data).windows).toEqual([]);
      expect(parseCodexUsage(data).error).toBe('unavailable');
    }
  });

  it('preserves real credit-only measurements, zero balances, and unlimited credit availability', () => {
    for (const credits of [
      { hasCredits: true, unlimited: false, balance: '12.5000' },
      { hasCredits: false, unlimited: false, balance: '0' },
      { hasCredits: true, unlimited: true, balance: null },
    ]) {
      const result = parseCodexUsage({ rateLimits: { credits } }, 40);
      expect(result).toEqual({ windows: [], fetchedAt: 40, credits: {
        hasCredits: credits.hasCredits, unlimited: credits.unlimited,
        ...(credits.balance !== null ? { balance: credits.balance } : {}),
      } });
    }
  });

  it('selects the current codex credit snapshot without adding mirrored account balances', () => {
    const current = { hasCredits: true, unlimited: false, balance: '20' };
    const result = parseCodexUsage({
      rateLimits: { credits: { ...current, balance: '10' } },
      rateLimitsByLimitId: { review: { credits: current }, codex: { credits: current } },
    });
    expect(result.credits).toEqual(current);
    expect(parseCodexUsage({ rateLimitsByLimitId: { review: { credits: current } } }).credits).toEqual(current);
  });

  it('preserves authoritative reset-pass counts, whitelisted details, and their explicit expiry semantics', () => {
    const result = parseCodexUsage({ rateLimitResetCredits: { availableCount: 3, credits: [{
      id: 'pass-1', resetType: 'codexRateLimits', status: 'available', grantedAt: 123, expiresAt: 456,
      title: 'Usage reset', description: 'Reset included usage', token: 'must-not-forward',
    }, { id: 'pass-2', resetType: 'future-type', status: 'future-status', expiresAt: null }] } }, 10);
    expect(result).toEqual({ windows: [], fetchedAt: 10, resetCredits: { availableCount: 3, credits: [
      { id: 'pass-1', resetType: 'codexRateLimits', status: 'available', grantedAt: 123000, expiresAt: 456000,
        title: 'Usage reset', description: 'Reset included usage' },
      { id: 'pass-2', resetType: 'unknown', status: 'unknown', expiresAt: null },
    ] } });
  });

  it('keeps unknown reset details distinct from a known empty list and does not derive total from rows', () => {
    expect(parseCodexUsage({ rateLimitResetCredits: { availableCount: 2, credits: null } }).resetCredits)
      .toEqual({ availableCount: 2 });
    expect(parseCodexUsage({ rateLimitResetCredits: { availableCount: 0, credits: [] } }).resetCredits)
      .toEqual({ availableCount: 0, credits: [] });
    expect(parseCodexUsage({ rateLimitResetCredits: { availableCount: 2, credits: [] } }).resetCredits?.availableCount).toBe(2);
  });

  it('rejects malformed RPC fields and never forwards arbitrary objects or credentials', () => {
    const result = parseCodexUsage({
      accessToken: 'secret', accountId: 'account-secret', rateLimitUpsell: { secret: 'hidden' },
      rateLimits: { primary: { usedPercent: 9, resetsAt: 8.64e12 + 1, windowDurationMins: -1 }, limitName: { secret: true },
        credits: { hasCredits: false, unlimited: false, balance: { secret: 'hidden' }, token: 'hidden' } },
      rateLimitResetCredits: { availableCount: 1, credits: [null, { id: 2 }, { id: 'pass-1', grantedAt: NaN, expiresAt: 8.64e12 + 1 }] },
    }, 20);
    expect(result).toEqual({ windows: [{ id: 'codex:primary', label: 'codex', usedPercent: 9 }], fetchedAt: 20,
      credits: { hasCredits: false, unlimited: false }, resetCredits: { availableCount: 1, credits: [
        { id: 'pass-1', resetType: 'unknown', status: 'unknown' },
      ] } });
    for (const credits of [null, [], {}, { hasCredits: 'true', unlimited: false }, { hasCredits: true }]) {
      expect(parseCodexUsage({ rateLimits: { credits } }).credits).toBeUndefined();
    }
    for (const availableCount of [-1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseCodexUsage({ rateLimitResetCredits: { availableCount } }).resetCredits).toBeUndefined();
    }
  });
});

describe('Codex usage server cache', () => {
  it('keeps credit-only success and its timestamp on failure, throttles retries, and clears after account changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const results = [
      { result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '12' } }, rateLimitResetCredits: { availableCount: 2, credits: null } } },
      { error: { message: 'temporary failure' } },
      { error: { message: 'account changed' } },
    ];
    spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough; pid: number };
      child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.pid = 123;
      const result = results.shift();
      child.stdin.on('data', bytes => {
        const request = JSON.parse(bytes.toString());
        if (request.id === 1) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
        if (request.id === 2) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 2, ...result }) + '\n'));
      });
      return child;
    });
    const success = await readCodexUsage();
    expect(success.error).toBeUndefined();
    expect(success.credits?.balance).toBe('12');
    expect(success.resetCredits?.availableCount).toBe(2);
    vi.setSystemTime(116_000);
    expect(await readCodexUsage()).toEqual({ ...success, error: 'unavailable' });
    vi.setSystemTime(117_000);
    expect(await readCodexUsage()).toEqual({ ...success, error: 'unavailable' });
    expect(spawn).toHaveBeenCalledTimes(2);
    auth.current.checkedAt += 1;
    expect(await readCodexUsage()).toEqual({ windows: [], fetchedAt: 117_000, error: 'unavailable' });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('starts a new account probe without joining old inflight work and discards its late balance', async () => {
    const pending = deferredProbes();
    auth.current = { loggedIn: true, account: 'a@example.com', checkedAt: 100 };
    const oldRequest = readCodexUsage();
    await Promise.resolve();
    auth.current = { loggedIn: true, account: 'b@example.com', checkedAt: 200 };
    const newRequest = readCodexUsage();
    await Promise.resolve();
    expect(newRequest).not.toBe(oldRequest);
    expect(spawn).toHaveBeenCalledTimes(2);
    pending[1]!({ result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '20' } } } });
    const current = await newRequest;
    pending[0]!({ result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '10' } } } });
    expect((await oldRequest).credits).toBeUndefined();
    expect(await readCodexUsage()).toEqual(current);
    expect(current.credits?.balance).toBe('20');
  });

  it('does not let old completion clear the new account inflight request or leak after logout', async () => {
    const pending = deferredProbes();
    auth.current = { loggedIn: true, account: 'a@example.com', checkedAt: 100 };
    const oldRequest = readCodexUsage();
    await Promise.resolve();
    auth.current = { loggedIn: true, account: 'b@example.com', checkedAt: 200 };
    const newRequest = readCodexUsage();
    await Promise.resolve();
    pending[0]!({ result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '10' } } } });
    expect((await oldRequest).credits).toBeUndefined();
    expect(readCodexUsage()).toBe(newRequest);
    auth.current = { loggedIn: false, checkedAt: 300 };
    pending[1]!({ result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '20' } } } });
    expect((await newRequest).credits).toBeUndefined();
  });

  it('keeps a named account cache through routine auth polls and unknown auth status, but clears on account change', async () => {
    const pending = deferredProbes();
    auth.current = { loggedIn: true, account: 'a@example.com', checkedAt: 100 };
    const request = readCodexUsage();
    await Promise.resolve();
    pending[0]!({ result: { rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '10' } } } });
    const current = await request;
    auth.current = { ...auth.current, checkedAt: 200 };
    expect(await readCodexUsage()).toEqual(current);
    auth.current = { loggedIn: false, staleLoggedIn: true, error: 'timeout', checkedAt: 300 };
    expect(await readCodexUsage()).toEqual(current);
    expect(spawn).toHaveBeenCalledTimes(1);
    auth.current = { loggedIn: true, account: 'b@example.com', checkedAt: 400 };
    const next = readCodexUsage();
    await Promise.resolve();
    pending[1]!({ error: { message: 'temporary failure' } });
    expect((await next).credits).toBeUndefined();
  });
});
