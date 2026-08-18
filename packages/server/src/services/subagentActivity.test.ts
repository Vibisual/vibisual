import { describe, it, expect } from 'vitest';
import { describeToolTarget, extractTaskResultText, SUBAGENT_RESULT_MAX } from './subagentActivity.js';

/**
 * §5.5 #17-9 ⑦ — 자식 활동 한 줄 · 결과 본문 추출의 회귀.
 *
 * 이 두 함수가 하는 일은 **판본마다 흔들리는 페이로드 모양을 흡수하는 것**이다. 그래서 고정하는 약속은
 * "무엇을 뽑는가"가 아니라 "못 읽으면 조용히 비운다"에 가깝다 — 못 읽은 것을 JSON 덩어리로 화면에
 * 뱉으면 좁은 카드가 통째로 쓰레기가 된다.
 */

describe('describeToolTarget — 자식이 지금 무엇에 대고 도구를 쓰는가', () => {
  it('Bash 는 명령을 그대로 보여준다', () => {
    expect(describeToolTarget('Bash', { command: 'pnpm test', description: 'Run tests' })).toBe('pnpm test');
  });

  it('파일 도구는 경로 꼬리 두 토막만 남긴다(좁은 카드에서 파일 이름이 밀리지 않게)', () => {
    expect(describeToolTarget('Read', { file_path: '/home/me/proj/packages/server/index.ts' })) // privacy-ok — 자리표시 경로
      .toBe('server/index.ts');
    expect(describeToolTarget('Edit', { file_path: 'C:\\work\\app\\src\\main.tsx' })).toBe('src/main.tsx');
  });

  it('Grep 은 패턴과 대상 폴더를 함께 적는다', () => {
    expect(describeToolTarget('Grep', { pattern: 'TODO', path: '/a/b/c' })).toBe('TODO — b/c');
    expect(describeToolTarget('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('모르는 도구는 눈에 익은 인자를 순서대로 훑는다', () => {
    expect(describeToolTarget('SomeNewTool', { url: 'https://example.com/x' })).toBe('https://example.com/x');
    expect(describeToolTarget('SomeNewTool', { nothing: 1 })).toBeUndefined();
  });

  it('여러 줄·긴 명령은 한 줄로 접고 잘라낸다', () => {
    const out = describeToolTarget('Bash', { command: `echo a\n  echo b` });
    expect(out).toBe('echo a echo b');
    const long = describeToolTarget('Bash', { command: 'x'.repeat(500) });
    expect(long?.length).toBe(120);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('인자가 없으면 아무 말도 하지 않는다', () => {
    expect(describeToolTarget('Bash', undefined)).toBeUndefined();
    expect(describeToolTarget('Bash', 'not an object')).toBeUndefined();
  });
});

describe('extractTaskResultText — 부모가 받아 든 자식의 최종 보고', () => {
  it('문자열 응답을 그대로 읽는다', () => {
    expect(extractTaskResultText('  done  ')).toBe('done');
  });

  it('블록 배열(content[].text)을 이어 붙인다', () => {
    expect(extractTaskResultText({ content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }))
      .toBe('A\nB');
  });

  it('content 가 문자열인 판본도 읽는다', () => {
    expect(extractTaskResultText({ content: 'hello' })).toBe('hello');
  });

  it('상한을 넘으면 잘라내고 말줄임을 붙인다', () => {
    const out = extractTaskResultText('y'.repeat(SUBAGENT_RESULT_MAX + 500));
    expect(out?.length).toBe(SUBAGENT_RESULT_MAX);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('못 읽는 모양은 비워 둔다 — JSON 덩어리를 화면에 뱉지 않는다', () => {
    expect(extractTaskResultText(undefined)).toBeUndefined();
    expect(extractTaskResultText({ weird: { nested: 1 } })).toBeUndefined();
    expect(extractTaskResultText('   ')).toBeUndefined();
  });
});
