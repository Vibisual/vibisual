import { describe, it, expect } from 'vitest';
import { toolPreview, tidyPreviewLine } from './toolPreview.js';

/**
 * §5.5 #17-13 — 접힌 도구 상자에 원본 JSON(`{"command":"cd c:/…`)이 그대로 뜨던 회귀를 못박는다.
 */
describe('toolPreview', () => {
  it('정상 JSON 에서 command 를 뽑고 cd 앞머리를 지운다', () => {
    const input = JSON.stringify({ command: 'cd c:/work/example-project && pnpm build' });
    expect(toolPreview(input)).toBe('pnpm build');
  });

  it('[회귀] JSON 이 깨져도(스트림 절단·heredoc) 원본 JSON 을 그대로 보여주지 않는다', () => {
    const broken = '{"command":"cd c:/work/example-project && python - <<\'PY\'\nprint(1)';
    const out = toolPreview(broken);
    expect(out.startsWith('{')).toBe(false);
    expect(out).toContain('python');
  });

  it('file_path 계열도 뽑는다', () => {
    expect(toolPreview(JSON.stringify({ file_path: 'packages/client/src/App.tsx' }))).toBe('packages/client/src/App.tsx');
    expect(toolPreview(JSON.stringify({ pattern: 'TodoWrite' }))).toBe('TodoWrite');
  });

  it('여러 줄 명령은 한 줄로 접는다', () => {
    const input = JSON.stringify({ command: 'echo a\n\n  echo b' });
    expect(toolPreview(input)).toBe('echo a echo b');
  });

  it('긴 내용은 말줄임', () => {
    const long = 'x'.repeat(200);
    const out = toolPreview(JSON.stringify({ command: long }), 20);
    expect(out).toHaveLength(21); // 20 + 말줄임 기호
    expect(out.endsWith('…')).toBe(true);
  });

  it('빈 입력은 빈 문자열', () => {
    expect(toolPreview(undefined)).toBe('');
    expect(toolPreview('')).toBe('');
  });

  it('JSON 이 아닌 평문은 정리만 해서 보여준다', () => {
    expect(toolPreview('  git   status  ')).toBe('git status');
  });
});

describe('tidyPreviewLine', () => {
  it('cd 가 여러 번 겹쳐도 모두 지운다', () => {
    expect(tidyPreviewLine('cd /a && cd "/b c" && ls')).toBe('ls');
  });

  it('cd 로 시작하지 않으면 건드리지 않는다', () => {
    expect(tidyPreviewLine('ls && cd /a')).toBe('ls && cd /a');
  });
});
