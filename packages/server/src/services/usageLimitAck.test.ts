import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSessionRunState, EMPTY_SESSION_RUN_INPUTS, type UsageLimitStop } from '@vibisual/shared';
import { ProjectGraphManager } from './projectGraphManager.js';
import { subAgentManager } from './subAgentManager.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 실제로 건드린다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §2.4 (한도 정지) — **사용자가 확인하면 주황불이 걷힌다.**
 *
 * 종전에는 표식(`SubAgent.usageLimit`)을 걷는 곳이 `execute` 하나뿐이었다. 그래서 한도로 멎은
 * 세션을 **다시 돌리기 전까지** 헤더 배지가 영영 주황이었고, 사용자가 그 사실을 이미 읽었어도
 * 화면에서 내릴 방법이 없었다(사용자 지시 — "내가 클릭해서 확인하면 다시 idle 로 돌아가야지").
 *
 * 이 시험이 고정하는 것은 셋이다.
 *  · 확인하면 그 세션의 표식이 **걷힌 채로 남는다**(파생값이 아니라 근거를 걷는다).
 *  · 확인한 **그 세션만** 걷힌다 — 옆 세션·옆 버블의 주황은 그대로다("해당 세션").
 *  · 걷히면 배지 집계와 세션 상태가 **평상태로 함께 돌아간다**(둘이 갈리면 색과 숫자가 다투게 된다).
 */

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

/** 실측 원문 그대로의 한도 통지(세션 창). */
const STOP: UsageLimitStop = {
  kind: 'session',
  at: 1_757_000_000_000,
  message: "You've hit your session limit · resets 3am (Asia/Seoul)",
  resetsLabel: '3am (Asia/Seoul)',
};

