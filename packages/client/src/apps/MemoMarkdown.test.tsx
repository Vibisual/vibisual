import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { MemoMarkdown } from './MemoMarkdown.js';

describe('memo plain paragraph rendering', () => {
  it.each(['평범한 메모 한 줄입니다.', 'Hello world 42!', '1. numbered item', '1) item', '**bold**', 'a_b_c', 'https://example.com', 'a@example.com', 'www.example.com', '끝 공백  ', '# 제목', '---', 'a &amp; b', '여러\n줄'])('preserves Markdown output for %s', text => {
    const expected = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], children: text }));
    const actual = renderToStaticMarkup(createElement(MemoMarkdown, { text }));
    // 링크는 기존 메모 정책대로 span 으로 그리므로 그 밖의 결과를 대조한다.
    if (text.includes('://') || text.includes('@') || text.includes('www.')) {
      expect(actual).toContain('<span'); expect(actual).not.toContain('<a ');
    } else expect(actual.slice(actual.indexOf('>') + 1, -6)).toBe(expected);
  });
});
