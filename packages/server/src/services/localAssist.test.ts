/** §5.19 (J) — 끝까지 돕기 순수 판정: 옵션 좁히기 · 프리셋 · 엔진 묶음 · 비 측정 · 정리선 · 가리기 · 체크리스트. */
import { describe, it, expect } from 'vitest';
import {
  normalizeLocalAssist,
  applyLocalAssistPreset,
  patchLocalAssist,
  isLocalAssistActive,
  localAssistEngineArgs,
  localAssistEngineProfile,
  localAssistIdleMs,
  calibrateCharsPerToken,
  shouldTidyContext,
  maskOldToolResults,
  savedOutputPointer,
  parseChecklist,
  extractPlanItemsFromAnswer,
  renderChecklist,
  relayRoundCommand,
  planFirstInstruction,
  normalizeAgentProvider,
  localToolResultBudget,
  localHistoryBudget,
  LOCAL_ASSIST_PRESETS,
  LOCAL_CHARS_PER_TOKEN_MAX,
  LOCAL_CHARS_PER_TOKEN_MIN,
  LOCAL_MODEL_IDLE_UNLOAD_MS,
  LOCAL_RELAY_MAX_ROUNDS_LIMIT,
  LOCAL_SAFE_CACHE_RAM_MAX_MIB,
} from '@vibisual/shared';

const GIB = 1024 * 1024 * 1024;

describe('normalizeLocalAssist — 모르는 값은 버리고 비면 종전 동작', () => {
  it('빈 값·모르는 값만 오면 undefined', () => {
    expect(normalizeLocalAssist(undefined)).toBeUndefined();
    expect(normalizeLocalAssist({ kvCache: 'q2', tidyAt: 75, relay: 'yes' })).toBeUndefined();
  });

  it('아는 칸만 남기고 꺼진 스위치는 싣지 않는다', () => {
    expect(normalizeLocalAssist({ kvCache: 'q8_0', tidyAt: 80, relay: false, planFirst: true, extra: 1 }))
      .toEqual({ kvCache: 'q8_0', tidyAt: 80, planFirst: true });
  });

  it('릴레이 회차는 상한에서 자르고 검증 명령은 다듬는다', () => {
    expect(normalizeLocalAssist({ relayMaxRounds: 10_000, relayVerifyCommand: '  pnpm test  ' }))
      .toEqual({ relayMaxRounds: LOCAL_RELAY_MAX_ROUNDS_LIMIT, relayVerifyCommand: 'pnpm test' });
  });

  it('All Model 버블 설정 저장을 지나도 옵션이 남고, 코덱스 버블에는 실리지 않는다', () => {
    const local = normalizeAgentProvider({ kind: 'local-llama', modelId: 'm', assist: { tidyAt: 70 } });
    expect(local?.assist).toEqual({ tidyAt: 70 });
    const codex = normalizeAgentProvider({ kind: 'codex-cli', modelId: 'gpt', assist: { tidyAt: 70 } });
    expect(codex?.assist).toBeUndefined();
  });
});

describe('프리셋 — 칸을 한 번에 채울 뿐이다', () => {
  it('끔은 전부 비우고, 나머지는 표 그대로 + 이름', () => {
    expect(applyLocalAssistPreset('off')).toEqual({});
    expect(applyLocalAssistPreset('lowSpec')).toEqual({ ...LOCAL_ASSIST_PRESETS.lowSpec, preset: 'lowSpec' });
  });

  it('칸 하나를 바꾸면 이름이 custom 으로 내려간다', () => {
    const next = patchLocalAssist(applyLocalAssistPreset('balanced'), { tidyAt: 90 });
    expect(next.preset).toBe('custom');
    expect(next.tidyAt).toBe(90);
  });

  it('스위치를 끄면 그 칸이 사라진다', () => {
    expect(patchLocalAssist({ relay: true, planFirst: true }, { relay: false })).toEqual({ planFirst: true, preset: 'custom' });
  });

  it('켜짐 판정은 프리셋 이름이 아니라 칸이 정한다', () => {
    expect(isLocalAssistActive(undefined)).toBe(false);
    expect(isLocalAssistActive({ preset: 'custom' })).toBe(false);
    expect(isLocalAssistActive({ kvCache: 'f16', toolOutputCap: 'normal' })).toBe(false);
    expect(isLocalAssistActive({ keepLoadedMinutes: LOCAL_MODEL_IDLE_UNLOAD_MS / 60_000 })).toBe(false);
    expect(isLocalAssistActive(applyLocalAssistPreset('longTask'))).toBe(true);
  });
});

