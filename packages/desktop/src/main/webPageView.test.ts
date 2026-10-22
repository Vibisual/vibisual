import { describe, expect, it, vi } from 'vitest';
import type { WebContents, WebPreferences } from 'electron';
import { WEB_PAGE_PARTITION } from '@vibisual/shared';

import {
  guardWebPageAttach,
  isWebPageGuestSrc,
  sanitizeWebPageGuestPreferences,
  shouldBlockWebPageNavigation,
  type WebPageGuardDeps,
} from './webPageView.js';

/**
 * §5.23 「더블클릭」 — 인터넷 페이지는 격리 웹뷰로만 들어온다.
 *
 * 렌더러가 무엇을 적어 보냈든(`preload`·`nodeintegration`·`partition`·`webpreferences`) main 의 손님 설정이 이긴다 —
 * 그래서 여기서는 ① 받는 주소(http(s) 만) ② 다시 쓴 손님 설정 ③ 붙은 손님의 새 창·이동 잠금을 못 박는다.
 */

describe('isWebPageGuestSrc — 손님으로 띄울 주소는 http(s) 만', () => {
  it('인터넷 페이지와 로컬 http 는 받는다', () => {
    expect(isWebPageGuestSrc('https://rustfoundation.org/')).toBe(true);
    expect(isWebPageGuestSrc('http://example.com/a')).toBe(true);
    expect(isWebPageGuestSrc('http://localhost:5173/')).toBe(true);
  });

  it('다른 스킴·빈 값·문자열이 아닌 값은 받지 않는다', () => {
    expect(isWebPageGuestSrc('file:///C:/Windows/win.ini')).toBe(false);
    expect(isWebPageGuestSrc('vibproxy://proxy/iframe-proxy/localhost:5173/')).toBe(false);
    expect(isWebPageGuestSrc('javascript:alert(1)')).toBe(false);
    expect(isWebPageGuestSrc('about:blank')).toBe(false);
    expect(isWebPageGuestSrc('')).toBe(false);
    expect(isWebPageGuestSrc(undefined)).toBe(false);
    expect(isWebPageGuestSrc(42)).toBe(false);
  });
});

describe('sanitizeWebPageGuestPreferences — 렌더러가 적은 값보다 main 이 이긴다', () => {
  it('위험한 설정을 걷고 격리 세션·샌드박스로 다시 쓴다', () => {
    const prefs = {
      preload: 'C:/evil/preload.js',
      preloadURL: 'file:///C:/evil/preload.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
      plugins: true,
      experimentalFeatures: true,
      enableBlinkFeatures: 'SomethingDangerous',
      navigateOnDragDrop: true,
      partition: 'persist:somewhere-else',
      disablePopups: true,
    } as unknown as WebPreferences;
    sanitizeWebPageGuestPreferences(prefs);
    const out = prefs as Record<string, unknown>;
    expect(out['preload']).toBeUndefined();
    expect(out['preloadURL']).toBeUndefined();
    expect(out['enableBlinkFeatures']).toBeUndefined();
    expect(prefs.partition).toBe(WEB_PAGE_PARTITION);
    expect(prefs.partition?.startsWith('persist:')).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInSubFrames).toBe(false);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.plugins).toBe(false);
    expect(prefs.experimentalFeatures).toBe(false);
    expect(prefs.navigateOnDragDrop).toBe(false);
    // 새 창은 막지 않는다 — 손님의 setWindowOpenHandler 가 바깥 브라우저로 넘긴다(막으면 target=_blank 가 죽는다).
    expect(out['disablePopups']).toBe(false);
  });
});

describe('shouldBlockWebPageNavigation — 손님은 http(s) 밖으로 가지 못한다', () => {
  it('http(s) 안의 이동은 둔다', () => {
    expect(shouldBlockWebPageNavigation('https://docs.rs/serde')).toBe(false);
    expect(shouldBlockWebPageNavigation('http://example.com/')).toBe(false);
  });
  it('파일·내부 스킴·스크립트로는 막는다', () => {
    expect(shouldBlockWebPageNavigation('file:///etc/passwd')).toBe(true);
    expect(shouldBlockWebPageNavigation('vibproxy://proxy/api/workspace-site/x')).toBe(true);
    expect(shouldBlockWebPageNavigation('javascript:void(0)')).toBe(true);
    expect(shouldBlockWebPageNavigation('mailto:someone@example.com')).toBe(true);
  });
});

