import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stripTranscriptMarkdown, stripTranscriptTags } from './transcriptPlainText.js';

/** 비교용 옛 규칙. 짧은 입력에만 쓰고 긴 회귀 입력에는 호출하지 않는다. */
function legacyMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s]*[-*]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^[\s]*[-]{3,}[\s]*$/gm, '')
    .replace(/^\|[-\s|:]+\|$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

describe('transcriptPlainText — 기존 표시 의미 보존', () => {
  it.each([
    '# Title\n**Bold** and `code`\n[link](https://example.test)\n<tag>body</tag>',
    'before\n```ts\nconst a = 1;\n```\nafter',
    '<> <<tag> keep <unfinished',
    '[]([nested](url) [[label](url) [empty]() [unfinished](url',
    'before\n\n  - bullet\n\n  12. numbered\n\n---\n\nafter',
    '|---|---|\n| a | b |\n|---|\nend',
    '\r\n\u2028\u2029  - list\r\n---\u2028end',
    '\n-\n\n1. \n\n--- \n  \nlast',
    'start\n| \n| \n|tail',
  ])('%j', (raw: string) => {
    expect(stripTranscriptMarkdown(raw)).toBe(legacyMarkdown(raw));
    expect(stripTranscriptTags(raw)).toBe(raw.replace(/<[^>]+>/g, ''));
  });

  it('짧은 입력 10,000개에서 원래 정리 결과와 같다', () => {
    const pieces = ['x', '<', '>', '[', ']', '(', ')', '`', '*', '-', '|', ':', '1.', '#', ' ', '\t', '\n', '\r', '\u2028', '한'];
    let seed = 0x1badb002;
    for (let sample = 0; sample < 10_000; sample += 1) {
      let raw = '';
      for (let j = 0; j < 40; j += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        raw += pieces[seed % pieces.length];
      }
      expect(stripTranscriptMarkdown(raw), JSON.stringify(raw)).toBe(legacyMarkdown(raw));
      expect(stripTranscriptTags(raw), JSON.stringify(raw)).toBe(raw.replace(/<[^>]+>/g, ''));
    }
  });
});

describe('transcriptPlainText — 긴 미완성 구분자', () => {
  it('XML·링크·빈 줄·테이블 모양도 한 번씩 처리한다', () => {
    // 회귀가 생겨도 시험 러너의 타이머를 붙들지 않게 별도 프로세스에 10초 상한을 둔다.
    const moduleUrl = new URL('./transcriptPlainText.ts', import.meta.url).href;
    const script = String.raw`
      import { stripTranscriptMarkdown, stripTranscriptTags } from ${JSON.stringify(moduleUrl)};
      import assert from 'node:assert/strict';
      const size = 256 * 1024;
      for (const prefix of ['<'.repeat(size), '['.repeat(size), '[x]('.repeat(size / 4)]) {
        assert.equal(stripTranscriptMarkdown(prefix + 'tail'), prefix + 'tail');
      }
      assert.equal(stripTranscriptTags('<'.repeat(size)), '<'.repeat(size));
      assert.equal(stripTranscriptMarkdown('\n'.repeat(size) + 'tail'), 'tail');
      assert.equal(stripTranscriptMarkdown('| \n'.repeat(size / 4) + 'tail'), 'tail');
      process.stdout.write('ok');
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('ok');
  });
});
