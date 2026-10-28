/**
 * §5.11 노출 게이트 — 매니페스트 `enforcesProject`(목록에 서는 카드, 나머지는 §7.7 디버그 모드)가 손으로 적은 칸이라 실제 모듈을 돌려 대조한다:
 * `survey` 를 내는가, `probe` 로 파일이 다 있을 때와 없을 때 블록이 달라지는가(플래그가 아니라 행동).
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

/**
 * §5.5 #17-44 ⑧(d) — `ownToggle` 은 노출 게이트의 유일한 예외라 끌 자리가 다른 화면에 있어야 한다(없으면 못 끄는데 프롬프트엔 실리는 유령).
 * 그 화면은 코드로 못 세므로 자격을 못 박는다 — `enforcesProject` 카드만 쓸 수 있다.
 */
describe('손잡이가 자기 화면에 있는 카드 — §5.5 #17-44 ⑧(d)', () => {
  it('ownToggle 은 enforcesProject 인 카드만 쓴다 — 훑지도 않는 카드를 목록에서 빼면 그냥 사라진 것이다', () => {
    const bad = PLUGIN_MANIFESTS.filter((m) => m.ownToggle === true && m.enforcesProject !== true);
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it('ownToggle 카드도 집행 모듈을 그대로 갖는다 — 목록에서 내린 것이지 기능을 끈 것이 아니다', () => {
    const ids = new Set(PLUGIN_PROMPT_MODULES.map((m) => m.id));
    const missing = PLUGIN_MANIFESTS.filter((m) => m.ownToggle === true && !ids.has(m.id));
    expect(missing.map((m) => m.id)).toEqual([]);
  });
});