describe('엔진 묶음 — 옵션이 비면 종전 인자 그대로', () => {
  const host = { totalRamBytes: 16 * GIB, logicalCpus: 12 };

  it('비면 빈 배열', () => {
    expect(localAssistEngineArgs(undefined, host)).toEqual([]);
    expect(localAssistEngineArgs({ kvCache: 'f16', moeOffload: 'auto' }, host)).toEqual([]);
  });

  it('KV 양자화는 flash attention 과 한 묶음이다', () => {
    expect(localAssistEngineArgs({ kvCache: 'q4_0' }, host)).toEqual([
      { id: 'kv-cache', args: ['-ctk', 'q4_0', '-ctv', 'q4_0', '-fa', 'on'] },
    ]);
  });

  it('저사양 안전은 RAM 캐시를 시스템 메모리의 1/16·상한까지로, 스레드는 절반으로', () => {
    const groups = localAssistEngineArgs({ lowSpecSafe: true }, host);
    expect(groups.find((g) => g.id === 'cache-ram')?.args).toEqual(['--cache-ram', String(LOCAL_SAFE_CACHE_RAM_MAX_MIB)]);
    expect(groups.find((g) => g.id === 'threads')?.args).toEqual(['-t', '6']);
    const small = localAssistEngineArgs({ lowSpecSafe: true }, { totalRamBytes: 8 * GIB, logicalCpus: 1 });
    expect(small.find((g) => g.id === 'cache-ram')?.args).toEqual(['--cache-ram', '512']);
    expect(small.find((g) => g.id === 'threads')?.args).toEqual(['-t', '1']);
  });

  it('프로필이 다르면 다시 띄운다(뜬 뒤엔 못 바꾸는 인자)', () => {
    expect(localAssistEngineProfile(undefined, false)).toBe(localAssistEngineProfile({ kvCache: 'f16' }, false));
    expect(localAssistEngineProfile({ kvCache: 'q8_0' }, false)).not.toBe(localAssistEngineProfile(undefined, false));
    expect(localAssistEngineProfile(undefined, true)).not.toBe(localAssistEngineProfile(undefined, false));
  });

  it('유휴 해제는 고른 분, 없으면 종전 값', () => {
    expect(localAssistIdleMs(undefined)).toBe(LOCAL_MODEL_IDLE_UNLOAD_MS);
    expect(localAssistIdleMs({ keepLoadedMinutes: 30 })).toBe(30 * 60_000);
  });
});

describe('글자/토큰 비 — 엔진이 센 값으로 예산을 잡는다', () => {
  it('한글 대화는 1 근처로 재고, 엉뚱한 값은 클램프', () => {
    expect(calibrateCharsPerToken(1200, 1000)).toBeCloseTo(1.2);
    expect(calibrateCharsPerToken(10, 1000)).toBe(LOCAL_CHARS_PER_TOKEN_MIN);
    expect(calibrateCharsPerToken(100_000, 1000)).toBe(LOCAL_CHARS_PER_TOKEN_MAX);
    expect(calibrateCharsPerToken(0, 10)).toBeNull();
  });

  it('잰 비가 작으면 이력·도구 몫(글자)도 그만큼 준다 — 한글 3배 과대가 사라진다', () => {
    expect(localHistoryBudget(16_384, 1)).toBeLessThan(localHistoryBudget(16_384));
    expect(localToolResultBudget(16_384, 1)).toBeLessThan(localToolResultBudget(16_384));
    expect(localToolResultBudget(16_384, 3, 0.1)).toBeLessThan(localToolResultBudget(16_384, 3, 0.4));
  });
});

