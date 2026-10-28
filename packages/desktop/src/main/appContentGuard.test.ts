import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

import { guardAppContentFrames, isAppContentUrl, shouldBlockAppContentNavigation } from './appContentGuard.js';

/**
 * §5.13 (T-3)(T-11) ③ — 앱 콘텐츠 프레임은 처음 연 문서 밖으로 가지 못한다. CSP 로는 자기 프레임의 이동을 못 막아,
 * 에이전트가 짠 모션 코드가 다른 파일을 띄워 그 글자가 영상에 찍힌다. 판정은 경로 모양뿐(앱 이름 모름) — 모양(vibproxy·http)과 "같은 문서" 판정을 못 박는다.
 */

const CONTENT = 'vibproxy://proxy/api/app/someapp/content/proj/doc-1/.vibisual/video/compositions/intro/index.html?item=c1&v=abc';
const HTTP_CONTENT = 'http://127.0.0.1:3001/api/app/someapp/content/proj/doc-1/a/index.html';

describe('isAppContentUrl — 경로 모양으로만 본다', () => {
  it('vibproxy·http 어느 쪽이든 /api/app/<앱>/content/ 아래면 콘텐츠다', () => {
    expect(isAppContentUrl(CONTENT)).toBe(true);
    expect(isAppContentUrl(HTTP_CONTENT)).toBe(true);
    expect(isAppContentUrl('http://localhost/api/app/a/content/')).toBe(true);
  });

  it('같은 앱의 다른 REST 갈래·대문자 앱 id·너무 긴 앱 id 는 콘텐츠가 아니다', () => {
    expect(isAppContentUrl('http://127.0.0.1:3001/api/app/someapp/doc/x')).toBe(false);
    expect(isAppContentUrl('http://127.0.0.1:3001/api/app/SomeApp/content/p/d/x.html')).toBe(false);
    expect(isAppContentUrl(`http://127.0.0.1:3001/api/app/${'a'.repeat(42)}/content/p/d/x.html`)).toBe(false);
    expect(isAppContentUrl('http://127.0.0.1:3001/api/app-bubbles/x/content/y')).toBe(false);
  });

  it('주소가 아니거나 비었으면 거짓이다(던지지 않는다)', () => {
    expect(isAppContentUrl('')).toBe(false);
    expect(isAppContentUrl('/api/app/someapp/content/p/d/x.html')).toBe(false); // 상대 주소
    expect(isAppContentUrl('about:blank')).toBe(false);
    expect(isAppContentUrl('not a url')).toBe(false);
  });
});

describe('shouldBlockAppContentNavigation — 지금 문서가 콘텐츠면 그 문서 밖으로 못 간다', () => {
  it('같은 문서의 새로고침·해시 이동은 둔다', () => {
    expect(shouldBlockAppContentNavigation(CONTENT, CONTENT)).toBe(false);
    expect(shouldBlockAppContentNavigation(CONTENT, `${CONTENT}#scene-2`)).toBe(false);
  });

  it('다른 파일·바깥 주소·같은 파일의 다른 쿼리는 막는다(주소를 바꾸는 일은 무대가 새 프레임으로 한다)', () => {
    expect(shouldBlockAppContentNavigation(CONTENT, CONTENT.replace('index.html', 'other.html'))).toBe(true);
    expect(shouldBlockAppContentNavigation(CONTENT, 'https://example.com/')).toBe(true);
    expect(shouldBlockAppContentNavigation(CONTENT, CONTENT.replace('v=abc', 'v=def'))).toBe(true);
    expect(shouldBlockAppContentNavigation(HTTP_CONTENT, 'http://127.0.0.1:3001/api/agent-config/x')).toBe(true);
  });

  it('콘텐츠가 아닌 프레임(무대 자신·새로 만든 빈 프레임)은 상관하지 않는다', () => {
    expect(shouldBlockAppContentNavigation('http://localhost:5173/#app=x', 'https://example.com/')).toBe(false);
    expect(shouldBlockAppContentNavigation('', CONTENT)).toBe(false);
    expect(shouldBlockAppContentNavigation('about:blank', CONTENT)).toBe(false);
  });
});

describe('guardAppContentFrames — will-frame-navigate 배선', () => {
  type Handler = (details: unknown) => void;

  function wire(): Handler {
    const seen: { handler?: Handler } = {};
    const contents = {
      on(event: string, fn: Handler): void {
        if (event === 'will-frame-navigate') seen.handler = fn;
      },
    };
    guardAppContentFrames(contents as unknown as WebContents);
    if (!seen.handler) throw new Error('will-frame-navigate 를 듣지 않는다');
    return seen.handler;
  }

  const details = (current: string, next: string, isMainFrame = false) => ({
    isMainFrame,
    url: next,
    frame: { url: current },
    preventDefault: vi.fn(),
  });

  it('콘텐츠 하위 프레임이 문서 밖으로 가려 하면 막는다', () => {
    const d = details(CONTENT, 'https://example.com/');
    wire()(d);
    expect(d.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('새로고침은 두고, 본 프레임(창 자체)의 이동은 보지 않는다', () => {
    const reload = details(CONTENT, CONTENT);
    wire()(reload);
    expect(reload.preventDefault).not.toHaveBeenCalled();
    const main = details(CONTENT, 'https://example.com/', true);
    wire()(main);
    expect(main.preventDefault).not.toHaveBeenCalled();
  });

  it('프레임이 이미 사라졌으면 판정하지 않고 넘어간다(던지지 않는다)', () => {
    const preventDefault = vi.fn();
    const gone = {
      isMainFrame: false,
      url: 'https://example.com/',
      get frame(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed');
      },
      preventDefault,
    };
    expect(() => wire()(gone)).not.toThrow();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
