/**
 * §5.5 #17-2 (판올림 번호 발급 대기) — **슬래시 명령이 앞말에 가리지 않고 CLI 에 닿는가.**
 *
 * 이 자리는 화면으로 확인할 수 없다. 앞말이 한 줄만 붙어도 CLI 는 `/compact` 를 명령이 아니라
 * 평문으로 보고 모델에게 넘기는데, 그때도 **모델이 그럴듯하게 답하기 때문에** 실패가 성공처럼 보인다
 * (실측: 맨 앞 `/context` = turns 0 · $0 / 한 줄 앞선 같은 본문 = turns 1 · $0.0125).
 *
 * 그래서 두 가지를 못 박는다 — ① 슬래시 본문은 **원문 그대로** 나간다(앞말·`Task:`·첨부 suffix ❌),
 * ② 슬래시가 아니면 종전 조립과 **바이트 단위로 같다**(이 모듈을 끼운 것만으로 기존 턴이 달라지면 안 된다).
 */
import { describe, it, expect } from 'vitest';
import { isSlashCommandText, composeTurnPrompt } from './turnPrompt.js';

const SUMMARY = 'You are a sub-agent working in project at: C:/x\nParent agent: 테스터\n\nExecute the following task.';
const PREAMBLE = '# 의도 먼저 말하기\n지금 할 일을 먼저 말하라.';

describe('isSlashCommandText — 무엇을 명령으로 볼 것인가', () => {
  it('내장 명령·스킬은 명령이다', () => {
    expect(isSlashCommandText('/compact')).toBe(true);
    expect(isSlashCommandText('/clear')).toBe(true);
    expect(isSlashCommandText('/context')).toBe(true);
    expect(isSlashCommandText('/vibisual-feature')).toBe(true);
    expect(isSlashCommandText('/plugin:skill')).toBe(true);
  });

  it('이름 안에 `/` 가 든 디렉토리 스코프 스킬은 일부러 제외한다 — 경로 오인이 더 비싸다', () => {
    // `/apps/web:deploy` 를 살리려고 이름에 `/` 를 허용하면 `/usr/bin/claude …` 같은 평범한 본문이
    // 명령으로 오인돼 **그 턴의 앞말이 통째로 사라진다**. 놓친 쪽은 종전 경로로 그대로 돌아가므로
    // (앞말이 붙은 평문 = 지금까지의 동작) 손해가 없고, 오인은 즉시 회귀가 된다.
    expect(isSlashCommandText('/apps/web:deploy')).toBe(false);
  });

  it('인자가 붙어도 명령이다 — 판정은 첫 토큰 하나로만 한다', () => {
    expect(isSlashCommandText('/compact 대화를 짧게 요약해라')).toBe(true);
    expect(isSlashCommandText('/model claude-opus-5')).toBe(true);
    expect(isSlashCommandText('/vibisual-feature 새 기능\n두 번째 줄')).toBe(true);
  });

  it('앞뒤 공백은 무시한다 — 사용자가 친 그대로 와도 명령이다', () => {
    expect(isSlashCommandText('  /compact  ')).toBe(true);
    expect(isSlashCommandText('\n/clear\n')).toBe(true);
  });

  it('경로·산문은 명령이 아니다 — 오인하면 그 턴의 앞말이 통째로 사라진다', () => {
    expect(isSlashCommandText('/usr/bin/claude 를 봐 줘')).toBe(false);
    expect(isSlashCommandText('/ 로 시작하는 문장')).toBe(false);
    expect(isSlashCommandText('/')).toBe(false);
    expect(isSlashCommandText('//주석처럼 보이는 줄')).toBe(false);
    expect(isSlashCommandText('/-dash 로 시작')).toBe(false);
    expect(isSlashCommandText('이 버튼 오류를 고쳐 줘')).toBe(false);
    expect(isSlashCommandText('')).toBe(false);
    expect(isSlashCommandText('   ')).toBe(false);
  });

  it('본문 중간의 슬래시는 명령이 아니다', () => {
    expect(isSlashCommandText('먼저 /compact 를 눌러 줘')).toBe(false);
  });
});

