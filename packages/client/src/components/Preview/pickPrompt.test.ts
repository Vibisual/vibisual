import { describe, it, expect } from 'vitest';
import type { PreviewPickPayload } from '@vibisual/shared';

import { buildPickPrompt, describePickedElement } from './pickPrompt.js';

function pick(over: Partial<PreviewPickPayload> = {}): PreviewPickPayload {
  return {
    selector: 'main > div.card:nth-of-type(2) > button',
    tagName: 'button',
    classes: ['btn', 'primary'],
    textSnippet: 'Save',
    rect: { x: 10, y: 20, width: 80, height: 32 },
    pageUrl: 'http://127.0.0.1:5173/settings',
    ...over,
  };
}

describe('§7.11 — 프리뷰에서 집은 요소를 명령으로', () => {
  it('사용자 문장이 비면 빈 문자열 — 요소만 보내지 않는다', () => {
    expect(buildPickPrompt(pick(), '   ', 'H')).toBe('');
  });

  it('페이지·요소·선택자·보이는 글·요청을 한 벌로 싣는다', () => {
    const out = buildPickPrompt(pick(), '더 크게 해줘', 'Fix this element.');
    expect(out).toBe(
      'Fix this element.\n' +
      '- page: http://127.0.0.1:5173/settings\n' +
      '- element: button.btn.primary\n' +
      '- selector: main > div.card:nth-of-type(2) > button\n' +
      '- visible text: "Save"\n' +
      'request: 더 크게 해줘',
    );
  });

  it('보이는 글이 없으면 그 줄을 넣지 않는다', () => {
    const out = buildPickPrompt(pick({ textSnippet: '' }), 'x', 'H');
    expect(out).not.toContain('visible text');
  });

  it('id·testId 가 있으면 요소 이름에 함께 적는다 — 코드에서 찾기 쉬운 순서', () => {
    expect(describePickedElement(pick({ id: 'save', testId: 'save-btn' })))
      .toBe('button#save.btn.primary[data-testid=save-btn]');
  });

  it('클래스가 많아도 요소 이름은 3개까지만 — 줄이 길어지면 못 읽는다', () => {
    expect(describePickedElement(pick({ classes: ['a', 'b', 'c', 'd', 'e'] })))
      .toBe('button.a.b.c');
  });

  it('라벨은 화면에서 번역해 넣을 수 있다', () => {
    const out = buildPickPrompt(pick(), '고쳐줘', '아래 요소를 고쳐줘.', {
      page: '페이지', element: '요소', selector: '선택자', text: '보이는 글', request: '요청',
    });
    expect(out).toContain('- 페이지: http://127.0.0.1:5173/settings');
    expect(out).toContain('요청: 고쳐줘');
  });

  it('사용자 문장 앞뒤 공백은 다듬는다', () => {
    expect(buildPickPrompt(pick(), '  줄여줘  ', 'H')).toContain('request: 줄여줘');
  });
});
