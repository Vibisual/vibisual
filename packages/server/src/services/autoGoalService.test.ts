/**
 * §5.10 — 자동 목표 서비스 회귀.
 *
 * 못 박는 것 다섯:
 * ① **꺼져 있으면 훑지 않는다** — 후보 0·`observed` 0. 이 기능이 없던 때와 같아야 한다.
 * ② **껐다고 만든 것까지 사라지지 않는다** — 꺼져도 이미 지은 스킬 목록은 그대로 보인다.
 * ③ **사람이 손본 파일은 덮지 않는다** — 고쳐 뒀는데 되돌아오면 아무도 고치지 않게 된다.
 * ④ **통폐합** — 옛 브레인 자리(`.vibisual/brain/skills`)의 스킬도 함께 읽힌다.
 * ⑤ **꺼져 있으면 프롬프트에 한 글자도 안 실린다.**
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AutoGoalSettings, BashEntry } from '@vibisual/shared';
import {
  buildAutoGoalPromptBlock,
  deleteAutoGoalSkill,
  dropAutoGoalCache,
  getAutoGoalState,
  listAutoGoalSkills,
  readAutoGoalSkillBody,
} from './autoGoalService.js';

const T0 = 1_700_000_000_000;
let root: string;

/** 같은 순서를 n 번 되풀이한 명령 이력 — 문턱(3회)을 넘기는 최소 재료. */
function repeated(commands: readonly string[], times: number): BashEntry[] {
  const out: BashEntry[] = [];
  for (let r = 0; r < times; r += 1) {
    commands.forEach((command, i) => {
      out.push({ id: `b${r}-${i}`, command, timestamp: T0 + r * 60_000 + i * 1000 });
    });
  }
  return out;
}

const ON: AutoGoalSettings = { enabledProject: true };

beforeEach(() => {
  // 사용자 홈이 아니라 임시 폴더에만 쓴다 — 시험이 실제 프로젝트를 건드리면 안 된다.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-autogoal-'));
});

afterEach(() => {
  dropAutoGoalCache(root);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('자동 목표 — 꺼짐이 기본', () => {
  it('아무 층도 안 켜면 훑지 않는다', () => {
    const state = getAutoGoalState(root, undefined, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 5) },
    });
    expect(state.enabled).toBe(false);
    expect(state.candidates).toEqual([]);
    expect(state.observed).toBe(0);
    // 훑지 않았으므로 디스크에도 한 장도 안 생긴다.
    expect(fs.existsSync(path.join(root, '.vibisual', 'skills'))).toBe(false);
  });

  it('세션 층이 프로젝트 층을 덮어 끌 수 있다', () => {
    const settings: AutoGoalSettings = { enabledProject: true, enabledSessions: { s1: false } };
    const input = { bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 4) } };
    expect(getAutoGoalState(root, settings, { subAgentId: 's1' }, input).enabled).toBe(false);
    dropAutoGoalCache(root);
    expect(getAutoGoalState(root, settings, { subAgentId: 's2' }, input).enabled).toBe(true);
  });

  it('꺼져 있어도 이미 지은 절차는 목록에 남는다 — 끄기는 정지이지 삭제가 아니다', () => {
    const input = { bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 4) } };
    const on = getAutoGoalState(root, ON, {}, input);
    expect(on.skills.length).toBe(1);
    dropAutoGoalCache(root);
    const off = getAutoGoalState(root, undefined, {}, input);
    expect(off.enabled).toBe(false);
    expect(off.skills.length).toBe(1);
  });
});

