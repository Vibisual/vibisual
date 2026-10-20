/**
 * linkViewHold.ts — §5.4 #36 (H) 연결 보기를 누른 직후의 **낙관 붙들기** 한 벌.
 *
 * 누르면 화면이 먼저 바뀌고(store) PATCH 가 뒤따른다. 그런데 서버가 그 PATCH 를 받기 **전에** 떠난 스냅샷이
 * 클라 묶음 창(`useWebSocket` 코얼레스 16~250ms)에 걸려 있다가 누른 **뒤에** 적용되면, 방금 바꾼 칸을 옛 값으로
 * 되돌린다. 곧이어 PATCH 뒤의 스냅샷이 새 값을 다시 싣고 오므로 화면이 한 번 뒤집혔다 돌아온다 — [연결선 보이기]
 * 를 누르면 버블이 "밝아졌다 → 어두워졌다 → 다시 밝아졌다"(§5.4 #31 (K) 선택 초점이 보이는 선으로 거리를 다시
 * 재므로 — 2026-10-18 사용자 보고). 에이전트가 일하는 동안은 스냅샷이 쉬지 않고 오므로 드문 경합이 아니다.
 *
 * 그래서 **누른 칸만** 붙든다(다른 칸은 서버 값 그대로):
 *  - 보낸 PATCH 가 하나라도 답하지 않았으면, 스냅샷이 무엇을 싣고 오든 누른 값을 덧씌운다.
 *  - 다 답한 뒤 스냅샷이 누른 값을 싣고 오면 놓는다(서버가 받아들였다).
 *  - PATCH 가 실패하면 곧바로 놓는다(서버가 받지 않은 값을 화면이 붙들지 않는다 — 다음 스냅샷이 되돌린다).
 *  - 그 밖에는 `pendingMs` 가 지나면 놓는다(다른 창이 되돌렸을 때의 안전망 — 그 뒤로는 서버가 권위다).
 *
 * "다 답한 뒤"를 기다리는 까닭: 숨김 → 보임을 빨리 두 번 누르면, 첫 PATCH 전에 떠난 스냅샷(보임)이 지금의 바람
 * (보임)과 우연히 같다. 그것을 확인으로 읽고 놓으면 두 PATCH 사이에 떠난 스냅샷(숨김)이 다시 뒤집는다.
 *
 * 낙관 반영(store)과 덧씌우기가 **같은 함수**(`withHeldFields`)를 쓴다 — 모양이 같아야 뒤따르는 구조적 공유가
 * 덧씌운 사본을 지금 store 의 참조로 접어, 붙드는 동안 화면이 한 번도 다시 그려지지 않는다.
 * §5.4 #36 (F) 낙관 생성(`pendingAppBubbles` · `APP_BUBBLE_PENDING_MS`)과 같은 규율이다. DOM·store 를 만지지 않는
 * 순수 함수라 그대로 단위 테스트된다.
 */

/** 붙드는 칸과 그 값. `undefined` 는 "칸이 없다"다 — 기본값은 칸을 지워서 적는다(서버와 같은 모양). */
export type HeldFields = Readonly<Record<string, unknown>>;

export interface LinkViewHold {
  /** 화면이 보여 줘야 하는 값 — 누른 칸만. 같은 칸을 다시 누르면 마지막 값이 이긴다. */
  readonly want: HeldFields;
  /** 아직 답이 안 온 PATCH 수. */
  readonly inFlight: number;
  /** 마지막으로 누른 시각(ms) — 안전망 만료의 기준. */
  readonly at: number;
  /**
   * 이 붙들기가 처음 선 시각(ms). PATCH 의 답은 이 값으로 자기 붙들기를 찾는다 — 실패·만료로 놓인 붙들기의
   * 늦은 답이 그 뒤에 새로 선 붙들기의 수를 깎으면, 아직 도는 PATCH 를 두고 일찍 놓게 된다.
   */
  readonly since: number;
}

