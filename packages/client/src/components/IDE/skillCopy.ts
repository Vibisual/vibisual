/**
 * §5.5 #17-4 — 스킬을 다른 프로젝트로 복사할 때의 **순수 규칙**.
 *
 * 화면(`IDESkillCopyPanel`)은 여기서 정한 대상 목록·결과 요약을 그대로 그린다. 무엇을 왜 걸렀는지
 * (worktree · 원본 자신)와 결과를 어떻게 세는지가 컴포넌트 안에 흩어지면 시험할 수 없기 때문이다.
 */
import type { ProjectInfo } from '@vibisual/shared';
import type { SkillInfo, SkillCopyResult, SkillCopyStatus } from '../../hooks/useAvailableSkills.js';

/** 대상 목록에서 "전역(모든 프로젝트)" 을 가리키는 예약 ref — 서버 `resolveSkillTargetDir` 와 같은 약속 값. */
export const SKILL_COPY_GLOBAL_TARGET = 'global';

export interface SkillCopyTarget {
  /** 서버로 보내는 ref — 전역은 예약어, 프로젝트는 path(= projectId). */
  ref: string;
  /** 화면 라벨. 전역 항목은 호출부가 번역 문자열로 대체한다. */
  label: string;
  kind: 'global' | 'project';
}

export interface SkillCopySummary {
  copied: number;
  overwritten: number;
  exists: number;
  same: number;
  failed: number;
  /** 이미 있어 멈춘 대상 — [덮어쓰기] 는 이것만 다시 보낸다. */
  existsTargets: string[];
}

/** 결과 상태 → 요약 칸. 새 상태가 생기면 이 표에 한 줄만 추가한다. */
const STATUS_FIELD: Record<SkillCopyStatus, keyof Omit<SkillCopySummary, 'existsTargets'>> = {
  copied: 'copied',
  overwritten: 'overwritten',
  exists: 'exists',
  same: 'same',
  error: 'failed',
};

/** 경로 비교용 정규화 — `ProjectInfo.path` 는 forward slash 규약이라 대소문자만 흡수하면 된다. */
function samePathKey(p: string): string {
  return p.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * 복사 대상 후보.
 * - worktree 는 제외 — TabBar 와 같은 규약(부모 캔버스 안 버블로만 산다).
 * - 원본 자신도 제외 — 프로젝트 스킬은 그 프로젝트가, 전역 스킬은 전역 항목이 빠진다.
 * - 전역·플러그인 스킬은 **지금 프로젝트도 대상**이다(가져오기가 그 스킬의 주 용도).
 */
export function buildSkillCopyTargets(
  projects: Record<string, ProjectInfo>,
  opts: { source: SkillInfo['source']; currentProjectPath?: string | null },
): SkillCopyTarget[] {
  const targets: SkillCopyTarget[] = [];
  if (opts.source !== 'global') {
    targets.push({ ref: SKILL_COPY_GLOBAL_TARGET, label: SKILL_COPY_GLOBAL_TARGET, kind: 'global' });
  }
  const current = opts.currentProjectPath ? samePathKey(opts.currentProjectPath) : null;
  for (const info of Object.values(projects)) {
    if (info.parentProjectPath) continue;
    if (opts.source === 'project' && current !== null && samePathKey(info.path) === current) continue;
    targets.push({ ref: info.path, label: info.name, kind: 'project' });
  }
  return targets;
}

/** 대상별 결과 → 한 줄 요약에 필요한 수치. */
export function summarizeSkillCopy(results: SkillCopyResult[]): SkillCopySummary {
  const summary: SkillCopySummary = { copied: 0, overwritten: 0, exists: 0, same: 0, failed: 0, existsTargets: [] };
  for (const result of results) {
    summary[STATUS_FIELD[result.status]] += 1;
    if (result.status === 'exists') summary.existsTargets.push(result.target);
  }
  return summary;
}
