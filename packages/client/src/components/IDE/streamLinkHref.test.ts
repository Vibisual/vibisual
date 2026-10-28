import { describe, it, expect } from 'vitest';
import { streamUrlTransform, isWebLinkHref, parseLinkHrefCandidate, withLinkLabelLines } from './streamLinkHref.js';

/** §5.5 #17-27 ⑬ (k) 마크다운 링크 목적지: `file:`·`C:\…` 만 살리고 `javascript:` 는 지우기 · 퍼센트 복호 · 웹 주소·메일·앵커는 경로 ❌. */

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
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/check.html', lines: null });
  });

  it('file:/// + 퍼센트 인코딩된 한글 — 사용자가 신고한 바로 그 주소', () => {
    const href =
      'file:///C:/work/proj/Docs/Temp/3%EC%B6%95/%EC%9A%B4%EB%B0%983%EC%B6%95_%ED%9E%8C%ED%8A%B8_%EC%8B%AC%ED%94%8C%EC%B2%B4%ED%81%AC.html';
    expect(parseLinkHrefCandidate(href, ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/3축/운반3축_힌트_심플체크.html', lines: null });
  });

  it('앞 슬래시가 달린 드라이브(`/C:/…`) — 기본 세척이 상대 주소로 보고 흘려보낸 모양', () => {
    expect(parseLinkHrefCandidate('/C:/work/proj/Docs/a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', lines: null });
  });

  it('역슬래시 절대 경로를 그대로 적은 링크', () => {
    expect(parseLinkHrefCandidate('C:\\work\\proj\\Docs\\a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', lines: null });
  });

  it('호스트 없는 축약형 file:/C:/… 도 받는다', () => {
    expect(parseLinkHrefCandidate('file:/C:/work/proj/a.md', ROOT))
      .toEqual({ scope: 'inside', relPath: 'a.md', lines: null });
  });

  it('조각·질의는 파일 이름의 일부가 아니다', () => {
    expect(parseLinkHrefCandidate('Docs/a.html#section-2', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', lines: null });
    expect(parseLinkHrefCandidate('Docs/a.html?v=2', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/a.html', lines: null });
  });

  it('1차 체가 막던 공백·괄호 이름을 링크에서는 살린다 — 명시된 자리이기 때문', () => {
    expect(parseLinkHrefCandidate('Docs/Temp/%EB%B3%B4%EA%B3%A0%EC%84%9C%20(%EC%B5%9C%EC%A2%85).html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/Temp/보고서 (최종).html', lines: null });
  });

  it('깨진 퍼센트 인코딩은 원문 그대로 둔다 — 손잡이가 안 될 뿐 링크는 살아 있다', () => {
    expect(parseLinkHrefCandidate('Docs/%ZZ/a.html', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Docs/%ZZ/a.html', lines: null });
  });
});

describe('parseLinkHrefCandidate — ⑬ (k) ③ 루트 밖은 (d) 규정 그대로', () => {
  it('루트 밖 절대 경로는 outside 로 — 편집창·실행으로 가는 갈래가 없는 쪽이다', () => {
    expect(parseLinkHrefCandidate('file:///D:/other/tree/a.html', ROOT))
      .toEqual({ scope: 'outside', absPath: 'D:/other/tree/a.html', lines: null });
  });

  it('루트 밖 POSIX 절대 경로', () => {
    expect(parseLinkHrefCandidate('file:///etc/hosts', ROOT))
      .toEqual({ scope: 'outside', absPath: '/etc/hosts', lines: null });
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

/** ⑬ (g) ① — 줄 조각(`#L806-L807`)은 버리지 않고 줄 범위로 들고 간다(버리면 첫 줄에서 열린다). */
describe('parseLinkHrefCandidate — ⑬ (g) 줄 조각', () => {
  it('사용자가 누른 바로 그 링크 — `#L806-L807`', () => {
    expect(parseLinkHrefCandidate('Source/P_MPS_GPT/Public/Risk/MPSThreatPhaseAuthoritySubsystem.h#L806-L807', ROOT))
      .toEqual({
        scope: 'inside',
        relPath: 'Source/P_MPS_GPT/Public/Risk/MPSThreatPhaseAuthoritySubsystem.h',
        lines: { start: 806, end: 807 },
      });
  });

  it('한 줄 · 뒤의 L 생략 · 열 표기(버린다)', () => {
    expect(parseLinkHrefCandidate('src/a.ts#L42', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 42, end: 42 } });
    expect(parseLinkHrefCandidate('src/a.ts#L42-51', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 42, end: 51 } });
    expect(parseLinkHrefCandidate('src/a.ts#L42C5-L51C2', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 42, end: 51 } });
  });

  it('질의 뒤에 붙은 조각도 읽는다', () => {
    expect(parseLinkHrefCandidate('src/a.ts?plain=1#L7', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 7, end: 7 } });
  });

  it('file:/// 절대 경로 + 조각', () => {
    expect(parseLinkHrefCandidate('file:///C:/work/proj/src/a.ts#L3-L4', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 3, end: 4 } });
  });

  it('줄이 아닌 조각은 종전대로 버린다', () => {
    expect(parseLinkHrefCandidate('src/a.ts#L0', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: null });
    expect(parseLinkHrefCandidate('src/a.ts#Lfoo', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: null });
    expect(parseLinkHrefCandidate('src/a.ts#42', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: null });
  });

  it('경로 끝의 `:줄` 이 조각보다 먼저다', () => {
    expect(parseLinkHrefCandidate('src/a.ts:10#L42', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/a.ts', lines: { start: 10, end: 10 } });
  });

  it('경로 끝의 범위(`:806-807`)도 링크 목적지에서 읽는다', () => {
    expect(parseLinkHrefCandidate('Source/Risk/X.h:806-807', ROOT))
      .toEqual({ scope: 'inside', relPath: 'Source/Risk/X.h', lines: { start: 806, end: 807 } });
  });
});

/** ⑬ (g) ③ — 목적지에 줄이 없으면 **링크 글자**에서. 이름이 같을 때만 빌린다. */
describe('withLinkLabelLines', () => {
  const target = parseLinkHrefCandidate('Source/Risk/Subsystem.h', ROOT);

  it('글자의 이름이 목적지와 같으면 그 줄을 빌린다', () => {
    expect(withLinkLabelLines(target, 'Subsystem.h:806-807'))
      .toEqual({ scope: 'inside', relPath: 'Source/Risk/Subsystem.h', lines: { start: 806, end: 807 } });
    expect(withLinkLabelLines(target, ' Source/Risk/Subsystem.h:12 '))
      .toEqual({ scope: 'inside', relPath: 'Source/Risk/Subsystem.h', lines: { start: 12, end: 12 } });
  });

  it('이름이 다르면 빌리지 않는다 — 남의 파일 줄로 가지 않게', () => {
    expect(withLinkLabelLines(target, 'Other.h:806')).toBe(target);
  });

  it('목적지에 이미 줄이 있으면 목적지가 이긴다', () => {
    const withFragment = parseLinkHrefCandidate('Source/Risk/Subsystem.h#L5', ROOT);
    expect(withLinkLabelLines(withFragment, 'Subsystem.h:806')).toBe(withFragment);
  });

  it('글자에 줄이 없거나 글자를 모르면 그대로', () => {
    expect(withLinkLabelLines(target, 'Subsystem.h')).toBe(target);
    expect(withLinkLabelLines(target, '검수표')).toBe(target);
    expect(withLinkLabelLines(target, null)).toBe(target);
    expect(withLinkLabelLines(null, 'Subsystem.h:3')).toBeNull();
  });

  it('루트 밖도 같은 규칙이다(여는 곳은 여전히 탐색기 하나 — ⑬ (d))', () => {
    const outside = parseLinkHrefCandidate('D:/x/y.md', ROOT);
    expect(withLinkLabelLines(outside, 'y.md:3'))
      .toEqual({ scope: 'outside', absPath: 'D:/x/y.md', lines: { start: 3, end: 3 } });
  });
});
