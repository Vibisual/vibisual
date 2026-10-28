import { describe, expect, it } from 'vitest';

import { appNodeForm } from './appNodeForm.js';

/** §5.13 (L) — `ref` 만 묶인 노드도 결과 파일 없이 화면이다(명패로 접히면 AI 가 짓는 것을 캔버스에서 볼 길이 없다). */
describe('§5.13 (L) 작업 문서가 묶인 노드의 형태', () => {
  it('ref 가 있으면 줄이 끊기고 파일이 없어도 화면이다', () => {
    expect(appNodeForm({ ref: 'vid-1' })).toBe('screen');
    expect(appNodeForm({ ref: 'vid-1', linkedAgentIds: [] })).toBe('screen');
  });

  it('빈 ref 는 묶이지 않은 것이다', () => {
    expect(appNodeForm({ ref: '' })).toBe('nameplate');
    expect(appNodeForm({})).toBe('nameplate');
  });
});
