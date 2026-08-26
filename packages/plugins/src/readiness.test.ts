/**
 * §5.11 노출 게이트 — **매니페스트의 `enforcesProject` 와 실제 집행이 어긋나지 않게 한다.**
 *
 * v4.59 가 111종 전부에 집행을 붙였지만, 그중 **프로젝트를 실제로 훑는** 것은 `ssot-drift` 하나뿐이다.
 * 나머지는 켜도 고정 문장만 실린다. 그래서 목록은 "실제로 손대는 것"만 세우고 나머지는 §7.7 디버그
 * 모드에서만 보이는데 — 그 판정이 매니페스트의 한 칸(`enforcesProject`)에 손으로 적혀 있다.
 *
 * 손으로 적은 값은 언제든 실제와 갈라진다. 그래서 여기서 **실제 집행 모듈을 돌려 보고** 대조한다.
 *
 *  · `survey` 를 내는가 — 훑은 근거를 카드에 돌려주는 자리(구조로 바로 보인다).
 *  · `probe` 를 쓰는가 — **실측으로 판별한다.** 파일이 다 있는 맥락과 하나도 없는 맥락에서 블록이
 *    달라지면 그 카드는 프로젝트를 읽고 있다는 뜻이다. 플래그가 아니라 행동을 보므로 적어 두기만 하고
 *    실제로는 안 훑는 카드를 통과시키지 않는다.
 *
 * 탐침을 붙이고 매니페스트를 안 고치면(또는 그 반대면) 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_MANIFESTS } from './registry.js';
import { PLUGIN_PROMPT_MODULES } from './prompt.js';
import type { PluginPromptContext } from './types.js';

/** 아무 것도 없는 프로젝트 — 탐침이 있으면 "없다" 쪽 문구가 나온다. */
const blind: PluginPromptContext = {
  projectPath: 'C:/repo/x',
  cwd: 'C:/repo/x',
  agentId: 'agent-1',
  agentLabel: 'Agent',
  customCreated: true,
  fileExists: () => false,
  readFile: () => null,
};

/** 무엇이든 있는 프로젝트 — 탐침이 있으면 "있다" 쪽 문구가 나온다. */
const rich: PluginPromptContext = {
  ...blind,
  fileExists: () => true,
  readFile: () => '# Doc\n\n## Change Log\n\n| 날짜 | 변경 | 이유 |\n',
};

const safeBlock = (fn: () => string | undefined): string => {
  try {
    return fn() ?? '';
  } catch {
    return '';
  }
};

/** 이 모듈은 프로젝트를 실제로 훑는가 — 근거를 돌려주거나(survey), 파일에 따라 말이 달라지거나(probe). */
function enforcesProject(mod: (typeof PLUGIN_PROMPT_MODULES)[number]): boolean {
  if (typeof mod.survey === 'function') return true;
  return safeBlock(() => mod.buildBlock(rich)) !== safeBlock(() => mod.buildBlock(blind));
}

const sorted = (ids: string[]): string[] => [...ids].sort();

describe('노출 게이트 — 매니페스트와 실제 집행', () => {
  it('enforcesProject 로 적힌 것과 실제로 프로젝트를 훑는 것이 같다', () => {
    const declared = sorted(PLUGIN_MANIFESTS.filter((m) => m.enforcesProject === true).map((m) => m.id));
    const actual = sorted(PLUGIN_PROMPT_MODULES.filter(enforcesProject).map((m) => m.id));
    expect(actual).toEqual(declared);
  });

  it('적어 두기만 하고 안 훑는 카드가 없다 — 목록에 서면 사용자는 동작한다고 읽는다', () => {
    const byId = new Map(PLUGIN_PROMPT_MODULES.map((m) => [m.id, m]));
    const lying = PLUGIN_MANIFESTS
      .filter((m) => m.enforcesProject === true)
      .filter((m) => {
        const mod = byId.get(m.id);
        return mod === undefined || !enforcesProject(mod);
      });
    expect(lying.map((m) => m.id)).toEqual([]);
  });

  it('훑는데 목록에서 숨는 카드가 없다 — 다 만들어 놓고 안 보이면 만든 뜻이 없다', () => {
    const declared = new Set(PLUGIN_MANIFESTS.filter((m) => m.enforcesProject === true).map((m) => m.id));
    const hidden = PLUGIN_PROMPT_MODULES.filter((m) => enforcesProject(m) && !declared.has(m.id));
    expect(hidden.map((m) => m.id)).toEqual([]);
  });

  it('실집행 카드가 최소 한 장은 있다 — 전부 숨으면 창이 빈 목록이 된다', () => {
    expect(PLUGIN_MANIFESTS.filter((m) => m.enforcesProject === true).length).toBeGreaterThan(0);
  });

  it('숨는 카드도 집행 자체는 그대로 낸다 — 노출만 닫는 것이지 기능을 끄는 것이 아니다', () => {
    const drafts = PLUGIN_PROMPT_MODULES.filter((m) => !enforcesProject(m));
    const silent = drafts.filter((m) => safeBlock(() => m.buildBlock(blind)).trim() === '');
    expect(silent.map((m) => m.id)).toEqual([]);
  });
});