describe('guardWebPageAttach — 웹뷰가 붙는 두 사건의 배선', () => {
  type Listener = (...args: unknown[]) => void;

  function fakeContents(): { contents: WebContents; emit: (event: string, ...args: unknown[]) => void } {
    const listeners = new Map<string, Listener[]>();
    const contents = {
      on(event: string, fn: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), fn]);
        return contents;
      },
    };
    return {
      contents: contents as unknown as WebContents,
      emit: (event, ...args) => { for (const fn of listeners.get(event) ?? []) fn(...args); },
    };
  }

  function fakeGuest(): {
    guest: WebContents;
    emit: (event: string, ...args: unknown[]) => void;
    openHandler: () => ((details: { url: string }) => { action: string }) | undefined;
  } {
    const listeners = new Map<string, Listener[]>();
    let handler: ((details: { url: string }) => { action: string }) | undefined;
    const guest = {
      on(event: string, fn: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), fn]);
        return guest;
      },
      setWindowOpenHandler(fn: (details: { url: string }) => { action: string }) { handler = fn; },
    };
    return {
      guest: guest as unknown as WebContents,
      emit: (event, ...args) => { for (const fn of listeners.get(event) ?? []) fn(...args); },
      openHandler: () => handler,
    };
  }

  function deps() {
    const prepareSession = vi.fn<WebPageGuardDeps['prepareSession']>();
    const openExternal = vi.fn<WebPageGuardDeps['openExternal']>();
    return { prepareSession, openExternal } satisfies WebPageGuardDeps;
  }

  it('http(s) 가 아닌 주소의 웹뷰는 붙지 못한다(세션도 손님 설정도 건드리지 않는다)', () => {
    const { contents, emit } = fakeContents();
    const d = deps();
    guardWebPageAttach(contents, d);
    const event = { preventDefault: vi.fn() };
    const prefs = { nodeIntegration: true } as WebPreferences;
    emit('will-attach-webview', event, prefs, { src: 'file:///C:/secret.txt' });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(d.prepareSession).not.toHaveBeenCalled();
    expect(prefs.nodeIntegration).toBe(true);
  });

  it('인터넷 페이지 웹뷰는 격리 세션을 준비하고 손님 설정을 다시 쓴 채 붙는다', () => {
    const { contents, emit } = fakeContents();
    const d = deps();
    guardWebPageAttach(contents, d);
    const event = { preventDefault: vi.fn() };
    const prefs = { preload: 'x.js', sandbox: false, partition: 'persist:x' } as WebPreferences;
    emit('will-attach-webview', event, prefs, { src: 'https://rustfoundation.org/', partition: 'persist:x' });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(d.prepareSession).toHaveBeenCalledOnce();
    expect(prefs.partition).toBe(WEB_PAGE_PARTITION);
    expect(prefs.sandbox).toBe(true);
    expect((prefs as Record<string, unknown>)['preload']).toBeUndefined();
  });

  it('붙은 손님의 새 창은 만들지 않고 http(s) 만 바깥 브라우저로 넘긴다', () => {
    const { contents, emit } = fakeContents();
    const d = deps();
    guardWebPageAttach(contents, d);
    const g = fakeGuest();
    emit('did-attach-webview', {}, g.guest);
    const handler = g.openHandler();
    expect(handler).toBeDefined();
    expect(handler!({ url: 'https://example.com/next' })).toEqual({ action: 'deny' });
    expect(d.openExternal).toHaveBeenCalledWith('https://example.com/next', contents);
    expect(handler!({ url: 'mailto:someone@example.com' })).toEqual({ action: 'deny' });
    expect(handler!({ url: 'file:///C:/x' })).toEqual({ action: 'deny' });
    expect(d.openExternal).toHaveBeenCalledTimes(1);
  });

  it('붙은 손님의 최상위 이동·되돌림은 http(s) 밖이면 막는다', () => {
    const { contents, emit } = fakeContents();
    guardWebPageAttach(contents, deps());
    const g = fakeGuest();
    emit('did-attach-webview', {}, g.guest);
    for (const event of ['will-navigate', 'will-redirect']) {
      const blocked = { preventDefault: vi.fn() };
      g.emit(event, blocked, 'file:///C:/Windows/System32/');
      expect(blocked.preventDefault).toHaveBeenCalledOnce();
      const allowed = { preventDefault: vi.fn() };
      g.emit(event, allowed, 'https://docs.rs/');
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    }
  });
});
