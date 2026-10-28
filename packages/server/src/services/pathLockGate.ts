// §5.3 #12-3 — 자물쇠의 서버 쪽 접합부. 판정은 shared `findToolLockHits` 한 벌에 이 호스트 값(플랫폼·홈)을 물린다.
// 창구 셋(클로드·코덱스·로컬)과 훅 세션이 함께 쓴다(따로 지으면 한 곳만 열린다). 문구는 영어다 — 엔진에 돌려주는 사유다(`handler.mjs` 승인 훅과 같은 규약).

import { homedir } from 'node:os';
import { findToolLockHits, PATH_LOCK_CARD_HITS_MAX } from '@vibisual/shared';
import type { PathLock, PathLockHit } from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';

/** `~` 를 펴는 홈 디렉터리. 프로세스가 사는 동안 바뀌지 않는다(§5.22 `AUDIT_HOME_DIR` 와 같은 자리). */
const LOCK_HOME_DIR = homedir();

/**
 * 이 호스트의 값으로 판정한다. `locks` 는 열려 있는 모든 프로젝트의 자물쇠(`graphManager.getAllPathLocks()`).
 * cwd 를 모르면 상대경로는 펴지 못해 세지 않는다 — 절대경로·URL 은 그대로 센다.
 */
export function findToolLockHitsOnHost(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
  cwd: string | null | undefined,
  locks: Readonly<Record<string, readonly PathLock[]>>,
): PathLockHit[] {
  return findToolLockHits(toolName, toolInput ?? {}, {
    locks,
    cwd: typeof cwd === 'string' && cwd.trim() ? cwd.trim() : null,
    platform: HOST_PLATFORM,
    homeDir: LOCK_HOME_DIR,
  });
}

/** 승인 카드에 싣는 몫(`PATH_LOCK_CARD_HITS_MAX`). 나머지는 수로만 말한다. */
export function lockHitsForCard(hits: readonly PathLockHit[]): PathLockHit[] {
  return hits.slice(0, PATH_LOCK_CARD_HITS_MAX);
}

/** 사람이 읽는 대상 목록 — `"C:/p/secret.env", "C:/p/private" (+2 more)`. */
export function describeLockTargets(hits: readonly PathLockHit[]): string {
  const shown = hits.slice(0, PATH_LOCK_CARD_HITS_MAX).map((h) => `"${h.target}"`);
  const more = hits.length - shown.length;
  return more > 0 ? `${shown.join(', ')} (+${more} more)` : shown.join(', ');
}

/** 자물쇠가 몇 개냐에 따라 "is"/"are". */
function verb(hits: readonly PathLockHit[]): string {
  return hits.length > 1 ? 'are' : 'is';
}

/**
 * 훅으로 붙은 클로드 세션에 돌려줄 `ask` 사유. 그 CLI 가 자기 승인 창에 띄우고(사용자가 읽는다),
 * 답할 사람이 없는 `-p` 실행이면 거부된 뒤 모델이 이 글을 읽는다 — 두 독자 모두에게 맞게 쓴다.
 */
export function lockAskReason(hits: readonly PathLockHit[]): string {
  return `Vibisual lock: ${describeLockTargets(hits)} ${verb(hits)} locked by the user, so this access needs the user's approval. `
    + 'If it is denied, do not retry it or work around it with another command — ask the user to unlock it in Vibisual '
    + '(right-click the bubble → Unlock) or to approve it.';
}

/** 관할 밖 세션에 돌려줄 자물쇠 답(`/api/permission-check` 본문). */
export interface UnmanagedLockAnswer {
  ok: true;
  decision: 'ask' | 'deny';
  reason: 'locked';
  message: string;
}

/**
 * 관할 밖 세션(사용자 에디터·터미널 훅 · 우리 CMD)의 자물쇠 답 — 안 닿으면 `null`. 팝업 대신 그 엔진의 장치로: 클로드는 `ask`(bypass 에서도 뜬다),
 * 코덱스는 `ask` 를 무시하고 실행하므로(공식 문서) 거부 + 사유. 코덱스 판별은 `engine: 'codex'` 또는 페이로드의 `turn_id`.
 */
export function unmanagedLockAnswer(
  hits: readonly PathLockHit[],
  session: { engine?: string | undefined; turnId?: string | undefined },
): UnmanagedLockAnswer | null {
  if (hits.length === 0) return null;
  const codex = session.engine === 'codex' || (typeof session.turnId === 'string' && session.turnId.length > 0);
  return codex
    ? { ok: true, decision: 'deny', reason: 'locked', message: lockDenyReason(hits, 'codex') }
    : { ok: true, decision: 'ask', reason: 'locked', message: lockAskReason(hits) };
}

/**
 * 물을 수 없는 자리에 돌려줄 거부 사유(모델이 읽는다).
 * - `codex`    코덱스 훅은 `ask` 를 지원하지 않는다(읽기만 하고 도구를 그대로 실행한다 — 공식 문서)
 * - `dont-ask` 이 에이전트가 묻지 않는 모드(`dontAsk`)로 돈다
 */
export function lockDenyReason(hits: readonly PathLockHit[], why: 'codex' | 'dont-ask'): string {
  const targets = describeLockTargets(hits);
  if (why === 'dont-ask') {
    return `PERMISSION POLICY: DENY. ${targets} ${verb(hits)} locked by the user in Vibisual, and this agent runs in permission mode "dontAsk" `
      + '(it never asks), so the tool was blocked WITHOUT asking. No one pressed anything. Tell the user which path is locked — '
      + 'they can unlock it in Vibisual or change the agent\'s permission mode. Do not retry it or work around it with another command.';
  }
  return `Vibisual lock: ${targets} ${verb(hits)} locked by the user, so this tool was blocked and NOT executed. `
    + 'This session cannot ask for approval here. Tell the user it is locked and ask them to unlock it in Vibisual '
    + '(right-click the bubble → Unlock) if access is needed. Do not retry it or work around it with another command.';
}
