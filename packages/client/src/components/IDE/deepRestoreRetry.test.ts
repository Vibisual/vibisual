/**
 * §5.5 — **깊은 복원 재요청은 포기하지 않는다.**
 *
 * 사용자 보고(2026-09-08): 세션·프로젝트를 오가며 열었다 닫았다 한 뒤 그 세션으로 돌아오니
 * **대화 내역이 통째로 사라지고** 말풍선과 질문 카드만 남았다.
 *
 * 클라 쪽 원인은 재요청이 **세 번 만에 그만뒀다**는 것이다. 그 세 번이 전부 빈 응답이면
 * (서버가 소속을 못 풀어 폴더를 못 짚는 동안 — 그쪽은 `subAgentStreamDirRecovery.test.ts`)
 * effect 의 의존성(`agentId`·`activeSessionId`·`deepRestored`)이 아무것도 바뀌지 않아 **다시 도는
 * 길이 없었다.** 그 세션은 얕은 창인 채로 굳는다.
 *
 * 이 배선은 `AgentIDEOverlay` 안의 effect 라 DOM 없이 실행해 볼 수 없다(클라 테스트에는 jsdom 이
 * 없다 — `vitest.config.ts`). 그래서 되돌아가면 결함이 그대로 되살아나는 **소스 계약**을 고정한다:
 * 재시도 지연을 고르는 자리가 표 끝에서 `undefined` 로 떨어져 멈추지 않는가.
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
  return src.slice(at, at + 2500);
}

describe('§5.5 — 깊은 복원 재요청은 성공할 때까지 계속된다', () => {
  it('지연을 고르는 자리에 상한 폴백이 있다 — 표 끝에서 멈추지 않는다', () => {
    const block = deepRestoreBlock();
    // `RETRY_DELAYS[attempt] ?? RETRY_DELAY_MAX` — 표를 다 쓰면 상한으로 계속 묻는다.
    expect(block).toMatch(/RETRY_DELAYS\[attempt\]\s*\?\?\s*RETRY_DELAY_MAX/);
  });

  it('빈 응답과 실패 두 갈래 모두 그 폴백을 쓴다 — 한쪽만 고치면 그쪽에서 굳는다', () => {
    const block = deepRestoreBlock();
    const calls = block.match(/setTimeout\(\(\)\s*=>\s*run\(attempt \+ 1\),\s*delayFor\(attempt\)\)/g) ?? [];
    expect(calls.length, '빈 응답 갈래와 catch 갈래 둘 다 delayFor 를 써야 한다').toBe(2);
  });

  it('"지연이 없으면 그만둔다"는 옛 분기가 남아 있지 않다', () => {
    const block = deepRestoreBlock();
    // 종전 코드: `const delay = RETRY_DELAYS[attempt]; if (delay !== undefined) setTimeout(...)`
    //   — 표를 다 쓰면 `undefined` 라 아무것도 안 걸고 그 세션이 굳었다.
    expect(block).not.toMatch(/if\s*\(\s*delay\s*!==\s*undefined\s*\)/);
  });
});
