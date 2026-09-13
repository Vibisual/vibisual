/**
 * §5.5 #17-12 ③-4 — **답 없는 턴이 앞 턴의 답을 물려받지 않는다.**
 *
 * 회귀의 모양(2026-09-08 18:52 실측): 턴 경계 압축이 얹은 `/compact` 턴은 스트림 이벤트가
 * `compact_boundary`·`command_received` 두 줄뿐이고 트랜스크립트에 붙는 assistant 줄이 0 인데,
 * 마감의 복구 폴백이 "마지막 user 이후의 assistant"를 읽어 **직전 답**을 그 턴의 결과로 저장했다.
 * 화면은 저장된 결과를 그 말풍선의 답으로 그리므로(③-3) 자동 압축 직후 같은 말이 두 번 읽혔다.
 */

import { describe, it, expect } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { isAnswerlessTurnText, resolveTurnResult, repairAnswerlessTurnResults } from './turnResult.js';

describe('isAnswerlessTurnText — 제 답이 없는 턴만 고른다', () => {
  it('압축·비우기는 답 없는 턴이다(인자·대문자·공백 무관)', () => {
    expect(isAnswerlessTurnText('/compact')).toBe(true);
    expect(isAnswerlessTurnText('  /compact  ')).toBe(true);
    expect(isAnswerlessTurnText('/COMPACT')).toBe(true);
    expect(isAnswerlessTurnText('/compact 앞 맥락은 버려도 된다')).toBe(true);
    expect(isAnswerlessTurnText('/clear')).toBe(true);
  });

  it('답을 내는 명령·평문은 아니다 — 넓히면 그 답이 통째로 버려진다', () => {
    expect(isAnswerlessTurnText('/verify')).toBe(false);
    expect(isAnswerlessTurnText('/vibisual-qa 훑어 봐')).toBe(false);
    expect(isAnswerlessTurnText('진행하고 보고해')).toBe(false);
    expect(isAnswerlessTurnText('/compaction-watch')).toBe(false);
    expect(isAnswerlessTurnText('compact')).toBe(false);
  });
});

describe('resolveTurnResult — 이 턴이 남길 답', () => {
  const TURN_START = 1_788_861_174_796;

  it('압축 턴은 되찾은 글이 있어도 결과가 없다 — 그것은 앞 턴의 답이다', () => {
    const got = resolveTurnResult(
      '/compact',
      undefined,
      { text: '검수 카드까지 보냈습니다.', ts: TURN_START - 3_231 },
      TURN_START,
    );
    expect(got).toBeUndefined();
  });

  it('압축 턴은 CLI 가 본문을 신고해도 결과가 없다', () => {
    expect(resolveTurnResult('/compact', '검수 카드까지 보냈습니다.', null, TURN_START)).toBeUndefined();
  });

  it('보통 턴은 CLI 신고분을 그대로 쓴다', () => {
    expect(resolveTurnResult('진행해', '다 했습니다', { text: '옛 답', ts: 1 }, TURN_START)).toBe('다 했습니다');
  });

  it('신고분이 없으면 **이번 턴에 쓰인** 글로 되찾는다', () => {
    const got = resolveTurnResult('진행해', undefined, { text: '이번 턴 답', ts: TURN_START + 500 }, TURN_START);
    expect(got).toBe('이번 턴 답');
  });

  it('턴보다 먼저 쓰인 글은 되찾지 않는다 — 이 한 줄이 중복의 자리였다', () => {
    const got = resolveTurnResult('진행해', undefined, { text: '앞 턴 답', ts: TURN_START - 1 }, TURN_START);
    expect(got).toBeUndefined();
  });

  it('시각이 없는 옛 줄(ts 0)·시작 시각을 모르는 턴은 종전대로 받는다', () => {
    expect(resolveTurnResult('진행해', undefined, { text: '옛 답', ts: 0 }, TURN_START)).toBe('옛 답');
    expect(resolveTurnResult('진행해', undefined, { text: '옛 답', ts: 1 }, undefined)).toBe('옛 답');
  });

  it('되찾을 것이 없으면 결과도 없다', () => {
    expect(resolveTurnResult('진행해', undefined, null, TURN_START)).toBeUndefined();
    expect(resolveTurnResult('진행해', undefined, { text: '', ts: TURN_START + 1 }, TURN_START)).toBeUndefined();
  });
});

describe('repairAnswerlessTurnResults — 이미 저장된 물려받은 답을 걷는다', () => {
  function cmd(id: string, text: string, result?: string): QueuedCommand {
    return { id, text, timestamp: 1, status: 'completed', ...(result === undefined ? {} : { result }) } as QueuedCommand;
  }

  it('압축 말풍선이 들고 있던 앞 턴의 답만 걷는다', () => {
    const list = [
      cmd('c1', '진행하고 보고해', '검수 카드까지 보냈습니다.'),
      cmd('c2', '/compact', '검수 카드까지 보냈습니다.'),
      cmd('c3', '간략 대답해', '아니요, 아직 안 만들었습니다.'),
    ];
    expect(repairAnswerlessTurnResults(list)).toBe(1);
    expect(list[0]!.result).toBe('검수 카드까지 보냈습니다.');
    expect(list[1]!.result).toBeUndefined();
    expect(list[2]!.result).toBe('아니요, 아직 안 만들었습니다.');
  });

  it('상태 표식은 남긴다 — 중지·고아 봉합의 유일한 흔적이다', () => {
    const list = [
      cmd('c1', '/compact', '[Stopped by user]'),
      cmd('c2', '/clear', '[orphaned] 서버 재기동으로 이 명령의 실행 컨텍스트가 끊겨 종료 처리됨.'),
    ];
    expect(repairAnswerlessTurnResults(list)).toBe(0);
    expect(list[0]!.result).toBe('[Stopped by user]');
    expect(list[1]!.result).toContain('[orphaned]');
  });

  it('두 번 돌려도 같다(멱등) · 걷을 것이 없으면 0', () => {
    const list = [cmd('c1', '/compact', '앞 턴 답'), cmd('c2', '평문 명령', '제 답')];
    expect(repairAnswerlessTurnResults(list)).toBe(1);
    expect(repairAnswerlessTurnResults(list)).toBe(0);
    expect(list[1]!.result).toBe('제 답');
  });
});
