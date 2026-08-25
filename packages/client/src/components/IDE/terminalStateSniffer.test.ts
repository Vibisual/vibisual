import { describe, it, expect } from 'vitest';
import { CMD_BLOCKED_IDLE_MS, CMD_IDLE_MS } from '@vibisual/shared';
import { classifyCmdTerminalTail, TerminalStateTracker } from './terminalStateSniffer.js';

// §4 (CMD 터미널 업그레이드 ①) — 상태 감지기.
//
// 여기서 지키려는 것은 두 가지다.
//  (a) **오탐하지 않는다** — 지나가는 출력 안의 물음표·산문을 "막힘"으로 읽으면 탭 도트가 거짓말한다.
//  (b) **깜빡이지 않는다** — 조용해진 직후의 애매한 구간에서 상태를 흔들면 도트가 초 단위로 튄다.

const ESC = String.fromCharCode(27);

describe('classifyCmdTerminalTail', () => {
  it('예/아니오 확인 프롬프트를 막힘으로 읽는다', () => {
    expect(classifyCmdTerminalTail('Overwrite existing file? (y/n)').blocked).toBe(true);
    expect(classifyCmdTerminalTail('Continue? [Y/n]').blocked).toBe(true);
    expect(classifyCmdTerminalTail('Proceed (yes/no)').blocked).toBe(true);
  });

  it('Claude Code 권한 프롬프트를 막힘으로 읽는다', () => {
    const screen = [
      'Bash(rm -rf build)',
      '',
      'Do you want to proceed?',
    ].join('\n');
    const out = classifyCmdTerminalTail(screen);
    expect(out.blocked).toBe(true);
    expect(out.reason).toBe('Do you want to proceed?');
  });

  it('자격증명 입력 대기를 막힘으로 읽는다', () => {
    expect(classifyCmdTerminalTail('Password:').blocked).toBe(true);
    expect(classifyCmdTerminalTail('Enter API key:').blocked).toBe(true);
  });

  it('ANSI 색·커서 시퀀스가 섞여 있어도 판정한다', () => {
    const colored = `${ESC}[32mDone.${ESC}[0m\n${ESC}[1mContinue? (y/n)${ESC}[0m`;
    expect(classifyCmdTerminalTail(colored).blocked).toBe(true);
  });

  it('평범한 출력은 막힘이 아니다', () => {
    expect(classifyCmdTerminalTail('build finished in 3.2s').blocked).toBe(false);
    expect(classifyCmdTerminalTail('$ ').blocked).toBe(false);
    expect(classifyCmdTerminalTail('').blocked).toBe(false);
  });

  it('꼬리 밖(오래된 줄)의 질문은 줍지 않는다 — 오탐 방지의 핵심', () => {
    const screen = [
      'Do you want to continue?',   // 옛 질문 — 이미 답한 줄
      'yes',
      'installing packages',
      'linking dependencies',
      'writing lockfile',
    ].join('\n');
    expect(classifyCmdTerminalTail(screen).blocked).toBe(false);
  });

  // ── QA 회귀: 오탐이 실제로 사용자를 때렸던 자리 ──────────────────────────
  it('에이전트가 답을 물음표로 끝내는 것은 막힘이 아니다 — idle 이다', () => {
    // 종전의 맨 물음표 규칙(/\?\s*$/)은 **매 턴 끝마다** 앰버 링과 OS 알림을 띄웠다.
    // herdr 정의상 "다음 프롬프트를 받을 준비"는 idle 이고 blocked 는 멈춰 선 상태다.
    expect(classifyCmdTerminalTail('이 방식으로 진행하면 될까요?').blocked).toBe(false);
    expect(classifyCmdTerminalTail('무엇을 더 도와드릴까요?').blocked).toBe(false);
    expect(classifyCmdTerminalTail('Shall I go ahead and refactor the whole module for you?').blocked).toBe(false);
  });

  it('무엇을 고를지 묻는 CLI 질문형은 여전히 막힘으로 읽는다', () => {
    expect(classifyCmdTerminalTail('Which file do you want to edit?').blocked).toBe(true);
    expect(classifyCmdTerminalTail('Select a template?').blocked).toBe(true);
    expect(classifyCmdTerminalTail('브랜치를 선택하세요:').blocked).toBe(true);
  });

  it('번호 선택지가 떠 있으면 막힘 — 단, 로그 속 번호 한 줄은 아니다', () => {
    expect(classifyCmdTerminalTail('❯ 1. Yes\n  2. No, tell Claude what to do differently').blocked).toBe(true);
    expect(classifyCmdTerminalTail('1) install\n2) skip').blocked).toBe(true);
    // 빌드 로그가 우연히 번호로 끝나는 경우는 줍지 않는다.
    expect(classifyCmdTerminalTail('Suites run: 4\n1) auth.spec.ts passed').blocked).toBe(false);
  });

  it('근거 문자열은 마지막 줄 한 줄이다', () => {
    const out = classifyCmdTerminalTail('preparing\nApply this change? (y/n)');
    expect(out.reason).toBe('Apply this change? (y/n)');
  });
});

describe('TerminalStateTracker', () => {
  it('바이트가 흐르면 working 을 한 번 신고한다', () => {
    const t0 = 1_000_000;
    const tr = new TerminalStateTracker(t0);
    tr.feed('compiling...', t0 + 10);
    expect(tr.poll(t0 + 20)).toEqual({ state: 'working' });
    // 같은 상태는 다시 신고하지 않는다(신호 스팸 방지).
    expect(tr.poll(t0 + 30)).toBeNull();
  });

  it('조용해지고 꼬리가 프롬프트면 blocked 로 전이한다', () => {
    const t0 = 2_000_000;
    const tr = new TerminalStateTracker(t0);
    tr.feed('Do you want to proceed? (y/n)', t0);
    tr.poll(t0 + 10); // working
    const out = tr.poll(t0 + CMD_BLOCKED_IDLE_MS + 1);
    expect(out?.state).toBe('blocked');
    expect(out?.reason).toContain('Do you want to proceed?');
  });

  it('막힌 뒤 사용자가 답해 출력이 다시 흐르면 working 으로 돌아온다', () => {
    const t0 = 3_000_000;
    const tr = new TerminalStateTracker(t0);
    tr.feed('Continue? (y/n)', t0);
    tr.poll(t0 + CMD_BLOCKED_IDLE_MS + 1);
    tr.feed('\nrunning tests', t0 + CMD_BLOCKED_IDLE_MS + 50);
    expect(tr.poll(t0 + CMD_BLOCKED_IDLE_MS + 60)).toEqual({ state: 'working' });
  });

  it('프롬프트가 아닌 채로 오래 조용하면 idle 로 내려간다', () => {
    const t0 = 4_000_000;
    const tr = new TerminalStateTracker(t0);
    tr.feed('build finished', t0);
    tr.poll(t0 + 10);
    // 애매한 구간(조용하지만 idle 이라 하기엔 이른) — 상태를 흔들지 않는다.
    expect(tr.poll(t0 + CMD_BLOCKED_IDLE_MS + 1)).toBeNull();
    expect(tr.poll(t0 + CMD_IDLE_MS + 1)).toEqual({ state: 'idle' });
  });

  it('reset 은 꼬리를 버려 옛 화면으로 막힘을 오판하지 않는다', () => {
    const t0 = 5_000_000;
    const tr = new TerminalStateTracker(t0);
    tr.feed('Continue? (y/n)', t0);
    tr.reset(t0 + 100);
    expect(tr.poll(t0 + 100 + CMD_BLOCKED_IDLE_MS + 1)?.state).not.toBe('blocked');
  });
});
