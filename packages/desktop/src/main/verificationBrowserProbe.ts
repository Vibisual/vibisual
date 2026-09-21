import { verificationUrl } from './verificationAutomationPolicy';

export const VERIFICATION_BROWSER_PROBE = { timeoutMs: 10_000, maxRedirects: 5 } as const;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Node fetch owns no Electron session cookies and does not execute the response HTML.
 * Use GET because many app servers do not implement HEAD, then discard the body immediately.
 */
export async function probeVerificationBrowser(raw: string, options: { timeoutMs?: number } = {}): Promise<void> {
  let url = verificationUrl(raw);
  const origin = url.origin, controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? VERIFICATION_BROWSER_PROBE.timeoutMs, VERIFICATION_BROWSER_PROBE.timeoutMs));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= VERIFICATION_BROWSER_PROBE.maxRedirects; redirects++) {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (response.status >= 400) throw new Error(`The browser target returned HTTP ${response.status}.`);
      if (!REDIRECTS.has(response.status)) return;
      if (!location) throw new Error('The browser target redirected without a location.');
      if (redirects === VERIFICATION_BROWSER_PROBE.maxRedirects) throw new Error('The browser target redirected too many times.');
      // Check BEFORE following, so a user-selected local URL cannot probe a foreign target.
      url = verificationUrl(new URL(location, url).href, origin);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The browser connection check timed out.');
    if (error instanceof TypeError) throw new Error(`Cannot connect to the browser target: ${error.message}`);
    throw error;
  } finally { clearTimeout(timer); controller.abort(); }
}
