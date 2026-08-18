/**
 * §5.5 #17-4 — 스킬 복사 대상·결과 요약 규칙.
 *
 * 대상 목록이 틀리면 사용자는 **자기 프로젝트에 자기 스킬을 다시 복사**하거나(무의미), worktree 까지
 * 늘어선 목록에서 진짜 프로젝트를 찾아야 한다. 요약이 틀리면 "이미 있음" 을 놓쳐 [덮어쓰기] 가 엉뚱한
 * 대상으로 간다 — 둘 다 화면을 보기 전에 여기서 막는다.
 */
import { describe, it, expect } from 'vitest';
import type { ProjectInfo } from '@vibisual/shared';
import { buildSkillCopyTargets, summarizeSkillCopy, SKILL_COPY_GLOBAL_TARGET } from './skillCopy.js';
import type { SkillCopyResult } from '../../hooks/useAvailableSkills.js';

const PROJECTS: Record<string, ProjectInfo> = {
  alpha: { name: 'alpha', path: 'C:/work/alpha' },
  beta: { name: 'beta', path: 'C:/work/beta' },
  'alpha-wt': { name: 'romantic-burnell', path: 'C:/work/wt/romantic-burnell', parentProjectPath: 'C:/work/alpha', worktreeName: 'romantic-burnell' },
};

describe('buildSkillCopyTargets', () => {
  it('프로젝트 스킬 — 전역 + 다른 프로젝트만 (자기 자신 제외)', () => {
    const targets = buildSkillCopyTargets(PROJECTS, { source: 'project', currentProjectPath: 'C:/work/alpha' });
    expect(targets.map((t) => t.ref)).toEqual([SKILL_COPY_GLOBAL_TARGET, 'C:/work/beta']);
  });

  it('worktree 프로젝트는 대상에서 빠진다 — TabBar 와 같은 규약', () => {
    const targets = buildSkillCopyTargets(PROJECTS, { source: 'project', currentProjectPath: 'C:/work/beta' });
    expect(targets.some((t) => t.ref.includes('romantic-burnell'))).toBe(false);
  });

  it('원본 경로는 대소문자·끝 슬래시가 달라도 같은 프로젝트로 본다', () => {
    const targets = buildSkillCopyTargets(PROJECTS, { source: 'project', currentProjectPath: 'c:/WORK/alpha/' });
    expect(targets.map((t) => t.ref)).toEqual([SKILL_COPY_GLOBAL_TARGET, 'C:/work/beta']);
  });

  it('전역 스킬 — 전역 항목이 빠지고 지금 프로젝트도 대상이 된다(가져오기)', () => {
    const targets = buildSkillCopyTargets(PROJECTS, { source: 'global', currentProjectPath: 'C:/work/alpha' });
    expect(targets.map((t) => t.ref)).toEqual(['C:/work/alpha', 'C:/work/beta']);
  });

  it('플러그인 스킬 — 전역과 모든 프로젝트가 대상', () => {
    const targets = buildSkillCopyTargets(PROJECTS, { source: 'plugin', currentProjectPath: 'C:/work/alpha' });
    expect(targets.map((t) => t.ref)).toEqual([SKILL_COPY_GLOBAL_TARGET, 'C:/work/alpha', 'C:/work/beta']);
  });

  it('프로젝트가 없으면 전역 하나만 남는다', () => {
    expect(buildSkillCopyTargets({}, { source: 'project', currentProjectPath: null })).toEqual([
      { ref: SKILL_COPY_GLOBAL_TARGET, label: SKILL_COPY_GLOBAL_TARGET, kind: 'global' },
    ]);
  });

  it('프로젝트 라벨은 표시명, ref 는 path(=projectId)', () => {
    const beta = buildSkillCopyTargets(PROJECTS, { source: 'project', currentProjectPath: 'C:/work/alpha' })
      .find((t) => t.kind === 'project');
    expect(beta).toEqual({ ref: 'C:/work/beta', label: 'beta', kind: 'project' });
  });
});

describe('summarizeSkillCopy', () => {
  const results: SkillCopyResult[] = [
    { target: 'C:/work/beta', status: 'copied' },
    { target: 'global', status: 'overwritten' },
    { target: 'C:/work/gamma', status: 'exists' },
    { target: 'C:/work/delta', status: 'exists' },
    { target: 'C:/work/alpha', status: 'same' },
    { target: 'C:/work/zeta', status: 'error', error: 'EACCES' },
  ];

  it('상태별로 세고, 이미 있는 대상만 따로 모은다', () => {
    expect(summarizeSkillCopy(results)).toEqual({
      copied: 1,
      overwritten: 1,
      exists: 2,
      same: 1,
      failed: 1,
      existsTargets: ['C:/work/gamma', 'C:/work/delta'],
    });
  });

  it('빈 결과는 전부 0 — 요약 줄이 뜨지 않아야 한다', () => {
    expect(summarizeSkillCopy([])).toEqual({ copied: 0, overwritten: 0, exists: 0, same: 0, failed: 0, existsTargets: [] });
  });
});
