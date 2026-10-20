import { describe, expect, it } from 'vitest';
import { APP_MESSAGE_ORIGIN, appMessagePage, messageButtonIndex, messageResponse } from './appMessagePage';

describe('standalone app message page', () => {
  it('renders untrusted messages as text under a restrictive CSP', () => {
    const payload = '</script><script>alert(1)</script>\u2028';
    const page = appMessagePage({ title: payload, message: payload, detail: payload, buttons: [payload],
      theme: { kind: 'light', background: '#f8fafc' } }, 'test-nonce');
    expect(page).not.toContain(payload);
    expect(page).toContain('\\u003c/script>');
    expect(page).toContain('\\u2028');
    expect(page).toContain("default-src 'none'; script-src 'nonce-test-nonce'");
    expect(page).toContain('.textContent =');
    expect(page).not.toContain('.innerHTML');
    expect(page).toContain('color-scheme: light');
    expect(page).toContain('role="alertdialog"');
  });

  it('sanitizes theme CSS and defaults invalid button indices safely', () => {
    const page = appMessagePage({ title: 'Confirm', message: 'Leave?', buttons: ['Cancel', 'Leave'],
      defaultId: 100, cancelId: -1, destructiveId: 1,
      theme: { kind: 'dark', background: 'red; background: url(https://invalid)' } }, 'nonce');
    expect(page).not.toContain('background: red;');
    expect(page).toContain('background: #030712');
    expect(page).toContain('"defaultId":0');
    expect(page).toContain('"cancelId":0');
    expect(messageButtonIndex(1.5, 2)).toBe(0);
    expect(messageButtonIndex(1, 2)).toBe(1);
  });

  it('accepts only the private origin, path, nonce and existing button', () => {
    const valid = `${APP_MESSAGE_ORIGIN}/answer?nonce=secret&button=1`;
    expect(messageResponse(valid, 'secret', 2)).toBe(1);
    for (const url of [valid.replace('secret', 'wrong'), valid.replace('/answer?', '/other?'),
      valid.replace(APP_MESSAGE_ORIGIN, 'https://example.com'), valid.replace('button=1', 'button=2'),
      valid.replace('button=1', 'button=-1'), valid.replace('button=1', 'button=1.5'),
      valid.replace('button=1', 'button='), 'javascript:alert(1)', 'bad']) {
      expect(messageResponse(url, 'secret', 2), url).toBeNull();
    }
  });
});
