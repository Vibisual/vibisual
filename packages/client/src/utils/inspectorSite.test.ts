import { describe, it, expect } from 'vitest';
import { workspaceSiteUrl, type WorkspaceSiteInspectHit } from '@vibisual/shared';
import { buildSiteClipboardText, siteHitSummary, siteRelPathFromUrl } from './inspectorSite.js';

/**
 * §5.5 #17-27 ⑮ (i) — 미리보기 페이지에서 Alt 로 집은 요소가 **어느 파일 몇 줄인지**.
 *
 * 이 조립이 어긋나면 증상이 고약하다: 위치가 그럴듯하게 붙어 오지만 가리키는 곳이 틀리고,
 * 받은 쪽은 그 줄을 믿고 고치기 시작한다. 없는 위치보다 **틀린 위치**가 나쁘다.
 */

const ROOT = 'C:/work/AIProjects/vibisual';

function hit(over: Partial<WorkspaceSiteInspectHit> = {}): WorkspaceSiteInspectHit {
  return {
    rect: { x: 10, y: 20, width: 300, height: 40 },
    tag: 'section',
    id: 'hero',
    cls: 'band dark',
    text: 'See your agents think.',
    attrs: ['id="hero"', 'role="banner"'],
    path: 'body > div.wrap > section#hero',
    at: '412:7',
    atHops: 0,
    hasParent: true,
    ...over,
  };
}

describe('siteRelPathFromUrl — 페이지가 알려 온 주소에서 파일을 뽑는다', () => {
  it('개발 서버 주소(http)', () => {
    const url = `http://localhost:4800${workspaceSiteUrl(ROOT, 'html/Vibisual.dc.html', 1712345678000)}`;
    expect(siteRelPathFromUrl(url)).toBe('html/Vibisual.dc.html');
  });

  it('패키지 앱 주소(vibproxy) — 우리 창과 오리진이 다른 그 자리', () => {
    const url = `vibproxy://proxy${workspaceSiteUrl(ROOT, 'html/Vibisual.dc.html')}`;
    expect(siteRelPathFromUrl(url)).toBe('html/Vibisual.dc.html');
  });

  it('페이지가 링크를 타고 옮겨 갔으면 **그 파일**이 나온다', () => {
    const url = `vibproxy://proxy${workspaceSiteUrl(ROOT, 'html/sub/other.html')}`;
    expect(siteRelPathFromUrl(url)).toBe('html/sub/other.html');
  });

  it('우리 창구 밖(바깥 사이트)·빈 문자열·깨진 주소는 파일이 아니다', () => {
    expect(siteRelPathFromUrl('https://example.com/a.html')).toBeNull();
    expect(siteRelPathFromUrl('')).toBeNull();
    expect(siteRelPathFromUrl('not a url')).toBeNull();
  });
});

describe('buildSiteClipboardText — 첫 줄이 곧 답이다', () => {
  const url = `vibproxy://proxy${workspaceSiteUrl(ROOT, 'html/Vibisual.dc.html')}`;

  it('파일:줄:칸 → 태그 → 글자 → 속성 → 경로 순', () => {
    const out = buildSiteClipboardText(hit(), url).split('\n');
    expect(out[0]).toBe('[Source] html/Vibisual.dc.html:412:7');
    expect(out[1]).toBe('[Tag] <section#hero>');
    expect(out[2]).toBe('[Text] "See your agents think."');
    expect(out[3]).toBe('[Attrs] id="hero" role="banner"');
    expect(out[4]).toBe('[Path] body > div.wrap > section#hero');
    expect(out[5]).toBe('[Hint] Read source file for full context.');
  });

  it('스크립트가 만든 요소는 **조상의 자리**를 주되 몇 단계 위인지 숨기지 않는다', () => {
    const out = buildSiteClipboardText(hit({ at: '88:3', atHops: 2 }), url);
    expect(out).toContain('[Source] html/Vibisual.dc.html:88:3 (ancestor +2 — this element was created at runtime)');
  });

  it('자리를 아무도 모르면 줄 번호를 지어내지 않고 파일만 말한다', () => {
    const out = buildSiteClipboardText(hit({ at: null, atHops: 0 }), url);
    expect(out).toContain('[Page] html/Vibisual.dc.html');
    expect(out).not.toContain('[Source]');
  });

  it('우리 창구 밖 페이지면 주소를 그대로 주고 "소스를 읽어라"는 말하지 않는다', () => {
    const out = buildSiteClipboardText(hit(), 'https://example.com/x.html');
    expect(out).toContain('[Page] https://example.com/x.html');
    expect(out).not.toContain('[Hint]');
  });

  it('없는 칸은 줄 자체를 만들지 않는다(빈 따옴표 ❌)', () => {
    const out = buildSiteClipboardText(hit({ text: '', attrs: [], id: '' }), url);
    expect(out).not.toContain('[Text]');
    expect(out).not.toContain('[Attrs]');
    expect(out).toContain('[Tag] <section>');
  });
});

describe('siteHitSummary — 복사 직후 잠깐 뜨는 한 줄', () => {
  it('id 가 있으면 id, 없으면 클래스 두 개까지', () => {
    expect(siteHitSummary(hit())).toBe('<section#hero>');
    expect(siteHitSummary(hit({ id: '' }))).toBe('<section.band.dark>');
    expect(siteHitSummary(hit({ id: '', cls: '' }))).toBe('<section>');
  });
});
