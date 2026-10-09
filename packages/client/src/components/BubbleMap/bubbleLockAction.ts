/**
 * bubbleLockAction.ts — §5.3 #12-3 **"이 버블(들)을 잠그거나 풀면 무엇이 되는가"를 한 곳에서 정한다.**
 *
 * 버블 위 우클릭 메뉴(§5.4 #34)가 부른다. 삭제 판정(`bubbleDeleteAction.ts`)과 같은 규율 — DOM 도
 * 스토어도 보지 않고 인자로 받은 것만 본다. 그래야 단위 테스트로 고정되고, 메뉴가 판정을 지어내지 않는다.
 *
 * "무엇을 잠그나"(`pathLockTargetOf`)와 "이미 잠겼나"(`findPathLockCover`)는 shared 한 벌이다 — 집행
 * (서버 `findToolLockHits`)과 같은 경로 규칙이라, 메뉴가 "잠그기"라고 말하는데 집행은 이미 묻고 있는
 * 어긋남이 생기지 않는다.
 */
import { findPathLockCover, pathLockId, pathLockTargetOf } from '@vibisual/shared';
import type { LockableBubble, PathLock, PathLocksByProject, PathLockTarget, PlatformName } from '@vibisual/shared';
import { clientPathPlatform } from '../../utils/platform.js';

/** 메뉴가 고른 버블 하나(흐름 노드 id + 그 버블 데이터). */
export interface LockMenuBubble {
  id: string;
  data: LockableBubble | null | undefined;
}

/** 잠그거나 풀면 무엇이 되는가. */
export interface BubbleLockPlan {
  /** 아직 안 잠긴 잠글 대상(같은 대상은 한 번만). */
  toLock: PathLockTarget[];
  /** 그 버블 **자신**에 걸린 자물쇠 — 건 프로젝트와 id(다른 탭이 건 것일 수 있다). */
  toUnlock: Array<{ projectName: string; lockId: string }>;
  /** 상위 폴더·상위 도메인 자물쇠에 덮인 버블 — 그 자물쇠(자식에서 부모를 푸는 손은 주지 않는다). */
  inherited: Array<{ projectName: string; lock: PathLock }>;
  /** 잠글 수 없는 버블 수(에이전트·골격·보드류 등). 묶음 메뉴가 "N개는 빠진다"고 말한다. */
  notLockable: number;
  /** 판정한 버블 수. */
  total: number;
}

export function planBubbleLock(
  bubbles: readonly LockMenuBubble[],
  locks: PathLocksByProject,
  platform: PlatformName = clientPathPlatform(),
): BubbleLockPlan {
  const plan: BubbleLockPlan = { toLock: [], toUnlock: [], inherited: [], notLockable: 0, total: bubbles.length };
  const seenLock = new Set<string>();
  const seenUnlock = new Set<string>();
  const seenInherited = new Set<string>();
  for (const bubble of bubbles) {
    const target = pathLockTargetOf(bubble.data ?? null);
    if (!target) {
      plan.notLockable++;
      continue;
    }
    const cover = findPathLockCover(target, locks, platform);
    if (cover?.relation === 'self') {
      if (!seenUnlock.has(cover.lock.id)) {
        seenUnlock.add(cover.lock.id);
        plan.toUnlock.push({ projectName: cover.projectName, lockId: cover.lock.id });
      }
      continue;
    }
    if (cover?.relation === 'inherited') {
      if (!seenInherited.has(cover.lock.id)) {
        seenInherited.add(cover.lock.id);
        plan.inherited.push({ projectName: cover.projectName, lock: cover.lock });
      }
      continue;
    }
    const id = pathLockId(target.kind, target.target, platform);
    if (seenLock.has(id)) continue;
    seenLock.add(id);
    plan.toLock.push(target);
  }
  return plan;
}

/** 풀 자물쇠를 건 프로젝트별로 묶는다(풀기는 그 자물쇠를 건 탭에 보낸다). */
export function groupUnlockByProject(toUnlock: BubbleLockPlan['toUnlock']): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { projectName, lockId } of toUnlock) {
    out.set(projectName, [...(out.get(projectName) ?? []), lockId]);
  }
  return out;
}
