import { describe, expect, it } from 'vitest';
import { ghostDocumentUrl, ghostHint, GHOST_HINT_MAX_UNITS } from './ghostText';

describe('ghost text encoding', () => {
  it('does not split an emoji at the original hint limit', () => {
    const prefix = 'a'.repeat(GHOST_HINT_MAX_UNITS - 1);
    const original = `${prefix}😀`;
    expect(() => encodeURIComponent(original.slice(0, GHOST_HINT_MAX_UNITS))).toThrow(URIError);
    expect(ghostHint(original)).toBe(prefix);
    expect(ghostHint(`${'a'.repeat(GHOST_HINT_MAX_UNITS - 2)}😀more`).endsWith('😀')).toBe(true);
  });

  it.each(['한글 日本語 中文 العربية', 'e\u0301 👨‍👩‍👧‍👦 & < > " % #', '\ud800broken\udfff'])('encodes arbitrary text without URI exceptions: %s', (text) => {
    const url = ghostDocumentUrl(text);
    expect(url.startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);
    expect(Buffer.from(url.split(',')[1]!, 'base64').toString('utf8')).toBe(Buffer.from(text, 'utf8').toString('utf8'));
  });

  it('keeps short input and rejects nontext hints', () => {
    expect(ghostHint('한글 😀')).toBe('한글 😀');
    expect(ghostHint(null)).toBe('');
    expect(ghostHint({ text: 'oops' })).toBe('');
  });
});
