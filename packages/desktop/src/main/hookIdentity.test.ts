import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHookIdentity } from './hookIdentity';

const state = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }));

beforeEach(() => { state.userData = mkdtempSync(join(tmpdir(), 'vibisual-hook-identity-')); });
afterEach(() => { rmSync(state.userData, { recursive: true, force: true }); vi.restoreAllMocks(); });
function persist(port: unknown): void {
  writeFileSync(join(state.userData, 'hook-listener.json'), JSON.stringify({ port, token: 'fixture-token' }));
}

describe('saved hook listener port recovery', () => {
  it.each([65536, 1e20, -1, 0, 1.5, '4800', null, undefined])('uses dynamic allocation for invalid port %s without rotating the token', (port) => {
    persist(port);
    expect(loadHookIdentity()).toEqual({ preferredPort: 0, token: 'fixture-token' });
  });

  it.each([1, 4800, 65535])('preserves valid saved TCP port %s', (port) => {
    persist(port);
    expect(loadHookIdentity()).toEqual({ preferredPort: port, token: 'fixture-token' });
  });

  it('recovers a corrupt JSON file and creates a fresh identity', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(state.userData, 'hook-listener.json'), '{broken');
    expect(loadHookIdentity()).toEqual({ preferredPort: 0, token: expect.stringMatching(/^[a-f0-9]{48}$/) });
  });

  it('can bind a loopback listener after recovering an out-of-range saved port', async () => {
    persist(65536);
    const { preferredPort } = loadHookIdentity();
    const listener = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(preferredPort, '127.0.0.1', resolve);
      });
      const address = listener.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      expect(address.port).toBeGreaterThan(0);
      expect(address.port).toBeLessThanOrEqual(65535);
    } finally {
      if (listener.listening) await new Promise<void>((resolve) => { listener.close(() => resolve()); });
    }
  });
});
