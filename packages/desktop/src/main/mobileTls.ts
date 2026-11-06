import { X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { generate } from 'selfsigned';

/** Keep the trust anchor stable when DHCP changes an address or the leaf expires. */
export interface MobileTls {
  key: string;
  cert: string;
  caKey: string;
  caCert: string;
}

const DAY_MS = 86_400_000;

function validPair(key: unknown, pem: unknown, minimumRemaining: number): X509Certificate | null {
  if (typeof key !== 'string' || typeof pem !== 'string') return null;
  try {
    const cert = new X509Certificate(pem);
    return cert.checkPrivateKey(createPrivateKey(key))
      && Date.parse(cert.validFrom) <= Date.now()
      && Date.parse(cert.validTo) > Date.now() + minimumRemaining ? cert : null;
  } catch { return null; }
}

/** Public addresses only; neither the private keys nor pairing credentials enter a URL. */
export function mobileTlsAddresses(addresses: readonly string[]): string[] {
  return [...new Set(['127.0.0.1', '::1', ...addresses.filter((address) => !address.includes('%') && isIP(address) !== 0)])].sort();
}

export async function ensureMobileTls(previous: unknown, addresses: readonly string[]): Promise<MobileTls> {
  const saved = previous && typeof previous === 'object' ? previous as Partial<MobileTls> : {};
  const ips = mobileTlsAddresses(addresses);
  let caKey = saved.caKey;
  let caCert = saved.caCert;
  let root = validPair(caKey, caCert, 30 * DAY_MS);
  if (!root?.ca || !root.verify(root.publicKey)) {
    const ca = await generate([{ name: 'commonName', value: 'Vibisual Mobile Access CA' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - DAY_MS),
      notAfterDate: new Date(Date.now() + 10 * 365 * DAY_MS),
      extensions: [
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    });
    caKey = ca.private;
    caCert = ca.cert;
    root = new X509Certificate(caCert);
  }
  // Above either validates the saved pair or creates both members together.
  if (caKey === undefined || caCert === undefined) throw new Error('mobile CA unavailable');
  const leaf = validPair(saved.key, saved.cert, DAY_MS);
  if (leaf && !leaf.ca && leaf.verify(root.publicKey)
    && leaf.checkHost('localhost') && ips.every((ip) => leaf.checkIP(ip))
    && leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')
    && Date.parse(leaf.validTo) - Date.parse(leaf.validFrom) <= 398 * DAY_MS) {
    return { key: saved.key!, cert: saved.cert!, caKey, caCert };
  }
  const issued = await generate([{ name: 'commonName', value: 'Vibisual Mobile Access' }], {
    keySize: 2048,
    algorithm: 'sha256',
    ca: { key: caKey, cert: caCert },
    notBeforeDate: new Date(Date.now() - DAY_MS),
    notAfterDate: new Date(Date.now() + 365 * DAY_MS),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7 as const, ip }))] },
    ],
  });
  return { key: issued.private, cert: issued.cert, caKey, caCert };
}

/** Preserve QR query strings when upgrading a saved HTTP bookmark to HTTPS. */
export function mobileHttpsRedirect(host: string, requestPath: string, port: number): string | null {
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    if (parsed.hostname !== 'localhost' && isIP(parsed.hostname.replace(/^\[|\]$/g, '')) === 0) return null;
    if (!requestPath.startsWith('/') || requestPath.startsWith('//')) return null;
    return `https://${parsed.hostname}:${port}${requestPath}`;
  } catch { return null; }
}
