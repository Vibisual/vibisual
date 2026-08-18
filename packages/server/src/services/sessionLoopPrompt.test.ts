import { describe, it, expect } from 'vitest';
import { composeLoopRoundText } from './sessionLoopPrompt.js';

/**
 * §5.5 #17-11 ⑫(g) — 회차 프롬프트 합성 회귀 테스트.
 *
 * 여기서 조용히 깨지면 사용자가 친 명령이 매 회차 다른 모양으로 나간다. 지켜야 하는 것은 둘:
 * ① 옵션 0 이면 **원문 그대로**(기존 루프와 바이트 동일), ② 켠 규약만 항상 같은 순서로 붙는다.
 */
describe('composeLoopRoundText — 루프 회차 프롬프트 합성', () => {
  it('아무 규약도 켜지 않으면 원문을 한 글자도 건드리지 않는다', () => {
    const text = 'run the tests and fix what fails';
    expect(composeLoopRoundText({ command: text, round: 3, total: 10 })).toBe(text);
  });

  it('빈 값·false 만 들어와도 원문 그대로다(옵션 유무 판정이 느슨하지 않은지)', () => {
    const text = '테스트를 돌려 주세요';
    expect(composeLoopRoundText({
      command: text, round: 1, progressFile: '', oneTaskPerRound: false, commitEachRound: false,
    })).toBe(text);
  });

  it('한 가지 일 규칙은 맨 위와 규칙란 양쪽에 들어간다', () => {
    const out = composeLoopRoundText({ command: '본문', round: 2, total: 5, oneTaskPerRound: true });
    const head = out.split('\n\n')[0]!;
    expect(head).toContain('한 가지');
    expect(head).toContain('2/5');
    // 규칙란에도 다시 — 한 번만 적으면 지켜지지 않는다는 것이 이 옵션의 존재 이유다.
    expect(out.lastIndexOf('한 가지')).toBeGreaterThan(head.length);
    expect(out).toContain('본문');
  });

  it('진행 파일 경로가 규약 문구에 그대로 실린다', () => {
    const out = composeLoopRoundText({ command: '본문', round: 1, progressFile: '.vibisual/loop-progress.md' });
    expect(out).toContain('.vibisual/loop-progress.md');
    expect(out).toContain('반복 실행 규칙');
    // 맨 위 한 줄은 "한 가지 일" 전용 — 진행 파일만 켰으면 본문이 먼저 온다.
    expect(out.startsWith('본문')).toBe(true);
  });

  it('회차 커밋 규약에는 회차 번호가 들어간다(무한 루프면 번호만)', () => {
    const counted = composeLoopRoundText({ command: 'x', round: 7, total: 12, commitEachRound: true });
    expect(counted).toContain('7/12');
    const infinite = composeLoopRoundText({ command: 'x', round: 7, commitEachRound: true });
    expect(infinite).toContain('회차 7');
    expect(infinite).not.toContain('7/');
  });

  it('여러 규약을 켜도 순서가 고정된다 — 한 가지 일 → 진행 파일 → 커밋', () => {
    const out = composeLoopRoundText({
      command: '본문', round: 1, total: 3,
      oneTaskPerRound: true, progressFile: 'PROGRESS.md', commitEachRound: true,
    });
    const iOne = out.lastIndexOf('한 회차에는');
    const iProgress = out.indexOf('PROGRESS.md');
    const iCommit = out.indexOf('커밋해라');
    expect(iOne).toBeGreaterThan(-1);
    expect(iProgress).toBeGreaterThan(iOne);
    expect(iCommit).toBeGreaterThan(iProgress);
    // 본문은 규칙 블록보다 앞에 있어야 한다(규칙이 명령을 밀어내면 안 된다).
    expect(out.indexOf('본문')).toBeLessThan(out.indexOf('반복 실행 규칙'));
  });
});
