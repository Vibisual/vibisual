/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 문서. 동의 창과 같은 규율(data: 문서 · nonce CSP · 바깥 자원 0)을 지키는지,
 * 실어 보내는 글이 문서를 깨지 못하는지, 움직임을 줄이라는 설정을 따르는지 본다.
 */
import { describe, expect, it } from 'vitest';
import { splashPage, type SplashPageInput } from './splashPage';
import { splashPalette, splashStageView } from './splashPolicy';
import { splashStrings } from './splashStrings';

const NONCE = 'a'.repeat(48);
const ko = splashStrings('ko');
const input = (over: Partial<SplashPageInput> = {}): SplashPageInput => ({
  nonce: NONCE,
  locale: 'ko',
  view: splashStageView('starting', ko),
  palette: splashPalette('#030712', 'dark'),
  version: 'v0.2.3',
  progressLabel: ko.progressLabel,
  ...over,
});

describe('스플래시 문서', () => {
  it('nonce CSP — 스크립트·스타일은 nonce 로만, 그 밖은 전부 막는다', () => {
    const html = splashPage(input());
    expect(html).toContain(`default-src 'none'; script-src 'nonce-${NONCE}'; style-src 'nonce-${NONCE}'`);
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });

  it('바깥 자원이 없다 — 글꼴·그림·주소를 부르지 않는다', () => {
    const html = splashPage(input());
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b|<img\b|@import|url\(\s*['"]?(?!#)/);
  });

  it('실어 보내는 글이 문서를 깨지 못한다(</script> · 줄 구분자)', () => {
    const LS = String.fromCharCode(0x2028);
    const html = splashPage(input({ view: { text: `</script><script>alert(1)</script>${LS}`, detail: '', progress: 0.1, ceiling: 0.2 } }));
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).not.toContain(LS);
  });

  it('판올림·접근성 이름은 마크업으로 들어가지 못한다', () => {
    const html = splashPage(input({ version: 'v1"><b>x</b>', progressLabel: '<i>bar</i>' }));
    expect(html).not.toContain('"><b>x</b>');
    expect(html).not.toContain('<i>bar</i>');
    expect(html).toContain('&lt;i&gt;bar&lt;/i&gt;');
  });

  it('모양이 이상한 nonce 는 받지 않고, 모르는 lang 은 en 으로', () => {
    expect(() => splashPage(input({ nonce: 'short' }))).toThrow();
    expect(() => splashPage(input({ nonce: `${'a'.repeat(30)}"><script>` }))).toThrow();
    expect(splashPage(input({ locale: 'ko"><x' }))).toContain('<html lang="en">');
    expect(splashPage(input({ locale: 'zh-CN' }))).toContain('<html lang="zh-CN">');
  });

  it('밝은 테마는 color-scheme 도 밝다', () => {
    expect(splashPage(input({ palette: splashPalette('#ffffff', 'light') }))).toContain('color-scheme: light;');
    expect(splashPage(input())).toContain('color-scheme: dark;');
  });

  it('움직임을 줄이라는 설정이면 궤도·광택을 멈춘다', () => {
    const html = splashPage(input());
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it('움직임은 합성 단계의 transform 이다 — SVG 회전 ❌(배율이 100% 가 아니면 메인 스레드에서 돈다)', () => {
    const html = splashPage(input());
    expect(html).toMatch(/\.orbit \{[^}]*animation: vb-spin/);
    expect(html).not.toMatch(/<animateTransform|<svg[^>]*class="[^"]*orbit/);
  });

  it('진척은 preload 다리로만 받는다 — 막대는 바닥 아래로 내려가지 않는다', () => {
    const html = splashPage(input());
    expect(html).toContain('window.vibSplash');
    expect(html).toContain('bridge.onUpdate(apply)');
    expect(html).toContain('Math.max(floor,');
  });

  it('이모지 아이콘이 없다 — 로고는 버블 그라데이션 SVG', () => {
    const html = splashPage(input());
    expect(/\p{Extended_Pictographic}/u.test(html)).toBe(false);
    expect(html).toContain('<linearGradient id="vb-bubble"');
  });
});
