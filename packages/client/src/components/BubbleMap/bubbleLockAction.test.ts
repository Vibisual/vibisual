import { describe, expect, it } from 'vitest';
import { buildPathLock, type BubbleData, type PathLock, type PathLockKind } from '@vibisual/shared';
import { groupUnlockByProject, planBubbleLock } from './bubbleLockAction.js';
import { bubbleLockBadge } from '../../utils/pathLockView.js';

// §5.3 #12-3 — 버블 위 우클릭의 자물쇠 판정. 메뉴가 "잠그기"라고 말하는데 집행은 이미 묻고 있거나,
// 자식 버블에서 부모 자물쇠를 풀어 버리는 일이 없게 판정을 고정한다.

function lock(kind: PathLockKind, target: string): PathLock {
  const built = buildPathLock({ kind, target }, 'win32', 1);
  if (!built) throw new Error('bad lock');
  return built;
}

function bubble(id: string, data: Partial<BubbleData> & Pick<BubbleData, 'bubbleType'>) {
  return { id, data: { label: id, path: '', ...data } as BubbleData };
}

const file = bubble('f', { bubbleType: 'file', path: 'secret.env', absolutePath: 'C:/p/secret.env' });
const child = bubble('c', { bubbleType: 'file', path: 'private/a.md', absolutePath: 'C:/p/private/a.md' });
const folder = bubble('d', { bubbleType: 'internal_folder', path: 'private', absolutePath: 'C:/p/private' });
const agent = bubble('a', { bubbleType: 'agent', path: 'sess' });

describe('planBubbleLock', () => {
  it('안 잠긴 버블은 잠글 대상, 잠글 수 없는 버블은 수만 센다', () => {
    const plan = planBubbleLock([file, agent], {}, 'win32');
    expect(plan.toLock).toEqual([{ kind: 'file', target: 'C:/p/secret.env', label: 'f' }]);
    expect(plan.toUnlock).toEqual([]);
    expect(plan.notLockable).toBe(1);
    expect(plan.total).toBe(2);
  });

  it('자기 자신이 잠겼으면 풀 대상 — 그 자물쇠를 건 탭과 id 를 싣는다', () => {
    const l = lock('file', 'C:/p/secret.env');
    const plan = planBubbleLock([file], { other: [l] }, 'win32');
    expect(plan.toUnlock).toEqual([{ projectName: 'other', lockId: l.id }]);
    expect(plan.toLock).toEqual([]);
  });

  it('상위 폴더가 잠갔으면 잠그지도 풀지도 않고 그 자물쇠를 말한다', () => {
    const l = lock('folder', 'C:/p/private');
    const plan = planBubbleLock([child], { proj: [l] }, 'win32');
    expect(plan.toLock).toEqual([]);
    expect(plan.toUnlock).toEqual([]);
    expect(plan.inherited.map((i) => i.lock.id)).toEqual([l.id]);
  });

  it('같은 대상은 한 번만 — 폴더 버블과 그 폴더의 위성이 같은 경로를 가리켜도', () => {
    const twin = bubble('sat-d', { bubbleType: 'internal_folder', path: 'private', absolutePath: 'C:\\p\\private' });
    expect(planBubbleLock([folder, twin], {}, 'win32').toLock).toHaveLength(1);
  });

  it('풀기는 그 자물쇠를 건 탭별로 묶는다', () => {
    const grouped = groupUnlockByProject([
      { projectName: 'a', lockId: '1' }, { projectName: 'b', lockId: '2' }, { projectName: 'a', lockId: '3' },
    ]);
    expect([...grouped.entries()]).toEqual([['a', ['1', '3']], ['b', ['2']]]);
  });
});

describe('bubbleLockBadge — 버블 표식(표시 전용 캐시)', () => {
  it('자물쇠가 없으면 바로 null', () => {
    expect(bubbleLockBadge({}, file.data)).toBeNull();
    expect(bubbleLockBadge({ proj: [] }, file.data)).toBeNull();
  });

  it('같은 목록이면 같은 결과 객체 — 스냅샷이 흘러도 버블이 깨지 않는다', () => {
    const locks = { proj: [lock('folder', 'C:/p/private')] };
    const first = bubbleLockBadge(locks, child.data);
    expect(first).toEqual({ relation: 'inherited', target: 'C:/p/private' });
    // 버블 데이터 객체가 새로 와도(스냅샷마다) 판정이 보는 칸이 같으면 같은 결과다.
    expect(bubbleLockBadge(locks, { ...child.data })).toBe(first);
    expect(bubbleLockBadge(locks, folder.data)).toEqual({ relation: 'self', target: 'C:/p/private' });
  });

  it('목록이 바뀌면 다시 잰다', () => {
    const before = { proj: [lock('folder', 'C:/p/private')] };
    const after = { proj: [] as PathLock[] };
    expect(bubbleLockBadge(before, child.data)).not.toBeNull();
    expect(bubbleLockBadge(after, child.data)).toBeNull();
  });
});