describe('정리선', () => {
  it('끔·0 이면 늘 아니고, 넘으면 정리한다', () => {
    expect(shouldTidyContext(16_000, 16_384, undefined)).toBe(false);
    expect(shouldTidyContext(16_000, 16_384, 0)).toBe(false);
    expect(shouldTidyContext(11_000, 16_384, 70)).toBe(false);
    expect(shouldTidyContext(11_500, 16_384, 70)).toBe(true);
  });
});

describe('maskOldToolResults — 오래된 도구 결과를 한 번에 가린다', () => {
  const big = 'x'.repeat(2_000);
  const call = (id: string): { role: string; content: string; tool_calls: unknown[] } => ({ role: 'assistant', content: '', tool_calls: [{ id }] });
  const result = (id: string, content = big): { role: string; content: string; tool_call_id: string } => ({ role: 'tool', content, tool_call_id: id });

  it('최근 두 왕복은 그대로, 그 앞은 자리표시로 — 입력은 바뀌지 않는다', () => {
    const msgs = [{ role: 'user', content: 'go' }, call('a'), result('a'), call('b'), result('b'), call('c'), result('c')];
    const before = JSON.stringify(msgs);
    const out = maskOldToolResults(msgs, 2, 400);
    expect(out.masked).toBe(1);
    expect(out.messages[2]?.content).toMatch(/omitted to save context/);
    expect(out.messages[4]?.content).toBe(big);
    expect(out.messages[6]?.content).toBe(big);
    expect(out.freedChars).toBeGreaterThan(1_500);
    expect(JSON.stringify(msgs)).toBe(before);
  });

  it('짧은 결과·이미 가린 결과는 건드리지 않고, 보관 경로 줄은 살린다', () => {
    const pointer = savedOutputPointer('.vibisual/local-outputs/s/1.txt');
    const msgs = [call('a'), result('a', 'short'), call('b'), result('b', `${big}\n${pointer}`), call('c'), result('c'), call('d'), result('d')];
    const once = maskOldToolResults(msgs, 2, 400);
    expect(once.messages[1]?.content).toBe('short');
    expect(once.messages[3]?.content).toContain(pointer);
    const twice = maskOldToolResults(once.messages, 2, 400);
    expect(twice.masked).toBe(0);
  });

  it('왕복이 상한 이하면 아무것도 바꾸지 않는다', () => {
    const msgs = [call('a'), result('a'), call('b'), result('b')];
    expect(maskOldToolResults(msgs, 2, 400).masked).toBe(0);
  });
});

describe('체크리스트 — 완료 판정은 파일이 한다', () => {
  it('[ ]·[x]·[-] 를 읽고 [-] 는 남은 일로 세지 않는다', () => {
    const items = parseChecklist('# Plan\n- [x] one\n- [ ] two — done when: test\n* [-] three\n1. [X] four\nplain line');
    expect(items.map((i) => i.done)).toEqual([true, false, true, true]);
    expect(items[2]?.skipped).toBe(true);
    expect(items[1]?.text).toBe('two — done when: test');
  });

  it('답에 쓴 목록을 건진다 — 체크박스 먼저, 없으면 두 줄 이상 번호 목록', () => {
    expect(extractPlanItemsFromAnswer('do this:\n- [ ] a\n- [ ] b')).toEqual(['a', 'b']);
    expect(extractPlanItemsFromAnswer('1. read\n2) edit\n3. test')).toEqual(['read', 'edit', 'test']);
    expect(extractPlanItemsFromAnswer('1. only one')).toEqual([]);
  });

  it('그려 낸 파일을 다시 읽으면 같은 항목이 미완료로 나온다', () => {
    const md = renderChecklist('Plan', ['a', 'b']);
    expect(parseChecklist(md)).toEqual([{ text: 'a', done: false }, { text: 'b', done: false }]);
  });

  it('지시문은 계획 파일 경로와 검증 명령을 싣는다', () => {
    expect(planFirstInstruction('.vibisual/relay/s.md')).toContain('.vibisual/relay/s.md');
    const round = relayRoundCommand('.vibisual/relay/s.md', 'pnpm test');
    expect(round).toContain('pnpm test');
    expect(round).toContain('- [ ]');
    expect(relayRoundCommand('p.md')).not.toContain('undefined');
  });
});
