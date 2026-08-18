import { describe, it, expect } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { absorbMergeFollowUps } from './followUpMerge.js';

/**
 * §5.5 #17-18 v4.68 — 합치기(merge) 덧말 흡수 회귀 테스트.
 *
 * 핵심 계약 두 가지를 못 박는다:
 *  ① 덧말 N개가 **한 턴**으로 합쳐진다(= 완료 보고 카드 N장 도배가 사라진 이유).
 *  ② 합쳐도 **base 의 id 가 살아남는다** — 루프 회차(`pendingCommandId`)·태스크 엣지(`edgeId`)
 *     완료 매칭이 그 id 를 기다리므로, 새 id 로 갈아치우면 그 대기가 영영 안 풀린다.
 */

let seq = 0;
function cmd(partial: Partial<QueuedCommand> = {}): QueuedCommand {
  seq += 1;
  return {
    id: `cmd-${seq}`,
    text: `t${seq}`,
    timestamp: 1000 + seq,
    subAgentId: 'sub-a',
    status: 'queued',
    dispatchMode: 'merge',
    ...partial,
  };
}

describe('absorbMergeFollowUps', () => {
  it('연속된 합치기 덧말을 한 프롬프트로 합치고 큐에서 제거한다', () => {
    const base = cmd({ text: '첫 지시' });
    const f1 = cmd({ text: '덧말 1' });
    const f2 = cmd({ text: '덧말 2' });
    const queue = [base, f1, f2];

    const absorbed = absorbMergeFollowUps(queue, base);

    expect(absorbed).toEqual([f1, f2]);
    expect(base.text).toBe('첫 지시\n\n덧말 1\n\n덧말 2');
    expect(base.mergedCount).toBe(2);
    expect(queue).toEqual([base]);
  });

  it('합쳐도 base 의 id 는 그대로다 (루프·엣지 완료 매칭 보존)', () => {
    const base = cmd({ id: 'cmd-loop-iteration' });
    const queue = [base, cmd()];

    absorbMergeFollowUps(queue, base);

    expect(base.id).toBe('cmd-loop-iteration');
    expect(queue[0]?.id).toBe('cmd-loop-iteration');
  });

  it('base 가 대기(wait)면 아무것도 흡수하지 않는다', () => {
    const base = cmd({ dispatchMode: 'wait' });
    const follow = cmd();
    const queue = [base, follow];

    expect(absorbMergeFollowUps(queue, base)).toEqual([]);
    expect(queue).toEqual([base, follow]);
  });

  it('dispatchMode 미지정은 기본값(합치기)으로 취급한다', () => {
    const base = cmd({ dispatchMode: undefined, text: 'a' });
    const follow = cmd({ dispatchMode: undefined, text: 'b' });
    const queue = [base, follow];

    expect(absorbMergeFollowUps(queue, base)).toEqual([follow]);
    expect(base.text).toBe('a\n\nb');
  });

  it('대기(wait) 덧말을 만나면 거기서 끊는다 — 그 명령은 자기 턴을 갖는다', () => {
    const base = cmd({ text: 'a' });
    const m1 = cmd({ text: 'b' });
    const w = cmd({ text: 'c', dispatchMode: 'wait' });
    const m2 = cmd({ text: 'd' });
    const queue = [base, m1, w, m2];

    expect(absorbMergeFollowUps(queue, base)).toEqual([m1]);
    expect(base.text).toBe('a\n\nb');
    expect(queue).toEqual([base, w, m2]);
  });

  it('즉시(immediate) 덧말을 만나면 거기서 끊는다', () => {
    const base = cmd();
    const imm = cmd({ dispatchMode: 'immediate' });
    const queue = [base, imm];

    expect(absorbMergeFollowUps(queue, base)).toEqual([]);
    expect(queue).toEqual([base, imm]);
  });

  it('edgeId 가 실린 뒤 명령은 흡수하지 않는다 (엣지 완료 promise 보호)', () => {
    const base = cmd();
    const edgeCmd = cmd({ edgeId: 'edge-1' });
    const after = cmd();
    const queue = [base, edgeCmd, after];

    expect(absorbMergeFollowUps(queue, base)).toEqual([]);
    expect(queue).toEqual([base, edgeCmd, after]);
  });

  it('base 자신이 엣지 dispatch 면 남의 덧말을 섞지 않는다', () => {
    const base = cmd({ edgeId: 'edge-1' });
    const follow = cmd();
    const queue = [base, follow];

    expect(absorbMergeFollowUps(queue, base)).toEqual([]);
    expect(base.mergedCount).toBeUndefined();
  });

  it('실행 중(executing) 명령을 만나면 끊는다', () => {
    const base = cmd();
    const running = cmd({ status: 'executing' });
    const queue = [base, running];

    expect(absorbMergeFollowUps(queue, base)).toEqual([]);
  });

  it('다른 세션 탭의 명령은 건너뛰고 같은 탭의 다음 덧말을 흡수한다', () => {
    const base = cmd({ text: 'a', subAgentId: 'sub-a' });
    const other = cmd({ text: 'x', subAgentId: 'sub-b' });
    const mine = cmd({ text: 'b', subAgentId: 'sub-a' });
    const queue = [base, other, mine];

    expect(absorbMergeFollowUps(queue, base)).toEqual([mine]);
    expect(base.text).toBe('a\n\nb');
    expect(queue).toEqual([base, other]);
  });

  it('첨부는 합집합으로 모으고 중복은 한 번만 남긴다', () => {
    const base = cmd({ attachments: ['/a/1.png'] });
    const f1 = cmd({ attachments: ['/a/1.png', '/a/2.png'] });
    const f2 = cmd({ attachments: ['/a/3.png'] });
    const queue = [base, f1, f2];

    absorbMergeFollowUps(queue, base);

    expect(base.attachments).toEqual(['/a/1.png', '/a/2.png', '/a/3.png']);
  });

  it('큐에 없는 명령이거나 뒤가 비면 아무 일도 하지 않는다', () => {
    const base = cmd();
    expect(absorbMergeFollowUps([], base)).toEqual([]);
    expect(absorbMergeFollowUps([base], base)).toEqual([]);
    expect(base.mergedCount).toBeUndefined();
  });

  it('빈 텍스트 덧말은 구분자만 남기지 않는다', () => {
    const base = cmd({ text: 'a' });
    const blank = cmd({ text: '   ' });
    const after = cmd({ text: 'b' });
    const queue = [base, blank, after];

    absorbMergeFollowUps(queue, base);

    expect(base.text).toBe('a\n\nb');
    expect(base.mergedCount).toBe(2);
  });
});
