import { describe, it, expect } from 'vitest';
import { backfillAgentTools, AGENT_TOOLS_BACKFILL_GEN, AVAILABLE_AGENT_TOOLS, resolveAgentDefaults } from '@vibisual/shared';
import type { AgentConfig, AgentConfigPatch, UserDefaults } from '@vibisual/shared';

/**
 * §4 (설정 3층) — 전역 옵션(`~/.vibisual/user-defaults.json`)의 **머지 계약**을 고정한다.
 *
 * 실제 서비스는 홈 디렉터리 파일을 읽는 싱글턴이라 여기서 부르지 않는다(테스트가 사용자 파일을
 * 건드리면 안 된다). 대신 그 안의 두 규칙을 **같은 모양으로** 재현해 고정한다 —
 * 규칙이 어긋나면 이 파일이 먼저 깨진다.
 *
 * 고정하는 것 둘:
 *  (1) **`null` = 그 칸을 비운다.** 종전에는 창이 미설정을 `undefined` 로 담았고
 *      `JSON.stringify` 가 그 키를 통째로 버려, 전역 기본값은 한 번 켜면 창에서 끌 수 없었다.
 *  (2) **전역 프리셋도 도구 백필을 받는다.** 여기만 빠져 있어서 판올림 전에 골라 둔 목록이
 *      앞으로 만들 모든 에이전트의 상한이 됐다(실측 11/48).
 */

/** `userDefaultsService.update` 의 카테고리 머지와 같은 규칙. */
function mergeCategory<T extends object>(
  prev: T | undefined,
  patch: { [K in keyof T]?: T[K] | null } | undefined,
): T | undefined {
  if (patch === undefined) return prev;
  const next: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as T;
}

/** 전선을 실제로 건너간 것만 남긴다 — `undefined` 는 여기서 사라진다. */
function overTheWire(patch: AgentConfigPatch): AgentConfigPatch {
  return JSON.parse(JSON.stringify(patch)) as AgentConfigPatch;
}

/** `userDefaultsService.update` 의 도장 규칙과 같은 규칙. */
function stampToolsGen(
  merged: UserDefaults['agentConfig'],
  patch: AgentConfigPatch,
): UserDefaults['agentConfig'] {
  if (!merged || !Array.isArray(patch.tools)) return merged;
  return { ...merged, toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN };
}

describe('§4 설정 3층 — 전역 옵션 머지', () => {
  it('`null` 을 보내면 그 칸이 지워진다(켠 것을 다시 끌 수 있다)', () => {
    const prev: UserDefaults['agentConfig'] = { model: 'opus', effort: 'max', safeMode: true };

    const next = mergeCategory(prev, overTheWire({ model: 'opus', effort: null, safeMode: null }));

    expect(next).toEqual({ model: 'opus' });
    // 저장분에 `null` 이 남지 않는다 — 지운다는 뜻이지 값이 아니다.
    expect('effort' in (next ?? {})).toBe(false);
  });

  it('`undefined` 는 전선을 건너지 못하므로 옛 값이 남는다(종전 동작의 정체)', () => {
    const prev: UserDefaults['agentConfig'] = { effort: 'max' };

    const next = mergeCategory(prev, overTheWire({ effort: undefined }));

    expect(next?.effort).toBe('max');
  });

  it('보내지 않은 칸은 건드리지 않는다(부분 머지 계약 유지)', () => {
    const prev: UserDefaults['agentConfig'] = { model: 'opus', rules: '기존 규칙' };

    const next = mergeCategory(prev, overTheWire({ model: 'sonnet' }));

    expect(next).toEqual({ model: 'sonnet', rules: '기존 규칙' });
  });

  it('카테고리 자체를 안 보내면 통째로 유지된다', () => {
    const prev: UserDefaults['agentConfig'] = { model: 'opus' };
    expect(mergeCategory(prev, undefined)).toEqual({ model: 'opus' });
  });
});

describe('§4 설정 3층 — 전역 프리셋 도구 백필', () => {
  it('세대 도장이 없는 옛 프리셋은 현행 목록으로 한 번 채워진다', () => {
    const legacy: Partial<AgentConfig> = { tools: ['Read', 'Bash'] };
    const filled = backfillAgentTools(legacy);

    expect(filled.tools).toEqual(expect.arrayContaining([...AVAILABLE_AGENT_TOOLS]));
    expect(filled.toolsBackfillGen).toBe(AGENT_TOOLS_BACKFILL_GEN);
  });

  it('도장이 찍힌 뒤에는 사용자가 끈 도구를 되살리지 않는다', () => {
    const picked: Partial<AgentConfig> = { tools: ['Read', 'Bash'], toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN };
    expect(backfillAgentTools(picked).tools).toEqual(['Read', 'Bash']);
  });

  it('목록을 갖지 않은 설정은 그대로 둔다(고르지 않은 것과 비운 것은 다르다)', () => {
    const noTools: Partial<AgentConfig> = { model: 'opus' };
    expect(backfillAgentTools(noTools)).toBe(noTools);
  });

  it('기본값 해소도 같은 백필을 거친다 — 신규 에이전트가 도구를 잃지 않는다', () => {
    // 내장 기본을 먼저 깔면 현행 세대 도장이 이미 찍혀 있어, 얹기 전에 채우지 않으면
    // 짧은 프리셋이 48종 목록을 가리고도 아무 검사에 걸리지 않는다(실측한 그 자리).
    const defaults = resolveAgentDefaults({ agentConfig: { tools: ['Read', 'Bash'] } });

    expect(defaults.tools).toEqual(expect.arrayContaining([...AVAILABLE_AGENT_TOOLS]));
  });

  it('설정 창에서 도구를 끄면 도장이 찍혀 다음 부팅에 되살아나지 않는다', () => {
    // 도장을 안 찍으면 백필이 "고를 기회가 없어서 빠진 것"으로 오인해 방금 끈 도구를 되돌린다.
    const patch = overTheWire({ tools: ['Read', 'Bash'] });
    const saved = stampToolsGen(mergeCategory<NonNullable<UserDefaults['agentConfig']>>(undefined, patch), patch);

    expect(saved?.toolsBackfillGen).toBe(AGENT_TOOLS_BACKFILL_GEN);
    expect(resolveAgentDefaults({ agentConfig: saved }).tools).toEqual(['Read', 'Bash']);
  });

  it('도구를 안 보낸 저장은 도장을 찍지 않는다(아직 못 받은 백필을 굳히지 않는다)', () => {
    const prev: UserDefaults['agentConfig'] = { tools: ['Read'] };
    const patch = overTheWire({ model: 'opus' });
    const saved = stampToolsGen(mergeCategory<NonNullable<UserDefaults['agentConfig']>>(prev, patch), patch);

    expect(saved?.toolsBackfillGen).toBeUndefined();
    expect(resolveAgentDefaults({ agentConfig: saved }).tools).toContain('TodoWrite');
  });
});