describe('자동 목표 — 되풀이를 스킬로 굳힌다', () => {
  it('문턱을 넘으면 SKILL.md 가 생긴다 — 단계 원문이 그대로 들어 있다', () => {
    const state = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['git add -A', 'git commit -m x', 'git push'], 3) },
    });
    expect(state.enabled).toBe(true);
    expect(state.skills).toHaveLength(1);
    const skill = state.skills[0];
    expect(skill?.runs).toBe(3);
    expect(skill?.steps).toBe(3);
    // 후보와 스킬이 한 줄로 이어진다 — 화면이 "이건 이미 굳었다"를 그린다.
    expect(state.candidates[0]?.skillId).toBe(skill?.id);
    expect(skill?.candidateId).toBe(state.candidates[0]?.id);

    const body = readAutoGoalSkillBody(root, skill?.id ?? '');
    expect(body).toContain('git commit -m x');
    expect(body).toContain('git push');
  });

  it('문턱 아래는 굳히지 않는다 — 두 번 한 일은 아직 절차가 아니다', () => {
    const state = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 2) },
    });
    expect(state.candidates).toEqual([]);
    expect(state.skills).toEqual([]);
    // 그래도 본 것은 셌다 — 0 이면 "고장"으로 읽히므로 구분되어야 한다.
    expect(state.observed).toBe(4);
  });

  it('관찰이 늘면 개정하고, 안 늘면 다시 쓰지 않는다', () => {
    const first = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 3) },
    });
    const id = first.skills[0]?.id ?? '';
    const file = path.join(root, '.vibisual', 'skills', id, 'SKILL.md');
    const stamp1 = fs.readFileSync(file, 'utf8');

    dropAutoGoalCache(root);
    const same = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 3) },
    });
    expect(same.skills[0]?.runs).toBe(3);
    expect(fs.readFileSync(file, 'utf8')).toBe(stamp1);

    dropAutoGoalCache(root);
    const more = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 5) },
    });
    expect(more.skills[0]?.runs).toBe(5);
    expect(fs.readFileSync(file, 'utf8')).toContain('5번 되풀이');
  });

  it('사람이 손본 파일은 다음 분석이 덮지 않는다', () => {
    const first = getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 3) },
    });
    const id = first.skills[0]?.id ?? '';
    const file = path.join(root, '.vibisual', 'skills', id, 'SKILL.md');
    // `source: auto-goal` 줄을 걷으면 "사람이 적은 것"이다.
    const edited = fs.readFileSync(file, 'utf8').replace(/^source: .*$/m, 'source: human');
    fs.writeFileSync(file, `${edited}\n\n내가 손으로 적은 줄`);

    dropAutoGoalCache(root);
    getAutoGoalState(root, ON, {}, { bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 9) } });
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('내가 손으로 적은 줄');
    expect(after).not.toContain('9번 되풀이');
  });

  it('물린 후보는 굳히지 않는다', () => {
    const input = { bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 4) } };
    const first = getAutoGoalState(root, ON, {}, input);
    const candidateId = first.candidates[0]?.id ?? '';
    // 지우고 물린다(REST DELETE 가 하는 일 그대로).
    expect(deleteAutoGoalSkill(root, first.skills[0]?.id ?? '')).toBe(true);

    dropAutoGoalCache(root);
    const after = getAutoGoalState(root, { ...ON, dismissed: [candidateId] }, {}, input);
    expect(after.candidates).toEqual([]);
    expect(after.skills).toEqual([]);
  });
});

describe('자동 목표 — 통폐합과 주입', () => {
  it('옛 브레인 자리의 스킬도 함께 읽힌다 — 쌓인 것이 경로를 잃지 않는다', () => {
    const legacy = path.join(root, '.vibisual', 'brain', 'skills', 'old-one');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, 'SKILL.md'),
      ['---', 'name: 옛 절차', 'description: 브레인 시절에 적힌 것', 'id: old-one', '---', '', '본문'].join('\n'),
    );
    const skills = listAutoGoalSkills(root);
    expect(skills.map((s) => s.id)).toContain('old-one');
    expect(readAutoGoalSkillBody(root, 'old-one')?.trim()).toBe('본문');
  });

  it('꺼져 있으면 프롬프트에 한 글자도 안 실린다', () => {
    getAutoGoalState(root, ON, {}, { bashHistory: { a1: repeated(['pnpm build', 'pnpm test'], 4) } });
    expect(listAutoGoalSkills(root)).toHaveLength(1);
    expect(buildAutoGoalPromptBlock(root, undefined, {})).toBeUndefined();
    expect(buildAutoGoalPromptBlock(root, { enabledProject: false }, {})).toBeUndefined();
  });

  it('켜져 있으면 이름과 한 줄 설명만 싣는다 — 본문은 파일에 둔다', () => {
    getAutoGoalState(root, ON, {}, {
      bashHistory: { a1: repeated(['git add -A', 'git commit -m x', 'git push'], 3) },
    });
    const block = buildAutoGoalPromptBlock(root, ON, {}) ?? '';
    expect(block).toContain('git add → git push');
    expect(block).toContain('.vibisual/skills/');
    // 단계 원문(본문)은 프롬프트에 실리지 않는다 — 스무 장이 있어도 얇아야 한다.
    expect(block).not.toContain('git commit -m x');
  });

  it('절차가 한 장도 없으면 줄 자체가 서지 않는다', () => {
    expect(buildAutoGoalPromptBlock(root, ON, {})).toBeUndefined();
  });
});