function makeProject(tag: string): { manager: ProjectGraphManager; name: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vibi-limitack-${tag}-`));
  tmpDirs.push(dir);
  const manager = new ProjectGraphManager();
  const name = manager.registerProject(dir).name;
  return { manager, name };
}

/** 그 세션이 화면에 어떤 색으로 서는가 — 도트·배지가 실제로 보는 그 판정. */
function runStateOf(subId: string): string {
  const sub = subAgentManager.getSub(subId);
  return resolveSessionRunState({
    ...EMPTY_SESSION_RUN_INPUTS,
    subStatus: sub?.status ?? null,
    // 확인까지 눌러 둔 세션으로 둔다 — 표식이 걷히면 `done`(조용함)으로 내려앉아야 한다.
    acknowledged: true,
    usageLimited: sub?.usageLimit !== undefined,
  });
}

describe('한도 정지 확인 — 걷는 길이 하나 더 있다', () => {
  it('확인하면 그 세션의 표식이 걷히고, 걷힌 id 를 돌려준다', () => {
    const { manager, name } = makeProject('basic');
    const agent = manager.createCustomAgent('Limited', undefined, name)!;
    const sub = subAgentManager.create(agent.id);
    sub.status = 'idle';
    sub.usageLimit = STOP;

    expect(runStateOf(sub.id)).toBe('limited');

    expect(subAgentManager.acknowledgeUsageLimits([sub.id])).toEqual([sub.id]);

    expect(subAgentManager.getSub(sub.id)?.usageLimit).toBeUndefined();
    // 근거가 걷혔으므로 몇 번을 다시 물어도 주황으로 되돌아가지 않는다.
    for (let i = 0; i < 3; i++) expect(runStateOf(sub.id)).toBe('done');
  });

  it('표식이 없는 세션은 조용히 건너뛴다 — 빈 결과면 호출자가 저장까지 가지 않는다', () => {
    const { manager, name } = makeProject('noop');
    const agent = manager.createCustomAgent('Quiet', undefined, name)!;
    const sub = subAgentManager.create(agent.id);
    sub.status = 'idle';

    expect(subAgentManager.acknowledgeUsageLimits([sub.id])).toEqual([]);
    // 없는 세션 id 를 줘도 던지지 않는다(스냅샷이 한 박자 늦은 클라가 옛 id 를 보낼 수 있다).
    expect(subAgentManager.acknowledgeUsageLimits(['sub-does-not-exist'])).toEqual([]);
  });

  it('확인한 그 세션만 걷힌다 — 같은 버블의 옆 세션은 주황 그대로다', () => {
    const { manager, name } = makeProject('scope');
    const agent = manager.createCustomAgent('Two', undefined, name)!;
    const mine = subAgentManager.create(agent.id);
    const other = subAgentManager.create(agent.id);
    for (const s of [mine, other]) { s.status = 'idle'; s.usageLimit = STOP; }

    expect(subAgentManager.acknowledgeUsageLimits([mine.id])).toEqual([mine.id]);

    expect(runStateOf(mine.id)).toBe('done');
    expect(runStateOf(other.id)).toBe('limited');
  });

  it('버블 단위 손짓은 그 버블의 멈춘 세션만 모은다 — 옆 버블은 손대지 않는다', () => {
    const { manager, name } = makeProject('agent');
    const a = manager.createCustomAgent('A', undefined, name)!;
    const b = manager.createCustomAgent('B', undefined, name)!;
    const a1 = subAgentManager.create(a.id);
    const a2 = subAgentManager.create(a.id);
    const b1 = subAgentManager.create(b.id);
    for (const s of [a1, a2, b1]) { s.status = 'idle'; s.usageLimit = STOP; }
    // 멈추지 않은 세션은 목록에 들지 않는다(확인의 대상이 아니다).
    const a3 = subAgentManager.create(a.id);
    a3.status = 'idle';

    expect(subAgentManager.listUsageLimitedSubIds(a.id).sort()).toEqual([a1.id, a2.id].sort());

    subAgentManager.acknowledgeUsageLimits(subAgentManager.listUsageLimitedSubIds(a.id));

    expect(runStateOf(a1.id)).toBe('done');
    expect(runStateOf(a2.id)).toBe('done');
    expect(runStateOf(b1.id)).toBe('limited');
  });

  it('배지 숫자도 함께 내려간다 — 색과 숫자가 다른 말을 하면 안 된다', () => {
    const { manager, name } = makeProject('badge');
    const agent = manager.createCustomAgent('Counted', undefined, name)!;
    const subs = [0, 1, 2].map(() => subAgentManager.create(agent.id));
    for (const s of subs) { s.status = 'idle'; s.usageLimit = STOP; }

    const limited = (): number | undefined =>
      manager.getBroadcastSnapshot().projectAgentCounts?.[name]?.limited;
    expect(limited()).toBe(3);

    // 한 줄만 확인 → 배지는 아직 주황(남은 둘을 말한다).
    subAgentManager.acknowledgeUsageLimits([subs[0]!.id]);
    expect(limited()).toBe(2);

    // "전부 확인" → 배지가 평상태로 내려간다.
    subAgentManager.acknowledgeUsageLimits(subAgentManager.listUsageLimitedSubIds(agent.id));
    expect(limited()).toBe(0);
  });

  it('확인은 표식만 걷는다 — 상태·마지막 명령은 그대로 남는다(지우는 것이 아니라 확인한 것)', () => {
    const { manager, name } = makeProject('keep');
    const agent = manager.createCustomAgent('Keeper', undefined, name)!;
    const sub = subAgentManager.create(agent.id);
    sub.status = 'idle';
    sub.lastCommand = '전면 개편을 시작한다';
    sub.sessionId = 'cli-session-uuid';
    sub.usageLimit = STOP;

    subAgentManager.acknowledgeUsageLimits([sub.id]);

    const after = subAgentManager.getSub(sub.id)!;
    expect(after.usageLimit).toBeUndefined();
    expect(after.status).toBe('idle');
    expect(after.lastCommand).toBe('전면 개편을 시작한다');
    expect(after.sessionId).toBe('cli-session-uuid');
  });
});
