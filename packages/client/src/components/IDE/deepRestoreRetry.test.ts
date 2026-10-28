/**
 * §5.5 — 깊은 복원 재요청은 포기하지 않는다. 횟수로 멈추면 빈 응답이 이어지는 동안 effect 의존성이 안 바뀌어 다시 돌 길이 없고 세션이 얕은 창으로 굳는다.
 * DOM 이 없어 소스 계약을 본다: 재시도 지연 표 끝에서 `undefined` 로 떨어져 멈추지 않는가(서버 쪽은 `subAgentStreamDirRecovery.test.ts`).
 */

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

/** 깊은 복원 재요청 블록(그 effect 안쪽)만 잘라 본다 — 파일의 다른 재시도와 섞이지 않게. */
function deepRestoreBlock(): string {
  const src = source('AgentIDEOverlay.tsx');
  const at = src.indexOf('RETRY_DELAYS');
  expect(at, '깊은 복원 재요청 블록을 못 찾음').toBeGreaterThan(-1);
  const end = src.indexOf('}, [agentId, activeSessionId, deepRestored, streamRestoreEpoch]);', at);
  expect(end, '깊은 복원 effect 끝을 못 찾음').toBeGreaterThan(at);
  return src.slice(at, end);
}

describe('§5.5 — 깊은 복원 재요청은 성공할 때까지 계속된다', () => {
  it('지연을 고르는 자리에 상한 폴백이 있다 — 표 끝에서 멈추지 않는다', () => {
    const block = deepRestoreBlock();
    // `RETRY_DELAYS[attempt] ?? RETRY_DELAY_MAX` — 표를 다 쓰면 상한으로 계속 묻는다.
    expect(block).toMatch(/RETRY_DELAYS\[attempt\]\s*\?\?\s*RETRY_DELAY_MAX/);
  });

  it('빈 응답·조회 실패·과거 틈 복원 실패 모두 그 폴백으로 다시 묻는다', () => {
    const block = deepRestoreBlock();
    // 분기 수가 아니라 각 실패의 배선을 확인한다. /older 틈 보충이 false를 돌려도 재시도가 필요하다.
    const schedule = /setTimeout\(\(\)\s*=>\s*run\(attempt \+ 1\),\s*delayFor\(attempt\)\)/;
    const empty = block.match(/if \(!server \|\| server\.length === 0\) \{([\s\S]*?)return;/)?.[1];
    const failedSeam = block.match(/if \(!restored && !cancelled\)([^\n]*)/)?.[1];
    const failedRequest = block.slice(block.indexOf('.catch(() => {'));
    expect(empty, '빈 서버 응답이 재시도되어야 한다').toMatch(schedule);
    expect(failedSeam, '/older 틈 보충 실패가 재시도되어야 한다').toMatch(schedule);
    expect(failedRequest, '조회 거절·JSON 실패가 재시도되어야 한다').toMatch(schedule);
  });

  it('"지연이 없으면 그만둔다"는 옛 분기가 남아 있지 않다', () => {
    const block = deepRestoreBlock();
    // 종전 코드: `const delay = RETRY_DELAYS[attempt]; if (delay !== undefined) setTimeout(...)`
    //   — 표를 다 쓰면 `undefined` 라 아무것도 안 걸고 그 세션이 굳었다.
    expect(block).not.toMatch(/if\s*\(\s*delay\s*!==\s*undefined\s*\)/);
  });
});
