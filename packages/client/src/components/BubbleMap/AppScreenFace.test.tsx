import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppScreenFace } from './AppScreenFace.js';

const base = {
  width: 200,
  height: 120,
  glow: '#fff',
  icon: <svg />,
  working: false,
  thumb: null,
  thumbLoading: false,
  emptyText: 'Results appear here',
  workingText: 'Working…',
};

describe('§5.4 #36 (L) — 앱 화면의 작업 중 미리보기 띠', () => {
  it('작업물을 비추면 결과가 아님을 띠로 밝힌다', () => {
    const html = renderToStaticMarkup(
      <AppScreenFace {...base} hasFile workCaption={{ label: 'Work in progress', name: 'c0001.mp4', title: 'ep/chunks/c0001.mp4' }} />,
    );
    expect(html).toContain('Work in progress');
    expect(html).toContain('c0001.mp4');
    expect(html).toContain('title="ep/chunks/c0001.mp4"');
    expect(html).not.toContain('Results appear here');
  });

  it('진짜 결과에는 띠가 없고, 아무것도 없으면 종전 안내 그대로다', () => {
    expect(renderToStaticMarkup(<AppScreenFace {...base} hasFile />)).not.toContain('Work in progress');
    expect(renderToStaticMarkup(<AppScreenFace {...base} hasFile={false} />)).toContain('Results appear here');
  });
});
