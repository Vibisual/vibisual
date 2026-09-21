import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IDEPaneHost } from './IDEPaneHost.js';

const state = vi.hoisted(() => ({ keys: ['project/pane-a', 'project/pane-b'] }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (value: unknown) => unknown) => select({}),
  selectIDEPaneRenderOrderKeys: () => state.keys,
}));
vi.mock('./AgentIDEOverlay.js', () => ({ AgentIDEOverlay: () => createElement('div', { 'data-test-pane': true }) }));
vi.mock('./VerifyDemoLayer.js', () => ({ VerifyDemoLayer: () => createElement('div', { 'data-test-recorder': true }) }));
vi.mock('./idePane.js', () => ({ IDEPaneProvider: ({ children }: { children: ReactNode }) => children }));

describe('검증 녹화 호스트 소유', () => {
  it('두 IDE를 그려도 녹화기·소스 선택기·시연 창 층은 하나다', () => {
    state.keys = ['project/pane-a', 'project/pane-b'];
    const html = renderToStaticMarkup(createElement(IDEPaneHost));
    expect(html.match(/data-test-pane/g)).toHaveLength(2);
    expect(html.match(/data-test-recorder/g)).toHaveLength(1);
  });

  it('IDE가 전부 닫히면 녹화 호스트도 남지 않는다', () => {
    state.keys = [];
    expect(renderToStaticMarkup(createElement(IDEPaneHost))).toBe('');
  });
});
