import { describe, it, expect } from 'vitest';
import { resolveTabCloseIntent, stopTargetProjectIds, type TabCloseTarget } from './tabCloseConfirm.js';

function project(key: string, runningCount: number, projectId = `C:/p/${key}`): TabCloseTarget {
  return { key: `p:${key}`, kind: 'project', label: key, runningCount, projectId };
}

function iframe(key: string): TabCloseTarget {
  return { key: `i:${key}`, kind: 'iframe', label: key, runningCount: 0 };
}

describe('resolveTabCloseIntent', () => {
  it('도는 게 없으면 묻지 않는다 — 종전대로 즉시 닫힘', () => {
    const intent = resolveTabCloseIntent([project('a', 0), project('b', 0)]);
    expect(intent.needsConfirm).toBe(false);
    expect(intent.running).toEqual([]);
    expect(intent.runningSessions).toBe(0);
  });

  it('빈 목록도 묻지 않는다', () => {
    expect(resolveTabCloseIntent([]).needsConfirm).toBe(false);
  });

  it('하나라도 돌면 묻는다', () => {
    const intent = resolveTabCloseIntent([project('a', 0), project('b', 3)]);
    expect(intent.needsConfirm).toBe(true);
    expect(intent.running.map((t) => t.key)).toEqual(['p:b']);
    expect(intent.runningSessions).toBe(3);
  });

  it('많이 도는 탭이 목록 위로 온다 — 동률이면 원래 순서', () => {
    const intent = resolveTabCloseIntent([project('a', 1), project('b', 5), project('c', 1)]);
    expect(intent.running.map((t) => t.key)).toEqual(['p:b', 'p:a', 'p:c']);
    expect(intent.runningSessions).toBe(7);
  });

  it('iframe 탭은 에이전트가 없으므로 확인 대상이 아니다', () => {
    const intent = resolveTabCloseIntent([iframe('x'), iframe('y')]);
    expect(intent.needsConfirm).toBe(false);
  });

  it('이상값(음수·NaN·Infinity)은 "돌지 않음"으로 접는다 — 거짓 팝업 금지', () => {
    const weird: TabCloseTarget[] = [
      project('neg', -4),
      project('nan', Number.NaN),
      project('inf', Number.POSITIVE_INFINITY),
    ];
    expect(resolveTabCloseIntent(weird).needsConfirm).toBe(false);
  });

  it('소수는 내림한다 — 0.4 개가 도는 일은 없다', () => {
    const intent = resolveTabCloseIntent([project('a', 2.7)]);
    expect(intent.runningSessions).toBe(2);
  });
});

describe('stopTargetProjectIds', () => {
  it('프로젝트 탭의 projectId 만, 중복 없이, 원래 순서로', () => {
    const ids = stopTargetProjectIds([
      project('a', 1, 'C:/p/a'),
      iframe('x'),
      project('b', 0, 'C:/p/b'),
      project('a2', 2, 'C:/p/a'),
    ]);
    expect(ids).toEqual(['C:/p/a', 'C:/p/b']);
  });

  it('projectId 가 없는 항목은 통로가 될 수 없어 빠진다', () => {
    const ids = stopTargetProjectIds([
      { key: 'p:x', kind: 'project', label: 'x', runningCount: 1 },
    ]);
    expect(ids).toEqual([]);
  });

  it('iframe 만이면 빈 목록', () => {
    expect(stopTargetProjectIds([iframe('x')])).toEqual([]);
  });
});