describe('composeTurnPrompt — 슬래시 본문은 원문 그대로 나간다', () => {
  it('이어지는 턴: 앞말이 있어도 명령만 나간다', () => {
    const r = composeTurnPrompt({
      text: '/compact', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('/compact');
    expect(r.slashPassthrough).toBe(true);
    expect(r.deferContextSummary).toBe(false);
  });

  it('첫 스폰: `Task:` 로 감싸지 않고, 브리핑은 다음 턴으로 미룬다', () => {
    const r = composeTurnPrompt({
      text: '/context', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: false,
    });
    expect(r.prompt).toBe('/context');
    expect(r.prompt).not.toContain('Task:');
    expect(r.slashPassthrough).toBe(true);
    expect(r.deferContextSummary).toBe(true);
    expect(r.contextSummaryDelivered).toBe(false);
  });

  it('첨부 경로도 붙이지 않는다 — 인자로 섞이면 명령이 달라진다', () => {
    const r = composeTurnPrompt({
      text: '/compact', attachments: ['C:/tmp/a.png'], preamble: PREAMBLE,
      contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('/compact');
  });

  it('앞뒤 공백은 떼고 보낸다 — 앞의 개행 한 칸에도 CLI 가 명령을 놓친다', () => {
    const r = composeTurnPrompt({
      text: '\n  /clear  \n', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('/clear');
  });

  it('인자는 그대로 함께 간다', () => {
    const r = composeTurnPrompt({
      text: '/compact 핵심 결정만 남겨라', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('/compact 핵심 결정만 남겨라');
  });

  it('미뤄 둔 브리핑이 있어도 슬래시 턴은 계속 미룬다', () => {
    const r = composeTurnPrompt({
      text: '/usage', preamble: PREAMBLE, contextSummary: SUMMARY,
      hasSession: true, carryContextSummary: true,
    });
    expect(r.prompt).toBe('/usage');
    expect(r.deferContextSummary).toBe(true);
    expect(r.contextSummaryDelivered).toBe(false);
  });
});

describe('composeTurnPrompt — 슬래시가 아니면 종전 조립 그대로', () => {
  it('이어지는 턴 = 앞말 + 구분선 + 본문', () => {
    const r = composeTurnPrompt({
      text: '이 버튼을 고쳐 줘', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe(`${PREAMBLE}\n\n---\n\n이 버튼을 고쳐 줘`);
    expect(r.slashPassthrough).toBe(false);
    expect(r.contextSummaryDelivered).toBe(false);
  });

  it('앞말이 비면 구분선도 없다 — 본문만 나간다', () => {
    const r = composeTurnPrompt({
      text: '이 버튼을 고쳐 줘', preamble: '   ', contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('이 버튼을 고쳐 줘');
  });

  it('첫 스폰 = 브리핑 + 구분선 + `Task: ` + 본문', () => {
    const r = composeTurnPrompt({
      text: '이 버튼을 고쳐 줘', preamble: PREAMBLE, contextSummary: SUMMARY, hasSession: false,
    });
    expect(r.prompt).toBe(`${SUMMARY}\n\n---\n\nTask: 이 버튼을 고쳐 줘`);
    expect(r.contextSummaryDelivered).toBe(true);
    expect(r.deferContextSummary).toBe(false);
  });

  it('첨부 경로는 본문 말미에 개행으로 붙는다', () => {
    const r = composeTurnPrompt({
      text: '이 이미지를 봐 줘', attachments: ['C:/tmp/a.png', 'C:/tmp/b.png'],
      preamble: '', contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('이 이미지를 봐 줘\n\nC:/tmp/a.png\nC:/tmp/b.png');
  });

  it('미뤄 둔 브리핑은 다음 비슬래시 턴에 실린다 — 세션이 브리핑을 잃지 않는다', () => {
    const r = composeTurnPrompt({
      text: '이제 시작해 줘', preamble: PREAMBLE, contextSummary: SUMMARY,
      hasSession: true, carryContextSummary: true,
    });
    expect(r.prompt).toBe(`${SUMMARY}\n\n---\n\nTask: 이제 시작해 줘`);
    expect(r.contextSummaryDelivered).toBe(true);
    expect(r.deferContextSummary).toBe(false);
  });

  it('본문은 trim 하지 않는다 — 종전 조립이 그랬듯 사용자가 친 그대로 간다', () => {
    const r = composeTurnPrompt({
      text: '  들여쓴 본문  ', preamble: '', contextSummary: SUMMARY, hasSession: true,
    });
    expect(r.prompt).toBe('  들여쓴 본문  ');
  });
});
