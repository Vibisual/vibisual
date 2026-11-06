/** §5.19 (J) — 계획 먼저·릴레이·이어하기의 서버 흐름 + 실행부 곁일(Bash 판정 줄 · 앞뒤 보존 · 계획 먼저 쓰기 막기 · 진행률 읽기). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterPlanningTurn, approvePlan, checklistFileDone, isPlanningTurn, onRelayEnded, planSummary,
  prepareNewPlan, refreshLocalPlan, resetPlan, type LocalPlanHooks,
} from './localPlanService.js';
import { readLocalPlanState, writeLocalPlanState, parseChatDelta } from './localRunner.js';
import { localPlanRel, planGateRefusal } from './localAssistRuntime.js';
import { clipHeadTail, createHeadTailBuffer, runLocalTool } from './localTools.js';
import type { SubAgent } from '@vibisual/shared';

let home: string;
let root: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-plan-home-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-plan-root-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

function writePlan(subId: string, body: string): void {
  const file = path.join(root, localPlanRel(subId));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function fakeHooks(): LocalPlanHooks & { relays: unknown[]; queued: string[] } {
  const relays: unknown[] = [];
  const queued: string[] = [];
  return {
    relays,
    queued,
    startRelayLoop: (_agent, _sub, req) => { relays.push(req); return true; },
    enqueueCommand: (_agent, _sub, text) => { queued.push(text); return true; },
  };
}

describe('계획 턴 판정', () => {
  it('계획 먼저·릴레이가 꺼져 있으면 계획 턴이 아니다', () => {
    expect(isPlanningTurn(undefined, undefined)).toBe(false);
    expect(isPlanningTurn({ tidyAt: 80 }, undefined)).toBe(false);
  });

  it('승인된 계획이 돌고 있으면 계획 턴이 아니고, 끝났거나 없으면 다시 세운다', () => {
    expect(isPlanningTurn({ planFirst: true }, undefined)).toBe(true);
    expect(isPlanningTurn({ planFirst: true }, 'proposed')).toBe(true);
    expect(isPlanningTurn({ planFirst: true }, 'approved')).toBe(false);
    expect(isPlanningTurn({ relay: true }, 'running')).toBe(false);
    expect(isPlanningTurn({ relay: true }, 'done')).toBe(true);
  });
});

describe('계획 턴이 끝난 뒤', () => {
  it('파일 대신 답에 쓴 목록을 파일로 옮기고 proposed 로 둔다', () => {
    const out = afterPlanningTurn(root, 'sub-a', 'Plan:\n1. read config\n2. fix parser\n3. run tests', { planFirst: true });
    expect(out.state).toBe('proposed');
    expect(readLocalPlanState('sub-a')).toBe('proposed');
    expect(fs.readFileSync(path.join(root, localPlanRel('sub-a')), 'utf8')).toContain('- [ ] fix parser');
  });

  it('목록이 없으면 상태를 만들지 않고 그 사실을 말한다', () => {
    const out = afterPlanningTurn(root, 'sub-b', 'I will just do it.', { planFirst: true });
    expect(out.state).toBeUndefined();
    expect(out.notice).toMatch(/no checklist/);
    expect(readLocalPlanState('sub-b')).toBeUndefined();
  });

  it('새 계획을 세우기 전 — 끝난 계획은 걷고, 고치는 중인 계획은 둔다', () => {
    writePlan('sub-c', '- [x] old');
    writeLocalPlanState('sub-c', 'done');
    prepareNewPlan(root, 'sub-c');
    expect(fs.existsSync(path.join(root, localPlanRel('sub-c')))).toBe(false);
    expect(readLocalPlanState('sub-c')).toBeUndefined();
    writePlan('sub-d', '- [ ] draft');
    writeLocalPlanState('sub-d', 'proposed');
    prepareNewPlan(root, 'sub-d');
    expect(fs.existsSync(path.join(root, localPlanRel('sub-d')))).toBe(true);
  });
});

describe('승인 · 릴레이 · 끝', () => {
  it('릴레이면 세션 루프로, 남은 항목 두 배(상한 안)의 회차를 준다', () => {
    writePlan('sub-r', '- [ ] a\n- [ ] b\n- [x] c');
    writeLocalPlanState('sub-r', 'proposed');
    const hooks = fakeHooks();
    const out = approvePlan('agent', 'sub-r', root, { relay: true, relayMaxRounds: 3, relayVerifyCommand: 'pnpm test' }, hooks);
    expect(out).toEqual({ ok: true, state: 'running' });
    expect(hooks.relays[0]).toMatchObject({ total: 3, progressFile: localPlanRel('sub-r') });
    expect(JSON.stringify(hooks.relays[0])).toContain('pnpm test');
  });

  it('릴레이가 없으면 실행 명령 한 줄을 넣고 approved', () => {
    writePlan('sub-q', '- [ ] a');
    const hooks = fakeHooks();
    expect(approvePlan('agent', 'sub-q', root, { planFirst: true }, hooks)).toEqual({ ok: true, state: 'approved' });
    expect(hooks.queued[0]).toContain(localPlanRel('sub-q'));
  });

  it('남은 것이 없으면 시작하지 않고 done', () => {
    writePlan('sub-z', '- [x] a\n- [-] b');
    expect(approvePlan('agent', 'sub-z', root, { relay: true }, fakeHooks()).ok).toBe(false);
    expect(readLocalPlanState('sub-z')).toBe('done');
  });

  it('완료 판정은 파일이 한다 — 루프가 끝나면 남은 것에 따라 done/approved', () => {
    writePlan('sub-e', '- [x] a\n- [ ] b');
    expect(checklistFileDone(root, localPlanRel('sub-e'))).toBe(false);
    writeLocalPlanState('sub-e', 'running');
    expect(onRelayEnded(root, 'sub-e')).toBe('approved');
    writePlan('sub-e', '- [x] a\n- [x] b');
    expect(checklistFileDone(root, localPlanRel('sub-e'))).toBe(true);
    writeLocalPlanState('sub-e', 'running');
    expect(onRelayEnded(root, 'sub-e')).toBe('done');
  });

  it('요약은 SubAgent 에 실리고 새 계획이면 걷힌다', () => {
    writePlan('sub-s', '- [x] a\n- [ ] b');
    writeLocalPlanState('sub-s', 'approved');
    const sub = { id: 'sub-s' } as SubAgent;
    expect(refreshLocalPlan(sub, root)).toBe(true);
    expect(sub.localPlan).toMatchObject({ state: 'approved', total: 2, done: 1 });
    expect(planSummary(root, 'sub-s')?.items[1]).toEqual({ text: 'b', done: false });
    resetPlan(root, 'sub-s');
    expect(refreshLocalPlan(sub, root)).toBe(true);
    expect(sub.localPlan).toBeUndefined();
  });
});

describe('계획 먼저 — 승인 전 쓰기 막기', () => {
  it('셸은 막고, 계획 파일 쓰기는 열고, 다른 파일 쓰기는 막는다', () => {
    const rel = localPlanRel('sub-g');
    expect(planGateRefusal('Bash', { command: 'ls' }, root, rel)).toMatch(/plan-first/);
    expect(planGateRefusal('Write', { path: rel, content: '- [ ] a' }, root, rel)).toBeNull();
    expect(planGateRefusal('Edit', { path: 'src/app.ts' }, root, rel)).toMatch(/only/);
    expect(planGateRefusal('Read', { path: 'src/app.ts' }, root, rel)).toBeNull();
  });
});

describe('Bash 결과 — 판정 줄은 맨 앞, 긴 출력은 앞·뒤', () => {
  it('앞·뒤를 남기고 가운데를 접는다', () => {
    const text = `HEAD${'x'.repeat(10_000)}TAIL`;
    const clipped = clipHeadTail(text, 1_000);
    expect(clipped.startsWith('HEAD')).toBe(true);
    expect(clipped.endsWith('TAIL')).toBe(true);
    expect(clipped).toMatch(/characters omitted/);
    expect(clipHeadTail('short', 1_000)).toBe('short');
  });

  it('흘러드는 출력은 상한만큼만 든다', () => {
    const buf = createHeadTailBuffer(5, 5);
    for (const chunk of ['abc', 'defgh', 'ijklmnop', 'qrstu']) buf.push(chunk);
    const out = buf.render();
    expect(out.startsWith('abcde')).toBe(true);
    expect(out.endsWith('qrstu')).toBe(true);
    expect(out).toMatch(/omitted/);
  });

  it('실패한 명령의 종료 코드가 결과 첫 줄이다', async () => {
    const outcome = await runLocalTool('Bash', { command: 'echo hello && exit 3' }, root);
    expect(outcome.isError).toBe(true);
    expect(outcome.content.split('\n')[0]).toBe('[exit code 3]');
    expect(outcome.content).toContain('hello');
  });
});

describe('프롬프트 처리 진행', () => {
  it('엔진이 실은 진행을 읽고, 없으면 null', () => {
    const line = JSON.stringify({ choices: [], prompt_progress: { total: 9000, cache: 1000, processed: 0, time_ms: 0 } });
    expect(parseChatDelta(line)?.promptProgress).toEqual({ total: 9000, cache: 1000, processed: 0 });
    expect(parseChatDelta(JSON.stringify({ choices: [{ delta: { content: 'a' } }] }))?.promptProgress).toBeNull();
  });
});
