import { afterEach, describe, expect, it, vi } from 'vitest';

import { openFileByPath, openWorkspaceFile } from './useWorkspaceExplorer.js';

/** 에디터 열기의 줄 번호 — 주었을 때만 싣는다(주지 않은 호출의 본문은 종전과 글자까지 같다). */
afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(): { bodies: () => unknown[] } {
  const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  return { bodies: () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init?.body ?? '{}')]) };
}

describe('openWorkspaceFile — 줄 번호', () => {
  it('줄을 주면 같은 열기 길에 line 을 싣는다(경로 조립은 종전 그대로 — 역슬래시 루트도 / 로)', () => {
    const net = stubFetch();
    openWorkspaceFile('C:\\work\\demo\\', '.vibisual/video/compositions/intro/index.html', 42);
    expect(net.bodies()).toEqual([['/api/open-node-file', {
      nodePath: '.vibisual/video/compositions/intro/index.html',
      absolutePath: 'C:/work/demo/.vibisual/video/compositions/intro/index.html',
      line: 42,
    }]]);
  });

  it('줄을 주지 않거나 쓸 수 없는 값이면 싣지 않는다', () => {
    const net = stubFetch();
    openWorkspaceFile('/srv/work/demo', 'src/a.ts');
    for (const line of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) openFileByPath('/srv/work/demo/src/a.ts', 'src/a.ts', line);
    for (const [, body] of net.bodies() as [string, Record<string, unknown>][]) {
      expect(body).toEqual({ nodePath: 'src/a.ts', absolutePath: '/srv/work/demo/src/a.ts' });
    }
    expect(net.bodies()).toHaveLength(6);
  });
});