/** 노드 id → 붙들기. */
export type LinkViewHolds = Readonly<Record<string, LinkViewHold>>;

/** 아무것도 붙들지 않는다 — 한 객체를 돌려 써서 무변화 비교가 참조로 끝나게. */
export const NO_LINK_VIEW_HOLDS: LinkViewHolds = {};

/** 이 객체가 누른 값을 이미 싣고 있나. 칸이 없는 것은 `undefined` 와 같다. */
export function carriesHeldFields(item: object, want: HeldFields): boolean {
  const record = item as Record<string, unknown>;
  for (const [key, value] of Object.entries(want)) {
    if (record[key] !== value) return false;
  }
  return true;
}

/** 누른 값을 입힌 사본 — `undefined` 는 칸을 지운다. 낙관 반영과 덧씌우기가 같은 모양을 내도록 이 함수 하나를 쓴다. */
export function withHeldFields<T extends object>(item: T, want: HeldFields): T {
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** 이 노드에 지금 선 붙들기의 `since` — 새로 서면 `now` 다. 누르기 **전에** 읽어 PATCH 의 답에 쥐여 준다. */
export function linkViewHoldSince(holds: LinkViewHolds, id: string, now: number): number {
  return holds[id]?.since ?? now;
}

/** 눌렀다 — 누른 칸을 얹고, 답을 기다리는 PATCH 를 하나 센다. */
export function beginLinkViewHold(holds: LinkViewHolds, id: string, want: HeldFields, now: number): LinkViewHolds {
  const prev = holds[id];
  return {
    ...holds,
    [id]: { want: { ...prev?.want, ...want }, inFlight: (prev?.inFlight ?? 0) + 1, at: now, since: prev?.since ?? now },
  };
}

/** PATCH 가 답했다. 실패면 그 노드의 붙들기를 통째로 놓는다. 이미 놓였거나 다른 붙들기면 아무것도 하지 않는다. */
export function settleLinkViewHold(holds: LinkViewHolds, id: string, since: number, ok: boolean): LinkViewHolds {
  const prev = holds[id];
  if (prev === undefined || prev.since !== since) return holds;
  if (!ok) {
    const { [id]: _released, ...rest } = holds;
    return rest;
  }
  return { ...holds, [id]: { ...prev, inFlight: Math.max(0, prev.inFlight - 1) } };
}

/**
 * 들어온 목록에 붙들기를 입힌다 — 스냅샷을 store 에 넣기 **직전에** 부른다. 놓을 것(확인됨·만료)은 결과의
 * `holds` 에서 빠진다. 바꿀 것이 없으면 **같은 배열·같은 붙들기 객체**를 돌려준다.
 * 목록에 없는 노드(이번 스냅샷 범위 밖·지워짐)의 붙들기는 그대로 둔다 — 덧씌울 자리가 없을 뿐이고, 만료가 거둔다.
 */
export function applyLinkViewHolds<T extends { readonly id: string }>(
  incoming: readonly T[],
  holds: LinkViewHolds,
  now: number,
  pendingMs: number,
): { readonly list: T[]; readonly holds: LinkViewHolds } {
  const ids = Object.keys(holds);
  if (ids.length === 0) return { list: incoming as T[], holds };
  let next: Record<string, LinkViewHold> | null = null;
  for (const id of ids) {
    if (now - holds[id]!.at <= pendingMs) continue;
    next ??= { ...holds };
    delete next[id];
  }
  let list: T[] | null = null;
  for (let i = 0; i < incoming.length; i++) {
    const item = incoming[i]!;
    const hold = (next ?? holds)[item.id];
    if (hold === undefined) continue;
    if (carriesHeldFields(item, hold.want)) {
      if (hold.inFlight > 0) continue;
      next ??= { ...holds };
      delete next[item.id];
      continue;
    }
    list ??= incoming.slice();
    list[i] = withHeldFields(item, hold.want);
  }
  return { list: list ?? (incoming as T[]), holds: next ?? holds };
}
