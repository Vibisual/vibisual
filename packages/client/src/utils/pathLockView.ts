/**
 * §5.3 #12-3 — 버블 위 자물쇠 표식 판정(표시 전용). 판정은 shared(`pathLockTargetOf` → `findPathLockCover`)이고 여기는 얼마나 자주 재느냐만 맡는다.
 * 버블마다 스토어를 구독해(§9) 선택자가 스냅샷마다 돈다 — 수백 개가 경로를 다시 펴면 캔버스가 무거워진다. 그래서 자물쇠 목록 객체(`structuralShare` 로
 * 내용이 같으면 같은 참조)를 열쇠로 결과를 기억하고 목록이 바뀔 때만 다시 잰다. 같은 목록이면 같은 결과 객체라 버블도 다시 그려지지 않는다.
 */
import { findPathLockCover, pathLockTargetOf } from '@vibisual/shared';
import type { LockableBubble, PathLock } from '@vibisual/shared';
import { clientPathPlatform } from './platform.js';

/** 버블에 그릴 자물쇠 표식. `self` = 이 버블이 잠겼다, `inherited` = 상위 폴더·도메인이 잠갔다. */
export interface BubbleLockBadge {
  relation: 'self' | 'inherited';
  /** 그 자물쇠의 대상(경로·호스트) — 툴팁이 말한다. */
  target: string;
}

const badgeCache = new WeakMap<object, Map<string, BubbleLockBadge | null>>();

/** 결과를 기억하는 열쇠 — 판정이 보는 칸만. */
function badgeKey(node: LockableBubble): string {
  return `${node.bubbleType}|${node.ghostInfo?.originalBubbleType ?? ''}|${node.absolutePath ?? ''}|${node.path ?? ''}`;
}

export function bubbleLockBadge(
  locks: Record<string, PathLock[]>,
  node: LockableBubble,
): BubbleLockBadge | null {
  // 빠른 길 — 자물쇠가 하나도 없으면(대부분의 프로젝트) 아무것도 재지 않는다.
  let any = false;
  for (const name in locks) {
    if ((locks[name]?.length ?? 0) > 0) { any = true; break; }
  }
  if (!any) return null;
  let perLocks = badgeCache.get(locks);
  if (!perLocks) {
    perLocks = new Map();
    badgeCache.set(locks, perLocks);
  }
  const key = badgeKey(node);
  const cached = perLocks.get(key);
  if (cached !== undefined) return cached;
  const target = pathLockTargetOf(node);
  const cover = target ? findPathLockCover(target, locks, clientPathPlatform()) : null;
  const badge = cover ? { relation: cover.relation, target: cover.lock.target } : null;
  perLocks.set(key, badge);
  return badge;
}
