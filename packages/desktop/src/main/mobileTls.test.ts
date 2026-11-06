import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { createServer, get, type Server } from 'node:https';
import { ensureMobileTls, mobileHttpsRedirect, mobileTlsAddresses, type MobileTls } from './mobileTls';

describe('mobile HTTPS trust across desktop and phone browsers', () => {
  let tls: MobileTls;
  let server: Server | undefined;
  beforeAll(async () => { tls = await ensureMobileTls(null, ['192.168.0.8']); });
  afterAll(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); });

  it('issues a serverAuth leaf with IP SANs and validity accepted by iOS', () => {
    const ca = new X509Certificate(tls.caCert);
    const leaf = new X509Certificate(tls.cert);
    expect(ca.ca).toBe(true);
    expect(leaf.ca).toBe(false);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.checkIP('192.168.0.8')).toBe('192.168.0.8');
    expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(leaf.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
    expect(Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)).toBeLessThan(398 * 86_400_000);
  });

  it('reuses the same trust anchor and leaf on restart', async () => {
    expect(await ensureMobileTls(tls, ['192.168.0.8'])).toEqual(tls);
  });

  it('keeps the trusted CA when DHCP or the public IP changes', async () => {
    const renewed = await ensureMobileTls(tls, ['192.168.0.9', '203.0.113.2']);
    expect(renewed.caCert).toBe(tls.caCert);
    expect(renewed.caKey).toBe(tls.caKey);
    expect(renewed.cert).not.toBe(tls.cert);
    expect(new X509Certificate(renewed.cert).checkIP('203.0.113.2')).toBe('203.0.113.2');
  });

  it('renews an expired leaf without asking clients to trust another CA', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 370 * 86_400_000);
    try {
      const renewed = await ensureMobileTls(tls, ['192.168.0.8']);
      expect(renewed.caCert).toBe(tls.caCert);
      expect(renewed.cert).not.toBe(tls.cert);
      expect(Date.parse(new X509Certificate(renewed.cert).validTo)).toBeGreaterThan(Date.now());
    } finally { clock.mockRestore(); }
  });

  it('migrates the old untrusted certificate format instead of reusing its missing IP SAN', async () => {
    const migrated = await ensureMobileTls({ key: tls.key, cert: tls.cert }, ['192.168.0.8']);
    expect(migrated.caCert).not.toBe(tls.caCert);
    expect(new X509Certificate(migrated.cert).verify(new X509Certificate(migrated.caCert).publicKey)).toBe(true);
  });

  it('establishes a real HTTPS connection after the client trusts the downloaded CA', async () => {
    server = createServer({ key: tls.key, cert: tls.cert }, (_req, res) => res.end('microphone origin'));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test HTTPS listener unavailable');
    const result = await new Promise<string>((resolve, reject) => {
      const req = get({ hostname: '127.0.0.1', port: address.port, ca: tls.caCert }, (res) => {
        let text = '';
        res.on('data', (data: Buffer) => { text += data.toString(); });
        res.on('end', () => resolve(text));
      });
      req.on('error', reject);
    });
    expect(result).toBe('microphone origin');
  });
});

describe('mobile HTTPS URLs', () => {
  it('upgrades existing HTTP bookmarks and preserves one-use QR tickets', () => {
    expect(mobileHttpsRedirect('192.168.0.8:4000', '/mobile/qr?t=one-use', 4443))
      .toBe('https://192.168.0.8:4443/mobile/qr?t=one-use');
    expect(mobileHttpsRedirect('[::1]:4000', '/', 4443)).toBe('https://[::1]:4443/');
  });
  it('rejects redirect hosts and paths that could escape the app origin', () => {
    for (const host of ['example.com', 'user@192.168.0.8', '192.168.0.8/evil', '192.168.0.8?bad']) {
      expect(mobileHttpsRedirect(host, '/', 4443)).toBeNull();
    }
    expect(mobileHttpsRedirect('192.168.0.8', '//example.com/', 4443)).toBeNull();
  });
  it('only places valid, unique IP addresses into a certificate', () => {
    expect(mobileTlsAddresses(['192.168.0.8', '192.168.0.8', 'bad', 'fe80::1%en0']))
      .toEqual(['127.0.0.1', '192.168.0.8', '::1']);
  });
});
