import { describe, it, expect } from 'vitest';
import { streamUrlTransform, isWebLinkHref, parseLinkHrefCandidate } from './streamLinkHref.js';

/**
 * §5.5 #17-27 ⑬ (k) — 본문 **마크다운 링크**의 목적지 판정.
 *
 * 여기서 잡고 싶은 사고는 넷이다.
 *  ⓐ 세척이 `file:`·`C:\…` 를 지워 **앵커조차 서지 않는 것** — 사용자가 본 바로 그 고장이다.
 *  ⓑ 낯선 스킴(`javascript:`)이 세척을 **함께 통과하는 것** — 살리는 것은 그 둘뿐이어야 한다.
 *  ⓒ 퍼센트로 인코딩된 한글·공백 이름이 복호되지 않아 **디스크에 없는 경로**가 되는 것.
 *  ⓓ 웹 주소·메일·문서 안 앵커가 경로로 읽혀 엉뚱한 파일 판정을 부르는 것.
 */

const ROOT = 'C:/work/proj';

describe('streamUrlTransform — ⑬ (k) ① 목적지를 살려 둔다', () => {
  it('file: 주소를 지우지 않는다 — 종전엔 빈 문자열이 되어 링크조차 서지 않았다', () => {
    const url = 'file:///C:/work/docs/check.html';
    expect(streamUrlTransform(url)).toBe(url);
  });

  it('드라이브로 시작하는 경로를 지우지 않는다(역슬래시·슬래시 둘 다)', () => {
    expect(streamUrlTransform('C:\\work\\docs\\check.html')).toBe('C:\\work\\docs\\check.html');
    expect(streamUrlTransform('D:/repo/README.md')).toBe('D:/repo/README.md');
  });

  it('웹 주소·상대 경로는 기본 세척 그대로 통과한다', () => {
    expect(streamUrlTransform('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(streamUrlTransform('docs/README.md')).toBe('docs/README.md');
    expect(streamUrlTransform('/C:/work/docs/check.html')).toBe('/C:/work/docs/check.html');
  });

  it('위험한 스킴은 **여전히** 지운다 — 살리는 것은 file 과 드라이브 둘뿐이다', () => {
    expect(streamUrlTransform('javascript:alert(1)')).toBe('');
    expect(streamUrlTransform('JAVASCRIPT:alert(1)')).toBe('');
    expect(streamUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(streamUrlTransform('vbscript:msgbox')).toBe('');
  });
});

describe('isWebLinkHref', () => {
  it('http(s) 만 웹이다', () => {
    expect(isWebLinkHref('http://localhost:8080/')).toBe(true);
    expect(isWebLinkHref('https://example.com')).toBe(true);
    expect(isWebLinkHref('  https://example.com  ')).toBe(true);
  });

  it('파일·상대 경로·메일은 웹이 아니다', () => {
    expect(isWebLinkHref('file:///C:/a.html')).toBe(false);
    expect(isWebLinkHref('docs/README.md')).toBe(false);
    expect(isWebLinkHref('mailto:a@b.c')).toBe(false);
  });
});

describe('parseLinkHrefCandidate — ⑬ (k) ② 루트 안', () => {
  it('상대 경로 링크', () => {
    expect(parseLinkHrefCandidate('Docs/Temp/check.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/check.html', line: null });
  });

  it('file:/// + 퍼센트 인코딩된 한글 — 사용자가 신고한 바로 그 주소', () => {
    const href =
      'file:///C:/work/proj/Docs/Temp/3%EC%B6%95/%EC%9A%B4%EB%B0%983%EC%B6%95_%ED%9E%8C%ED%8A%B8_%EC%8B%AC%ED%94%8C%EC%B2%B4%ED%81%AC.html';
    expect(parseLinkHrefCandidate(href, ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/3축/운반3축_힌트_심플체크.html', line: null });
  });

  it('앞 슬래시가 달린 드라이브(`/C:/…`) — 기본 세척이 상대 주소로 보고 흘려보낸 모양', () => {
    expect(parseLinkHrefCandidate('/C:/work/proj/Docs/a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', line: null });
  });

  it('역슬래시 절대 경로를 그대로 적은 링크', () => {
    expect(parseLinkHrefCandidate('C:\\work\\proj\\Docs\\a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', line: null });
  });

  it('호스트 없는 축약형 file:/C:/… 도 받는다', () => {
    expect(parseLinkHrefCandidate('file:/C:/work/proj/a.md', ROOT))
      .toEqual({ scope: 'inside', relPath: 'a.md', line: null });
  });

  it('조각·질의는 파일 이름의 일부가 아니다', () => {
    expect(parseLinkHrefCandidate('Docs/a.html#section-2', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', line: null });
    expect(parseLinkHrefCandidate('Docs/a.html?v=2', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', line: null });
  });

  it('1차 체가 막던 공백·괄호 이름을 링크에서는 살린다 — 명시된 자리이기 때문', () => {
    expect(parseLinkHrefCandidate('Docs/Temp/%EB%B3%B4%EA%B3%A0%EC%84%9C%20(%EC%B5%9C%EC%A2%85).html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/보고서 (최종).html', line: null });
  });

  it('깨진 퍼센트 인코딩은 원문 그대로 둔다 — 손잡이가 안 될 뿐 링크는 살아 있다', () => {
    expect(parseLinkHrefCandidate('Docs/%ZZ/a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/%ZZ/a.html', line: null });
  });
});

describe('parseLinkHrefCandidate — ⑬ (k) ③ 루트 밖은 (d) 규정 그대로', () => {
  it('루트 밖 절대 경로는 outside 로 — 편집창·실행으로 가는 갈래가 없는 쪽이다', () => {
    expect(parseLinkHrefCandidate('file:///D:/other/tree/a.html', ROOT))
      .toEqual({ scope: 'outside', absPath: 'D:/other/tree/a.html', line: null });
  });

  it('루트 밖 POSIX 절대 경로', () => {
    expect(parseLinkHrefCandidate('file:///etc/hosts', ROOT))
      .toEqual({ scope: 'outside', absPath: '/etc/hosts', line: null });
  });
});

describe('parseLinkHrefCandidate — 경로가 아닌 주소', () => {
  it('웹 주소·메일·낯선 스킴', () => {
    expect(parseLinkHrefCandidate('https://example.com/a.html', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('http://localhost:8080/', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('mailto:a@b.c', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('vscode://file/C:/a.ts', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('javascript:alert(1)', ROOT)).toBeNull();
  });

  it('문서 안 앵커는 디스크의 위치가 아니다', () => {
    expect(parseLinkHrefCandidate('#설치', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('#', ROOT)).toBeNull();
  });

  it('빈 주소·프로젝트를 아직 모를 때', () => {
    expect(parseLinkHrefCandidate('', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('   ', ROOT)).toBeNull();
    expect(parseLinkHrefCandidate('Docs/a.html', null)).toBeNull();
  });

  it('상한을 넘는 긴 주소는 본문이지 위치가 아니다', () => {
    expect(parseLinkHrefCandidate(`Docs/${'a'.repeat(1100)}.html`, ROOT)).toBeNull();
  });

  it('상위로 거슬러 오르는 표기는 링크에서도 끊는다', () => {
    expect(parseLinkHrefCandidate('../../etc/passwd', ROOT)).toBeNull();
  });
});
