import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorkspaceSitePath, workspaceSiteUrl } from '@vibisual/shared';
import { toProxyUrl } from './iframeProxyUrl.js';
import { isWorkspaceSiteSrc, workspaceSiteSrc } from './workspaceSite.js';

// 브라우저 전역을 설치하는 transport 부팅은 URL 변환 시험의 대상이 아니다.
vi.mock('../transport/index.js', () => ({ isPackagedDesktop: () => !!window.api }));

afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])('workspace HTML in iframe tabs (packaged=%s)', (packaged) => {
  it.each([
    ['C:\\work\\demo', 'Docs\\크리쳐\\UI 시안.html'],
    ['/Users/dev/demo', 'Docs/Preview.html'], // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    ['/home/dev/demo', 'Docs/preview.xhtml'], // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  ])('keeps the file and its relative assets reachable from %s', (root, relPath) => {
    vi.stubGlobal('window', { api: packaged ? {} : undefined });
    const src = workspaceSiteSrc(root, relPath, 42);
    const rendered = toProxyUrl(src);
    expect(rendered).toBe(src);
    expect(isWorkspaceSiteSrc(src)).toBe(true);
    expect(rendered).not.toContain('/iframe-proxy/');
    const page = new URL(rendered, 'http://localhost:5173');
    expect(parseWorkspaceSitePath(page.pathname)).toEqual({ root, relPath: relPath.replace(/\\/g, '/') });
    expect(page.searchParams.get('v')).toBe('42');
    const css = new URL('./style.css', page);
    expect(parseWorkspaceSitePath(css.pathname)).toEqual({
      root,
      relPath: `${relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')}/style.css`,
    });
  });

  it('routes relative workspace addresses correctly and preserves query/hash', () => {
    vi.stubGlobal('window', { api: packaged ? {} : undefined });
    const relative = `${workspaceSiteUrl('/work/project', 'index.html')}?tab=2#preview`;
    expect(toProxyUrl(relative)).toBe(packaged ? `vibproxy://proxy${relative}` : relative);
  });

  it('continues proxying running HTTP servers', () => {
    vi.stubGlobal('window', { api: packaged ? {} : undefined });
    const path = '/iframe-proxy/localhost:3000/page?x=1';
    expect(toProxyUrl('http://localhost:3000/page?x=1')).toBe(packaged ? `vibproxy://proxy${path}` : path);
  });
});

it('only recognizes the local workspace routes', () => {
  expect(isWorkspaceSiteSrc('http://example.com/api/workspace-site/root/index.html')).toBe(false);
  expect(isWorkspaceSiteSrc('vibproxy://other/api/workspace-site/root/index.html')).toBe(false);
  expect(isWorkspaceSiteSrc('/api/workspace-site-other/root/index.html')).toBe(false);
});
